"""
Tests of the SplatMe plugin: it registers, and it trains a task's splats through a splat node (a stand-in
here, tests/fake_node.py; WebODM's tests run a worker's job inside the request that starts it).
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
from unittest import mock

from app.models import Plugin, Project, Task
from app.plugins import get_plugin_by_name, signals
from app.tests.classes import BootTestCase
from django.contrib.auth.models import User
from guardian.shortcuts import assign_perm
from nodeodm import status_codes
from rest_framework.test import APIClient

from .. import training
from .fake_node import MODEL, OPTIONS, FakeNode, trained

API = "/api/plugins/splatme"
IMAGES = ["tiny_drone_image.jpg", "tiny_drone_image_2.jpg"]


def make_task(user, images=IMAGES, status=status_codes.COMPLETED):
    """A completed task with what a training needs, as WebODM's own splats test makes one."""
    project = Project.objects.create(owner=user, name="splatme test project")
    task = Task.objects.create(project=project, status=status)
    camera_id = "dji test 48 36 perspective 0.85"
    os.makedirs(task.assets_path("odm_georeferencing"), exist_ok=True)
    os.makedirs(task.assets_path("odm_report"), exist_ok=True)
    with open(task.get_asset_file_or_stream("cameras.json"), "w") as f:
        camera = {"projection_type": "perspective", "width": 48, "height": 36, "focal": 0.85, "k1": 0.01, "k2": -0.002}
        json.dump({camera_id: camera}, f)
    with open(task.get_asset_file_or_stream("shots.geojson"), "w") as f:
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0, 0, 0]},
                "properties": {
                    "filename": image, "camera": "v2 " + camera_id,
                    "translation": [10.5, 20.5, 30.0], "rotation": [0.1, 0.2, 0.3],
                },
            }
            for image in images
        ]  # fmt: skip
        json.dump({"type": "FeatureCollection", "features": features}, f)

    import app

    fixtures = os.path.join(os.path.dirname(app.__file__), "fixtures")
    for image in images:
        source = image if os.path.isfile(os.path.join(fixtures, image)) else IMAGES[0]
        os.link(os.path.join(fixtures, source), task.task_path(image))

    tmpdir = tempfile.mkdtemp()
    try:
        csv_file = os.path.join(tmpdir, "points.csv")
        with open(csv_file, "w") as f:
            f.write("X,Y,Z,Red,Green,Blue\n")
            f.writelines(f"{i * 2.0},{i * 2.0},{10.0 + i},255,128,0\n" for i in range(10))
        pipeline = os.path.join(tmpdir, "pipeline.json")
        with open(pipeline, "w") as f:
            laz = task.get_asset_file_or_stream("georeferenced_model.laz")
            json.dump([{"type": "readers.text", "filename": csv_file}, {"type": "writers.las", "filename": laz}], f)
        subprocess.run([shutil.which("pdal"), "pipeline", pipeline], check=True)
    finally:
        shutil.rmtree(tmpdir)
    task.update_available_assets_field(commit=True)
    task.refresh_from_db()
    return task


class TestSplatMe(BootTestCase):
    def setUp(self):
        self.node = FakeNode()
        self.addCleanup(self.node.close)
        training.set_node(self.node.url, self.node.token)
        patcher = mock.patch.object(training, "POLL", 0)
        patcher.start()
        self.addCleanup(patcher.stop)
        # WebODM's converter does not take the stand-in node's model
        self.converted = []
        patcher = mock.patch.object(training, "convert", self.convert)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.get(username="testuser")
        self.client = APIClient()
        self.client.login(username="testuser", password="test1234")

    def convert(self, trained_file, model):
        with open(trained_file, "rb") as f:
            self.converted.append(f.read())
        with open(model, "wb") as f:
            f.write(MODEL)

    def train(self, task, **options):
        return self.client.post(f"{API}/task/{task.id}/train", options)

    def status(self, task):
        return self.client.get(f"{API}/task/{task.id}/status").data

    def model(self, task):
        path = task.get_asset_file_or_stream("splats.rad")
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as f:
            return f.read()

    def put_model(self, task, content):
        path = task.get_asset_file_or_stream("splats.rad")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(content)

    def lost_job(self, task, node_job, state="training"):
        """The record of a job whose worker is gone."""
        long_ago = time.time() - training.STALE - 10
        job = {
            "state": state, "run": "lost", "options": dict(training.DEFAULTS), "user": "testuser", "progress": 10,
            "status": "", "node_job": node_job, "error": None, "started": long_ago, "updated": long_ago,
            "finished": None,
        }  # fmt: skip
        training.store().set_json(training.job_key(task.id), job)

    def test_the_plugin_is_registered_and_active(self):
        plugin = get_plugin_by_name("splatme")
        self.assertIsNotNone(plugin)
        self.assertEqual(plugin.get_manifest()["name"], "SplatMe")

    def test_training_exports_the_task_sends_it_to_the_node_and_imports_the_model(self):
        task = make_task(self.user)
        self.assertEqual(
            self.status(task),
            {
                "state": None, "active": False, "has_splats": False, "can_train": True,
                "task_status": status_codes.COMPLETED,
                "auto": {"enabled": False, "options": training.DEFAULTS, "own": False},
            },
        )  # fmt: skip

        res = self.train(task, steps=10, image_size=16)
        self.assertEqual(res.status_code, 200, res.data)

        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["progress"], 100)
        self.assertFalse(status["active"])
        self.assertTrue(status["has_splats"])
        self.assertEqual(status["options"], {"steps": 10, "image_size": 16})
        self.assertNotIn("run", status)
        self.assertNotIn("node_job", status)
        self.assertEqual(self.model(task), MODEL)

        job = self.node.jobs["job1"]
        self.assertEqual(job["options"], {"steps": 10})
        for name in ("sparse/0/cameras.bin", "sparse/0/images.bin", "sparse/0/points3D.bin"):
            self.assertIn(name, job["names"])
        for image in IMAGES:
            self.assertIn("images/" + image, job["names"])

        # Nothing of the job is left in the plugin's folder
        self.assertFalse(os.path.exists(training.work_dir(task.id)))

    def test_training_without_options_uses_the_defaults(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task).status_code, 200)
        self.assertEqual(self.node.jobs["job1"]["options"], {"steps": training.DEFAULTS["steps"]})

    def test_the_log_is_the_nodes_and_says_where_to_read_on(self):
        task = make_task(self.user)
        self.train(task)
        res = self.client.get(f"{API}/task/{task.id}/log?offset=0")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Step 10", res.content.decode())
        self.assertEqual(res["X-Log-Offset"], "20")

    def test_a_task_that_is_not_completed_is_refused_with_the_reason(self):
        task = make_task(self.user, status=status_codes.RUNNING)
        res = self.train(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("not completed", res.data["error"])
        self.assertEqual(self.node.jobs, {})

    def test_a_task_with_images_that_are_not_jpeg_is_refused_with_the_reason(self):
        task = make_task(self.user, images=["thermal_1.tif", "thermal_2.tif"])
        res = self.train(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("thermal_1.tif", res.data["error"])

    def test_a_compacted_task_is_refused_with_the_reason(self):
        task = make_task(self.user)
        task.compacted = True
        task.save()
        res = self.train(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("compacted", res.data["error"])

    def test_an_option_outside_the_nodes_range_is_refused(self):
        task = make_task(self.user)
        res = self.train(task, steps=10**7)
        self.assertEqual(res.status_code, 400)
        self.assertIn("steps must be between 1 and 200000", res.data["error"])

    def test_no_node_an_unreachable_node_and_a_wrong_token_each_say_what_to_fix(self):
        task = make_task(self.user)
        training.set_node(self.node.url, "wrong")
        self.assertIn("token", self.train(task).data["error"])
        training.set_node("http://127.0.0.1:9", self.node.token)
        self.assertIn("does not answer", self.train(task).data["error"])
        training.set_node("", "")
        self.assertIn("No splat node is set", self.train(task).data["error"])
        self.assertIsNone(self.status(task)["state"])

    def test_a_node_older_than_the_plugin_needs_is_named(self):
        task = make_task(self.user)
        self.node.version = "0.0.9"
        res = self.train(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Update the node", res.data["error"])

    def test_a_failed_training_reports_the_nodes_error_and_keeps_the_tasks_model(self):
        task = make_task(self.user)
        self.put_model(task, b"the earlier model")
        self.node.script = [("running", {"progress": 10, "step": 1}), ("failed", {"error": "The GPU ran out of memory"})]
        self.assertEqual(self.train(task).status_code, 200)

        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertEqual(status["error"], "The GPU ran out of memory")
        self.assertEqual(self.model(task), b"the earlier model")
        self.assertFalse(os.path.exists(training.work_dir(task.id)))

    def test_training_again_replaces_the_tasks_model(self):
        task = make_task(self.user)
        self.put_model(task, b"the earlier model")
        self.assertEqual(self.train(task).status_code, 200)
        self.assertEqual(self.model(task), MODEL)

    def test_a_training_continues_from_the_tasks_trained_model_with_the_options_it_had(self):
        task = make_task(self.user)
        self.assertIsNone(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"])
        self.assertEqual(self.train(task, steps=10, image_size=16, max_gaussians=500).status_code, 200)
        self.assertEqual(self.converted, [trained(10)])
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"], 10)

        res = self.train(task, resume="true", steps=30, image_size=999)
        self.assertEqual(res.status_code, 200, res.data)
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["options"], {"steps": 40, "image_size": 16, "max_gaussians": 500})
        job = self.node.jobs["job2"]
        self.assertEqual(job["options"], {"steps": 40, "max_gaussians": 500})
        self.assertEqual(job["resume"], trained(10))
        self.assertEqual(self.converted, [trained(10), trained(40)])
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"], 40)
        self.assertIsNone(self.node.jobs["job1"]["resume"])

    def test_continuing_is_refused_without_a_trained_model_or_more_steps(self):
        task = make_task(self.user)
        res = self.train(task, resume="true", steps=30)
        self.assertEqual(res.status_code, 400)
        self.assertIn("no trained model to continue from", res.data["error"])
        self.assertEqual(self.train(task, steps=10).status_code, 200)
        for steps in ("", "0", "many"):
            res = self.train(task, resume="true", steps=steps)
            self.assertEqual(res.status_code, 400)
            self.assertIn("steps must be", res.data["error"])
        res = self.train(task, resume="true", steps=200000)
        self.assertEqual(res.status_code, 400)
        self.assertIn("steps must be between", res.data["error"])
        self.assertEqual(len(self.node.jobs), 1)

    def test_a_model_uploaded_since_the_training_is_not_continued(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.put_model(task, b"a model uploaded in WebODM's Splats dialog")
        later = time.time() + 60
        os.utime(task.get_asset_file_or_stream("splats.rad"), (later, later))
        self.assertIsNone(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"])
        self.assertEqual(self.train(task, resume="true", steps=30).status_code, 400)

    def test_canceling_stops_the_nodes_job_and_imports_nothing(self):
        task = make_task(self.user)
        self.node.script = [("running", {"progress": 10, "step": 1})]

        def cancel_after_a_poll(seconds):
            res = self.client.post(f"{API}/task/{task.id}/cancel")
            self.assertEqual(res.status_code, 200)

        with mock.patch.object(training.time, "sleep", side_effect=cancel_after_a_poll):
            self.assertEqual(self.train(task).status_code, 200)

        self.assertEqual(self.status(task)["state"], "canceled")
        self.assertTrue(self.node.jobs["job1"]["deleted"])
        self.assertIsNone(self.model(task))

    def test_a_task_already_training_is_not_started_twice(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        training.change_job(task.id, lambda job: job.update(updated=time.time()))
        res = self.train(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("already being trained", res.data["error"])

    def test_a_job_that_lost_its_worker_is_picked_up_from_the_nodes_job(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())

        status = self.status(task)  # starts another worker job, which WebODM's tests run at once
        self.assertEqual(self.status(task)["state"], "completed", status)
        self.assertEqual(self.model(task), MODEL)
        self.assertEqual(len(self.node.jobs), 1)  # nothing was exported or sent again

    def test_a_job_that_lost_its_worker_before_reaching_the_node_starts_over(self):
        task = make_task(self.user)
        self.lost_job(task, None, state="exporting")
        self.status(task)
        self.assertEqual(self.status(task)["state"], "completed")
        self.assertEqual(self.model(task), MODEL)

    def test_a_job_the_node_no_longer_has_fails_and_says_to_start_again(self):
        task = make_task(self.user)
        self.lost_job(task, "job-gone")
        self.status(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("Start the training again", status["error"])

    def test_a_task_processed_again_while_training_gets_no_model(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        Task.objects.filter(pk=task.id).update(status=status_codes.RUNNING)
        self.status(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("processed again", status["error"])
        self.assertIsNone(self.model(task))

    def test_deleting_a_task_stops_its_job_and_removes_its_record(self):
        task = make_task(self.user)
        node_job = self.node.add_job()
        self.lost_job(task, node_job)
        training.change_job(task.id, lambda job: job.update(updated=time.time()))
        task_id = task.id
        task.delete()
        self.assertIsNone(training.get_job(task_id))
        self.assertTrue(self.node.jobs[node_job]["deleted"])

    def test_a_task_deleted_while_training_stops_the_nodes_job_and_leaves_no_record(self):
        task = make_task(self.user)
        task_id = task.id
        self.node.script = [("running", {"progress": 10, "step": 1})]

        def delete_as_the_worker_does(seconds):
            Task.objects.filter(pk=task_id).delete()  # no signal reaches the plugin

        with mock.patch.object(training.time, "sleep", side_effect=delete_as_the_worker_does):
            self.assertEqual(self.train(task).status_code, 404)
        self.assertTrue(self.node.jobs["job1"]["deleted"])
        self.assertIsNone(training.get_job(task_id))

    def test_starting_a_training_forgets_the_jobs_of_tasks_that_are_gone(self):
        gone = make_task(self.user)
        self.assertEqual(self.train(gone).status_code, 200)
        Task.objects.filter(pk=gone.id).delete()  # no signal reaches the plugin
        self.assertIsNotNone(training.get_job(gone.id))

        self.assertEqual(self.train(make_task(self.user)).status_code, 200)
        self.assertIsNone(training.get_job(gone.id))

    def test_only_those_who_can_change_the_project_start_and_cancel(self):
        task = make_task(self.user)
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(other.post(f"{API}/task/{task.id}/train").status_code, 404)
        self.assertEqual(other.get(f"{API}/task/{task.id}/status").status_code, 404)

        # With the right to see the project only, the status is readable and that is all
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertEqual(other.get(f"{API}/task/{task.id}/status").status_code, 200)
        self.assertEqual(other.post(f"{API}/task/{task.id}/train").status_code, 404)
        self.assertEqual(other.post(f"{API}/task/{task.id}/cancel").status_code, 404)
        self.assertEqual(APIClient().post(f"{API}/task/{task.id}/train").status_code, 404)
        self.assertEqual(self.node.jobs, {})

    def test_the_status_says_who_may_train_and_how_far_the_task_is(self):
        task = make_task(self.user, status=status_codes.RUNNING)
        status = self.status(task)
        self.assertTrue(status["can_train"])
        self.assertEqual(status["task_status"], status_codes.RUNNING)

        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertFalse(other.get(f"{API}/task/{task.id}/status").data["can_train"])

    def test_the_check_before_training_gives_the_ranges_and_no_problem_for_a_task_that_can_train(self):
        task = make_task(self.user)
        check = self.client.get(f"{API}/task/{task.id}/check").data
        self.assertIsNone(check["problem"])
        self.assertIsNone(check["node_error"])
        self.assertEqual(check["warnings"], [])
        self.assertEqual(check["defaults"], training.DEFAULTS)
        self.assertEqual(check["ranges"]["steps"]["min"], 1)
        self.assertFalse(check["has_splats"])

    def test_the_check_names_what_stands_in_the_way_of_the_task(self):
        task = make_task(self.user, status=status_codes.RUNNING)
        check = self.client.get(f"{API}/task/{task.id}/check").data
        self.assertEqual(check["problem"], "The task has not completed processing.")

    def test_the_check_warns_when_nearly_all_photos_point_straight_down(self):
        task = make_task(self.user)
        path = task.get_asset_file_or_stream("shots.geojson")
        with open(path) as f:
            shots = json.load(f)
        for feature in shots["features"]:
            feature["properties"]["rotation"] = [3.14159, 0.0, 0.0]
        with open(path, "w") as f:
            json.dump(shots, f)
        check = self.client.get(f"{API}/task/{task.id}/check").data
        self.assertIsNone(check["problem"])
        self.assertEqual(len(check["warnings"]), 1)
        self.assertIn("nadir", check["warnings"][0])

    def test_the_check_tells_only_an_administrator_what_is_wrong_with_the_node(self):
        task = make_task(self.user)
        training.set_node("http://127.0.0.1:9")
        check = self.client.get(f"{API}/task/{task.id}/check").data
        self.assertIn("Ask an administrator", check["node_error"])
        self.assertNotIn("127.0.0.1", check["node_error"])

        assign_perm("view_project", User.objects.get(username="testsuperuser"), task.project)
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        self.assertIn("127.0.0.1:9 does not answer", admin.get(f"{API}/task/{task.id}/check").data["node_error"])

    def test_the_settings_page_is_in_the_menu_and_needs_a_login(self):
        res = self.client.get("/plugins/splatme/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Splat Node")
        self.assertContains(self.client.get("/dashboard/"), 'href="/plugins/splatme/"')
        self.assertEqual(APIClient().get("/plugins/splatme/").status_code, 302)

    def test_everyone_sees_the_nodes_state_and_only_administrators_its_address(self):
        res = self.client.get(f"{API}/node")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["admin"])
        self.assertEqual(res.data["node"]["trainer"], "OpenSplat fake")
        self.assertNotIn("url", res.data)
        self.assertNotIn(self.node.url, json.dumps(res.data))
        self.assertEqual(APIClient().get(f"{API}/node").status_code, 403)

        training.set_node("http://127.0.0.1:9")
        res = self.client.get(f"{API}/node")
        self.assertIn("Ask an administrator", res.data["error"])
        self.assertNotIn("127.0.0.1", json.dumps(res.data))

    def test_test_connection_tries_an_address_without_saving_it(self):
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        res = admin.post(f"{API}/node", {"url": "http://127.0.0.1:9", "save": False}, format="json")
        self.assertIn("does not answer", res.data["error"])
        self.assertEqual(training.get_node().url, self.node.url)

        # A token given is tried in place of the saved one, and an empty one means the saved one
        res = admin.post(f"{API}/node", {"url": self.node.url, "token": "wrong", "save": False}, format="json")
        self.assertIn("token", res.data["error"])
        res = admin.post(f"{API}/node", {"url": self.node.url, "token": "", "save": False}, format="json")
        self.assertIsNone(res.data["error"])
        self.assertEqual(training.get_node().token, self.node.token)

    def test_the_nodes_settings_are_the_administrators_and_never_show_the_token(self):
        self.assertEqual(self.client.post(f"{API}/node", {"url": "http://elsewhere:3100"}).status_code, 403)
        self.assertEqual(training.get_node().url, self.node.url)

        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        res = admin.get(f"{API}/node")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["url"], self.node.url)
        self.assertTrue(res.data["token_set"])
        self.assertEqual(res.data["node"]["trainer"], "OpenSplat fake")
        self.assertNotIn(self.node.token, json.dumps(res.data))

        # A new address without a token keeps the token; the answer says what is wrong with the node
        res = admin.post(f"{API}/node", {"url": "http://127.0.0.1:9/"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["url"], "http://127.0.0.1:9")
        self.assertIn("does not answer", res.data["error"])
        self.assertEqual(training.get_node().token, self.node.token)
        self.assertEqual(admin.post(f"{API}/node", {"url": "ftp://x"}).status_code, 400)

        res = admin.post(f"{API}/node", {"url": self.node.url, "token": "wrong"})
        self.assertIn("token", res.data["error"])

    # Training automatically

    def complete(self, task):
        """What WebODM does when a task completes processing."""
        for _receiver, answer in signals.task_completed.send_robust(sender=Task, task_id=task.id):
            self.assertIsNone(answer)

    def auto(self, task, **values):
        return self.client.post(f"{API}/task/{task.id}/auto", values, format="json")

    def test_a_completed_task_is_not_trained_unless_a_setting_says_so(self):
        task = make_task(self.user)
        self.complete(task)
        self.assertEqual(self.node.jobs, {})
        self.assertIsNone(training.get_job(task.id))

    def test_a_task_set_to_train_is_trained_with_its_options_when_it_completes(self):
        task = make_task(self.user)
        res = self.auto(task, enabled=True, steps=20, image_size=16)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data, {"enabled": True, "options": {"steps": 20, "image_size": 16}, "own": True})
        self.assertEqual(self.node.jobs, {})

        self.complete(task)
        self.assertEqual(self.node.jobs["job1"]["options"], {"steps": 20})
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertTrue(status["auto"]["enabled"])
        self.assertTrue(status["has_splats"])
        job = training.get_job(task.id)
        self.assertTrue(job["auto"])
        self.assertEqual(job["user"], "testuser")

    def test_the_administrators_default_trains_every_task_without_a_setting_of_its_own(self):
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        self.assertEqual(self.client.post(f"{API}/automation", {"enabled": True}, format="json").status_code, 403)
        res = admin.post(f"{API}/automation", {"enabled": True, "steps": 30}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["enabled"])
        self.assertTrue(res.data["listening"])
        self.assertEqual(res.data["options"]["steps"], 30)

        # Everyone reads the default; only administrators are told whether the worker listens
        res = self.client.get(f"{API}/automation")
        self.assertTrue(res.data["enabled"])
        self.assertIsNone(res.data["listening"])

        follows = make_task(self.user)
        opted_out = make_task(self.user)
        self.assertEqual(self.auto(opted_out, enabled=False).data["own"], True)
        self.complete(follows)
        self.complete(opted_out)
        self.assertEqual(training.get_job(follows.id)["options"]["steps"], 30)
        self.assertIsNone(training.get_job(opted_out.id))

        # Back to the default
        self.assertEqual(self.auto(opted_out, reset=True).data, dict(training.get_default(), own=False))

    def test_a_new_task_is_given_its_setting_before_it_is_processed(self):
        # The Edit Task Options dialog of a new task: the ranges come without a task, and the setting is saved
        # on the task as soon as WebODM has created it
        res = self.client.get(f"{API}/automation?ranges=1")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(res.data["enabled"])
        self.assertEqual(res.data["ranges"]["steps"], OPTIONS["steps"])

        task = make_task(self.user, status=None)
        res = self.auto(task, enabled=True, steps=20)
        self.assertEqual(res.status_code, 200, res.data)
        task.status = status_codes.COMPLETED
        task.save()
        self.complete(task)
        self.assertEqual(training.get_job(task.id)["options"]["steps"], 20)

    def test_a_task_processed_again_is_trained_again(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        self.complete(task)
        self.assertEqual(self.model(task), MODEL)

        # Processing again deletes the task's assets; the task then completes with new ones and no model
        os.remove(task.get_asset_file_or_stream("splats.rad"))
        task.update_available_assets_field(commit=True)
        self.complete(task)
        self.assertEqual(sorted(self.node.jobs), ["job1", "job2"])
        self.assertEqual(self.model(task), MODEL)

    def test_a_task_that_completes_with_a_model_is_not_trained(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        self.put_model(task, b"imported")
        task.update_available_assets_field(commit=True)
        self.complete(task)
        self.assertEqual(self.node.jobs, {})
        self.assertEqual(self.model(task), b"imported")

    def test_the_default_passes_over_a_task_that_cannot_be_trained_and_a_tasks_own_setting_says_why(self):
        training.set_default(True, {})
        task = make_task(self.user, images=["a.tif"])
        self.complete(task)
        self.assertIsNone(training.get_job(task.id))

        self.auto(task, enabled=True)
        self.complete(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertTrue(status["auto"])
        self.assertIn("The training did not start. Only JPEG images", status["error"])

    def test_a_node_that_does_not_answer_when_a_task_completes_is_reported_on_the_task(self):
        training.set_default(True, {})
        task = make_task(self.user)
        training.set_node("http://127.0.0.1:9")
        self.complete(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("does not answer", status["error"])

    def test_a_disabled_plugin_trains_nothing(self):
        training.set_default(True, {})
        task = make_task(self.user)
        Plugin.objects.filter(name="splatme").update(enabled=False)
        self.addCleanup(lambda: Plugin.objects.filter(name="splatme").update(enabled=True))
        training.completed(task.id)
        self.assertEqual(self.node.jobs, {})

    def test_a_tasks_setting_needs_the_right_to_change_its_project_and_checks_the_options(self):
        task = make_task(self.user)
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertEqual(other.get(f"{API}/task/{task.id}/auto").status_code, 200)
        self.assertEqual(other.post(f"{API}/task/{task.id}/auto", {"enabled": True}, format="json").status_code, 404)
        self.assertFalse(training.get_auto(task.id)["own"])

        res = self.auto(task, enabled=True, steps=10**8)
        self.assertEqual(res.status_code, 400)
        self.assertIn("steps must be between", res.data["error"])

        # Without a node, a setting is still saved: the options are checked when the training starts
        training.set_node("http://127.0.0.1:9")
        self.assertEqual(self.auto(task, enabled=True, steps=50).status_code, 200)
        self.assertEqual(training.get_auto(task.id)["options"]["steps"], 50)

    def test_deleting_a_task_removes_its_setting(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        task_id = task.id
        task.delete()
        self.assertFalse(training.get_auto(task_id)["own"])
