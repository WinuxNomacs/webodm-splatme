"""
Cropping a trained model to the boundary its task was processed with: the GeoJSON of the task's "boundary"
option, to which the processing already cut the point cloud, the mesh and the orthophoto. The training sees the
photos whole, so some of its gaussians end up outside; those are left out of the model the task shows.
"""
import json

import numpy as np
from app import splats
from app.geoutils import geom_transform, get_rtc_offset

ROWS = 1 << 20  # gaussians read at a time
PLY_TYPES = {
    "char": "i1", "uchar": "u1", "short": "<i2", "ushort": "<u2", "int": "<i4", "uint": "<u4", "float": "<f4",
    "double": "<f8", "int8": "i1", "uint8": "u1", "int16": "<i2", "uint16": "<u2", "int32": "<i4",
    "uint32": "<u4", "float32": "<f4", "float64": "<f8",
}  # fmt: skip


def polygons(geojson):
    """The polygons of a GeoJSON value of any kind, each as GeoJSON."""
    if not isinstance(geojson, dict):
        return []
    kind = geojson.get("type")
    if kind == "FeatureCollection":
        return [p for feature in geojson.get("features") or [] for p in polygons(feature)]
    if kind == "Feature":
        return polygons(geojson.get("geometry"))
    if kind == "GeometryCollection":
        return [p for geometry in geojson.get("geometries") or [] for p in polygons(geometry)]
    if kind == "MultiPolygon":
        return [{"type": "Polygon", "coordinates": rings} for rings in geojson.get("coordinates") or []]
    return [geojson] if kind == "Polygon" else []


def boundary(task):
    """
    The task's boundary as rings of (x, y) in the trained model's coordinates (the task's projection, less the
    offset WebODM's export takes off). Empty when the task was processed without one or has no projection.
    """
    value = next((o.get("value") for o in task.options or [] if o.get("name") == "boundary"), None)
    if not value or (task.epsg is None and task.wkt is None):
        return []
    try:
        geojson = json.loads(value) if isinstance(value, str) else value
        offset_x, offset_y = get_rtc_offset(task)
        rings = []
        for polygon in polygons(geojson):
            ring = geom_transform(polygon, task.epsg if task.epsg is not None else task.wkt)
            if len(ring) >= 3:
                rings.append([(x - offset_x, y - offset_y) for x, y in ring])
        return rings
    except Exception:  # noqa: BLE001 (a boundary that cannot be read or projected crops nothing)
        return []


def inside(x, y, rings):
    """Which of the points are inside one of the rings."""
    result = np.zeros(len(x), dtype=bool)
    for ring in rings:
        within = np.zeros(len(x), dtype=bool)
        xj, yj = ring[-1]
        for xi, yi in ring:
            if yi != yj:
                within ^= ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
            xj, yj = xi, yi
        result |= within
    return result


def crop_ply(source, dest, rings):
    """
    Writes the trainer's .ply with only the gaussians inside the rings. Answers (kept, all); nothing is written
    when none or all of them are inside.
    """
    with open(source, "rb") as f:
        count, props = splats.parse_ply_header(f)
        start = f.tell()
        f.seek(0)
        header = f.read(start)
    record = np.dtype([(name, PLY_TYPES[kind]) for name, kind in props])
    data = np.memmap(source, dtype=record, mode="r", offset=start, shape=(count,))
    keep = np.zeros(count, dtype=bool)
    for first in range(0, count, ROWS):
        rows = data[first : first + ROWS]
        keep[first : first + ROWS] = inside(rows["x"].astype(np.float64), rows["y"].astype(np.float64), rings)
    kept = int(keep.sum())
    if kept in (0, count):
        return kept, count
    old = b"element vertex %d" % count
    if header.count(old) != 1:
        raise ValueError("Unsupported PLY header")
    with open(dest, "wb") as f:
        f.write(header.replace(old, b"element vertex %d" % kept))
        for first in range(0, count, ROWS):
            f.write(data[first : first + ROWS][keep[first : first + ROWS]].tobytes())
    return kept, count
