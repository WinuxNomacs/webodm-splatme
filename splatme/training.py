"""
Training a task's splats: export the task's training data with WebODM's own export, send it to the splat node,
wait for the model and put it in the task as WebODM's own splats asset.

A task's job is one record in the plugin's global data store, the only place state is kept: an update of the
plugin replaces its folder, and a restart of the worker ends the job that was following the node. Each job in
the worker has a run id; a job whose run id is no longer the record's stops. A record nobody has touched for
STALE seconds has lost its worker, and is given a new run that picks up from the node's job.
"""
import json
import logging
import math
import os
import shutil
import threading
import time
import uuid

from app import splats
from app.models import Plugin, PluginDatum, Task
from app.plugins.data_store import GlobalDataStore
from app.plugins.functions import get_plugins_persistent_path
from app.plugins.worker import run_function_async
from django.core.exceptions import ValidationError
from django.db import DatabaseError, connection, transaction
from nodeodm import status_codes

from .node import Node, NodeError

logger = logging.getLogger("app.logger")

# The plugin's folder name, which WebODM uses as its name: "splatme"
NAME = __name__.split(".")[-2]
PACKAGE = __name__.rsplit(".", 1)[0]

ACTIVE = ("starting", "exporting", "uploading", "queued", "training", "importing")
STALE = 60  # seconds without a sign of the worker's job before another takes over
BEAT = 10  # seconds between the signs
POLL = 2  # seconds between questions to the node
NODE_PATIENCE = 300  # seconds a node may not answer mid-training (it is being updated) before the job fails

# What a job trains with when the request does not say; the node's ranges apply to all but image_size
DEFAULTS = {"steps": 7000, "image_size": 1600}
NODE_OPTIONS = ("steps", "max_gaussians", "sh_degree")
REQUIRED_ASSETS = ("cameras.json", "shots.geojson", "georeferenced_model.laz")


class TrainingError(Exception):
    """A reason training cannot start or go on, worded for the user."""


class Superseded(Exception):
    """This worker job is no longer the task's job: another run took over, or the record is gone."""


class Canceled(Exception):
    pass


# Settings


def store():
    return GlobalDataStore(NAME)


def get_node():
    return Node(store().get_string("node_url"), store().get_string("node_token"))


def set_node(url, token=None):
    store().set_string("node_url", (url or "").strip())
    if token is not None:
        store().set_string("node_token", token)


# Training automatically: a task's own setting, or the administrators' default for every task without one


def auto_key(task_id):
    return f"auto::{task_id}"


def clean_options(given):
    """A setting's options, checked against the node's ranges when the node answers (a training checks again)."""
    try:
        info = get_node().check()
    except NodeError:
        info = None
    return parse_options(given, info)


def get_default():
    return store().get_json("auto_default", None) or {"enabled": False, "options": dict(DEFAULTS)}


def set_default(enabled, given):
    store().set_json("auto_default", {"enabled": bool(enabled), "options": clean_options(given)})


def get_auto(task_id):
    """Whether the task is trained when it completes, and with what: "own" says the setting is the task's."""
    own = store().get_json(auto_key(task_id), None)
    return dict(own or get_default(), own=own is not None)


def set_auto(task_id, username, enabled, given):
    setting = {"enabled": bool(enabled), "options": clean_options(given), "user": username}
    store().set_json(auto_key(task_id), setting)


def reset_auto(task_id):
    store().del_key(auto_key(task_id))


def listening():
    # Only this function's source reaches the worker (run_function_async)
    from app.plugins import signals

    return any(entry[0][0] == "splatme_task_completed" for entry in signals.task_completed.receivers)


def worker_listens():
    """
    Whether WebODM's worker tells this plugin when a task completes, or None when the worker does not answer.
    The worker imports plugins when it starts: one installed since then is heard only after WebODM restarts.
    """
    try:
        return bool(run_function_async(listening).get(timeout=5))
    except Exception as e:  # noqa: BLE001 (a busy worker, a broker that is away: all mean "not known")
        logger.warning(f"SplatMe: the worker did not say whether it listens for completed tasks: {e}")
        return None


# The job's record


def job_key(task_id):
    return f"job::{task_id}"


def cancel_key(task_id):
    return f"cancel::{task_id}"


def get_job(task_id):
    return store().get_json(job_key(task_id), None)


def change_job(task_id, change):
    """Applies change(job) to the task's record under a row lock and answers the record, or None without one."""
    with transaction.atomic():
        key = store().db_key(job_key(task_id))
        datum = PluginDatum.objects.select_for_update().filter(key=key, user=None).first()
        if datum is None or datum.json_value is None:
            return None
        job = datum.json_value
        change(job)
        datum.json_value = job
        datum.save()
        return job


def update(task_id, run, **fields):
    """A worker job's report. Raises Superseded when the record is no longer this run's."""

    def change(job):
        if job.get("run") != run:
            raise Superseded()
        job.update(fields, updated=time.time())

    if change_job(task_id, change) is None:
        raise Superseded()


def cancel_requested(task_id):
    return store().get_bool(cancel_key(task_id))


def forget(task_id):
    store().del_key(job_key(task_id))
    store().del_key(cancel_key(task_id))


def work_dir(task_id, run=None):
    parts = ("jobs", str(task_id)) + ((run,) if run else ())
    return get_plugins_persistent_path(NAME, *parts)


# Starting, canceling, following


def problem(task):
    """Why this task cannot be trained, or None."""
    if task.status != status_codes.COMPLETED:
        return "The task has not completed processing."
    for asset in REQUIRED_ASSETS:
        if asset not in task.available_assets:
            return f"The task has no {asset}. Process it again with a point cloud."
    if task.compacted:
        return "The task was compacted: its images are gone, and training needs them."
    try:
        shots = splats.load_scene(task, 0)[1]
    except (ValueError, OSError, KeyError) as e:
        return f"The task's camera results cannot be read: {e}"
    names = [shot["filename"] for shot in shots]
    other = [name for name in names if os.path.splitext(name)[1].lower() not in (".jpg", ".jpeg")]
    if other:
        return f"Only JPEG images can be trained on, and {other[0]} is not one."
    if not any(os.path.isfile(task.task_path(name)) for name in names):
        return "The task's images are gone, and training needs them."
    return None


def mostly_nadir(task):
    """Whether nearly all the photos point straight down, judged as WebODM's own Splats dialog does."""
    try:
        with open(task.assets_path(task.ASSETS_MAP["shots.geojson"])) as f:
            features = json.load(f).get("features", [])
    except (OSError, ValueError):
        return False
    total = nadir = 0
    for feature in features:
        try:
            rx, ry, rz = (float(v) for v in feature["properties"]["rotation"])
        except (KeyError, TypeError, ValueError):
            continue
        theta = math.sqrt(rx * rx + ry * ry + rz * rz)
        view_z = 1.0 if theta < 1e-12 else math.cos(theta) + (rz / theta) ** 2 * (1.0 - math.cos(theta))
        total += 1
        nadir += view_z <= -0.978  # within about 12 degrees of straight down
    return total > 0 and nadir / total > 0.98


def warnings(task):
    """What will limit the result of a task that can be trained."""
    if mostly_nadir(task):
        return [
            "Most images in this dataset are nadir. Splats typically require obliques and/or orbits for good results."
        ]
    return []


def parse_options(given, node_info):
    """
    The job's options from a request's values, checked against the ranges the node gives. Without a node's answer
    (None) only the values' form is checked.
    """
    options = dict(DEFAULTS)
    if node_info is None:
        ranges = {name: {"min": 1, "max": 10**9} for name in NODE_OPTIONS}
    else:
        ranges = dict(node_info.get("options", {}))
    ranges["image_size"] = {"min": 16, "max": 100000}
    for name in (*NODE_OPTIONS, "image_size"):
        value = given.get(name)
        if value in (None, ""):
            continue
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise TrainingError(f"{name} must be a whole number.") from None
        if name == "image_size" and value == 0:
            options[name] = 0  # the images as they are
            continue
        limits = ranges.get(name)
        if limits is None:
            raise TrainingError(f"The splat node has no option {name}. Update the node.")
        if not limits["min"] <= value <= limits["max"]:
            raise TrainingError("{} must be between {} and {}.".format(name, limits["min"], limits["max"]))
        options[name] = value
    return options


def is_stale(job):
    return job["state"] in ACTIVE and time.time() - job.get("updated", 0) > STALE


def start(task, username, given, auto=False):
    """Starts training a task. Raises TrainingError or NodeError with the reason it cannot."""
    reason = problem(task)
    if reason:
        raise TrainingError(reason)
    options = parse_options(given, get_node().check())
    sweep()

    current = get_job(task.id)
    if current and current["state"] in ACTIVE and not is_stale(current):
        raise TrainingError("This task's splats are already being trained.")

    run = uuid.uuid4().hex
    now = time.time()
    job = {
        "state": "starting", "run": run, "options": options, "user": username, "auto": auto, "progress": 0,
        "status": "", "node_job": None, "error": None, "started": now, "updated": now, "finished": None,
    }  # fmt: skip
    store().del_key(cancel_key(task.id))
    store().set_json(job_key(task.id), job)
    run_function_async(run_job, PACKAGE, str(task.id), run)
    return get_job(task.id)


def completed(task_id):
    """
    A task completed processing (WebODM's task_completed signal, in the worker): trains it when its setting says
    so. A training that cannot start is left in the task's record, where the task's panel shows it; a task that
    cannot be trained at all is passed over, unless the setting is the task's own.
    """
    if not Plugin.objects.filter(name=NAME, enabled=True).exists():
        return  # WebODM imports a disabled plugin's module too
    task = Task.objects.filter(pk=task_id).first()
    if task is None or "splats.rad" in task.available_assets:
        return  # an imported task comes with its model
    auto = get_auto(task.id)
    if not auto["enabled"]:
        return
    reason = problem(task)
    if reason and not auto["own"]:
        return
    try:
        if reason:
            raise TrainingError(reason)
        start(task, auto.get("user") or "", auto["options"], auto=True)
    except (TrainingError, NodeError) as e:
        current = get_job(task.id)
        if current and current["state"] in ACTIVE and not is_stale(current):
            return
        now = time.time()
        job = {
            "state": "failed", "run": None, "options": auto["options"], "user": auto.get("user") or "", "auto": True,
            "progress": 0, "status": "", "node_job": None, "error": f"The training did not start. {e}",
            "started": now, "updated": now, "finished": now,
        }  # fmt: skip
        store().set_json(job_key(task.id), job)
        logger.warning(f"SplatMe: task {task.id} completed and its training did not start: {e}")


def cancel(task):
    """Asks the task's job to stop. A job without a worker is stopped here."""
    job = get_job(task.id)
    if not job or job["state"] not in ACTIVE:
        return job
    store().set_bool(cancel_key(task.id), True)
    if is_stale(job):
        drop_node_job(job)
        change_job(task.id, lambda j: j.update(state="canceled", run=None, finished=time.time()))
        shutil.rmtree(work_dir(task.id), ignore_errors=True)
    return get_job(task.id)


def follow(task):
    """The task's record, for a status request. A job that lost its worker gets a new one first."""
    job = get_job(task.id)
    if not job or not is_stale(job):
        return job
    if cancel_requested(task.id):
        return cancel(task)

    run = uuid.uuid4().hex

    def take_over(j):
        if is_stale(j):
            j.update(run=run, updated=time.time())

    job = change_job(task.id, take_over)
    if job and job.get("run") == run:
        logger.info(f"SplatMe: the job of task {task.id} lost its worker, starting another")
        run_function_async(run_job, PACKAGE, str(task.id), run)
    return job


def removed(task_id):
    """The task is being deleted: its job stops and its record goes."""
    job = get_job(task_id)
    if job and job["state"] in ACTIVE:
        drop_node_job(job)
    forget(task_id)
    reset_auto(task_id)
    shutil.rmtree(work_dir(task_id), ignore_errors=True)


def sweep():
    """
    Forgets the jobs and settings of tasks that no longer exist. WebODM's worker imports plugins only when it
    starts, so until WebODM restarts after this plugin is installed, a task the worker deletes sends this plugin
    no signal.
    """
    for prefix in (store().db_key(job_key("")), store().db_key(auto_key(""))):
        for key in PluginDatum.objects.filter(key__startswith=prefix, user=None).values_list("key", flat=True):
            task_id = key[len(prefix) :]
            try:
                gone = not Task.objects.filter(pk=task_id).exists()
            except (ValueError, ValidationError):
                gone = True
            if gone:
                removed(task_id)


def drop_node_job(job):
    if job.get("node_job"):
        try:
            get_node().delete(job["node_job"])
        except NodeError as e:
            logger.warning(f"SplatMe: could not delete the node's job {job['node_job']}: {e}")


# The worker's job


def run_job(package, task_id, run):
    # Only this function's source reaches the worker (run_function_async): the rest is imported there
    import importlib

    importlib.import_module(package + ".training").run(task_id, run)


class Heartbeat:
    """Touches the record while a worker job is alive, also through steps that report nothing."""

    def __init__(self, task_id, run):
        self.task_id, self.run = task_id, run
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.beat, daemon=True)

    def beat(self):
        try:
            while not self.stopped.wait(BEAT):
                try:
                    update(self.task_id, self.run)
                except Superseded:
                    return
                except DatabaseError as e:
                    logger.warning(f"SplatMe: heartbeat: {e}")
        finally:
            connection.close()

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stopped.set()
        self.thread.join(BEAT)


def run(task_id, run):
    work = work_dir(task_id, run)
    job = get_job(task_id)
    if not job or job.get("run") != run:
        return
    node = get_node()
    node_job = job.get("node_job")
    try:
        with Heartbeat(task_id, run):
            # Folders of this task's earlier runs: their jobs are gone or will stop at their next report
            shutil.rmtree(work_dir(task_id), ignore_errors=True)
            os.makedirs(work)
            if not node_job:
                node_job = export_and_send(task_id, run, node, job["options"], work)
            wait_for_node(task_id, run, node, node_job)
            import_model(task_id, run, node, node_job, work)
            update(task_id, run, state="completed", progress=100, status="", finished=time.time())
    except Superseded:
        if get_job(task_id) is None and node_job:
            drop_node_job({"node_job": node_job})  # the task was deleted
    except Canceled:
        drop_node_job({"node_job": node_job})
        finish(task_id, run, "canceled")
        if not Task.objects.filter(pk=task_id).exists():
            forget(task_id)
    except (TrainingError, NodeError, ValueError, OSError) as e:
        # WebODM's export raises ValueError and FileNotFoundError with a message that names the problem
        logger.warning(f"SplatMe: training task {task_id} failed: {e}")
        finish(task_id, run, "failed", str(e))
    except Exception as e:
        logger.exception(f"SplatMe: training task {task_id} failed")
        finish(task_id, run, "failed", f"Unexpected error: {e}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            os.rmdir(work_dir(task_id))  # unless another run of this task has its folder there
        except OSError:
            pass


def finish(task_id, run, state, error=None):
    try:
        update(task_id, run, state=state, error=error, status="", finished=time.time())
    except Superseded:
        pass


def check_cancel(task_id):
    # A deleted task stops its job as a cancel does: the worker that deletes it tells no plugin
    if cancel_requested(task_id) or not Task.objects.filter(pk=task_id).exists():
        raise Canceled()


def export_and_send(task_id, run, node, options, work):
    task = Task.objects.get(pk=task_id)
    export_dir = os.path.join(work, "export")
    os.makedirs(export_dir)

    def exporting(status, perc):
        check_cancel(task_id)
        update(task_id, run, state="exporting", status=str(status), progress=int(perc))

    update(task_id, run, state="exporting", status="", progress=0)
    splats.prepare_export(task, export_dir, image_size=options.get("image_size", 0), progress_callback=exporting)
    check_cancel(task_id)

    update(task_id, run, state="uploading", status="", progress=0)
    archive = splats.export_zip(export_dir)
    total = len(archive)

    def body():
        sent, last = 0, time.time()
        for chunk in archive:
            sent += len(chunk)
            if time.time() - last >= POLL:
                last = time.time()
                check_cancel(task_id)
                update(task_id, run, progress=int(sent * 100 / total))
            yield chunk

    node_options = {name: options[name] for name in NODE_OPTIONS if options.get(name) is not None}
    node_job = node.create_job(body(), total, node_options)["id"]
    try:
        update(task_id, run, state="queued", node_job=node_job, status="", progress=0)
    except Superseded:
        drop_node_job({"node_job": node_job})
        raise
    shutil.rmtree(export_dir, ignore_errors=True)
    return node_job


def wait_for_node(task_id, run, node, node_job):
    silent_since = None
    while True:
        check_cancel(task_id)
        try:
            remote = node.job(node_job)
            silent_since = None
        except NodeError as e:
            if e.status == 404:
                raise TrainingError(
                    "The splat node no longer has this job (the node lost its data, or the job expired). "
                    "Start the training again."
                ) from e
            if e.status is not None:
                raise
            silent_since = silent_since or time.time()
            if time.time() - silent_since > NODE_PATIENCE:
                raise
            update(task_id, run, status="Waiting for the splat node to answer")
            time.sleep(POLL)
            continue

        state = remote["state"]
        if state == "completed":
            return
        if state == "failed":
            raise TrainingError(remote.get("error") or "The training failed. See the log.")
        if state == "canceled":
            raise Canceled()
        if state == "queued":
            status = "Position {} in the node's queue".format(remote.get("position") or 1)
            update(task_id, run, state="queued", progress=0, status=status)
        else:
            status = "Step {} of {}".format(remote.get("step", 0), remote.get("options", {}).get("steps", "?"))
            update(task_id, run, state="training", progress=remote.get("progress", 0), status=status)
        time.sleep(POLL)


def import_model(task_id, run, node, node_job, work):
    update(task_id, run, state="importing", status="", progress=0)
    model = os.path.join(work, "model.rad")
    node.result(node_job, model)
    if os.path.getsize(model) == 0:
        raise TrainingError("The splat node sent an empty model.")

    # As WebODM's own import does (worker/tasks.py, process_splats); the model replaces the task's only now
    task = Task.objects.get(pk=task_id)
    if task.status != status_codes.COMPLETED or "georeferenced_model.laz" not in task.available_assets:
        raise TrainingError("The task was processed again while its splats trained. Start the training again.")
    dest = task.get_asset_file_or_stream("splats.rad")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(model, dest)
    task.refresh_from_db()
    task.update_available_assets_field()
    task.update_size()
    task.save()
