#!/usr/bin/env bash
# The release check's steps (SKILL.md, section 4) in one run, on a throwaway WebODM beside the dev stack:
#   RC_DIR=<scratch folder> RC_OLD=0.4.0 RC_ZIP=dist/splatme-0.5.0.zip [RC_WEBAPP=<webapp image@digest>] \
#     .claude/skills/release-check/scripts/rehearse.sh run
#   RC_DIR=<same folder> .claude/skills/release-check/scripts/rehearse.sh clean
# Needs splatme-node:relcheck built from the commit's node/ first (SKILL.md, section 1), the dev stack running (the
# task is copied from it, read only) and no other throwaway (port 8018, containers smz-*). RC_WEBAPP defaults to the
# webapp dev/webodm.sh pins (WebODM 4.0.0). It prints what each step observed, for the record; it stops at the first
# step that fails. clean removes everything it made and puts back the tag ghcr.io/winuxnomacs/splatme-node:latest
# had (the upgrade's stand-in moves it).
set -euo pipefail
cd "$(dirname "$0")/../../../.."
REPO="$PWD"
SCRIPTS="$REPO/.claude/skills/release-check/scripts"
: "${RC_DIR:?RC_DIR: the scratch folder}"
mkdir -p "$RC_DIR"
RC_DIR="$(cd "$RC_DIR" && pwd)"
TASK_ID="${RC_TASK_ID:-2b3f2ea4-7f08-4632-a681-22530dd9e0ea}"  # Brighton Beach, 18 photos
TASK_PATH="${RC_TASK_PATH:-/webodm/app/media/project/5/task/$TASK_ID}"
LATEST=ghcr.io/winuxnomacs/splatme-node:latest
NODE_ENV=(SPLATNODE_DIR="$RC_DIR/splatnode" SPLATNODE_PROJECT=smz-splatnode)
pins() { sed -n "s/^export $1=//p" "$REPO/dev/webodm.sh"; }

step() { printf '\n## %s\n' "$*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }
stack() { "$RC_DIR/stack.sh" "$@"; }
api() { NODE_PATH="$REPO/node_modules" node "$SCRIPTS/api.js" "$@"; }
js() { NODE_PATH="$REPO/node_modules" node "$SCRIPTS/$1" "${@:2}"; }
# A job record straight from the database: state progress status, updated N s ago, its node
rec() {
    docker exec -w /webodm smz-webapp python manage.py shell -c "
import time
from app.models import PluginDatum
d=PluginDatum.objects.get(key='splatme::job::$1').json_value
print(d.get('state'),d.get('progress'),repr(d.get('status'))[:60],'updated %.0fs ago'%(time.time()-(d.get('updated') or 0)),'node=',d.get('node'))" 2>/dev/null | tail -1
}
wait_done() {  # until the task's training has finished; prints its record
    local r=""
    for _ in $(seq 120); do
        r="$(rec "$1")"
        case "$r" in completed*|failed*|canceled*|cancelled*) echo "  $r"; return 0 ;; esac
        sleep 10
    done
    fail "the training of $1 did not finish: $r"
}
wait_training() {  # until the task's training has passed step 0 on the node
    for _ in $(seq 60); do rec "$1" | grep -q '^training [1-9]' && return 0; sleep 5; done
    fail "the training of $1 did not start: $(rec "$1")"
}
wait_web() { for _ in $(seq 90); do curl -fs -o /dev/null http://localhost:8018/login/ && return 0; sleep 5; done; fail "WebODM did not answer"; }
restart_web() { stack restart "$@" >/dev/null 2>&1; wait_web; }
completed() { [[ "$(rec "$1")" == completed* ]] || fail "$2: $(rec "$1")"; }
settings() {
    api GET nodes | sed 's/"token":"[^"]*"/"token":"[REDACTED]"/g'
    api GET automation
    api GET automation/shared
    api GET "task/$UNDER/auto"
    docker exec -i -w /webodm smz-webapp python manage.py shell -c "
import sys
from app.models import PluginDatum
want = sys.stdin.read().strip()
for key in ('nodes', 'node_url', 'node_token'):
    d = PluginDatum.objects.filter(key='splatme::' + key).first()
    if d is None:
        continue
    value = d.json_value if d.json_value is not None else d.string_value
    if key == 'nodes':
        print('  nodes:', [(n['id'], n['name'], n['url'], n.get('named')) for n in value], '| token is the node\'s:', bool(want) and value[0]['token'] == want)
    elif key == 'node_url':
        print('  node_url:', value)
    else:
        print('  node_token is the node\'s:', bool(want) and value == want)" < <(sed -n 's/^SPLATNODE_TOKEN=//p' "$RC_DIR/splatnode/.env") 2>/dev/null | grep '^  '
}

cmd_run() {
    : "${RC_OLD:?RC_OLD: the last release, such as 0.4.0}" "${RC_ZIP:?RC_ZIP: the new zip}"
    local zip webapp
    zip="$(cd "$(dirname "$RC_ZIP")" && pwd)/$(basename "$RC_ZIP")"
    webapp="${RC_WEBAPP:-$(pins SM_WEBAPP_IMAGE)}"
    [ -z "$(docker ps -aq -f name='^smz-')" ] || fail "a throwaway (smz-*) is already there: clean it first"
    docker image inspect splatme-node:relcheck >/dev/null 2>&1 || fail "build splatme-node:relcheck first"
    docker run --rm --entrypoint cat splatme-node:relcheck /opt/splatnode/splatnode.py | cmp -s - node/splatnode.py \
        || fail "splatme-node:relcheck does not hold node/splatnode.py: build it again"
    docker image inspect -f '{{.Id}}' "$LATEST" > "$RC_DIR/latest-before" 2>/dev/null || : > "$RC_DIR/latest-before"

    step "1. The throwaway WebODM ($webapp), SplatMe $RC_OLD, two copies of the task"
    cat > "$RC_DIR/scratch.yml" <<EOF
services:
  db: {image: "$(pins SM_DB_IMAGE)", container_name: smz-db}
  broker: {image: "$(pins SM_BROKER_IMAGE)", container_name: smz-broker}
  webapp:
    image: "$webapp"
    container_name: smz-webapp
    ports: !override ["8018:8000/tcp"]
  worker: {image: "$webapp", container_name: smz-worker}
EOF
    cat > "$RC_DIR/stack.sh" <<EOF
#!/usr/bin/env bash
export WO_PORT=8018 WO_HOST=localhost WO_DEBUG=NO WO_DEV=NO WO_BROKER=redis://broker WO_MEDIA_DIR=appmedia \\
  WO_DB_DIR=dbdata WO_SECRET_KEY=scratch-check-only
exec docker compose -p sm-scratch --project-directory "$REPO/ignored/WebODM" \\
  -f "$REPO/ignored/WebODM/docker-compose.yml" -f "$RC_DIR/scratch.yml" "\$@"
EOF
    chmod +x "$RC_DIR/stack.sh"
    stack up -d >/dev/null 2>&1
    wait_web
    echo "  WebODM $(docker exec smz-webapp python -c 'import json; print(json.load(open("/webodm/package.json"))["version"])')"
    docker exec -e DJANGO_SUPERUSER_PASSWORD=scratch-admin -e DJANGO_SUPERUSER_USERNAME=scratchadmin \
        -e DJANGO_SUPERUSER_EMAIL=scratch@example.invalid -w /webodm smz-webapp python manage.py createsuperuser --noinput >/dev/null 2>&1
    mkdir -p "$RC_DIR/old"
    (cd "$RC_DIR/old" && rm -f -- * && gh release download "v$RC_OLD" -R WinuxNomacs/webodm-splatme >/dev/null \
        && sha256sum -c "splatme-$RC_OLD.zip.sha256") | sed 's/^/  /'
    js install.js "$RC_DIR/old/splatme-$RC_OLD.zip" | sed 's/^/  /'
    restart_web webapp worker
    rm -rf -- "${RC_DIR:?}/task" && mkdir -p "$RC_DIR/task/data"
    docker exec sm-webapp tar -C "$TASK_PATH" -cf - --exclude=assets/splats --exclude=data . | tar -C "$RC_DIR/task" -xf -
    docker exec -w /webodm sm-webapp python manage.py shell -c "
import json
from datetime import timezone
from django.conf import settings
from app.models import Task
t = Task.objects.get(id='$TASK_ID')
print('BACKUP' + json.dumps({'name': t.name, 'processing_time': t.processing_time, 'options': t.options,
    'created_at': t.created_at.astimezone(timezone.utc).timestamp(), 'public': t.public, 'resize_to': t.resize_to,
    'potree_scene': t.potree_scene, 'tags': t.tags, 'crop': t.crop, 'version': settings.VERSION}))" 2>/dev/null \
        | sed -n 's/^BACKUP//p' > "$RC_DIR/task/data/backup.json"
    [ -s "$RC_DIR/task/data/backup.json" ] || fail "the task's backup.json is empty"
    python3 -I - "$RC_DIR/task" "$RC_DIR/backup.zip" <<'EOF'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
    for root, _, files in os.walk(src):
        for name in files:
            path = os.path.join(root, name)
            z.write(path, os.path.relpath(path, src))
EOF
    local jwt project status
    jwt="$(curl -s -X POST -d username=scratchadmin -d password=scratch-admin http://localhost:8018/api/token-auth/ | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
    project="$(curl -s -H "Authorization: JWT $jwt" -X POST -d name=Check http://localhost:8018/api/projects/ | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
    IDLE="$(curl -s -H "Authorization: JWT $jwt" -F file=@"$RC_DIR/backup.zip" "http://localhost:8018/api/projects/$project/tasks/import" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
    UNDER="$(curl -s -H "Authorization: JWT $jwt" -F file=@"$RC_DIR/backup.zip" "http://localhost:8018/api/projects/$project/tasks/import" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
    printf '%s\n%s\n' "$IDLE" "$UNDER" > "$RC_DIR/tasks.txt"
    for _ in $(seq 90); do
        status="$(for t in "$IDLE" "$UNDER"; do curl -s -H "Authorization: JWT $jwt" "http://localhost:8018/api/projects/$project/tasks/$t/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'; done | tr '\n' ' ')"
        [ "$status" = "40 40 " ] && break
        sleep 5
    done
    [ "$status" = "40 40 " ] || fail "the imports did not complete: $status"
    rm -f "$RC_DIR/backup.zip"
    echo "  imported: idle $IDLE, upgraded under $UNDER"

    step "2. The node of $RC_OLD, by its own splatnode.sh"
    (cd "$RC_DIR" && env "${NODE_ENV[@]}" setsid -w bash old/splatnode.sh install --webodm smz-webapp </dev/null 2>&1) \
        | { grep -E 'runs|trains on|has this node' || true; } | sed 's/^/  /'

    step "3. On $RC_OLD: a training to completion, the settings, a browser's cache, a longer training"
    api POST "task/$IDLE/train" '{"steps":1500,"image_size":800}' | cut -c1-40
    api POST automation/shared '{"steps":4000,"image_size":1200,"ignore_sky":true}'
    api POST automation '{"steps":2500,"image_size":1000,"crop":false}'
    api POST "task/$UNDER/auto" '{"enabled":true,"steps":3500,"image_size":900}'
    wait_done "$IDLE"; completed "$IDLE" "the first training"
    js cache.js "$RC_DIR/profile"
    api POST "task/$UNDER/train" '{"steps":12000,"image_size":1600}' | cut -c1-40
    wait_training "$UNDER"; echo "  $(rec "$UNDER")"

    step "4. The plugin upgraded to $(basename "$zip") while that training runs; the takeover"
    js upgrade.js "$zip" | sed 's/^/  /'
    restart_web webapp worker
    sleep 90
    echo "  after the restart: $(rec "$UNDER")"
    api GET revive
    sleep 15
    echo "  after revive: $(rec "$UNDER")"
    wait_done "$UNDER"; completed "$UNDER" "the training upgraded under"

    step "5. The settings and the node after the upgrade"
    settings

    step "5b. The browser that comes back (the same profile)"
    js cache.js "$RC_DIR/profile"

    step "6. Continue on the old node"
    api POST "task/$IDLE/train" '{"resume":true,"steps":1000,"node":"default"}' | cut -c1-40
    wait_done "$IDLE"; completed "$IDLE" "Continue on the old node"

    step "7. The node's upgrade while a training runs, with no terminal: refused"
    api POST "task/$UNDER/train" '{"steps":5000,"image_size":1600}' | cut -c1-40
    for _ in $(seq 60); do rec "$UNDER" | grep -q '^training' && break; sleep 5; done
    md5sum "$RC_DIR"/splatnode/* > "$RC_DIR/node-files"
    local code=0 said
    said="$(env "${NODE_ENV[@]}" setsid -w bash node/splatnode.sh upgrade </dev/null 2>&1)" || code=$?
    echo "  $said"
    md5sum "$RC_DIR"/splatnode/* | cmp -s - "$RC_DIR/node-files" || fail "the refused upgrade changed the node's files"
    [ "$code" = 1 ] || fail "the refused upgrade exited $code, not 1"
    echo "  exit $code, its files unchanged"
    wait_done "$UNDER"

    step "8. The node's upgrade once idle (the unpublished image tagged by a docker stand-in)"
    mkdir -p "$RC_DIR/bin"
    cat > "$RC_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = compose ] && [ "${@: -1}" = pull ]; then
    echo "(release check: tagging splatme-node:relcheck as latest instead of pulling)"
    exec /usr/bin/docker tag splatme-node:relcheck ghcr.io/winuxnomacs/splatme-node:latest
fi
exec /usr/bin/docker "$@"
EOF
    chmod +x "$RC_DIR/bin/docker"
    PATH="$RC_DIR/bin:$PATH" env "${NODE_ENV[@]}" setsid -w bash node/splatnode.sh upgrade </dev/null 2>&1 | tail -3 | sed 's/^/  /'
    grep -v TOKEN "$RC_DIR/splatnode/.env" | grep '^SPLATNODE' | sed 's/^/  /'

    step "9. On the new release and node: Continue, the node busy, a second training queued, the worker restarted"
    api POST "task/$UNDER/train" '{"resume":true,"steps":6000,"node":"default"}' | cut -c1-40
    wait_training "$UNDER"
    for _ in 1 2 3; do
        echo "  nodes while it trains: $(api GET nodes | grep -o '"busy":[a-z]*\|"error":[^,]*' | tr '\n' ' ')"
        sleep 10
    done
    echo "  check of the other task: $(api GET "task/$IDLE/check" | grep -o '"node_error":[^,]*')"
    api POST "task/$IDLE/train" '{"steps":1000,"image_size":800}' | cut -c1-40
    sleep 3
    echo "  $(rec "$IDLE")"
    restart_web worker
    sleep 85
    echo "  after the worker's restart: $(rec "$UNDER")"
    mkdir -p "$RC_DIR/pages"
    js pages.js "$RC_DIR/pages" | sed 's/^/  /'
    wait_done "$UNDER"; completed "$UNDER" "the training taken over on the new node"
    wait_done "$IDLE"; completed "$IDLE" "the queued training"

    step "10. Errors in the logs"
    for c in smz-webapp smz-worker smz-splatnode; do
        echo "  $c:"
        docker logs "$c" 2>&1 | grep -iE 'traceback|error|exception|lost its worker|critical|hung up' \
            | grep -vE 'asset size|auth\.0007|If there are no errors' | sort | uniq -c | sed 's/^/    /' || true
    done
    echo
    echo "Done. Screenshots: $RC_DIR/pages. Then: RC_DIR=$RC_DIR $0 clean"
}

cmd_clean() {
    # WebODM first: the node's uninstall refuses while the throwaway's SplatMe records a training under way
    [ -x "$RC_DIR/stack.sh" ] && "$RC_DIR/stack.sh" down -v >/dev/null 2>&1 || true
    if [ -f "$RC_DIR/splatnode/.env" ]; then
        env "${NODE_ENV[@]}" setsid -w bash node/splatnode.sh uninstall --yes </dev/null 2>&1 | tail -1 || true
    fi
    if docker ps -aq -f name='^smz-splatnode$' | grep -q .; then
        docker compose -p smz-splatnode down -v >/dev/null 2>&1 || true  # its own uninstall failed: by its project
    fi
    local before
    before="$(cat "$RC_DIR/latest-before" 2>/dev/null || true)"
    if [ -n "$before" ]; then
        docker tag "$before" "$LATEST" && echo "$LATEST is $before again"
    else
        docker image rm "$LATEST" >/dev/null 2>&1 || true
    fi
    # Again: WebODM's network is left while the node, which joined it, is still there
    [ -x "$RC_DIR/stack.sh" ] && "$RC_DIR/stack.sh" down -v >/dev/null 2>&1 || true
    rm -rf -- "${RC_DIR:?}/splatnode" "${RC_DIR:?}/task" "${RC_DIR:?}/profile" "${RC_DIR:?}/pages" "${RC_DIR:?}/old" "${RC_DIR:?}/bin"
    rm -f -- "${RC_DIR:?}"/scratch.yml "${RC_DIR:?}"/stack.sh "${RC_DIR:?}"/tasks.txt "${RC_DIR:?}"/node-files "${RC_DIR:?}"/latest-before "${RC_DIR:?}"/backup.zip
    echo "left: $(docker ps -aq -f name='^smz-' | wc -l) smz- containers, $(docker volume ls -q | grep -c 'sm-scratch\|smz' || true) volumes, $(docker network ls --format '{{.Name}}' | grep -c 'sm-scratch\|smz' || true) networks"
    echo "splatme-node:relcheck is kept: docker image rm splatme-node:relcheck"
}

case "${1:-}" in
    run) cmd_run ;;
    clean) cmd_clean ;;
    *) sed -n '2,10p' "$0"; exit 2 ;;
esac
