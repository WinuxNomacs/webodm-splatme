import errno
import http.client
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import splatnode

splatnode.Handler.log_message = lambda *args: None
splatnode.log = lambda message: None  # the failures the tests make happen are logged on purpose
TRAINER = os.path.join(os.path.dirname(__file__), "fake_trainer.py")


def training_zip(
    names=("sparse/0/cameras.bin", "sparse/0/images.bin", "sparse/0/points3D.bin", "images/a.jpg"), resume=None
):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        for name in names:
            z.writestr(name, b"x")
        if resume is not None:
            z.writestr("resume.ply", resume)
    return data.getvalue()


class NodeTestCase(unittest.TestCase):
    token = "secret"

    def setUp(self):
        self.data = tempfile.mkdtemp(prefix="splatnode-test-")
        self.addCleanup(shutil.rmtree, self.data, ignore_errors=True)
        self.addCleanup(os.environ.pop, "FAKE_TRAINER", None)
        self.start()

    def start(self):
        self.server = splatnode.make_server("127.0.0.1", 0, self.data, TRAINER, self.token)
        self.port = self.server.server_address[1]
        # Short deadlines, so the tests that make a trainer misbehave don't wait for the real ones
        self.server.node.grace = 1
        self.server.node.stall_seconds = 60
        self.worker_deaths = []
        self.server.node.on_worker_death = lambda: self.worker_deaths.append(True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.node.stop()
        self.server.shutdown()
        self.server.server_close()
        self.server.node.worker.join(10)

    def request(self, method, path, body=None, token="secret"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        self.addCleanup(conn.close)
        headers = {"Authorization": "Bearer " + token} if token else {}
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        data = response.read()
        if response.getheader("Content-Type") == "application/json" and data:
            data = json.loads(data)
        return response, data

    def create(self, query="steps=20", body=None):
        response, job = self.request("POST", "/jobs?" + query, body=body or training_zip())
        self.assertEqual(response.status, 201, job)
        return job

    def wait(self, job_id, states=splatnode.FINISHED):
        for _ in range(200):
            job = self.request("GET", "/jobs/" + job_id)[1]
            if job["state"] in states:
                return job
            time.sleep(0.05)
        self.fail("The job stayed {}".format(job["state"]))

    def wait_for_a_step(self, job_id):
        """Until the trainer has printed a step: a misbehaving stand-in has then set itself up (SIGTERM ignored)."""
        for _ in range(200):
            if self.request("GET", "/jobs/" + job_id)[1]["step"]:
                return
            time.sleep(0.05)
        self.fail("The trainer printed no step")

    def wait_gone(self, job_id):
        """Until the job's folder is gone (deleted by the worker, outside the lock)."""
        for _ in range(100):
            if not os.path.exists(os.path.join(self.data, "jobs", job_id)):
                return
            time.sleep(0.05)
        self.fail("The job's folder is still there")

    def files(self, job_id):
        return sorted(os.listdir(os.path.join(self.data, "jobs", job_id)))


class TestSplatNode(NodeTestCase):
    def test_a_job_trains_and_its_result_downloads(self):
        job = self.create("steps=40&max_gaussians=1000")
        self.assertEqual(job["state"], "queued")
        job = self.wait(job["id"])
        self.assertEqual((job["state"], job["progress"], job["step"]), ("completed", 100, 40))
        response, data = self.request("GET", "/jobs/{}/result".format(job["id"]))
        self.assertEqual(response.status, 200)
        self.assertEqual(job["size"], len(data))
        self.assertIn(b"--num-iters 40 --max-gaussians 1000", data)

    def test_only_the_result_and_the_log_are_kept(self):
        job = self.wait(self.create()["id"])
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt", "model.ply"])

    def test_a_job_continues_the_model_its_zip_holds(self):
        first = self.wait(self.create("steps=20")["id"])
        model = self.request("GET", "/jobs/{}/result".format(first["id"]))[1]
        job = self.create("steps=50", body=training_zip(resume=model))
        self.assertTrue(job["resume"])
        job = self.wait(job["id"])
        self.assertEqual((job["state"], job["step"]), ("completed", 50))
        log = self.request("GET", "/jobs/{}/log".format(job["id"]))[1].decode()
        self.assertIn("Step 30:", log)
        self.assertNotIn("Step 20:", log)
        data = self.request("GET", "/jobs/{}/result".format(job["id"]))[1]
        self.assertIn(b"at iteration 50", data)
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt", "model.ply"])

    def test_a_model_to_continue_from_that_is_not_a_ply_is_refused_and_leaves_nothing(self):
        response, data = self.request("POST", "/jobs?steps=50", body=training_zip(resume=b"RAD something"))
        self.assertEqual(response.status, 400)
        self.assertIn("not a .ply file", data["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_the_log_is_read_from_an_offset(self):
        job = self.wait(self.create()["id"])
        response, log = self.request("GET", "/jobs/{}/log".format(job["id"]))
        self.assertIn(b"Step 20: 0.2 [100%]", log)
        offset = response.getheader("X-Log-Offset")
        self.assertEqual(int(offset), len(log))
        self.assertEqual(self.request("GET", "/jobs/{}/log?offset={}".format(job["id"], offset))[1], b"")
        self.assertTrue(log.endswith(self.request("GET", "/jobs/{}/log?offset=10".format(job["id"]))[1]))

    def test_a_failed_job_says_what_the_trainer_said(self):
        os.environ["FAKE_TRAINER"] = "fail"
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error"], "The trainer ended with code 1: No cameras see any sparse points")
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt"])
        self.assertEqual(self.request("GET", "/jobs/{}/result".format(job["id"]))[0].status, 409)

    def test_running_out_of_gpu_memory_is_named(self):
        os.environ["FAKE_TRAINER"] = "oom"
        job = self.wait(self.create()["id"])
        self.assertIn("ran out of memory", job["error"])

    def test_jobs_train_one_at_a_time_and_a_queued_job_can_be_canceled(self):
        os.environ["FAKE_TRAINER"] = "slow"
        first, second, third = self.create(), self.create(), self.create()
        self.wait(first["id"], ("running",))
        self.assertEqual(self.request("GET", "/jobs/" + second["id"])[1]["position"], 1)
        self.assertEqual(self.request("GET", "/jobs/" + third["id"])[1]["position"], 2)
        info = self.request("GET", "/info")[1]
        self.assertEqual((info["running"], info["queued"]), (first["id"], 2))
        self.assertEqual(self.request("POST", "/jobs/{}/cancel".format(second["id"]))[1]["state"], "canceled")
        self.assertEqual(self.request("GET", "/jobs/" + third["id"])[1]["position"], 1)

    def test_a_running_job_is_canceled_and_the_next_one_starts(self):
        os.environ["FAKE_TRAINER"] = "slow"
        first, second = self.create(), self.create()
        self.wait(first["id"], ("running",))
        self.request("POST", "/jobs/{}/cancel".format(first["id"]))
        self.assertEqual(self.wait(first["id"])["state"], "canceled")
        self.assertEqual(self.files(first["id"]), ["job.json", "log.txt"])
        self.wait(second["id"], ("running",))

    def test_deleting_a_running_job_stops_it_and_removes_its_files(self):
        os.environ["FAKE_TRAINER"] = "slow"
        job = self.create()
        self.wait(job["id"], ("running",))
        self.assertEqual(self.request("DELETE", "/jobs/" + job["id"])[0].status, 200)
        self.assertEqual(self.request("GET", "/jobs/" + job["id"])[0].status, 404)
        self.wait_gone(job["id"])

    def test_a_restart_keeps_finished_jobs_requeues_waiting_ones_and_fails_the_running_one(self):
        done = self.wait(self.create()["id"])
        os.environ["FAKE_TRAINER"] = "slow"
        running, queued = self.create(), self.create()
        self.wait(running["id"], ("running",))
        # As after a crash: the job on disk still says it is running
        self.server.node.save(dict(self.server.node.jobs[running["id"]]))
        self.stop()
        with open(os.path.join(self.data, "jobs", running["id"], "job.json")) as f:
            saved = json.load(f)
        saved.update(state="running", error=None)
        with open(os.path.join(self.data, "jobs", running["id"], "job.json"), "w") as f:
            json.dump(saved, f)
        os.environ.pop("FAKE_TRAINER")
        self.start()
        self.assertEqual(self.request("GET", "/jobs/" + done["id"])[1]["state"], "completed")
        self.assertEqual(self.request("GET", "/jobs/{}/result".format(done["id"]))[0].status, 200)
        failed = self.request("GET", "/jobs/" + running["id"])[1]
        self.assertEqual((failed["state"], failed["error"]),
                         ("failed", "The splat node restarted while this job was training"))
        self.assertEqual(self.wait(queued["id"])["state"], "completed")

    def test_a_finished_job_is_deleted_after_the_keep_time(self):
        job = self.wait(self.create()["id"])
        node = self.server.node
        with node.lock:
            node.jobs[job["id"]]["finished"] -= node.keep_seconds + 1
            node.expire()
        self.assertEqual(self.request("GET", "/jobs/" + job["id"])[0].status, 404)
        self.assertFalse(os.path.exists(os.path.join(self.data, "jobs", job["id"])))

    def test_finished_jobs_are_also_deleted_while_jobs_keep_coming(self):
        old = self.wait(self.create()["id"])
        node = self.server.node
        os.environ["FAKE_TRAINER"] = "slow"
        busy = self.create()
        self.wait(busy["id"], ("running",))
        with node.lock:
            node.jobs[old["id"]]["finished"] -= node.keep_seconds + 1
        # The worker goes from one job to the next without waiting for an empty queue
        following = self.create()
        os.environ.pop("FAKE_TRAINER")
        self.request("POST", "/jobs/{}/cancel".format(busy["id"]))
        self.wait(following["id"])
        self.assertEqual(self.request("GET", "/jobs/" + old["id"])[0].status, 404)

    def test_a_request_without_the_token_is_refused(self):
        for token in ("", "wrong"):
            self.assertEqual(self.request("GET", "/info", token=token)[0].status, 401)
            self.assertEqual(self.request("POST", "/jobs", body=training_zip(), token=token)[0].status, 401)
        self.assertEqual(self.request("GET", "/health", token="")[0].status, 200)
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_info_names_the_trainer_and_the_options(self):
        info = self.request("GET", "/info")[1]
        self.assertEqual(info["trainer"], "OpenSplat 9.9.9")
        self.assertEqual(info["options"]["steps"], {"min": 1, "max": 200000, "default": 7000})

    def test_info_asks_the_trainer_its_version_once_and_answers_while_the_jobs_are_locked(self):
        node = self.server.node
        self.request("GET", "/info")
        node.trainer = "/nonexistent"  # asked again, it would now say nothing
        with node.lock:
            # A job's lock held elsewhere (saving a job, a poll) does not keep the GPU's and trainer's part waiting
            self.assertEqual(node.trainer_version(), "OpenSplat 9.9.9")
        self.assertEqual(self.request("GET", "/info")[1]["trainer"], "OpenSplat 9.9.9")

    def test_a_dataset_that_is_not_a_training_zip_is_refused_and_leaves_nothing(self):
        for body, message in (
            (b"not a zip", "not a zip file"),
            (training_zip(("images/a.jpg",)), "no sparse/0/cameras.bin"),
            (training_zip(splatnode.REQUIRED_FILES), "no images"),
            (training_zip(splatnode.REQUIRED_FILES + ("images/a.jpg", "../evil")), "unsafe file name"),
        ):
            response, data = self.request("POST", "/jobs", body=body)
            self.assertEqual(response.status, 400)
            self.assertIn(message, data["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_an_option_that_is_unknown_or_out_of_range_is_refused(self):
        for query in ("steps=0", "steps=many", "sh_degree=4", "center=1"):
            response = self.request("POST", "/jobs?" + query, body=training_zip())[0]
            self.assertEqual(response.status, 400, query)
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_an_unknown_job_or_path_is_not_found(self):
        self.assertEqual(self.request("GET", "/jobs/" + "0" * 32)[0].status, 404)
        self.assertEqual(self.request("GET", "/jobs/..%2F..")[0].status, 404)
        self.assertEqual(self.request("GET", "/nothing")[0].status, 404)


def failing_once(original, when, error=None):
    """original, except that its first call for which when(*args) is true raises error (a full disk)."""
    state = {"failed": False}

    def wrapper(*args, **kwargs):
        if not state["failed"] and when(*args):
            state["failed"] = True
            raise error or OSError(errno.ENOSPC, "No space left on device")
        return original(*args, **kwargs)

    return wrapper


class TestFailures(NodeTestCase):
    """Each failure is made to happen: the node must end it with a clear message and keep working."""

    def patch(self, owner, name, value):
        original = getattr(owner, name)
        setattr(owner, name, value)
        self.addCleanup(setattr, owner, name, original)
        return original

    def test_a_full_disk_as_a_job_starts_fails_that_job_and_the_next_one_trains(self):
        node = self.server.node
        self.patch(type(node), "save", failing_once(type(node).save, lambda _, job: job["state"] == "running"))
        first = self.wait(self.create()["id"])
        self.assertEqual(first["state"], "failed")
        self.assertIn("No space left on device", first["error"])
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")
        self.assertEqual(self.request("GET", "/health", token="")[0].status, 200)

    def test_a_full_disk_as_a_job_ends_does_not_stop_the_next_one(self):
        node = self.server.node
        self.patch(type(node), "save", failing_once(type(node).save, lambda _, job: job["state"] == "completed"))
        first = self.wait(self.create()["id"])
        self.assertIn(first["state"], splatnode.FINISHED)
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_a_full_disk_during_an_upload_is_answered_and_leaves_nothing(self):
        self.patch(splatnode, "check_dataset", failing_once(splatnode.check_dataset, lambda *_: True))
        response, data = self.request("POST", "/jobs?steps=20", body=training_zip())
        self.assertEqual(response.status, 507)
        self.assertIn("No space left on device", data["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_an_unexpected_error_is_answered_with_its_message(self):
        self.patch(type(self.server.node), "info", lambda self: 1 / 0)
        response, data = self.request("GET", "/info")
        self.assertEqual(response.status, 500)
        self.assertIn("division by zero", data["error"])

    def test_a_damaged_job_file_is_set_aside_and_the_node_starts(self):
        good, damaged, unreadable = (self.wait(self.create()["id"]) for _ in range(3))
        self.stop()
        with open(os.path.join(self.data, "jobs", damaged["id"], "job.json"), "w") as f:
            f.write('{"id": "x"}')
        with open(os.path.join(self.data, "jobs", unreadable["id"], "job.json"), "w") as f:
            f.write("not json")
        self.start()
        self.assertEqual(self.request("GET", "/jobs/" + good["id"])[1]["state"], "completed")
        for job in (damaged, unreadable):
            self.assertEqual(self.request("GET", "/jobs/" + job["id"])[0].status, 404)
        self.assertEqual(sorted(os.listdir(os.path.join(self.data, "broken"))), sorted([damaged["id"], unreadable["id"]]))
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_a_trainer_that_ignores_sigterm_is_killed_after_the_grace_period(self):
        os.environ["FAKE_TRAINER"] = "stubborn"
        job = self.create()
        self.wait_for_a_step(job["id"])
        canceling = self.request("POST", "/jobs/{}/cancel".format(job["id"]))[1]
        self.assertNotIn("canceling", canceling)
        self.assertEqual(self.wait(job["id"])["state"], "canceled")
        os.environ.pop("FAKE_TRAINER")
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_deleting_a_job_whose_trainer_ignores_sigterm_answers_at_once(self):
        os.environ["FAKE_TRAINER"] = "stubborn"
        job = self.create()
        self.wait_for_a_step(job["id"])
        started = time.monotonic()
        self.assertEqual(self.request("DELETE", "/jobs/" + job["id"])[0].status, 200)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(self.request("GET", "/jobs/" + job["id"])[0].status, 404)
        self.wait_gone(job["id"])

    def test_stopping_the_node_ends_a_trainer_that_ignores_sigterm(self):
        os.environ["FAKE_TRAINER"] = "stubborn"
        job = self.create()
        self.wait_for_a_step(job["id"])
        process = self.server.node.process
        self.stop()
        self.assertIsNotNone(process.poll())
        self.assertFalse(self.server.node.worker.is_alive())

    def test_a_trainer_that_goes_silent_is_stopped_and_its_job_says_why(self):
        self.server.node.stall_seconds = 1
        os.environ["FAKE_TRAINER"] = "silent"
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "failed")
        self.assertIn("printed nothing for", job["error"])

    def test_an_upload_that_stalls_is_dropped_and_leaves_nothing(self):
        self.assertIsNotNone(splatnode.Handler.timeout)
        self.patch(splatnode.Handler, "timeout", 0.5)
        stalled = socket.create_connection(("127.0.0.1", self.port))
        self.addCleanup(stalled.close)
        stalled.sendall(b"POST /jobs HTTP/1.1\r\nAuthorization: Bearer secret\r\nContent-Length: 100000\r\n\r\nxx")
        time.sleep(0.2)
        self.assertEqual(len(os.listdir(os.path.join(self.data, "jobs"))), 1)
        time.sleep(1)
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_two_uploads_at_once_cannot_count_on_the_same_free_space(self):
        body = training_zip()
        usage = shutil.disk_usage(self.data)
        self.patch(splatnode.shutil, "disk_usage", lambda _: usage._replace(free=int(len(body) * 4)))
        first = socket.create_connection(("127.0.0.1", self.port))
        self.addCleanup(first.close)
        headers = f"POST /jobs HTTP/1.1\r\nAuthorization: Bearer secret\r\nContent-Length: {len(body)}\r\n\r\n"
        first.sendall(headers.encode() + body[:10])
        time.sleep(0.2)
        response, data = self.request("POST", "/jobs?steps=20", body=body)
        self.assertEqual(response.status, 507, data)

    def test_when_the_worker_thread_ends_health_says_so_and_the_node_is_told(self):
        node = self.server.node
        self.patch(type(node), "next_job", lambda self: (_ for _ in ()).throw(SystemExit()))
        with node.lock:
            node.lock.notify_all()
        self.create()
        node.worker.join(5)
        self.assertFalse(node.worker.is_alive())
        self.assertEqual(self.worker_deaths, [True])
        response, data = self.request("GET", "/health", token="")
        self.assertEqual(response.status, 503)
        self.assertFalse(data["ok"])

    def test_a_worker_that_stops_beating_shows_in_health(self):
        node = self.server.node
        node.heartbeat -= node.HEARTBEAT_LIMIT + 1
        self.patch(type(node), "beat", lambda self: None)
        self.assertEqual(self.request("GET", "/health", token="")[0].status, 503)

    def test_an_illegal_state_change_is_refused(self):
        job = self.wait(self.create()["id"])
        with self.assertRaises(splatnode.IllegalTransition):
            self.server.node.transition(job["id"], "running")
        self.assertEqual(self.request("GET", "/jobs/" + job["id"])[1]["state"], "completed")

    def test_a_job_is_answered_while_a_finished_jobs_files_are_deleted(self):
        real, deleting = shutil.rmtree, threading.Event()

        def slow_rmtree(*args, **kwargs):  # as the photos of a large task take
            deleting.set()
            time.sleep(2)
            real(*args, **kwargs)

        self.patch(splatnode.shutil, "rmtree", slow_rmtree)
        job = self.create()
        self.assertTrue(deleting.wait(10))
        started = time.monotonic()
        self.request("GET", "/jobs/" + job["id"])
        self.assertLess(time.monotonic() - started, 1)

    def test_a_wrong_method_is_told_what_is_allowed_and_head_answers_like_get(self):
        response, data = self.request("PUT", "/jobs")
        self.assertEqual(response.status, 405)
        self.assertEqual(response.getheader("Allow"), "GET, HEAD, POST")
        response, data = self.request("HEAD", "/health", token="")
        self.assertEqual((response.status, data), (200, b""))


class TestTrainerOutput(unittest.TestCase):
    """OpenSplat's own words. opensplat-output.txt is a real run at the node's pinned commit (HomerunObliqueRGB, 959
    photos at 1,600 px, 3,000 steps, 2026-11-16), as it printed it. opensplat-out-of-memory.txt is what an uncaught
    allocation failure prints, its message taken from the pinned libtorch (libc10_cuda.so): this GPU, under WSL,
    spills into the computer's memory instead of running out. Capture both again when the pin changes."""

    def lines(self, name):
        with open(os.path.join(os.path.dirname(__file__), name), "rb") as f:
            return f.read().splitlines(keepends=True)

    def test_every_step_line_of_a_real_run_gives_its_step_and_progress(self):
        lines = self.lines("opensplat-output.txt")
        steps = [splatnode.step_of(line) for line in lines]
        found = [s for s in steps if s is not None]
        self.assertEqual(len(found), sum(1 for line in lines if line.startswith(b"Step ")))
        self.assertEqual(found[0], (10, 0))
        self.assertEqual(found[-1], (3000, 100))
        self.assertEqual(found, sorted(found))

    def test_a_real_run_that_ended_badly_is_not_called_out_of_memory(self):
        tail = b"".join(self.lines("opensplat-output.txt")[-5:]).decode()
        self.assertEqual(splatnode.explain(1, tail), "The trainer ended with code 1: Wrote model.ply")

    def test_running_out_of_gpu_memory_is_named(self):
        tail = b"".join(self.lines("opensplat-out-of-memory.txt")).decode()
        self.assertIn("ran out of memory", splatnode.explain(-6, tail))


if __name__ == "__main__":
    unittest.main()
