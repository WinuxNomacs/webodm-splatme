#!/bin/bash
# timed.sh <work folder> <name> <docker run args...>: runs a trainer's container with <work>/data at /data (read
# only) and <work>/out at /out, logs to out/<name>.log, appends seconds and peak GPU MiB above idle to
# out/timings.txt. The GPU is sampled once a second.
set -u
W=$1; name=$2; shift 2
base=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -lms 1000 > "$W/out/$name.mem" &
mon=$!
start=$(date +%s)
docker run --rm --gpus all --user "$(id -u):$(id -g)" -v "$W/data:/data:ro" -v "$W/out:/out" "$@" > "$W/out/$name.log" 2>&1
rc=$?
end=$(date +%s)
kill "$mon"; wait "$mon" 2>/dev/null
peak=$(sort -n "$W/out/$name.mem" | tail -1)
echo "$name exit=$rc seconds=$((end-start)) idle_mib=$base peak_mib=$peak above_idle_mib=$((peak-base))" | tee -a "$W/out/timings.txt"
