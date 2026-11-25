"""
Training a task's splats: export the task's training data with WebODM's own export, send it to the splat node,
wait for the model and put it in the task as WebODM's own splats asset. The model as the trainer wrote it is
kept in the task's data folder, so that a later training can continue from it and its edits can be applied.

A task's job is one record in the plugin's global data store, the only place state is kept: an update of the
plugin replaces its folder, and a restart of the worker ends the job that was following the node. Each job in
the worker has a run id; a job whose run id is no longer the record's stops. A record nobody has touched for
STALE seconds has lost its worker, and is given a new run that picks up from the node's job.

A job's own worker job exports the task and sends it to the node, then ends. While the node has it, one worker job
for all the trainings, the follower (follow_node), follows them; when one is trained, a worker job of its own
imports the model. So the trainings waiting in the node's queue take one place in WebODM's worker, not one each.
"""
import fcntl
import io
import json
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

import numpy as np
from app import splats
from app.models import Plugin, PluginDatum, Task
from app.plugins.data_store import GlobalDataStore, UserDataStore
from app.plugins.functions import get_plugins_persistent_path
from app.plugins.worker import run_function_async
from django.core.exceptions import ValidationError
from django.db import connection, transaction
from nodeodm import status_codes
from PIL import Image

from . import crop, edits, sky, thermal
from .node import Node, NodeError

logger = logging.getLogger("app.logger")

# The plugin's folder name, which WebODM uses as its name: "splatme"
NAME = __name__.split(".")[-2]
PACKAGE = __name__.rsplit(".", 1)[0]

ACTIVE = ("starting", "drawing", "exporting", "masking", "uploading", "queued", "training", "importing")
STALE = 60  # seconds without a sign of the worker's job before another takes over
BEAT = 10  # seconds between the signs
POLL = 2  # seconds between questions to the node
NODE_PATIENCE = 3600  # seconds a node may not answer mid-training (updated, the network down) before the job fails
RESULT_TRIES = 5  # downloads of a trained model before the training fails (the node keeps it for days)
FOLLOWER_ERRORS = 30  # errors of its own in a row (BEAT seconds apart) before the follower ends, for revive to start anew
REVIVE_EVERY = 30  # seconds between looks for jobs that lost their worker, from WebODM's events and pages
TAKEOVERS = 3  # times a job's export or import may lose its worker (killed: memory) before the job fails
CONVERT_TIMEOUT = 3600  # seconds splat-tools may take to convert a trained model
# The states in which the node has a job, followed by the follower rather than by the job's own worker job
HANDED = ("queued", "training")
FOLLOWER = "follower"
# The time the steps left take, from the rate of the last few minutes (OpenSplat's steps slow down as the model
# grows: a rate from the start would promise too little), once there are enough steps to tell
ESTIMATE_WINDOW = 180
ESTIMATE_AFTER = 30
ESTIMATE_STEPS = 20

# What a job trains with when the request does not say; the node's ranges apply to all but image_size
DEFAULTS = {"steps": 30000, "image_size": 1600}
NODE_OPTIONS = ("steps", "max_gaussians", "sh_degree", "densify_until", "strategy", "exposure_correction")
# The options that are not whole numbers (a node's /info describes each: "choices", or "type": "bool"), for checking
# them when the node does not answer
CHOICE_OPTIONS = ("strategy",)
ONOFF_OPTIONS = ("exposure_correction",)
# A choice's form when the node does not answer to give its choices
CHOICE = re.compile(r"[a-z0-9+_-]{1,32}")
# Grow Until (densify_until): the steps a training goes on for after the model stops growing (the node's own rule)
AFTER_GROWING = 3000
# and the steps a continued training grows for at least, after the model's
GROW_AT_LEAST = 1000
REQUIRED_ASSETS = ("cameras.json", "shots.geojson", "georeferenced_model.laz")
# The model as the trainer wrote it: what a training continues from and the edits cut. In the task's data folder,
# not with its assets, which WebODM serves to anyone who may see the task (a public task's share links, Download
# Assets): uncut, it has what Crop to Boundary and the edits remove. WebODM's backups and Duplicate still copy it.
# A training of SplatMe 0.2 kept it in the splats folder: it is moved the first time it is looked for.
TRAINED_DIR = "splatme"
TRAINED_MODEL = "splatme-model.ply"
# Beside it, the options it was trained with: what continuing it trains with
TRAINED_OPTIONS = "splatme-model.json"
# The node takes it in the training zip under this name
RESUME_NAME = "resume.ply"
# A model's steps in its header, for a model whose options don't say them (SplatMe 0.1): OpenSplat's comment, and
# LichtFeld Studio's provenance comment (JSON with "iteration")
TRAINED_STEPS = re.compile(rb"^comment Generated by opensplat at iteration (\d+)\s*$", re.MULTILINE)
LICHTFELD_STEPS = re.compile(rb'^comment lichtfeld_provenance .*?"iteration":\s*(\d+)', re.MULTILINE)
# The trainers a node may run (its /info's trainer_kind); a node before 0.3.0 says none, and runs OpenSplat with masks
# and continuing
TRAINER_LABELS = {"opensplat": "OpenSplat", "lichtfeld": "LichtFeld Studio"}
DEFAULT_KIND = "opensplat"
DEFAULT_SUPPORTS = {"masks": True, "continue": True}
# Kept with the trained options: which trainer made the model (a model without it is OpenSplat's)
TRAINER = "_trainer"
# The options as the pages name them, for the note on options a node does not have
OPTION_LABELS = {"max_gaussians": "Max Gaussians", "sh_degree": "SH Degree", "densify_until": "Grow Until",
                 "strategy": "Strategy", "exposure_correction": "Exposure Correction", "ignore_sky": "Ignore Sky"}


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


# Training automatically: a task's own setting, chosen in SplatMe's panel above WebODM's New Task panel (opened
# with New Task With Splats, starting from the options the administrators chose) or Edit Task panel. A task
# without one is not trained by itself.


def auto_key(task_id):
    return f"auto::{task_id}"


def clean_options(given):
    """A setting's options, checked against the node's ranges when the node answers (a training checks again)."""
    try:
        info = get_node().check()
    except NodeError:
        info = None
    return parse_options(given, info)


def node_ranges():
    """The node's range of each option, or None when the node does not answer."""
    try:
        info = get_node().check()
    except NodeError:
        return None
    return node_view(info)["ranges"]


def node_trainer():
    """node_view of the node, or None when it does not answer."""
    try:
        return node_view(get_node().check())
    except NodeError:
        return None


def shared_options():
    """The administrators' New Task With Splats options: what a user who saved none of their own starts with."""
    return (store().get_json("auto_default", None) or {}).get("options") or dict(DEFAULTS)


def set_shared_options(given):
    store().set_json("auto_default", {"options": clean_options(given)})


def own_options(user):
    """The New Task With Splats options the user saved, or None."""
    return (UserDataStore(NAME, user).get_json("new_task", None) or {}).get("options")


def set_own_options(user, given):
    UserDataStore(NAME, user).set_json("new_task", {"options": clean_options(given)})


def reset_own_options(user):
    UserDataStore(NAME, user).del_key("new_task")


def new_task_options(user=None):
    """The options SplatMe's panel starts with for a new task: the user's own, else the administrators'."""
    known = user is not None and user.is_authenticated  # a public task's viewer may have no account
    return (own_options(user) if known else None) or shared_options()


def get_auto(task_id, user=None):
    """Whether the task is trained when it completes, and with what: off for a task without a setting, with the
    options the user's panel would start with."""
    return store().get_json(auto_key(task_id), None) or {"enabled": False, "options": new_task_options(user)}


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


# A worker that listens keeps listening until it restarts, and then listens again: that is remembered longer
LISTENS_TRUSTED = 600
LISTENS_RECHECK = 60


def listens(fresh=False):
    """worker_listens(), remembered for a while: the task's panel asks for it every few seconds."""
    now = time.time()
    known = store().get_json("listens", None)
    if not fresh and known and now - known["at"] < (LISTENS_TRUSTED if known["value"] else LISTENS_RECHECK):
        return known["value"]
    value = worker_listens()
    store().set_json("listens", {"value": value, "at": now})
    return value


# The job's record


def job_key(task_id):
    return f"job::{task_id}"


def cancel_key(task_id):
    return f"cancel::{task_id}"


def get_job(task_id):
    return store().get_json(job_key(task_id), None)


def change_record(key, change):
    """Applies change(value) to a JSON value of the store under a row lock and answers it, or None without one."""
    with transaction.atomic():
        datum = PluginDatum.objects.select_for_update().filter(key=store().db_key(key), user=None).first()
        if datum is None or datum.json_value is None:
            return None
        value = datum.json_value
        change(value)
        datum.json_value = value
        datum.save()
        return value


def change_job(task_id, change):
    """Applies change(job) to the task's record under a row lock and answers the record, or None without one."""
    return change_record(job_key(task_id), change)


def enter_state(job, state, now=None):
    """
    The time the job spent in its state so far added to its times (seconds by state: the summary gives the
    training's apart from the rest), when it moves to another.
    """
    if job.get("state") == state:
        return
    now = time.time() if now is None else now
    since = job.get("since") or job.get("started") or now
    times = dict(job.get("times") or {})
    times[job["state"]] = round(times.get(job["state"], 0) + max(0.0, now - since), 1)
    job.update(times=times, since=now)


def update(task_id, run, **fields):
    """A worker job's report. Raises Superseded when the record is no longer this run's."""

    def change(job):
        if job.get("run") != run:
            raise Superseded()
        now = time.time()
        if "state" in fields:
            enter_state(job, fields["state"], now)
        job.update(fields, updated=now)

    if change_job(task_id, change) is None:
        raise Superseded()


def cancel_requested(task_id):
    return store().get_bool(cancel_key(task_id))


def forget(task_id):
    store().del_key(job_key(task_id))
    store().del_key(cancel_key(task_id))


def lock_records():
    """
    Inside a transaction: waits for, and holds until it ends, the lock under which SplatMe's records are created.
    WebODM's data store has no unique key: two requests creating the same record at once make two rows, which it
    then deletes both of. The lock is on SplatMe's own Plugin row, the one row that always exists.
    """
    Plugin.objects.select_for_update().filter(name=NAME).first()


def work_dir(task_id, run=None):
    parts = ("jobs", str(task_id)) + ((run,) if run else ())
    return get_plugins_persistent_path(NAME, *parts)


# Starting, canceling, following


def problem(task):
    """Why this task cannot be trained, or None."""
    if task.status != status_codes.COMPLETED:
        return "The task has not completed processing."
    reason = results_problem(task)
    if reason:
        return reason
    try:
        shots = splats.load_scene(task, 0)[1]
    except (ValueError, OSError, KeyError) as e:
        return f"The task's camera results cannot be read: {e}"
    names = [shot["filename"] for shot in shots]
    other = [name for name in names if os.path.splitext(name)[1].lower() not in (".jpg", ".jpeg")]
    if other and not thermal.is_thermal(task):
        return f"Only JPEG images and DJI Thermal Analyzer's TIFFs can be trained on, and {other[0]} is neither."
    if not any(os.path.isfile(task.task_path(name)) for name in names):
        return "The task's images are gone, and training needs them."
    return None


# Image files a task may have that are not JPEG: such a task cannot be trained (WebODM's export takes JPEG only),
# unless its TIFFs are DJI Thermal Analyzer's (thermal.py)
OTHER_IMAGES = (".tif", ".tiff", ".png", ".dng", ".nef", ".raw", ".webp", ".bmp", ".gif")


def results_problem(task):
    """Why a completed task's results cannot be trained on (its assets, its images kept), or None."""
    for asset in REQUIRED_ASSETS:
        if asset not in task.available_assets:
            return f"The task has no {asset}. Process it again with a point cloud."
    if task.compacted:
        return "The task was compacted: its images are gone, and training needs them."
    return None


def unlisted(task):
    """
    Why SplatMe's Tasks page does not list the task, or None when it does: it has splats, or its photos are JPEG (or
    DJI Thermal Analyzer's TIFFs) and, once completed, it can train. Cheaper than problem() (its files and assets,
    not its cameras), for every task of a list.
    """
    if "splats.rad" in task.available_assets:
        return None
    images = thermal.photo_names(task.scan_images())
    names = [os.path.splitext(name)[1].lower() for name in images]
    jpeg = any(ext in (".jpg", ".jpeg") for ext in names) and not any(ext in OTHER_IMAGES for ext in names)
    if not jpeg and not thermal.is_thermal(task, images):
        return "SplatMe trains tasks whose photos are JPEG (or DJI Thermal Analyzer's TIFFs)."
    if task.status != status_codes.COMPLETED:
        return None
    return results_problem(task)


def compatible(task):
    """Whether SplatMe's Tasks page lists the task."""
    return unlisted(task) is None


def trained_dir(task):
    return task.data_path(TRAINED_DIR)


THUMBNAIL = "thumbnail.jpg"  # a picture of the model, from Edit Splats' view, for its row on SplatMe → Tasks
THUMBNAIL_BYTES = 200 * 1024
THUMBNAIL_PIXELS = 1024  # at most, each side


def thumbnail_file(task):
    return os.path.join(trained_dir(task), THUMBNAIL)


def thumbnail_version(task):
    """When the task's thumbnail was saved (a number that changes with it), or None without one."""
    try:
        return int(os.path.getmtime(thumbnail_file(task)))
    except OSError:
        return None


def save_thumbnail(task, data):
    """Keeps a JPEG of the task's model, after checking it is one. Raises TrainingError with the reason it is not."""
    if not data or len(data) > THUMBNAIL_BYTES:
        raise TrainingError(f"A thumbnail must be a JPEG of at most {THUMBNAIL_BYTES // 1024} kB.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG" or max(image.size) > THUMBNAIL_PIXELS:
                raise TrainingError(f"A thumbnail must be a JPEG of at most {THUMBNAIL_PIXELS} pixels a side.")
            image.verify()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise TrainingError("A thumbnail must be a JPEG.") from None
    path = thumbnail_file(task)
    os.makedirs(trained_dir(task), exist_ok=True)
    with open(path + NEW, "wb") as f:
        f.write(data)
    os.replace(path + NEW, path)


def drop_thumbnail(task):
    try:
        os.remove(thumbnail_file(task))
    except FileNotFoundError:
        pass


def trained_model(task):
    path = os.path.join(trained_dir(task), TRAINED_MODEL)
    if not os.path.exists(path):
        # Kept with the task's assets by SplatMe 0.2: moved, its time kept (see trained_steps)
        old = os.path.dirname(task.get_asset_file_or_stream("splats.rad"))
        for name in (TRAINED_OPTIONS, TRAINED_MODEL):  # the model last: once it is there, nothing is looked for
            try:
                if os.path.exists(os.path.join(old, name)):
                    os.makedirs(trained_dir(task), exist_ok=True)
                    os.replace(os.path.join(old, name), os.path.join(trained_dir(task), name))
            except OSError as e:  # another request moved it first, or the folder cannot be written
                logger.warning(f"SplatMe: could not move task {task.id}'s {name}: {e}")
    return path


def trained_steps(task):
    """
    The steps of the model a training can continue from, or None: the task's splat model must be the one made
    from it (a model uploaded since in WebODM's Splats dialog is newer than it). The options kept with the model say
    them (the steps it was trained to); for a model of SplatMe 0.1, its header.
    """
    model, shown = trained_model(task), task.get_asset_file_or_stream("splats.rad")
    try:
        if os.path.getmtime(shown) > os.path.getmtime(model):
            return None
        steps = (read_trained_options(task) or {}).get("steps")
        if isinstance(steps, int) and not isinstance(steps, bool) and steps > 0:
            return steps
        with open(model, "rb") as f:
            header = f.read(4096)
    except OSError:
        return None
    found = TRAINED_STEPS.search(header) or LICHTFELD_STEPS.search(header)
    return int(found.group(1)) if found else None


def trained_kind(task):
    """The trainer that made the task's trained model, as a node's trainer_kind (OpenSplat's when not kept)."""
    kind = (read_trained_options(task) or {}).get(TRAINER)
    return kind if isinstance(kind, str) and kind else DEFAULT_KIND


def node_kind(info):
    """The trainer a node runs, from its /info."""
    kind = (info or {}).get("trainer_kind")
    return kind if isinstance(kind, str) and kind else DEFAULT_KIND


def node_supports(info):
    """What a node's trainer takes (masks, a model to continue), from its /info."""
    said = (info or {}).get("supports")
    return {**DEFAULT_SUPPORTS, **({k: v for k, v in said.items() if isinstance(v, bool)} if isinstance(said, dict) else {})}


def trainer_label(kind):
    return TRAINER_LABELS.get(kind, kind)


def node_view(info):
    """What the pages need of the node's trainer: its kind, what it supports and the range of each option it has."""
    return {
        "trainer_kind": node_kind(info), "supports": node_supports(info),
        "ranges": {name: info["options"][name] for name in NODE_OPTIONS if name in info.get("options", {})},
    }  # fmt: skip


def trained_options_file(task):
    trained_model(task)  # moved first, if still with the assets
    return os.path.join(trained_dir(task), TRAINED_OPTIONS)


TRAINING_SECONDS = "_training_seconds"  # kept with the options: the model's training time, Continue's included


def read_trained_options(task):
    try:
        with open(trained_options_file(task)) as f:
            options = json.load(f)
    except (OSError, ValueError):
        return None
    return options if isinstance(options, dict) else None


def trained_options(task):
    """The options the task's trained model was trained with, or None (a model trained by SplatMe 0.1)."""
    options = read_trained_options(task)
    if options is None:
        return None
    return {k: v for k, v in options.items() if not k.startswith("_")}  # not what is kept beside them


def trained_seconds(task):
    """The seconds the trainer took to make the task's trained model, all its continuations included, or None."""
    seconds = (read_trained_options(task) or {}).get(TRAINING_SECONDS)
    return seconds if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds >= 0 else None


def reconstruction(task):
    """When the task's point cloud was made: it tells the reconstruction a training started on from a later one."""
    try:
        return os.path.getmtime(task.get_asset_file_or_stream("georeferenced_model.laz"))
    except OSError:
        return None


def outdated(job, task):
    """Whether the job trains on an earlier reconstruction of the task than the one the task has now."""
    made = reconstruction(task)
    if job.get("source") is not None:
        return job["source"] != made
    return made is not None and job.get("started", 0) < made  # a record of SplatMe 0.1, which kept no source


def photo_sizes(task):
    """The sizes of the task's photos as processed, [[width, height]], one per camera (cameras.json, as WebODM's
    export reads it), largest first; [] before the task has them."""
    try:
        with open(task.get_asset_file_or_stream("cameras.json")) as f:
            cameras = json.load(f)
        sizes = {(int(c["width"]), int(c["height"])) for c in cameras.values()}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return []
    return [list(size) for size in sorted(sizes, key=lambda s: (-s[0] * s[1], s))]


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
        ranges.update({name: {"choices": None} for name in CHOICE_OPTIONS})
        ranges.update({name: {"type": "bool"} for name in ONOFF_OPTIONS})
    else:
        ranges = dict(node_info.get("options", {}))
    ranges["image_size"] = {"min": 16, "max": 100000}
    for name in (*NODE_OPTIONS, "image_size"):
        value = given.get(name)
        if value in (None, ""):
            continue
        limits = ranges.get(name)
        if name in ONOFF_OPTIONS:
            if str(value).lower() not in ("true", "false", "1", "0"):
                raise TrainingError(f"{name} must be true or false.")
            if limits is not None:
                options[name] = str(value).lower() in ("true", "1")
            continue
        if name in CHOICE_OPTIONS:
            value = str(value)
            choices = (limits or {}).get("choices")
            if choices is not None and value not in choices:
                raise TrainingError("{} must be one of {}.".format(name, ", ".join(choices)))
            if not CHOICE.fullmatch(value):
                raise TrainingError(f"{name} is not one of the trainer's choices.")
            if limits is not None:
                options[name] = value
            continue
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise TrainingError(f"{name} must be a whole number.") from None
        if name == "image_size" and value == 0:
            options[name] = 0  # the images as they are
            continue
        if limits is None:
            continue  # an option the node's trainer does not have: left out (skipped_options names it)
        if not limits["min"] <= value <= limits["max"]:
            raise TrainingError("{} must be between {} and {}.".format(name, limits["min"], limits["max"]))
        options[name] = value
    grow_until = options.get("densify_until")
    if grow_until is not None and options["steps"] < GROW_AT_LEAST + AFTER_GROWING:
        raise TrainingError(f"densify_until needs steps of {GROW_AT_LEAST + AFTER_GROWING} or more.")
    if grow_until is not None and grow_until > options["steps"] - AFTER_GROWING:
        raise TrainingError(f"densify_until must be at most {options['steps'] - AFTER_GROWING}: "
                            f"{AFTER_GROWING} steps less than the steps.")
    if str(given.get("ignore_sky", "")).lower() in ("true", "1") and node_supports(node_info)["masks"]:
        options["ignore_sky"] = True  # masks made here: the node knows no such option
    if str(given.get("crop", "")).lower() in ("false", "0"):
        options["crop"] = False  # a task with a boundary is cropped to it unless this says not to
    palette = given.get("palette")
    if palette not in (None, "", thermal.DEFAULT_PALETTE):
        if palette not in thermal.palette_keys():
            raise TrainingError("palette must be one of {}.".format(", ".join(thermal.palette_keys())))
        options["palette"] = palette  # a thermal task's colours; kept for any task, as its setting may be reused
    return options


def skipped_options(given, node_info):
    """The options given that the node's trainer does not have, which a training leaves out (their page names)."""
    if node_info is None:
        return []
    ranges = node_info.get("options", {})
    names = [name for name in NODE_OPTIONS if given.get(name) not in (None, "") and name not in ranges]
    if str(given.get("ignore_sky", "")).lower() in ("true", "1") and not node_supports(node_info)["masks"]:
        names.append("ignore_sky")
    return [OPTION_LABELS.get(name, name) for name in names]


def is_stale(job):
    return job["state"] in ACTIVE and time.time() - job.get("updated", 0) > STALE


def start(task, username, given, auto=False):
    """Starts training a task. Raises TrainingError or NodeError with the reason it cannot."""
    reason = problem(task)
    if reason:
        raise TrainingError(reason)
    node_info = get_node().check()
    current = get_job(task.id)
    resume = None
    if str(given.get("resume", "")).lower() in ("true", "1"):
        # More steps for the model the task has, with the options it was trained with
        resume = trained_steps(task)
        if resume is None:
            raise TrainingError("This task has no trained model to continue from. Start the training over.")
        kind = node_kind(node_info)
        if trained_kind(task) != kind:
            raise TrainingError(f"This task's model was trained with {trainer_label(trained_kind(task))}, and the "
                                f"splat node trains with {trainer_label(kind)}. Start the training over.")
        if not node_supports(node_info)["continue"]:
            raise TrainingError(f"{trainer_label(kind)} cannot continue a model. Start the training over.")
        try:
            more = int(given.get("steps") or 0)
        except (TypeError, ValueError):
            more = 0
        if more < 1:
            raise TrainingError("steps must be a whole number, 1 or more.")
        model_options = trained_options(task)
        if model_options is None and current and current["state"] == "completed":
            model_options = current.get("options")  # a model of SplatMe 0.1: its last training made it
        if model_options is None:
            raise TrainingError(
                "The options this task's model was trained with are not known. Start the training over."
            )
        grow_until = given.get("densify_until")
        given = {**model_options, "steps": resume + more}
        if grow_until not in (None, ""):
            # Growing again after the model's steps; blank keeps the step the model was trained with
            try:
                grow_until = int(grow_until)
            except (TypeError, ValueError):
                raise TrainingError("densify_until must be a whole number.") from None
            low, high = resume + GROW_AT_LEAST, resume + more - AFTER_GROWING
            if low > high:
                raise TrainingError(f"densify_until needs {GROW_AT_LEAST + AFTER_GROWING} more steps or more.")
            if not low <= grow_until <= high:
                raise TrainingError(f"densify_until must be between {low} and {high}: at least {GROW_AT_LEAST} "
                                    f"steps after the model's {resume}, and {AFTER_GROWING} before the last.")
            given["densify_until"] = grow_until
    options = parse_options(given, node_info)
    skipped = skipped_options(given, node_info)
    if skipped:
        logger.info(f"SplatMe: task {task.id}'s training leaves out what the splat node does not have: {', '.join(skipped)}")
    sweep()

    run = uuid.uuid4().hex
    now = time.time()
    job = {
        "state": "starting", "run": run, "options": options, "user": username, "auto": auto, "progress": 0,
        "status": "", "node_job": None, "error": None, "started": now, "updated": now, "finished": None,
        "resume": resume, "source": reconstruction(task), "waiting": run, "since": now, "times": {},
        # On Continue, the training time of the model continued from (None: not known, a model of SplatMe 0.3)
        "earlier_training": trained_seconds(task) if resume is not None else 0,
        "trainer_kind": node_kind(node_info), "skipped": skipped,
    }  # fmt: skip
    with transaction.atomic():
        lock_records()
        current = get_job(task.id)  # again, under the lock: another request may have just started one
        if current and current["state"] in ACTIVE and not is_stale(current):
            raise TrainingError("This task's splats are already being trained.")
        if applying(task.id):
            raise TrainingError("This task's edits are being applied: train its splats when that is done.")
        store().del_key(cancel_key(task.id))
        store().set_json(job_key(task.id), job)
    if current and current["state"] in ACTIVE:
        drop_node_job(current)  # a record that lost its worker: its node job would train on, followed by nobody
    run_function_async(run_job, PACKAGE, str(task.id), run)
    return get_job(task.id)


def completed(task_id):
    """
    A task completed processing (WebODM's task_completed signal, in the worker): trains it when its setting says
    so. A training that cannot start is left in the task's record, where the task's panel shows it.
    """
    if not Plugin.objects.filter(name=NAME, enabled=True).exists():
        return  # WebODM imports a disabled plugin's module too
    task = Task.objects.filter(pk=task_id).first()
    if task is None:
        return
    current = get_job(task.id)
    if current and current["state"] in ACTIVE and outdated(current, task):
        # Its model would not fit the task's new results: a task set to train is trained again below
        stop_job(task.id, "canceled", "The task was processed again while its splats trained.")
    if "splats.rad" in task.available_assets:
        return  # an imported task comes with its model
    # Processed again (WebODM deleted its assets, the splats with them): its trained model no longer fits it, and
    # its textured model is a new one, without the model edits (kept for an update) or the originals kept
    shutil.rmtree(trained_dir(task), ignore_errors=True)
    from . import meshes  # it imports this module

    meshes.processed_again(task.id)
    auto = get_auto(task.id)
    if not auto["enabled"]:
        return
    reason = problem(task)
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


def stop_job(task_id, state, error, keep_node_job=False):
    """Ends the task's job here, with the reason: its worker job stops at its next report."""
    job = get_job(task_id)

    def stop(j):
        if j["state"] in ACTIVE:
            enter_state(j, state)
            j.update(state=state, run=None, error=error, status="", time_left=None, finished=time.time())

    change_job(task_id, stop)
    if job and not keep_node_job:
        drop_node_job(job)
    shutil.rmtree(work_dir(task_id), ignore_errors=True)
    return get_job(task_id)


def cancel(task):
    """Asks the task's job to stop. A job without a worker is stopped here."""
    job = get_job(task.id)
    if not job or job["state"] not in ACTIVE:
        return job
    store().set_bool(cancel_key(task.id), True)
    if is_stale(job):
        drop_node_job(job)
        def canceled(j):
            enter_state(j, "canceled")
            j.update(state="canceled", run=None, finished=time.time())

        change_job(task.id, canceled)
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
            # Not the follower's jobs (taken over whenever it restarts), nor a run that never started (it waited in
            # WebODM's worker queue): only a worker lost mid-work counts
            if j["state"] not in HANDED and j.get("waiting") != j.get("run"):
                j["takeovers"] = j.get("takeovers", 0) + 1
            j.update(run=run, waiting=run, updated=time.time())

    job = change_job(task.id, take_over)
    if job and job.get("run") == run and job.get("takeovers", 0) > TAKEOVERS:
        logger.warning(f"SplatMe: the job of task {task.id} lost its worker {job['takeovers']} times")
        return stop_job(
            task.id, "failed",
            f"The training stopped {job['takeovers']} times while {job['state']}: WebODM's worker may have run out "
            "of memory. Try a smaller Image Size.",
            keep_node_job=job["state"] == "importing",  # its model is trained: the node deletes it after its keep-hours
        )  # fmt: skip
    if job and job.get("run") == run:
        logger.info(f"SplatMe: the job of task {task.id} lost its worker, starting another")
        run_function_async(run_job, PACKAGE, str(task.id), run)
    return job


def revive():
    """
    Takes over every job that lost its worker or its follower (WebODM's worker restarted, or killed a job). WebODM
    gives a plugin no timer of its own, so this runs when any task completes or fails and from WebODM's pages (main.js),
    at most once every REVIVE_EVERY seconds in a process. Never raises: its callers are WebODM's.
    """
    global revived
    if time.time() - revived < REVIVE_EVERY:
        return
    revived = time.time()
    try:
        prefix = store().db_key(job_key(""))
        records = PluginDatum.objects.filter(key__startswith=prefix, user=None).values_list("key", "json_value")
        stale = [key[len(prefix) :] for key, job in records if isinstance(job, dict) and job.get("state") and is_stale(job)]
    except Exception:
        logger.exception("SplatMe: looking for trainings that lost their worker failed")
        return
    for task_id in stale:
        try:
            task = Task.objects.filter(pk=task_id).first()
            if task is not None:
                follow(task)
        except Exception:
            logger.exception(f"SplatMe: taking over the training of task {task_id} failed")


revived = 0.0  # when this process last looked (revive)


def task_ended():
    """A task completed or failed processing (WebODM's signals, in the worker): a moment to look for lost trainings."""
    if Plugin.objects.filter(name=NAME, enabled=True).exists():
        revive()


def removed(task_id):
    """The task is being deleted: its job stops and its record goes."""
    job = get_job(task_id)
    if job and job["state"] in ACTIVE:
        drop_node_job(job)
    forget(task_id)
    reset_auto(task_id)
    edits.forget(task_id)
    from . import meshes  # it imports this module

    meshes.forget(task_id)
    store().del_key(apply_key(task_id))
    store().del_key(shown_key(task_id))
    shutil.rmtree(work_dir(task_id), ignore_errors=True)
    shutil.rmtree(apply_dir(task_id), ignore_errors=True)
    shutil.rmtree(download_dir(task_id), ignore_errors=True)


def sweep():
    """
    Forgets the jobs and settings of tasks that no longer exist. WebODM's worker imports plugins only when it
    starts, so until WebODM restarts after this plugin is installed, a task the worker deletes sends this plugin
    no signal.
    """
    from . import meshes  # it imports this module

    keys = (job_key(""), auto_key(""), edits.edits_key(""), apply_key(""), shown_key(""), meshes.edits_key(""),
            meshes.shown_key(""), apply_key("", meshes.KIND))  # fmt: skip
    for prefix in (store().db_key(key) for key in keys):
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

    def __init__(self, task_id, run, report=None):
        self.task_id, self.run, self.report = task_id, run, report or update
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.beat, daemon=True)

    def beat(self):
        try:
            while not self.stopped.wait(BEAT):
                try:
                    self.report(self.task_id, self.run)
                except Superseded:
                    return
                except Exception as e:  # noqa: BLE001 (Django's InterfaceError is no DatabaseError: keep beating)
                    logger.warning(f"SplatMe: heartbeat: {e}")
                    connection.close()  # Django opens a new one at the next query
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
    try:
        update(task_id, run, waiting=None)  # it started: losing it from here on counts as a takeover
    except Superseded:
        return
    node = get_node()
    node_job = job.get("node_job")
    try:
        with Heartbeat(task_id, run):
            # Folders of this task's earlier runs: their jobs are gone or will stop at their next report
            shutil.rmtree(work_dir(task_id), ignore_errors=True)
            os.makedirs(work)
            if job["state"] == "importing":
                import_model(task_id, run, node, node_job, work)
                update(task_id, run, state="completed", progress=100, status="", finished=time.time())
                return
            if not node_job:
                node_job = export_and_send(task_id, run, node, job["options"], work, job.get("resume"))
        # The follower waits on the node: this worker job ends, and its place in WebODM's worker is free
        ensure_follower()
    except Superseded:
        if get_job(task_id) is None and node_job:
            drop_node_job({"node_job": node_job})  # the task was deleted
    except Canceled:
        drop_node_job({"node_job": node_job})
        finish(task_id, run, "canceled")
        if not Task.objects.filter(pk=task_id).exists():
            forget(task_id)
    except (TrainingError, NodeError, sky.SkyError, thermal.ThermalError, ValueError, OSError) as e:
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


def export_and_send(task_id, run, node, options, work, resume=None):
    task = Task.objects.get(pk=task_id)
    if resume and trained_steps(task) != resume:
        raise TrainingError("The model to continue from is gone or was replaced. Start the training over.")
    export_dir = os.path.join(work, "export")
    os.makedirs(export_dir)

    def exporting(status, perc):
        check_cancel(task_id)
        update(task_id, run, state="exporting", status=str(status), progress=int(perc))

    source = task
    if thermal.is_thermal(task):

        def drawing(status, perc):
            check_cancel(task_id)
            update(task_id, run, state="drawing", status=str(status), progress=int(perc))

        update(task_id, run, state="drawing", status="", progress=0)
        palette = options.get("palette", thermal.DEFAULT_PALETTE)
        source, drawn = thermal.draw(task, palette, os.path.join(work, "thermal"), drawing)
        update(task_id, run, thermal=drawn)
        check_cancel(task_id)

    update(task_id, run, state="exporting", status="", progress=0)
    splats.prepare_export(source, export_dir, image_size=options.get("image_size", 0), progress_callback=exporting)
    check_cancel(task_id)

    masks, sky_masks = [], None
    if options.get("ignore_sky") and source is task:  # the sky model is for colour photos, not a thermal task's

        def masking(status, perc):
            check_cancel(task_id)
            update(task_id, run, state="masking", status=str(status), progress=int(perc))

        update(task_id, run, state="masking", status="", progress=0)
        with open(os.path.join(export_dir, "images.json")) as f:
            images = json.load(f)
        masks = sky.make_masks(task, images, os.path.join(work, "masks"), masking)
        sky_masks = len(masks)  # 0 says that no photo shows the sky
        check_cancel(task_id)

    update(task_id, run, state="uploading", status="", progress=0, sky_masks=sky_masks)
    archive = splats.export_zip(export_dir)
    for path, image_name in masks:
        archive.add_path(path, f"masks/{image_name}.png")  # the trainer looks for <image's name>.png
    if resume:
        archive.add_path(trained_model(task), RESUME_NAME)
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
    if resume and "resume_steps" in node.check()["options"]:
        node_options["resume_steps"] = resume  # LichtFeld Studio: the model's steps, so it trains only the rest
    ref = run if node.keeps_refs() else None
    try:
        node_job = node.create_job(body(), total, {**node_options, "ref": ref} if ref else node_options)["id"]
    except NodeError as e:
        # The answer was lost (the connection dropped once the zip was sent): the job, if the node made it, is ours
        found = node.jobs(ref) if ref and e.status is None else []
        if not found:
            raise
        node_job = found[0]["id"]
    try:
        update(task_id, run, state="queued", node_job=node_job, status="", progress=0)
    except Superseded:
        drop_node_job({"node_job": node_job})
        raise
    shutil.rmtree(export_dir, ignore_errors=True)
    return node_job


def time_left(samples, total):
    """
    The seconds the steps left should take, from (time, step) samples of this training in the order seen (a
    continued training's steps start at its model's), or None while there are too few to tell.
    """
    if not samples:
        return None
    (first_time, first_step), (now, step) = samples[0], samples[-1]
    if now - first_time < ESTIMATE_AFTER or step - first_step < ESTIMATE_STEPS:
        return None
    # From the latest sample at least a window old, or the first
    since, since_step = next(((t, s) for t, s in reversed(samples) if now - t >= ESTIMATE_WINDOW), samples[0])
    if now <= since or step <= since_step:
        return None
    return max(0.0, (total - step) * (now - since) / (step - since_step))


def keep_window(samples):
    """The samples time_left needs: those of the last window, and the latest one before it."""
    now = samples[-1][0]
    older = [i for i, (t, _s) in enumerate(samples) if now - t >= ESTIMATE_WINDOW]
    return samples[older[-1]:] if older else samples


def left_text(seconds):
    """"about 12 min left", as the panel writes durations (trainingView.js)."""
    minutes = round(seconds / 60)
    if minutes < 1:
        return "less than a minute left"
    if minutes < 60:
        return f"about {minutes} min left"
    return f"about {minutes // 60} h {minutes % 60} min left" if minutes % 60 else f"about {minutes // 60} h left"


def step_status(remote, samples):
    """"Step 4,650 of 7,000, about 12 min left" (the time once it can be told), and the seconds left or None."""
    step, total = remote.get("step", 0), remote.get("options", {}).get("steps")
    if not isinstance(total, int):
        return f"Step {step:,}", None
    left = time_left(samples, total)
    return (f"Step {step:,} of {total:,}" + (f", {left_text(left)}" if left is not None else "")), left


# The follower

def run_follower(package, frun):
    # Only this function's source reaches the worker (run_function_async): the rest is imported there
    import importlib

    importlib.import_module(package + ".training").follow_node(frun)


def ensure_follower():
    """Starts the follower, unless one is alive."""
    frun = uuid.uuid4().hex
    with transaction.atomic():
        lock_records()
        key = store().db_key(FOLLOWER)
        datum = PluginDatum.objects.select_for_update().filter(key=key, user=None).first()
        if datum is None:
            datum = PluginDatum.objects.create(key=key, user=None)
        current = datum.json_value
        if current and time.time() - current.get("updated", 0) <= STALE:
            return
        datum.json_value = {"run": frun, "updated": time.time()}
        datum.save()
    run_function_async(run_follower, PACKAGE, frun)


def follower_beat(frun):
    """Touches the follower's record; False once the record is another follower's, or gone."""

    def touch(follower):
        if follower.get("run") != frun:
            raise Superseded()
        follower["updated"] = time.time()

    try:
        return change_record(FOLLOWER, touch) is not None
    except Superseded:
        return False


def handed_jobs():
    """The jobs the node has, which the follower follows: [(task id, record)]."""
    prefix = store().db_key(job_key(""))
    records = PluginDatum.objects.filter(key__startswith=prefix, user=None).values_list("key", "json_value")
    return [
        (key[len(prefix) :], job) for key, job in records
        if isinstance(job, dict) and job.get("state") in HANDED and job.get("node_job") and job.get("run")
    ]  # fmt: skip


def follower_done(frun):
    """
    Ends the follower's record when no job is left to follow, under the lock ensure_follower takes: a job handed
    over meanwhile is either seen here or starts a follower of its own.
    """
    with transaction.atomic():
        datum = PluginDatum.objects.select_for_update().filter(key=store().db_key(FOLLOWER), user=None).first()
        if datum is None or not datum.json_value or datum.json_value.get("run") != frun:
            return True
        if handed_jobs():
            return False
        datum.json_value = None
        datum.save()
        return True


def follow_node(frun):
    """The follower: follows every training the node has, and starts each trained one's import."""
    seen = {}  # node job: what follow_job keeps between looks (the time left's samples, since when the node is silent)
    errors = 0
    while True:
        try:
            if not follow_all(frun, seen):
                return
            errors = 0
        except Exception:
            # Its own error (the database restarting): the follower goes on for a while; past that it ends, and the next
            # look for lost trainings (revive) starts another
            errors += 1
            logger.exception(f"SplatMe: the follower's look at the node failed ({errors} in a row)")
            if errors >= FOLLOWER_ERRORS:
                return
            connection.close()
            time.sleep(BEAT)
        time.sleep(POLL)


def follow_all(frun, seen):
    """One look at every training the node has; False once the follower should end."""
    if not follower_beat(frun):
        return False
    jobs = handed_jobs()
    if not jobs and follower_done(frun):
        return False
    node = get_node()
    for task_id, job in jobs:
        try:
            follow_job(task_id, job["run"], node, job["node_job"], seen.setdefault(job["node_job"], {}))
        except Superseded:
            seen.pop(job["node_job"], None)
        except Canceled:
            seen.pop(job["node_job"], None)
            drop_node_job(job)
            finish(task_id, job["run"], "canceled")
            if not Task.objects.filter(pk=task_id).exists():
                forget(task_id)
        except (TrainingError, NodeError) as e:
            seen.pop(job["node_job"], None)
            logger.warning(f"SplatMe: training task {task_id} failed: {e}")
            if isinstance(e, NodeError):
                drop_node_job(job)  # a node unwell this long may still train it once it is well again
            finish(task_id, job["run"], "failed", str(e))
        except Exception as e:
            seen.pop(job["node_job"], None)
            logger.exception(f"SplatMe: following task {task_id}'s training failed")
            finish(task_id, job["run"], "failed", f"Unexpected error: {e}")
    return True


def follow_job(task_id, run, node, node_job, memory):
    """One look at a training on the node: its record follows it, and once trained its import starts."""
    check_cancel(task_id)
    try:
        remote = node.job(node_job)
        memory.pop("silent", None)
    except NodeError as e:
        if e.status == 404:
            raise TrainingError(
                "The splat node no longer has this job (the node lost its data, or the job expired). "
                "Start the training again."
            ) from e
        # Not answering, or answering an error (a proxy's 502 while the node restarts, a token being changed): the
        # node keeps training meanwhile
        memory.setdefault("silent", time.time())
        if time.time() - memory["silent"] > NODE_PATIENCE:
            raise
        update(task_id, run, status="Waiting for the splat node to answer" + (f" (it answered {e.status})" if e.status else ""))
        return

    state = remote["state"]
    if state == "completed":
        importing = uuid.uuid4().hex

        def to_import(j):
            if j.get("run") != run:
                raise Superseded()
            enter_state(j, "importing")
            j.update(state="importing", run=importing, waiting=importing, progress=0, status="", time_left=None,
                 updated=time.time())

        if change_job(task_id, to_import) is None:
            raise Superseded()
        run_function_async(run_job, PACKAGE, str(task_id), importing)
    elif state == "failed":
        raise TrainingError(remote.get("error") or "The training failed. See the log.")
    elif state == "canceled":
        raise Canceled()
    elif state == "queued":
        status = "Position {} in the node's queue".format(remote.get("position") or 1)
        update(task_id, run, state="queued", progress=0, status=status)
    else:
        samples = memory.get("samples", [])
        if isinstance(remote.get("step"), int) and (not samples or remote["step"] != samples[-1][1]):
            samples = memory["samples"] = keep_window(samples + [(time.time(), remote["step"])])
        status, left = step_status(remote, samples)
        update(task_id, run, state="training", progress=remote.get("progress", 0), status=status,
               time_left=None if left is None else round(left))


def convert(trained, model):
    """The trainer's .ply as the .rad WebODM's viewer shows, as WebODM's own import makes it (process_splats)."""
    if shutil.which("splat-tools") is None:
        raise TrainingError("WebODM's splat-tools is not available, so the trained model cannot be converted.")
    try:
        p = subprocess.run(
            ["splat-tools", "--quality", "-o", model, trained], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            check=False, timeout=CONVERT_TIMEOUT,
        )  # fmt: skip
    except subprocess.TimeoutExpired:
        minutes = round(CONVERT_TIMEOUT / 60)
        raise TrainingError(
            f"The trained model could not be converted: splat-tools took longer than {minutes} minutes."
        ) from None
    if p.returncode != 0 or not os.path.isfile(model):
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-1:]
        reason = tail[0][:300] if tail else "splat-tools failed"
        raise TrainingError(f"The trained model could not be converted: {reason}")


def download(task_id, run, node, node_job, dest):
    """The trained model, downloaded again when the connection drops."""
    for attempt in range(1, RESULT_TRIES + 1):
        check_cancel(task_id)
        try:
            node.result(node_job, dest)
            return
        except NodeError as e:
            if e.status is not None or attempt == RESULT_TRIES:
                raise
            logger.warning(f"SplatMe: downloading task {task_id}'s model failed, trying again: {e}")
            update(task_id, run, status=f"The download stopped: trying again ({attempt} of {RESULT_TRIES - 1})")
            time.sleep(5 * POLL * attempt)


NEW = ".splatme-new"  # a file written beside the one it replaces


def replace_files(task, model, trained, options):
    """
    The task's model, the .ply it was made from and its options, replaced together: each is first written beside its
    place (a failure there leaves the task as it was), then renamed in place. The model first: a .ply older than the
    model shown is not continued from (trained_steps).
    """
    dest, kept, options_file = task.get_asset_file_or_stream("splats.rad"), trained_model(task), trained_options_file(task)
    try:
        os.makedirs(trained_dir(task), exist_ok=True)
        shutil.move(model, dest + NEW)
        shutil.move(trained, kept + NEW)
        os.utime(kept + NEW)  # not older than the model made from it: see trained_steps
        with open(options_file + NEW, "w") as f:
            json.dump(options, f)
        for path in (dest, kept, options_file):
            os.replace(path + NEW, path)
    finally:
        for path in (dest, kept, options_file):
            try:
                os.remove(path + NEW)
            except FileNotFoundError:
                pass


def import_model(task_id, run, node, node_job, work):
    update(task_id, run, state="importing", status="", progress=0, time_left=None)
    trained = os.path.join(work, "model.ply")
    download(task_id, run, node, node_job, trained)
    if os.path.getsize(trained) == 0:
        raise TrainingError("The splat node sent an empty model.")
    task = Task.objects.get(pk=task_id)
    job = get_job(task_id) or {}
    options = job.get("options", {})
    try:
        shown, cut = shown_model(task, trained, work, options.get("crop", True), lambda text: update(task_id, run, status=text))
    except (EditsRemoveAll, edits.EditsError) as e:
        # Only the model the task shows is cut: a later training continues from all the trainer made
        shown, cut = shown_model(task, trained, work, options.get("crop", True), use_edits=False)
        cut["edits_error"] = str(e)
    update(task_id, run, status="Converting the model", cropped=cut["boundary"], edited=cut["edits"],
           edits_error=cut.get("edits_error"))
    model = os.path.join(work, "model.rad")
    convert(shown, model)
    check_cancel(task_id)  # the last moment a cancel keeps the task's model

    # As WebODM's own import does (worker/tasks.py, process_splats); the model replaces the task's only now
    task.refresh_from_db()
    if (
        task.status != status_codes.COMPLETED or "georeferenced_model.laz" not in task.available_assets
        or (job.get("source") is not None and outdated(job, task))  # a record of SplatMe 0.1 cannot tell
    ):  # fmt: skip
        raise TrainingError("The task was processed again while its splats trained. Start the training again.")
    dest = task.get_asset_file_or_stream("splats.rad")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    job = get_job(task_id) or job  # its times, up to the import
    earlier, took = job.get("earlier_training"), (job.get("times") or {}).get("training")
    total = earlier + took if isinstance(earlier, (int, float)) and isinstance(took, (int, float)) else None
    kept = {**options, TRAINER: job.get("trainer_kind") or DEFAULT_KIND}
    replace_files(task, model, trained, {**kept, TRAINING_SECONDS: total} if total is not None else kept)
    drop_thumbnail(task)  # a picture of the model replaced; Edit Splats takes another
    set_shown(task.id, cut["made_with"])
    store().del_key(apply_key(task.id))  # the last Apply no longer says what the model is (Apply waits for a training)
    task.refresh_from_db()
    task.update_available_assets_field()
    task.update_size()
    task.save()


# The model the task shows, and Apply Edits


class EditsRemoveAll(TrainingError):
    text = "The edits were not applied: together they remove every splat."

    def __init__(self):
        super().__init__(self.text)


def shown_model(task, trained, work, use_boundary, report=None, use_edits=True, check=None):
    """
    The model the task shows, made from the trainer's .ply: cut to the task's boundary (for a model trained with
    Crop to Boundary) and by its edits, its colours adjusted by its Colour Adjust. Answers its path (trained itself when nothing is cut) and how many gaussians
    the boundary and the edits each removed (None for none). A boundary with nothing of the model inside crops
    nothing; edits that would leave nothing raise EditsRemoveAll, and nothing is written. The counts also say
    which edits it was made with ("made_with", their fingerprint). check, when given, is called before each chunk
    of the model is cut, and may raise to stop (Apply's Cancel).
    """
    rings = crop.boundary(task) if use_boundary else []
    # EditsError: the caller goes on without them, or fails
    shapes, made_with = edits.get_with_fingerprint(task) if use_edits else ([], None)
    dest = os.path.join(work, "shown.ply")
    colour = edits.colour(shapes)
    change = edits.colour_change(colour) if colour else None

    floaters = None
    if edits.strength(shapes):
        if report:
            report("Finding the floaters")
        try:
            floaters = edits.floaters(trained, edits.strength(shapes))
        except (ValueError, KeyError, MemoryError) as e:
            # As for edits that do not read: a training goes on without the edits, Apply fails, both saying why
            raise edits.EditsError(f"The trained model's floaters could not be found: {str(e) or type(e).__name__}") from None

    def cut(rings):
        counts = {"boundary": 0, "edits": 0}
        inside = crop.within(rings) if rings else None

        def keep(rows, first):
            if check:
                check()
            kept = np.ones(len(rows), dtype=bool)
            if inside:
                kept &= inside(rows, first)
                counts["boundary"] += int(len(rows) - kept.sum())
            if shapes:
                chunk = floaters[first : first + len(rows)] if floaters is not None else None
                by_edits = edits.keep_mask(rows, shapes, chunk)
                counts["edits"] += int((kept & ~by_edits).sum())
                kept &= by_edits
            return kept

        try:
            kept, total = crop.crop_ply(trained, dest, keep, change)
        except (ValueError, KeyError) as e:
            raise TrainingError(f"The trained model could not be cut: {e}") from None
        return kept, total, counts

    if not rings and not shapes:
        return trained, {"boundary": None, "edits": None, "made_with": made_with}
    if report:
        report("Applying the edits" if shapes else "Cropping to the task's boundary")
    kept, total, counts = cut(rings)
    if kept == 0 and rings and counts["boundary"] == total:
        kept, total, counts = cut([])  # nothing of the model is inside the boundary: it crops nothing
    if kept == 0 and total > 0 and shapes:
        raise EditsRemoveAll()
    removed = {name: counts[name] or None for name in counts}
    removed["made_with"] = made_with  # which edits it was made with (edits.fingerprint): see set_shown
    if kept == 0 or (kept == total and not change):
        return trained, removed
    return dest, removed


def trained_with_crop(task):
    """Whether the task's trained model was trained with Crop to Boundary (the default; a model of SplatMe 0.1 was)."""
    return (trained_options(task) or {}).get("crop", True)


def model_info(task):
    """The trained model as the Edit Splats page loads it: its URL (SplatMe's, for those who may edit), size and splats."""
    path = trained_model(task)
    with open(path, "rb") as f:
        count, _ = splats.parse_ply_header(f)
    return {"url": f"/api/plugins/{NAME}/task/{task.id}/model", "size": os.path.getsize(path), "splats": count}


def shown_key(task_id):
    return f"shown::{task_id}"


def set_shown(task_id, made_with):
    """The task's model was just made with these edits (their fingerprint, None for none)."""
    store().set_json(shown_key(task_id), {"edits": made_with})


def shown_current(task_id):
    """Whether the task's model was made with its saved edits; None when not known (a model made before SplatMe 0.3)."""
    record = store().get_json(shown_key(task_id), None)
    if record is None:
        return None
    return record.get("edits") == edits.saved_fingerprint(task_id)


DOWNLOADS = "downloads"  # in the plugin's persistent folder: a folder for each task's downloaded model
DOWNLOAD_KEEP = 86400  # seconds a made download is kept after it was last asked for
DOWNLOAD_LEFTOVER = 3600  # seconds after which a download's work folder is a leftover of a stopped server
DOWNLOAD_WAIT = 300  # seconds a download waits while the same task's is made for another
LOCK = ".lock"


def download_dir(task_id):
    return get_plugins_persistent_path(NAME, DOWNLOADS, str(task_id))


def clear_downloads():
    """Removes the downloads not asked for in DOWNLOAD_KEEP and the work folders a stopped server left."""
    parent = get_plugins_persistent_path(NAME, DOWNLOADS)
    now = time.time()
    for folder in (os.path.join(parent, name) for name in os.listdir(parent)):
        try:
            for path in (os.path.join(folder, name) for name in os.listdir(folder) if name != LOCK):
                age = now - os.path.getmtime(path)
                if os.path.isdir(path) and age > DOWNLOAD_LEFTOVER:
                    shutil.rmtree(path, ignore_errors=True)
                elif not os.path.isdir(path) and age > DOWNLOAD_KEEP:
                    os.remove(path)
        except OSError:
            pass  # not a folder, or removed meanwhile


def download_name(task, trained, use_boundary, made_with):
    """A made download's file name: what it was made from, so a change to any of it makes it again."""
    stat = os.stat(trained)
    rings = crop.boundary(task) if use_boundary else []
    made_from = json.dumps([stat.st_size, stat.st_mtime_ns, made_with, rings, use_boundary])
    return uuid.uuid5(uuid.NAMESPACE_OID, made_from).hex + ".ply"


def edited_model(task):
    """
    The task's model with its saved edits, as Apply makes it, open for a download: the trained .ply cut by the
    boundary and the edits, its colours adjusted (the trained .ply itself when nothing changes). The file made is
    kept until it is not asked for in a day or what it was made from changes, and only one is made at a time for a
    task: a download is a GET anyone who may see the task can repeat. Raises TrainingError or edits.EditsError with
    why not.
    """
    reason = editable(task)
    if reason:
        raise TrainingError(reason)
    folder = download_dir(task.id)
    os.makedirs(folder, exist_ok=True)
    clear_downloads()
    trained, use_boundary = trained_model(task), trained_with_crop(task)
    with open(os.path.join(folder, LOCK), "a") as lock:  # closing it lets the lock go
        deadline = time.time() + DOWNLOAD_WAIT
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() > deadline:
                    raise TrainingError("The model is being made for another download. Try again in a minute.") from None
                time.sleep(0.5)
        path = os.path.join(folder, download_name(task, trained, use_boundary, edits.saved_fingerprint(task.id)))
        if not os.path.exists(path):
            work = tempfile.mkdtemp(dir=folder)
            try:
                shown, cut = shown_model(task, trained, work, use_boundary)
                if shown == trained:
                    return open(trained, "rb")
                path = os.path.join(folder, download_name(task, trained, use_boundary, cut["made_with"]))
                os.replace(shown, path)
            finally:
                shutil.rmtree(work, ignore_errors=True)
            for name in os.listdir(folder):
                if name.endswith(".ply") and os.path.join(folder, name) != path:
                    os.remove(os.path.join(folder, name))  # one being sent stays readable until it is closed
        os.utime(path)  # asked for now: see clear_downloads
        return open(path, "rb")


APPLYING = "applying"
APPLY_REQUEUES = 30  # times an Apply whose worker job never started is queued again (STALE seconds apart)


# An update's kind: "apply" makes the splat model again (here), "modelapply" the textured model (meshes.py). Both
# keep their record under "<kind>::<task id>" and work in their own folder.
def apply_key(task_id, kind="apply"):
    return f"{kind}::{task_id}"


def apply_dir(task_id, run=None, kind="apply"):
    parts = (kind, str(task_id)) + ((run,) if run else ())
    return get_plugins_persistent_path(NAME, *parts)


def job_of(kind):
    """The worker job that runs an update of this kind."""
    if kind == "modelapply":
        from . import meshes

        return meshes.apply_job
    return apply_job


def get_apply(task_id, kind="apply"):
    """
    The task's last Apply Edits (or update of the textured model, kind "modelapply"), or None. One that lost its worker fails here: it is short, so it is not taken over.
    One whose worker job never started (it waited in WebODM's worker queue, or a restart lost the queue) is queued
    again, up to APPLY_REQUEUES times.
    """
    requeued = []

    def lost(record):
        return record.get("state") == APPLYING and time.time() - record.get("updated", 0) > STALE

    def fail_or_requeue(record):
        if not lost(record):
            return
        if record.get("waiting") and record["waiting"] == record.get("run"):
            if record.get("requeued", 0) < APPLY_REQUEUES:
                run = uuid.uuid4().hex
                record.update(run=run, waiting=run, updated=time.time(), requeued=record.get("requeued", 0) + 1)
                requeued.append(run)
                return
            error = "The edits were not applied: WebODM's worker did not start applying them. Restart WebODM, then apply them again."
        else:
            error = "The edits were not applied: WebODM's worker stopped. Update the model again."
        record.update(state="failed", run=None, waiting=None, status="", error=error, finished=time.time())

    record = store().get_json(apply_key(task_id, kind), None)
    if record and lost(record):
        record = change_record(apply_key(task_id, kind), fail_or_requeue)
    for run in requeued:
        # After the record's change is committed, so the job finds its run
        transaction.on_commit(lambda run=run: run_function_async(job_of(kind), PACKAGE, str(task_id), run))
    return record


def applying(task_id, kind="apply"):
    record = get_apply(task_id, kind)
    return bool(record) and record.get("state") == APPLYING


def editable(task):
    """Why the task's splats cannot be edited, or None: its shown model must be made from the .ply SplatMe keeps."""
    if "splats.rad" not in task.available_assets:
        return "This task has no splat model."
    if trained_steps(task) is None:
        return (
            "This task's splat model was not trained by SplatMe, or was replaced since (WebODM's Splats dialog): "
            "train its splats to edit them."
        )
    return None


def start_apply(task, username):
    """Makes the task's shown model again from its trained .ply, with its edits. Raises TrainingError with the reason it cannot."""
    reason = editable(task)
    if reason:
        raise TrainingError(reason)
    run = uuid.uuid4().hex
    now = time.time()
    record = {
        "state": APPLYING, "run": run, "waiting": run, "user": username, "status": "", "error": None, "started": now,
        "updated": now, "finished": None, "cropped": None, "edited": None,
    }  # fmt: skip
    with transaction.atomic():
        lock_records()
        job = get_job(task.id)
        if job and job["state"] in ACTIVE:
            raise TrainingError("This task's splats are being trained: update the model when the training is done.")
        if applying(task.id):
            raise TrainingError("This task's edits are already being applied.")
        store().set_json(apply_key(task.id), record)
    run_function_async(apply_job, PACKAGE, str(task.id), run)
    return get_apply(task.id)


def apply_job(package, task_id, run):
    # Only this function's source reaches the worker (run_function_async): the rest is imported there
    import importlib

    importlib.import_module(package + ".training").apply(task_id, run)


def update_apply(task_id, run, kind="apply", **fields):
    """An Apply Edits job's report. Raises Superseded when the record is no longer this run's."""

    def change(record):
        if record.get("run") != run:
            raise Superseded()
        record.update(fields, updated=time.time())

    if change_record(apply_key(task_id, kind), change) is None:
        raise Superseded()


def check_apply(task_id, run, kind="apply"):
    """Raises Superseded when the Apply is no longer this run's: canceled, or failed as lost."""
    record = store().get_json(apply_key(task_id, kind), None)
    if not record or record.get("run") != run:
        raise Superseded()


def cancel_apply(task_id, kind="apply"):
    """Stops the task's Apply: its job stops at its next chunk or step, and the task's model stays as it was."""

    def stop(record):
        if record.get("state") == APPLYING:
            record.update(state="canceled", run=None, waiting=None, status="", finished=time.time())

    change_record(apply_key(task_id, kind), stop)
    return get_apply(task_id, kind)


def apply(task_id, run):
    record = store().get_json(apply_key(task_id), None)
    if not record or record.get("run") != run:
        return
    work = apply_dir(task_id, run)
    try:
        update_apply(task_id, run, waiting=None)  # it started: losing it from here on fails it
        for name in os.listdir(apply_dir(task_id)) if os.path.isdir(apply_dir(task_id)) else []:
            if name != run:  # an earlier run's, whose worker was killed
                shutil.rmtree(os.path.join(apply_dir(task_id), name), ignore_errors=True)
        with Heartbeat(task_id, run, update_apply):
            os.makedirs(work, exist_ok=True)
            task = Task.objects.get(pk=task_id)
            reason = editable(task)
            if reason:
                raise TrainingError(reason)
            trained, steps = trained_model(task), trained_steps(task)
            shown, cut = shown_model(
                task, trained, work, trained_with_crop(task), lambda text: update_apply(task_id, run, status=text),
                check=lambda: check_apply(task_id, run),
            )
            update_apply(task_id, run, status="Converting the model")
            model = os.path.join(work, "model.rad")
            convert(shown, model)
            check_apply(task_id, run)  # canceled, or no longer this run's (its record lost): the model stays
            task.refresh_from_db()
            if task.status != status_codes.COMPLETED or trained_steps(task) != steps:
                raise TrainingError("The task's splat model changed while the edits were applied. Update the model again.")
            dest = task.get_asset_file_or_stream("splats.rad")
            try:
                shutil.move(model, dest + NEW)
                os.replace(dest + NEW, dest)
            finally:
                try:
                    os.remove(dest + NEW)
                except FileNotFoundError:
                    pass
            os.utime(trained)  # not older than the model made from it: see trained_steps
            set_shown(task.id, cut["made_with"])
            task.update_size(commit=True)
        update_apply(
            task_id, run, state="completed", status="", finished=time.time(), cropped=cut["boundary"],
            edited=cut["edits"],
        )  # fmt: skip
    except Superseded:
        pass
    except (TrainingError, edits.EditsError, ValueError, OSError, Task.DoesNotExist) as e:
        logger.warning(f"SplatMe: applying task {task_id}'s edits failed: {e}")
        finish_apply(task_id, run, str(e))
    except Exception as e:
        logger.exception(f"SplatMe: applying task {task_id}'s edits failed")
        finish_apply(task_id, run, f"Unexpected error: {e}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            os.rmdir(apply_dir(task_id))
        except OSError:
            pass


def finish_apply(task_id, run, error, kind="apply"):
    try:
        update_apply(task_id, run, kind, state="failed", status="", error=error, finished=time.time())
    except Superseded:
        pass
