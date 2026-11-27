"""
Measuring in Edit Splats: a point picked on the splats (or the textured model) moved onto the task's point cloud,
and the polygon of a Volume put in longitude and latitude for WebODM's own volume (the map's).

The pick comes in the trained model's frame: the task's projection less the offset WebODM's export takes off x and
y (get_rtc_offset); heights are not offset. The cloud is read from the task's tiled point cloud (the EPT WebODM
builds for its 3D view), only a small box about the pick, by PDAL: about a tenth of a second, with nothing to build
or keep, on any size of task.
"""

import logging
import math
import os
import shutil
import subprocess

import numpy as np
from app.geoutils import get_rtc_offset

logger = logging.getLogger("app.logger")

READ_WAIT = 15  # seconds PDAL may take to read the box
MIN_WINDOW = 0.25  # metres: how far before or behind the pick a point may lie (a splat's edge is before the surface)
WINDOW_RADII = 4  # the window is at least this many radii
MAX_WINDOW = 5.0  # metres
RADIUS_RANGE = (0.002, 2.0)  # metres: how far from the ray a point may lie (the view sends a few pixels' width)
MAX_COORDINATE = 1e9
MAX_RING = 200  # a Volume's corners, at most
BASES = ("triangulate", "plane", "average", "highest", "lowest")  # WebODM's volume's base methods


class MeasureError(Exception):
    pass


def ept_path(task):
    path = task.assets_path("entwine_pointcloud", "ept.json")
    return path if os.path.isfile(path) else None


def vector(text, what):
    """Three finite numbers from "x,y,z"."""
    try:
        values = [float(v) for v in str(text).split(",")]
    except ValueError:
        values = []
    if len(values) != 3 or not all(math.isfinite(v) and abs(v) < MAX_COORDINATE for v in values):
        raise MeasureError(f"{what} must be three numbers, x,y,z.")
    return np.array(values)


def read_box(path, low, high):
    """The cloud's points in a box (projected coordinates) as an array of rows x, y, z."""
    bounds = f"([{low[0]:.3f},{high[0]:.3f}],[{low[1]:.3f},{high[1]:.3f}],[{low[2]:.3f},{high[2]:.3f}])"
    command = [shutil.which("pdal") or "pdal", "translate", "ept://" + path, "STDOUT", "--writer", "writers.text",
               f"--readers.ept.bounds={bounds}", "--writers.text.order=X,Y,Z",
               "--writers.text.keep_unspecified=false"]  # fmt: skip
    done = subprocess.run(command, capture_output=True, timeout=READ_WAIT, check=False)
    if done.returncode != 0:
        raise OSError(f"PDAL failed: {done.stderr.decode('utf-8', 'replace')[-300:].strip()}")
    lines = done.stdout.decode("ascii", "replace").splitlines()[1:]  # the header: "X","Y","Z"
    if not lines:
        return np.empty((0, 3))
    return np.array([[float(v) for v in line.split(",")[:3]] for line in lines if line.strip()]).reshape(-1, 3)


def nearest_on_ray(points, origin, direction, hit, radius, window):
    """
    Of points (rows x, y, z, in the frame of the others) within radius of the ray from origin along direction (a unit
    vector) and within window of the hit's distance along it, the one nearest the hit's depth (its distance across
    added: of two at the same depth, the one nearer the ray); None when none is. Nearest the depth, not the ray: a
    wall seen from above has points all down the ray, and the one clicked is at the top, where the view met it.
    """
    if not len(points):
        return None
    along = (points - origin) @ direction
    depth = (hit - origin) @ direction
    across = np.linalg.norm(points - origin - np.outer(along, direction), axis=1)
    near = (across <= radius) & (np.abs(along - depth) <= window)
    if not near.any():
        return None
    index = np.flatnonzero(near)[np.argmin(np.abs(along[near] - depth) + across[near])]
    return points[index]


def snap(task, origin, direction, hit, radius):
    """
    The point of the task's cloud under a pick, in the trained model's frame: {point, snapped, moved (metres from the
    hit)}; with no cloud near, the hit itself, not snapped (reason says why, when the cloud could not be read).
    """
    length = np.linalg.norm(direction)
    if length == 0:
        raise MeasureError("The direction must not be zero.")
    direction = direction / length
    try:
        radius = float(radius)
    except (TypeError, ValueError):
        raise MeasureError("The radius must be a number.") from None
    if not math.isfinite(radius):
        raise MeasureError("The radius must be a number.")
    radius = min(max(radius, RADIUS_RANGE[0]), RADIUS_RANGE[1])
    window = min(max(MIN_WINDOW, WINDOW_RADII * radius), MAX_WINDOW)
    kept = {"point": [round(float(v), 4) for v in hit], "snapped": False, "moved": 0}
    path = ept_path(task)
    if path is None:
        return {**kept, "reason": "This task has no point cloud to measure on."}
    dx, dy = get_rtc_offset(task)
    offset = np.array([dx, dy, 0.0])
    reach = window + radius
    try:
        points = read_box(path, hit + offset - reach, hit + offset + reach) - offset
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        logger.warning(f"SplatMe: task {task.id}'s point cloud could not be read for a measurement: {e}")
        return {**kept, "reason": "The task's point cloud could not be read."}
    found = nearest_on_ray(points, origin, direction, hit, radius, window)
    if found is None:
        return kept
    return {"point": [round(float(v), 4) for v in found], "snapped": True, "moved": round(float(np.linalg.norm(found - hit)), 4)}


def volume_corners(task, ring):
    """
    A Volume's polygon (corners [x, y] in the trained model's frame) as [longitude, latitude] corners, as WebODM's
    calc_volume takes them (pts_epsg 4326).
    """
    if not isinstance(ring, list) or not 3 <= len(ring) <= MAX_RING:
        raise MeasureError(f"A volume needs 3 to {MAX_RING} corners.")
    try:
        corners = [(float(p[0]), float(p[1])) for p in ring]
    except (TypeError, ValueError, IndexError, KeyError):
        raise MeasureError("Each corner must be two numbers, x and y.") from None
    if not all(math.isfinite(v) and abs(v) < MAX_COORDINATE for p in corners for v in p):
        raise MeasureError("Each corner must be two numbers, x and y.")
    if task.epsg is None and task.wkt is None:
        raise MeasureError("This task has no projection, so its volume cannot be calculated.")
    from pyproj import CRS, Transformer

    source = CRS.from_epsg(task.epsg) if task.epsg is not None else CRS.from_wkt(task.wkt)
    to_degrees = Transformer.from_crs(source, CRS.from_epsg(4326), always_xy=True)
    dx, dy = get_rtc_offset(task)
    return [list(to_degrees.transform(x + dx, y + dy)) for x, y in corners]
