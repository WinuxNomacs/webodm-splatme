# Upcoming changes

A WebODM plugin that automates training Gaussian splats for a task. WebODM (3.3 and later) already exports a
task's training data and imports, converts and displays a trained model (a task's **⋯ → Splats** dialog on the
Dashboard, `app/splats.py`, `app/api/splats.py`, `worker/tasks.py`); the training in between is done by hand in
other software. The plugin does that step.

## Phases (current and upcoming)

**Up next**

1. Orchestration: export, train, import, with job state, cancel and errors.

**Then**

2. UI: the "Train Splats" button on a task, progress, warnings, settings.

**Later**

3. Automation: train when a task completes, retrain after reprocessing.
4. Denser starting cloud: more of the task's point cloud as the gaussians' starting points.
5. Continue training: more steps for a task already trained, without starting over.
6. Masks: pixels the training ignores.
7. Thermal tasks: DJI thermal TIFFs converted to radiometric JPEGs, when DJI Thermal Analyzer is installed.
8. Native Windows app: a trainer run as a local program.
9. Docs and first release.

**Done**

- Splat node (2026-11-14): `node/` (`splatnode.py`, the HTTP job service; `Dockerfile`, OpenSplat v1.2.2 on CUDA
  12.8 in a 10.6 GB image; `compose.yml`), its tests (`node/tests`, against a stand-in trainer), and the node in
  the dev stack (`sm-splat-node`, `dev/compose.splatnode.yml`). Checked with real jobs on the GPU: 2,000 steps
  in 49 s with live progress, the result downloaded, a running job canceled (the queued one then started), and a
  restart mid-job (the job is reported failed, with the reason).

- Spike (2026-11-14): the trainer is **OpenSplat**. Results under "Spike results" below.

- Scaffold (2026-11-14): the plugin `splatme/` (id `splatme`, name "SplatMe"; it registers and does nothing),
  its test (`splatme/tests/test_splatme.py`), the dev stack (`dev/webodm.sh`, `dev/compose.yml`,
  `dev/compose.gpu.yml`: http://localhost:8008, containers `sm-*`), Ruff, the `test` skill, `CLAUDE.md`,
  `README.md`. Jest, ESLint and Playwright arrive with the first script (the UI phase).

## Decisions (2026-11-14)

- **Training runs in a companion GPU container** ("splat node") the user starts beside WebODM with one extra
  compose file, as the NodeODX processing node is. The plugin reaches it over HTTP at an address set in the
  plugin's settings. No change to WebODM is needed: the plugin does not start the container (WebODM's containers
  have no Docker socket), it only talks to it. The container is not in the plugin's zip; it is an image and a
  compose file this repo publishes.
- **The trainer is OpenSplat** (https://github.com/WebODM/OpenSplat, AGPL-3.0), chosen by the spike over Brush
  and nerfstudio.
- **Training starts from a button** on a completed task; automatic training on completion comes later (phase 3),
  as a setting that is off by default.
- **First release: Docker installs of WebODM 4.0.0 only** (`webodmMinVersion` 4.0.0, Python 3.14). The native
  Windows app is phase 8. 3.3.2 is not supported (its splat code is the same, so it could be added).
- **The node's address is a plugin setting, not one of WebODM's Processing Nodes** (Administration → Processing
  Nodes). A node listed there must speak NodeODX's API, is offered in the New Task form's "Processing Node"
  list and is picked automatically for ordinary tasks when its queue is the shortest
  (`ProcessingNode.find_best_available_node` does not look at the engine): a splat node there would be sent
  photos to process. The setting holds a host, a port and a token, so the node can be on another GPU machine.
  Listing it under Processing Nodes later needs a change to WebODM (skip nodes by engine), to propose then.
- **Datasets go to the node over HTTP**, as WebODM sends photos to NodeODX: the node does not have to be on
  WebODM's machine.
- **Training uses the task's results, not only its photos.** WebODM's export (`prepare_export`) already carries
  the structure-from-motion results: each photo's solved position and rotation (`shots.geojson`), the calibrated
  cameras with their lens distortion (`cameras.json`) and the dense georeferenced point cloud
  (`georeferenced_model.laz`) sampled to about 125,000 points, which the gaussians start from. No trainer run
  redoes the alignment. What more to use is phases 4 to 6.
- **The service in the splat node is written in Python**, standard library only.
- **Thermal tasks are a later phase** (7): TIFFs converted to radiometric JPEGs with the DJI thermal SDK that the
  DJI Thermal Analyzer plugin has, available only when that plugin is installed too.
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

## Spike results (2026-11-14)

Machine: RTX 5060 Laptop GPU (8 GB), Docker under WSL2. Task: "South Whitehall Drive" on the :8002 stack (220
JPEGs of 4032x3024, exported at 1600 px, 126,513 points sampled from the dense point cloud; 209 photos straight down and 11 oblique, so the
splat itself is poor). The other five tasks there are thermal TIFFs, which WebODM's export refuses.

- **OpenSplat v1.2.2: works.** Built from source in a container on `nvidia/cuda:12.8.1-devel-ubuntu24.04` with
  libtorch 2.7.1+cu128 and `CMAKE_CUDA_ARCHITECTURES="75;80;86;89;120"` (its own Dockerfile stops at CUDA 12.4,
  too old for an RTX 50). It has no released binaries.
  - It takes WebODM's training zip as its input (`opensplat training.zip -n <steps> -o <file>`), keeps the scene's
    coordinates unless given `--center`, undistorts the images itself, and writes `.ply`, `.splat`, `.spz` or
    `.rad`: with `.rad` there is nothing to convert.
  - 2,000 steps: 54 s, 3.0 GB of GPU memory. 7,000 steps: 192 s, 4.4 GB, 281,885 gaussians. The default is
    30,000 steps; `--max-gaussians` (default 5 million) bounds memory.
  - Progress is a line every 10 steps, `Step 1990: 0.189796 [99%]`, then `Wrote <file>`. It extracts the zip
    beside it (`opensplat-<id>/`), which is left behind and must be deleted.
  - Alignment: the gaussians' extents match the exported points', and in the task's 3D view the splat
    sits where the point cloud does. Its `.ply`, uploaded in the task's Splats dialog, converts with WebODM's
    `splat-tools`.
  - The build image is 27 GB (CUDA's development image, libtorch and the build): the splat node needs a second
    stage with only what the program runs with.
- **Brush v0.3.0: no GPU in Docker under WSL2.** It has released binaries (42 MB, Apache-2.0) and reads COLMAP
  data, but renders through Vulkan, and a container under WSL2 has only the CPU's Vulkan (llvmpipe): 200 steps
  produced nothing in two minutes. Not tried on a Linux host, where NVIDIA's Vulkan driver is available. A
  candidate for the native Windows app (phase 8).
- **nerfstudio: not tried.** Its image (`dromni/nerfstudio:1.1.5`, 13 GB, November 2024) has PyTorch 2.1.2 for
  CUDA 11.8, which does not support an RTX 50; it would have to be rebuilt, and its poses are centred, oriented
  and scaled by default.

Found on the way:

- A task whose images are not JPEG (the thermal tasks' TIFFs) cannot be exported: the plugin says so before
  starting. Converting them is phase 7.
- A headless browser draws the 3D view in software, slowly: a screenshot of it needs a small window and a long
  timeout (800x520, four minutes).

## Phase details

### The splat node's API (built)

`node/splatnode.py`, with `Authorization: Bearer <token>`: `GET /info` (trainer, GPU, queue, the options and
their ranges), `POST /jobs?steps=&max_gaussians=&sh_degree=&downscale=` (body: the training zip; answers the job),
`GET /jobs/<id>` (`state`: queued, running, completed, failed, canceled; `progress`, `step`, `position` in the
queue, `error`, `size`), `GET /jobs/<id>/log?offset=`, `GET /jobs/<id>/result` (`model.rad`),
`POST /jobs/<id>/cancel`, `DELETE /jobs/<id>`. One job trains at a time; a finished job is deleted after 48
hours; the node's queue is the GPU's queue. Not done: a smaller image (10.6 GB, most of it libtorch's CUDA
libraries, some of which OpenSplat may not load).

### 1. Orchestration

In the plugin: a start view that checks the task (completed, has `cameras.json`, `shots.geojson`, the point
cloud and its images) and starts one worker job, which exports with `splats.prepare_export()`, sends the
dataset to the node, polls it, fetches the result (`.rad`, so nothing to convert) and writes `assets/splats/model.rad`.
Status, cancel and log views. State per task in the data store. Errors that say what to do (node unreachable,
out of GPU memory, task compacted).

### 2. UI

On the Dashboard, in a completed task's expanded panel: a "Train Splats" button, a dialog with the options
(quality preset, image size), progress with cancel, the log, and "View in 3D" when done. The warnings WebODM's
own dialog gives (photos all pointing straight down, missing images). A settings page: the node's address and
token, defaults. The node's state (reachable, GPU, queue).

### 3. Automation

A per-user setting, off by default: train every task that qualifies when it completes (`task_completed`), and
again after a task is reprocessed. To check first: that a plugin's receiver is connected in the worker process,
where the signal is sent.

### 4. Denser starting cloud

`prepare_export` samples the point cloud to about 125,000 points, a fixed number. The plugin writes
`points3D.bin` itself from the same `.laz` with more points (the cloud has millions), so training starts closer
to the surface and needs fewer steps. Costs GPU memory. An option, with its default chosen by measuring on an
RGB task with oblique photos ("HomerunObliqueRGB" on the dev stack): quality and time against the number of
points, and how far the gaussians end up from the task's point cloud.

### 5. Continue training

OpenSplat's `--resume <ply>` continues from an earlier model. The node keeps (or the plugin stores) the `.ply`
beside the `.rad`; "Continue Training" adds steps to it. Reprocessing the task discards it.

### 6. Masks

OpenSplat applies a `masks/` folder (white keeps, black ignores) named after the images. A task's results hold
no masks (ODX's sky and background masks are not kept), so the plugin makes them. Open: which masks (sky, an
area drawn by the user, moving objects) and how they are made.

Not usable from a task: the mesh, the DSM and depth maps. OpenSplat v1.2.2 has no depth or normal supervision,
and the task keeps no depth maps or undistorted photos (OpenSplat undistorts from the camera model itself).

### 7. Thermal tasks

WebODM's export refuses images that are not JPEG, and a thermal task's are TIFFs. With the DJI Thermal Analyzer
plugin installed, convert them to radiometric JPEGs with its DJI thermal SDK and export those; without it, the
task is refused with a message naming that plugin. To check first: how that plugin exposes the conversion, and
that the export can be given the converted images (it reads `task.get_image_path`).

### 8. Native Windows app

The same backend interface with a second implementation: the trainer as a local program the worker runs.

### 9. Docs and first release

README, docs, the zip, the splat node's image, the entry for WebODM-Plugins' `directory.json`.
