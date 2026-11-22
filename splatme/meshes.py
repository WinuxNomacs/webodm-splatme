"""
Model edits: touch-ups of a task's textured 3D model (WebODM's odm_texturing: its GLB, which WebODM's 3D view and
share links show, and its OBJ with its MTL, the Textured Model download), drawn on the editor page beside the
splats' edits. One list per task, in the plugin's global data store, in the task's projection as the splats' edits
are (edits.py), shown to the page in the model's local frame (less get_rtc_offset, which is the GLB's CESIUM_RTC).

    delete   {"op": "delete", <a box, polygon, lasso or brush of edits.py>}: the triangles whose centres the shape
             covers are removed (keep: true removes the rest; a brush with restore puts back what was removed)
    flatten  {"op": "flatten", <a shape>}: the triangles whose centres the shape covers made flat, their vertices
             moved onto the plane that best fits the selection's rim (the rim staying put)
    fill     {"op": "fill", <a shape>}: the holes whose whole rim the shape covers filled
    object   {"op": "object", <a shape>}: Remove Object, what the shape covers removed and the hole it leaves filled
    move     {"op": "move", <a shape>, "offset": [x, y, z], "scale": [x, y, z], "soft": metres}: what the shape covers
             scaled about its middle and moved, the move fading to nothing over soft metres around it
    smooth   {"op": "smooth", <a shape>, "passes": n}: what the shape covers smoothed, n passes, its rim fixed
    clone    {"op": "clone", <a shape>, "source": [x, y, z], "patch": metres, "feather": metres, "spin": degrees}:
             Clone Texture, what the shape covers textured with the texture around source, tiled and blended in
    straighten {"op": "straighten", <a shape>, "line": [[x, y, z], [x, y, z]], "strength": 0 to 1, "reach": metres}:
             what the shape covers pulled toward the line, fading to nothing at reach from it
    floating {"type": "floating", "size": n}: the pieces of surface of fewer than n triangles, all but the largest
    holes    {"type": "holes", "size": n}: Fill Holes, every hole of at most n edges filled

Cloned triangles get CLONE_TEXTURE the same way. A fill's triangles have a texture of their own, made from the colours around each hole: FILL_TEXTURE beside the
model's textures, a material after the model's in the MTL (and a JPEG inside the GLB).

The rule is public/meshEdits.js, the same code the page's preview runs; Update the Model (apply) runs it in WebODM's
worker through Node (meshApply.mjs), on the model's original files, kept in the task's data/splatme/model the
first time, so edits never stack and Clear Edits then Update the Model makes the model whole again.
"""
import json
import logging
import os
import shutil
import signal
import subprocess
import time
import uuid

from app.models import Task
from django.conf import settings
from django.db import transaction

from . import edits, training

logger = logging.getLogger("app.logger")

KIND = "modelapply"  # the update's record and folder (training.get_apply)
MAX_EDITS = edits.MAX_EDITS
MAX_FLOATING = 100000  # triangles: as meshEdits.MAX_FLOATING
MAX_HOLE = 5000  # edges: as meshEdits.MAX_HOLE
MAX_OFFSET = 100  # metres a move goes along each axis, at most
SCALES = (0.1, 10)  # a move's stretch along each axis
MAX_SOFT = 20  # metres: a move's soft edge
MAX_PASSES = 100  # Smooth's passes
REACHES = (0.01, 20)  # metres: Straighten's reach
PATCHES = (0.1, 20)  # metres: Clone Texture's source patch
MAX_FEATHER = 5  # metres: Clone Texture's blend at the edge
MAX_STAMPS = 2000  # Clone Texture's stamps in one stamping
PAINT_OPS = ("delete", "restore", "fill", "clone", "smooth", "flatten", "raise")  # as meshEdits.PAINT_OPS
PAINT_RADII = (0.01, 10)  # metres: a surface brush stroke's radius
MAX_RAISE = 1  # metres a Raise or Lower stroke moves the surface, at most
SHAPES = ("box", "polygon", "lasso", "brush")
OPS = ("delete", "flatten", "fill", "object", "move", "smooth", "straighten", "clone")
MODEL_DIR = "model"  # in the task's data/splatme: the textured model's original files
FILES = ("odm_textured_model_geo.glb", "odm_textured_model_geo.obj", "odm_textured_model_geo.mtl")
GLB, OBJ, MTL = FILES
FILL_TEXTURE = "odm_textured_model_geo_splatme_fill_map_Kd.png"  # as meshApply.mjs's
CLONE_TEXTURE = "odm_textured_model_geo_splatme_clone_map_Kd.png"  # as meshApply.mjs's
TEXTURES = (FILL_TEXTURE, CLONE_TEXTURE)
NODE_TIMEOUT = 30 * 60  # seconds Node may take to make the model (the check task's takes about 5)
STOP_WAIT = 10  # seconds a stopped Node has to end before it is killed
MESH_APPLY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "meshApply.mjs")


class ModelError(Exception):
    """Why a task's model cannot be edited or updated, for the page."""


def edits_key(task_id):
    return f"modeledits::{task_id}"


def shown_key(task_id):
    return f"modelshown::{task_id}"


def clean(given):
    """The model's edits as stored, from a list given by a page or read from the store. Raises edits.EditsError."""
    if not isinstance(given, list):
        raise edits.EditsError("The model's edits must be a list.")
    if len(given) > MAX_EDITS:
        raise edits.EditsError(f"A model can have at most {MAX_EDITS} edits.")
    out = []
    for i, edit in enumerate(given, 1):
        if not isinstance(edit, dict):
            raise edits.EditsError(f"Edit {i} is not an edit.")
        if edit.get("type") in ("floating", "holes"):
            kind = edit["type"]
            size = edit.get("size")
            most, unit = (MAX_FLOATING, "triangles") if kind == "floating" else (MAX_HOLE, "edges")
            if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= most:
                raise edits.EditsError(f"Edit {i}'s size must be a whole number of {unit} from 1 to {most}.")
            out.append({"type": kind, "size": size})
            continue
        if edit.get("type") == "stamps":
            out.append(clean_stamps(edit, i))
            continue
        if edit.get("type") == "paint":
            out.append(clean_paint(edit, i))
            continue
        op = edit.get("op")
        if op not in OPS or edit.get("type") not in SHAPES:
            raise edits.EditsError(f"Edit {i} is of an unknown kind.")
        params = clean_params(op, edit, i)
        shape = {k: v for k, v in edit.items() if k != "op" and k not in params}
        try:
            (clean_shape,) = edits.clean([shape])
        except edits.EditsError as e:
            raise edits.EditsError(str(e).replace("Edit 1", f"Edit {i}", 1)) from None
        out.append({"op": op, **clean_shape, **params})
    return out


def clean_params(op, edit, i):
    """An op's own settings beside its shape (Move's, Smooth's), checked. Raises EditsError."""

    def axes(name, low, high):
        value = edit.get(name)
        if not isinstance(value, list) or len(value) != 3:
            raise edits.EditsError(f"Edit {i}'s {name} must be 3 numbers.")
        out = [edits.number(v, f"Edit {i}'s {name}") for v in value]
        if not all(low <= v <= high for v in out):
            raise edits.EditsError(f"Edit {i}'s {name} must be from {low} to {high}.")
        return out

    if op == "move":
        soft = edits.number(edit.get("soft"), f"Edit {i}'s soft edge")
        if not 0 <= soft <= MAX_SOFT:
            raise edits.EditsError(f"Edit {i}'s soft edge must be from 0 to {MAX_SOFT} m.")
        return {"offset": axes("offset", -MAX_OFFSET, MAX_OFFSET), "scale": axes("scale", *SCALES), "soft": soft}
    if op == "smooth":
        passes = edit.get("passes")
        if isinstance(passes, bool) or not isinstance(passes, int) or not 1 <= passes <= MAX_PASSES:
            raise edits.EditsError(f"Edit {i}'s passes must be a whole number from 1 to {MAX_PASSES}.")
        return {"passes": passes}
    if op == "straighten":
        line = edit.get("line")
        if not isinstance(line, list) or len(line) != 2:
            raise edits.EditsError(f"Edit {i}'s line must be 2 points.")
        strength = edits.number(edit.get("strength"), f"Edit {i}'s strength")
        reach = edits.number(edit.get("reach"), f"Edit {i}'s reach")
        if not 0 <= strength <= 1:
            raise edits.EditsError(f"Edit {i}'s strength must be from 0 to 1.")
        if not REACHES[0] <= reach <= REACHES[1]:
            raise edits.EditsError(f"Edit {i}'s reach must be from {REACHES[0]} to {REACHES[1]} m.")
        return {"line": [edits.numbers(p, 3, f"Edit {i}'s line") for p in line], "strength": strength, "reach": reach}
    if op == "clone":
        source = edits.numbers(edit.get("source"), 3, f"Edit {i}'s source")
        patch = edits.number(edit.get("patch"), f"Edit {i}'s source size")
        feather = edits.number(edit.get("feather"), f"Edit {i}'s feather")
        spin = edits.number(edit.get("spin"), f"Edit {i}'s turn")
        if not PATCHES[0] <= patch <= PATCHES[1]:
            raise edits.EditsError(f"Edit {i}'s source size must be from {PATCHES[0]} to {PATCHES[1]} m.")
        if not 0 <= feather <= MAX_FEATHER:
            raise edits.EditsError(f"Edit {i}'s feather must be from 0 to {MAX_FEATHER} m.")
        if not -180 <= spin <= 180:
            raise edits.EditsError(f"Edit {i}'s turn must be from -180 to 180 degrees.")
        return {"source": source, "patch": patch, "feather": feather, "spin": spin}
    return {}


def clean_stamps(edit, i):
    """Clone Texture's stamps, checked. Raises EditsError."""
    if edit.get("op") != "clone":
        raise edits.EditsError(f"Edit {i} is of an unknown kind.")
    source = edits.numbers(edit.get("source"), 3, f"Edit {i}'s source")
    feather = edits.number(edit.get("feather"), f"Edit {i}'s feather")
    if not 0 <= feather <= MAX_FEATHER:
        raise edits.EditsError(f"Edit {i}'s feather must be from 0 to {MAX_FEATHER} m.")
    given = edit.get("stamps")
    if not isinstance(given, list) or len(given) > MAX_STAMPS:
        raise edits.EditsError(f"Edit {i}'s stamps must be a list of at most {MAX_STAMPS}.")
    stamps = []
    for stamp in given:
        if not isinstance(stamp, dict):
            raise edits.EditsError(f"Edit {i} has a stamp that is not one.")
        normal = edits.numbers(stamp.get("normal"), 3, f"Edit {i}'s stamp's normal")
        if not any(normal):
            raise edits.EditsError(f"Edit {i}'s stamp's normal must not be 0.")
        size = edits.number(stamp.get("size"), f"Edit {i}'s stamp's size")
        spin = edits.number(stamp.get("spin"), f"Edit {i}'s stamp's turn")
        if not PATCHES[0] <= size <= PATCHES[1]:
            raise edits.EditsError(f"Edit {i}'s stamp's size must be from {PATCHES[0]} to {PATCHES[1]} m.")
        if not -180 <= spin <= 180:
            raise edits.EditsError(f"Edit {i}'s stamp's turn must be from -180 to 180 degrees.")
        stamps.append({"center": edits.numbers(stamp.get("center"), 3, f"Edit {i}'s stamp's centre"), "normal": normal,
                       "size": size, "spin": spin})
    return {"type": "stamps", "op": "clone", "source": source, "feather": feather, "stamps": stamps}


def clean_paint(edit, i):
    """A surface brush edit (meshEdits.js's paint), checked. Raises EditsError."""
    op = edit.get("op")
    if op not in PAINT_OPS:
        raise edits.EditsError(f"Edit {i} is of an unknown kind.")
    given = edit.get("strokes")
    if not isinstance(given, list) or not 1 <= len(given) <= edits.MAX_STROKES:
        raise edits.EditsError(f"Edit {i} must have from 1 to {edits.MAX_STROKES} strokes.")
    strokes, points = [], 0
    for stroke in given:
        if not isinstance(stroke, dict) or not isinstance(stroke.get("points"), list) or not stroke["points"]:
            raise edits.EditsError(f"Edit {i} has a stroke that is not one.")
        points += len(stroke["points"])
        if points > edits.MAX_BRUSH_POINTS:
            raise edits.EditsError(f"Edit {i} has more than {edits.MAX_BRUSH_POINTS} points.")
        radius = edits.number(stroke.get("radius"), f"Edit {i}'s stroke's radius")
        if not PAINT_RADII[0] <= radius <= PAINT_RADII[1]:
            raise edits.EditsError(f"Edit {i}'s stroke's radius must be from {PAINT_RADII[0]} to {PAINT_RADII[1]} m.")
        view = edits.numbers(stroke.get("view"), 3, f"Edit {i}'s stroke's view")
        if not any(view):
            raise edits.EditsError(f"Edit {i}'s stroke's view must not be 0.")
        strokes.append({"points": [edits.numbers(p, 3, f"Edit {i}'s stroke's points") for p in stroke["points"]],
                        "radius": radius, "view": view})
    out = {"type": "paint", "op": op, "strokes": strokes}
    if op == "smooth" and "passes" in edit:
        passes = edit["passes"]
        if isinstance(passes, bool) or not isinstance(passes, int) or not 1 <= passes <= MAX_PASSES:
            raise edits.EditsError(f"Edit {i}'s passes must be a whole number from 1 to {MAX_PASSES}.")
        out["passes"] = passes
    if op == "raise":
        amount = edits.number(edit.get("amount"), f"Edit {i}'s amount")
        if not -MAX_RAISE <= amount <= MAX_RAISE:
            raise edits.EditsError(f"Edit {i}'s amount must be from -{MAX_RAISE} to {MAX_RAISE} m.")
        out["amount"] = amount
    if op == "clone":
        normal = edits.numbers(edit.get("normal"), 3, f"Edit {i}'s normal")
        if not any(normal):
            raise edits.EditsError(f"Edit {i}'s normal must not be 0.")
        feather = edits.number(edit.get("feather", 0.02), f"Edit {i}'s feather")
        if not 0 <= feather <= MAX_FEATHER:
            raise edits.EditsError(f"Edit {i}'s feather must be from 0 to {MAX_FEATHER} m.")
        out.update({"source": edits.numbers(edit.get("source"), 3, f"Edit {i}'s source"),
                    "target": edits.numbers(edit.get("target"), 3, f"Edit {i}'s target"), "normal": normal, "feather": feather})
    return out


def shift(given, dx, dy):
    """The edits moved by dx, dy: the shapes as edits.shift moves them, the rest as they are."""
    out = []
    def moved(point):
        return [round(point[0] + dx, 6), round(point[1] + dy, 6), point[2]]

    for edit in given:
        if edit.get("type") == "paint":
            out.append({**edit, "strokes": [{**s, "points": [moved(p) for p in s["points"]]} for s in edit["strokes"]],
                        **({"source": moved(edit["source"]), "target": moved(edit["target"])} if "source" in edit else {})})
        elif edit.get("type") == "stamps":
            x, y, z = edit["source"]
            out.append({**edit, "source": [round(x + dx, 6), round(y + dy, 6), z],
                        "stamps": [{**s, "center": [round(s["center"][0] + dx, 6), round(s["center"][1] + dy, 6), s["center"][2]]}
                                   for s in edit["stamps"]]})
        elif "op" in edit:
            shape = {k: v for k, v in edit.items() if k != "op"}
            (moved,) = edits.shift([shape], dx, dy)
            if "line" in moved:
                moved["line"] = [[round(x + dx, 6), round(y + dy, 6), z] for x, y, z in moved["line"]]
            if "source" in moved:
                x, y, z = moved["source"]
                moved["source"] = [round(x + dx, 6), round(y + dy, 6), z]
            out.append({"op": edit["op"], **moved})
        else:
            out.append(dict(edit))
    return out


def get_with_fingerprint(task):
    """The task's model edits in the model's frame, and the fingerprint of what they were read from."""
    stored = edits.store().get_json(edits_key(task.id), None)
    if stored is None:
        return [], None
    try:
        found = clean(stored)
    except edits.EditsError as e:
        logger.warning(f"SplatMe: task {task.id}'s model edits do not read: {e}")
        raise edits.EditsError(f"The model's saved edits could not be read ({e}) and were left as they are.") from None
    dx, dy = edits.offset(task)
    return shift(found, -dx, -dy), edits.fingerprint(stored)


def get(task):
    return get_with_fingerprint(task)[0]


def save(task, given):
    """Replaces the task's model edits with these, given in the model's frame; answers them as get does."""
    found = clean(given)
    if found:
        dx, dy = edits.offset(task)
        edits.store().set_json(edits_key(task.id), shift(found, dx, dy))
    else:
        edits.store().del_key(edits_key(task.id))
    return get(task)


def shown_current(task_id):
    """Whether the task's model was made with the edits saved now; None when no update has run."""
    record = edits.store().get_json(shown_key(task_id), None)
    if record is None:
        return None
    return record.get("edits") == edits.fingerprint(edits.store().get_json(edits_key(task_id), None))


def forget(task_id):
    for key in (edits_key(task_id), shown_key(task_id), training.apply_key(task_id, KIND)):
        edits.store().del_key(key)
    shutil.rmtree(training.apply_dir(task_id, kind=KIND), ignore_errors=True)


def processed_again(task_id):
    """The task's textured model is a new one: no update made it (its edits stay, for the next)."""
    for key in (shown_key(task_id), training.apply_key(task_id, KIND)):
        edits.store().del_key(key)


def texturing_dir(task):
    return task.assets_path("odm_texturing")


def model_dir(task):
    return os.path.join(training.trained_dir(task), MODEL_DIR)


def editable(task):
    """Why the task's textured model cannot be edited, or None."""
    if "textured_model.glb" not in task.available_assets:
        return "This task has no textured 3D model."
    if not all(os.path.isfile(os.path.join(texturing_dir(task), name)) for name in FILES) and not kept(task):
        return "This task's textured model is missing its OBJ or MTL file."
    return None


def kept(task):
    """Whether the model's original files are kept (an update has replaced them)."""
    return all(os.path.isfile(os.path.join(model_dir(task), name)) for name in FILES)


def original(task, name):
    """The path of one of the model's original files: the kept copy once an update has replaced it."""
    copy = os.path.join(model_dir(task), name)
    return copy if os.path.isfile(copy) else os.path.join(texturing_dir(task), name)


def keep_originals(task):
    """The model's files copied to data/splatme/model before the first update replaces them, written beside first."""
    if kept(task):
        return
    folder = model_dir(task)
    os.makedirs(folder, exist_ok=True)
    for name in FILES:
        dest = os.path.join(folder, name)
        if not os.path.isfile(dest):
            shutil.copyfile(os.path.join(texturing_dir(task), name), dest + training.NEW)
            os.replace(dest + training.NEW, dest)


def info(task):
    """The original model for the page: its address and size."""
    path = original(task, GLB)
    return {"url": f"/api/plugins/{training.NAME}/task/{task.id}/model-original", "size": os.path.getsize(path)}


def drop_cached_models(task):
    """
    WebODM's smaller copies of a large GLB for its 3D view (Task.get_safe_textured_model), which it never checks
    against the GLB: made again from the new one when asked for.
    """
    folder = task.get_task_assets_cache()
    stem = os.path.splitext(GLB)[0] + "-"
    try:
        names = os.listdir(folder)
    except OSError:
        return
    for name in names:
        if name.startswith(stem) and name.endswith(".glb"):
            try:
                os.remove(os.path.join(folder, name))
            except OSError as e:
                logger.warning(f"SplatMe: could not remove task {task.id}'s cached model {name}: {e}")


def start_apply(task, username):
    """Makes the task's textured model again from its original files with its edits. Raises ModelError."""
    reason = editable(task)
    if reason:
        raise ModelError(reason)
    run = uuid.uuid4().hex
    now = time.time()
    record = {
        "state": training.APPLYING, "run": run, "waiting": run, "user": username, "status": "", "error": None,
        "started": now, "updated": now, "finished": None, "removed": None, "flattened": None, "moved": None, "filled": None, "added": None, "cloned": None,
        "triangles": None,
    }  # fmt: skip
    with transaction.atomic():
        training.lock_records()
        if training.applying(task.id, KIND):
            raise ModelError("This task's model is already being updated.")
        edits.store().set_json(training.apply_key(task.id, KIND), record)
    training.run_function_async(apply_job, training.PACKAGE, str(task.id), run)
    return training.get_apply(task.id, KIND)


def apply_job(package, task_id, run):
    # Only this function's source reaches the worker (run_function_async): the rest is imported there
    import importlib

    importlib.import_module(package + ".meshes").apply(task_id, run)


def report(task_id, run, **fields):
    training.update_apply(task_id, run, KIND, **fields)


def check(task_id, run):
    training.check_apply(task_id, run, KIND)


def node_command():
    return ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", MESH_APPLY]


def make_model(task_id, run, task, found, work):
    """Runs meshApply.mjs on the model's original files: answers its report. Stops it when the update is canceled."""
    edits_file = os.path.join(work, "edits.json")
    with open(edits_file, "w") as f:
        json.dump(found, f)
    out = os.path.join(work, "out")
    os.makedirs(out, exist_ok=True)
    command = [*node_command(), original(task, GLB), original(task, MTL), edits_file, out]
    env = {**os.environ, "WEBODM_DIR": str(settings.BASE_DIR)}
    log = os.path.join(work, "node.log")
    with open(log, "wb") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        deadline = time.time() + NODE_TIMEOUT
        try:
            while process.poll() is None:
                if time.time() > deadline:
                    raise training.TrainingError("Making the model took too long: it was stopped.")
                check(task_id, run)  # canceled: Node is stopped below
                time.sleep(1)
        finally:
            if process.poll() is None:
                stop(process)
    if process.returncode != 0:
        with open(log, errors="replace") as f:
            lines = [line.strip() for line in f if line.strip() and not line.startswith("prune:")]
        raise training.TrainingError(f"The model could not be made: {lines[-1] if lines else 'Node failed.'}")
    with open(os.path.join(out, "report.json")) as f:
        return json.load(f), out


def stop(process):
    """A graceful stop, then a forced one: Node and anything it started (its own session)."""
    for sig, wait in ((signal.SIGTERM, STOP_WAIT), (signal.SIGKILL, STOP_WAIT)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(wait)
            return
        except subprocess.TimeoutExpired:
            continue


def replace_model(task, out):
    """
    The task's GLB, OBJ and MTL replaced by those made: each written beside its place, then renamed in place. The
    textures made (fills', clones') go in first, so the new MTL never names a texture not there, and those not made
    go once nothing names them.
    """
    folder = texturing_dir(task)
    made = {GLB: "model.glb", OBJ: "model.obj", MTL: "model.mtl"}
    textures = [name for name in TEXTURES if os.path.exists(os.path.join(out, name))]
    for name in textures:
        shutil.move(os.path.join(out, name), os.path.join(folder, name) + training.NEW)
        os.replace(os.path.join(folder, name) + training.NEW, os.path.join(folder, name))
    try:
        for name, source in made.items():
            shutil.move(os.path.join(out, source), os.path.join(folder, name) + training.NEW)
        for name in FILES:
            os.replace(os.path.join(folder, name) + training.NEW, os.path.join(folder, name))
    finally:
        for name in FILES:
            try:
                os.remove(os.path.join(folder, name) + training.NEW)
            except FileNotFoundError:
                pass
    remove_textures(task, keep=textures)


def restore_model(task):
    """The task's original model files put back (no edits): copied beside, then renamed in place."""
    folder = texturing_dir(task)
    for name in FILES:
        shutil.copyfile(os.path.join(model_dir(task), name), os.path.join(folder, name) + training.NEW)
    for name in FILES:
        os.replace(os.path.join(folder, name) + training.NEW, os.path.join(folder, name))
    remove_textures(task)


def remove_textures(task, keep=()):
    """The textures an update made, but those in keep, removed from the model's folder."""
    for name in TEXTURES:
        if name in keep:
            continue
        try:
            os.remove(os.path.join(texturing_dir(task), name))
        except FileNotFoundError:
            pass


def apply(task_id, run):
    record = edits.store().get_json(training.apply_key(task_id, KIND), None)
    if not record or record.get("run") != run:
        return
    folder = training.apply_dir(task_id, kind=KIND)
    work = training.apply_dir(task_id, run, kind=KIND)
    try:
        report(task_id, run, waiting=None)  # it started: losing it from here on fails it
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            if name != run:  # an earlier run's, whose worker was killed
                shutil.rmtree(os.path.join(folder, name), ignore_errors=True)
        with training.Heartbeat(task_id, run, lambda t, r: report(t, r)):
            os.makedirs(work, exist_ok=True)
            task = Task.objects.get(pk=task_id)
            reason = editable(task)
            if reason:
                raise ModelError(reason)
            found, made_with = get_with_fingerprint(task)
            if found:
                report(task_id, run, status="Making the model")
                result, out = make_model(task_id, run, task, found, work)
                check(task_id, run)  # canceled, or no longer this run's: the model stays
                keep_originals(task)
                replace_model(task, out)
            else:
                result = {"removed": 0, "flattened": 0, "moved": 0, "filled": 0, "added": 0, "cloned": 0, "triangles": None}
                if kept(task):
                    restore_model(task)
            drop_cached_models(task)
            edits.store().set_json(shown_key(task_id), {"edits": made_with})
            task.update_size(commit=True)
        report(task_id, run, state="completed", status="", finished=time.time(), removed=result.get("removed"),
               flattened=result.get("flattened"), moved=result.get("moved"), cloned=result.get("cloned"), filled=result.get("filled"), added=result.get("added"),
               triangles=result.get("triangles"))  # fmt: skip
    except training.Superseded:
        pass
    except (ModelError, training.TrainingError, edits.EditsError, ValueError, OSError, Task.DoesNotExist) as e:
        logger.warning(f"SplatMe: updating task {task_id}'s model failed: {e}")
        training.finish_apply(task_id, run, str(e), KIND)
    except Exception as e:
        logger.exception(f"SplatMe: updating task {task_id}'s model failed")
        training.finish_apply(task_id, run, f"Unexpected error: {e}", KIND)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            os.rmdir(folder)
        except OSError:
            pass
