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
    floating {"type": "floating", "size": n}: the pieces of surface of fewer than n triangles, all but the largest
    holes    {"type": "holes", "size": n}: Fill Holes, every hole of at most n edges filled

A fill's triangles have a texture of their own, made from the colours around each hole: FILL_TEXTURE beside the
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
SHAPES = ("box", "polygon", "lasso", "brush")
OPS = ("delete", "flatten", "fill", "object")
MODEL_DIR = "model"  # in the task's data/splatme: the textured model's original files
FILES = ("odm_textured_model_geo.glb", "odm_textured_model_geo.obj", "odm_textured_model_geo.mtl")
GLB, OBJ, MTL = FILES
FILL_TEXTURE = "odm_textured_model_geo_splatme_fill_map_Kd.png"  # as meshApply.mjs's
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
        op = edit.get("op")
        if op not in OPS or edit.get("type") not in SHAPES:
            raise edits.EditsError(f"Edit {i} is of an unknown kind.")
        shape = {k: v for k, v in edit.items() if k != "op"}
        try:
            (clean_shape,) = edits.clean([shape])
        except edits.EditsError as e:
            raise edits.EditsError(str(e).replace("Edit 1", f"Edit {i}", 1)) from None
        out.append({"op": op, **clean_shape})
    return out


def shift(given, dx, dy):
    """The edits moved by dx, dy: the shapes as edits.shift moves them, the rest as they are."""
    out = []
    for edit in given:
        if "op" in edit:
            shape = {k: v for k, v in edit.items() if k != "op"}
            (moved,) = edits.shift([shape], dx, dy)
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
        "started": now, "updated": now, "finished": None, "removed": None, "flattened": None, "filled": None, "added": None,
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
    fills' texture goes in first, so the new MTL never names a texture not there, and goes once nothing names it.
    """
    folder = texturing_dir(task)
    made = {GLB: "model.glb", OBJ: "model.obj", MTL: "model.mtl"}
    texture = os.path.join(out, FILL_TEXTURE)
    if os.path.exists(texture):
        shutil.move(texture, os.path.join(folder, FILL_TEXTURE) + training.NEW)
        os.replace(os.path.join(folder, FILL_TEXTURE) + training.NEW, os.path.join(folder, FILL_TEXTURE))
    else:
        texture = None
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
    if texture is None:
        remove_fill_texture(task)


def restore_model(task):
    """The task's original model files put back (no edits): copied beside, then renamed in place."""
    folder = texturing_dir(task)
    for name in FILES:
        shutil.copyfile(os.path.join(model_dir(task), name), os.path.join(folder, name) + training.NEW)
    for name in FILES:
        os.replace(os.path.join(folder, name) + training.NEW, os.path.join(folder, name))
    remove_fill_texture(task)


def remove_fill_texture(task):
    try:
        os.remove(os.path.join(texturing_dir(task), FILL_TEXTURE))
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
                result = {"removed": 0, "flattened": 0, "filled": 0, "added": 0, "triangles": None}
                if kept(task):
                    restore_model(task)
            drop_cached_models(task)
            edits.store().set_json(shown_key(task_id), {"edits": made_with})
            task.update_size(commit=True)
        report(task_id, run, state="completed", status="", finished=time.time(), removed=result.get("removed"),
               flattened=result.get("flattened"), filled=result.get("filled"), added=result.get("added"),
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
