# Upcoming changes

A WebODM plugin that automates training Gaussian splats for a task. WebODM (3.3 and later) already exports a
task's training data and imports, converts and displays a trained model (a task's **⋯ → Splats** dialog on the
Dashboard, `app/splats.py`, `app/api/splats.py`, `worker/tasks.py`); the training in between is done by hand in
other software. The plugin does that step.

## Phases (current and upcoming)

**Up next**

1. Continue training: more steps for a task already trained, without starting over.

**Later**

2. Masks: pixels the training ignores.
3. Thermal tasks: DJI thermal TIFFs converted to radiometric JPEGs, when DJI Thermal Analyzer is installed.
4. Native Windows app: a trainer run as a local program.
5. Docs and first release.
6. Review with the user which features would be better with small, targeted pull requests to WebODM (a SplatMe
   section in Task Options, SplatMe's row in the New Task panel), then reach out to the maintainer.

**Dropped**

- Denser starting cloud (2026-11-14, the user's decision after the measurements): more starting points gave no
  better result on the dev task at several times the training time. See "Denser starting cloud (dropped)".

**Done**

- Task Options (2026-11-14): a task's automatic training in WebODM's Edit Task Options dialog (the Options
  row's Edit button in the New Task and Edit Task panels), below `pc-quality` in the Point Cloud section,
  without a change to WebODM. `splatme/public/main.js` (the `presetDialogOptionsReady` hook),
  `OptionsButton.jsx` (the button and where the setting goes), `newTaskSettings.js` (a new task's setting, held
  on the page until WebODM creates the task), `AutoDialog.jsx` and `Dialog.jsx` (drawn inside WebODM's dialog),
  `api.py` (`automation?ranges=1`). Tests: 7 in Jest (`__tests__/newTaskSettings.test.js`), 1 in
  `test_splatme.py`. Checked in a headless browser on the dev stack: an existing task's setting saved at once
  from the dialog, kept after the dialog's own Cancel, reset, at phone width; typing in the dialog and Escape
  (which closes SplatMe's dialog only); a new task's setting kept while the panel is open, sent to the task
  WebODM creates on Start Processing, and forgotten when the panel is canceled. Not checked: a real new task
  (the creation was answered by the check itself with a task that does not exist, so that nothing was created
  or uploaded; the server then answered 404 to the setting, as it should).

- Automation (2026-11-14): a task is trained when it completes, and again after it is processed again, when its
  own setting or the administrators' default says so. `splatme/plugin.py` (the `task_completed` receiver, at
  the module's top level), `splatme/training.py` (`completed`, a task's setting `auto::<task>`, the default
  `auto_default`, `worker_listens`), `splatme/api.py` (`task/<id>/auto`, `automation`; the status carries
  `auto`), the task's panel (`TrainSplats.jsx`: the "Train Splats When Completed" line and `AutoDialog.jsx`;
  the options form shared with the Train Splats dialog is `OptionsFields.jsx`), the SplatMe page's "Automatic
  Training" section. Tests: 10 in `test_splatme.py`, 4 in Jest. Checked in a headless browser on the dev stack:
  the task's setting saved, kept through a reload, reset to the default, at phone width; the default saved on
  the SplatMe page, a wrong number refused beside the Save button, and the "not active yet" warning, which is
  true there (the stack's worker started before the receiver existed). In a worker started fresh (a second
  worker on its own queue) the receiver is connected and the signal calls it. Not checked: a real task
  completing in a restarted worker (the stack's worker was not restarted, and its one task has a model).

- UI (2026-11-14): SplatMe's part of a task's expanded panel on the Dashboard (`splatme/public/main.js`,
  `TrainSplats.jsx`, `TrainDialog.jsx`, `LogDialog.jsx`, `Dialog.jsx`, `api.js`; what they show is
  `trainingView.js`, tested by Jest in `public/__tests__`), the side menu's SplatMe page
  (`templates/settings.html`), and the views they need (`api.py`: `check`, the node's state for every user,
  trying an address without saving). Checked in a headless browser on the dev stack, on HomerunObliqueRGB
  (1,005 photos): the button, the dialog and its field errors, the page at phone width, the settings page; a
  Draft training started from the button, followed through a reload of the page into the training stage (the
  export took 3.5 minutes), its log read while it grew, then canceled, which left the task without a model as it
  was. Not checked in a browser: a training that completes ("View in 3D"), a failed one, and the page as a user
  who is not an administrator (the Django tests cover what that user is sent).

- Orchestration (2026-11-14): `splatme/training.py` (the job: export, send, follow, import; its record in the
  global data store; cancel; picking up a job that lost its worker), `splatme/node.py` (the node's API as the
  plugin uses it), `splatme/api.py` (train, status, cancel, log; the node's settings for administrators), tests
  in `splatme/tests/test_splatme.py` against a stand-in node (`tests/fake_node.py`). Checked on the dev stack
  with a task imported for the check, on the real node: 2,000 steps trained and imported in 226 s (84 s of it
  the export), a training canceled mid-way, and a worker job killed mid-training (picked up from the node's job
  after a minute, nothing exported again).

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
- **Training starts from a button** on a completed task; automatic training on completion came later (Automation, built),
  as a setting that is off by default.
- **First release: Docker installs of WebODM 4.0.0 only** (`webodmMinVersion` 4.0.0, Python 3.14). The native
  Windows app is phase 4. 3.3.2 is not supported (its splat code is the same, so it could be added).
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
  redoes the alignment. What more to use is phases 2 to 4.
- **The service in the splat node is written in Python**, standard library only.
- **Thermal tasks are a later phase** (6): TIFFs converted to radiometric JPEGs with the DJI thermal SDK that the
  DJI Thermal Analyzer plugin has, available only when that plugin is installed too.
- **Deployment is as simple and automated as it can be for a WebODM administrator.** Every design choice is
  weighed by how the plugin and the node are installed, updated and moved. What follows from it is under
  "Deployment" below.
- **The node's address and token are set by administrators, for everyone**: one node per WebODM, in the global
  data store; users never see the token.
- **Anyone who can edit a project may train its tasks** (`change_project`, as for WebODM's own splat upload).
- **Training again replaces a task's splat only when the new training succeeds.**
- **The "Train Splats" dialog offers a Quality choice and an Advanced section**: Draft (2,000 steps), Standard
  (7,000, the default), High (30,000, OpenSplat's default); Advanced, closed at first, has Steps, Image Size and
  Max Gaussians as numbers.
- **The settings are a "SplatMe" item in the side menu**, shown to every user (WebODM gives a plugin no way to
  limit a menu item): administrators get the node's address, token and "Test Connection"; other users see only
  the node's state, never its address or token.
- **JavaScript tooling is host-only and pinned**, the same set as webodm-dji-thermal: Jest, ESLint, Playwright
  in a root `package.json`. Other tooling needed along the way is proposed when it comes up.
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
  panel, is called once when the panel opens and not again when the task changes: the button's component
  follows the task itself, through the plugin's status view.
- WebODM stops listening after the first plugin's answer to a hook (`ApiFactory.js`): a button that waits for
  its script (the hook's dependency list) is dropped when another plugin answers first. `main.js` answers at
  once with a wrapper that loads the component afterwards.
- `/api/workers/check|get|cancel/<id>` need no login (the id is the only secret): the plugin's own views check
  the project's permissions (`TaskView.get_and_check_task`, and `check_project_perms(..., ("change_project",))`
  to start, cancel or delete).
- Job state that outlives the page goes in the plugin's data store, read by a status view the page polls
  (as the cesiumion and dronedb plugins do).

## Deployment (what an administrator does, and what the design owes them)

- **The plugin is one zip**, uploaded in Administration → Plugins, and updated by uploading the next zip there
  (WebODM then asks for a restart). It needs nothing else in WebODM's containers: no Python package beyond
  WebODM's own, no change to WebODM's compose files, no environment variable.
- **An update deletes the plugin's persistent folder.** An uploaded plugin lives in `media/plugins/splatme`,
  which is also what `get_persistent_path()` returns, and an update replaces that whole folder (`app/admin.py`).
  So settings and job state live only in the data stores (the database); the folder holds only a running job's
  working files, and a job that loses them (an update, a restart of the worker) picks up again from its recorded
  state or fails with a message, never stays "training" forever.
- **The node is one image and one compose file**: a published image (no half-hour build), started with one
  command, updated with `docker compose pull && docker compose up -d`. Publishing the image needs a release
  workflow, to decide in phase 5.
- **The plugin and the node are updated separately**, so each says its version (`GET /info`) and the plugin names
  the mismatch and what to update, rather than failing mid-job. The node's API changes only by adding.
- **Connecting the two is one settings page**: the address and the token, a "Test Connection" button that says
  what is wrong (unreachable, wrong token, no GPU, version too old), and the node's state. Moving the node to
  another machine is starting it there and changing the address.
- **Nothing to clean by hand**: the node deletes its finished jobs, the plugin deletes its working files, and a
  failed job leaves nothing behind.

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
  candidate for the native Windows app (phase 4).
- **nerfstudio: not tried.** Its image (`dromni/nerfstudio:1.1.5`, 13 GB, November 2024) has PyTorch 2.1.2 for
  CUDA 11.8, which does not support an RTX 50; it would have to be rebuilt, and its poses are centred, oriented
  and scaled by default.

Found on the way:

- A task whose images are not JPEG (the thermal tasks' TIFFs) cannot be exported: the plugin says so before
  starting. Converting them is phase 3.
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

### The plugin's API (built)

Under `/api/plugins/splatme/`: `POST task/<id>/train` (options `steps`, `image_size`, `max_gaussians`,
`sh_degree`; defaults 7,000 steps and 1,600 px images, the node's ranges apply), `GET task/<id>/status`
(`state`: starting, exporting, uploading, queued, training, importing, completed, failed, canceled; `progress`
of that state, `status`, `error`, `active`, `has_splats`), `POST task/<id>/cancel`, `GET task/<id>/log?offset=`
(the node's log; the next offset in `X-Log-Offset`), `GET task/<id>/check` (before training: the task's
`problem`, `warnings` such as WebODM's own for photos that all point down, the node's `ranges` or `node_error`),
`GET node` (the node's state for every user; for administrators also `url`, `token_set` and what is wrong) and
`POST node` (administrators: `url`, `token`, and `save` false to only try them; never answers the token). The
status also says `can_train` and the task's own `task_status`. A page follows a job by asking the
status every few seconds; the status request is also what gives a job that lost its worker a new one.
Automatic training: `GET task/<id>/auto` and `POST task/<id>/auto` (`enabled` and the options, or `reset` true
to follow the default again; needs the right to change the project), `GET automation` (the default; for
administrators also `listening`, whether the worker tells the plugin of completed tasks) and `POST automation`
(administrators). The status carries the task's `auto` (`enabled`, `options`, `own`), and a job says `auto`
when it was started by the task completing.

Found while building it:

- **WebODM's worker imports every plugin when it starts, and only then** (corrected 2026-11-14, see
  "1. Automation"): a receiver connected at a plugin module's top level is called in the worker, where
  `task_completed`, `task_failed` and the deletion of a task happen. A plugin installed or changed after the
  worker started is not there until the worker restarts, so the plugin does not rely on `task_removing` alone:
  a training job stops when its task is gone, and records of deleted tasks are swept when a training starts.
- The worker keeps a plugin's modules loaded: after a change to `splatme/`, a worker process that already ran a
  job runs the old code until the worker restarts (WebODM asks for a restart after a plugin update).
- The export is the slow part on a busy machine (84 s to 325 s for 220 photos resized to 1,600 px, against 70 s
  of training for 2,000 steps), and it is redone for every training. Keeping it for the next training of the
  same task is a candidate for "Continue training".

### Automation (built)

Train a task when it completes, and again after it is reprocessed (reprocessing deletes the task's assets,
its splat model included). A task that completes with a model (an imported task) is not trained.

**Is `task_completed` enough? Yes** (checked 2026-11-14 at the maintainer's request, WebODM 4.0.0, Celery
5.6.3, in debug and in production mode):

- The worker skips `boot()` (`app/urls.py`: "don't execute boot with celery workers"), so a plugin's
  `register()` is not called there. But Celery checks the Django project when a worker starts
  (`DjangoWorkerFixup.validate_models` runs Django's checks, which import `app.urls`), and building WebODM's
  URL patterns calls `get_plugins()`, which imports every plugin's module. A module-level
  `@receiver(signals.task_completed)` is therefore connected in the worker's parent process and inherited by
  every child. This is what the published `tasknotification` plugin relies on.
- Measured: a worker started fresh (a second worker on a queue of its own, stopped afterwards) has the plugin's
  `task_removing` receiver connected, and sending the signal there calls it. The stack's long-running worker
  showed no receiver only because it had started before the receiver was written: it still holds the
  scaffold's `plugin.py`. The earlier conclusion ("the worker does not load plugins") came from that stale
  worker and from one-off processes that do not go through Celery's start.
- What the signal does not cover, and the plugin must handle itself:
  - **A plugin uploaded or updated after the worker started is not imported there** until WebODM restarts
    (the worker imports plugins once). The SplatMe page must say when automation is not active yet (a probe
    job asks the worker whether the receiver is connected) and the install steps say to restart WebODM.
  - **`get_plugins()` imports disabled plugins too**: the receiver checks that the plugin is enabled.
  - The receiver must be connected at module level (not in `register()`), and runs inside the worker's task:
    it only starts the training job (`run_function_async`) and returns.
  - `CELERY_SKIP_CHECKS` set in the worker's environment would skip the import; WebODM does not set it.
- So: **no watcher and no pull request for detection.** The decision "Watcher now + PR to WebODM" is replaced
  by a `task_completed` receiver.

Decided (2026-11-14):

- **Every task that can train** is trained (no skipping of tasks whose photos point straight down).
- **Per task, chosen by the user**: a new task has the setting (on or off, with the Quality and the options)
  at creation and while editing; **administrators set the default** every new task starts from, on the SplatMe
  page. A user's change applies to that task only. Presets are well guided, with sensible defaults.
- **"Train Splats" / "Train Splats Again" stay** on every task that qualifies, for training by hand.

Built without a pull request: the administrators' default applies to every new task, and the task's expanded
panel on the Dashboard has the setting ("Train Splats When Completed", with Change) from the moment the task
exists, while it processes too. A task without a setting of its own follows the default as it is when the task
completes. A training that cannot start (the node does not answer, a wrong option) is left on the task as a
failed training; under the default, a task that cannot be trained at all is passed over without a word.

### Task Options (built)

The user's intent: SplatMe's settings are part of a task's options, chosen where a task is created and edited,
and used when the task is started or restarted and completes. Training only the splats of a completed task
stays with Train Splats / Train Splats Again in the task's panel. Decided (2026-11-14): first without touching
WebODM; reach out to the maintainer later, with a pull request then.

What WebODM 4.0.0 gives a plugin in the Edit Task Options dialog (`EditPresetDialog.jsx`): one hook,
`PluginsAPI.Dashboard.presetDialogOptionsReady`, called when the dialog opens with the task (none for a new
task) and the dialog's option components; a plugin answers with controls, each drawn below one existing option.
The dialog's sections are a fixed table and its options are the processing node's: a plugin can add neither a
section nor an option.

Built, as decided:

- **Where**: below `pc-quality` (Point Cloud section; the first option when a node has no `pc-quality`), a
  line "SplatMe" with the button "Train Splats When Completed: Off (the default) / On: Standard". The section
  is closed when the dialog opens, as all are.
- **An existing task** (the Edit Task panel): the button opens the same dialog as the task's panel does, and
  Save there changes the task's setting at once, whatever the Edit Task Options dialog's and the Edit Task
  panel's own Save and Cancel do.
- **A new task** (the New Task panel): the hook gives neither the project nor the task to be, and no hook
  tells a plugin of a created task. The setting is held on the page with the New Task panel it was chosen in;
  the page hears WebODM's own request that creates the task (jQuery's `ajaxSend` / `ajaxComplete` notices of
  `POST /api/projects/<id>/tasks/`, whose answer is the task) and saves the setting on that task. A panel that
  is canceled, or whose task could not be created, forgets it. This listens to the page's requests, which is
  not one of WebODM's plugin hooks: it goes when WebODM tells plugins of a created task (phase 6).
- **Not built: SplatMe's row in the New Task panel** (chosen as "Both": the row and the button in the dialog).
  WebODM stops listening to a hook after the first plugin's answer (`ApiFactory.js` removes the listener one
  tick after the first response). Lightning, a core plugin, answers `addNewTaskPanelItem` after loading a
  script; an immediate answer from SplatMe arrives first and Lightning's cost estimate is dropped (tried in
  a browser on the dev stack: with a second plugin answering, the panel has that plugin's item and Lightning
  never asks `is_lightning_node`). Held until the dispatcher is fixed in WebODM (phase 6).

### Denser starting cloud (dropped)

`prepare_export` samples the point cloud to about 125,000 points, a fixed number. The plugin writes
`points3D.bin` itself from the same `.laz` with more points (the cloud has millions), so training starts closer
to the surface and needs fewer steps. Costs GPU memory. An option, with its default chosen by measuring on an
RGB task with oblique photos ("HomerunObliqueRGB" on the dev stack): quality and time against the number of
points, and how far the gaussians end up from the task's point cloud.

**Measured (2026-11-14); dropped on these numbers.** HomerunObliqueRGB: 959 photos exported at 1600 px, a cloud of 12.8
million points, the dev stack's RTX 5060 Laptop GPU (8 GB), one photo held out (`--val`). Gaussians are counted
from the `.ply`'s size.

| Starting points | Steps | Time | GPU memory, peak | Held-out PSNR | Gaussians at the end |
|---|---|---|---|---|---|
| 503,860 (WebODM's export) | 2,000 | 246 s | 5.3 GB | 17.44 | 0.50 million |
| 2,070,489 | 2,000 | 327 s | 6.6 GB | 17.48 | 2.07 million |
| 503,860 (WebODM's export) | 7,000 | 301 s | 6.5 GB | 20.84 | 0.27 million |
| 2,070,489 | 7,000 | 762 s | 7.7 GB | 20.80 | 0.67 million |
| 3,809,670 | 7,000 | 2,342 s | 7.8 GB | 21.00 | 0.99 million |

- WebODM's "about 125,000 points" is a spacing worked out from the cloud's ground area: on a scene with walls
  it gives four times as many (503,860 here).
- More starting points did not improve the held-out photo (within 0.2 dB, one photo) at 2,000 or at 7,000
  steps, cost 2.5 to 8 times the time, and filled the GPU's memory. Training prunes most of them: 2.07 million
  became 0.67 million by step 7,000.
- 6.1 million starting points had not left the trainer's preparation after three minutes; stopped.
- Not measured: the gaussians' distance from the point cloud; a GPU with more memory; 30,000 steps.

### 1. Continue training

OpenSplat's `--resume <ply>` continues from an earlier model. The node keeps (or the plugin stores) the `.ply`
beside the `.rad`; "Continue Training" adds steps to it. Reprocessing the task discards it.

### 2. Masks

OpenSplat applies a `masks/` folder (white keeps, black ignores) named after the images. A task's results hold
no masks (ODX's sky and background masks are not kept), so the plugin makes them. Open: which masks (sky, an
area drawn by the user, moving objects) and how they are made.

Not usable from a task: the mesh, the DSM and depth maps. OpenSplat v1.2.2 has no depth or normal supervision,
and the task keeps no depth maps or undistorted photos (OpenSplat undistorts from the camera model itself).

### 3. Thermal tasks

WebODM's export refuses images that are not JPEG, and a thermal task's are TIFFs. With the DJI Thermal Analyzer
plugin installed, convert them to radiometric JPEGs with its DJI thermal SDK and export those; without it, the
task is refused with a message naming that plugin. To check first: how that plugin exposes the conversion, and
that the export can be given the converted images (it reads `task.get_image_path`).

### 4. Native Windows app

The same backend interface with a second implementation: the trainer as a local program the worker runs.

### 5. Docs and first release

README, docs, the zip, the splat node's image, the entry for WebODM-Plugins' `directory.json`.

### 6. Pull requests to WebODM (a SplatMe section in Task Options, the New Task panel's row)

Decided (2026-11-14): the plugin ships first, as it is built on WebODM 4.0.0's own hooks, the new task's
setting through the page's requests included. Once it is close to feature complete, the user and Claude review
which features would be better with a small, targeted pull request to WebODM; a plugin already in use shows
the maintainer what each one is for. Nothing is sent or opened before the user approves that specific change.
The candidates so far, each small and separate:

- **A fix**: `ApiFactory.js` keeps listening until every plugin registered for a hook has answered (today the
  first answer wins, so two plugins cannot both add an item to the New Task panel, a task's buttons or the
  options dialog). With it SplatMe's row in the New Task panel ("Train Splats When Completed", Quality,
  Advanced) can be built.
- **A section of a plugin's own options in the Edit Task Options dialog**, saved with the task's options
  (`Task.options`) and in presets. Frontend only: `presetDialogOptionsReady` may answer with a section and its
  options, and `EditTaskForm.getAvailableOptionsOnly` lets those names through. The server needs no change:
  `Task.options` is checked for its form only, and the processing node ignores option names it does not know
  (NodeODX's `odmInfo.js` `filterOptions`). SplatMe then reads its options from the task when it completes,
  and the setting kept in the plugin's data store becomes the fallback for WebODM versions without the section.
- Or, smaller: the New Task panel tells plugins of the task it created (then the page need not listen to
  WebODM's requests).
