#!/usr/bin/env python3
"""Stands in for OpenSplat in the service's tests: the same arguments and output, no training.

FAKE_TRAINER (environment): "fail" ends with an error, "oom" with CUDA's out-of-memory message, "slow" waits
a long time between steps (for the tests that cancel). Misbehaving, for the tests that make failures happen:
"stubborn" ignores SIGTERM, "silent" stops printing without exiting; both give up after 60 s, so a run against a
node that can't stop them leaves nothing behind for long.
"""

import os
import signal
import sys
import time

if "--version" in sys.argv:
    print("9.9.9")
    sys.exit(0)

args = sys.argv[1:]
dataset, output = args[0], args[args.index("-o") + 1]
steps = int(args[args.index("--num-iters") + 1])
mode = os.environ.get("FAKE_TRAINER", "")

# The node unpacks the zip (OpenSplat's own zip reader refuses some of WebODM's), and deletes it before training
if not os.path.isdir(dataset):
    print(f"Invalid zip archive: {dataset}", flush=True)
    sys.exit(1)
if not os.path.isfile(os.path.join(dataset, "sparse", "0", "cameras.bin")):
    print("Invalid project folder (must be either a colmap or nerfstudio or openmvg project folder)", flush=True)
    sys.exit(1)
if os.path.exists(os.path.join(os.path.dirname(dataset), "dataset.zip")):
    print("The dataset's zip is still there", flush=True)
    sys.exit(1)
os.mkdir(os.path.join(os.path.dirname(dataset), "opensplat-cache"))  # what the trainer leaves beside its input
print("Using CUDA", flush=True)
if mode == "fail":
    print("No cameras see any sparse points", flush=True)
    sys.exit(1)
if mode in ("stubborn", "silent"):
    if mode == "stubborn":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print(f"Step 10: 0.2 [{1000 // steps}%]", flush=True)
    time.sleep(60)
    sys.exit(1)
if mode == "oom":
    print("CUDA out of memory. Tried to allocate 2.00 GiB", flush=True)
    sys.exit(134)
# A model to continue from says how many steps it has, as OpenSplat's does
done = 0
if "--resume" in args:
    with open(args[args.index("--resume") + 1], "rb") as f:
        done = int(f.read().split(b"iteration ")[1].split()[0])
    print("Loading PLY...", flush=True)
for step in range(done + 10, steps + 1, 10):
    print(f"Step {step}: 0.2 [{step * 100 // steps}%]", flush=True)
    if mode == "slow":
        time.sleep(30)
# A real model's header and two splats (tests/opensplat-model.ply), at its steps; its arguments after the data
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "opensplat-model.ply"), "rb") as f:
    model = f.read().replace(b"at iteration 500\n", f"at iteration {max(steps, done)}\n".encode(), 1)
with open(output, "wb") as f:
    f.write(model + b"\nargs " + " ".join(args[1:]).encode())
print(f"Wrote {output}", flush=True)
