#!/usr/bin/env python3
"""The splat node: an HTTP service that trains Gaussian splats from a WebODM training zip with OpenSplat.

Python's standard library only. One job trains at a time (one GPU); the others wait in a queue.

    GET    /health                whether the node works (no token): 503 when its worker has stopped
    GET    /info                  the node, its trainer, its GPU and its queue
    POST   /jobs?steps=7000       the training zip as the body; answers the new job. A zip that also holds
                                  resume.ply (an earlier job's result) continues that model: steps is then
                                  the total, the model's own steps included
    GET    /jobs                  every job
    GET    /jobs/<id>             one job: state, progress, error
    GET    /jobs/<id>/log?offset= the trainer's output from that byte on (X-Log-Offset: where it now ends)
    GET    /jobs/<id>/result      the trained model (.ply), once the job is completed
    POST   /jobs/<id>/cancel      stop a queued or running job
    DELETE /jobs/<id>             cancel it and delete its files

Every request but GET /health carries "Authorization: Bearer <token>" when SPLATNODE_TOKEN is set. HEAD
answers wherever GET does.

Settings (environment): SPLATNODE_PORT (3100), SPLATNODE_TOKEN, SPLATNODE_DATA (/var/splatnode),
SPLATNODE_TRAINER (/opt/opensplat/opensplat), SPLATNODE_KEEP_HOURS (48: a finished job is deleted after that),
SPLATNODE_STALL_MINUTES (STALL_MINUTES: a trainer that prints nothing for that long is stopped).

How it stays up (each has a test in tests/test_splatnode.py that makes the failure happen):

- One worker thread trains the jobs. An error while it handles a job fails that job and the worker goes on. If the
  thread ends anyway, /health answers 503 and the process exits, so Docker starts it again (restart:
  unless-stopped); a start fails the job that was running.
- Every wait has a deadline: a trainer is stopped with SIGTERM, then SIGKILL after GRACE_SECONDS; a trainer that
  goes silent is stopped; a client's socket times out after SOCKET_TIMEOUT.
- A job's state is changed only by Node.transition, under the lock, which refuses a change that is not allowed.
  Files are never deleted under the lock: they are moved to trash/ (a rename) and deleted by the worker.
- A job's saved file that doesn't read is moved to broken/ at start; the node starts all the same. A setting that
  is not a number, or is too small, is logged and its default used.
- Every request is answered, an unexpected error included (500, or 507 for a full disk).
"""

import errno
import hmac
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

VERSION = "0.2.2"

QUEUED, RUNNING, COMPLETED, FAILED, CANCELED = "queued", "running", "completed", "failed", "canceled"
FINISHED = (COMPLETED, FAILED, CANCELED)
# The only changes of state there are
TRANSITIONS = {QUEUED: (RUNNING, CANCELED), RUNNING: FINISHED}

# The options a job accepts: name -> (the trainer's flag, type, minimum, maximum, default)
OPTIONS = {
    "steps": ("--num-iters", int, 1, 200000, 7000),
    "max_gaussians": ("--max-gaussians", int, 0, 50000000, None),
    "sh_degree": ("--sh-degree", int, 1, 3, None),
    "downscale": ("--downscale-factor", float, 1, 16, None),
}
# What a training zip must hold (WebODM's export, app/splats.py export_zip)
REQUIRED_FILES = ("sparse/0/cameras.bin", "sparse/0/images.bin", "sparse/0/points3D.bin")
# The model is a .ply: the only format the trainer continues from (WebODM converts it for its viewer)
MODEL = "model.ply"
# An earlier model in the training zip, to continue from
RESUME = "resume.ply"
KEPT_FILES = ("job.json", "log.txt", MODEL)
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
CHUNK = 1 << 20
# The trainer extracts the zip beside it: an upload needs this many times its size free
DISK_FACTOR = 2.5

# OpenSplat's output, as tests/opensplat-output.txt holds it from a real run of the pinned commit
STEP_LINE = re.compile(rb"^Step (\d+): \S+ \[(\d+)%\]")
OUT_OF_MEMORY = re.compile(r"out of memory", re.IGNORECASE)

# Deadlines
GRACE_SECONDS = 20  # SIGTERM to SIGKILL; inside compose's stop_grace_period (30 s)
STALL_MINUTES = 30  # the trainer's longest silence measured, with a margin (see upcoming-changes.md)
SOCKET_TIMEOUT = 120  # one read or write on a client's connection


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class IllegalTransition(Exception):
    pass


class BadJobFile(Exception):
    pass


def log(message):
    sys.stderr.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    sys.stderr.flush()


def parse_options(params):
    """The job's options from the request's query parameters; Refused when one is unknown or out of range."""
    options = {name: spec[4] for name, spec in OPTIONS.items() if spec[4] is not None}
    for name, value in params.items():
        if name not in OPTIONS:
            raise Refused(400, f"Unknown option: {name}")
        _, kind, low, high, _ = OPTIONS[name]
        try:
            value = kind(value)
        except ValueError:
            raise Refused(400, f"Option {name} must be a number") from None
        if not low <= value <= high:
            raise Refused(400, f"Option {name} must be between {low} and {high}")
        options[name] = value
    return options


def check_dataset(path):
    """Refused unless the file is a training zip whose every entry stays inside the folder it is extracted to.

    Answers whether it holds a model to continue from.
    """
    if not zipfile.is_zipfile(path):
        raise Refused(400, "The dataset is not a zip file")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
    for name in names:
        if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/") or ":" in name:
            raise Refused(400, f"The dataset has an unsafe file name: {name}")
    missing = [name for name in REQUIRED_FILES if name not in names]
    if missing:
        raise Refused(400, f"The dataset has no {missing[0]} (it must be a WebODM splats training zip)")
    if not any(name.startswith("images/") and not name.endswith("/") for name in names):
        raise Refused(400, "The dataset has no images")
    return RESUME in names


def extract_resume(dataset, dest):
    """The zip's model to continue from, as a file of its own: the trainer takes it as an argument."""
    with zipfile.ZipFile(dataset) as z, z.open(RESUME) as src, open(dest, "wb") as f:
        shutil.copyfileobj(src, f, CHUNK)
    with open(dest, "rb") as f:
        if f.read(4) != b"ply\n":
            raise Refused(400, "The model to continue from is not a .ply file")


def step_of(line):
    """(step, percent) from a line of the trainer's output, or None."""
    match = STEP_LINE.match(line)
    return (int(match.group(1)), int(match.group(2))) if match else None


def explain(code, tail):
    """Why the trainer failed, from its exit code and the end of its output."""
    if OUT_OF_MEMORY.search(tail):
        return "The GPU ran out of memory. Try a smaller image size or fewer gaussians."
    lines = [line.strip() for line in tail.splitlines() if line.strip()]
    how = "was killed by signal %s" % -code if code < 0 else f"ended with code {code}"
    return "The trainer {}{}".format(how, ": " + lines[-1][:500] if lines else "")


def gpu_info():
    """The first GPU's name and memory in MiB, or None without nvidia-smi or a GPU."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip().splitlines()[0]
        name, total, used = [part.strip() for part in out.split(",")]
        return {"name": name, "memory_total": int(total), "memory_used": int(used)}
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def read_job(path, job_id):
    """A job's saved record, checked; BadJobFile (or OSError, ValueError) when it can't be used."""
    with open(path) as f:
        job = json.load(f)
    if not isinstance(job, dict) or job.get("id") != job_id or job.get("state") not in TRANSITIONS.keys() | set(
        FINISHED
    ):
        raise BadJobFile("not a job record")
    if not isinstance(job.get("options"), dict) or set(job["options"]) - OPTIONS.keys():
        raise BadJobFile("its options are not ones the node knows")
    if not isinstance(job.get("created"), (int, float)):
        raise BadJobFile("it has no creation time")
    job.pop("canceling", None)  # an internal flag that 0.2.1 and earlier saved
    for name, default in (("progress", 0), ("step", 0), ("started", None), ("finished", None), ("error", None),
                          ("size", None), ("resume", False)):
        job.setdefault(name, default)
    return job


class Node:
    HEARTBEAT_LIMIT = 300  # seconds without a beat from the worker before /health says it is stuck

    def __init__(self, data_dir, trainer, keep_hours=48, stall_minutes=STALL_MINUTES):
        self.jobs_dir = os.path.join(data_dir, "jobs")
        self.trash_dir = os.path.join(data_dir, "trash")
        self.broken_dir = os.path.join(data_dir, "broken")
        self.trainer = trainer
        self.keep_seconds = keep_hours * 3600
        self.stall_seconds = stall_minutes * 60
        self.grace = GRACE_SECONDS
        self.on_worker_death = None
        self.lock = threading.Condition()
        self.trainer_said = None
        # The jobs' state, changed only under the lock
        self.jobs = {}
        self.queue = []
        self.cancel_requested = set()
        self.delete_requested = set()
        self.reserved = 0  # bytes of free space that uploads in progress count on
        self.process = None
        self.stopping = False
        self.worker_died = False
        self.heartbeat = time.monotonic()
        for folder in (self.jobs_dir, self.trash_dir, self.broken_dir):
            os.makedirs(folder, exist_ok=True)
        self.load()
        self.worker = threading.Thread(target=self.run_worker, daemon=True)
        self.worker.start()

    # Jobs on disk

    def path(self, job_id, *names):
        return os.path.join(self.jobs_dir, job_id, *names)

    def save(self, job):
        tmp = self.path(job["id"], "job.json.tmp")
        with open(tmp, "w") as f:
            json.dump(job, f)
        os.replace(tmp, self.path(job["id"], "job.json"))

    def discard(self, path):
        """Move a file or folder into trash/, deleted later by the worker outside the lock (a rename is instant)."""
        try:
            os.replace(path, os.path.join(self.trash_dir, uuid.uuid4().hex))
        except FileNotFoundError:
            pass

    def empty_trash(self):
        for name in os.listdir(self.trash_dir):
            target = os.path.join(self.trash_dir, name)
            if os.path.isdir(target) and not os.path.islink(target):
                shutil.rmtree(target, ignore_errors=True)
            else:
                try:
                    os.remove(target)
                except OSError:
                    pass

    def load(self):
        """The jobs a previous run left: the queued ones wait again, the one that was running has failed."""
        with self.lock:
            self.load_jobs()

    def load_jobs(self):
        for job_id in sorted(os.listdir(self.jobs_dir)):
            folder = self.path(job_id)
            if not os.path.exists(os.path.join(folder, "job.json")):
                self.discard(folder)  # an upload that never finished
                continue
            try:
                job = read_job(os.path.join(folder, "job.json"), job_id)
            except (OSError, ValueError, BadJobFile) as e:
                log(f"Job {job_id}: its job.json can't be used ({e}); moved to broken/")
                try:
                    os.replace(folder, os.path.join(self.broken_dir, job_id))
                except OSError as e:
                    log(f"Job {job_id}: could not be moved to broken/ either ({e})")
                continue
            self.jobs[job_id] = job
            if job["state"] == RUNNING:
                try:
                    self.transition(job_id, FAILED, error="The splat node restarted while this job was training")
                except OSError as e:
                    log(f"Job {job_id}: its failure could not be saved ({e})")
        self.queue = [j["id"] for j in sorted(self.jobs.values(), key=lambda j: j["created"]) if j["state"] == QUEUED]

    # The only place a job's state changes

    def transition(self, job_id, state, **fields):
        """Move a job to a new state (called with the lock held), save it and wake whoever waits.

        The new state is in memory before it is saved: a save that fails (a full disk) raises, but the job has
        still moved on, so nothing stays "running" for it; its file then says so until the next start.
        """
        job = self.jobs[job_id]
        if state not in TRANSITIONS.get(job["state"], ()):
            raise IllegalTransition(f"Job {job_id} can't go from {job['state']} to {state}")
        job.update(fields, state=state)
        if job_id in self.queue:
            self.queue.remove(job_id)
        if state == RUNNING:
            job["started"] = time.time()
        if state in FINISHED:
            job["finished"] = time.time()
            self.cancel_requested.discard(job_id)
            # Only the result and the log are kept: not the dataset, nor the folder the trainer extracted it to
            folder = self.path(job_id)
            for name in os.listdir(folder):
                if name not in KEPT_FILES or (name == MODEL and state != COMPLETED):
                    self.discard(os.path.join(folder, name))
            if state == COMPLETED:
                job.update(progress=100, size=os.path.getsize(self.path(job_id, MODEL)))
        self.lock.notify_all()
        self.save(job)

    def public(self, job):
        out = dict(job, options=dict(job["options"]))
        out["position"] = self.queue.index(job["id"]) + 1 if job["id"] in self.queue else None
        return out

    def get(self, job_id):
        job = self.jobs.get(job_id) if JOB_ID.match(job_id) else None
        if job is None:
            raise Refused(404, "No such job")
        return job

    # The API's actions

    def create(self, options, stream, length):
        need = int(length * DISK_FACTOR)
        with self.lock:
            if need > shutil.disk_usage(self.jobs_dir).free - self.reserved:
                raise Refused(507, "Not enough disk space on the splat node")
            self.reserved += need
        job_id = uuid.uuid4().hex
        try:
            os.makedirs(self.path(job_id))
            dataset = self.path(job_id, "dataset.zip")
            with open(dataset, "wb") as f:
                left = length
                while left > 0:
                    data = stream.read(min(CHUNK, left))
                    if not data:
                        raise Refused(400, "The upload ended early")
                    f.write(data)
                    left -= len(data)
            resume = check_dataset(dataset)
            if resume:
                extract_resume(dataset, self.path(job_id, RESUME))
            job = {
                "id": job_id, "state": QUEUED, "options": options, "progress": 0, "step": 0,
                "created": time.time(), "started": None, "finished": None, "error": None, "size": None,
                "resume": resume,
            }
            self.save(job)
        except BaseException:
            with self.lock:
                self.discard(self.path(job_id))
            raise
        finally:
            with self.lock:
                self.reserved -= need
        with self.lock:
            self.jobs[job_id] = job
            self.queue.append(job_id)
            self.lock.notify_all()
            return self.public(job)

    def cancel(self, job_id):
        with self.lock:
            job = self.get(job_id)
            if job["state"] == QUEUED:
                self.transition(job_id, CANCELED)
            elif job["state"] == RUNNING:
                # The worker stops the trainer, then finishes the job
                self.cancel_requested.add(job_id)
                self.lock.notify_all()
            return self.public(job)

    def delete(self, job_id):
        """Cancel the job and delete its files; a running job's files go once its trainer has stopped."""
        with self.lock:
            job = self.get(job_id)
            if job["state"] == QUEUED:
                self.transition(job_id, CANCELED)
            del self.jobs[job_id]
            if job["state"] == RUNNING:
                self.cancel_requested.add(job_id)
                self.delete_requested.add(job_id)
                self.lock.notify_all()
            else:
                self.discard(self.path(job_id))

    def info(self):
        # The trainer and the GPU are asked outside the lock: a slow nvidia-smi must not hold up the jobs
        with self.lock:
            running = [j["id"] for j in self.jobs.values() if j["state"] == RUNNING]
            queued = len(self.queue)
        return {
            "name": "SplatMe splat node", "version": VERSION, "trainer": self.trainer_version(),
            "gpu": gpu_info(), "running": running[0] if running else None, "queued": queued,
            "options": {n: {"min": s[2], "max": s[3], "default": s[4]} for n, s in OPTIONS.items()},
        }

    def health(self):
        silent = time.monotonic() - self.heartbeat
        ok = self.worker.is_alive() and not self.worker_died and silent < self.HEARTBEAT_LIMIT
        return {"ok": ok, "worker_silent_seconds": round(silent)}

    def trainer_version(self):
        """The trainer's version, asked once (it loads libtorch, which takes seconds); a failure is asked again."""
        if self.trainer_said is None:
            try:
                out = subprocess.run(
                    [self.trainer, "--version"], capture_output=True, text=True, timeout=30, check=False
                )
                if out.returncode == 0 and out.stdout.strip():
                    self.trainer_said = "OpenSplat " + out.stdout.strip()
            except (OSError, subprocess.SubprocessError):
                pass
        return self.trainer_said

    def stop(self):
        with self.lock:
            self.stopping = True
            self.lock.notify_all()

    # The worker: one job at a time

    def beat(self):
        self.heartbeat = time.monotonic()

    def run_worker(self):
        """The worker, supervised: if its loop ends other than by stop(), the node is told (main() exits)."""
        try:
            self.work()
        except BaseException:  # noqa: BLE001 (whatever ended the worker is logged before the node is told)
            log("The worker stopped:\n" + traceback.format_exc())
        if not self.stopping:
            self.worker_died = True
            if self.on_worker_death:
                self.on_worker_death()

    def work(self):
        self.empty_trash()  # what a previous run left
        while not self.stopping:
            self.beat()
            job_id = None
            try:
                job_id = self.next_job()
                if job_id is not None:
                    self.run_job(job_id)
                self.empty_trash()
            except Exception as e:  # noqa: BLE001 (a job's failure must not end the worker)
                log(f"The worker's pass failed (job {job_id}):\n" + traceback.format_exc())
                if job_id is not None:
                    self.fail_quietly(job_id, f"The splat node failed: {e}")
                time.sleep(1)  # an error that repeats does not spin

    def next_job(self):
        """The next job to train, moved to running; None when there is none yet (after a short wait)."""
        with self.lock:
            self.expire()
            if not self.queue:
                self.lock.wait(5)
                return None
            job_id = self.queue[0]
            try:
                self.transition(job_id, RUNNING)  # takes it off the queue
            except Exception as e:  # noqa: BLE001 (saving it failed: the job fails, the worker goes on)
                log(f"Job {job_id} could not start:\n" + traceback.format_exc())
                self.fail_quietly(job_id, f"The splat node failed: {e}")
                return None
            return job_id

    def fail_quietly(self, job_id, error):
        """Fail a job that is still running after an error; never raises (it runs where errors are handled)."""
        try:
            with self.lock:
                job = self.jobs.get(job_id)
                if job is not None and job["state"] == RUNNING:
                    self.transition(job_id, FAILED, error=error)
        except Exception:  # noqa: BLE001
            log(f"Job {job_id} could not be marked failed:\n" + traceback.format_exc())

    def command(self, job):
        cmd = [self.trainer, self.path(job["id"], "dataset.zip"), "-o", self.path(job["id"], MODEL)]
        if job.get("resume"):
            cmd += ["--resume", self.path(job["id"], RESUME)]
        for name, value in job["options"].items():
            cmd += [OPTIONS[name][0], str(value)]
        return cmd

    def run_job(self, job_id):
        with self.lock:
            # Canceled or deleted between being picked and starting
            if job_id in self.cancel_requested:
                self.finish_job(job_id, CANCELED)
                return
            job = self.jobs[job_id]
        folder = self.path(job_id)
        output = {"tail": b"", "last": time.monotonic()}
        with open(os.path.join(folder, "log.txt"), "wb") as log_file:
            # Its own process group: a stop reaches whatever the trainer started
            process = subprocess.Popen(
                self.command(job), cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            with self.lock:
                self.process = process
            reader = threading.Thread(target=self.read_output, args=(job_id, process, log_file, output), daemon=True)
            reader.start()
            why = self.supervise(job_id, process, output)
            reader.join(10)
        with self.lock:
            self.process = None
            code = process.returncode
            if why == CANCELED:
                self.finish_job(job_id, CANCELED)
            elif why is not None:
                self.finish_job(job_id, FAILED, why)
            elif code == 0 and os.path.isfile(os.path.join(folder, MODEL)):
                self.finish_job(job_id, COMPLETED)
            else:
                self.finish_job(job_id, FAILED, explain(code, output["tail"].decode("utf-8", "replace")))

    def finish_job(self, job_id, state, error=None):
        """The end of a job the worker ran (lock held): a deleted job's folder goes, the others are finished."""
        if job_id in self.delete_requested:
            self.delete_requested.discard(job_id)
            self.cancel_requested.discard(job_id)
            self.discard(self.path(job_id))
        else:
            self.transition(job_id, state, error=error)

    def supervise(self, job_id, process, output):
        """Wait for the trainer, stopping it when asked or when it goes silent. Answers why it was stopped."""
        why, term_sent = None, None
        while True:
            try:
                process.wait(timeout=0.2)
                return why
            except subprocess.TimeoutExpired:
                pass
            self.beat()
            now = time.monotonic()
            if why is None:
                with self.lock:
                    if job_id in self.cancel_requested:
                        why = CANCELED
                    elif self.stopping:
                        why = "The splat node was stopped while this job was training"
                if why is None and now - output["last"] > self.stall_seconds:
                    minutes = max(1, round(self.stall_seconds / 60))
                    why = f"The trainer printed nothing for {minutes} minutes and was stopped"
            if why is not None and term_sent is None:
                self.signal(process, signal.SIGTERM)
                term_sent = now
            elif term_sent is not None and now - term_sent > self.grace:
                self.signal(process, signal.SIGKILL)

    @staticmethod
    def signal(process, sig):
        try:
            os.killpg(process.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass

    def read_output(self, job_id, process, log_file, output):
        """The trainer's output into its log, its progress into the job; never raises (a full disk included)."""
        last_saved, understood, warned = 0, False, False
        try:
            for line in process.stdout:
                output["last"] = time.monotonic()
                output["tail"] = (output["tail"] + line)[-4096:]
                try:
                    log_file.write(line)
                    log_file.flush()
                except OSError:
                    pass
                step = step_of(line)
                if step is None:
                    if line.startswith(b"Step ") and not warned:
                        # The trainer's wording changed (tests/opensplat-output.txt is from the pinned commit)
                        log(f"Job {job_id}: a step line the node does not understand: {line[:200]!r}")
                        warned = True
                    continue
                understood = True
                with self.lock:
                    job = self.jobs.get(job_id)
                    if job is None or job["state"] != RUNNING:
                        continue
                    job["step"], job["progress"] = step
                    if time.monotonic() - last_saved > 5:
                        last_saved = time.monotonic()
                        try:
                            self.save(job)
                        except OSError as e:
                            log(f"Job {job_id}: its progress could not be saved ({e})")
        except Exception:  # noqa: BLE001
            log(f"Job {job_id}: its output could not be read:\n" + traceback.format_exc())
        finally:
            process.stdout.close()
        if not understood:
            log(f"Job {job_id}: the trainer printed no step the node understands (no progress was shown)")

    def expire(self):
        """Forget the jobs that finished long ago (called with the lock held); their folders go to the trash."""
        now = time.time()
        for job in list(self.jobs.values()):
            if job["state"] in FINISHED and now - (job["finished"] or now) > self.keep_seconds:
                del self.jobs[job["id"]]
                self.discard(self.path(job["id"]))


class Handler(BaseHTTPRequestHandler):
    server_version = "SplatNode/" + VERSION
    protocol_version = "HTTP/1.1"
    timeout = SOCKET_TIMEOUT

    # (method, path, the method that answers it, whether it needs the token)
    ROUTES = (
        ("GET", r"/health", "health", False),
        ("GET", r"/info", "info", True),
        ("GET", r"/jobs", "list_jobs", True),
        ("POST", r"/jobs", "create_job", True),
        ("GET", r"/jobs/(?P<job_id>[^/]+)", "get_job", True),
        ("DELETE", r"/jobs/(?P<job_id>[^/]+)", "delete_job", True),
        ("POST", r"/jobs/(?P<job_id>[^/]+)/cancel", "cancel_job", True),
        ("GET", r"/jobs/(?P<job_id>[^/]+)/log", "send_log", True),
        ("GET", r"/jobs/(?P<job_id>[^/]+)/result", "send_result", True),
    )
    ROUTES = tuple((method, re.compile(path + r"/?\Z"), name, auth) for method, path, name, auth in ROUTES)

    def log_message(self, fmt, *args):
        log(fmt % args)

    def start_response(self, status, headers):
        self.started = True
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()

    def send_body(self, data):
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_json(self, status, body, headers=()):
        data = json.dumps(body).encode()
        self.start_response(status, {"Content-Type": "application/json", "Content-Length": str(len(data)), **dict(headers)})
        self.send_body(data)

    def handle_request(self):
        self.started = False
        url = urlsplit(self.path)
        params = dict(parse_qsl(url.query))
        method = "GET" if self.command == "HEAD" else self.command
        try:
            matches = [(m, r.match(url.path), name, auth) for m, r, name, auth in self.ROUTES if r.match(url.path)]
            if not matches:
                raise Refused(404, "Not found")
            route = next(((match, name, auth) for m, match, name, auth in matches if m == method), None)
            if route is None:
                allowed = sorted({m for m, *_ in matches} | ({"HEAD"} if any(m == "GET" for m, *_ in matches) else set()))
                return self.send_json(405, {"error": "Method not allowed"}, {"Allow": ", ".join(allowed)})
            match, name, auth = route
            token = self.server.token
            if auth and token:
                given = self.headers.get("Authorization", "")
                if not hmac.compare_digest(given.encode(), ("Bearer " + token).encode()):
                    raise Refused(401, "Wrong or missing token")
            return getattr(self, name)(params, **match.groupdict())
        except Refused as e:
            self.answer_error(e.status, e.message)
        except Exception as e:  # noqa: BLE001 (every request is answered)
            log(f"{self.command} {url.path} failed:\n" + traceback.format_exc())
            full = isinstance(e, OSError) and e.errno == errno.ENOSPC
            self.answer_error(507 if full else 500, f"The splat node failed: {e}")

    def answer_error(self, status, message):
        # A refused upload's body has not been read: the connection can't be reused
        self.close_connection = True
        if self.started:
            return  # the answer had begun: the closed connection tells the client
        try:
            self.send_json(status, {"error": message})
        except OSError:
            pass  # the client is gone

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = handle_request

    # The answers

    def health(self, params):
        status = self.server.node.health()
        self.send_json(200 if status["ok"] else 503, status)

    def info(self, params):
        self.send_json(200, self.server.node.info())

    def list_jobs(self, params):
        node = self.server.node
        with node.lock:
            jobs = [node.public(j) for j in sorted(node.jobs.values(), key=lambda j: j["created"])]
        self.send_json(200, jobs)

    def create_job(self, params):
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise Refused(411, "Content-Length is required") from None
        if length <= 0:
            raise Refused(400, "The request has no dataset")
        options = parse_options(params)
        self.send_json(201, self.server.node.create(options, self.rfile, length))

    def get_job(self, params, job_id):
        node = self.server.node
        with node.lock:
            job = node.public(node.get(job_id))
        self.send_json(200, job)

    def delete_job(self, params, job_id):
        self.server.node.delete(job_id)
        self.send_json(200, {"deleted": True})

    def cancel_job(self, params, job_id):
        self.send_json(200, self.server.node.cancel(job_id))

    def send_log(self, params, job_id):
        node = self.server.node
        with node.lock:
            node.get(job_id)
        try:
            offset = max(0, int(params.get("offset", 0)))
        except ValueError:
            raise Refused(400, "offset must be a number") from None
        try:
            with open(node.path(job_id, "log.txt"), "rb") as f:
                f.seek(offset)
                data = f.read(4 * CHUNK)
        except OSError:
            data = b""
        self.start_response(200, {
            "Content-Type": "text/plain; charset=utf-8", "Content-Length": str(len(data)),
            "X-Log-Offset": str(offset + len(data)),
        })
        self.send_body(data)

    def send_result(self, params, job_id):
        node = self.server.node
        with node.lock:
            state = node.get(job_id)["state"]
        if state != COMPLETED:
            raise Refused(409, f"The job has no result: it is {state}")
        try:
            f = open(node.path(job_id, MODEL), "rb")  # noqa: SIM115 (closed below, once sent)
        except OSError:
            raise Refused(404, "The result was deleted") from None
        with f:
            self.start_response(200, {
                "Content-Type": "application/octet-stream", "Content-Length": str(os.fstat(f.fileno()).st_size),
                "Content-Disposition": 'attachment; filename="model.ply"',
            })
            if self.command != "HEAD":
                shutil.copyfileobj(f, self.wfile, CHUNK)


def make_server(host, port, data_dir, trainer, token="", keep_hours=48, stall_minutes=STALL_MINUTES):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.node = Node(data_dir, trainer, keep_hours, stall_minutes)
    server.token = token
    return server


def setting(env, name, default, minimum):
    """A number from the environment: empty or unset is the default, and so is a wrong value, which is logged."""
    text = env.get(name, "").strip()
    if not text:
        return default
    try:
        value = float(text)
    except ValueError:
        value = None
    if value is None or not math.isfinite(value) or value < minimum:
        log(f"{name}={text!r} is not a number of at least {minimum}: {default} is used")
        return default
    return value


def main():
    env = os.environ
    token = env.get("SPLATNODE_TOKEN", "")
    server = make_server(
        "0.0.0.0", int(env.get("SPLATNODE_PORT", "3100")), env.get("SPLATNODE_DATA", "/var/splatnode"),
        env.get("SPLATNODE_TRAINER", "/opt/opensplat/opensplat"), token,
        setting(env, "SPLATNODE_KEEP_HOURS", 48, 1), setting(env, "SPLATNODE_STALL_MINUTES", STALL_MINUTES, 1),
    )
    if not token:
        log("SPLATNODE_TOKEN is not set: anyone who can reach this port can use the GPU")

    def worker_died():
        # Crash-only: Docker starts the node again, and the start fails the job that was running
        log("The worker has stopped: exiting so the node is started again")
        os._exit(70)

    server.node.on_worker_death = worker_died

    def stop(*_):
        server.node.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log(f"Splat node {VERSION} on port {server.server_address[1]}")
    server.serve_forever()
    # The worker stops the trainer (SIGTERM, then SIGKILL) and finishes its job before the process ends
    server.node.worker.join(GRACE_SECONDS + 5)


if __name__ == "__main__":
    main()
