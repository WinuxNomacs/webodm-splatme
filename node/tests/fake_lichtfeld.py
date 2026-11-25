#!/usr/bin/env python3
"""Stands in for LichtFeld Studio (headless) in the service's tests: its arguments and its output as
lichtfeld-output.txt holds it (through a terminal: colours, the progress bar redrawn with carriage returns), no
training. Without a terminal it refuses, so a node that gives it a pipe fails its tests.

FAKE_TRAINER (environment): "fail" ends as lichtfeld-failure.txt does, "oom" with its out-of-memory error,
"nomodel" exits 0 without writing a model, "slow" waits between steps; "stubborn" ignores SIGTERM and "silent" stops
printing (both give up after 60 s).
"""

import os
import signal
import sys
import time

args = sys.argv[1:]
mode = os.environ.get("FAKE_TRAINER", "")


def say(text, end="\r\n"):
    sys.stdout.write(text + end)
    sys.stdout.flush()


def info(text):
    say(f"[02:00:00.000] \x1b[32m[info]\x1b[0m trainer.cpp:1  {text}")


if not sys.stdout.isatty():
    print("no terminal: LichtFeld's progress would not print", flush=True)
    sys.exit(3)
dataset, out = args[args.index("-d") + 1], args[args.index("-o") + 1]
steps = int(args[args.index("-i") + 1])
home = os.environ.get("HOME", "")
os.makedirs(os.path.join(home, ".lichtfeld", "logs"), exist_ok=True)  # what it writes on every run
with open(os.path.join(home, ".lichtfeld", "logs", "lichtfeld.log"), "a") as f:
    f.write("run\n")
info("LichtFeld Studio")
info(f"Loading dataset from: {dataset}")
if mode == "fail" or not os.path.isfile(os.path.join(dataset, "sparse", "0", "cameras.bin")):
    say(f"[02:00:00.000] \x1b[31m[error]\x1b[0m application.cpp:1170  Failed to load training data: Failed to load "
        f"dataset: [Path not found] {dataset}")
    sys.exit(1)
if mode == "oom":
    say("[02:00:00.000] \x1b[31m[error]\x1b[0m memory_pressure.cpp:141  CUDA out of memory: failed to allocate 2.0 GiB")
    sys.exit(1)
os.makedirs(out, exist_ok=True)
if mode in ("stubborn", "silent"):
    if mode == "stubborn":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    say(f"\x1b[36m\x1b[1m\rTraining [█░ ] 50% [00m:01s<00m:01s] 10/{steps} | Loss: 0.2 | Splats: 5", end="")
    time.sleep(60)
    sys.exit(1)
say("\x1b[36m\x1b[1m\rTraining [                                        ] 33% [00m:00s<00m:00s] Initializing...", end="")
for step in range(10, steps + 1, 10):
    say(f"\x1b[36m\x1b[1m\rTraining [██░ ] 66% [00m:29s<00m:15s] {step}/{steps} | Loss: 0.4471 | "
        f"Splats: 405004 ", end="")
    if mode == "slow":
        time.sleep(30)
say("")
info(f"Saving final project at iteration {steps}...")
with open(os.path.join(out, "project.licht"), "wb") as f:
    f.write(b"a project")
say("✓ Training completed in 1.0s (avg 1.9 iter/s)")
if mode != "nomodel":
    model = os.path.join(out, f"splat_{steps}.ply")
    with open(model, "wb") as f:
        f.write(f'ply\ncomment lichtfeld_provenance {{"iteration":{steps}}}\n'.encode())
        f.write(" ".join(args).encode())
    info(f"Exported final splat: {model}")
