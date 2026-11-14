#!/usr/bin/env python3
"""The splat node: an HTTP service that trains Gaussian splats from a WebODM training zip with OpenSplat.

Python's standard library only. One job trains at a time (one GPU); the others wait in a queue.

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

Every request but GET /health carries "Authorization: Bearer <token>" when SPLATNODE_TOKEN is set.

Settings (environment): SPLATNODE_PORT (3100), SPLATNODE_TOKEN, SPLATNODE_DATA (/var/splatnode),
SPLATNODE_TRAINER (/opt/opensplat/opensplat), SPLATNODE_KEEP_HOURS (48: a finished job is deleted after that).
"""

import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

VERSION = "0.2.0"

QUEUED, RUNNING, COMPLETED, FAILED, CANCELED = "queued", "running", "completed", "failed", "canceled"
FINISHED = (COMPLETED, FAILED, CANCELED)

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
STEP_LINE = re.compile(rb"^Step (\d+): \S+ \[(\d+)%\]")
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
CHUNK = 1 << 20


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


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


class Node:
    def __init__(self, data_dir, trainer, keep_hours=48):
        self.jobs_dir = os.path.join(data_dir, "jobs")
        self.trainer = trainer
        self.keep_seconds = keep_hours * 3600
        self.lock = threading.Condition()
        self.jobs = {}
        self.queue = []
        self.process = None
        self.stopping = False
        os.makedirs(self.jobs_dir, exist_ok=True)
        self.load()
        self.worker = threading.Thread(target=self.work, daemon=True)
        self.worker.start()

    # Jobs on disk

    def path(self, job_id, *names):
        return os.path.join(self.jobs_dir, job_id, *names)

    def save(self, job):
        tmp = self.path(job["id"], "job.json.tmp")
        with open(tmp, "w") as f:
            json.dump(job, f)
        os.replace(tmp, self.path(job["id"], "job.json"))

    def load(self):
        """The jobs a previous run left: the queued ones wait again, the one that was running has failed."""
        for job_id in sorted(os.listdir(self.jobs_dir)):
            try:
                with open(self.path(job_id, "job.json")) as f:
                    job = json.load(f)
            except (OSError, ValueError):
                # An upload that never finished
                shutil.rmtree(self.path(job_id), ignore_errors=True)
                continue
            if job["state"] == RUNNING:
                self.finish(job, FAILED, "The splat node restarted while this job was training")
            self.jobs[job["id"]] = job
        self.queue = [j["id"] for j in sorted(self.jobs.values(), key=lambda j: j["created"]) if j["state"] == QUEUED]

    def finish(self, job, state, error=None):
        job.update(state=state, error=error, finished=time.time())
        # Only the result and the log are kept: not the dataset, nor the folder the trainer extracted it to
        folder = self.path(job["id"])
        for name in os.listdir(folder):
            if name not in KEPT_FILES or (name == MODEL and state != COMPLETED):
                target = os.path.join(folder, name)
                if os.path.isdir(target):
                    shutil.rmtree(target, ignore_errors=True)
                else:
                    os.remove(target)
        if state == COMPLETED:
            job["size"] = os.path.getsize(self.path(job["id"], MODEL))
        self.save(job)

    # The API's actions

    def create(self, options, stream, length):
        free = shutil.disk_usage(self.jobs_dir).free
        # The trainer extracts the zip beside it
        if length * 2.5 > free:
            raise Refused(507, "Not enough disk space on the splat node")
        job_id = uuid.uuid4().hex
        os.makedirs(self.path(job_id))
        dataset = self.path(job_id, "dataset.zip")
        try:
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
        except BaseException:
            shutil.rmtree(self.path(job_id), ignore_errors=True)
            raise
        job = {
            "id": job_id, "state": QUEUED, "options": options, "progress": 0, "step": 0, "created": time.time(),
            "started": None, "finished": None, "error": None, "size": None, "resume": resume,
        }
        with self.lock:
            self.save(job)
            self.jobs[job_id] = job
            self.queue.append(job_id)
            self.lock.notify_all()
            return self.public(job)

    def public(self, job):
        out = dict(job)
        out["position"] = self.queue.index(job["id"]) + 1 if job["id"] in self.queue else None
        return out

    def get(self, job_id):
        job = self.jobs.get(job_id) if JOB_ID.match(job_id) else None
        if job is None:
            raise Refused(404, "No such job")
        return job

    def cancel(self, job_id):
        with self.lock:
            job = self.get(job_id)
            if job["state"] == QUEUED:
                self.queue.remove(job_id)
                self.finish(job, CANCELED)
            elif job["state"] == RUNNING:
                job["canceling"] = True
                if self.process is not None:
                    self.process.terminate()
            return self.public(job)

    def delete(self, job_id):
        self.cancel(job_id)
        with self.lock:
            # A running job's files go once its trainer has stopped
            while self.get(job_id)["state"] == RUNNING:
                self.lock.wait(1)
            del self.jobs[job_id]
        shutil.rmtree(self.path(job_id), ignore_errors=True)

    def info(self):
        with self.lock:
            running = [j["id"] for j in self.jobs.values() if j["state"] == RUNNING]
            return {
                "name": "SplatMe splat node", "version": VERSION, "trainer": self.trainer_version(),
                "gpu": gpu_info(), "running": running[0] if running else None, "queued": len(self.queue),
                "options": {n: {"min": s[2], "max": s[3], "default": s[4]} for n, s in OPTIONS.items()},
            }

    def trainer_version(self):
        try:
            out = subprocess.run(
                [self.trainer, "--version"], capture_output=True, text=True, timeout=30, check=False
            )
            return ("OpenSplat " + out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None
        except (OSError, subprocess.SubprocessError):
            return None

    # The worker: one job at a time

    def work(self):
        while True:
            with self.lock:
                while not self.queue and not self.stopping:
                    self.lock.wait(60)
                    self.expire()
                if self.stopping:
                    return
                job = self.jobs[self.queue.pop(0)]
                job.update(state=RUNNING, started=time.time())
                self.save(job)
            try:
                self.train(job)
            except Exception as e:  # noqa: BLE001 (a job's failure must not end the worker)
                with self.lock:
                    self.finish(job, FAILED, f"The splat node failed: {e}")
                    self.lock.notify_all()

    def command(self, job):
        cmd = [self.trainer, self.path(job["id"], "dataset.zip"), "-o", self.path(job["id"], MODEL)]
        if job.get("resume"):
            cmd += ["--resume", self.path(job["id"], RESUME)]
        for name, value in job["options"].items():
            cmd += [OPTIONS[name][0], str(value)]
        return cmd

    def train(self, job):
        folder = self.path(job["id"])
        tail = b""
        with open(os.path.join(folder, "log.txt"), "wb") as log:
            with self.lock:
                if job.get("canceling"):
                    self.finish(job, CANCELED)
                    self.lock.notify_all()
                    return
                self.process = process = subprocess.Popen(
                    self.command(job), cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
                )
            last_saved = 0
            for line in process.stdout:
                log.write(line)
                log.flush()
                tail = (tail + line)[-4096:]
                step = STEP_LINE.match(line)
                if step:
                    job["step"], job["progress"] = int(step.group(1)), int(step.group(2))
                    if time.time() - last_saved > 5:
                        last_saved = time.time()
                        with self.lock:
                            self.save(job)
            process.stdout.close()
            code = process.wait()
        with self.lock:
            self.process = None
            if job.pop("canceling", False):
                self.finish(job, CANCELED)
            elif self.stopping:
                self.finish(job, FAILED, "The splat node was stopped while this job was training")
            elif code == 0 and os.path.isfile(os.path.join(folder, MODEL)):
                job["progress"] = 100
                self.finish(job, COMPLETED)
            else:
                self.finish(job, FAILED, self.explain(code, tail.decode("utf-8", "replace")))
            self.lock.notify_all()

    @staticmethod
    def explain(code, tail):
        if "out of memory" in tail.lower():
            return "The GPU ran out of memory. Try a smaller image size or fewer gaussians."
        lines = [line.strip() for line in tail.splitlines() if line.strip()]
        how = "was killed by signal %s" % -code if code < 0 else f"ended with code {code}"
        return "The trainer {}{}".format(how, ": " + lines[-1][:500] if lines else "")

    def expire(self):
        """Delete the jobs that finished long ago (called with the lock held)."""
        now = time.time()
        for job in list(self.jobs.values()):
            if job["state"] in FINISHED and now - (job["finished"] or now) > self.keep_seconds:
                del self.jobs[job["id"]]
                shutil.rmtree(self.path(job["id"]), ignore_errors=True)

    def stop(self):
        with self.lock:
            self.stopping = True
            if self.process is not None:
                self.process.terminate()
            self.lock.notify_all()


class Handler(BaseHTTPRequestHandler):
    server_version = "SplatNode/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.log_date_time_string()} {fmt % args}\n")

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        node, token = self.server.node, self.server.token
        url = urlsplit(self.path)
        parts = [p for p in url.path.split("/") if p]
        params = dict(parse_qsl(url.query))
        method = self.command
        try:
            if method == "GET" and parts == ["health"]:
                return self.send_json(200, {"ok": True})
            if token:
                given = self.headers.get("Authorization", "")
                if not hmac.compare_digest(given.encode(), ("Bearer " + token).encode()):
                    raise Refused(401, "Wrong or missing token")
            if method == "GET" and parts == ["info"]:
                return self.send_json(200, node.info())
            if parts[:1] != ["jobs"] or len(parts) > 3:
                raise Refused(404, "Not found")
            if len(parts) == 1:
                if method == "GET":
                    with node.lock:
                        jobs = sorted(node.jobs.values(), key=lambda j: j["created"])
                        return self.send_json(200, [node.public(j) for j in jobs])
                if method == "POST":
                    return self.create_job(params)
                raise Refused(405, "Method not allowed")
            job_id, action = parts[1], parts[2] if len(parts) == 3 else None
            if action is None and method == "GET":
                with node.lock:
                    return self.send_json(200, node.public(node.get(job_id)))
            if action is None and method == "DELETE":
                node.delete(job_id)
                return self.send_json(200, {"deleted": True})
            if action == "cancel" and method == "POST":
                return self.send_json(200, node.cancel(job_id))
            if action == "log" and method == "GET":
                return self.send_log(job_id, params)
            if action == "result" and method == "GET":
                return self.send_result(job_id)
            raise Refused(404 if action not in (None, "cancel", "log", "result") else 405, "Not found")
        except Refused as e:
            # A refused upload's body has not been read: the connection can't be reused
            self.close_connection = True
            self.send_json(e.status, {"error": e.message})

    do_GET = do_POST = do_DELETE = handle_request

    def create_job(self, params):
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise Refused(411, "Content-Length is required") from None
        if length <= 0:
            raise Refused(400, "The request has no dataset")
        options = parse_options(params)
        self.send_json(201, self.server.node.create(options, self.rfile, length))

    def send_log(self, job_id, params):
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
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Log-Offset", str(offset + len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_result(self, job_id):
        node = self.server.node
        with node.lock:
            if node.get(job_id)["state"] != COMPLETED:
                raise Refused(409, "The job has no result: it is {}".format(node.get(job_id)["state"]))
        try:
            f = open(node.path(job_id, MODEL), "rb")  # noqa: SIM115 (closed below, once sent)
        except OSError:
            raise Refused(404, "The result was deleted") from None
        with f:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(os.fstat(f.fileno()).st_size))
            self.send_header("Content-Disposition", 'attachment; filename="model.ply"')
            self.end_headers()
            shutil.copyfileobj(f, self.wfile, CHUNK)


def make_server(host, port, data_dir, trainer, token="", keep_hours=48):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.node = Node(data_dir, trainer, keep_hours)
    server.token = token
    return server


def main():
    env = os.environ
    token = env.get("SPLATNODE_TOKEN", "")
    server = make_server(
        "0.0.0.0", int(env.get("SPLATNODE_PORT", "3100")), env.get("SPLATNODE_DATA", "/var/splatnode"),
        env.get("SPLATNODE_TRAINER", "/opt/opensplat/opensplat"), token, float(env.get("SPLATNODE_KEEP_HOURS", "48")),
    )
    if not token:
        print("SPLATNODE_TOKEN is not set: anyone who can reach this port can use the GPU", file=sys.stderr)

    def stop(*_):
        server.node.stop()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(f"Splat node {VERSION} on port {server.server_address[1]}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
