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
    brush    strokes [{size, points [[x, y], ...]}, ...] painted on the screen (normalised device coordinates) in one
             view (as a lasso's, with its camera), aspect (the screen's width over its height), no keep: removes every
             gaussian in front of the camera whose centre falls within size of a stroke's line, through to the back.
             Distances are in units of half the screen's height: x is multiplied by aspect first, so a stroke's
             size is the same across and up the screen; restore: true puts back what the edits before it removed
             (the Restore Brush) instead
    each     keep: true keeps what is inside and removes the rest, false removes what is inside
    floaters strength ("light", "medium" or "strong"), at most one, no keep: removes the gaussians far from their
             neighbours or oversized, judged on the whole trained model (floaters()), so the shapes do not change
             which ones they are
    colour   brightness, contrast, saturation, warmth (each -1 to 1, 0 for no change), at most one, no keep: changes
             the colours of the whole model (colour_change()), the light that changes with the view too

The edits apply in their list's order: a removing shape or stroke takes out what it covers, a keeping shape the
rest, the floaters theirs, and a restore puts back what it covers, whatever took it out before it. Without a
restore the order changes nothing.
"""
import hashlib
import itertools
import json
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
MAX_STROKES = 500  # a Brush edit's strokes
MAX_BRUSH_POINTS = 20000  # a Brush edit's points, all its strokes together
MAX_BRUSH_SIZE = 4  # half the screen's height is 1
MAX_COORDINATE = 1e9  # metres, or degrees in a task without a projection: anything beyond is a mistake
# Floaters, by strength: a gaussian is one when the mean distance to its NEIGHBOURS nearest is more than the
# model's mean of it plus this many standard deviations, or when its largest axis is more than this share of the
# scene (the largest side of the box holding the middle 90% of the centres). Chosen on the check task: Light 382
# far and 107 oversized of 216,865, Medium 638 and 246, Strong 1,634 and 563 (2026-11-18).
STRENGTHS = {"light": (3, 0.2), "medium": (2, 0.1), "strong": (1, 0.05)}
NEIGHBOURS = 16
COLOURS = ("brightness", "contrast", "saturation", "warmth")  # Colour Adjust's sliders, each -1 to 1
SH_C0 = 0.28209479177387814  # a gaussian's colour is 0.5 + SH_C0 * f_dc
LUMA = (0.2126, 0.7152, 0.0722)  # how much each of red, green and blue counts in a colour's lightness


class EditsError(Exception):
    """Edits that cannot be kept: the message says what is wrong, for the page."""


def store():
    return GlobalDataStore(NAME)


def edits_key(task_id):
    return f"edits::{task_id}"


def number(value, what, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EditsError(f"{what} must be a number.")
    try:
        value = float(value)
    except OverflowError:  # an integer of hundreds of digits
        raise EditsError(f"{what} is out of range.") from None
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
            if not isinstance(edit.get("strength"), str) or edit["strength"] not in STRENGTHS:
                raise EditsError(f"Edit {i}'s strength must be Light, Medium or Strong.")
            if any(e["type"] == "floaters" for e in out):
                raise EditsError("Floaters can be removed only once.")
            out.append({"type": "floaters", "strength": edit["strength"]})
            continue
        if kind == "brush":
            out.append(clean_brush(edit, i))
            continue
        if kind == "colour":
            if any(e["type"] == "colour" for e in out):
                raise EditsError("The colours can be adjusted only once.")
            clean_edit = {"type": "colour"}
            for name in COLOURS:
                value = number(edit.get(name, 0), f"Edit {i}'s {name}")
                if abs(value) > 1:
                    raise EditsError(f"Edit {i}'s {name} must be from -1 to 1.")
                clean_edit[name] = round(value, 2)
            out.append(clean_edit)
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
                clean_view(edit, clean_edit, i)
            out.append(clean_edit)
        else:
            raise EditsError(f"Edit {i} is of an unknown kind.")
    return out


def clean_view(edit, clean_edit, i):
    """A lasso's or a brush's view, and its camera when given, into clean_edit."""
    clean_edit["view"] = numbers(edit.get("view"), 16, f"Edit {i}'s view")
    camera = edit.get("camera")
    if camera is not None:
        if not isinstance(camera, dict):
            raise EditsError(f"Edit {i}'s camera must have a position and a target.")
        clean_edit["camera"] = {
            name: numbers(camera.get(name), 3, f"Edit {i}'s camera {name}") for name in ("position", "target")
        }


def clean_brush(edit, i):
    strokes = edit.get("strokes")
    if not isinstance(strokes, list) or not 1 <= len(strokes) <= MAX_STROKES:
        raise EditsError(f"Edit {i} must have from 1 to {MAX_STROKES} strokes.")
    clean_edit = {"type": "brush", "aspect": number(edit.get("aspect"), f"Edit {i}'s aspect", positive=True), "strokes": []}
    restore = edit.get("restore", False)
    if not isinstance(restore, bool):
        raise EditsError(f"Edit {i} must say whether it removes or restores what it painted over.")
    if restore:
        clean_edit["restore"] = True
    total = 0
    for stroke in strokes:
        points = stroke.get("points") if isinstance(stroke, dict) else None
        if not isinstance(points, list) or not points:
            raise EditsError(f"Edit {i}'s strokes must each have points.")
        total += len(points)
        if total > MAX_BRUSH_POINTS:
            raise EditsError(f"Edit {i} must have at most {MAX_BRUSH_POINTS} points in its strokes.")
        size = number(stroke.get("size"), f"Edit {i}'s brush size", positive=True)
        if size > MAX_BRUSH_SIZE:
            raise EditsError(f"Edit {i}'s brush size is out of range.")
        clean_edit["strokes"].append({"size": size, "points": [numbers(p, 2, f"Edit {i}'s points") for p in points]})
    clean_view(edit, clean_edit, i)
    return clean_edit


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
        elif edit["type"] in ("lasso", "brush"):
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
    return get_with_fingerprint(task)[0]


def fingerprint(stored):
    """A short hash of edits as stored, None for none: whether a model was made with the edits saved now."""
    if not stored:
        return None
    return hashlib.sha256(json.dumps(stored, sort_keys=True).encode()).hexdigest()[:32]


def saved_fingerprint(task_id):
    return fingerprint(store().get_json(edits_key(task_id), None))


def get_with_fingerprint(task):
    """The task's edits, as get gives them, and the fingerprint of what they were read from."""
    stored = store().get_json(edits_key(task.id), None)
    if stored is None:
        return [], None
    try:
        edits = clean(stored)
    except EditsError as e:
        logger.warning(f"SplatMe: task {task.id}'s edits do not read: {e}")
        raise EditsError(f"The task's saved edits could not be read ({e}) and were left as they are.") from None
    dx, dy = offset(task)
    return shift(edits, -dx, -dy), fingerprint(stored)


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


def screen(edit, x, y, z):
    """Where the points are on a lasso's or a brush's screen (-1 to 1), and which are in front of its camera."""
    m = edit["view"]
    cx = m[0] * x + m[4] * y + m[8] * z + m[12]
    cy = m[1] * x + m[5] * y + m[9] * z + m[13]
    w = m[3] * x + m[7] * y + m[11] * z + m[15]
    front = w > 0  # behind the camera, a point projects mirrored: never inside
    safe = np.where(front, w, 1)
    return cx / safe, cy / safe, front


def brushed(edit, x, y, z):
    """
    Which of the points a brush's strokes paint over: within a stroke's size of the line through its points (of
    its one point), on the screen, in front of the camera. The points sorted across the screen once, so each piece
    of a line looks only at those beside it.
    """
    u, v, front = screen(edit, x, y, z)
    u = u * edit["aspect"]
    hit = np.zeros(len(u), dtype=bool)
    order = np.nonzero(front)[0]
    order = order[np.argsort(u[order], kind="stable")]
    across = u[order]
    for stroke in edit["strokes"]:
        r = stroke["size"]
        points = [(px * edit["aspect"], py) for px, py in stroke["points"]]
        pieces = list(itertools.pairwise(points)) or [(points[0], points[0])]
        for (ax, ay), (bx, by) in pieces:
            first = np.searchsorted(across, min(ax, bx) - r, side="left")
            last = np.searchsorted(across, max(ax, bx) + r, side="right")
            near = order[first:last]
            near = near[(v[near] >= min(ay, by) - r) & (v[near] <= max(ay, by) + r)]
            if not len(near):
                continue
            dx, dy = bx - ax, by - ay
            length = dx * dx + dy * dy
            pu, pv = u[near] - ax, v[near] - ay
            t = np.clip((pu * dx + pv * dy) / length, 0, 1) if length > 0 else 0
            ex, ey = pu - t * dx, pv - t * dy
            hit[near[ex * ex + ey * ey <= r * r]] = True
    return hit


def inside(edit, x, y, z):
    """Which of the points are inside the shape (for a brush, under its strokes)."""
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
        sx, sy, front = screen(edit, x, y, z)
        return front & crop.inside(sx, sy, [[edit["ring"]]])
    if edit["type"] == "brush":
        return brushed(edit, x, y, z)
    return crop.inside(x, y, [[edit["ring"]]])


def keep_mask(rows, edits, floaters=None):
    """
    Which of the rows (a chunk of the .ply) the edits keep, in their list's order. floaters: which of the rows are
    the floaters (from floaters()), taken out where the floaters edit is in the list; None keeps them.
    """
    x, y, z = (rows[axis].astype(np.float64) for axis in ("x", "y", "z"))
    keep = np.ones(len(rows), dtype=bool)
    for edit in edits:
        if edit["type"] == "colour":
            continue
        if edit["type"] == "floaters":
            if floaters is not None:
                keep &= ~floaters
            continue
        within = inside(edit, x, y, z)
        if edit.get("restore"):
            keep |= within
        else:
            keep &= within if edit.get("keep", False) else ~within  # a brush has no keep: it removes
    return keep


def strength(edits):
    """The strength of the edits' floaters, or None when they keep them."""
    return next((e["strength"] for e in edits if e["type"] == "floaters"), None)


def colour(edits):
    """The edits' Colour Adjust, or None."""
    return next((e for e in edits if e["type"] == "colour"), None)


def colour_matrix(edit):
    """
    Colour Adjust as a matrix and an offset on a colour's red, green and blue (0 to 1): c' = m @ c + t. The same
    as editShapes.js's colourMatrix. Warmth more red and less blue, brightness a gain, saturation away from or towards
    the colour's grey, contrast away from or towards the middle grey.
    """
    warm = np.diag([1 + 0.2 * edit["warmth"], 1, 1 - 0.2 * edit["warmth"]])
    gain = 1 + 0.5 * edit["brightness"]
    s = 1 + edit["saturation"]
    saturate = s * np.eye(3) + (1 - s) * np.outer(np.ones(3), LUMA)
    k = 2 ** edit["contrast"]
    return k * gain * saturate @ warm, np.full(3, 0.5 * (1 - k))


def colour_change(edit):
    """
    A crop_ply change: Colour Adjust on a chunk of the .ply's rows (a numpy record array). Their colours (f_dc) take
    the whole change; the light that changes with the view (f_rest, red's, then green's, then blue's) its matrix only.
    """
    m, t = colour_matrix(edit)

    def change(rows):
        names = rows.dtype.names
        dc = [f"f_dc_{c}" for c in range(3)]
        if all(name in names for name in dc):
            c = 0.5 + SH_C0 * np.stack([rows[name].astype(np.float64) for name in dc])
            c = m @ c + t[:, None]
            for row, name in zip(c, dc, strict=True):
                rows[name] = (row - 0.5) / SH_C0
        each = sum(name.startswith("f_rest_") for name in names) // 3
        for j in range(each):
            rest = [f"f_rest_{j + each * c}" for c in range(3)]
            if all(name in names for name in rest):
                v = m @ np.stack([rows[name].astype(np.float64) for name in rest])
                for row, name in zip(v, rest, strict=True):
                    rows[name] = row

    return change


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
