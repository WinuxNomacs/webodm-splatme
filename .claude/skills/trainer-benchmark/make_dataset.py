# A task's training zip as SplatMe sends it (WebODM's export at an Image Size, SplatMe's sky masks), written to
# /tmp/benchmark/dataset.zip in the container. Run in sm-worker:
#   docker exec -e TASK_ID=<id> -e IMAGE_SIZE=1600 -w /webodm sm-worker bash -c 'python manage.py shell < /tmp/make_dataset.py'
# The task is only read.
import json
import os
import shutil

from app import splats
from app.models import Task
from coreplugins.splatme import sky

task = Task.objects.get(pk=os.environ["TASK_ID"])
work = "/tmp/benchmark"
shutil.rmtree(work, ignore_errors=True)
export_dir = os.path.join(work, "export")
os.makedirs(export_dir)
splats.prepare_export(task, export_dir, image_size=int(os.environ.get("IMAGE_SIZE", "1600")))
with open(os.path.join(export_dir, "images.json")) as f:
    images = json.load(f)
masks = sky.make_masks(task, images, os.path.join(work, "masks"), None)
archive = splats.export_zip(export_dir)
for path, name in masks:
    archive.add_path(path, f"masks/{name}.png")
with open(os.path.join(work, "dataset.zip"), "wb") as f:
    f.writelines(archive)
print("images", len(images), "masks", len(masks), "zip", os.path.getsize(os.path.join(work, "dataset.zip")))
