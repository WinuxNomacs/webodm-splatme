"""
Thermal tasks: the TIFFs DJI Thermal Analyzer makes (single-band float32 temperatures in degrees Celsius, its
metadata in their XMP) drawn as JPEGs in a palette, over one range for the whole task, so that a surface has the
same colour in every photo. WebODM's export is then given those JPEGs through a stand-in for the task.
"""
import json
import math
import os
import re

import numpy as np
from PIL import Image, TiffImagePlugin

# What DJI Thermal Analyzer writes in each TIFF's XMP (dji-thermal-cli's namespace)
DTC_NAMESPACE = b"urn:dji-thermal-cli:xmp:1.0"
TIFF_EXTENSIONS = (".tif", ".tiff")
XMP_TAG = 700
LOW, HIGH = 1, 99  # the range's percentiles of all the task's pixels: the cold sky and a few hot pixels left out
SAMPLE = 4  # every 4th pixel across and down is enough for the range
SAMPLE_BUDGET = 20_000_000  # temperatures kept for the range in all, so that a task of thousands of photos fits in memory
# Files WebODM and ODM keep beside a task's photos: GCP, geo and image group lists, alignment files, image masks
NOT_PHOTOS = re.compile(r"(?i)(\.txt$|^align\.(laz|las|tif|tiff)$|_mask\.\w+$)")
QUALITY = 95

# Iron: black, purple, red, orange, yellow, white (position 0 to 1, colour)
IRON_STOPS = [
    (0.0, (0, 0, 0)), (0.2, (60, 0, 130)), (0.4, (160, 0, 140)), (0.6, (230, 60, 20)),
    (0.8, (255, 170, 0)), (0.93, (255, 235, 90)), (1.0, (255, 255, 255)),
]  # fmt: skip

# The Thermal Colours: key, name as the pages show it, and where the colours come from (WebODM's own map, by name)
PALETTES = [
    ("gray", "Grayscale", None),
    ("gray_r", "Black Hot", None),
    ("iron", "Iron", None),
    ("magma", "Magma", "magma"),
    ("inferno", "Inferno", "inferno"),
    ("plasma", "Plasma", "plasma"),
    ("viridis", "Viridis", "viridis"),
    ("cividis", "Cividis", "cividis"),
    ("jet", "Jet", "jet"),
]
DEFAULT_PALETTE = "gray"


class ThermalError(Exception):
    """The thermal photos cannot be drawn, with the reason."""


def palette_keys():
    return [key for key, _, _ in PALETTES]


def palette_name(key):
    return next((name for k, name, _ in PALETTES if k == key), key)


def colours(key):
    """The palette's 256 colours, coldest first, as a (256, 3) uint8 array."""
    ramp = np.arange(256, dtype=np.uint8)
    if key == "gray":
        return np.stack([ramp] * 3, axis=1)
    if key == "gray_r":
        return np.stack([ramp[::-1]] * 3, axis=1)
    if key == "iron":
        at = np.linspace(0, 1, 256)
        positions = [p for p, _ in IRON_STOPS]
        channels = [np.interp(at, positions, [c[i] for _, c in IRON_STOPS]) for i in range(3)]
        return np.stack(channels, axis=1).round().astype(np.uint8)
    source = next((map_name for k, _, map_name in PALETTES if k == key), None)
    if source is None:
        raise ThermalError(f"There is no palette {key}.")
    from app.vendor.rio_tiler.colormap import cmap  # WebODM's own colour maps, as its map layers draw them

    table = cmap.get(source)
    return np.array([table[i][:3] for i in range(256)], dtype=np.uint8)


def is_thermal_tiff(path):
    """Whether the file is a TIFF DJI Thermal Analyzer wrote: its XMP read without the pixels."""
    try:
        with Image.open(path) as im:
            if not isinstance(im, TiffImagePlugin.TiffImageFile):
                return False
            xmp = im.tag_v2.get(XMP_TAG)
    except (OSError, ValueError, SyntaxError):
        return False
    if isinstance(xmp, str):
        xmp = xmp.encode("utf-8", "ignore")
    return isinstance(xmp, bytes) and DTC_NAMESPACE in xmp


def photo_names(names):
    """The photos among the files of a task's folder."""
    return [name for name in names if not NOT_PHOTOS.search(name)]


def is_thermal(task, names=None):
    """
    Whether the task is DJI Thermal Analyzer's: its images are TIFFs, the first of which it wrote.
    names: the names of the files in the task's folder, when already known
    """
    names = sorted(photo_names(task.scan_images() if names is None else names))
    if not names or any(os.path.splitext(name)[1].lower() not in TIFF_EXTENSIONS for name in names):
        return False
    return is_thermal_tiff(task.get_image_path(names[0]))


def read_temperatures(path):
    with Image.open(path) as im:
        if im.mode not in ("F", "I;16", "I"):
            raise ThermalError(f"{os.path.basename(path)} is not a thermal image of temperatures.")
        return np.asarray(im, dtype=np.float32)


def jpeg_name(name):
    return os.path.splitext(name)[0] + ".jpg"


def task_range(paths, progress=None):
    """The task's range, in the file's unit (degrees Celsius): (low, high), from all the photos' pixels."""
    samples = []
    budget = max(1, SAMPLE_BUDGET // max(1, len(paths)))
    for i, path in enumerate(paths):
        t = read_temperatures(path)[::SAMPLE, ::SAMPLE]
        t = t[np.isfinite(t)]
        samples.append(t[:: math.ceil(t.size / budget)] if t.size > budget else t)
        if progress:
            progress("Finding the temperature range", (i + 1) * 50 / len(paths))
    values = np.concatenate(samples) if samples else np.empty(0, dtype=np.float32)
    if values.size == 0:
        raise ThermalError("The thermal photos have no temperatures.")
    low, high = (float(v) for v in np.percentile(values, [LOW, HIGH]))
    if high - low < 0.1:
        low, high = low - 0.05, high + 0.05  # a scene of one temperature still draws
    return low, high


def draw_one(source, dest, low, high, table):
    t = read_temperatures(source)
    levels = np.clip((np.nan_to_num(t, nan=low) - low) / (high - low) * 255, 0, 255).round().astype(np.uint8)
    Image.fromarray(table[levels], "RGB").save(dest, format="JPEG", quality=QUALITY)


class StandIn:
    """The task as WebODM's export sees it: the shots named after the drawn JPEGs, and their paths; the rest the
    task's own."""

    def __init__(self, task, shots_file, images):
        self._task, self._shots_file, self._images = task, shots_file, images

    def __getattr__(self, name):
        return getattr(self._task, name)

    def assets_path(self, *args):
        if os.path.join(*args) == self._task.ASSETS_MAP["shots.geojson"]:
            return self._shots_file
        return self._task.assets_path(*args)

    def get_image_path(self, filename):
        if filename in self._images:
            return self._images[filename]
        raise FileNotFoundError(filename)


def draw(task, palette, folder, progress=None):
    """
    The task's photos drawn as JPEGs in folder, in the palette, over the task's range.
    :return: (a stand-in for the task, to give WebODM's export; {"palette", "low", "high"}, the range in degrees
        Celsius)
    """
    table = colours(palette)
    with open(task.assets_path(task.ASSETS_MAP["shots.geojson"])) as f:
        shots = json.load(f)
    names = []
    for feature in shots.get("features", []):
        name = os.path.basename((feature.get("properties") or {}).get("filename") or "")
        if name and name not in names and os.path.isfile(task.get_image_path(name)):
            names.append(name)
    if not names:
        raise ThermalError("The task's images are gone, and training needs them.")
    paths = [task.get_image_path(name) for name in names]
    low, high = task_range(paths, progress)

    os.makedirs(folder, exist_ok=True)
    images = {}
    for i, (name, path) in enumerate(zip(names, paths, strict=True)):
        dest = os.path.join(folder, jpeg_name(name))
        draw_one(path, dest, low, high, table)
        images[jpeg_name(name)] = dest
        if progress:
            progress("Drawing the thermal photos", 50 + (i + 1) * 50 / len(names))

    for feature in shots.get("features", []):
        props = feature.get("properties") or {}
        if props.get("filename"):
            props["filename"] = jpeg_name(os.path.basename(props["filename"]))
    shots_file = os.path.join(folder, "shots.geojson")
    with open(shots_file, "w") as f:
        json.dump(shots, f)
    return StandIn(task, shots_file, images), {"palette": palette, "low": round(low, 2), "high": round(high, 2)}
