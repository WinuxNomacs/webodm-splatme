"""
Tests of the SplatMe plugin: it registers, and it trains a task's splats through a splat node (a stand-in
here, tests/fake_node.py; WebODM's tests run a worker's job inside the request that starts it).
"""
import fcntl
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
from unittest import mock

import numpy as np
from app import splats
from app.models import Plugin, PluginDatum, Project, Task
from app.plugins import get_plugin_by_name, signals
from app.tests.classes import BootTestCase, BootTransactionTestCase
from django.contrib.auth.models import User
from django.db import InterfaceError, OperationalError, connection
from guardian.shortcuts import assign_perm
from nodeodm import status_codes
from PIL import Image
from rest_framework.test import APIClient

from .. import crop, edits, meshes, sky, thermal, training
from .fake_node import MODEL, OPTIONS, FakeNode, trained

API = "/api/plugins/splatme"
CONVERT = training.convert  # the real one: the tests replace it, as WebODM's converter does not take their models
IMAGES = ["tiny_drone_image.jpg", "tiny_drone_image_2.jpg"]


def add_file(task, name, data=b"x"):
    """A file in the task's folder, as WebODM keeps a task's photos."""
    os.makedirs(task.task_path(), exist_ok=True)
    with open(task.task_path(name), "wb") as f:
        f.write(data)


def write_tiff(path, temperatures, dtc=True):
    """A TIFF of temperatures as DJI Thermal Analyzer writes one (float32, degrees Celsius, its XMP), or without
    its metadata."""
    xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    xmp += b'<rdf:Description Camera:BandName="LWIR"' + (b' xmlns:dtc="urn:dji-thermal-cli:xmp:1.0"' if dtc else b"")
    xmp += b"/></rdf:RDF></x:xmpmeta>"
    Image.fromarray(np.asarray(temperatures, dtype=np.float32), "F").save(path, format="TIFF", tiffinfo={700: xmp})


THERMAL = ["thermal_1.tif", "thermal_2.tif"]


def make_thermal_task(user, dtc=True):
    """A completed task of DJI Thermal Analyzer's TIFFs, 48 x 36: the first from 10 to 20 degrees left to right,
    the second from 20 to 30."""
    task = make_task(user, images=THERMAL)
    for i, name in enumerate(THERMAL):
        os.remove(task.task_path(name))
        write_tiff(task.task_path(name), np.tile(np.linspace(10 + 10 * i, 20 + 10 * i, 48), (36, 1)), dtc)
    return task


def make_task(user, images=IMAGES, status=status_codes.COMPLETED, rotation=(0.1, 0.2, 0.3)):
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
                    "translation": [10.5, 20.5, 30.0], "rotation": list(rotation),
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


def glb_json(path):
    """A GLB's JSON part."""
    with open(path, "rb") as f:
        data = f.read()
    length = int.from_bytes(data[12:16], "little")
    return json.loads(data[20 : 20 + length])


def make_textured_model(task, offset=(1000.0, 2000.0), bump=0.0, hole=False, unit=1.0):
    """
    A textured model as WebODM's texturing writes one, small: a GLB (no Draco, one primitive per material) with its
    OBJ and MTL. Material 0 is a 3 by 3 grid of 1 m squares at z 0 (its vertex at 1, 1 raised by bump; with hole,
    no middle square; unit: its squares' size in metres); material 1
    a lone triangle 10 m away, a floating piece. coords.txt gives the task's offset.
    """
    folder = task.assets_path("odm_texturing")
    os.makedirs(folder, exist_ok=True)
    os.makedirs(task.assets_path("odm_georeferencing"), exist_ok=True)
    with open(task.assets_path("odm_georeferencing", "coords.txt"), "w") as f:
        f.write(f"WGS84 UTM 16N\n{offset[0]:.0f} {offset[1]:.0f}\n")
    grid_positions, grid_indices = [], []
    for i in range(3):
        for j in range(3):
            if hole and (i, j) == (1, 1):
                continue
            base = len(grid_positions)
            corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            grid_positions += [(x * unit, y * unit, bump if (x, y) == (1, 1) else 0) for x, y in corners]
            grid_indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    pieces = [(grid_positions, grid_indices), ([(10, 10, 0), (11, 10, 0), (10, 11, 0)], [0, 1, 2])]
    binary, views, accessors, primitives = bytearray(), [], [], []
    for k, (positions, indices) in enumerate(pieces):
        attrs = {}
        for name, values, kind, count in (
            ("POSITION", [c for p in positions for c in p], "VEC3", len(positions)),
            ("TEXCOORD_0", [c for p in positions for c in (p[0] / 20, p[1] / 20)], "VEC2", len(positions)),
        ):
            data = np.array(values, dtype=np.float32).tobytes()
            views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
            binary += data
            accessor = {"bufferView": len(views) - 1, "componentType": 5126, "count": count, "type": kind}
            if name == "POSITION":
                accessor["min"] = [min(p[i] for p in positions) for i in range(3)]
                accessor["max"] = [max(p[i] for p in positions) for i in range(3)]
            accessors.append(accessor)
            attrs[name] = len(accessors) - 1
        data = np.array(indices, dtype=np.uint32).tobytes()
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
        binary += data
        accessors.append({"bufferView": len(views) - 1, "componentType": 5125, "count": len(indices), "type": "SCALAR"})
        primitives.append({"attributes": attrs, "indices": len(accessors) - 1, "material": k, "mode": 4})
    while len(binary) % 4:
        binary += b"\0"
    doc = {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": primitives}], "materials": [{"name": "m0"}, {"name": "m1"}],
        "buffers": [{"byteLength": len(binary)}], "bufferViews": views, "accessors": accessors,
        "extensionsUsed": ["CESIUM_RTC"], "extensions": {"CESIUM_RTC": {"center": [offset[0], offset[1], 0]}},
    }  # fmt: skip
    text = json.dumps(doc).encode()
    while len(text) % 4:
        text += b" "
    glb = b"glTF" + (2).to_bytes(4, "little") + (12 + 8 + len(text) + 8 + len(binary)).to_bytes(4, "little")
    glb += len(text).to_bytes(4, "little") + b"JSON" + text + len(binary).to_bytes(4, "little") + b"BIN\0" + bytes(binary)
    with open(os.path.join(folder, meshes.GLB), "wb") as f:
        f.write(glb)
    with open(os.path.join(folder, meshes.MTL), "w") as f:
        f.write("newmtl material0000\nmap_Kd a.png\nnewmtl material0001\nmap_Kd b.png\n")
    with open(os.path.join(folder, meshes.OBJ), "w") as f:
        f.write("mtllib odm_textured_model_geo.mtl\n")  # its content is not read: the GLB is the source
    task.available_assets = [*task.available_assets, "textured_model.glb", "textured_model.zip"]
    task.save()
    return folder


def obj_heights(path):
    with open(path) as f:
        return [float(line.split()[3]) for line in f if line.startswith("v ")]


def obj_faces(path):
    with open(path) as f:
        return sum(1 for line in f if line.startswith("f "))


class TestSplatMe(BootTestCase):
    def setUp(self):
        self.node = FakeNode()
        self.addCleanup(self.node.close)
        training.set_node(self.node.url, self.node.token)
        for name in ("POLL", "REVIVE_EVERY"):
            patcher = mock.patch.object(training, name, 0)
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
                "task_status": status_codes.COMPLETED, "editable": False, "apply": None, "thumbnail": None, "model_editable": False, "model_apply": None,
                "auto": {"enabled": False, "options": training.DEFAULTS}, "listening": None,
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

    def test_a_training_keeps_each_stages_time_and_a_continued_model_its_earlier_training_time(self):
        clock = iter(range(1_000_000, 2_000_000, 10))  # every look at the time is 10 s later
        task = make_task(self.user)
        with mock.patch.object(training.time, "time", lambda: float(next(clock))):
            self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
            first = self.status(task)
            self.assertEqual(first["state"], "completed")
            times = first["times"]
            for stage in ("starting", "exporting", "uploading", "training", "importing"):
                self.assertGreater(times.get(stage, 0), 0, (stage, times))
            self.assertEqual(first["earlier_training"], 0)
            self.assertIsNone(first["resume"])
            self.assertEqual(training.trained_seconds(task), times["training"])
            self.assertNotIn(training.TRAINING_SECONDS, training.trained_options(task))

            self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
            second = self.status(task)
            self.assertEqual(second["state"], "completed")
            self.assertEqual(second["resume"], 10)
            self.assertEqual(second["earlier_training"], times["training"])
            self.assertEqual(training.trained_seconds(task), times["training"] + second["times"]["training"])
            self.assertEqual(second["options"], {"steps": 15, "image_size": 16})

    def test_a_model_without_its_training_time_continues_with_the_earlier_time_unknown(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        path = training.trained_options_file(task)
        with open(path, "w") as f:
            json.dump({"steps": 10, "image_size": 16}, f)  # as SplatMe 0.3 kept it
        self.assertIsNone(training.trained_seconds(task))
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertIsNone(status["earlier_training"])
        self.assertIsNone(training.trained_seconds(task))

    def jpeg(self, size=(32, 20), kind="JPEG"):
        out = io.BytesIO()
        Image.new("RGB", size, (10, 120, 30)).save(out, kind)
        return out.getvalue()

    def test_a_thumbnail_is_kept_for_those_who_may_see_the_task_and_dropped_by_a_training(self):
        task = make_task(self.user)
        url = f"{API}/task/{task.id}/thumbnail"
        self.assertEqual(self.client.put(url, self.jpeg(), content_type="image/jpeg").status_code, 400)  # no model yet
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertIsNone(self.status(task)["thumbnail"])
        self.assertEqual(self.client.get(url).status_code, 404)

        res = self.client.put(url, self.jpeg(), content_type="image/jpeg")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIsNotNone(self.status(task)["thumbnail"])
        got = self.client.get(url)
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got["Content-Type"], "image/jpeg")
        self.assertEqual(b"".join(got.streaming_content), self.jpeg())

        # Someone who may only see the project sees it, and may not change it
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(other.get(url).status_code, 404)
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertEqual(other.get(url).status_code, 200)
        self.assertEqual(other.put(url, self.jpeg(), content_type="image/jpeg").status_code, 404)  # as WebODM answers

        # A training replaces the model, and the picture of it goes
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        self.assertIsNone(self.status(task)["thumbnail"])
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_a_thumbnail_must_be_a_small_jpeg(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        url = f"{API}/task/{task.id}/thumbnail"
        for body in (b"", b"not an image", self.jpeg(kind="PNG"), self.jpeg(size=(2000, 10)),
                     self.jpeg()[:-200], b"\xff\xd8\xff" + b"0" * training.THUMBNAIL_BYTES):
            res = self.client.put(url, body, content_type="image/jpeg")
            self.assertEqual(res.status_code, 400, body[:20])
            self.assertIn("thumbnail", res.data["error"])
        self.assertIsNone(self.status(task)["thumbnail"])

    # Model edits (meshes.py)

    def model_edits(self, task, given=None):
        url = f"{API}/task/{task.id}/model-edits"
        if given is None:
            return self.client.get(url)
        return self.client.put(url, {"edits": given}, format="json")

    def test_model_edits_are_kept_in_the_tasks_projection_and_given_in_the_models_frame(self):
        task = make_task(self.user)
        self.assertEqual(self.model_edits(task).data["editable"], "This task has no textured 3D model.")
        make_textured_model(task)
        box = {"op": "delete", "type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        res = self.model_edits(task, [box, {"type": "floating", "size": 10}])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"], [box, {"type": "floating", "size": 10}])
        stored = edits.store().get_json(meshes.edits_key(task.id))
        self.assertEqual(stored[0]["center"], [1001.5, 2001.5, 0])
        self.assertEqual(res.data["model"]["url"], f"/api/plugins/splatme/task/{task.id}/model-original")
        self.assertIsNone(res.data["applied"])
        for bad in ([{**box, "op": "melt"}], [{"type": "floating", "size": 0}], [{"type": "floating", "size": True}],
                    [{**box, "size": [1, -1, 1]}], "not a list"):
            res = self.model_edits(task, bad)
            self.assertEqual(res.status_code, 400, bad)
        self.assertEqual(len(self.model_edits(task).data["edits"]), 2)  # the bad ones changed nothing

    def test_only_those_who_may_change_the_project_edit_the_model_or_read_its_original(self):
        task = make_task(self.user)
        make_textured_model(task)
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        res = other.get(f"{API}/task/{task.id}/model-edits")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["can_edit"])
        self.assertIsNone(res.data["model"])
        self.assertEqual(other.put(f"{API}/task/{task.id}/model-edits", {"edits": []}, format="json").status_code, 404)
        self.assertEqual(other.get(f"{API}/task/{task.id}/model-original").status_code, 404)
        self.assertEqual(other.post(f"{API}/task/{task.id}/model-apply").status_code, 404)
        got = self.client.get(f"{API}/task/{task.id}/model-original")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(b"".join(got.streaming_content)[:4], b"glTF")

    def test_updating_the_model_replaces_its_glb_and_obj_keeps_the_originals_and_clearing_puts_them_back(self):
        task = make_task(self.user)
        folder = make_textured_model(task)
        with open(os.path.join(folder, meshes.GLB), "rb") as f:
            original_glb = f.read()
        cache = task.get_task_assets_cache()
        os.makedirs(cache, exist_ok=True)
        cached = os.path.join(cache, "odm_textured_model_geo-2.glb")
        with open(cached, "wb") as f:
            f.write(b"an old smaller copy")
        box = {"op": "delete", "type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        self.assertEqual(self.model_edits(task, [box, {"type": "floating", "size": 5}]).status_code, 200)

        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual(res.data["apply"]["removed"], 3)  # the box's square and the floating triangle
        self.assertEqual(res.data["apply"]["triangles"], 16)
        self.assertTrue(res.data["applied"])
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 16)
        doc = glb_json(os.path.join(folder, meshes.GLB))
        self.assertEqual(len(doc["meshes"][0]["primitives"]), 1)  # the floating triangle's piece went
        self.assertEqual(doc["extensions"]["CESIUM_RTC"], {"center": [1000, 2000, 0]})
        self.assertIn("KHR_draco_mesh_compression", doc["extensionsUsed"])
        with open(os.path.join(meshes.model_dir(task), meshes.GLB), "rb") as f:
            self.assertEqual(f.read(), original_glb)
        self.assertFalse(os.path.exists(cached))
        with open(os.path.join(folder, meshes.MTL)) as f:
            self.assertIn("newmtl material0001", f.read())

        # The edits changed since: the model no longer has them
        self.assertEqual(self.model_edits(task, [box]).status_code, 200)
        self.assertFalse(self.model_edits(task).data["applied"])

        # A second update starts again from the originals: the floating triangle is back
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["triangles"], 17)

        # No edits: the original files back, as they were
        self.assertEqual(self.model_edits(task, []).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        with open(os.path.join(folder, meshes.GLB), "rb") as f:
            self.assertEqual(f.read(), original_glb)
        self.assertTrue(self.model_edits(task).data["applied"])

    def test_flatten_moves_what_the_shape_covers_onto_the_plane_of_its_rim(self):
        task = make_task(self.user)
        folder = make_textured_model(task, bump=0.5)
        # Over the four squares around the raised vertex: their rim (x or y 2) is at z 0
        flatten = {"op": "flatten", "type": "box", "keep": False, "center": [1, 1, 0], "size": [1.9, 1.9, 5], "turn": 0}
        res = self.model_edits(task, [flatten])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"], [flatten])
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual(res.data["apply"]["removed"], 0)
        self.assertEqual(res.data["apply"]["flattened"], 4)
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 19)
        heights = obj_heights(os.path.join(folder, meshes.OBJ))
        self.assertTrue(heights and max(abs(z) for z in heights) < 1e-5, max(heights))
        with open(os.path.join(meshes.model_dir(task), meshes.GLB), "rb") as f:
            self.assertIn(b"glTF", f.read(4))  # the original, bump and all, kept

    def test_fill_holes_adds_triangles_with_a_texture_of_their_own_which_goes_when_no_fill_needs_it(self):
        task = make_task(self.user)
        folder = make_textured_model(task, hole=True, unit=0.05)  # a narrow hole: the smooth blend
        texture = os.path.join(folder, meshes.FILL_TEXTURE)
        for bad in ([{"type": "holes", "size": 0}], [{"type": "holes", "size": meshes.MAX_HOLE + 1}], [{"type": "holes"}]):
            self.assertEqual(self.model_edits(task, bad).status_code, 400, bad)
        self.assertEqual(self.model_edits(task, [{"type": "holes", "size": 4}]).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual((res.data["apply"]["filled"], res.data["apply"]["added"]), (1, 2))
        self.assertEqual(res.data["apply"]["triangles"], 19)  # 16 of the grid, the floating one and the fill's 2
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 19)
        self.assertTrue(os.path.exists(texture))
        with open(os.path.join(folder, meshes.MTL)) as f:
            self.assertIn("newmtl splatme_fill\n", f.read())
        doc = glb_json(os.path.join(folder, meshes.GLB))
        self.assertEqual(len(doc["meshes"][0]["primitives"]), 3)
        self.assertEqual(doc["images"][-1]["mimeType"], "image/jpeg")

        # An update that fills nothing, then no edits at all: the texture goes with the fill
        box = {"op": "delete", "type": "box", "keep": False, "center": [0.5, 0.5, 0], "size": [1, 1, 1], "turn": 0}
        self.assertEqual(self.model_edits(task, [box]).status_code, 200)
        self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertFalse(os.path.exists(texture))
        self.assertEqual(self.model_edits(task, [{"type": "holes", "size": 4}]).status_code, 200)
        self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertTrue(os.path.exists(texture))
        self.assertEqual(self.model_edits(task, []).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertFalse(os.path.exists(texture))

    def test_a_wide_fill_is_textured_from_beside_it_in_the_clones_texture(self):
        task = make_task(self.user)
        folder = make_textured_model(task, hole=True)  # a 1 m hole
        self.assertEqual(self.model_edits(task, [{"type": "holes", "size": 4}]).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual((res.data["apply"]["filled"], res.data["apply"]["added"]), (1, 2))
        self.assertTrue(os.path.exists(os.path.join(folder, meshes.CLONE_TEXTURE)))
        self.assertFalse(os.path.exists(os.path.join(folder, meshes.FILL_TEXTURE)))
        with open(os.path.join(folder, meshes.MTL)) as f:
            self.assertIn("newmtl splatme_clone\n", f.read())
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 19)

    def test_move_and_smooth_change_the_models_shape_in_steps_checked_by_the_server(self):
        task = make_task(self.user)
        folder = make_textured_model(task, bump=0.5)
        middle = {"type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        raise_ = {"op": "move", **middle, "offset": [0, 0, 0.5], "scale": [1, 1, 1], "soft": 0}
        for bad in ({**raise_, "offset": [0, 0]}, {**raise_, "scale": [1, 0, 1]}, {**raise_, "soft": -1},
                    {**raise_, "offset": [0, 0, 101]}, {"op": "smooth", **middle, "passes": 0},
                    {"op": "smooth", **middle, "passes": 1.5}, {"op": "smooth", **middle}):
            self.assertEqual(self.model_edits(task, [bad]).status_code, 400, bad)
        res = self.model_edits(task, [raise_])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"], [{**raise_, "offset": [0.0, 0.0, 0.5], "scale": [1.0, 1.0, 1.0], "soft": 0.0}])
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual(res.data["apply"]["moved"], 4)  # the middle square's corners
        heights = obj_heights(os.path.join(folder, meshes.OBJ))
        self.assertAlmostEqual(max(heights), 1.0, places=5)  # the bump's corner, raised with the rest
        self.assertEqual(sorted({round(z, 4) for z in heights}), [0.0, 0.5, 1.0])

        # Smooth over the four squares around the bump: its vertex settles toward its flat neighbours
        around = {"type": "box", "keep": False, "center": [1, 1, 0], "size": [1.9, 1.9, 5], "turn": 0}
        self.assertEqual(self.model_edits(task, [{"op": "smooth", **around, "passes": 3}]).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        heights = obj_heights(os.path.join(folder, meshes.OBJ))
        self.assertLess(max(heights), 0.5)
        self.assertGreater(max(heights), 0)

    def test_straighten_keeps_its_line_in_the_tasks_projection_and_pulls_the_surface_to_it(self):
        task = make_task(self.user)
        folder = make_textured_model(task, bump=0.5)
        around = {"type": "box", "keep": False, "center": [1, 1, 0], "size": [1.9, 1.9, 5], "turn": 0}
        line = {"op": "straighten", **around, "line": [[0, 1, 0], [2, 1, 0]], "strength": 1, "reach": 1}
        for bad in ({**line, "line": [[0, 1, 0]]}, {**line, "strength": 1.5}, {**line, "reach": 0},
                    {**line, "line": [[0, 1], [2, 1]]}):
            self.assertEqual(self.model_edits(task, [bad]).status_code, 400, bad)
        res = self.model_edits(task, [line])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"][0]["line"], [[0, 1, 0], [2, 1, 0]])
        stored = edits.store().get_json(meshes.edits_key(task.id))
        self.assertEqual(stored[0]["line"], [[1000, 2001, 0], [1002, 2001, 0]])
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual(res.data["apply"]["moved"], 2)  # within reach and inside the rim: the bump, and (0, 1) on the line
        heights = obj_heights(os.path.join(folder, meshes.OBJ))
        self.assertAlmostEqual(max(heights), 0.25, places=4)  # 0.5 m from the line, reach 1: half the way

    def test_clone_texture_moves_the_covered_triangles_to_a_texture_of_their_own_which_goes_with_the_clone(self):
        task = make_task(self.user)
        folder = make_textured_model(task)
        texture = os.path.join(folder, meshes.CLONE_TEXTURE)
        column = {"type": "box", "keep": False, "center": [2.5, 1.5, 0], "size": [0.9, 2.9, 5], "turn": 0}
        clone = {"op": "clone", **column, "source": [0.5, 1.5, 0], "patch": 1, "feather": 0.25, "spin": 0}
        for bad in ({**clone, "source": [0, 1]}, {**clone, "patch": 0}, {**clone, "feather": 6}, {**clone, "spin": 200}):
            self.assertEqual(self.model_edits(task, [bad]).status_code, 400, bad)
        res = self.model_edits(task, [clone])
        self.assertEqual(res.status_code, 200, res.data)
        stored = edits.store().get_json(meshes.edits_key(task.id))
        self.assertEqual(stored[0]["source"], [1000.5, 2001.5, 0])
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertEqual(res.data["apply"]["cloned"], 6)  # the last column's 3 squares
        self.assertEqual(res.data["apply"]["triangles"], 19)
        self.assertTrue(os.path.exists(texture))
        with open(os.path.join(folder, meshes.MTL)) as f:
            self.assertIn("newmtl splatme_clone\n", f.read())
        self.assertEqual(len(glb_json(os.path.join(folder, meshes.GLB))["meshes"][0]["primitives"]), 3)
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 19)

        self.assertEqual(self.model_edits(task, []).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "completed", res.data)
        self.assertFalse(os.path.exists(texture))

    def test_an_update_whose_node_fails_says_why_and_leaves_the_model_as_it_was(self):
        task = make_task(self.user)
        folder = make_textured_model(task)
        with open(os.path.join(folder, meshes.GLB), "wb") as f:
            f.write(b"not a glb")
        box = {"op": "delete", "type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        self.assertEqual(self.model_edits(task, [box]).status_code, 200)
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "failed")
        self.assertTrue(res.data["apply"]["error"].startswith("The model could not be made: "), res.data)
        with open(os.path.join(folder, meshes.GLB), "rb") as f:
            self.assertEqual(f.read(), b"not a glb")
        self.assertFalse(meshes.kept(task))
        self.assertFalse(os.path.exists(training.apply_dir(task.id, kind=meshes.KIND)))

    def test_an_update_that_takes_too_long_or_is_canceled_stops_node(self):
        task = make_task(self.user)
        make_textured_model(task)
        box = {"op": "delete", "type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        self.assertEqual(self.model_edits(task, [box]).status_code, 200)
        started = []

        def hanging():
            # A Node that never ends, and ignores SIGTERM: only the forced stop ends it
            return [sys.executable, "-c", "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)"]

        real_popen = subprocess.Popen

        def popen(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            started.append(process)
            return process

        with mock.patch.object(meshes, "node_command", hanging), mock.patch.object(meshes, "NODE_TIMEOUT", 1), \
                mock.patch.object(meshes, "STOP_WAIT", 1), mock.patch.object(meshes.subprocess, "Popen", popen):
            began = time.time()
            res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertLess(time.time() - began, 15)
        self.assertEqual(res.data["apply"]["state"], "failed")
        self.assertIn("took too long", res.data["apply"]["error"])
        self.assertIsNotNone(started[0].poll())  # ended

        # Canceled while Node runs: it is stopped, and the model stays as it was
        def cancel_soon(task_id, run):
            training.cancel_apply(task_id, meshes.KIND)
            training.check_apply(task_id, run, meshes.KIND)

        with mock.patch.object(meshes, "node_command", hanging), mock.patch.object(meshes, "STOP_WAIT", 1), \
                mock.patch.object(meshes, "check", cancel_soon), mock.patch.object(meshes.subprocess, "Popen", popen):
            res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["state"], "canceled")
        self.assertIsNotNone(started[1].poll())
        self.assertFalse(meshes.kept(task))

    def test_processing_the_task_again_keeps_its_model_edits_for_the_new_model_and_drops_the_old_originals(self):
        task = make_task(self.user)
        folder = make_textured_model(task)
        box = {"op": "delete", "type": "box", "keep": False, "center": [1.5, 1.5, 0], "size": [1, 1, 1], "turn": 0}
        self.assertEqual(self.model_edits(task, [box]).status_code, 200)
        self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertTrue(meshes.kept(task))
        # Processed again: WebODM writes a new model (here the same one, whole)
        make_textured_model(task)
        training.completed(task.id)
        self.assertFalse(meshes.kept(task))
        res = self.model_edits(task)
        self.assertEqual(res.data["edits"], [box])
        self.assertIsNone(res.data["applied"])
        self.assertIsNone(res.data["apply"])
        res = self.client.post(f"{API}/task/{task.id}/model-apply")
        self.assertEqual(res.data["apply"]["triangles"], 17)  # cut from the new model
        self.assertEqual(obj_faces(os.path.join(folder, meshes.OBJ)), 17)

    def test_a_removed_task_forgets_its_model_edits(self):
        task = make_task(self.user)
        make_textured_model(task)
        self.assertEqual(self.model_edits(task, [{"type": "floating", "size": 5}]).status_code, 200)
        task_id = task.id
        training.removed(task_id)
        self.assertIsNone(edits.store().get_json(meshes.edits_key(task_id), None))

    def find_sky(self, sky_rows):
        """Stands in for the sky model: the top rows of every photo are sky."""
        found = np.zeros((sky.MODEL_INPUT, sky.MODEL_INPUT), dtype=np.float32)
        found[:sky_rows] = 1.0
        patcher = mock.patch.object(sky, "load", return_value=lambda pixels: found)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def test_ignore_sky_sends_a_mask_of_each_photo_that_shows_sky(self):
        task = make_task(self.user)
        self.find_sky(sky.MODEL_INPUT // 2)
        res = self.train(task, steps=10, image_size=16, ignore_sky="true")
        self.assertEqual(res.status_code, 200, res.data)
        status = self.status(task)
        self.assertEqual(status["state"], "completed", status)
        self.assertEqual(status["options"], {"steps": 10, "image_size": 16, "ignore_sky": True})
        self.assertEqual(status["sky_masks"], 2)

        job = self.node.jobs["job1"]
        self.assertEqual(job["options"], {"steps": 10})  # the node is not told: the masks are in the zip
        self.assertEqual(sorted(job["masks"]), sorted(f"masks/{image}.png" for image in IMAGES))
        mask = np.asarray(Image.open(io.BytesIO(job["masks"][f"masks/{IMAGES[0]}.png"])))
        self.assertEqual(mask.shape, (12, 16))  # the exported photo's size
        self.assertTrue((mask[0] == 0).all())  # the sky is black: ignored
        self.assertTrue((mask[-1] == 255).all())

        # Continuing keeps the option, as it does the others
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        self.assertEqual(len(self.node.jobs["job2"]["masks"]), 2)
        self.assertEqual(self.status(task)["options"], {"steps": 15, "image_size": 16, "ignore_sky": True})

    def test_training_without_ignore_sky_sends_no_masks(self):
        task = make_task(self.user)
        load = self.find_sky(sky.MODEL_INPUT // 2)
        self.assertEqual(self.train(task, steps=10, image_size=16, ignore_sky="false").status_code, 200)
        load.assert_not_called()
        self.assertEqual(self.node.jobs["job1"]["masks"], {})
        self.assertIsNone(self.status(task)["sky_masks"])

    def test_photos_that_look_down_are_not_searched_for_sky(self):
        task = make_task(self.user, rotation=(math.pi, 0, 0))
        load = self.find_sky(sky.MODEL_INPUT // 2)
        self.assertEqual(self.train(task, steps=10, image_size=16, ignore_sky="true").status_code, 200)
        load.assert_not_called()
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["sky_masks"], 0)
        self.assertEqual(self.node.jobs["job1"]["masks"], {})

    def test_a_photo_looking_just_below_the_horizon_is_searched_for_sky(self):
        # The test camera sees 24 degrees from the middle of the picture to its upper edge
        def searched(degrees_down):
            task = make_task(self.user, rotation=(math.radians(90 + degrees_down), 0, 0))
            view = sky.photo_views(task)[IMAGES[0]]
            return sky.above_horizon(view, 48, 36)

        self.assertFalse(searched(45).any())
        rows = searched(20).all(axis=1)
        self.assertTrue(rows[0])  # the upper edge is within the margin of the horizon
        self.assertFalse(rows[-1])
        self.assertTrue(searched(-30).all())  # looking up

    def test_sky_is_found_only_above_a_photos_horizon(self):
        # The model takes bright roofs and water for sky: what it finds below the horizon is not masked
        task = make_task(self.user, rotation=(math.radians(90 + 20), 0, 0))
        self.find_sky(sky.MODEL_INPUT)  # sky everywhere, says the model
        self.assertEqual(self.train(task, steps=10, image_size=16, ignore_sky="true").status_code, 200)
        mask = np.asarray(Image.open(io.BytesIO(self.node.jobs["job1"]["masks"][f"masks/{IMAGES[0]}.png"])))
        self.assertTrue((mask[0] == 0).all())
        self.assertTrue((mask[-1] == 255).all())

    def test_a_photo_without_sky_gets_no_mask(self):
        task = make_task(self.user)
        self.find_sky(0)
        self.assertEqual(self.train(task, steps=10, image_size=16, ignore_sky="true").status_code, 200)
        self.assertEqual(self.status(task)["sky_masks"], 0)
        self.assertEqual(self.node.jobs["job1"]["masks"], {})

    def test_a_sky_model_that_cannot_be_downloaded_fails_the_training_with_the_reason(self):
        task = make_task(self.user)
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        with (
            mock.patch.object(sky, "model_path", return_value=os.path.join(folder, "models", "model.onnx")),
            mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("no route")) as urlopen,
        ):
            self.assertEqual(self.train(task, steps=10, image_size=16, ignore_sky="true").status_code, 200)
            self.assertEqual(urlopen.call_args.args[0], sky.MODEL_URL)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("The sky model could not be downloaded", status["error"])
        self.assertIn("train without Ignore Sky", status["error"])
        self.assertEqual(self.node.jobs, {})
        self.assertEqual(os.listdir(os.path.join(folder, "models")), [])

    def test_a_downloaded_sky_model_that_is_not_the_expected_file_is_not_used(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = {"Content-Length": "5"}
        response.read.side_effect = [b"other", b""]
        with (
            mock.patch.object(sky, "model_path", return_value=os.path.join(folder, "model.onnx")),
            mock.patch("urllib.request.urlopen", return_value=response),
            self.assertRaisesRegex(sky.SkyError, "not the expected file"),
        ):
            sky.download_model()
        self.assertEqual(os.listdir(folder), [])

    def test_a_tasks_setting_keeps_ignore_sky(self):
        task = make_task(self.user)
        res = self.client.post(f"{API}/task/{task.id}/auto", {"enabled": True, "steps": 10, "ignore_sky": True}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["options"], {"steps": 10, "image_size": 1600, "ignore_sky": True})
        res = self.client.post(f"{API}/task/{task.id}/auto", {"enabled": True, "steps": 10, "ignore_sky": False}, format="json")
        self.assertEqual(res.data["options"], {"steps": 10, "image_size": 1600})

    def with_boundary(self, task, geojson=None):
        """The task as processed with a boundary: a 2 degree square around 0, 0 (the model's x and y are degrees)."""
        square = {"type": "Polygon", "coordinates": [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]}
        geojson = geojson or {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": square}]}
        task.options = [{"name": "boundary", "value": json.dumps(geojson)}]
        task.epsg = 4326
        task.save()

    def node_model(self, points):
        """The stand-in node's next model: a .ply of gaussians at these x, y."""
        header = (
            f"ply\nformat binary_little_endian 1.0\ncomment Generated by opensplat at iteration 10\n"
            f"element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n"
            "property float opacity\nend_header\n"
        ).encode()
        rows = np.array([(x, y, 5.0, i) for i, (x, y) in enumerate(points)], dtype="<f4")
        patcher = mock.patch("coreplugins.splatme.tests.fake_node.trained", return_value=header + rows.tobytes())
        patcher.start()
        self.addCleanup(patcher.stop)
        return header, rows

    def test_a_task_with_a_boundary_shows_only_the_gaussians_inside_it(self):
        task = make_task(self.user)
        self.assertFalse(self.client.get(f"{API}/task/{task.id}/check").data["boundary"])
        self.with_boundary(task)
        self.assertTrue(self.client.get(f"{API}/task/{task.id}/check").data["boundary"])
        header, rows = self.node_model([(0, 0), (3, 0), (0.5, -0.5), (0, -1.5)])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed", status)
        self.assertEqual(status["cropped"], 2)
        self.assertEqual(status["options"], {"steps": 10, "image_size": 16})
        # What WebODM's converter was given: the two gaussians inside
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 2") + rows[[0, 2]].tobytes()])
        # What a later training continues from: all the trainer made
        with open(training.trained_model(task), "rb") as f:
            self.assertEqual(f.read(), header + rows.tobytes())
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"], 10)

    def test_crop_turned_off_keeps_the_whole_model(self):
        task = make_task(self.user)
        self.with_boundary(task)
        header, rows = self.node_model([(0, 0), (3, 0)])
        self.assertEqual(self.train(task, steps=10, image_size=16, crop="false").status_code, 200)
        status = self.status(task)
        self.assertEqual(status["options"], {"steps": 10, "image_size": 16, "crop": False})
        self.assertIsNone(status["cropped"])
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_a_boundary_with_nothing_of_the_model_inside_crops_nothing(self):
        task = make_task(self.user)
        self.with_boundary(task)
        header, rows = self.node_model([(5, 5), (3, 0)])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertIsNone(self.status(task)["cropped"])
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_a_boundary_of_several_polygons_keeps_what_is_inside_any_of_them(self):
        task = make_task(self.user)
        far = [[[[9, 9], [11, 9], [11, 11], [9, 11], [9, 9]]], [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]]
        self.with_boundary(task, {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": far}})
        self.assertEqual(len(crop.boundary(task)), 2)
        self.node_model([(10, 10), (5, 5), (0, 0)])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertEqual(self.status(task)["cropped"], 1)
        # A boundary that is not GeoJSON crops nothing
        task.options = [{"name": "boundary", "value": "not json"}]
        task.save()
        self.assertEqual(crop.boundary(task), [])

    def test_grow_until_is_sent_to_the_node_only_when_set(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=5000, image_size=16, densify_until="").status_code, 200)
        self.assertEqual(self.node.jobs["job1"]["options"], {"steps": 5000})
        res = self.train(task, steps=30000, image_size=16, densify_until=27000)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.node.jobs["job2"]["options"], {"steps": 30000, "densify_until": 27000})
        self.assertEqual(self.status(task)["options"]["densify_until"], 27000)

    def test_grow_until_beyond_the_steps_less_3000_or_below_1000_is_refused(self):
        task = make_task(self.user)
        for steps, grow_until, message in ((30000, 27001, "at most 27000"), (3999, 1000, "at most 999"),
                                           (30000, 999, "between 1000 and")):
            res = self.train(task, steps=steps, densify_until=grow_until)
            self.assertEqual(res.status_code, 400, (steps, grow_until))
            self.assertIn(message, res.data["error"])
        self.assertEqual(self.node.jobs, {})

    def test_grow_until_needs_a_node_that_has_it_and_blank_does_not(self):
        task = make_task(self.user)
        del self.node.options["densify_until"]
        res = self.train(task, steps=30000, densify_until=20000)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Update the node", res.data["error"])
        self.assertEqual(self.train(task, steps=30000, densify_until="").status_code, 200)

    def test_continuing_may_set_grow_until_after_the_models_steps_or_keep_the_models(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=20000, image_size=16, densify_until=10000).status_code, 200)
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_grow_until"], 10000)
        self.assertEqual(self.train(task, resume="true", steps=10000, densify_until="").status_code, 200)
        self.assertEqual(self.node.jobs["job2"]["options"], {"steps": 30000, "densify_until": 10000})
        for grow_until, message in ((30999, "between 31000 and 37000"), (37001, "between 31000 and 37000")):
            res = self.train(task, resume="true", steps=10000, densify_until=grow_until)
            self.assertEqual(res.status_code, 400, grow_until)
            self.assertIn(message, res.data["error"])
        res = self.train(task, resume="true", steps=10000, densify_until=37000)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.node.jobs["job3"]["options"], {"steps": 40000, "densify_until": 37000})
        self.assertEqual(self.status(task)["options"]["densify_until"], 37000)
        self.assertEqual(training.trained_options(task)["densify_until"], 37000)
        other = make_task(self.user)
        self.assertEqual(self.train(other, steps=10).status_code, 200)
        self.assertIsNone(self.client.get(f"{API}/task/{other.id}/check").data["trained_grow_until"])

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
        self.assertEqual(check["photo_sizes"], [[48, 36]])  # the photos as processed, for the Image Size table

    def test_the_check_gives_each_cameras_photo_size_largest_first_and_none_before_processing(self):
        task = make_task(self.user)
        with open(task.get_asset_file_or_stream("cameras.json"), "w") as f:
            json.dump({"a": {"width": 640, "height": 512}, "b": {"width": 5280, "height": 3956},
                       "c": {"width": 640, "height": 512}}, f)  # fmt: skip
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["photo_sizes"], [[5280, 3956], [640, 512]])
        os.remove(task.get_asset_file_or_stream("cameras.json"))
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["photo_sizes"], [])

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

    def test_the_tasks_and_settings_pages_are_in_the_menu_and_need_a_login(self):
        res = self.client.get("/plugins/splatme/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'id="splatme-tasks"')
        res = self.client.get("/plugins/splatme/settings/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Splat Node")
        dashboard = self.client.get("/dashboard/")
        self.assertContains(dashboard, 'href="/plugins/splatme/"')
        self.assertContains(dashboard, 'href="/plugins/splatme/settings/"')
        self.assertEqual(APIClient().get("/plugins/splatme/").status_code, 302)
        self.assertEqual(APIClient().get("/plugins/splatme/settings/").status_code, 302)

    def test_the_admin_page_is_for_staff_accounts_and_its_form_for_superusers(self):
        self.assertEqual(self.client.get("/plugins/splatme/admin/").status_code, 403)
        self.assertEqual(APIClient().get("/plugins/splatme/admin/").status_code, 302)
        # The SplatMe page has no form for the node, and the admin page has it
        self.assertNotContains(self.client.get("/plugins/splatme/settings/"), 'id="splatme-form"')
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        res = admin.get("/plugins/splatme/admin/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'id="splatme-form"')
        self.assertContains(res, "New Task With Splats Defaults")

        # A staff account that is not a superuser sees Administration and so the page, but changes nothing on it
        self.user.is_staff = True
        self.user.save()
        self.assertEqual(self.client.get("/plugins/splatme/admin/").status_code, 200)
        self.assertEqual(self.client.post(f"{API}/node", {"url": "http://elsewhere:3100"}).status_code, 403)
        self.assertEqual(self.client.post(f"{API}/automation/shared", {"steps": 30}).status_code, 403)

    def test_everyone_sees_the_nodes_state_and_address_and_only_administrators_change_them(self):
        res = self.client.get(f"{API}/node")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["admin"])
        self.assertEqual(res.data["node"]["trainer"], "OpenSplat fake")
        self.assertEqual(res.data["url"], self.node.url)
        self.assertNotIn("token_set", res.data)
        self.assertNotIn(self.node.token, json.dumps(res.data))
        self.assertEqual(APIClient().get(f"{API}/node").status_code, 403)

        # What is wrong with the node is for administrators; the address is still shown
        training.set_node("http://127.0.0.1:9")
        res = self.client.get(f"{API}/node")
        self.assertIn("Ask an administrator", res.data["error"])
        self.assertNotIn("127.0.0.1", res.data["error"])
        self.assertEqual(res.data["url"], "http://127.0.0.1:9")

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
        self.assertEqual(res.data, {"enabled": True, "options": {"steps": 20, "image_size": 16}})
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

    def test_a_task_created_with_the_button_starts_with_the_options_the_administrators_chose(self):
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        self.assertEqual(self.client.post(f"{API}/automation/shared", {"steps": 30}, format="json").status_code, 403)
        res = admin.post(f"{API}/automation/shared", {"steps": 30, "ignore_sky": True}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["listening"])
        self.assertEqual(res.data["options"], {"steps": 30, "image_size": 1600, "ignore_sky": True})

        # A user who saved none of their own reads them, and whether the worker listens: SplatMe's panel warns
        # when it does not
        res = self.client.get(f"{API}/automation")
        self.assertEqual(res.data["options"]["steps"], 30)
        self.assertFalse(res.data["own"])
        self.assertTrue(res.data["listening"])

        # The options alone train nothing: only a task given the setting is trained
        other = make_task(self.user)
        self.complete(other)
        self.assertIsNone(training.get_job(other.id))

        # SplatMe's panel above the New Task panel is filled before the task exists: the ranges come without one
        res = self.client.get(f"{API}/automation?ranges=1")
        self.assertEqual(res.data["ranges"]["steps"], OPTIONS["steps"])

        # The panel gives the task its setting as soon as WebODM has created it, before it is processed
        task = make_task(self.user, status=None)
        res = self.auto(task, enabled=True, steps=30, ignore_sky=True)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data, {"enabled": True, "options": {"steps": 30, "image_size": 1600, "ignore_sky": True}})

        # Options chosen later are for the tasks created later; the Edit Task panel's can switch it off
        admin.post(f"{API}/automation/shared", {"steps": 40}, format="json")
        self.assertEqual(training.get_auto(task.id)["options"]["steps"], 30)
        self.assertEqual(self.auto(task, enabled=False, steps=30).data["enabled"], False)
        task.status = status_codes.COMPLETED
        task.save()
        self.complete(task)
        self.assertIsNone(training.get_job(task.id))

    def test_each_user_saves_their_own_options_for_a_new_task(self):
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        admin.post(f"{API}/automation/shared", {"steps": 30}, format="json")

        res = self.client.post(f"{API}/automation", {"steps": 2000, "crop": False}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["own"])
        self.assertEqual(res.data["options"], {"steps": 2000, "image_size": 1600, "crop": False})
        self.assertEqual(self.client.post(f"{API}/automation", {"steps": 0}, format="json").status_code, 400)
        self.assertEqual(self.client.get(f"{API}/automation?ranges=1").data["options"]["steps"], 2000)

        # Others are not changed by it, administrators included, nor the starting point
        self.assertEqual(admin.get(f"{API}/automation").data["options"]["steps"], 30)
        self.assertEqual(admin.get(f"{API}/automation/shared").data["options"]["steps"], 30)

        # The Edit Task panel of a task with no setting starts with the user's own options
        task = make_task(self.user)
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/auto").data["options"]["steps"], 2000)
        self.assertEqual(self.status(task)["auto"], {"enabled": False, "options": res.data["options"]})

        # Dropping their own goes back to the administrators'
        res = self.client.post(f"{API}/automation", {"reset": True}, format="json")
        self.assertFalse(res.data["own"])
        self.assertEqual(res.data["options"]["steps"], 30)

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

    def test_a_task_set_to_train_that_cannot_be_trained_says_why(self):
        task = make_task(self.user, images=["a.tif"])
        self.auto(task, enabled=True)
        self.complete(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertTrue(status["auto"])
        self.assertIn("The training did not start. Only JPEG images", status["error"])

    def test_a_node_that_does_not_answer_when_a_task_completes_is_reported_on_the_task(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        training.set_node("http://127.0.0.1:9")
        self.complete(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("does not answer", status["error"])

    def test_a_disabled_plugin_trains_nothing(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
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
        self.assertFalse(training.get_auto(task.id)["enabled"])

        res = self.auto(task, enabled=True, steps=10**8)
        self.assertEqual(res.status_code, 400)
        self.assertIn("steps must be between", res.data["error"])

        # Without a node, a setting is still saved: the options are checked when the training starts
        training.set_node("http://127.0.0.1:9")
        self.assertEqual(self.auto(task, enabled=True, steps=50).status_code, 200)
        self.assertEqual(training.get_auto(task.id)["options"]["steps"], 50)

    def test_a_task_set_to_train_says_whether_the_worker_hears_of_completed_tasks(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        self.assertTrue(self.status(task)["listening"])

        # What the worker said is remembered: a worker that did not listen is asked again a minute later
        training.store().set_json("listens", {"value": False, "at": time.time()})
        self.assertFalse(self.status(task)["listening"])
        training.store().set_json("listens", {"value": False, "at": time.time() - training.LISTENS_RECHECK - 1})
        self.assertTrue(self.status(task)["listening"])

    def test_the_tasks_list_has_the_tasks_of_the_projects_the_user_may_see_with_their_splats(self):
        task = make_task(self.user)
        running = Task.objects.create(
            project=task.project, status=status_codes.RUNNING, name="Still running", running_progress=0.4
        )
        add_file(running, "photo.JPG")
        Task.objects.create(project=task.project, partial=True)  # still receiving its photos: not listed
        hidden = make_task(User.objects.get(username="testuser2"))
        self.assertEqual(self.train(task, steps=10).status_code, 200)

        res = self.client.get(f"{API}/tasks")
        self.assertEqual(res.status_code, 200, res.data)
        projects = {p["id"]: p for p in res.data["projects"]}
        self.assertNotIn(hidden.project.id, projects)
        listed = {t["id"]: t for t in projects[task.project.id]["tasks"]}
        self.assertEqual(set(listed), {str(task.id), str(running.id)})
        self.assertEqual(listed[str(task.id)]["splats"]["state"], "completed")
        self.assertTrue(listed[str(task.id)]["splats"]["has_splats"])
        self.assertTrue(listed[str(task.id)]["splats"]["can_train"])
        self.assertEqual(listed[str(running.id)]["status"], status_codes.RUNNING)
        self.assertEqual(listed[str(running.id)]["name"], "Still running")
        # WebODM's processing, followed in the row
        self.assertEqual(listed[str(running.id)]["running_progress"], 0.4)
        self.assertIn("last_error", listed[str(running.id)])
        self.assertIsNone(listed[str(running.id)]["splats"]["state"])
        # As task/<id>/status says it, so a row and the task's panel agree
        self.assertEqual(listed[str(task.id)]["splats"], self.status(task))

        # One project, by its id
        only = self.client.get(f"{API}/tasks", {"project": task.project.id}).data["projects"]
        self.assertEqual([p["id"] for p in only], [task.project.id])
        self.assertEqual(self.client.get(f"{API}/tasks", {"project": "x"}).status_code, 400)

        # A user who may only look at the project sees its tasks and may not train them
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        seen = {p["id"]: p for p in other.get(f"{API}/tasks").data["projects"]}
        self.assertFalse(seen[task.project.id]["can_train"])
        self.assertFalse(seen[task.project.id]["tasks"][0]["splats"]["can_train"])
        self.assertEqual(APIClient().get(f"{API}/tasks").status_code, 403)

    def test_the_tasks_list_leaves_out_tasks_splatme_cannot_train_and_projects_with_none(self):
        trainable = make_task(self.user)
        project = trainable.project
        thermal = Task.objects.create(project=project, status=status_codes.RUNNING, name="Thermal")
        add_file(thermal, "a_T.tif")
        mixed = Task.objects.create(project=project, status=status_codes.QUEUED, name="Mixed")
        add_file(mixed, "a.jpg")
        add_file(mixed, "b.png")
        Task.objects.create(project=project, status=status_codes.QUEUED, name="No photos")
        # Completed with JPEG photos but unable to train, each the only task of its project
        no_cloud = make_task(self.user)
        assets = [a for a in no_cloud.available_assets if a != "georeferenced_model.laz"]
        Task.objects.filter(pk=no_cloud.pk).update(available_assets=assets)
        compacted = make_task(self.user)
        Task.objects.filter(pk=compacted.pk).update(compacted=True)
        failed = Task.objects.create(project=project, status=status_codes.FAILED, name="Failed, can run again")
        add_file(failed, "a.jpeg")
        # A project with only a task SplatMe cannot train, and an empty one: not listed, but one may add a task there
        thermal_only = Project.objects.create(owner=self.user, name="Thermal only")
        add_file(Task.objects.create(project=thermal_only, status=status_codes.COMPLETED), "a.tiff")
        empty = Project.objects.create(owner=self.user, name="Empty")

        data = self.client.get(f"{API}/tasks").data
        listed = {p["id"]: {t["name"] or t["id"] for t in p["tasks"]} for p in data["projects"]}
        self.assertEqual(listed[project.id], {str(trainable.id), "Failed, can run again"})
        self.assertNotIn(thermal_only.id, listed)
        self.assertNotIn(empty.id, listed)
        self.assertNotIn(no_cloud.project.id, listed)
        self.assertNotIn(compacted.project.id, listed)
        addable = {p["id"]: p for p in data["addable"]}
        self.assertEqual(addable[empty.id], {"id": empty.id, "name": "Empty", "has_tasks": False})
        self.assertTrue(addable[thermal_only.id]["has_tasks"])

        # A task with splats is listed whatever its photos (its model can be viewed)
        os.makedirs(os.path.dirname(thermal.get_asset_file_or_stream("splats.rad")), exist_ok=True)
        with open(thermal.get_asset_file_or_stream("splats.rad"), "wb") as f:
            f.write(b"rad")
        thermal.update_available_assets_field()
        thermal.save()
        names = {t["name"] for p in self.client.get(f"{API}/tasks").data["projects"] for t in p["tasks"]}
        self.assertIn("Thermal", names)

        # A user who may only look at a project sees its compatible tasks, and may not add a task to it
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), project)
        seen = other.get(f"{API}/tasks").data
        self.assertIn(project.id, [p["id"] for p in seen["projects"]])
        self.assertNotIn(project.id, [p["id"] for p in seen["addable"]])

    # The time left

    def test_the_time_left_is_told_once_there_are_enough_steps_from_the_rate_of_the_last_minutes(self):
        self.assertIsNone(training.time_left([], 7000))
        self.assertIsNone(training.time_left([(0, 0), (20, 100)], 7000))  # too soon
        self.assertIsNone(training.time_left([(0, 0), (60, 10)], 7000))  # too few steps
        # 10 steps a second throughout: 6,000 steps left take 600 s
        self.assertEqual(training.time_left([(0, 0), (60, 600), (100, 1000)], 7000), 600)
        # Slower lately (5 steps a second for the last 3 minutes): that rate, not the average from the start
        samples = [(0, 0), (100, 2000), (280, 2900)]
        self.assertEqual(training.time_left(samples, 7000), 4100 / 5)
        # A continued training's steps start at its model's
        self.assertEqual(training.time_left([(0, 7000), (100, 8000)], 14000), 600)

    def test_only_the_samples_the_estimate_needs_are_kept(self):
        samples = [(t, t * 10) for t in range(0, 400, 20)]
        kept = training.keep_window(samples)
        self.assertEqual(kept[0], (200, 2000))  # the latest one a window old
        self.assertEqual(kept[-1], samples[-1])
        self.assertEqual(training.time_left(kept, 7000), training.time_left(samples, 7000))

    def test_the_step_and_the_time_left_are_written_as_the_panel_writes_durations(self):
        remote = {"step": 4650, "options": {"steps": 7000}}
        self.assertEqual(training.step_status(remote, []), ("Step 4,650 of 7,000", None))
        self.assertEqual(training.step_status(remote, [(0, 4000), (100, 4650)])[0], "Step 4,650 of 7,000, about 6 min left")
        self.assertEqual(training.left_text(20), "less than a minute left")
        self.assertEqual(training.left_text(3600), "about 1 h left")
        self.assertEqual(training.left_text(4800), "about 1 h 20 min left")

    def test_deleting_a_task_removes_its_setting(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        task_id = task.id
        task.delete()
        self.assertFalse(training.get_auto(task_id)["enabled"])

    # Splat edits

    def edits_url(self, task):
        return f"{API}/task/{task.id}/edits"

    def put_edits(self, task, items, client=None):
        return (client or self.client).put(self.edits_url(task), {"edits": items}, format="json")

    def apply(self, task):
        return self.client.post(f"{API}/task/{task.id}/apply")

    def with_offset(self, task, x, y):
        """The offset WebODM's export takes off the model's x and y (odm_georeferencing/coords.txt)."""
        with open(task.assets_path("odm_georeferencing", "coords.txt"), "w") as f:
            f.write(f"WGS84 UTM 32N\n{x} {y}\n")

    def trained_task(self, points=((0, 0), (3, 0), (0.5, -0.5), (0, -1.5))):
        task = make_task(self.user)
        header, rows = self.node_model(points)
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertEqual(self.status(task)["state"], "completed")
        self.converted.clear()
        return task, header, rows

    def box(self, center, size, keep=True, turn=0):
        return {"type": "box", "keep": keep, "center": list(center), "size": list(size), "turn": turn}

    def polygon(self, ring, keep=False):
        return {"type": "polygon", "keep": keep, "ring": [list(p) for p in ring]}

    def test_edits_are_kept_in_the_tasks_projection_and_given_in_its_models_frame(self):
        task, _, _ = self.trained_task()
        self.with_offset(task, 1000, 2000)
        data = self.client.get(self.edits_url(task)).data
        self.assertEqual(data["edits"], [])
        self.assertIsNone(data["editable"])
        self.assertTrue(data["can_edit"])
        self.assertEqual(data["model"]["splats"], 4)
        self.assertEqual(data["model"]["url"], f"{API}/task/{task.id}/model")
        res = self.client.get(data["model"]["url"])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(b"".join(res.streaming_content)[:3], b"ply")
        for close in res._resource_closers:  # the file; res.close() would close the test's database connection too
            close()
        res = self.put_edits(task, [self.box((1, 2, 3), (4, 5, 6), turn=-90), self.polygon([(0, 0), (1, 0), (1, 1)])])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"][0]["center"], [1, 2, 3])
        self.assertEqual(res.data["edits"][0]["turn"], 270)
        stored = training.store().get_json(edits.edits_key(task.id))
        self.assertEqual(stored[0]["center"], [1001, 2002, 3])
        self.assertEqual(stored[1]["ring"], [[1000, 2000], [1001, 2000], [1001, 2001]])
        # Processed again with another offset: the shapes stay where they were on the ground
        self.with_offset(task, 1010, 2000)
        self.assertEqual(self.client.get(self.edits_url(task)).data["edits"][0]["center"], [-9, 2, 3])
        self.assertEqual(self.put_edits(task, []).data["edits"], [])
        self.assertIsNone(training.store().get_json(edits.edits_key(task.id), None))

    def test_edits_that_are_not_shapes_are_refused_and_the_saved_ones_stay(self):
        task, _, _ = self.trained_task()
        good = [self.box((0, 0, 0), (1, 1, 1))]
        self.assertEqual(self.put_edits(task, good).status_code, 200)
        wrong = [
            ("not a list", "must be a list"),
            ([self.box((0, 0, 0), (1, 0, 1))], "must be more than 0"),
            ([self.box((0, 0), (1, 1, 1))], "must be 3 numbers"),
            ([self.box((0, "a", 0), (1, 1, 1))], "must be a number"),
            ([self.box((0, 1e12, 0), (1, 1, 1))], "out of range"),
            ([{**self.box((0, 0, 0), (1, 1, 1)), "keep": "yes"}], "keeps or removes"),
            ([self.polygon([(0, 0), (1, 1)])], "from 3 to"),
            ([{"type": "sphere", "keep": True}], "unknown kind"),
            ([self.box((0, 0, 0), (1, 1, 1))] * (edits.MAX_EDITS + 1), "at most"),
        ]
        for items, reason in wrong:
            res = self.put_edits(task, items)
            self.assertEqual(res.status_code, 400, items)
            self.assertIn(reason, res.data["error"])
        self.assertEqual(self.client.get(self.edits_url(task)).data["edits"], good)

    def test_edits_in_the_store_that_do_not_read_are_left_as_they_are_and_skipped(self):
        task, header, rows = self.trained_task()
        newer = [{"type": "brush", "keep": False}]  # as a later version of SplatMe might write
        training.store().set_json(edits.edits_key(task.id), newer)
        data = self.client.get(self.edits_url(task)).data
        self.assertEqual(data["edits"], [])
        self.assertIn("could not be read", data["unreadable"])
        # Apply fails and keeps the shown model; the edits stay for the version that reads them
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        self.apply(task)
        status = self.status(task)
        self.assertEqual(status["apply"]["state"], "failed")
        self.assertIn("could not be read", status["apply"]["error"])
        self.assertEqual(self.model(task), b"shown before")
        self.assertEqual(training.store().get_json(edits.edits_key(task.id)), newer)
        # A training imports its model without them, and says why
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertIn("could not be read", status["edits_error"])
        self.assertEqual(self.converted, [header + rows.tobytes()])
        self.assertEqual(training.store().get_json(edits.edits_key(task.id)), newer)
        # Saving edits on the page replaces them
        self.assertEqual(self.put_edits(task, []).data["unreadable"], None)
        self.assertIsNone(training.store().get_json(edits.edits_key(task.id), None))

    def test_apply_edits_makes_the_shown_model_again_from_the_trained_model(self):
        task, header, rows = self.trained_task()
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        # Remove what is around (3, 0); keep what is below 6 m (all of it: the gaussians are 5 m up)
        self.put_edits(task, [self.polygon([(2, -1), (4, -1), (4, 1), (2, 1)]), self.box((0, 0, 0), (100, 100, 12))])
        res = self.apply(task)
        self.assertEqual(res.status_code, 200, res.data)
        status = self.status(task)
        self.assertEqual(status["apply"]["state"], "completed", status)
        self.assertEqual(status["apply"]["edited"], 1)
        self.assertIsNone(status["apply"]["cropped"])
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 3") + rows[[0, 2, 3]].tobytes()])
        self.assertEqual(self.model(task), MODEL)
        # The trained model is unchanged and can still be continued from
        with open(training.trained_model(task), "rb") as f:
            self.assertEqual(f.read(), header + rows.tobytes())
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"], 10)
        self.assertTrue(self.status(task)["editable"])
        # A box that keeps only what is inside, turned: (0.5, -0.5) is in a 1 x 0.2 box along that diagonal
        self.converted.clear()
        self.put_edits(task, [self.box((0.25, -0.25, 5), (1, 0.2, 1), turn=-45)])
        self.apply(task)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 2") + rows[[0, 2]].tobytes()])
        # Clear Edits, then Apply: the whole model again
        self.converted.clear()
        self.put_edits(task, [])
        self.apply(task)
        self.assertEqual(self.converted, [header + rows.tobytes()])
        self.assertIsNone(self.status(task)["apply"]["edited"])

    def lasso(self, ring, view=None, keep=False, camera=None):
        """A Lasso; the default view sees x and y as they are (an identity matrix: w is 1, in front)."""
        identity = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]
        edit = {"type": "lasso", "keep": keep, "ring": [list(p) for p in ring], "view": view or identity}
        if camera:
            edit["camera"] = camera
        return edit

    def test_a_lasso_removes_what_falls_inside_it_on_screen_in_front_of_the_camera(self):
        task, header, rows = self.trained_task()
        square = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        self.assertEqual(self.put_edits(task, [self.lasso(square)]).status_code, 200)
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["edited"], 2)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 2") + rows[[1, 3]].tobytes()])
        # Seen from behind (w = -z, the gaussians are 5 m up): nothing is in front of that camera
        self.converted.clear()
        behind = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, -1.0, 0, 0, 0, 0]
        self.put_edits(task, [self.lasso(square, view=behind)])
        self.apply(task)
        self.assertEqual(self.converted, [header + rows.tobytes()])
        # In perspective (w = z, so x / 5): (3, 0) projects to 0.6, inside a lasso from 0.5 to 0.7
        self.converted.clear()
        perspective = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0]
        self.put_edits(task, [self.lasso([(0.5, -0.1), (0.7, -0.1), (0.7, 0.1), (0.5, 0.1)], view=perspective)])
        self.apply(task)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 3") + rows[[0, 2, 3]].tobytes()])

    def test_a_lasso_is_kept_in_the_tasks_projection_and_cuts_the_same_after_the_offset_changes(self):
        task, header, rows = self.trained_task()
        self.with_offset(task, 1000, 2000)
        camera = {"position": [1, 2, 30], "target": [1, 2, 5]}
        given = self.lasso([(-1, -1), (1, -1), (1, 1), (-1, 1)], camera=camera)
        res = self.put_edits(task, [given])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"][0]["camera"], camera)
        for a, b in zip(res.data["edits"][0]["view"], given["view"], strict=True):
            self.assertAlmostEqual(a, b, places=9)
        stored = training.store().get_json(edits.edits_key(task.id))[0]
        self.assertEqual(stored["view"][12:14], [-1000, -2000])
        self.assertEqual(stored["camera"]["position"], [1001, 2002, 30])
        # Processed again with an offset 10 m less: the lasso stays on the ground, which is now at x 9 to 11 in the
        # model's frame, where no gaussian is. Removing inside removes nothing; keeping inside would keep none
        self.with_offset(task, 990, 2000)
        self.converted.clear()
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["state"], "completed")
        self.assertEqual(self.converted, [header + rows.tobytes()])
        self.put_edits(task, [{**self.client.get(self.edits_url(task)).data["edits"][0], "keep": True}])
        self.apply(task)
        self.assertIn("remove every splat", self.status(task)["apply"]["error"])

    def test_a_lasso_without_its_view_or_with_a_bad_camera_is_refused(self):
        task, _, _ = self.trained_task()
        square = [(-1, -1), (1, -1), (1, 1)]
        for edit, reason in [
            ({**self.lasso(square), "view": [1, 0, 0]}, "must be 16 numbers"),
            ({**self.lasso(square), "view": None}, "must be 16 numbers"),
            (self.lasso(square, camera="here"), "position and a target"),
            (self.lasso(square, camera={"position": [0, 0, 1]}), "camera target"),
        ]:
            res = self.put_edits(task, [edit])
            self.assertEqual(res.status_code, 400, edit)
            self.assertIn(reason, res.data["error"])

    IDENTITY = (1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0)

    def line(self):
        """A stroke from (-0.2, 0) to (0.2, 0) on the screen, 0.6 wide either side."""
        return {"size": 0.6, "points": [[-0.2, 0], [0.2, 0]]}

    def brush(self, strokes, aspect=1, view=None, camera=None):
        """A Brush; the default view sees x and y as they are (an identity matrix: w is 1, in front)."""
        edit = {"type": "brush", "strokes": strokes, "aspect": aspect, "view": view or list(self.IDENTITY)}
        if camera:
            edit["camera"] = camera
        return edit

    def test_a_brush_removes_what_falls_within_its_size_of_a_stroke_on_screen_in_front_of_the_camera(self):
        task, header, rows = self.trained_task()
        res = self.put_edits(task, [self.brush([self.line()])])
        self.assertEqual(res.status_code, 200, res.data)
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["edited"], 2)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 2") + rows[[1, 3]].tobytes()])
        # A wider screen stretches x: (0.5, -0.5) is then 0.78 from the stroke, beyond its 0.6
        self.converted.clear()
        self.put_edits(task, [self.brush([self.line()], aspect=2)])
        self.apply(task)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 3") + rows[[1, 2, 3]].tobytes()])
        # A stroke of one point is a circle; two strokes in one edit both remove
        self.converted.clear()
        self.put_edits(task, [self.brush([{"size": 0.1, "points": [[3, 0]]}, {"size": 0.1, "points": [[0, -1.5]]}])])
        self.apply(task)
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 2") + rows[[0, 2]].tobytes()])
        # Seen from behind (w = -z): nothing is in front of that camera
        self.converted.clear()
        behind = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, -1.0, 0, 0, 0, 0]
        self.put_edits(task, [self.brush([self.line()], view=behind)])
        self.apply(task)
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_a_brush_is_kept_in_the_tasks_projection_and_cuts_the_same_after_the_offset_changes(self):
        task, header, rows = self.trained_task()
        self.with_offset(task, 1000, 2000)
        camera = {"position": [1, 2, 30], "target": [1, 2, 5]}
        res = self.put_edits(task, [self.brush([self.line()], camera=camera)])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"][0]["camera"], camera)
        self.assertEqual(res.data["edits"][0]["strokes"], [self.line()])
        stored = training.store().get_json(edits.edits_key(task.id))[0]
        self.assertEqual(stored["view"][12:14], [-1000, -2000])
        self.assertEqual(stored["camera"]["position"], [1001, 2002, 30])
        # Processed again with an offset 10 m less: the stroke stays on the ground, now at x 9.8 to 10.2 in the
        # model's frame, where no gaussian is
        self.with_offset(task, 990, 2000)
        self.converted.clear()
        self.apply(task)
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_a_restore_brush_puts_back_what_the_edits_before_it_removed_and_nothing_after(self):
        task, header, rows = self.trained_task()
        restore = {**self.brush([self.line()]), "restore": True}  # over rows 0 and 2
        around_origin = self.box((0, -0.5, 0), (2, 3, 10), keep=False)  # removes rows 0, 2 and 3
        only_row_1 = self.box((3, 0, 0), (1, 1, 10), keep=True)

        def kept(shapes, floaters=None):
            self.converted.clear()
            res = self.put_edits(task, shapes)
            self.assertEqual(res.status_code, 200, res.data)
            with mock.patch.object(edits, "floaters", return_value=floaters):
                self.apply(task)
            self.assertEqual(self.status(task)["apply"]["state"], "completed", self.status(task)["apply"])
            return self.converted[0]

        def model(numbers):
            return header.replace(b"vertex 4", b"vertex %d" % len(numbers)) + rows[numbers].tobytes()

        self.assertEqual(kept([around_origin, restore]), model([0, 1, 2]))
        self.assertEqual(kept([restore, around_origin]), model([1]))
        # What a Keep Inside box left out comes back under the strokes too
        self.assertEqual(kept([only_row_1, restore]), model([0, 1, 2]))
        # And the floaters (rows 0 and 3 here), when Remove Floaters is listed before it
        floaters = np.array([True, False, False, True])
        self.assertEqual(kept([self.floaters("light"), restore], floaters), model([0, 1, 2]))
        self.assertEqual(kept([restore, self.floaters("light")], floaters), model([1, 2]))
        # Kept as a restore; a plain brush says nothing of it
        data = self.client.get(self.edits_url(task)).data["edits"]
        self.assertTrue(data[0]["restore"])
        self.put_edits(task, [self.brush([self.line()], camera=None)])
        self.assertNotIn("restore", self.client.get(self.edits_url(task)).data["edits"][0])

    def test_a_brush_with_bad_strokes_size_or_view_is_refused(self):
        task, _, _ = self.trained_task()
        for edit, reason in [
            ({**self.brush([self.line()]), "restore": "yes"}, "removes or restores"),
            ({**self.brush([self.line()]), "strokes": []}, "from 1 to 500 strokes"),
            ({**self.brush([self.line()]), "strokes": [self.line()] * 501}, "from 1 to 500 strokes"),
            (self.brush([{"size": 0.1, "points": []}]), "must each have points"),
            (self.brush(["here"]), "must each have points"),
            (self.brush([{"size": 0, "points": [[0, 0]]}]), "brush size must be more than 0"),
            (self.brush([{"size": 5, "points": [[0, 0]]}]), "brush size is out of range"),
            (self.brush([{"size": 0.1, "points": [[0, 0, 0]]}]), "points must be 2 numbers"),
            (self.brush([{"size": 0.1, "points": [[0, 0]] * 20001}]), "at most 20000 points"),
            (self.brush([self.line()], aspect=0), "aspect must be more than 0"),
            ({**self.brush([self.line()]), "view": [1, 0]}, "must be 16 numbers"),
            (self.brush([self.line()], camera="here"), "position and a target"),
        ]:
            res = self.put_edits(task, [edit])
            self.assertEqual(res.status_code, 400, edit)
            self.assertIn(reason, res.data["error"])

    def coloured_task(self):
        """A trained task whose .ply has colours: f_dc for each of red, green and blue, and f_rest of degree 1 (three
        for each, red's first). Answers the task and the rows as a record array."""
        names = ["x", "y", "z", "opacity", "f_dc_0", "f_dc_1", "f_dc_2"] + [f"f_rest_{i}" for i in range(9)]
        header = (
            "ply\nformat binary_little_endian 1.0\ncomment Generated by opensplat at iteration 10\nelement vertex 4\n"
            + "".join(f"property float {name}\n" for name in names)
            + "end_header\n"
        ).encode()
        rows = np.zeros(4, dtype=[(name, "<f4") for name in names])
        rows["x"], rows["y"] = [0, 3, 0.5, 0], [0, 0, -0.5, -1.5]
        rows["f_dc_0"], rows["f_dc_1"], rows["f_dc_2"] = [0.4, -0.2, 1.0, 0], [0.1, 0.3, -1.0, 0], [-0.5, 0.6, 0.2, 0]
        for i in range(9):
            rows[f"f_rest_{i}"] = [0.01 * (i + 1), -0.02 * (i + 1), 0.03, 0]
        patcher = mock.patch("coreplugins.splatme.tests.fake_node.trained", return_value=header + rows.tobytes())
        patcher.start()
        self.addCleanup(patcher.stop)
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertEqual(self.status(task)["state"], "completed")
        self.converted.clear()
        return task, header, rows

    def colour(self, **given):
        return {"type": "colour", **{name: given.get(name, 0) for name in edits.COLOURS}}

    def converted_rows(self, rows):
        """The rows of the one model given to WebODM's converter since the last clear, with the given rows' fields."""
        self.assertEqual(len(self.converted), 1)
        data = self.converted[0]
        start = data.index(b"end_header\n") + len(b"end_header\n")
        return np.frombuffer(data[start:], dtype=rows.dtype)

    def test_colour_adjust_changes_the_colours_and_the_light_that_changes_with_the_view(self):
        task, header, rows = self.coloured_task()
        c0 = edits.SH_C0
        colour = np.stack([0.5 + c0 * rows[f"f_dc_{c}"].astype(np.float64) for c in range(3)])
        rest = [np.stack([rows[f"f_rest_{j + 3 * c}"].astype(np.float64) for c in range(3)]) for j in range(3)]

        def check(edit, expect_colour, expect_rest, keep=(0, 1, 2, 3)):
            self.converted.clear()
            res = self.put_edits(task, edit)
            self.assertEqual(res.status_code, 200, res.data)
            self.apply(task)
            self.assertEqual(self.status(task)["apply"]["state"], "completed")
            out = self.converted_rows(rows)
            self.assertEqual(len(out), len(keep))
            np.testing.assert_allclose(out[["x", "y", "z", "opacity"]].tolist(), rows[list(keep)][["x", "y", "z", "opacity"]].tolist())
            got = np.stack([0.5 + c0 * out[f"f_dc_{c}"].astype(np.float64) for c in range(3)])
            np.testing.assert_allclose(got, expect_colour[:, list(keep)], atol=1e-5)
            for j in range(3):
                got = np.stack([out[f"f_rest_{j + 3 * c}"].astype(np.float64) for c in range(3)])
                np.testing.assert_allclose(got, expect_rest[j][:, list(keep)], atol=1e-6)

        # Brightness +1: half as bright again, the view's light too; every splat kept, still written
        check([self.colour(brightness=1)], 1.5 * colour, [1.5 * r for r in rest])
        self.assertIsNone(self.status(task)["apply"]["edited"])
        # Saturation -1: each colour its grey, red, green and blue counted as in edits.LUMA
        luma = np.array([0.2126, 0.7152, 0.0722])
        check([self.colour(saturation=-1)], np.tile(luma @ colour, (3, 1)), [np.tile(luma @ r, (3, 1)) for r in rest])
        # Warmth +1: a fifth more red, a fifth less blue
        warm = np.array([[1.2], [1], [0.8]])
        check([self.colour(warmth=1)], warm * colour, [warm * r for r in rest])
        # Contrast +1: twice as far from the middle grey; the view's light twice as strong
        check([self.colour(contrast=1)], 2 * (colour - 0.5) + 0.5, [2 * r for r in rest])
        # With a brush: what it leaves, adjusted
        check([self.brush([self.line()]), self.colour(contrast=-1)], 0.5 * (colour - 0.5) + 0.5, [0.5 * r for r in rest], keep=(1, 3))
        self.assertEqual(self.status(task)["apply"]["edited"], 2)
        # No change: the trained model as it is
        self.converted.clear()
        self.put_edits(task, [self.colour()])
        self.apply(task)
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_colour_adjust_on_a_model_without_colours_changes_nothing(self):
        task, header, rows = self.trained_task()
        self.put_edits(task, [self.colour(brightness=0.5)])
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["state"], "completed")
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_a_second_colour_adjust_or_one_out_of_range_is_refused(self):
        task, _, _ = self.trained_task()
        res = self.put_edits(task, [self.colour(warmth=0.123)])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"], [self.colour(warmth=0.12)])
        for given, reason in [
            ([self.colour(), self.colour()], "adjusted only once"),
            ([self.colour(brightness=1.5)], "brightness must be from -1 to 1"),
            ([self.colour(contrast=-2)], "contrast must be from -1 to 1"),
            ([self.colour(saturation="more")], "saturation must be a number"),
            ([self.colour(warmth=True)], "warmth must be a number"),
        ]:
            res = self.put_edits(task, given)
            self.assertEqual(res.status_code, 400, given)
            self.assertIn(reason, res.data["error"])

    # A 10 x 10 grid a metre apart, and one gaussian 100 m away: a floater at any strength
    GRID = tuple((x, y) for x in range(10) for y in range(10)) + ((100, 100),)

    def floaters(self, strength="medium"):
        return {"type": "floaters", "strength": strength}

    def test_floaters_far_from_their_neighbours_or_oversized_are_found_on_the_whole_model(self):
        names = ("x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2")
        rows = np.array([(x, y, 5.0, 0.0, np.log(0.1), np.log(0.1), np.log(0.1)) for x, y in self.GRID], dtype="<f4")
        rows[55, 5] = np.log(5)  # 5 m long, on a scene of about 8 m
        header = (
            f"ply\nformat binary_little_endian 1.0\nelement vertex {len(rows)}\n"
            + "".join(f"property float {name}\n" for name in names)
            + "end_header\n"
        ).encode()
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        path = os.path.join(folder, "floaters.ply")
        with open(path, "wb") as f:
            f.write(header + rows.tobytes())
        found = {strength: set(edits.floaters(path, strength).nonzero()[0]) for strength in edits.STRENGTHS}
        self.assertEqual(found["light"], {55, 100})
        self.assertEqual(found["medium"], {55, 100})
        self.assertTrue(found["medium"] <= found["strong"])
        # A model too small to have neighbours has no floaters
        with open(path, "wb") as f:
            f.write(header.replace(b"vertex 101", b"vertex 3") + rows[:3].tobytes())
        self.assertFalse(edits.floaters(path, "strong").any())

    def test_removing_floaters_is_an_edit_with_a_strength_that_the_page_can_preview(self):
        task, header, rows = self.trained_task(self.GRID)
        res = self.client.get(f"{API}/task/{task.id}/floaters", {"strength": "light"})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data, {"strength": "light", "removed": [100]})
        res = self.put_edits(task, [self.floaters("light"), self.polygon([(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)])])
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["edits"][0], {"type": "floaters", "strength": "light"})
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["edited"], 2)
        self.assertEqual(self.converted, [header.replace(b"vertex 101", b"vertex 99") + rows[1:100].tobytes()])
        # A retraining removes them again
        self.converted.clear()
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertEqual(self.status(task)["edited"], 2)
        self.assertEqual(self.converted, [header.replace(b"vertex 101", b"vertex 99") + rows[1:100].tobytes()])

    def test_floaters_with_no_strength_or_twice_are_refused(self):
        task, _, _ = self.trained_task(self.GRID)
        for given, reason in [
            ([{"type": "floaters"}], "Light, Medium or Strong"),
            ([self.floaters("huge")], "Light, Medium or Strong"),
            ([self.floaters(), self.floaters("strong")], "only once"),
        ]:
            res = self.put_edits(task, given)
            self.assertEqual(res.status_code, 400, given)
            self.assertIn(reason, res.data["error"])
        res = self.client.get(f"{API}/task/{task.id}/floaters", {"strength": "huge"})
        self.assertEqual(res.status_code, 400)
        self.client.logout()
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/floaters", {"strength": "light"}).status_code, 404)

    def download(self, task, client=None):
        """The response to a download of the task's edited model, its content read and the file closed."""
        res = (client or self.client).get(f"{API}/task/{task.id}/download")
        res.body = b"".join(res.streaming_content) if res.streaming else res.content
        for close in res._resource_closers:  # the file; res.close() would close the test's database connection too
            close()
        return res

    def downloads(self):
        """What the downloads' folder holds besides the locks, as task/name."""
        path = training.get_plugins_persistent_path(training.NAME, training.DOWNLOADS)
        if not os.path.isdir(path):
            return []
        return sorted(
            f"{task}/{name}" for task in os.listdir(path) for name in os.listdir(os.path.join(path, task))
            if name != training.LOCK
        )  # fmt: skip

    def test_download_gives_the_model_with_the_saved_edits_and_changes_nothing(self):
        task, header, rows = self.coloured_task()
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        # No edits: the trained model as it is
        res = self.download(task)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.body, header + rows.tobytes())
        self.assertIn('attachment; filename="', res["Content-Disposition"])
        self.assertIn('-splats.ply"', res["Content-Disposition"])
        # Saved, not applied: cut and recoloured as Apply would, the task's model and the trained one unchanged
        self.put_edits(task, [self.brush([self.line()]), self.colour(contrast=-1)])
        res = self.download(task)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.body.startswith(header.replace(b"vertex 4", b"vertex 2")))
        out = np.frombuffer(res.body[len(header):], dtype=rows.dtype)
        np.testing.assert_allclose(out["x"], rows["x"][[1, 3]])
        expect = 0.5 * (0.5 + edits.SH_C0 * rows["f_dc_0"][[1, 3]].astype(np.float64) - 0.5) + 0.5
        np.testing.assert_allclose(0.5 + edits.SH_C0 * out["f_dc_0"].astype(np.float64), expect, atol=1e-5)
        np.testing.assert_allclose(out["f_rest_0"], 0.5 * rows["f_rest_0"][[1, 3]], atol=1e-6)
        self.assertEqual(self.converted, [])
        self.assertEqual(self.model(task), b"shown before")
        with open(training.trained_model(task), "rb") as f:
            self.assertEqual(f.read(), header + rows.tobytes())
        self.assertIsNone(training.get_apply(task.id))
        # The file made is kept for the next download
        parent = training.get_plugins_persistent_path(training.NAME, training.DOWNLOADS)
        self.addCleanup(shutil.rmtree, parent, ignore_errors=True)
        (made,) = self.downloads()
        self.assertTrue(made.startswith(f"{task.id}/") and made.endswith(".ply"))
        # A work folder a stopped server left, and a download not asked for in a day, go at the next download; a
        # work folder in use stays
        folder = training.download_dir(task.id)
        for name in ("old", "new"):
            os.makedirs(os.path.join(folder, name))
        with open(os.path.join(folder, "unused.ply"), "wb") as f:
            f.write(b"ply")
        old = time.time() - training.DOWNLOAD_LEFTOVER - 10
        os.utime(os.path.join(folder, "old"), (old, old))
        old = time.time() - training.DOWNLOAD_KEEP - 10
        os.utime(os.path.join(folder, "unused.ply"), (old, old))
        self.assertEqual(self.download(task).status_code, 200)
        self.assertEqual(self.downloads(), sorted([made, f"{task.id}/new"]))

    def test_a_download_that_cannot_be_made_says_why_and_leaves_nothing(self):
        task, _, _ = self.trained_task(self.GRID)
        for setup, reason in [
            (lambda: self.put_edits(task, [self.box((100, 100, 0), (1, 1, 1))]), "remove every splat"),
            (lambda: training.store().set_json(edits.edits_key(task.id), [{"type": "brush"}]), "could not be read"),
        ]:
            setup()
            res = self.download(task)
            self.assertEqual(res.status_code, 400, reason)
            self.assertTrue(res["Content-Type"].startswith("text/plain"))
            self.assertIn(reason, res.body.decode())
        self.put_edits(task, [self.floaters()])
        with mock.patch.object(edits, "floaters", side_effect=MemoryError()):
            res = self.download(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("floaters could not be found: MemoryError", res.body.decode())
        with mock.patch.object(training.crop, "crop_ply", side_effect=OSError(28, "No space left on device", "/webodm/x")):
            self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
            res = self.download(task)
        self.assertEqual(res.status_code, 400)
        # The server's paths stay in its log
        self.assertIn("could not write or read it", res.body.decode())
        self.assertNotIn("/webodm", res.body.decode())
        self.assertEqual(self.downloads(), [])
        self.assertEqual(self.converted, [])
        # A task whose model SplatMe did not train
        res = self.download(make_task(self.user))
        self.assertEqual(res.status_code, 400)
        self.assertIn("no splat model", res.body.decode())

    def test_those_who_may_see_the_task_may_download_its_edited_model(self):
        task, header, rows = self.trained_task()
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(self.download(task, client=other).status_code, 404)
        self.assertEqual(self.download(task, client=APIClient()).status_code, 404)
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        res = self.download(task, client=other)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.body, header + rows.tobytes())

    # Found by the release review of 0.3.0

    def test_the_trained_model_is_kept_out_of_the_tasks_assets_and_only_editors_load_it(self):
        task, _, _ = self.trained_task()
        path = training.trained_model(task)
        self.assertEqual(path, task.data_path("splatme", "splatme-model.ply"))
        self.assertTrue(os.path.isfile(path))
        self.assertTrue(os.path.isfile(task.data_path("splatme", "splatme-model.json")))
        self.assertFalse(os.path.exists(task.assets_path("splats", "splatme-model.ply")))
        # A public task: its viewers see the edits, not the uncut model
        Task.objects.filter(pk=task.pk).update(public=True)
        res = self.put_edits(task, [self.floaters()])
        self.assertEqual(res.status_code, 200, res.data)
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        for client in (APIClient(), other):
            data = client.get(self.edits_url(task)).data
            self.assertFalse(data["can_edit"])
            self.assertIsNone(data["model"])
            self.assertEqual(data["edits"], [self.floaters()])
            self.assertEqual(client.get(f"{API}/task/{task.id}/model").status_code, 404)
            self.assertEqual(client.get(f"{API}/task/{task.id}/floaters?strength=light").status_code, 404)
            assets = f"/api/projects/{task.project.id}/tasks/{task.id}/assets/splats/splatme-model.ply"
            self.assertEqual(client.get(assets).status_code, 404)
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/floaters?strength=light").status_code, 200)

    def test_a_model_trained_by_0_2_is_moved_out_of_the_assets_keeping_its_time(self):
        task, header, rows = self.trained_task()
        model, options = training.trained_model(task), training.trained_options_file(task)
        when = os.path.getmtime(model)
        old = task.assets_path("splats")
        shutil.move(model, os.path.join(old, training.TRAINED_MODEL))
        shutil.move(options, os.path.join(old, training.TRAINED_OPTIONS))
        os.rmdir(training.trained_dir(task))
        data = self.client.get(self.edits_url(task)).data
        self.assertIsNone(data["editable"])
        self.assertEqual(data["model"]["splats"], 4)
        self.assertFalse(os.path.exists(os.path.join(old, training.TRAINED_MODEL)))
        self.assertFalse(os.path.exists(os.path.join(old, training.TRAINED_OPTIONS)))
        self.assertEqual(os.path.getmtime(model), when)
        with open(model, "rb") as f:
            self.assertEqual(f.read(), header + rows.tobytes())
        self.assertTrue(os.path.isfile(options))
        self.assertEqual(self.client.get(f"{API}/task/{task.id}/check").data["trained_steps"], 10)

    def test_processing_the_task_again_deletes_its_trained_model(self):
        task, _, _ = self.trained_task()
        # A task that completes with its splats (imported with them) keeps it
        training.completed(task.id)
        self.assertTrue(os.path.isfile(training.trained_model(task)))
        # Processed again: WebODM deleted its assets, the splats with them
        shutil.rmtree(task.assets_path("splats"))
        task.refresh_from_db()
        task.update_available_assets_field()
        task.save()
        training.completed(task.id)
        self.assertFalse(os.path.exists(training.trained_dir(task)))

    def test_a_download_is_made_once_until_the_edits_or_the_model_change_and_one_at_a_time(self):
        task, _, _ = self.trained_task()
        parent = training.get_plugins_persistent_path(training.NAME, training.DOWNLOADS)
        self.addCleanup(shutil.rmtree, parent, ignore_errors=True)
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        with mock.patch.object(training.crop, "crop_ply", wraps=training.crop.crop_ply) as cut:
            first = self.download(task).body
            self.assertEqual(self.download(task).body, first)
            self.assertEqual(cut.call_count, 1)
            (made,) = self.downloads()
            # Other edits: made again, and the file of the old ones goes
            self.put_edits(task, [self.box((0, 0, 5), (1, 1, 1), keep=False)])
            self.assertNotEqual(self.download(task).body, first)
            self.assertEqual(cut.call_count, 2)
            (again,) = self.downloads()
            self.assertNotEqual(again, made)
            # A trained model trained again (its time changed): made again
            later = time.time() + 5
            os.utime(training.trained_model(task), (later, later))
            self.download(task)
            self.assertEqual(cut.call_count, 3)
        # While another request makes it, a download waits for it, up to a deadline
        with open(os.path.join(training.download_dir(task.id), training.LOCK), "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with mock.patch.object(training, "DOWNLOAD_WAIT", 0):
                res = self.download(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("being made for another download", res.body.decode())
        self.assertEqual(self.download(task).status_code, 200)
        # A deleted task's go with it
        training.removed(task.id)
        self.assertFalse(os.path.exists(training.download_dir(task.id)))

    def test_an_apply_that_waits_in_the_workers_queue_is_queued_again_not_failed(self):
        task, _, _ = self.trained_task()
        long_ago = time.time() - training.STALE - 1
        started = []
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append(a)):
            self.apply(task)
            self.assertEqual(len(started), 1)
            training.change_record(training.apply_key(task.id), lambda r: r.update(updated=long_ago))
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.status(task)["apply"]["state"], "applying")
            self.assertEqual(len(started), 2)
            # The first job, started late, finds its run gone and does nothing
            training.apply(*started[0][1:])
            self.assertEqual(training.get_apply(task.id)["state"], "applying")
        training.apply(*started[1][1:])
        self.assertEqual(training.get_apply(task.id)["state"], "completed")
        # A job that never starts is queued again up to APPLY_REQUEUES times, then fails saying so
        with mock.patch.object(training, "run_function_async"), mock.patch.object(training, "APPLY_REQUEUES", 1):
            self.apply(task)
            for _ in range(2):
                training.change_record(training.apply_key(task.id), lambda r: r.update(updated=long_ago))
                with self.captureOnCommitCallbacks(execute=True):
                    record = training.get_apply(task.id)
        self.assertEqual(record["state"], "failed")
        self.assertIn("did not start", record["error"])
        # One that started, then lost its worker, fails at once
        with mock.patch.object(training, "run_function_async"):
            self.apply(task)
        training.change_record(training.apply_key(task.id), lambda r: r.update(waiting=None, updated=long_ago))
        record = training.get_apply(task.id)
        self.assertEqual(record["state"], "failed")
        self.assertIn("worker stopped", record["error"])

    def test_an_apply_removes_the_folders_of_earlier_runs_whose_worker_was_killed(self):
        task, _, _ = self.trained_task()
        left = training.apply_dir(task.id, "killed")
        os.makedirs(left)
        with open(os.path.join(left, "shown.ply"), "wb") as f:
            f.write(b"ply")
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["state"], "completed")
        self.assertFalse(os.path.exists(training.apply_dir(task.id)))

    def test_the_page_is_told_whether_the_model_was_made_with_the_saved_edits(self):
        task, _, _ = self.trained_task()

        def applied():
            return self.client.get(self.edits_url(task)).data["applied"]

        self.assertTrue(applied())  # trained with none
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        self.assertFalse(applied())
        self.apply(task)
        self.assertTrue(applied())
        self.put_edits(task, [])
        self.assertFalse(applied())
        self.apply(task)
        self.assertTrue(applied())
        # Not known for a model made before SplatMe 0.3
        training.store().del_key(training.shown_key(task.id))
        self.assertIsNone(applied())
        # A training that goes on without edits that do not read was not made with them
        training.store().set_json(edits.edits_key(task.id), [{"type": "brush"}])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertFalse(applied())

    def cancel_apply(self, task, client=None):
        return (client or self.client).post(f"{API}/task/{task.id}/apply", {"cancel": True}, format="json")

    def test_cancel_stops_an_apply_and_keeps_the_tasks_model(self):
        task, _, _ = self.trained_task()
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        # Canceled while it waits in the worker's queue: its job, when it starts, does nothing
        started = []
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append(a)):
            self.apply(task)
        res = self.cancel_apply(task)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["apply"]["state"], "canceled")
        training.apply(*started[0][1:])
        self.assertEqual(self.converted, [])
        self.assertEqual(training.get_apply(task.id)["state"], "canceled")
        self.assertFalse(os.path.exists(training.apply_dir(task.id)))
        # Canceled while it cuts the model, a row a chunk here: no other chunk is cut, nothing is converted
        cut, chunks = edits.keep_mask, []

        def cancel_on_the_way(*args):
            chunks.append(1)
            training.cancel_apply(task.id)
            return cut(*args)

        with mock.patch.object(training.crop, "ROWS", 1), mock.patch.object(edits, "keep_mask", side_effect=cancel_on_the_way):
            self.apply(task)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(self.converted, [])
        self.assertEqual(training.get_apply(task.id)["state"], "canceled")
        # Canceled while it converts (or its record lost then): the model is not replaced
        with mock.patch.object(training, "convert", side_effect=lambda *a: (training.cancel_apply(task.id), self.convert(*a))):
            self.apply(task)
        self.assertEqual(len(self.converted), 1)
        self.assertEqual(training.get_apply(task.id)["state"], "canceled")
        self.assertEqual(self.model(task), b"shown before")
        self.assertFalse(os.path.exists(training.apply_dir(task.id)))
        # Nothing to cancel: the last Apply stays as it was; and only those who may edit may cancel
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["state"], "completed")
        self.assertEqual(self.cancel_apply(task).data["apply"]["state"], "completed")
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertEqual(self.cancel_apply(task, client=other).status_code, 404)

    def test_crafted_edits_are_refused_with_the_reason(self):
        task, _, _ = self.trained_task()
        for items, reason in [
            ([{"type": "floaters", "strength": []}], "Light, Medium or Strong"),
            ([self.box((10**400, 0, 0), (1, 1, 1))], "out of range"),
        ]:
            res = self.put_edits(task, items)
            self.assertEqual(res.status_code, 400, items)
            self.assertIn(reason, res.data["error"])
        res = self.client.put(self.edits_url(task), [1, 2], format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("must be a list", res.data["error"])
        # A trained model whose header does not read: the page is told, not an error
        with open(training.trained_model(task), "r+b") as f:
            f.write(b"junk")
        data = self.client.get(self.edits_url(task)).data
        self.assertIn("could not be read", data["editable"])
        self.assertIsNone(data["model"])

    def test_floaters_that_cannot_be_found_fail_apply_and_a_training_goes_on_without_the_edits(self):
        task, header, rows = self.trained_task(self.GRID)
        self.put_edits(task, [self.floaters()])
        with mock.patch.object(edits, "floaters", side_effect=MemoryError()):
            self.apply(task)
            apply = self.status(task)["apply"]
            self.assertEqual(apply["state"], "failed")
            self.assertIn("floaters could not be found: MemoryError", apply["error"])
            self.assertEqual(self.converted, [])
            res = self.client.get(f"{API}/task/{task.id}/floaters", {"strength": "light"})
            self.assertEqual(res.status_code, 400)
            self.assertIn("could not be found", res.data["error"])
            self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertIn("floaters could not be found", status["edits_error"])
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_apply_edits_crops_to_the_boundary_first_when_the_model_was_trained_so(self):
        task = make_task(self.user)
        self.with_boundary(task)
        header, rows = self.node_model([(0, 0), (3, 0), (0.5, -0.5), (0, -1.5)])
        self.train(task, steps=10, image_size=16, crop="false")
        # The page hides what the shown model leaves out: nothing, for a model trained without the crop
        self.assertEqual(self.client.get(self.edits_url(task)).data["boundary"], [])
        self.train(task, steps=10, image_size=16)
        boundary = self.client.get(self.edits_url(task)).data["boundary"]
        self.assertEqual(len(boundary), 1)
        self.assertEqual(len(boundary[0][0]), 5)
        self.converted.clear()
        self.put_edits(task, [self.box((0, 0, 5), (0.2, 0.2, 1), keep=False)])
        self.apply(task)
        status = self.status(task)["apply"]
        self.assertEqual((status["cropped"], status["edited"]), (2, 1))
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 1") + rows[[2]].tobytes()])

    def test_a_retraining_applies_the_edits_again(self):
        task, header, rows = self.trained_task()
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        self.assertEqual(self.train(task, resume="true", steps=10).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed", status)
        self.assertEqual(status["edited"], 1)
        self.assertIsNone(status["edits_error"])
        self.assertEqual(self.converted, [header.replace(b"vertex 4", b"vertex 3") + rows[[0, 2, 3]].tobytes()])

    def test_a_training_clears_the_last_apply_which_no_longer_says_what_the_model_is(self):
        task, _, _ = self.trained_task()
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        self.apply(task)
        self.assertEqual(self.status(task)["apply"]["state"], "completed")
        with mock.patch.object(training, "run_function_async"):
            self.apply(task)
        self.assertEqual(self.cancel_apply(task).data["apply"]["state"], "canceled")
        # The model a training makes is not the one that Apply left: Edit Splats no longer shows it
        self.assertEqual(self.train(task, resume="true", steps=10).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed", status)
        self.assertIsNone(status["apply"])
        self.assertIsNone(self.client.get(self.edits_url(task)).data["apply"])

    def test_edits_that_remove_every_splat_are_not_applied(self):
        task, header, rows = self.trained_task()
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        self.put_edits(task, [self.box((100, 100, 0), (1, 1, 1))])
        self.assertEqual(self.apply(task).status_code, 200)
        status = self.status(task)["apply"]
        self.assertEqual(status["state"], "failed")
        self.assertIn("remove every splat", status["error"])
        self.assertEqual(self.converted, [])
        self.assertEqual(self.model(task), b"shown before")
        # A training imports its model without them, and says so
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "completed")
        self.assertIn("remove every splat", status["edits_error"])
        self.assertEqual(self.converted, [header + rows.tobytes()])

    def test_splat_tools_failing_during_apply_keeps_the_shown_model(self):
        task, _, _ = self.trained_task()
        self.put_model(task, b"shown before")
        os.utime(training.trained_model(task))
        self.put_edits(task, [self.box((3, 0, 5), (1, 1, 1), keep=False)])
        for error in ("splat-tools failed", "splat-tools took longer than 60 minutes"):
            with mock.patch.object(training, "convert", side_effect=training.TrainingError(error)):
                self.assertEqual(self.apply(task).status_code, 200)
            status = self.status(task)["apply"]
            self.assertEqual(status["state"], "failed")
            self.assertEqual(status["error"], error)
            self.assertEqual(self.model(task), b"shown before")
        self.assertFalse(os.path.exists(training.apply_dir(task.id)))

    def test_apply_and_a_training_refuse_to_run_at_the_same_time(self):
        task, _, _ = self.trained_task()
        self.lost_job(task, None)
        training.change_job(task.id, lambda j: j.update(updated=time.time()))
        res = self.apply(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("being trained", res.data["error"])
        training.forget(task.id)
        now = time.time()
        training.store().set_json(training.apply_key(task.id), {"state": "applying", "run": "other", "updated": now})
        res = self.train(task, steps=10, image_size=16)
        self.assertEqual(res.status_code, 400)
        self.assertIn("edits are being applied", res.data["error"])
        res = self.apply(task)
        self.assertEqual(res.status_code, 400)
        self.assertIn("already being applied", res.data["error"])
        # One that lost its worker fails, and frees the task
        training.store().set_json(
            training.apply_key(task.id), {"state": "applying", "run": "other", "updated": now - training.STALE - 10}
        )
        status = self.status(task)["apply"]
        self.assertEqual(status["state"], "failed")
        self.assertIn("worker stopped", status["error"])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)

    def test_a_model_not_made_from_the_trained_model_cannot_be_edited(self):
        task = make_task(self.user)
        self.assertIn("no splat model", self.client.get(self.edits_url(task)).data["editable"])
        self.assertFalse(self.status(task)["editable"])
        self.train(task, steps=10, image_size=16)
        self.assertTrue(self.status(task)["editable"])
        self.put_model(task, b"a model uploaded in WebODM's Splats dialog")
        later = time.time() + 60
        os.utime(task.get_asset_file_or_stream("splats.rad"), (later, later))
        data = self.client.get(self.edits_url(task)).data
        self.assertIn("not trained by SplatMe", data["editable"])
        self.assertIsNone(data["model"])
        self.assertFalse(self.status(task)["editable"])
        self.assertEqual(self.put_edits(task, []).status_code, 400)
        self.assertEqual(self.apply(task).status_code, 400)
        # The trained model gone
        os.utime(task.get_asset_file_or_stream("splats.rad"), (time.time() - 60,) * 2)
        self.assertTrue(self.status(task)["editable"])
        os.remove(training.trained_model(task))
        self.assertFalse(self.status(task)["editable"])

    def test_only_those_who_may_change_the_project_edit_its_splats(self):
        task, _, _ = self.trained_task()
        other = APIClient()
        other.login(username="testuser2", password="test1234")
        self.assertEqual(other.get(self.edits_url(task)).status_code, 404)
        assign_perm("view_project", User.objects.get(username="testuser2"), task.project)
        self.assertFalse(other.get(self.edits_url(task)).data["can_edit"])
        self.assertEqual(self.put_edits(task, [], client=other).status_code, 404)
        self.assertEqual(other.post(f"{API}/task/{task.id}/apply").status_code, 404)
        self.assertEqual(APIClient().get(self.edits_url(task)).status_code, 404)

    def test_deleting_a_task_removes_its_edits(self):
        task, _, _ = self.trained_task()
        self.put_edits(task, [self.box((0, 0, 0), (1, 1, 1))])
        self.apply(task)
        task_id = task.id
        task.delete()
        self.assertIsNone(training.store().get_json(edits.edits_key(task_id), None))
        self.assertIsNone(training.get_apply(task_id))

    # Thermal tasks

    def test_a_thermal_task_is_trained_on_its_temperatures_drawn_in_its_palette(self):
        task = make_thermal_task(self.user)
        self.assertIsNone(training.problem(task))
        self.assertTrue(self.client.get(f"{API}/task/{task.id}/check").data["thermal"])
        res = self.train(task, steps=10, palette="iron")
        self.assertEqual(res.status_code, 200, res.data)
        status = self.status(task)
        self.assertEqual(status["state"], "completed", status)
        self.assertEqual(status["options"], {"steps": 10, "image_size": 1600, "palette": "iron"})
        self.assertEqual(status["thermal"]["palette"], "iron")
        # The 1st and 99th percentiles of every 4th pixel: within the photos' 10 to 30 degrees, near both ends
        self.assertTrue(10 <= status["thermal"]["low"] < 11, status["thermal"])
        self.assertTrue(29 < status["thermal"]["high"] <= 30, status["thermal"])
        names = self.node.jobs["job1"]["names"]
        self.assertIn("images/thermal_1.jpg", names)
        self.assertIn("images/thermal_2.jpg", names)
        self.assertFalse(any(name.endswith(".tif") for name in names))

        # Continuing keeps the palette, as it does the other options
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        self.assertEqual(self.status(task)["thermal"]["palette"], "iron")

    def test_the_thermal_photos_are_drawn_over_one_range_for_the_whole_task(self):
        task = make_thermal_task(self.user)
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        stand_in, drawn = thermal.draw(task, "gray", folder)
        first = np.asarray(Image.open(stand_in.get_image_path("thermal_1.jpg")).convert("L"), dtype=int)
        second = np.asarray(Image.open(stand_in.get_image_path("thermal_2.jpg")).convert("L"), dtype=int)
        self.assertEqual(first.shape, (36, 48))
        self.assertLess(first[:, 0].mean(), 10)  # 10 degrees, the coldest: black
        self.assertGreater(second[:, -1].mean(), 245)  # 30 degrees, the hottest: white
        # 20 degrees is the right edge of the first photo and the left edge of the second: the same grey in both
        self.assertLess(abs(first[:, -1].mean() - second[:, 0].mean()), 4)
        self.assertLess(abs(first[:, -1].mean() - 128), 8)
        # WebODM's export reads the drawn photos under their new names
        shots = splats.load_scene(stand_in, 0)[1]
        self.assertEqual(sorted(shot["filename"] for shot in shots), ["thermal_1.jpg", "thermal_2.jpg"])
        self.assertEqual(drawn["palette"], "gray")

    def test_each_thermal_palette_runs_from_cold_to_hot(self):
        for key in thermal.palette_keys():
            table = thermal.colours(key)
            self.assertEqual(table.shape, (256, 3), key)
        self.assertEqual(thermal.colours("gray")[255].tolist(), [255, 255, 255])
        self.assertEqual(thermal.colours("gray_r")[255].tolist(), [0, 0, 0])
        self.assertEqual(thermal.colours("iron")[0].tolist(), [0, 0, 0])
        self.assertEqual(thermal.palette_name("gray_r"), "Black Hot")

    def test_an_unknown_palette_is_refused(self):
        task = make_thermal_task(self.user)
        res = self.train(task, palette="ironred")
        self.assertEqual(res.status_code, 400)
        self.assertIn("palette", res.data["error"])
        self.assertEqual(self.node.jobs, {})

    def test_ignore_sky_is_not_applied_to_a_thermal_task(self):
        task = make_thermal_task(self.user)
        load = self.find_sky(sky.MODEL_INPUT // 2)
        self.assertEqual(self.train(task, steps=10, ignore_sky="true").status_code, 200)
        load.assert_not_called()
        self.assertEqual(self.node.jobs["job1"]["masks"], {})
        self.assertIsNone(self.status(task)["sky_masks"])

    def test_tiffs_that_dji_thermal_analyzer_did_not_write_are_neither_listed_nor_trained(self):
        dji = make_thermal_task(self.user)
        other = make_thermal_task(self.user, dtc=False)
        self.assertTrue(training.compatible(dji))
        self.assertFalse(training.compatible(other))
        self.assertIn("DJI Thermal Analyzer", training.problem(other))
        self.assertFalse(self.client.get(f"{API}/task/{other.id}/check").data["thermal"])
        listed = {t["id"] for p in self.client.get(f"{API}/tasks").data["projects"] for t in p["tasks"]}
        self.assertIn(str(dji.id), listed)
        self.assertNotIn(str(other.id), listed)

    # A task processed again, the follower, downloads, continuing (found by the review of 0.1.1)

    def outdated_job(self, task):
        """A job that lost its worker, started on a reconstruction of the task before the one it has now."""
        node_job = self.node.add_job()
        self.lost_job(task, node_job)
        training.change_job(task.id, lambda job: job.update(source=training.reconstruction(task) - 100))
        return node_job

    def test_a_task_processed_again_while_training_has_that_training_canceled_and_is_trained_again(self):
        task = make_task(self.user)
        self.auto(task, enabled=True)
        old = self.outdated_job(task)
        self.complete(task)
        self.assertTrue(self.node.jobs[old]["deleted"])
        self.assertEqual(sorted(self.node.jobs), ["job-known", "job2"])  # trained again on the new results
        self.assertEqual(self.status(task)["state"], "completed")
        self.assertEqual(self.model(task), MODEL)

    def test_a_task_processed_again_while_training_says_so_when_it_is_not_set_to_train(self):
        task = make_task(self.user)
        old = self.outdated_job(task)
        self.complete(task)
        status = self.status(task)
        self.assertEqual(status["state"], "canceled")
        self.assertIn("processed again", status["error"])
        self.assertTrue(self.node.jobs[old]["deleted"])
        self.assertIsNone(self.model(task))

    def test_a_model_trained_on_an_earlier_reconstruction_of_the_task_is_not_imported(self):
        task = make_task(self.user)
        self.outdated_job(task)
        self.status(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("processed again", status["error"])
        self.assertIsNone(self.model(task))

    def test_a_trainings_worker_job_ends_once_the_node_has_it_and_one_follower_follows_them_all(self):
        started = []
        first, second = make_task(self.user), make_task(self.user)
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append((f.__name__, a))):
            self.assertEqual(self.train(first, steps=10).status_code, 200)
            self.assertEqual(self.train(second, steps=10).status_code, 200)
            for _name, args in started[:2]:
                training.run(*args[1:])  # each one's worker job: the export, sent to the node
            self.assertEqual([name for name, _a in started], ["run_job", "run_job", "run_follower"])
            self.assertEqual({training.get_job(t.id)["state"] for t in (first, second)}, {"queued"})

            training.follow_node(started[-1][1][1])  # until neither waits on the node
            imports = started[3:]
            self.assertEqual([name for name, _a in imports], ["run_job", "run_job"])
            self.assertIsNone(training.store().get_json(training.FOLLOWER, None))
            for _name, args in imports:
                training.run(*args[1:])
        for task in (first, second):
            self.assertEqual(self.status(task)["state"], "completed")
            self.assertEqual(self.model(task), MODEL)

    def test_a_follower_already_running_is_not_started_again(self):
        started = []
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append(f.__name__)):
            training.ensure_follower()
            training.ensure_follower()
            self.assertEqual(started, ["run_follower"])
            # One that stopped answering (its worker was restarted) is replaced
            training.change_record(training.FOLLOWER, lambda f: f.update(updated=time.time() - training.STALE - 1))
            training.ensure_follower()
            self.assertEqual(started, ["run_follower", "run_follower"])

    # Unattended trainings: a lost follower, a node that answers errors (found by the review of 0.2.0)

    def test_the_follower_keeps_following_after_an_error_of_its_own(self):
        started = []
        task = make_task(self.user)
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append((f.__name__, a))):
            self.train(task, steps=10)
            training.run(*started[0][1][1:])
            real, failures = training.handed_jobs, [OperationalError("server closed the connection unexpectedly")]

            def flaky():
                if failures:
                    raise failures.pop()
                return real()

            with mock.patch.object(training, "handed_jobs", flaky), \
                    mock.patch.object(training, "BEAT", 0), mock.patch.object(training, "connection"):
                training.follow_node(started[1][1][1])
        self.assertEqual([name for name, _a in started], ["run_job", "run_follower", "run_job"])  # the import

    def test_a_follower_whose_errors_go_on_ends_for_another_to_start(self):
        failing = mock.Mock(side_effect=OperationalError("the database is gone"))
        with mock.patch.object(training, "follow_all", failing), mock.patch.object(training, "BEAT", 0), \
                mock.patch.object(training, "connection"):
            training.follow_node("run")
        self.assertEqual(failing.call_count, training.FOLLOWER_ERRORS)

    def test_a_training_whose_follower_was_lost_is_followed_again_when_any_task_completes(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        self.complete(make_task(self.user))  # a task not set to train
        self.assertEqual(training.get_job(task.id)["state"], "completed")
        self.assertEqual(self.model(task), MODEL)

    def test_a_training_whose_follower_was_lost_is_followed_again_when_any_task_fails(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        for _receiver, answer in signals.task_failed.send_robust(sender=Task, task_id=make_task(self.user).id):
            self.assertIsNone(answer)
        self.assertEqual(training.get_job(task.id)["state"], "completed")

    def test_a_training_whose_follower_was_lost_is_followed_again_from_any_page_of_webodm(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        self.assertEqual(APIClient().get(f"{API}/revive").status_code, 403)
        self.assertEqual(training.get_job(task.id)["state"], "training")
        self.assertEqual(self.client.get(f"{API}/revive").status_code, 204)
        self.assertEqual(training.get_job(task.id)["state"], "completed")

    def test_a_node_that_answers_errors_for_a_while_is_waited_for(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        self.node.failures = [502, 503, 401, 500]  # a proxy while the node restarts, a token being changed
        self.status(task)
        self.assertEqual(training.get_job(task.id)["state"], "completed")
        self.assertEqual(self.model(task), MODEL)

    def test_a_node_that_answers_errors_past_the_patience_fails_the_training_and_its_job_is_deleted(self):
        task = make_task(self.user)
        node_job = self.lost_job(task, self.node.add_job()) or "job-known"
        self.node.failures = [502]
        with mock.patch.object(training, "NODE_PATIENCE", -1):
            self.status(task)
        job = training.get_job(task.id)
        self.assertEqual(job["state"], "failed")
        self.assertIn("502", job["error"])
        self.assertTrue(self.node.jobs[node_job]["deleted"])

    def test_the_heartbeat_reconnects_after_an_error_of_the_database(self):
        connection = mock.Mock()
        with mock.patch.object(training, "connection", connection), mock.patch.object(training, "BEAT", 0.01), \
                mock.patch.object(training, "update", side_effect=[InterfaceError("connection already closed"),
                                                                   training.Superseded()]):
            training.Heartbeat("task", "run").beat()
        self.assertEqual(connection.close.call_count, 2)  # after the error, and when it ends

    def test_a_download_that_stops_is_tried_again(self):
        task = make_task(self.user)
        real, calls = training.Node.result, []

        def drops_once(node, job_id, dest):
            calls.append(job_id)
            if len(calls) == 1:
                raise training.NodeError("The download of the trained model stopped")
            return real(node, job_id, dest)

        with mock.patch.object(training.Node, "result", drops_once):
            self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.status(task)["state"], "completed")

    def test_a_node_silent_too_long_fails_the_training_and_is_asked_to_drop_the_job(self):
        task = make_task(self.user)
        node_job = self.node.add_job()
        self.lost_job(task, node_job)
        silent = training.NodeError("The splat node does not answer.")
        with mock.patch.object(training, "NODE_PATIENCE", -1), mock.patch.object(training.Node, "job", side_effect=silent):
            self.status(task)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("does not answer", status["error"])
        self.assertTrue(self.node.jobs[node_job]["deleted"])

    def test_continuing_uses_the_options_the_model_was_trained_with_not_the_last_trainings(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10, image_size=16, sh_degree=3).status_code, 200)
        # A training with other options, canceled: the task's model is still the first one's
        canceled = {"steps": 20, "image_size": 0, "sh_degree": 1, "ignore_sky": True}
        training.change_job(task.id, lambda job: job.update(state="canceled", options=canceled))
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        self.assertEqual(self.status(task)["options"], {"steps": 15, "image_size": 16, "sh_degree": 3})
        self.assertEqual(self.node.jobs["job2"]["options"], {"steps": 15, "sh_degree": 3})

        # A model of SplatMe 0.1 (no options beside it) continues only with its own training's record
        os.remove(training.trained_options_file(task))
        self.assertEqual(self.train(task, resume="true", steps=5).status_code, 200)
        os.remove(training.trained_options_file(task))
        training.change_job(task.id, lambda job: job.update(state="canceled"))
        res = self.train(task, resume="true", steps=5)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Start the training over", res.data["error"])

    def test_files_kept_beside_a_tasks_photos_neither_hide_it_nor_stop_its_training(self):
        jpeg = make_task(self.user)
        for name in ("tiny_drone_image_mask.png", "gcp_list.txt", "geo.txt", "image_groups.txt", "align.tif"):
            add_file(jpeg, name)
        self.assertTrue(training.compatible(jpeg))
        dji = make_thermal_task(self.user)
        add_file(dji, "geo.txt")
        add_file(dji, "gcp_list.txt")
        self.assertTrue(training.compatible(dji))
        self.assertIsNone(training.problem(dji))

    def test_a_job_whose_worker_keeps_dying_while_exporting_fails_with_the_likely_reason(self):
        task = make_task(self.user)
        self.lost_job(task, None, state="exporting")
        training.change_job(task.id, lambda job: job.update(takeovers=training.TAKEOVERS))
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("run out of memory", status["error"])
        self.assertEqual(self.node.jobs, {})

    # The rest of the review of 0.2.0's findings

    def test_a_training_started_over_a_record_that_lost_its_worker_deletes_that_records_node_job(self):
        task = make_task(self.user)
        node_job = self.node.add_job()
        self.lost_job(task, node_job)
        self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.assertTrue(self.node.jobs[node_job]["deleted"])
        self.assertEqual(self.status(task)["state"], "completed")

    def test_the_follower_keeps_a_trainings_samples_under_its_node_job_not_its_task(self):
        started = []
        task = make_task(self.user)
        self.node.script = [("running", {"progress": 50, "step": 5})]
        with mock.patch.object(training, "run_function_async", side_effect=lambda f, *a: started.append(a)):
            self.train(task, steps=10)
            training.run(*started[0][1:])
            seen = {}
            training.follow_all(started[1][1], seen)
        self.assertEqual(list(seen), ["job1"])  # a later training of the task (another node job) starts from none

    def test_a_run_that_waited_in_the_workers_queue_does_not_count_as_a_lost_worker(self):
        task = make_task(self.user)
        self.lost_job(task, None, state="exporting")
        training.change_job(task.id, lambda job: job.update(takeovers=training.TAKEOVERS, waiting="lost"))
        self.status(task)
        self.assertEqual(self.status(task)["state"], "completed")

    def test_a_training_that_fails_by_lost_workers_while_importing_keeps_the_nodes_model(self):
        task = make_task(self.user)
        node_job = self.node.add_job()
        self.lost_job(task, node_job, state="importing")
        training.change_job(task.id, lambda job: job.update(takeovers=training.TAKEOVERS))
        self.assertEqual(self.status(task)["state"], "failed")
        self.assertFalse(self.node.jobs[node_job]["deleted"])

    def test_splat_tools_that_runs_too_long_is_stopped_and_named(self):
        timeout = subprocess.TimeoutExpired("splat-tools", 1)
        with mock.patch.object(training.shutil, "which", return_value="/usr/bin/splat-tools"), \
                mock.patch.object(training.subprocess, "run", side_effect=timeout) as run, \
                self.assertRaisesMessage(training.TrainingError, "splat-tools took longer than 60 minutes"):
            CONVERT("model.ply", "model.rad")
        self.assertEqual(run.call_args.kwargs["timeout"], training.CONVERT_TIMEOUT)

    def test_a_failure_while_the_models_files_are_written_leaves_the_task_as_it_was(self):
        task = make_task(self.user)
        self.put_model(task, b"the model before")
        task.update_available_assets_field(commit=True)
        with mock.patch.object(training.json, "dump", side_effect=OSError(28, "No space left on device")):
            self.assertEqual(self.train(task, steps=10).status_code, 200)
        status = self.status(task)
        self.assertEqual(status["state"], "failed")
        self.assertIn("No space left on device", status["error"])
        self.assertEqual(self.model(task), b"the model before")
        self.assertFalse(os.path.exists(training.trained_model(task)))
        folder = os.path.dirname(task.get_asset_file_or_stream("splats.rad"))
        self.assertEqual([n for n in os.listdir(folder) if n.endswith(training.NEW)], [])

    def test_a_page_that_is_not_the_nodes_answer_is_waited_for_like_a_node_that_does_not_answer(self):
        task = make_task(self.user)
        self.lost_job(task, self.node.add_job())
        self.node.failures = [200, 200]  # a proxy's page, 200 OK
        self.status(task)
        self.assertEqual(training.get_job(task.id)["state"], "completed")

        other = make_task(self.user)
        self.lost_job(other, self.node.add_job("job-other"))
        self.node.failures = [200]
        with mock.patch.object(training, "NODE_PATIENCE", -1):
            self.status(other)
        job = training.get_job(other.id)
        self.assertEqual(job["state"], "failed")
        self.assertIn("not a splat node's answer", job["error"])

    def test_an_upload_whose_answer_is_lost_follows_the_job_the_node_made(self):
        task = make_task(self.user)
        self.node.version = "0.2.2"
        self.node.lose_answer = True
        self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.assertEqual(self.status(task)["state"], "completed")
        self.assertEqual(list(self.node.jobs), ["job1"])
        self.assertEqual(len(self.node.jobs["job1"]["ref"]), 32)  # the run's id
        self.assertEqual(self.model(task), MODEL)

    def test_a_node_older_than_0_2_2_is_sent_no_ref(self):
        task = make_task(self.user)
        self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.assertIsNone(self.node.jobs["job1"]["ref"])

    def test_a_cancel_during_the_import_keeps_the_tasks_model(self):
        task = make_task(self.user)
        self.put_model(task, b"the model before")
        task.update_available_assets_field(commit=True)

        def convert_then_cancel(trained_file, model):
            self.convert(trained_file, model)
            self.assertEqual(self.client.post(f"{API}/task/{task.id}/cancel").status_code, 200)

        with mock.patch.object(training, "convert", convert_then_cancel):
            self.assertEqual(self.train(task, steps=10).status_code, 200)
        self.assertEqual(self.status(task)["state"], "canceled")
        self.assertEqual(self.model(task), b"the model before")

    def test_anyone_may_follow_a_public_tasks_training_and_nobody_without_an_account_may_train_it(self):
        task = make_task(self.user)
        Task.objects.filter(pk=task.pk).update(public=True)
        res = APIClient().get(f"{API}/task/{task.id}/status")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["can_train"])
        self.assertEqual(APIClient().get(f"{API}/task/{task.id}/auto").status_code, 200)

    def test_the_log_of_a_public_task_tells_only_an_administrator_what_is_wrong_with_the_node(self):
        task = make_task(self.user)
        Task.objects.filter(pk=task.pk).update(public=True)
        self.lost_job(task, self.node.add_job())
        training.set_node("http://127.0.0.1:9")  # nothing answers there
        res = APIClient().get(f"{API}/task/{task.id}/log")
        self.assertEqual(res.status_code, 502)
        self.assertNotIn("127.0.0.1", res.data["error"])
        admin = APIClient()
        admin.login(username="testsuperuser", password="test1234")
        self.assertIn("127.0.0.1", admin.get(f"{API}/task/{task.id}/log").data["error"])

    def test_a_boundary_with_a_hole_leaves_out_what_is_in_the_hole(self):
        task = make_task(self.user)
        outline = [[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]]
        hole = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
        self.with_boundary(task, {"type": "Polygon", "coordinates": [outline, hole]})
        self.node_model([(0, 0), (2, 2), (5, 5)])
        self.assertEqual(self.train(task, steps=10, image_size=16).status_code, 200)
        self.assertEqual(self.status(task)["cropped"], 2)  # the one in the hole, the one outside

    def test_the_thermal_range_of_a_big_task_is_found_from_a_bounded_sample(self):
        task = make_thermal_task(self.user)
        paths = [task.get_image_path(name) for name in THERMAL]
        whole = thermal.task_range(paths)
        with mock.patch.object(thermal, "SAMPLE_BUDGET", 20):
            sampled = thermal.task_range(paths)
        self.assertLess(abs(sampled[0] - whole[0]), 1)
        self.assertLess(abs(sampled[1] - whole[1]), 1)

    def test_ignore_sky_without_onnxruntime_says_so(self):
        with mock.patch.dict(sys.modules, {"onnxruntime": None}), self.assertRaises(sky.SkyError) as raised:
            sky.load()
        self.assertIn("onnxruntime", str(raised.exception))

    def test_the_status_says_whether_splatme_lists_the_task_only_when_asked(self):
        jpeg = make_task(self.user)
        self.assertNotIn("listed", self.status(jpeg))
        self.assertTrue(self.client.get(f"{API}/task/{jpeg.id}/status?listed=1").data["listed"])
        png = make_task(self.user, images=["a.png"])
        self.assertFalse(self.client.get(f"{API}/task/{png.id}/status?listed=1").data["listed"])

    def test_the_status_of_a_task_splatme_does_not_list_says_why(self):
        png = make_task(self.user, images=["a.png"])
        self.assertIn("photos are JPEG", self.client.get(f"{API}/task/{png.id}/status?listed=1").data["unlisted"])
        compacted = make_task(self.user)
        Task.objects.filter(pk=compacted.pk).update(compacted=True)
        status = self.client.get(f"{API}/task/{compacted.id}/status?listed=1").data
        self.assertFalse(status["listed"])
        self.assertIn("compacted", status["unlisted"])
        jpeg = make_task(self.user)
        self.assertIsNone(self.client.get(f"{API}/task/{jpeg.id}/status?listed=1").data["unlisted"])


class TestTwoRequestsAtOnce(BootTransactionTestCase):
    """Requests that really run at once, each with its own database connection."""

    def test_two_first_trainings_of_a_task_at_once_make_one_record_and_one_training(self):
        node = FakeNode()
        self.addCleanup(node.close)
        training.set_node(node.url, node.token)
        task = make_task(User.objects.get(username="testuser"))
        real_get_job, results = training.get_job, []

        def slow_get_job(task_id):
            job = real_get_job(task_id)
            time.sleep(0.5)  # both requests have read the record before either writes it
            return job

        def start():
            try:
                training.start(Task.objects.get(pk=task.id), "testuser", {"steps": 10})
                results.append("started")
            except training.TrainingError as e:
                results.append(str(e))
            finally:
                connection.close()

        with mock.patch.object(training, "get_job", slow_get_job), mock.patch.object(training, "run_function_async"):
            threads = [threading.Thread(target=start) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(30)
        self.assertEqual(sorted(results), ["This task's splats are already being trained.", "started"])
        key = training.store().db_key(training.job_key(task.id))
        self.assertEqual(PluginDatum.objects.filter(key=key, user=None).count(), 1)
