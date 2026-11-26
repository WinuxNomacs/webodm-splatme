import errno
import http.client
import io
import json
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from unittest import mock

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


def fixture(name):
    with open(os.path.join(os.path.dirname(__file__), name), "rb") as f:
        return f.read()


def make_ply(properties, rows, comment="comment made by a test", kinds=None, vertices=None):
    """A binary little-endian .ply of float properties (or kinds[name]), one row of values per vertex."""
    kinds = kinds or {}
    codes = {"float": "f", "uchar": "B", "double": "d"}
    head = ["ply", "format binary_little_endian 1.0", comment, f"element vertex {len(rows) if vertices is None else vertices}"]
    head += [f"property {kinds.get(name, 'float')} {name}" for name in properties] + ["end_header", ""]
    record = struct.Struct("<" + "".join(codes[kinds.get(name, "float")] for name in properties))
    return "\n".join(head).encode() + b"".join(record.pack(*row) for row in rows)


def splat_properties(degree=3, normals=False):
    rest = 3 * ((degree + 1) ** 2 - 1)
    return ["x", "y", "z", *(["nx", "ny", "nz"] if normals else []), "f_dc_0", "f_dc_1", "f_dc_2",
            *(f"f_rest_{i}" for i in range(rest)), "opacity", "scale_0", "scale_1", "scale_2",
            "rot_0", "rot_1", "rot_2", "rot_3"]


def read_ply(data):
    """{name: [values]} and the header's lines, of a float-only .ply."""
    end = data.index(b"end_header\n") + len(b"end_header\n")
    lines = data[:end].decode().split("\n")
    names = [line.split()[2] for line in lines if line.startswith("property ")]
    count = int(next(line for line in lines if line.startswith("element vertex")).split()[2])
    values = struct.unpack(f"<{count * len(names)}f", data[end:end + 4 * count * len(names)])
    return {name: list(values[i::len(names)]) for i, name in enumerate(names)}, lines


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

    def test_the_trainer_is_given_the_dataset_unpacked_by_the_node_and_its_zip_is_gone(self):
        # The stand-in trainer refuses a zip, and a folder whose zip is still there
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "completed", job["error"])
        log = self.request("GET", "/jobs/{}/log".format(job["id"]))[1].decode()
        self.assertIn("[splat node] Unpacking the dataset: 4 files", log)
        self.assertIn("[splat node] Unpacked in", log)

    def test_a_zip_with_zip64_offsets_under_4_gib_trains(self):
        # WebODM's export (zipstream-ng) gives every entry past 2 GiB a ZIP64 offset; OpenSplat's own reader refuses
        # such a zip under about 4.29 GB. A lower limit while writing gives a small zip of the same shape.
        with mock.patch.object(zipfile, "ZIP64_LIMIT", 100):
            body = training_zip(splatnode.REQUIRED_FILES + tuple(f"images/{i}.jpg" for i in range(40)))
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            self.assertTrue(any(info.extra[:2] == b"\x01\x00" for info in z.infolist()))  # a ZIP64 extra field
        job = self.wait(self.create(body=body)["id"])
        self.assertEqual(job["state"], "completed", job["error"])

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
        self.assertEqual(info["trainer_kind"], "opensplat")
        self.assertEqual(info["supports"], {"masks": True, "continue": True})

    def test_a_completed_job_says_the_steps_its_model_was_trained_to(self):
        job = self.wait(self.create("steps=40")["id"])
        self.assertEqual((job["state"], job["trained_steps"]), ("completed", 40))

    def test_an_unknown_trainer_kind_stops_the_node_at_start_and_names_the_kinds(self):
        said = []
        with mock.patch.dict(os.environ, {"SPLATNODE_TRAINER_KIND": "brush", "SPLATNODE_DATA": self.data}), \
                mock.patch.object(splatnode, "log", said.append), mock.patch.object(splatnode, "make_server") as made, \
                self.assertRaises(SystemExit) as stopped:
            splatnode.main()
        self.assertEqual(stopped.exception.code, 2)
        made.assert_not_called()
        self.assertEqual(said, ["SPLATNODE_TRAINER_KIND='brush' is not a trainer this node has (lichtfeld, opensplat)"])

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

    def test_grow_until_reaches_the_trainer_only_when_given(self):
        job = self.wait(self.create("steps=5000&densify_until=2000")["id"])
        data = self.request("GET", "/jobs/{}/result".format(job["id"]))[1]
        self.assertIn(b"--num-iters 5000 --densify-until 2000", data)
        job = self.wait(self.create("steps=5000")["id"])
        data = self.request("GET", "/jobs/{}/result".format(job["id"]))[1]
        self.assertNotIn(b"--densify-until", data)

    def test_grow_until_that_leaves_fewer_than_3000_steps_after_it_is_refused(self):
        for query in ("steps=50000&densify_until=999", "densify_until=4001", "steps=3999&densify_until=1000",
                      "steps=5000&densify_until=2001"):
            response, answer = self.request("POST", "/jobs?" + query, body=training_zip())
            self.assertEqual(response.status, 400, query)
        self.assertIn("at most 2000", answer["error"])
        response, answer = self.request("POST", "/jobs?steps=3999&densify_until=1000", body=training_zip())
        self.assertIn("needs steps of 4000 or more", answer["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])
        self.assertEqual(self.create("densify_until=4000")["options"], {"steps": 7000, "densify_until": 4000})

    def test_a_job_keeps_the_clients_ref_and_is_found_by_it(self):
        job = self.create("steps=20&ref=run-1_a")
        self.create("steps=20&ref=other")
        self.assertEqual(job["ref"], "run-1_a")
        found = self.request("GET", "/jobs?ref=run-1_a")[1]
        self.assertEqual([j["id"] for j in found], [job["id"]])
        self.assertEqual(len(self.request("GET", "/jobs")[1]), 2)
        self.assertEqual(self.request("GET", "/jobs?ref=nothing")[1], [])

    def test_a_ref_that_is_not_a_short_name_is_refused(self):
        for ref in ("a%20b", "x" * 65, "..%2Fx"):
            response = self.request("POST", "/jobs?ref=" + ref, body=training_zip())[0]
            self.assertEqual(response.status, 400, ref)
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


class TestContinuingModels(NodeTestCase):
    """A model to continue from, whichever trainer wrote it (plan 25a), on an OpenSplat node."""

    def resume_args(self, job):
        return self.request("GET", "/jobs/{}/result".format(job["id"]))[1].split(b"\nargs ")[1].decode()

    def test_info_says_what_a_model_needs_for_it_to_be_continued(self):
        info = self.request("GET", "/info")[1]
        self.assertEqual(info["continue_from"], {"properties": list(splatnode.SPLAT_PROPERTIES), "sh_degrees": [1, 2, 3]})
        self.assertIn("resume_steps", info["options"])

    def test_a_lichtfeld_model_is_rewritten_in_opensplats_form_and_continued_from_its_steps(self):
        job = self.wait(self.create("steps=60&resume_steps=30", body=training_zip(resume=fixture("lichtfeld-model.ply")))["id"])
        self.assertEqual((job["state"], job["step"]), ("completed", 60), job["error"])
        log = self.request("GET", "/jobs/{}/log".format(job["id"]))[1].decode()
        self.assertIn("Step 40:", log)
        self.assertNotIn("Step 30:", log)
        self.assertIn("--sh-degree 3", self.resume_args(job))  # the model's degree, from its 45 f_rest_
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt", "model.ply"])

    def test_opensplats_own_model_is_continued_as_it_is_from_its_own_steps(self):
        model = fixture("opensplat-model.ply")
        job = self.create("steps=600&resume_steps=7", body=training_zip(resume=model))
        self.assertEqual((job["resume_step"], job["resume_rewrite"]), (500, False))
        job = self.wait(job["id"])
        self.assertEqual(job["state"], "completed", job["error"])
        self.assertIn("Step 510:", self.request("GET", "/jobs/{}/log".format(job["id"]))[1].decode())

    def test_the_rewrite_keeps_every_splat_value_and_drops_what_opensplat_does_not_read(self):
        properties = ["red", *splat_properties(degree=1), "extra"]
        rows = [(200, *[float(i + 10 * v) for i in range(len(properties) - 2)], 7.0) for v in range(3)]
        path = os.path.join(self.data, "model.ply")
        with open(path, "wb") as f:
            f.write(make_ply(properties, rows, kinds={"red": "uchar", "extra": "double"}))
        splatnode.rewrite_for_opensplat(path, splatnode.read_ply_header(path), 1234, lambda: None)
        with open(path, "rb") as f:
            values, lines = read_ply(f.read())
        self.assertEqual(lines[2], "comment Generated by opensplat at iteration 1234")
        self.assertEqual(list(values), splatnode.opensplat_properties(1))
        for i, name in enumerate(splat_properties(degree=1)):
            self.assertEqual(values[name], [float(i + 10 * v) for v in range(3)], name)
        self.assertEqual(values["nx"], [0.0, 0.0, 0.0])
        with open(path, "rb") as f:
            self.assertEqual(splatnode.opensplat_step(splatnode.read_ply_header(path)), 1234)
        self.assertEqual(os.listdir(self.data).count("model.ply.rewrite"), 0)

    def test_the_fast_rewrite_of_float_models_matches_the_general_one(self):
        properties = splat_properties(degree=2, normals=True)
        rows = [tuple(float(v * 1000 + i) for i in range(len(properties))) for v in range(splatnode.REWRITE_CHUNK + 5)]
        paths = []
        for name, extra in (("fast", []), ("general", ["extra"])):  # a double the rewrite drops: the general path
            path = os.path.join(self.data, name + ".ply")
            with open(path, "wb") as f:
                f.write(make_ply(properties + extra, [row + (1.0,) * len(extra) for row in rows], kinds={"extra": "double"}))
            splatnode.rewrite_for_opensplat(path, splatnode.read_ply_header(path), 9, lambda: None)
            paths.append(path)
        with open(paths[0], "rb") as a, open(paths[1], "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_models_it_cant_continue_are_refused_with_the_reason_and_leave_nothing(self):
        degree_0 = make_ply(splat_properties(degree=0), [tuple(range(14))])
        no_rotation = make_ply(splat_properties(degree=1)[:-1], [tuple(range(22))])
        cut_short = make_ply(splat_properties(degree=1), [tuple(range(23))], vertices=2)
        odd_colours = make_ply([n if n != "f_rest_8" else "f_rest_9" for n in splat_properties(degree=1)], [tuple(range(23))])
        six_rest = make_ply([n for n in splat_properties(degree=1) if n not in ("f_rest_6", "f_rest_7", "f_rest_8")], [tuple(range(20))])
        listed = b"ply\nformat binary_little_endian 1.0\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n"
        ascii_model = b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n1\n"
        for model, query, message in (
                (fixture("lichtfeld-model.ply"), "steps=60", "needs resume_steps"),
                (fixture("opensplat-model.ply"), "steps=500", "more than the model's steps (500)"),
                (degree_0, "steps=60&resume_steps=30", "OpenSplat can't continue a model of SH degree 0"),
                (no_rotation, "steps=60&resume_steps=30", "not a splat model: it has no rot_3"),
                (cut_short, "steps=60&resume_steps=30", "cut short"),
                (odd_colours, "steps=60&resume_steps=30", "colours' properties out of sequence"),
                (six_rest, "steps=60&resume_steps=30", "has 6 f_rest_ properties: no SH degree from 0 to 3"),
                (listed, "steps=60&resume_steps=30", "header line it can't read: element face 1"),
                (ascii_model, "steps=60&resume_steps=30", "not a binary little-endian .ply"),
                (b"ply\nformat binary_little_endian 1.0\n", "steps=60&resume_steps=30", "no end to its header")):
            response, data = self.request("POST", "/jobs?" + query, body=training_zip(resume=model))
            self.assertEqual(response.status, 400, message)
            self.assertIn(message, data["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_a_full_disk_while_rewriting_fails_the_job_with_the_reason_and_leaves_no_half_model(self):
        class Full(io.BytesIO):
            def write(self, data):
                if len(data) > 1000:  # the header goes in; the splats find the disk full
                    raise OSError(errno.ENOSPC, "No space left on device")
                return super().write(data)

        real_open = open

        def full_open(path, mode="r", *args, **kwargs):
            if str(path).endswith(".rewrite"):
                real_open(path, mode).close()  # the file is made, as on a real disk
                return Full()
            return real_open(path, mode, *args, **kwargs)

        with mock.patch.object(splatnode, "open", full_open, create=True):
            job = self.wait(self.create("steps=60&resume_steps=30", body=training_zip(resume=fixture("lichtfeld-model.ply")))["id"])
        self.assertEqual(job["state"], "failed")
        self.assertIn("Not enough disk space on the splat node to prepare the model", job["error"])
        self.assertFalse(any(name.endswith(".rewrite") for name in self.files(job["id"])))


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

    def slow_unpacking(self):
        original = splatnode.Node.unpack_file

        def slow(node, *args):
            time.sleep(0.3)
            return original(node, *args)

        self.patch(splatnode.Node, "unpack_file", slow)

    def trainer_ran(self, job_id):
        with open(os.path.join(self.data, "jobs", job_id, "log.txt"), "rb") as f:
            return b"Using CUDA" in f.read()

    def test_a_dataset_with_a_damaged_file_fails_before_the_trainer_and_the_next_one_trains(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            for name in splatnode.REQUIRED_FILES:
                z.writestr(name, b"x")
            z.writestr("images/a.jpg", b"photo" * 100)
        # The central directory still reads (the upload's check passes); the photo's bytes no longer match its CRC
        body = data.getvalue().replace(b"photo" * 100, b"PHOTO" * 100)
        job = self.wait(self.create(body=body)["id"])
        self.assertEqual(job["state"], "failed")
        self.assertIn("The dataset could not be unpacked: Bad CRC-32", job["error"])
        self.assertFalse(self.trainer_ran(job["id"]))
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt"])
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_a_full_disk_while_unpacking_fails_that_job_and_the_next_one_trains(self):
        self.patch(splatnode.Node, "unpack_file", failing_once(splatnode.Node.unpack_file, lambda *_: True))
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error"], "Not enough disk space on the splat node to unpack the dataset")
        self.assertFalse(self.trainer_ran(job["id"]))
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt"])
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_a_job_canceled_while_unpacking_stops_before_the_trainer_starts(self):
        self.slow_unpacking()
        job = self.create()
        self.wait(job["id"], ("running",))
        self.request("POST", "/jobs/{}/cancel".format(job["id"]))
        self.assertEqual(self.wait(job["id"])["state"], "canceled")
        self.assertFalse(self.trainer_ran(job["id"]))
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt"])

    def test_a_job_deleted_while_unpacking_leaves_nothing(self):
        self.slow_unpacking()
        job = self.create()
        self.wait(job["id"], ("running",))
        self.assertEqual(self.request("DELETE", "/jobs/" + job["id"])[0].status, 200)
        self.wait_gone(job["id"])

    def test_stopping_the_node_while_unpacking_ends_the_job_without_the_trainer(self):
        self.slow_unpacking()
        job = self.create()
        self.wait(job["id"], ("running",))
        self.stop()
        self.assertFalse(self.server.node.worker.is_alive())
        self.assertFalse(self.trainer_ran(job["id"]))
        with open(os.path.join(self.data, "jobs", job["id"], "job.json")) as f:
            saved = json.load(f)
        self.assertEqual((saved["state"], saved["error"]), ("failed", "The splat node was stopped while this job was training"))

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

    def test_a_trainer_that_survives_sigkill_fails_its_job_and_ends_the_worker(self):
        node = self.server.node
        node.kill_wait = 0.5
        os.environ["FAKE_TRAINER"] = "stubborn"
        job = self.create()
        self.wait_for_a_step(job["id"])
        process = node.process
        self.addCleanup(process.kill)
        self.patch(node, "signal", lambda process, sig: None)  # as if stuck in the driver
        self.request("POST", "/jobs/{}/cancel".format(job["id"]))
        node.worker.join(10)
        self.assertFalse(node.worker.is_alive())
        self.assertEqual(self.worker_deaths, [True])
        failed = self.request("GET", "/jobs/" + job["id"])[1]
        self.assertEqual((failed["state"], failed["error"]),
                         ("failed", "The trainer could not be stopped: the splat node restarts"))

    def test_a_worker_that_stops_beating_ends_the_process(self):
        node = self.server.node
        self.patch(type(node), "beat", lambda self: None)
        node.heartbeat -= node.HEARTBEAT_LIMIT + 1
        for _ in range(40):
            if self.worker_deaths:
                break
            time.sleep(0.1)
        self.assertEqual(self.worker_deaths, [True])

    def test_a_running_job_deleted_does_not_come_back_after_a_restart(self):
        node = self.server.node
        os.environ["FAKE_TRAINER"] = "slow"
        job = self.create()
        self.wait(job["id"], ("running",))
        # The node stops before the trainer has, as in a crash: the job's folder is still there
        self.patch(type(node), "finish_job", lambda self, job_id, state, error=None: None)
        self.assertEqual(self.request("DELETE", "/jobs/" + job["id"])[0].status, 200)
        self.stop()
        os.environ.pop("FAKE_TRAINER")
        self.start()
        self.assertEqual(self.request("GET", "/jobs/" + job["id"])[0].status, 404)
        self.assertFalse(os.path.exists(os.path.join(self.data, "jobs", job["id"])))

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



class TestSettings(unittest.TestCase):
    def setUp(self):
        self.logged = []
        patcher = mock.patch.object(splatnode, "log", self.logged.append)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_setting_left_empty_or_unset_is_its_default(self):
        self.assertEqual(splatnode.setting({}, "SPLATNODE_STALL_MINUTES", 30, 1), 30)
        self.assertEqual(splatnode.setting({"SPLATNODE_STALL_MINUTES": ""}, "SPLATNODE_STALL_MINUTES", 30, 1), 30)
        self.assertEqual(splatnode.setting({"SPLATNODE_STALL_MINUTES": "45"}, "SPLATNODE_STALL_MINUTES", 30, 1), 45)
        self.assertEqual(self.logged, [])

    def test_a_setting_that_is_not_a_number_or_too_small_is_named_in_the_log_and_its_default_used(self):
        for value in ("abc", "0", "-5", "nan", "inf"):
            self.logged.clear()
            env = {"SPLATNODE_KEEP_HOURS": value}
            self.assertEqual(splatnode.setting(env, "SPLATNODE_KEEP_HOURS", 48, 1), 48, value)
            self.assertEqual(len(self.logged), 1)
            self.assertIn("SPLATNODE_KEEP_HOURS", self.logged[0])
            self.assertIn(repr(value), self.logged[0])


if __name__ == "__main__":
    unittest.main()



class TestLichtFeldOutput(unittest.TestCase):
    """LichtFeld Studio's own words, as a terminal gets them (colours, carriage returns), from real runs of the
    pinned commit in the node's image on the check task (217 photos at 1,600 px, 2026-11-25): lichtfeld-output.txt a
    300-step training, lichtfeld-failure.txt a missing dataset, lichtfeld-stopped.txt the end of a training stopped
    with SIGTERM at step 5,326. lichtfeld-out-of-memory.txt is composed from its two allocation failure messages
    (core/memory_pressure.cpp at the pin), in its log's form: this GPU, under WSL, spills into the computer's memory
    instead of running out (two trainings at once, and 4,032 px photos with a 50,000,000 cap, only slowed down).
    Capture them again when the pin changes."""

    adapter = splatnode.TRAINERS["lichtfeld"]

    def read(self, name):
        with open(os.path.join(os.path.dirname(__file__), name), "rb") as f:
            data = f.read()
        chunks = iter([data, b""])
        return lambda: next(chunks)

    def lines(self, name):
        return [(splatnode.ANSI.sub(b"", line), done) for line, done in splatnode.segments(self.read(name))]

    def test_a_real_runs_progress_gives_its_steps(self):
        found = [self.adapter.step_of(line, {"options": {}}) for line, _ in self.lines("lichtfeld-output.txt")]
        self.assertEqual([s for s in found if s], [(100, 33), (200, 66)])

    def test_a_continued_runs_steps_count_from_its_models(self):
        job = {"options": {"resume_steps": 7000}, "resume": True}
        found = [self.adapter.step_of(line, job) for line, _ in self.lines("lichtfeld-stopped.txt")]
        self.assertIn((12300, 17), [s for s in found if s])

    def test_every_redraw_of_its_progress_bar_is_a_line_and_looks_like_a_step(self):
        lines = [line for line, _ in self.lines("lichtfeld-output.txt") if self.adapter.looks_like_a_step(line)]
        self.assertEqual(len(lines), 3)  # "Initializing...", then steps 100 and 200
        self.assertTrue(lines[0].endswith(b"Initializing..."))

    def test_a_real_failure_is_named_by_its_error_line_and_not_out_of_memory(self):
        tail = b"\n".join(line for line, _ in self.lines("lichtfeld-failure.txt")).decode()
        error = splatnode.explain(1, tail, self.adapter)
        self.assertTrue(error.startswith("The trainer ended with code 1: ["), error)
        self.assertIn("Failed to load training data: Failed to load dataset: [Path not found] /data/nonexistent", error)

    def test_its_out_of_memory_failure_says_so(self):
        tail = b"\n".join(line for line, _ in self.lines("lichtfeld-out-of-memory.txt")).decode()
        self.assertEqual(splatnode.explain(1, tail, self.adapter),
                         "The GPU ran out of memory. Try a smaller image size or fewer gaussians.")

    def test_a_stopped_run_is_not_out_of_memory(self):
        tail = b"\n".join(line for line, _ in self.lines("lichtfeld-stopped.txt")).decode()
        self.assertNotIn("out of memory", splatnode.explain(-15, tail, self.adapter))

FAKE_LICHTFELD = os.path.join(os.path.dirname(__file__), "fake_lichtfeld.py")
WITH_MASKS = splatnode.REQUIRED_FILES + ("images/a.jpg", "masks/a.jpg.png")


class TestLichtFeld(NodeTestCase):
    """The node with LichtFeld Studio's adapter, against its stand-in (which refuses to run without a terminal)."""

    def start(self):
        self.server = splatnode.make_server("127.0.0.1", 0, self.data, FAKE_LICHTFELD, self.token, kind="lichtfeld")
        self.port = self.server.server_address[1]
        self.server.node.grace = 1
        self.server.node.stall_seconds = 60
        self.worker_deaths = []
        self.server.node.on_worker_death = lambda: self.worker_deaths.append(True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.stop)

    def result(self, job):
        return self.request("GET", "/jobs/{}/result".format(job["id"]))[1]

    def test_info_names_lichtfeld_and_its_options_kinds(self):
        info = self.request("GET", "/info")[1]
        self.assertEqual((info["trainer_kind"], info["supports"]), ("lichtfeld", {"masks": True, "continue": True}))
        self.assertEqual(info["options"]["strategy"], {"choices": ["mrnf", "mcmc", "igs+"], "default": None})
        self.assertEqual(info["options"]["exposure_correction"], {"type": "bool", "default": None})
        self.assertEqual(info["options"]["max_gaussians"], {"min": 1000, "max": 50000000, "default": None})
        self.assertNotIn("densify_until", info["options"])

    def test_a_job_trains_in_a_terminal_and_its_exported_model_is_the_result(self):
        job = self.wait(self.create("steps=40")["id"])
        self.assertEqual((job["state"], job["step"], job["progress"], job["trained_steps"]), ("completed", 40, 100, 40), job["error"])
        model = self.result(job)
        self.assertIn(b'"iteration":40,', model)
        args = model.split(b"\nargs ")[1].decode()
        self.assertIn("--headless", args)
        self.assertIn("--export ply --undistort --log-level info -i 40", args)
        self.assertNotIn("--mask-mode", args)
        # Only the result and the log are kept: not its output folder, its project nor its home's logs
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt", "model.ply"])

    def test_its_log_has_each_progress_redraw_on_a_line_without_colours(self):
        job = self.wait(self.create("steps=30")["id"])
        log = self.request("GET", "/jobs/{}/log".format(job["id"]))[1].decode()
        self.assertNotIn("\x1b", log)
        self.assertNotIn("\r", log)
        lines = [line for line in log.splitlines() if line.startswith("Training [")]
        self.assertEqual([line.split("] ")[2].split(" |")[0] for line in lines[1:]], ["10/30", "20/30", "30/30"])

    def test_options_become_its_flags(self):
        query = "steps=40&max_gaussians=300000&sh_degree=2&strategy=mcmc&exposure_correction=false"
        args = self.result(self.wait(self.create(query)["id"])).split(b"\nargs ")[1].decode()
        self.assertIn("--max-cap 300000 --sh-degree 2 --strategy mcmc --no-exposure-correction", args)
        args = self.result(self.wait(self.create("steps=40&exposure_correction=true")["id"])).split(b"\nargs ")[1].decode()
        self.assertTrue(args.endswith("--exposure-correction"))

    def test_masks_in_the_zip_are_ignored_where_black(self):
        job = self.wait(self.create("steps=20", body=training_zip(WITH_MASKS))["id"])
        self.assertIn(b"--mask-mode ignore", self.result(job))

    def test_info_names_lichtfeld_once_from_its_version(self):
        self.server.node.trainer = os.path.join(os.path.dirname(__file__), "fake_lichtfeld_version.sh")
        self.assertEqual(self.request("GET", "/info")[1]["trainer"], "LichtFeld Studio 06c9a04 (06c9a04)")

    def test_wrong_option_values_are_refused(self):
        for query, message in (("steps=20&strategy=fast", "strategy must be one of mrnf, mcmc, igs+"),
                               ("steps=20&exposure_correction=maybe", "exposure_correction must be true or false"),
                               ("steps=20&densify_until=9000", "Unknown option: densify_until"),
                               ("steps=20&resume_steps=10", "resume_steps is only for a job that continues")):
            response, data = self.request("POST", "/jobs?" + query, body=training_zip())
            self.assertEqual(response.status, 400, query)
            self.assertIn(message, data["error"])
        self.assertEqual(os.listdir(os.path.join(self.data, "jobs")), [])

    def test_continuing_trains_the_steps_after_the_models_from_it_with_init(self):
        model = fixture("lichtfeld-model.ply")
        job = self.wait(self.create("steps=50&resume_steps=30", body=training_zip(resume=model))["id"])
        self.assertEqual((job["state"], job["step"], job["trained_steps"]), ("completed", 50, 50), job["error"])
        args = self.result(job).split(b"\nargs ")[1].decode()
        self.assertIn("-i 20 --init ", args)
        self.assertIn("resume.ply", args)
        for query, message in (("steps=50", "needs resume_steps"), ("steps=30&resume_steps=30", "more than resume_steps")):
            response, data = self.request("POST", "/jobs?" + query, body=training_zip(resume=model))
            self.assertEqual(response.status, 400, query)
            self.assertIn(message, data["error"])

    def test_it_continues_an_opensplat_model_as_it_is_at_the_models_sh_degree(self):
        model = fixture("opensplat-model.ply")
        job = self.wait(self.create("steps=600&resume_steps=500&sh_degree=1", body=training_zip(resume=model))["id"])
        self.assertEqual(job["state"], "completed", job["error"])
        args = self.result(job).split(b"\nargs ")[1].decode()
        self.assertIn("-i 100 --init ", args)
        self.assertIn("--sh-degree 3", args)
        self.assertEqual(self.request("GET", "/info")[1]["continue_from"]["sh_degrees"], [0, 1, 2, 3])

    def test_its_failure_is_named_by_its_last_line_without_colours(self):
        os.environ["FAKE_TRAINER"] = "fail"
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "failed")
        self.assertTrue(job["error"].startswith("The trainer ended with code 1: [02:00:00.000] [error] application.cpp:1170"), job["error"])
        self.assertIn("Failed to load training data", job["error"])

    def test_running_out_of_gpu_memory_says_so(self):
        os.environ["FAKE_TRAINER"] = "oom"
        job = self.wait(self.create()["id"])
        self.assertEqual(job["error"], "The GPU ran out of memory. Try a smaller image size or fewer gaussians.")

    def test_exiting_without_a_model_fails_the_job(self):
        os.environ["FAKE_TRAINER"] = "nomodel"
        job = self.wait(self.create()["id"])
        self.assertEqual((job["state"], job["error"]), ("failed", "LichtFeld Studio exited without writing a model"))

    def test_a_terminal_that_cannot_be_opened_fails_the_job_and_the_node_goes_on(self):
        with mock.patch.object(splatnode.pty, "openpty", side_effect=OSError(24, "Too many open files")):
            job = self.wait(self.create()["id"])
        self.assertEqual((job["state"], job["error"]), ("failed", "The splat node could not open a terminal for the trainer: [Errno 24] Too many open files"))
        self.assertEqual(self.wait(self.create()["id"])["state"], "completed")

    def test_it_is_stopped_when_it_goes_silent_in_its_terminal(self):
        os.environ["FAKE_TRAINER"] = "silent"
        self.server.node.stall_seconds = 2
        job = self.wait(self.create()["id"])
        self.assertEqual(job["state"], "failed")
        self.assertIn("printed nothing for", job["error"])

    def test_a_cancel_stops_it_in_its_terminal(self):
        os.environ["FAKE_TRAINER"] = "slow"
        job = self.create("steps=40")
        self.wait_for_a_step(job["id"])
        self.request("POST", "/jobs/{}/cancel".format(job["id"]))
        self.assertEqual(self.wait(job["id"])["state"], "canceled")
