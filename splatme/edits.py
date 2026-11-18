"""
Splat edits: shapes drawn on the Edit Splats page that keep or remove the gaussians inside them. One list per
task, in the plugin's global data store, applied to the trainer's .ply each time the task's shown model is made
from it: after a training, and by Apply Edits (training.py). Shapes, not gaussian numbers, so a retraining can
apply them again.

They are stored in the task's projection, as its boundary is, so they line up again after the task is processed
again; the page and the cut see them in the .ply's frame: the projection less the offset WebODM's export takes off
x and y (get_rtc_offset). Heights are not offset.

    box      center [x, y, z], size [x, y, z] (whole lengths), turn (degrees about the vertical, counter-clockwise)
    polygon  ring [[x, y], ...] seen from above, all heights
    lasso    ring [[x, y], ...] drawn on the screen (normalised device coordinates, -1 to 1) and view, the camera's
             view-projection matrix then (16 numbers, column-major): every gaussian in front of the camera whose
             centre falls inside the ring, through to the back; camera {position, target}, for the page to go back
             to that view
    each     keep: true keeps what is inside and removes the rest, false removes what is inside
    floaters strength ("light", "medium" or "strong"), at most one, no keep: removes the gaussians far from their
             neighbours or oversized, judged on the whole trained model (floaters()), so the shapes do not change
             which ones they are
"""
import logging
import math

import numpy as np
from app.geoutils import get_rtc_offset
from app.plugins.data_store import GlobalDataStore

from . import crop

logger = logging.getLogger("app.logger")

NAME = __name__.split(".")[-2]
MAX_EDITS = 200
MAX_CORNERS = 2000
MAX_COORDINATE = 1e9  # metres, or degrees in a task without a projection: anything beyond is a mistake
# Floaters, by strength: a gaussian is one when the mean distance to its NEIGHBOURS nearest is more than the
# model's mean of it plus this many standard deviations, or when its largest axis is more than this share of the
# scene (the largest side of the box holding the middle 90% of the centres). Chosen on the check task: Light 382
# far and 107 oversized of 216,865, Medium 638 and 246, Strong 1,634 and 563 (2026-11-18).
STRENGTHS = {"light": (3, 0.2), "medium": (2, 0.1), "strong": (1, 0.05)}
NEIGHBOURS = 16


class EditsError(Exception):
    """Edits that cannot be kept: the message says what is wrong, for the page."""


def store():
    return GlobalDataStore(NAME)


def edits_key(task_id):
    return f"edits::{task_id}"


def number(value, what, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EditsError(f"{what} must be a number.")
    value = float(value)
    if not math.isfinite(value) or abs(value) > MAX_COORDINATE:
        raise EditsError(f"{what} is out of range.")
    if positive and value <= 0:
        raise EditsError(f"{what} must be more than 0.")
    return value


def numbers(value, count, what, positive=False):
    if not isinstance(value, (list, tuple)) or len(value) != count:
        raise EditsError(f"{what} must be {count} numbers.")
    return [number(v, what, positive) for v in value]


def clean(given):
    """The edits as stored, from a list given by a page or read from the store. Raises EditsError saying what is wrong."""
    if not isinstance(given, list):
        raise EditsError("The edits must be a list.")
    if len(given) > MAX_EDITS:
        raise EditsError(f"A task can have at most {MAX_EDITS} edits.")
    out = []
    for i, edit in enumerate(given, 1):
        if not isinstance(edit, dict):
            raise EditsError(f"Edit {i} is not a shape.")
        kind = edit.get("type")
        if kind == "floaters":
            if edit.get("strength") not in STRENGTHS:
                raise EditsError(f"Edit {i}'s strength must be Light, Medium or Strong.")
            if any(e["type"] == "floaters" for e in out):
                raise EditsError("Floaters can be removed only once.")
            out.append({"type": "floaters", "strength": edit["strength"]})
            continue
        keep = edit.get("keep")
        if not isinstance(keep, bool):
            raise EditsError(f"Edit {i} must say whether it keeps or removes what is inside.")
        if kind == "box":
            out.append({
                "type": "box", "keep": keep, "center": numbers(edit.get("center"), 3, f"Edit {i}'s centre"),
                "size": numbers(edit.get("size"), 3, f"Edit {i}'s size", positive=True),
                "turn": number(edit.get("turn", 0), f"Edit {i}'s turn") % 360,
            })  # fmt: skip
        elif kind in ("polygon", "lasso"):
            ring = edit.get("ring")
            if not isinstance(ring, list) or not 3 <= len(ring) <= MAX_CORNERS:
                raise EditsError(f"Edit {i} must have from 3 to {MAX_CORNERS} corners.")
            clean_edit = {"type": kind, "keep": keep, "ring": [numbers(p, 2, f"Edit {i}'s corners") for p in ring]}
            if kind == "lasso":
                clean_edit["view"] = numbers(edit.get("view"), 16, f"Edit {i}'s view")
                camera = edit.get("camera")
                if camera is not None:
                    if not isinstance(camera, dict):
                        raise EditsError(f"Edit {i}'s camera must have a position and a target.")
                    clean_edit["camera"] = {
                        name: numbers(camera.get(name), 3, f"Edit {i}'s camera {name}") for name in ("position", "target")
                    }
            out.append(clean_edit)
        else:
            raise EditsError(f"Edit {i} is of an unknown kind.")
    return out


def shift(edits, dx, dy):
    """The edits moved by dx, dy (copies), to the micrometre: the offset's sums leave no noise in what a page shows."""

    def move(x, y):
        return [round(x + dx, 6), round(y + dy, 6)]

    out = []
    for edit in edits:
        edit = dict(edit)
        if edit["type"] == "box":
            x, y, z = edit["center"]
            edit["center"] = [*move(x, y), z]
        elif edit["type"] == "polygon":
            edit["ring"] = [move(x, y) for x, y in edit["ring"]]
        elif edit["type"] == "lasso":
            # The same view of the moved scene: the matrix times a translation back by dx, dy (its last column)
            m = list(edit["view"])
            for row in range(4):
                m[12 + row] -= dx * m[row] + dy * m[4 + row]
            edit["view"] = m
            if "camera" in edit:
                edit["camera"] = {name: [*move(*point[:2]), point[2]] for name, point in edit["camera"].items()}
        out.append(edit)
    return out


def offset(task):
    x, y = get_rtc_offset(task)
    return float(x), float(y)


def get(task):
    """
    The task's edits in its .ply's frame. Raises EditsError for edits in the store that do not read, which stay
    there untouched: written by another version of SplatMe (a worker that has not restarted since an upgrade, or a
    downgrade), they read again with the right one. Their callers go on without them and say why.
    """
    stored = store().get_json(edits_key(task.id), None)
    if stored is None:
        return []
    try:
        edits = clean(stored)
    except EditsError as e:
        logger.warning(f"SplatMe: task {task.id}'s edits do not read: {e}")
        raise EditsError(f"The task's saved edits could not be read ({e}) and were left as they are.") from None
    dx, dy = offset(task)
    return shift(edits, -dx, -dy)


def save(task, given):
    """Replaces the task's edits with these, given in its .ply's frame; answers them as get does."""
    edits = clean(given)
    if edits:
        dx, dy = offset(task)
        store().set_json(edits_key(task.id), shift(edits, dx, dy))
    else:
        store().del_key(edits_key(task.id))
    return get(task)


def forget(task_id):
    store().del_key(edits_key(task_id))


def inside(edit, x, y, z):
    """Which of the points are inside the shape."""
    if edit["type"] == "box":
        cx, cy, cz = edit["center"]
        sx, sy, sz = edit["size"]
        turn = math.radians(edit["turn"])
        c, s = math.cos(turn), math.sin(turn)
        dx, dy = x - cx, y - cy
        # In the box's own axes: turned back by its turn
        u, v = dx * c + dy * s, -dx * s + dy * c
        return (np.abs(u) <= sx / 2) & (np.abs(v) <= sy / 2) & (np.abs(z - cz) <= sz / 2)
    if edit["type"] == "lasso":
        m = edit["view"]
        cx = m[0] * x + m[4] * y + m[8] * z + m[12]
        cy = m[1] * x + m[5] * y + m[9] * z + m[13]
        w = m[3] * x + m[7] * y + m[11] * z + m[15]
        front = w > 0  # behind the camera, a point projects mirrored: never inside
        safe = np.where(front, w, 1)
        return front & crop.inside(cx / safe, cy / safe, [[edit["ring"]]])
    return crop.inside(x, y, [[edit["ring"]]])


def keep_mask(rows, edits):
    """Which of the rows (a chunk of the .ply) the shapes keep: all of them agree on it (floaters are not here)."""
    x, y, z = (rows[axis].astype(np.float64) for axis in ("x", "y", "z"))
    keep = np.ones(len(rows), dtype=bool)
    for edit in edits:
        if edit["type"] == "floaters":
            continue
        within = inside(edit, x, y, z)
        keep &= within if edit["keep"] else ~within
    return keep


def strength(edits):
    """The strength of the edits' floaters, or None when they keep them."""
    return next((e["strength"] for e in edits if e["type"] == "floaters"), None)


def floaters(path, strength):
    """
    Which gaussians of the .ply at path are floaters at that strength (a boolean per gaussian): far from their
    neighbours or oversized. Raises ValueError or KeyError for a .ply that cannot be read so.
    """
    ratio, share = STRENGTHS[strength]
    data = crop.read_ply(path)
    count = len(data)
    found = np.zeros(count, dtype=bool)
    if count <= NEIGHBOURS:
        return found
    from scipy.spatial import cKDTree  # only here: the rest of SplatMe does without scipy

    centres = np.stack([data[axis].astype(np.float64) for axis in ("x", "y", "z")], axis=1)
    tree = cKDTree(centres)
    spacing = np.empty(count)
    for first in range(0, count, crop.ROWS):  # in chunks: the distances of all at once would be large
        distances, _ = tree.query(centres[first : first + crop.ROWS], k=NEIGHBOURS + 1, workers=-1)
        spacing[first : first + crop.ROWS] = distances[:, 1:].mean(axis=1)  # the first is the gaussian itself
    found |= spacing > spacing.mean() + ratio * spacing.std()
    scales = [name for name in ("scale_0", "scale_1", "scale_2") if name in data.dtype.names]
    if scales:
        scene = (np.percentile(centres, 95, axis=0) - np.percentile(centres, 5, axis=0)).max()
        # The trainer writes scales as logarithms
        largest = np.exp(np.max(np.stack([data[name].astype(np.float64) for name in scales], axis=1), axis=1))
        found |= largest > share * scene
    return found
