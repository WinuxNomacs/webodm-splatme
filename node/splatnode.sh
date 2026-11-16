#!/usr/bin/env bash
# Installs, upgrades and uninstalls SplatMe's splat node: the GPU container that trains WebODM tasks' splats.
#
#   splatnode.sh install [--webodm <container> | --standalone] [--port <port>]
#   splatnode.sh upgrade | status | connect [--webodm <container>] | uninstall [--yes]
#
# Or without a checkout:
#   curl -fsSL https://github.com/WinuxNomacs/webodm-splatme/releases/latest/download/splatnode.sh | bash -s install
#
# install: checks Docker, Compose and the GPU, writes a compose file and a token to $SPLATNODE_DIR, pulls the image
#   and starts it. When WebODM runs on this machine (its webapp container is found, or named with --webodm), the
#   node joins WebODM's Docker network, listens on this machine only, and SplatMe's settings get its address and
#   token; otherwise (or with --standalone) it listens on every address, and the address and token are printed to
#   enter on SplatMe's page in WebODM's Administration.
#   A failed install is undone, so it can be run again.
# upgrade: pulls the newest image, writes the compose file again and restarts the node, then deletes the previous
#   image; its jobs, token and port stay.
# connect: gives SplatMe the node's address and token again (after installing SplatMe, or reinstalling WebODM);
#   when WebODM's webapp is on another network than the node (--webodm, or a reinstalled WebODM), the node moves
#   to it.
# uninstall: stops and removes the node and its folder; asks before deleting its jobs' data and the image, and
#   before removing the node from SplatMe's settings (--yes says yes to all).
#
# Settings (environment): SPLATNODE_DIR (~/splatnode), SPLATNODE_IMAGE (the published image, latest),
# SPLATNODE_PROJECT (the Compose project and container name, splatnode). SPLATNODE_IMAGE may name a local image,
# which is then not pulled.
set -euo pipefail

DIR="${SPLATNODE_DIR:-$HOME/splatnode}"
IMAGE="${SPLATNODE_IMAGE:-ghcr.io/winuxnomacs/splatme-node:latest}"
PROJECT="${SPLATNODE_PROJECT:-splatnode}"
ALIAS="splat-node"  # the node's name on WebODM's network
# How to run this script again, for the messages: its path, or the curl command when it was piped to bash
SELF="$0"
[ -f "$SELF" ] || SELF="curl -fsSL https://github.com/WinuxNomacs/webodm-splatme/releases/latest/download/splatnode.sh | bash -s --"
INNER_PORT=3100
INSTALLING=0  # 1 while an install can still be undone
KEPT_JOBS=0  # 1 when the jobs' volume was there before the install (an uninstall kept it)

say() { printf '%s\n' "$*"; }
fail() { printf 'splatnode: %s\n' "$*" >&2; exit 1; }
# A question answered from the terminal (not stdin, which is the script when piped to bash); no terminal: no
yes_to() {
    local answer=""
    if [ "${ASSUME_YES:-}" = 1 ]; then return 0; fi
    if [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then
        printf '%s [y/N] ' "$1" > /dev/tty
        read -r answer < /dev/tty || answer=""
    fi
    case "$answer" in y|Y|yes|Yes) return 0 ;; *) return 1 ;; esac
}
# Compose reads the node's settings from .env only: the same names exported in the shell would win over it
compose() {
    env -u SPLATNODE_IMAGE -u SPLATNODE_CONTAINER -u SPLATNODE_TOKEN -u SPLATNODE_PORT -u SPLATNODE_BIND \
        -u SPLATNODE_KEEP_HOURS -u SPLATNODE_WEBODM_NETWORK \
        docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/compose.yml" "$@"
}
env_value() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null | head -n 1 || true; }  # nothing when there is no .env
# A local image is one built here: a name without a registry, or one no registry has. The published image is always
# pulled, so a registry that does not answer is an error rather than an upgrade that did nothing.
local_image() {
    case "$IMAGE" in
        ghcr.io/winuxnomacs/*) false ;;
        */*) [ -n "$(docker image ls -q "$IMAGE")" ] && ! docker manifest inspect "$IMAGE" >/dev/null 2>&1 ;;
        *) true ;;
    esac
}
image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
PULLED=0  # 1 when this run downloaded the image, which a failed GPU check then deletes

check_docker() {
    command -v docker >/dev/null || fail "Docker is not installed: https://docs.docker.com/engine/install/"
    docker info >/dev/null 2>&1 || fail "Docker does not answer: start it, or run this as a user who may use it (the docker group)."
    docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 (docker compose) is not installed: https://docs.docker.com/compose/install/"
}

check_gpu() {
    say "Checking that containers can use the GPU"
    local gpus
    if ! gpus="$(docker run --rm --gpus all --entrypoint nvidia-smi "$IMAGE" -L 2>&1)"; then
        say "$gpus" >&2
        if [ "$PULLED" = 1 ]; then docker image rm "$IMAGE" >/dev/null 2>&1 && say "The image just downloaded was deleted." >&2 || true; fi
        fail "A container cannot use the GPU. The node needs an NVIDIA GPU, its driver, and the NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    fi
    say "$gpus"
}

pull_image() {
    if local_image; then
        say "Using the local image $IMAGE"
    else
        say "Downloading $IMAGE (several GB the first time)"
        [ -n "$(image_id "$IMAGE")" ] || PULLED=1
        docker pull "$IMAGE" || fail "Could not download $IMAGE."
    fi
}

# The running WebODM webapp containers, one a line: name and networks (Compose's service webapp of WebODM's image;
# docker ps shows an image pinned by digest only by its ID, so each container's own settings are read)
webapps() {
    local id
    for id in $(docker ps -q); do
        docker inspect -f '{{.Name}} {{.Config.Image}} {{index .Config.Labels "com.docker.compose.service"}} {{range $name, $_ := .NetworkSettings.Networks}}{{$name}},{{end}}' "$id"
    done | awk '$2 ~ /webodm_webapp/ && $3 == "webapp" {sub(/^\//, "", $1); print $1, $4}'
}

# The webapp container on a network, or nothing
webapp_on() { webapps | awk -v n="$1" 'index("," $2, "," n ",") {print $1; exit}'; }

# WebODM's webapp container: the one named, or the only one running; nothing when there is none, a failure when
# there are several and none is named
find_webodm() {
    local named="$1" found
    if [ -n "$named" ]; then
        docker inspect "$named" >/dev/null 2>&1 || fail "There is no container $named."
        say "$named"; return
    fi
    found="$(webapps | awk '{print $1}')"
    case "$(printf '%s' "$found" | grep -c .)" in
        0) ;;
        1) say "$found" ;;
        *) fail "Several WebODMs run here ($(echo $found)). Name the one to use: --webodm <container>, or --standalone." ;;
    esac
}

networks_of() { docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$1"; }

# The network to join: one WebODM's worker shares with its webapp (the worker runs the trainings; a webapp behind a
# reverse proxy is on the proxy's network too), WebODM's Compose default first
webodm_network() {
    local nets project worker net
    nets="$(networks_of "$1")"
    project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$1")"
    worker="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=worker" | head -n 1)"
    if [ -n "$project" ] && [ -n "$worker" ]; then
        local shared=""
        for net in $(networks_of "$worker"); do
            case " $nets " in *" $net "*) shared="$shared $net" ;; esac
        done
        [ -z "$shared" ] || nets="$shared"
    fi
    for net in $nets; do
        if [ "$net" = "${project}_default" ]; then say "$net"; return; fi
    done
    for net in $nets; do say "$net"; return; done
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# A failed install leaves nothing that would stop it from being run again
undo_install() {
    local code=$?
    if [ "$code" != 0 ] && [ "$INSTALLING" = 1 ]; then
        say "The install did not finish: it was undone." >&2
        # The jobs' volume too, unless an earlier uninstall kept it
        if [ "$KEPT_JOBS" = 1 ]; then compose down >/dev/null 2>&1 || true; else compose down -v >/dev/null 2>&1 || true; fi
        rm -f -- "${DIR:?}/compose.yml" "${DIR:?}/.env"
        rmdir -- "$DIR" 2>/dev/null || true
    fi
}

write_files() {
    local network="$1" port="$2" token="$3" bind keep
    keep="$(env_value SPLATNODE_KEEP_HOURS)"
    mkdir -p "$DIR"
    # On WebODM's network: this machine only. Otherwise every address, or what .env says (127.0.0.1: behind a proxy)
    if [ -n "$network" ]; then bind="127.0.0.1:"; else bind="$(env_value SPLATNODE_BIND)"; fi
    umask 077
    cat > "$DIR/.env" <<EOF
# The splat node's settings, read by compose.yml. The token is a secret: anyone who has it can use the GPU.
SPLATNODE_IMAGE=$IMAGE
SPLATNODE_CONTAINER=$PROJECT
SPLATNODE_TOKEN=$token
SPLATNODE_PORT=$port
SPLATNODE_BIND=$bind
SPLATNODE_KEEP_HOURS=${keep:-48}
SPLATNODE_WEBODM_NETWORK=$network
EOF
    umask 022
    {
        cat <<'EOF'
# SplatMe's splat node, written by splatnode.sh (its settings are in .env). Upgrade: splatnode.sh upgrade.
services:
  splat-node:
    image: ${SPLATNODE_IMAGE}
    container_name: ${SPLATNODE_CONTAINER}
    ports:
      - "${SPLATNODE_BIND}${SPLATNODE_PORT}:3100"
    environment:
      SPLATNODE_TOKEN: ${SPLATNODE_TOKEN:?}
      SPLATNODE_KEEP_HOURS: ${SPLATNODE_KEEP_HOURS:-48}
    volumes:
      - jobs:/var/splatnode
    restart: unless-stopped
    stop_grace_period: 30s
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
EOF
        if [ -n "$network" ]; then
            cat <<EOF
    networks:
      default:
      webodm:
        aliases: [$ALIAS]
networks:
  webodm:
    external: true
    name: \${SPLATNODE_WEBODM_NETWORK}
EOF
        fi
        cat <<'EOF'
volumes:
  jobs:
EOF
    } > "$DIR/compose.yml"
}

wait_healthy() {
    local port="$1" i
    for i in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then return 0; fi
        sleep 2
    done
    compose logs --tail 30 >&2 || true
    fail "The node did not answer on port $port."
}

node_version() {
    curl -fsS -H "Authorization: Bearer $(env_value SPLATNODE_TOKEN)" "http://127.0.0.1:$(env_value SPLATNODE_PORT)/info" 2>/dev/null \
        | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' || true  # nothing when the node does not answer
}

# SplatMe's settings in WebODM get the node's address and token, through WebODM's own manage.py (the token passed
# in the environment, not on a command line). 0: saved; 3: SplatMe is not installed in that WebODM.
save_in_splatme() {
    local webapp="$1" url="$2" token="$3"
    SPLATNODE_URL="$url" SPLATNODE_TOKEN="$token" docker exec -e SPLATNODE_URL -e SPLATNODE_TOKEN -w /webodm "$webapp" \
        python manage.py shell -c '
import importlib, os, sys
from app.plugins.functions import get_plugin_by_name
plugin = get_plugin_by_name("splatme", only_active=False)
if plugin is None:
    sys.exit(3)
training = importlib.import_module(plugin.__module__.rsplit(".", 1)[0] + ".training")
training.set_node(os.environ["SPLATNODE_URL"], os.environ["SPLATNODE_TOKEN"])
' >/dev/null 2>&1
}

print_settings() {
    local host
    # The address this machine reaches others from (hostname -I can list Docker's bridges first)
    host="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
    [ -n "$host" ] || host="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -n "$host" ] || host="<this machine's address>"
    say ""
    say "Enter these on SplatMe's page in WebODM (Administration > SplatMe), then press Test Connection:"
    say "  Address: http://$host:$(env_value SPLATNODE_PORT)"
    say "  Token:   $(env_value SPLATNODE_TOKEN)"
}

connect() {
    local webapp="$1" network wanted
    network="$(env_value SPLATNODE_WEBODM_NETWORK)"
    if [ -z "$webapp" ]; then
        if [ -z "$network" ]; then
            say "This node is not on a WebODM's network (installed --standalone, or no WebODM was found)."
            say "To connect it to a WebODM on this machine: $SELF connect --webodm <its webapp container>"
            print_settings; return
        fi
        webapp="$(webapp_on "$network")"
        # WebODM reinstalled under another name: the one running now
        [ -n "$webapp" ] || webapp="$(find_webodm "")"
        [ -n "$webapp" ] || fail "WebODM's webapp container is not running: start WebODM, then run: $SELF connect"
    fi
    # The node moves to the network of the WebODM it serves, or the worker could not reach it
    wanted="$(webodm_network "$webapp")"
    [ -n "$wanted" ] || fail "$webapp is on no Docker network."
    if [ "$wanted" != "$network" ]; then
        say "Moving the node to $webapp's network $wanted"
        IMAGE="$(env_value SPLATNODE_IMAGE)"
        write_files "$wanted" "$(env_value SPLATNODE_PORT)" "$(env_value SPLATNODE_TOKEN)"
        compose up -d
        wait_healthy "$(env_value SPLATNODE_PORT)"
    fi
    if save_in_splatme "$webapp" "http://$ALIAS:$INNER_PORT" "$(env_value SPLATNODE_TOKEN)"; then
        say "SplatMe in WebODM ($webapp) now trains on this node: http://$ALIAS:$INNER_PORT"
    else
        local code=$?
        if [ "$code" = 3 ]; then
            say "SplatMe is not installed in this WebODM yet. Install it (Administration > Plugins), restart WebODM, then run: $SELF connect"
        else
            fail "Could not save the node in SplatMe's settings ($webapp)."
        fi
    fi
}

cmd_install() {
    local webodm="" standalone=0 port=3100
    while [ $# -gt 0 ]; do
        case "$1" in
            --webodm) webodm="${2:?--webodm needs a container name}"; shift 2 ;;
            --standalone) standalone=1; shift ;;
            --port) port="${2:?--port needs a number}"; shift 2 ;;
            *) fail "install: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] && fail "A splat node is already installed in $DIR: use upgrade, or uninstall first."
    case "$port" in ''|*[!0-9]*) fail "--port needs a number." ;; esac
    port_in_use "$port" && fail "Port $port is already in use on this machine: choose another with --port."
    check_docker
    pull_image
    check_gpu

    local webapp="" network=""
    if [ "$standalone" = 0 ]; then
        webapp="$(find_webodm "$webodm")"
        if [ -n "$webapp" ]; then
            network="$(webodm_network "$webapp")"
            say "WebODM found: $webapp (network $network)"
        else
            say "No WebODM runs on this machine: the node listens on every address, for a WebODM elsewhere."
        fi
    fi
    local token
    token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    if docker volume inspect "${PROJECT}_jobs" >/dev/null 2>&1; then KEPT_JOBS=1; fi
    INSTALLING=1
    trap undo_install EXIT
    write_files "$network" "$port" "$token"
    compose up -d
    wait_healthy "$port"
    INSTALLING=0
    say "The splat node $(node_version) runs (folder $DIR)."
    if [ -n "$webapp" ]; then connect "$webapp"; else print_settings; fi
    say ""
    say "Upgrade: $SELF upgrade    Uninstall: $SELF uninstall"
}

cmd_upgrade() {
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    check_docker
    local before old
    before="$(node_version)"
    IMAGE="$(env_value SPLATNODE_IMAGE)"
    old="$(image_id "$IMAGE")"
    if local_image; then say "Using the local image $IMAGE"; else compose pull || fail "Could not download $IMAGE."; fi
    # This script's compose file, with the node's settings as they are
    write_files "$(env_value SPLATNODE_WEBODM_NETWORK)" "$(env_value SPLATNODE_PORT)" "$(env_value SPLATNODE_TOKEN)"
    compose up -d || fail "The node did not start. If WebODM was reinstalled, run: $SELF connect"
    wait_healthy "$(env_value SPLATNODE_PORT)"
    say "The splat node runs version $(node_version) (it was ${before:-not answering}). Its jobs and token are kept."
    if [ -n "$old" ] && [ "$old" != "$(image_id "$IMAGE")" ]; then
        if docker image rm "$old" >/dev/null 2>&1; then say "The previous image was deleted."; else say "The previous image is still used (by a container or another tag): kept."; fi
    fi
}

cmd_status() {
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    compose ps
    local version
    version="$(node_version)"
    if [ -n "$version" ]; then say "Answering: version $version"; else say "Not answering on port $(env_value SPLATNODE_PORT)."; fi
    local network
    network="$(env_value SPLATNODE_WEBODM_NETWORK)"
    if [ -n "$network" ]; then say "On WebODM's network $network as http://$ALIAS:$INNER_PORT"; else print_settings; fi
}

cmd_connect() {
    local webodm=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --webodm) webodm="${2:?--webodm needs a container name}"; shift 2 ;;
            *) fail "connect: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    check_docker
    connect "$webodm"
}

cmd_uninstall() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --yes) ASSUME_YES=1; shift ;;
            *) fail "uninstall: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    check_docker
    local network image
    network="$(env_value SPLATNODE_WEBODM_NETWORK)"
    image="$(env_value SPLATNODE_IMAGE)"
    if [ -n "$network" ] && yes_to "Remove this node from SplatMe's settings in WebODM?"; then
        local webapp
        webapp="$(webapp_on "$network")"
        if [ -n "$webapp" ] && save_in_splatme "$webapp" "" ""; then say "Removed from SplatMe's settings ($webapp)."
        else say "WebODM is not running or has no SplatMe: its settings were left as they are."; fi
    fi
    if yes_to "Delete the node's jobs (trained models not yet imported, logs)?"; then
        compose down -v
    else
        compose down
        say "The jobs are kept in the Docker volume ${PROJECT}_jobs."
    fi
    if yes_to "Delete the image $image (about 10 GB)?"; then
        if docker image rm "$image" >/dev/null 2>&1; then say "Image deleted."; else say "The image is in use by another container: kept."; fi
    fi
    rm -f -- "${DIR:?}/compose.yml" "${DIR:?}/.env"
    rmdir -- "$DIR" 2>/dev/null || say "$DIR has other files: left in place."
    say "The splat node is uninstalled. The splats it trained stay in their WebODM tasks."
}

case "${1:-}" in
    install) shift; cmd_install "$@" ;;
    upgrade) shift; cmd_upgrade "$@" ;;
    status) shift; cmd_status "$@" ;;
    connect) shift; cmd_connect "$@" ;;
    uninstall) shift; cmd_uninstall "$@" ;;
    *) sed -n '2,8p' "$0" 2>/dev/null || true; fail "usage: splatnode.sh install | upgrade | status | connect | uninstall" ;;
esac
