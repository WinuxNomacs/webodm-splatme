#!/usr/bin/env bash
# Installs, upgrades and uninstalls SplatMe's splat node: the GPU container that trains WebODM tasks' splats.
#
#   splatnode.sh install [--trainer opensplat|lichtfeld] [--webodm <container> | --standalone] [--port <port>]
#   splatnode.sh upgrade [--force] | status | connect [--webodm <container>] [--force] | uninstall [--yes]
#   Each takes --name <name> for another node on the same machine (a second trainer, say): see below.
#
# Or without a checkout:
#   curl -fsSL https://github.com/WinuxNomacs/webodm-splatme/releases/latest/download/splatnode.sh | bash -s install
#
# install: checks Docker, Compose and the GPU, writes a compose file and a token to $SPLATNODE_DIR, pulls the image
#   and starts it. --trainer picks the image: OpenSplat's (the default) or LichtFeld Studio's; another trainer later
#   is a new install (uninstall, then install), or a second node beside it (--name). When WebODM runs on this machine (its webapp container is found,
#   or named with --webodm), the node joins WebODM's Docker network, listens on this machine only, and SplatMe's
#   settings get its address and token; otherwise (or with --standalone) it listens on every address, and the
#   address and token are printed to enter on SplatMe's page in WebODM's Administration.
#   A failed install is undone, so it can be run again.
# upgrade: pulls the newest image, writes the compose file again and restarts the node, then deletes the previous
#   image; its jobs, token and port stay. While the node trains it asks first (the restart fails that training);
#   with no terminal to ask on it stops, unless --force.
# connect: gives SplatMe the node's address and token again (after installing SplatMe, or reinstalling WebODM);
#   when WebODM's webapp is on another network than the node (--webodm, or a reinstalled WebODM), the node moves
#   to it. A node that listened on every address then listens on this machine only: it asks first (--force: no).
# uninstall: stops and removes the node and its folder; asks before deleting its jobs' data and the image, and
#   before removing the node from SplatMe's settings (--yes says yes to all).
#
# --name <name> (lower-case letters, digits and -): a node of its own beside the first, with its own folder
#   (~/splatnode-<name>), container and Compose project (splatnode-<name>), name on WebODM's network
#   (splat-node-<name>) and port (install: the first free one from 3100 unless --port). SplatMe lists it as
#   <name>; the node installed without --name is listed under its trainer's name. Every command acts on the node
#   --name names (none: the first).
#
# Settings (environment): SPLATNODE_DIR (~/splatnode), SPLATNODE_IMAGE (the trainer's published image, latest),
# SPLATNODE_PROJECT (the Compose project and container name, splatnode). SPLATNODE_IMAGE may name a local image,
# which is then not pulled.
set -euo pipefail

# --name, wherever it is given, is taken out of the arguments before the command reads its own
NAME=""
ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --name)
            if [ $# -lt 2 ]; then printf 'splatnode: %s\n' "--name needs a name." >&2; exit 1; fi
            NAME="$2"; shift 2 ;;
        *) ARGS+=("$1"); shift ;;
    esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}
if [ -n "$NAME" ] && ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$'; then
    printf 'splatnode: %s\n' "--name is up to 31 lower-case letters, digits and -, starting with a letter or digit." >&2
    exit 1
fi
SUFFIX="${NAME:+-$NAME}"

DIR="${SPLATNODE_DIR:-$HOME/splatnode$SUFFIX}"
IMAGE="${SPLATNODE_IMAGE:-}"  # empty: the published image of the trainer chosen (install --trainer)
# Each trainer's published image
image_of() {
    case "$1" in
        opensplat) echo "ghcr.io/winuxnomacs/splatme-node:latest" ;;
        lichtfeld) echo "ghcr.io/winuxnomacs/splatme-node-lichtfeld:latest" ;;
        *) return 1 ;;
    esac
}
PROJECT="${SPLATNODE_PROJECT:-splatnode$SUFFIX}"
ALIAS="splat-node$SUFFIX"  # the node's name on WebODM's network
WITH_NAME="${NAME:+ --name $NAME}"  # this node's --name, for the commands the messages give
# How to run this script again, for the messages: its path, or the curl command when it was piped to bash
SELF="$0"
[ -f "$SELF" ] || SELF="curl -fsSL https://github.com/WinuxNomacs/webodm-splatme/releases/latest/download/splatnode.sh | bash -s --"
run_again() { printf '%s %s%s' "$SELF" "$1" "$WITH_NAME"; }
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
# Whether a question can be asked (a terminal, not stdin)
has_tty() { [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; }
# Compose reads the node's settings from .env only: the same names exported in the shell would win over it
compose() {
    env -u SPLATNODE_IMAGE -u SPLATNODE_CONTAINER -u SPLATNODE_TOKEN -u SPLATNODE_PORT -u SPLATNODE_BIND \
        -u SPLATNODE_KEEP_HOURS -u SPLATNODE_STALL_MINUTES -u SPLATNODE_WEBODM_NETWORK \
        docker compose -p "$PROJECT" --project-directory "$DIR" -f "$DIR/compose.yml" "$@"
}
env_value() { sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null | head -n 1 || true; }  # nothing when there is no .env
# A local image is one built here: a name without a registry, or one no registry has. The published image is always
# pulled, so a registry that does not answer is an error rather than an upgrade that did nothing.
local_image() {
    case "${1:-$IMAGE}" in
        ghcr.io/winuxnomacs/*) false ;;
        */*) [ -n "$(docker image ls -q "${1:-$IMAGE}")" ] && ! docker manifest inspect "${1:-$IMAGE}" >/dev/null 2>&1 ;;
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
        say "Downloading $IMAGE (the first time: up to several GB)"
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
    local network="$1" port="$2" token="$3" bind keep stall
    keep="$(env_value SPLATNODE_KEEP_HOURS)"
    stall="$(env_value SPLATNODE_STALL_MINUTES)"
    mkdir -p "$DIR"
    # On WebODM's network: this machine only. Otherwise every address, or what .env says (127.0.0.1: behind a proxy)
    if [ -n "$network" ]; then bind="127.0.0.1:"; else bind="$(env_value SPLATNODE_BIND)"; fi
    umask 077
    cat > "$DIR/.env" <<EOF
# The splat node's settings, read by compose.yml. The token is a secret: anyone who has it can use the GPU.
SPLATNODE_IMAGE=$IMAGE
# The trainer chosen at install (for status; the image decides which runs)
SPLATNODE_TRAINER_KIND=$TRAINER
SPLATNODE_CONTAINER=$PROJECT
SPLATNODE_TOKEN=$token
SPLATNODE_PORT=$port
SPLATNODE_BIND=$bind
SPLATNODE_KEEP_HOURS=${keep:-48}
# Minutes the trainer may print nothing before its job is stopped (empty: the node's default)
SPLATNODE_STALL_MINUTES=$stall
SPLATNODE_WEBODM_NETWORK=$network
EOF
    umask 022
    {
        # The service is named as the node's alias: Compose gives every network a service joins its name as an
        # alias, so two nodes' services both named splat-node would share that name on WebODM's network
        cat <<EOF
# SplatMe's splat node, written by splatnode.sh (its settings are in .env). Upgrade: $(run_again upgrade).
services:
  $ALIAS:
EOF
        cat <<'EOF'
    image: ${SPLATNODE_IMAGE}
    container_name: ${SPLATNODE_CONTAINER}
    ports:
      - "${SPLATNODE_BIND}${SPLATNODE_PORT}:3100"
    environment:
      SPLATNODE_TOKEN: ${SPLATNODE_TOKEN:?}
      SPLATNODE_KEEP_HOURS: ${SPLATNODE_KEEP_HOURS:-48}
      SPLATNODE_STALL_MINUTES: ${SPLATNODE_STALL_MINUTES:-}
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

# The node's /info, or nothing when it does not answer. The token goes to curl on its standard input, not on its
# command line, which other users of the machine can read (ps)
node_info() {
    printf 'header = "Authorization: Bearer %s"\n' "$(env_value SPLATNODE_TOKEN | sed 's/[\\"]/\\&/g')" \
        | curl -fsS -K - "http://127.0.0.1:$(env_value SPLATNODE_PORT)/info" 2>/dev/null || true
}

node_version() {
    node_info \
        | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' || true  # nothing when the node does not answer
}

# The trainer the node says it runs (its /info's trainer), or what install chose when it does not answer
node_trainer() {
    local said
    said="$(node_info \
        | sed -n 's/.*"trainer": *"\([^"]*\)".*/\1/p' || true)"
    [ -n "$said" ] || case "$(installed_trainer)" in lichtfeld) said="LichtFeld Studio" ;; *) said="OpenSplat" ;; esac
    printf '%s\n' "$said"
}

# The trainer chosen at install; a node installed before trainers could be chosen runs OpenSplat
installed_trainer() {
    local kind
    kind="$(env_value SPLATNODE_TRAINER_KIND)"
    printf '%s\n' "${kind:-opensplat}"
}

# An image's size on disk, in GB
image_size() { docker image inspect -f '{{.Size}}' "$1" 2>/dev/null | awk 'NF { printf "%.1f GB", $1 / 1e9 }' || true; }

# Whether the node trains a job now (its /info names the running job, or says null)
node_training() {
    node_info | grep -q '"running": *"'
}

# The name SplatMe lists the node under: its --name, else its trainer's
splatme_name() {
    if [ -n "$NAME" ]; then printf '%s\n' "$NAME"
    else case "$(installed_trainer)" in lichtfeld) echo "LichtFeld Studio" ;; *) echo "OpenSplat" ;; esac; fi
}

# SplatMe's settings in WebODM, through WebODM's own manage.py (the token passed in the environment, not on a command
# line). save: the node's address and token, added to SplatMe's nodes or updating its entry (found by address); a
# SplatMe before 0.5 keeps one node, which the node without --name replaces. remove: the node's entry taken out.
# 0: done; 3: SplatMe is not installed in that WebODM; 4: that SplatMe keeps one node only (--name needs 0.5);
# 5: a training is under way on the node.
splatme_settings() {
    local webapp="$1" action="$2" url="$3" token="${4:-}"
    SPLATNODE_URL="$url" SPLATNODE_TOKEN="$token" SPLATNODE_LABEL="$(splatme_name)" SPLATNODE_NAMED="${NAME:+1}" \
        SPLATNODE_ACTION="$action" docker exec -e SPLATNODE_URL -e SPLATNODE_TOKEN -e SPLATNODE_LABEL \
        -e SPLATNODE_NAMED -e SPLATNODE_ACTION -w /webodm "$webapp" python manage.py shell -c '
import importlib, os, sys
from app.plugins.functions import get_plugin_by_name
plugin = get_plugin_by_name("splatme", only_active=False)
if plugin is None:
    sys.exit(3)
training = importlib.import_module(plugin.__module__.rsplit(".", 1)[0] + ".training")
url, token, several = os.environ["SPLATNODE_URL"], os.environ["SPLATNODE_TOKEN"], hasattr(training, "connect_node")
if not several and os.environ["SPLATNODE_NAMED"]:
    sys.exit(4)
try:
    if os.environ["SPLATNODE_ACTION"] == "save":
        training.connect_node(url, token, os.environ["SPLATNODE_LABEL"]) if several else training.set_node(url, token)
    elif several:
        training.disconnect_node(url)
    else:
        training.set_node("", "")
except training.TrainingError:
    sys.exit(5)
' >/dev/null 2>&1
}

print_settings() {
    local host
    # The address this machine reaches others from (hostname -I can list Docker's bridges first)
    host="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
    [ -n "$host" ] || host="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -n "$host" ] || host="<this machine's address>"
    say ""
    say "On SplatMe's page in WebODM (Administration > SplatMe), press Add a Splat Node, enter these, then Test Connection:"
    say "  Address: http://$host:$(env_value SPLATNODE_PORT)"
    say "  Token:   $(env_value SPLATNODE_TOKEN)"
}

connect() {
    local webapp="$1" force="${2:-0}" network wanted
    network="$(env_value SPLATNODE_WEBODM_NETWORK)"
    if [ -z "$webapp" ]; then
        if [ -z "$network" ]; then
            say "This node is not on a WebODM's network (installed --standalone, or no WebODM was found)."
            say "To connect it to a WebODM on this machine: $(run_again connect) --webodm <its webapp container>"
            print_settings; return
        fi
        webapp="$(webapp_on "$network")"
        # WebODM reinstalled under another name: the one running now
        [ -n "$webapp" ] || webapp="$(find_webodm "")"
        [ -n "$webapp" ] || fail "WebODM's webapp container is not running: start WebODM, then run: $(run_again connect)"
    fi
    # The node moves to the network of the WebODM it serves, or the worker could not reach it
    wanted="$(webodm_network "$webapp")"
    [ -n "$wanted" ] || fail "$webapp is on no Docker network."
    if [ "$wanted" != "$network" ]; then
        if [ -z "$network" ] && [ "$(env_value SPLATNODE_BIND)" != "127.0.0.1:" ] && [ "$force" = 0 ]; then
            local why="On $webapp's network the node listens on this machine only: a WebODM on another machine can no longer reach it."
            if ! has_tty; then fail "$why Run again with --force to move it."; fi
            yes_to "$why Move it?" || { say "Nothing was changed."; exit 1; }
        fi
        say "Moving the node to $webapp's network $wanted"
        IMAGE="$(env_value SPLATNODE_IMAGE)"
        TRAINER="$(installed_trainer)"
        write_files "$wanted" "$(env_value SPLATNODE_PORT)" "$(env_value SPLATNODE_TOKEN)"
        compose up -d
        wait_healthy "$(env_value SPLATNODE_PORT)"
    fi
    if splatme_settings "$webapp" save "http://$ALIAS:$INNER_PORT" "$(env_value SPLATNODE_TOKEN)"; then
        say "SplatMe in WebODM ($webapp) has this node as $(splatme_name): http://$ALIAS:$INNER_PORT"
    else
        local code=$?
        case "$code" in
            3) say "SplatMe is not installed in this WebODM yet. Install it (Administration > Plugins), restart WebODM, then run: $(run_again connect)" ;;
            4) say "This WebODM's SplatMe keeps one splat node: upgrade SplatMe to 0.5 or later for a node of its own (--name), then run: $(run_again connect)" ;;
            *) fail "Could not save the node in SplatMe's settings ($webapp)." ;;
        esac
    fi
}

# The first port from 3100 that nothing on this machine listens on
free_port() {
    local port other taken=" "
    # The ports the other nodes installed here have, running or not (a stopped one would fail to start again)
    for other in "$HOME"/splatnode "$HOME"/splatnode-*; do
        [ -f "$other/.env" ] && [ "$other" != "$DIR" ] || continue
        taken="$taken$(sed -n 's/^SPLATNODE_PORT=//p' "$other/.env" | head -n 1) "
    done
    for port in $(seq 3100 3199); do
        case "$taken" in *" $port "*) continue ;; esac
        port_in_use "$port" || { say "$port"; return; }
    done
    fail "No free port from 3100 to 3199: choose one with --port."
}

cmd_install() {
    local webodm="" standalone=0 port=""
    TRAINER=opensplat
    while [ $# -gt 0 ]; do
        case "$1" in
            --trainer) TRAINER="${2:?--trainer needs opensplat or lichtfeld}"; shift 2 ;;
            --webodm) webodm="${2:?--webodm needs a container name}"; shift 2 ;;
            --standalone) standalone=1; shift ;;
            --port) port="${2:?--port needs a number}"; shift 2 ;;
            *) fail "install: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] && fail "A splat node is already installed in $DIR: use upgrade, or uninstall first (or install another with --name)."
    image_of "$TRAINER" >/dev/null || fail "--trainer is opensplat or lichtfeld, not $TRAINER."
    [ -n "$IMAGE" ] || IMAGE="$(image_of "$TRAINER")"
    if [ -z "$port" ]; then
        port="$(free_port)"
    else
        case "$port" in *[!0-9]*) fail "--port needs a number." ;; esac
        port_in_use "$port" && fail "Port $port is already in use on this machine: choose another with --port."
    fi
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
    say "The splat node $(node_version) runs with $(node_trainer) (folder $DIR)."
    if [ -n "$webapp" ]; then connect "$webapp"; else print_settings; fi
    say ""
    say "Upgrade: $(run_again upgrade)    Uninstall: $(run_again uninstall)"
}

cmd_upgrade() {
    local force=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --force) force=1; shift ;;
            *) fail "upgrade: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    check_docker
    if [ "$force" = 0 ] && node_training; then
        local why="A training runs on the node: the upgrade restarts the node and that training fails."
        if ! has_tty; then fail "$why Upgrade once it is done, or run again with --force."; fi
        yes_to "$why Upgrade now?" || { say "Nothing was changed."; exit 1; }
    fi
    local before old
    before="$(node_version)"
    IMAGE="$(env_value SPLATNODE_IMAGE)"
    TRAINER="$(installed_trainer)"
    old="$(image_id "$IMAGE")"
    if local_image; then say "Using the local image $IMAGE"; else compose pull || fail "Could not download $IMAGE."; fi
    # This script's compose file, with the node's settings as they are
    write_files "$(env_value SPLATNODE_WEBODM_NETWORK)" "$(env_value SPLATNODE_PORT)" "$(env_value SPLATNODE_TOKEN)"
    compose up -d || fail "The node did not start. If WebODM was reinstalled, run: $(run_again connect)"
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
    if [ -n "$version" ]; then
        say "Answering: version $version, trainer $(node_trainer)"
    else
        say "Not answering on port $(env_value SPLATNODE_PORT). Installed with $(node_trainer)."
        if [ -z "$(compose ps -q --status running 2>/dev/null)" ]; then
            say "It is not running. Start it with: docker compose -p $PROJECT --project-directory $DIR -f $DIR/compose.yml up -d"
        fi
    fi
    local network
    network="$(env_value SPLATNODE_WEBODM_NETWORK)"
    if [ -n "$network" ]; then say "On WebODM's network $network as http://$ALIAS:$INNER_PORT"; else print_settings; fi
    # The other nodes this script installed here (only in the default folders)
    local other
    for other in "$HOME"/splatnode "$HOME"/splatnode-*; do
        [ -f "$other/compose.yml" ] && [ "$other" != "$DIR" ] || continue
        case "$other" in "$HOME/splatnode") say "Also installed: the node without --name" ;;
            *) say "Also installed: --name ${other#"$HOME"/splatnode-}" ;; esac
    done
}

cmd_connect() {
    local webodm="" force=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --webodm) webodm="${2:?--webodm needs a container name}"; shift 2 ;;
            --force) force=1; shift ;;
            *) fail "connect: unknown option $1" ;;
        esac
    done
    [ -f "$DIR/compose.yml" ] || fail "No splat node is installed in $DIR."
    check_docker
    connect "$webodm" "$force"
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
        local webapp code=0
        webapp="$(webapp_on "$network")"
        if [ -z "$webapp" ]; then
            say "WebODM is not running: SplatMe's settings were left as they are."
        else
            splatme_settings "$webapp" remove "http://$ALIAS:$INNER_PORT" || code=$?
            case "$code" in
                0) say "Removed from SplatMe's settings ($webapp)." ;;
                5) fail "A training is under way on this node in SplatMe: stop it, or let it end, then uninstall again. Nothing was changed." ;;
                *) say "WebODM has no SplatMe, or an older one: its settings were left as they are." ;;
            esac
        fi
    fi
    if yes_to "Delete the node's jobs (trained models not yet imported, logs)?"; then
        compose down -v
    else
        compose down
        say "The jobs are kept in the Docker volume ${PROJECT}_jobs."
    fi
    local size
    size="$(image_size "$image")"
    if [ "${ASSUME_YES:-}" = 1 ] && local_image "$image"; then
        # Built here: it can't be pulled again, and a build takes long. --yes doesn't delete it unasked
        say "The image $image was built on this machine: kept. Delete it with: docker image rm $image"
    elif yes_to "Delete the image $image${size:+ ($size on disk)}?"; then
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
