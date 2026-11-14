#!/usr/bin/env bash
# The WebODM checkout in dev mode, with this repo's plugin mounted (see dev/compose.yml).
#   [SM_GPU=auto|1|0] dev/webodm.sh up | down | logs [service] | ps | <any docker compose command>
# WebODM 4.0.0: ignored/WebODM, port 8008, livereload 35737, containers sm-webapp, sm-worker, sm-db, sm-broker,
# sm-node-odx-1, sm-splat-node (with a GPU; port 3108), project and volumes webodm-splatme.
# The processing node uses the GPU when there is one (SM_GPU=auto, the default: an NVIDIA GPU that nvidia-smi lists
# and Docker's nvidia runtime); SM_GPU=0 runs it on the CPU, SM_GPU=1 asks for the GPU regardless.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"

# The images, pinned by digest: a tag can be pushed again, and a local `latest` tag can be another build.
# Upgrading: move ignored/WebODM to the new tag, pull its images, move the digests here, `dev/webodm.sh up`, run
# the tests.
webodm="$repo/ignored/WebODM" project=webodm-splatme port=8008 livereload=35737
export SM_PREFIX=sm
export SM_WEBAPP_IMAGE=webodm/webodm_webapp@sha256:4572838208348c189fce3bfeabd1eaa08285efd841520ff2f08460611aac14a5
export SM_DB_IMAGE=webodm/webodm_db@sha256:6d43e32ec24c388c5d5975bf6462d21abd6959af3c43d146a2473c1db4d5019c
export SM_BROKER_IMAGE=valkey/valkey@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b
export SM_NODE_IMAGE=webodm/nodeodx@sha256:f3621054cec0829ff8d94272fa4ec9138621f034135ff9a792fe309bd7d964ad
# WebODM's GPU node (webodm/nodeodx:gpu)
gpu_node_image=webodm/nodeodx@sha256:77e913d50929885678b59cf7c0d82aa04289887a025d0516737e5c0f701bedf3
case "${SM_GPU:=auto}" in
    auto) if nvidia-smi -L >/dev/null 2>&1 && docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia
          then SM_GPU=1; else SM_GPU=0; fi ;;
    0|1) ;;
    *) echo "SM_GPU: auto, 1 or 0" >&2; exit 1 ;;
esac
if [ ! -d "$webodm" ]; then
    echo "No WebODM checkout at $webodm (CLAUDE.md, Dev environment, says how to make it)" >&2; exit 1
fi
export WO_PORT="${WO_PORT:-$port}" SM_LIVERELOAD_PORT="${SM_LIVERELOAD_PORT:-$livereload}"
export WO_HOST=localhost WO_DEBUG=YES WO_DEV=YES WO_BROKER=redis://broker WO_DEFAULT_NODES=1
export WO_MEDIA_DIR=appmedia WO_DB_DIR=dbdata WO_SECRET_KEY="${WO_SECRET_KEY:-}"
# SM_PLUGIN_DIR=<empty dir> runs WebODM without the mounted plugin (to install the zip instead)
# The splat node (dev/compose.splatnode.yml, with a GPU only): built from node/ on the first `up`
export SM_REPO="$repo" SM_SPLATNODE_PORT="${SM_SPLATNODE_PORT:-3108}" SM_SPLATNODE_TOKEN="${SM_SPLATNODE_TOKEN:-dev-token}"
export SM_PLUGIN_DIR="${SM_PLUGIN_DIR:-$repo/splatme}"

compose=(docker compose -p "$project" --project-directory "$webodm"
         -f "$webodm/docker-compose.yml" -f "$webodm/docker-compose.dev.yml" -f "$repo/dev/compose.yml")
if [ "$SM_GPU" = 1 ]; then
    export SM_NODE_IMAGE="$gpu_node_image"
    compose+=(-f "$repo/dev/compose.gpu.yml" -f "$repo/dev/compose.splatnode.yml")
fi

case "${1:-}" in
    # New anonymous volumes: the dev compose keeps the image's venv in one, which a new image must not reuse
    up) shift; exec "${compose[@]}" up -d --renew-anon-volumes "$@" ;;
    down) shift; exec "${compose[@]}" down --remove-orphans "$@" ;;
    logs) shift; exec "${compose[@]}" logs -f --tail 100 "$@" ;;
    "") sed -n '2,7p' "$0"; exit 1 ;;
    *) exec "${compose[@]}" "$@" ;;
esac
