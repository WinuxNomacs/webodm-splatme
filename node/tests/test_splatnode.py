import http.client
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import splatnode

splatnode.Handler.log_message = lambda *args: None
TRAINER = os.path.join(os.path.dirname(__file__), "fake_trainer.py")


def training_zip(names=("sparse/0/cameras.bin", "sparse/0/images.bin", "sparse/0/points3D.bin", "images/a.jpg")):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        for name in names:
            z.writestr(name, b"x")
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
        if response.getheader("Content-Type") == "application/json":
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
        self.assertEqual(self.files(job["id"]), ["job.json", "log.txt", "model.rad"])

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
        self.assertFalse(os.path.exists(os.path.join(self.data, "jobs", job["id"])))

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


if __name__ == "__main__":
    unittest.main()
