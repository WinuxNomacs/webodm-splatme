---
name: trainer-benchmark
description: Train a dev task's splats with a trainer (OpenSplat, LichtFeld Studio) outside WebODM, timed, and score the model on held-out photos; the numbers go to dev/benchmarks/check-task.json for the presets. Use when comparing trainers or settings, or measuring steps and times for a preset.
---

# Trainer benchmark

Each run trains on the same photos SplatMe would send, holds out every 8th photo by name, and scores the model on
those with `LichtFeld-Studio eval` (PSNR, SSIM, LPIPS), whatever trained it. The numbers, never the photos, are
kept in `dev/benchmarks/check-task.json` (photos numbered in name order). Everything else stays in the
scratchpad and is deleted afterwards.

## 1. Before

- The images: the LichtFeld node's, `splatme-node-lichtfeld:dev` (`docker build -f node/lichtfeld.Dockerfile -t
  splatme-node-lichtfeld:dev node`, about 12 minutes of compiling the first time), whose program trains and scores
  (`--entrypoint /opt/lichtfeld/bin/LichtFeld-Studio`), and the OpenSplat node's, `splatme-node:dev` (the dev
  stack builds it). Both run as the image's user (1000), so `W` must be writable by it.
- The task: the check task (memory has its id). It is only read.
- A timed run needs a quiet machine: list the GPU's users (`nvidia-smi`), the running stacks (`docker ps`) and the
  load (`uptime`), and tell the user. Stopping anything of theirs is their call. One run at a time.

## 2. The dataset

`W` is a folder in the scratchpad, with `data/`, `out/` and `lfshome/` (LichtFeld keeps its LPIPS weights there:
downloaded on its first eval).

```bash
SM_GPU=0 dev/webodm.sh up          # the worker only; the GPU stays free
docker cp .claude/skills/trainer-benchmark/make_dataset.py sm-worker:/tmp/make_dataset.py
docker exec -e TASK_ID=<id> -e IMAGE_SIZE=1600 -w /webodm sm-worker bash -c 'python manage.py shell < /tmp/make_dataset.py'
docker cp sm-worker:/tmp/benchmark/dataset.zip $W/data/
docker exec sm-worker rm -rf /tmp/benchmark /tmp/make_dataset.py
python3 -I .claude/skills/trainer-benchmark/split.py $W/data && rm $W/data/dataset.zip
dev/webodm.sh down
```

`data/full` has every photo (LichtFeld holds out its own with `--eval --test-every 8`); `data/train` has the
others (for OpenSplat, which trains on all it is given). `held_out.txt` names the held-out photos.

## 3. Train

`timed.sh` runs the container, logs to `out/<name>.log` and appends the seconds and peak GPU memory to
`out/timings.txt`. Run it in the background.

```bash
T=.claude/skills/trainer-benchmark/timed.sh
# LichtFeld (its defaults plus what is being measured, e.g. --max-cap 300000)
$T $W lichtfeld-30k-cap300k -t -e HOME=/home/lfs -v $W/lfshome:/home/lfs \
  --entrypoint /opt/lichtfeld/bin/LichtFeld-Studio splatme-node-lichtfeld:dev \
  --headless -d /data/full -o /out/lichtfeld-30k-cap300k --export ply --undistort --eval --test-every 8 \
  -i 30000 --max-cap 300000 --log-level info
# OpenSplat, the node's trainer
$T $W opensplat-30k --entrypoint /opt/opensplat/opensplat splatme-node:dev /data/train -o /out/opensplat-30k.ply -n 30000
```

OpenSplat's growth options are its own flags after the dataset (`--loss-thresh 0.05 --densify-until 27000
--refine-every 250`; `ignored/OpenSplat/opensplat.cpp` lists them). A sweep names each run after what it changes
(`os-lt005-gu27k`) and runs them one after another in one background script, so the GPU is never shared.

LichtFeld's `--eval` evaluates at steps 7,000 and 30,000 (minutes each, included in the seconds), and its last
evaluation is the model with its exposure correction applied. `-t` makes its progress print. Its first run builds
its GPU code (about 2 minutes, counted in the seconds): add `-e CUDA_CACHE_PATH=/out/cuda-cache` to every run of a
series so only the first pays it, and say so in the run's notes.

## 4. Score and record

The exported model as a viewer shows it (no exposure correction), with the same settings for every trainer:

```bash
docker run --rm -t --gpus all --user $(id -u):$(id -g) -e HOME=/home/lfs -v $W/lfshome:/home/lfs \
  -v $W/data:/data:ro -v $W/out:/out --entrypoint /opt/lichtfeld/bin/LichtFeld-Studio splatme-node-lichtfeld:dev \
  eval /out/<model>.ply -d /data/full --undistort --eval --test-every 8 -o /out/eval-<name>
```

Another dataset (Brighton Beach, a sweep's quick runs) keeps its own results file: start it with `about` and
`dataset` as in `check-task.json` and pass `--results dev/benchmarks/<dataset>.json`. For OpenSplat, `--growth`
records the count after every growth round and final prune, from the run's log.

Then add the run to the results (the timings line, the model's Gaussians and size, the mean and per-photo
scores; `--corrected` takes LichtFeld's own last evaluation as a second entry):

```bash
python3 .claude/skills/trainer-benchmark/record.py --work $W --name <name> --ply out/<model>.ply \
  --eval out/eval-<name> --trainer lichtfeld --options '{"steps": 30000, "max_cap": 300000}' \
  [--corrected out/<run folder>] --notes "..."
```

## 5. After

Delete `$W` (models, renders, photos). Record what the numbers say in `upcoming-changes.md` and commit
`dev/benchmarks/check-task.json`.
