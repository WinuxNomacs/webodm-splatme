#!/usr/bin/env python3
"""Stands in for OpenSplat in the service's tests: the same arguments and output, no training.

FAKE_TRAINER (environment): "fail" ends with an error, "oom" with CUDA's out-of-memory message, "slow" waits
a long time between steps (for the tests that cancel).
"""

import os
import sys
import time

if "--version" in sys.argv:
    print("9.9.9")
    sys.exit(0)

args = sys.argv[1:]
dataset, output = args[0], args[args.index("-o") + 1]
steps = int(args[args.index("--num-iters") + 1])
mode = os.environ.get("FAKE_TRAINER", "")

os.mkdir(os.path.join(os.path.dirname(dataset), "opensplat-extracted"))
print("Using CUDA", flush=True)
if mode == "fail":
    print("No cameras see any sparse points", flush=True)
    sys.exit(1)
if mode == "oom":
    print("CUDA out of memory. Tried to allocate 2.00 GiB", flush=True)
    sys.exit(134)
for step in range(10, steps + 1, 10):
    print(f"Step {step}: 0.2 [{step * 100 // steps}%]", flush=True)
    if mode == "slow":
        time.sleep(30)
with open(output, "wb") as f:
    f.write(b"RAD " + " ".join(args[1:]).encode())
print(f"Wrote {output}", flush=True)
