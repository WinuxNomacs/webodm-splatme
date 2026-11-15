"""
The sky in a training's photos, as masks: the trainer ignores the pixels a mask has black.

The sky is found by the model ODX uses for its own sky removal (an ONNX model, run here on the CPU with the
onnxruntime WebODM has), as ODX does it (modules/skyremoval): the model's answer for a 384 x 384 copy of the
photo, sharpened along the photo's own edges. The model is downloaded once, into the plugin's persistent folder.
"""
import hashlib
import json
import math
import os
import urllib.error
import urllib.request
import zipfile

import numpy as np
from app.plugins.functions import get_plugins_persistent_path
from PIL import Image
from scipy.ndimage import uniform_filter

MODEL_URL = "https://github.com/WebODM/ODX/releases/download/v3.7.1/skyremoval.zip"
MODEL_SHA256 = "2cd9873516a305534f2c77a63d4cad580a7e4f0d98674bf7200de80f28b40503"
MODEL_FOLDER = "skyremoval-1.0.5"
MODEL_INPUT = 384  # the model's input, in pixels a side
MASK_SIDE = 800  # a mask's longer side: the trainer resizes it to its image
HORIZON_MARGIN = math.radians(5)  # a photo this close to showing the horizon is looked at
MIN_SKY = 0.005  # a photo with less sky than this share of its pixels gets no mask
TIMEOUT = 60
CHUNK = 1 << 20


class SkyError(Exception):
    """The sky cannot be found, with the reason."""


def model_path():
    return get_plugins_persistent_path("splatme", "models", MODEL_FOLDER, "model.onnx")


def download_model(progress=None):
    """The model's file, downloaded and checked first when it is not there yet."""
    path = model_path()
    if os.path.isfile(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = f"{path}.{os.getpid()}.zip"
    try:
        digest = hashlib.sha256()
        with urllib.request.urlopen(MODEL_URL, timeout=TIMEOUT) as response, open(part, "wb") as f:
            total = int(response.headers.get("Content-Length") or 0)
            done = 0
            while chunk := response.read(CHUNK):
                f.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if progress and total:
                    progress("Downloading the sky model", done * 100 / total)
        if digest.hexdigest() != MODEL_SHA256:
            raise SkyError("The sky model that was downloaded is not the expected file.")
        with zipfile.ZipFile(part) as z, z.open("model.onnx") as src, open(part + ".onnx", "wb") as f:
            while chunk := src.read(CHUNK):
                f.write(chunk)
        os.replace(part + ".onnx", path)
    except (OSError, urllib.error.URLError, zipfile.BadZipFile, KeyError) as e:
        raise SkyError(
            f"The sky model could not be downloaded from {MODEL_URL} ({e}). WebODM needs to reach that address "
            "once; or train without Ignore Sky."
        ) from None
    finally:
        for leftover in (part, part + ".onnx"):
            if os.path.exists(leftover):
                os.remove(leftover)
    return path


def load(progress=None):
    """A function giving the sky in a photo: an array of the model's input size, 1 where it sees sky."""
    import onnxruntime  # here: only a training that asks for the sky loads it

    session = onnxruntime.InferenceSession(download_model(progress), providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name

    def find(pixels):
        # pixels: MODEL_INPUT x MODEL_INPUT x 3, 0 to 1
        out = session.run(None, {name: pixels.transpose(2, 0, 1)[None].astype(np.float32)})[0]
        return np.clip(out[0][0], 0.0, 1.0)

    return find


def guided_filter(guide, values, radius, eps):
    """The values smoothed, keeping the guide's edges (He et al., as ODX's guidedfilter.py)."""
    def mean(a):
        return uniform_filter(a, size=2 * radius + 1, mode="nearest")

    mean_guide, mean_values = mean(guide), mean(values)
    a = (mean(guide * values) - mean_guide * mean_values) / (mean(guide * guide) - mean_guide * mean_guide + eps)
    b = mean_values - a * mean_guide
    return mean(a) * guide + mean(b)


def sky_mask(image_path, find):
    """A photo's mask as a Pillow image (white is trained on, black is sky), or None when it shows no sky."""
    with Image.open(image_path) as opened:
        opened.draft("RGB", (MASK_SIDE, MASK_SIDE))
        image = opened.convert("RGB")
    image.thumbnail((MASK_SIDE, MASK_SIDE), Image.BOX)
    small = np.asarray(image.resize((MODEL_INPUT, MODEL_INPUT), Image.BOX), dtype=np.float32) / 255.0
    sky = find(small)
    if (sky > 0.5).mean() < MIN_SKY:
        return None
    sky = np.asarray(Image.fromarray(sky.astype(np.float32), mode="F").resize(image.size, Image.BICUBIC))
    blue = np.asarray(image, dtype=np.float32)[:, :, 2] / 255.0
    # ODX's radius is 20 pixels of the full photo and its eps 0.01
    refined = guided_filter(blue, np.clip(sky, 0.0, 1.0), radius=4, eps=0.01)
    ground = refined <= 0.5
    if 1.0 - ground.mean() < MIN_SKY:
        return None
    return Image.fromarray((ground * 255).astype(np.uint8), mode="L")


def may_show_sky(task):
    """
    The file names of the task's photos that may show the sky: those not looking so far down that the horizon is
    out of the picture. None when that cannot be told: every photo is then looked at.
    """
    try:
        with open(task.assets_path(task.ASSETS_MAP["cameras.json"])) as f:
            cameras = json.load(f)
        with open(task.assets_path(task.ASSETS_MAP["shots.geojson"])) as f:
            features = json.load(f).get("features", [])
    except (OSError, ValueError):
        return None
    half_view = 0.0  # the widest camera's angle from the middle of the picture to its corner
    for camera in cameras.values():
        try:
            if camera.get("projection_type") not in ("perspective", "brown"):
                return None  # a fisheye or a panorama sees the sky whatever it points at
            width, height = float(camera["width"]), float(camera["height"])
            focal = float(camera.get("focal", camera.get("focal_x")))
            half_view = max(half_view, math.atan(math.hypot(width, height) / (2 * max(width, height) * focal)))
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            return None
    names = set()
    for feature in features:
        properties = feature.get("properties") or {}
        name = os.path.basename(properties.get("filename") or "")
        if not name:
            continue
        try:
            rx, ry, rz = (float(v) for v in properties["rotation"])
        except (KeyError, TypeError, ValueError):
            names.add(name)
            continue
        theta = math.sqrt(rx * rx + ry * ry + rz * rz)
        # How far up the camera looks: 1 straight up, -1 straight down (as training.mostly_nadir)
        view_z = 1.0 if theta < 1e-12 else math.cos(theta) + (rz / theta) ** 2 * (1.0 - math.cos(theta))
        if math.asin(max(-1.0, min(1.0, view_z))) + half_view + HORIZON_MARGIN > 0:
            names.add(name)
    return names


def make_masks(task, images, folder, progress):
    """
    Writes the masks of an export's images ([{"path", "name"}], WebODM's images.json) into the folder.
    Answers [(mask's path, image's name)] for the photos that show sky. progress(status, percent) may raise to stop.
    """
    wanted = may_show_sky(task)
    photos = [image for image in images if wanted is None or image["name"] in wanted]
    if not photos:
        return []
    find = load(progress)
    os.makedirs(folder, exist_ok=True)
    masks = []
    for i, image in enumerate(photos):
        progress(f"Photo {i + 1} of {len(photos)}", i * 100 / len(photos))
        mask = sky_mask(image["path"], find)
        if mask is not None:
            path = os.path.join(folder, f"{len(masks)}.png")
            mask.save(path, optimize=True)
            masks.append((path, image["name"]))
    return masks
