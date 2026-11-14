# Upcoming changes

A WebODM plugin that automates training Gaussian splats for a task. WebODM (3.3 and later) already exports a
task's training data and imports, converts and displays a trained model (a task's **⋯ → Splats** dialog on the
Dashboard, `app/splats.py`, `app/api/splats.py`, `worker/tasks.py`); the training in between is done by hand in
other software. The plugin does that step.

## Phases (current and upcoming)

**Up next**

1. Scaffold: the plugin folder, the dev stack, tests, this repo's own `CLAUDE.md`.
2. Spike: train one real task by hand with each candidate trainer and choose one.

**Then**

3. Splat node: the trainer container and its job API.
4. Orchestration: export, train, import, with job state, cancel and errors.
5. UI: the "Train Splats" button on a task, progress, warnings, settings.

**Later**

6. Automation: train when a task completes, retrain after reprocessing, a queue for the GPU.
7. Native Windows app: a trainer run as a local program.
8. Docs and first release.

**Done**

(nothing yet)

## Decisions (2026-11-14)

- **Training runs in a companion GPU container** ("splat node") the user starts beside WebODM with one extra
  compose file, as the NodeODX processing node is. The plugin reaches it over HTTP at an address set in the
  plugin's settings. No change to WebODM is needed: the plugin does not start the container (WebODM's containers
  have no Docker socket), it only talks to it. The container is not in the plugin's zip; it is an image and a
  compose file this repo publishes.
- **The trainer is chosen in the spike** (phase 2): OpenSplat, Brush and nerfstudio (splatfacto, its Docker
  image) are the candidates.
- **Training starts from a button** on a completed task; automatic training on completion comes later (phase 6),
  as a setting that is off by default.
- **First release: Docker installs of WebODM 4.0.0 only** (`webodmMinVersion` 4.0.0, Python 3.14). The native
  Windows app is phase 7. 3.3.2 is not supported (its splat code is the same, so it could be added).
- **Plugin guidelines first.** A pull request to WebODM only when a feature needs it and the user approves that
  change: small, targeted, with only critical tests.

## What the design must respect

- WebODM's webapp and worker containers have no GPU, no torch and no Docker socket; ODX has no splat option.
- `run_function_async` (`app/plugins/worker.py`) sends only the function's own source to the worker, takes
  JSON arguments, has no time limit and uses one of the worker's slots while it runs. The plugin's job in the
  worker therefore only exports, hands over, polls and imports; the heavy work is in the splat node.
- A folder in WebODM's temporary directory (`MEDIA_TMP`) older than 24 hours is deleted hourly, even mid-job:
  work in the plugin's persistent folder (`get_persistent_path`).
- The export is in the task's projected coordinates minus its offset, and the 3D view moves the model back by
  that offset. A trainer that re-centres, rotates or rescales the scene must have that undone, or the splat will
  not sit on the point cloud.
- Reprocessing a task deletes its `assets/` folder, the splat model included.
- A compacted task has no images; only JPEG images and non-spherical cameras export; the import needs the
  task's point cloud.
- A plugin cannot add an asset type (`available_assets` is rebuilt from `Task.ASSETS_MAP`). The plugin writes the
  existing one: `assets/splats/model.rad`, then `update_available_assets_field()`, `update_size()`, `save()`,
  as `process_splats` does. The 3D view, the download and the share links then work unchanged.
- There is no hook for a task's **⋯** menu. `Dashboard.addTaskActionButton` puts a button in the task's expanded
  panel, is called once when the panel opens and not again when the task changes.
- `/api/workers/check|get|cancel/<id>` need no login (the id is the only secret): the plugin's own views check
  the project's permissions (`TaskView.get_and_check_task`, and `check_project_perms(..., ("change_project",))`
  to start, cancel or delete).
- Job state that outlives the page goes in the plugin's data store, read by a status view the page polls
  (as the cesiumion and dronedb plugins do).

## Phase details

### 1. Scaffold

- The plugin folder (its name is the plugin's id and the zip's root), `manifest.json` (`experimental`, AGPL-3.0,
  `webodmMinVersion` 4.0.0), an empty `plugin.py` that registers.
- `dev/webodm.sh`: WebODM 4.0.0 in dev mode with the plugin mounted, on a free port (8002, 8005 and 8006 are
  taken by other plugins' stacks), its own container names, project and volumes, images pinned by digest, the
  GPU processing node. Taken from webodm-tweakui's.
- Tests and checks: Django tests in the dev stack, Jest, ESLint, Ruff; the `test` and `live-check` skills.
- `CLAUDE.md` rewritten for this repo (the present one is TweakUI's); `.gitignore` covers `ignored/`.
- Open: the plugin's name and id.

### 2. Spike

By hand, outside the plugin, on a real task with oblique photos: download the training zip from the task's
Splats dialog, train with each candidate in a GPU container, upload the result in the same dialog, and look at
it in the 3D view over the point cloud.

For each candidate, record:

- Does the model line up with the point cloud, and which options keep the scene's frame? (nerfstudio centres,
  orients and scales the poses by default.)
- Does it train on this machine's GPU (RTX 5060 Laptop, 8 GB), and how long for which image size and step count?
- Does it run from a command line with progress that can be read, and can it be stopped?
- Which output formats, and does `splat-tools` convert them?
- How large is the image and how is it built or obtained? (OpenSplat: compiled with libtorch; Brush: prebuilt
  programs, to confirm; nerfstudio: its published image, whose PyTorch must support this GPU.)
- Its licence.

Result: the trainer, its options, and the splat node's base image. Nothing else is built before this passes.

### 3. Splat node

A container with the chosen trainer and a small HTTP service: create a job from a training zip and options,
report state, progress and log, cancel, download the result, delete. One job at a time on the GPU, the others
queued. A token for access. A compose file that adds it to a WebODM install.

Open: datasets sent over HTTP (the node can be another machine) or read from WebODM's media volume mounted
into the node (no copy, same machine only); what the service is written in.

### 4. Orchestration

In the plugin: a start view that checks the task (completed, has `cameras.json`, `shots.geojson`, the point
cloud and its images) and starts one worker job, which exports with `splats.prepare_export()`, sends the
dataset to the node, polls it, fetches the result, runs `splat-tools` and writes `assets/splats/model.rad`.
Status, cancel and log views. State per task in the data store. Errors that say what to do (node unreachable,
out of GPU memory, task compacted).

### 5. UI

On the Dashboard, in a completed task's expanded panel: a "Train Splats" button, a dialog with the options
(quality preset, image size), progress with cancel, the log, and "View in 3D" when done. The warnings WebODM's
own dialog gives (photos all pointing straight down, missing images). A settings page: the node's address and
token, defaults. The node's state (reachable, GPU, queue).

### 6. Automation

A per-user setting, off by default: train every task that qualifies when it completes (`task_completed`), and
again after a task is reprocessed. To check first: that a plugin's receiver is connected in the worker process,
where the signal is sent.

### 7. Native Windows app

The same backend interface with a second implementation: the trainer as a local program the worker runs.

### 8. Docs and first release

README, docs, the zip, the splat node's image, the entry for WebODM-Plugins' `directory.json`.
