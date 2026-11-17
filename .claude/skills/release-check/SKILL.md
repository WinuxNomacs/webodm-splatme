---
name: release-check
description: The upgrade rehearsal before tagging a SplatMe release - the last published release installed on a throwaway production WebODM, upgraded to the new zip and node as Getting Started says, data and trainings checked. Use after the release review's fixes and before the tag, and again whenever shipped code changed since the last check.
---

# Release check

An existing user's upgrade, rehearsed on a throwaway production WebODM 4.0.0 beside the dev stack, which is never
touched. Run it on the zip that will be released: if `splatme/`, `node/` or the docs change after it, run it again.
It needs no login from the user (the throwaway gets its own administrator) and pushes nothing. About half an hour
of the GPU and the machine. Keep every file in the session's scratchpad (`$S` below).

## 1. What is tested

- `dist/splatme-X.Y.Z.zip` from `dev/build-zip.sh HEAD X.Y.Z`, and its SHA-256.
- A node image from that commit's `node/`, tagged `splatme-node:relcheck` (`docker build -t splatme-node:relcheck
  node`; never rebuild `splatme-node:dev`, the dev stack's). Confirm it holds the commit's `splatnode.py`
  (`docker run --rm --entrypoint cat splatme-node:relcheck /opt/splatnode/splatnode.py | cmp - node/splatnode.py`).
- The last release's zip and `splatnode.sh`, downloaded from its GitHub release (the zip's SHA-256 compared with the
  release's `.sha256`).

## 2. The throwaway WebODM

`$S/zipcheck/scratch.yml`, over `ignored/WebODM`'s own `docker-compose.yml`, with the digests `dev/webodm.sh` pins:

```yaml
services:
  db: {image: "webodm/webodm_db@<SM_DB_IMAGE's digest>", container_name: smz-db}
  broker: {image: "valkey/valkey@<SM_BROKER_IMAGE's digest>", container_name: smz-broker}
  webapp:
    image: "webodm/webodm_webapp@<SM_WEBAPP_IMAGE's digest>"
    container_name: smz-webapp
    ports: !override ["8018:8000/tcp"]
  worker: {image: "webodm/webodm_webapp@<SM_WEBAPP_IMAGE's digest>", container_name: smz-worker}
```

`$S/zipcheck/stack.sh` (`up -d`, `restart webapp worker`, `down -v`, any compose command):

```bash
export WO_PORT=8018 WO_HOST=localhost WO_DEBUG=NO WO_DEV=NO WO_BROKER=redis://broker WO_MEDIA_DIR=appmedia \
  WO_DB_DIR=dbdata WO_SECRET_KEY=scratch-check-only
exec docker compose -p sm-scratch --project-directory <repo>/ignored/WebODM \
  -f <repo>/ignored/WebODM/docker-compose.yml -f $S/zipcheck/scratch.yml "$@"
```

Up, then its administrator: `docker exec -e DJANGO_SUPERUSER_PASSWORD=scratch-admin -e
DJANGO_SUPERUSER_USERNAME=scratchadmin -e DJANGO_SUPERUSER_EMAIL=scratch@example.invalid -w /webodm smz-webapp
python manage.py createsuperuser --noinput`. It has no processing node, so its Dashboard shows WebODM's welcome
page instead of projects (WebODM's behaviour, not a failure).

Headless Playwright scripts in `scripts/` beside this file (run with `NODE_PATH=<repo>/node_modules node
.claude/skills/release-check/scripts/<script>`), each logged in as `scratchadmin` (`login.js`):

- **install.js**: Administration → Plugins (`/admin/app/plugin/`), `setInputFiles("#plugin-upload-file", zip)`,
  then the messages and SplatMe's row.
- **upgrade.js**: the same over an installed SplatMe (refused: "already exist"), then the row's
  `a.button:has(i.fa-trash)` (accept the dialog), then the upload again. The row still shows the old version until
  WebODM restarts.
- **api.js** `<method> <path> [json]`: SplatMe's API (`/api/plugins/splatme/`) with the session's CSRF token.
- **pages.js** `<folder>`: SplatMe → Tasks, Administration → SplatMe, letting only GET and HEAD through (and the
  login POST), console errors read, screenshots into the folder.

A record's state, straight from the database: `PluginDatum.objects.get(key='splatme::job::<task id>')` in `docker
exec -w /webodm smz-webapp python manage.py shell -c ...`; all SplatMe's rows: `key__startswith='splatme::'` (print
`<token>` for the token's value).

## 3. A task to train

A copy of a completed JPEG task from the dev stack, read only there: `docker exec sm-webapp tar -C
/webodm/app/media/project/<p>/task/<id> -cf - --exclude=assets/splats --exclude=data . | tar -xf -` into
`$S/.../task`, a `data/backup.json` written from the task's fields (`name`, `processing_time`, `options`,
`created_at`, `public`, `resize_to`, `potree_scene`, `tags`, `crop`, `version`), zipped (stored, ZIP64), then
`POST /api/projects/<new project>/tasks/import` with `-F file=@backup.zip` on the throwaway. Wait for status 40;
delete the zip.

## 4. The steps

1. Install the last release (install.js), restart webapp and worker, import the task.
2. The last release's node: its own `splatnode.sh install --webodm smz-webapp` with `SPLATNODE_DIR=$S/.../splatnode
   SPLATNODE_PROJECT=smz-splatnode`, which pulls the published image from ghcr.io and connects SplatMe.
3. On the last release: a Draft training to completion; the defaults, the administrator's own options and the task's
   automatic training saved through its API; a longer training started.
4. Records saved, then the plugin upgraded **while that training runs on the node** (upgrade.js, restart webapp
   and worker). The old worker job dies with the restart: the record stands still past the 60 s limit, then one `GET
   revive` (what every signed-in page asks) must take it over, and it completes and imports.
5. Every setting the same as before; the saved token still the node's (`SPLATNODE_TOKEN` in its `.env`).
6. Continue on the old node (no `ref` is sent to a node older than `REF_VERSION`).
7. `splatnode.sh upgrade` from the commit, while a training runs and with no terminal: must refuse naming
   `--force`, exit 1, nothing changed. Run it with `setsid -w bash node/splatnode.sh ... </dev/null` (no
   controlling terminal; without `-w`, `setsid` returns before the script and its exit code is lost).
8. Once idle, the upgrade, with a `docker` wrapper first on `PATH` standing in for the pull of the unpublished
   image: on `docker compose ... pull` (the last argument), it runs `docker tag splatme-node:relcheck
   ghcr.io/winuxnomacs/splatme-node:latest` instead; everything else goes to `/usr/bin/docker`. Expect "runs
   version <new> (it was <old>). Its jobs and token are kept. The previous image was deleted."
9. On the new release and node: Continue again (the node's `GET /jobs?ref=<run>` finds the job); WebODM's worker
   restarted mid-training, then pages.js, whose revive takes it over; the import; the pages without console errors.
10. The webapp's, the worker's and the node's logs: no error or traceback (the webapp logs each takeover).

## 5. Cleaning up

`splatnode.sh uninstall --yes` (same `SPLATNODE_DIR` and `SPLATNODE_PROJECT`), `docker image rm
ghcr.io/winuxnomacs/splatme-node:latest splatme-node:relcheck` (only if neither was there before the check),
`stack.sh down -v`, the task copy and the node's folder (`rm -rf -- "${S:?}/..."`). Then confirm: no `smz-`
container, no `sm-scratch` or `smz` volume or network, the `sm-` containers as they were.

## 6. The record

In `upcoming-changes.md`, under "Release check of X.Y.Z": the zip's commit and SHA-256, each step's result as
observed (messages quoted), what failed or could not be checked, and the cleanup.
