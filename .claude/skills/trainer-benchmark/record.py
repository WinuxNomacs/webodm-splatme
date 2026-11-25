"""
record.py: adds a scored run to dev/benchmarks/check-task.json (see SKILL.md). Numbers only: photos are numbered
in name order, never named.

    python3 record.py --work <W> --name <timings name> --ply out/<model>.ply --eval out/eval-<name>
        --trainer lichtfeld|opensplat --options '<json>' [--corrected out/<run folder>] [--notes "..."]

--eval is a `LichtFeld-Studio eval` folder (the model as a viewer shows it); --corrected is LichtFeld's own training
folder, whose last evaluation applies its exposure correction: recorded as a second run, "<name>+corrected".
"""
import argparse
import csv
import datetime
import json
import os
import re

RESULTS = os.path.join(os.path.dirname(__file__), "..", "..", "..", "dev", "benchmarks", "check-task.json")
TRAINERS = {
    "lichtfeld": {"name": "LichtFeld Studio", "version": "0.5.4.3", "commit": "06c9a04"},
    "opensplat": {"name": "OpenSplat", "commit": "e33f9dd"},
}


def last_metrics(folder):
    """The last row of a metrics.csv, its numbers as floats."""
    with open(os.path.join(folder, "metrics.csv")) as f:
        rows = list(csv.DictReader(f))
    return {k: float(v) for k, v in rows[-1].items() if v not in ("", None)}


def per_photo(folder):
    """{psnr: [...], ssim: [...], lpips: [...]} in photo name order, from the last evaluation of each photo."""
    path = os.path.join(folder, "per_image_metrics.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        photos = json.load(f)
    out = {"psnr": [], "ssim": [], "lpips": []}
    for name in sorted(photos):
        last = photos[name]["evaluations"][-1]
        for key, values in out.items():
            values.append(round(last[key], 4))
    return out


def scores(m, corrected=False):
    """The mean scores; bias is the mean brightness error (+ brighter than the photos), after the exposure correction
    (bias_corr) for LichtFeld's own evaluation."""
    out = {"psnr": round(m["psnr"], 2), "ssim": round(m["ssim"], 3), "lpips": round(m["lpips"], 3)}
    b = "bias_corr_" if corrected else "bias_"
    if b + "r" in m:
        out["bias"] = round((m[b + "r"] + m[b + "g"] + m[b + "b"]) / 3, 4)
    return out


def gaussians(ply):
    with open(ply, "rb") as f:
        header = f.read(4096)
    return int(re.search(rb"^element vertex (\d+)", header, re.MULTILINE).group(1))


def timing(work, name):
    with open(os.path.join(work, "out", "timings.txt")) as f:
        lines = [line for line in f if line.startswith(name + " ")]
    fields = dict(part.split("=") for part in lines[-1].split()[1:])
    if fields["exit"] != "0":
        raise SystemExit(f"{name} exited with {fields['exit']}")
    return int(fields["seconds"]), int(fields["above_idle_mib"])


def main():
    p = argparse.ArgumentParser()
    for arg in ("--work", "--name", "--ply", "--eval", "--trainer", "--options"):
        p.add_argument(arg, required=True)
    p.add_argument("--corrected")
    p.add_argument("--notes", default="")
    a = p.parse_args()
    path = lambda rel: os.path.join(a.work, rel)
    seconds, mib = timing(a.work, a.name)
    options = json.loads(a.options)
    today = datetime.date.today().isoformat()
    run = {
        "id": a.name, "date": today, "trainer": TRAINERS[a.trainer], "options": options, "seconds": seconds,
        "gpu_mib_above_idle": mib, "gaussians": gaussians(path(a.ply)),
        "model_mb": round(os.path.getsize(path(a.ply)) / 1e6), "scores": scores(last_metrics(path(a.eval))),
        "per_photo": per_photo(path(a.eval)),
        "scored_with": "LichtFeld-Studio eval on the held-out photos, --undistort (the model as a viewer shows it)",
        "notes": a.notes,
    }  # fmt: skip
    runs = [run]
    if a.corrected:
        runs.append({
            "id": a.name + "+corrected", "date": today, "trainer": TRAINERS[a.trainer], "same_run_as": a.name,
            "options": options, "scores": scores(last_metrics(path(a.corrected)), corrected=True),
            "per_photo": per_photo(path(a.corrected)),
            "scored_with": "LichtFeld's own last evaluation: its exposure correction applied from the nearest training photo",
        })  # fmt: skip
    with open(RESULTS) as f:
        results = json.load(f)
    ids = {r["id"] for r in runs}
    results["runs"] = [r for r in results["runs"] if r["id"] not in ids] + runs
    with open(RESULTS, "w") as f:
        json.dump(results, f, indent=1)
        f.write("\n")
    for r in runs:
        print(r["id"], r["scores"], r.get("gaussians"), r.get("seconds"))


if __name__ == "__main__":
    main()
