# Upcoming changes

A WebODM plugin that automates training Gaussian splats for a task. WebODM (3.3 and later) already exports a
task's training data and imports, converts and displays a trained model (a task's **⋯ → Splats** dialog on the
Dashboard, `app/splats.py`, `app/api/splats.py`, `worker/tasks.py`); the training in between is done by hand in
other software. The plugin does that step.

## Phases (current and upcoming)

**Up next**

1. SplatMe's entry in WebODM's plugin directory, with 0.2.0 (the rest of "Docs and first release"). 0.2.0 is
   released (2026-11-17), with node 0.2.2 and the docs on Pages. The user opened the pull request,
   https://github.com/WebODM/WebODM-Plugins/pull/9 (branch `add-splatme` of their fork, commit f103215): waiting
   for the maintainer. Once merged, check that Administration → Plugins → Install Plugins lists SplatMe 0.2.0
   (marked Experimental), then move this phase to Done.

**Then**

2. Before the next release after 0.2.0: evaluate OpenSplat's remaining training options again, likely with
   quality testing first (`--densify-until`, training at lower resolution first, and smaller extras), and
   decide with the user which, if any, the presets or Image Size set. See "7. OpenSplat's other training options
   (to evaluate before the release after 0.2.0)".

**Later**

3. Proposed, not yet decided: HTTPS to a splat node on another machine, self-signed and pinned in SplatMe
   (asked 2026-11-16; the docs for a TLS proxy went into 0.2.0 with the guided setup). See "4. HTTPS to the splat node
   (proposed)".
4. Review with the user which features would be better with small, targeted pull requests to WebODM (a SplatMe
   section in Task Options, SplatMe's row in the New Task panel), then reach out to the maintainer.
5. Proposed, not yet decided: recommended steps for an Image Size (a measured study of steps against image
   size, the node's GPU memory in `/info`, a recommendation with time and memory under the fields). See
   "6. Steps for an Image Size (proposed)". Its grid can share the GPU nights of phase 2's quality testing.

**Dropped**

- Native Windows app (2026-11-15, the user's decision after checking their native install): WebODM's native
  app is not ready for it. It ships no `splat-tools` (WebODM's own Splats import cannot convert there either)
  and no Node or webpack to build a plugin's page scripts. SplatMe supports Docker installs of WebODM only. See
  "Native Windows app (dropped)".
- Denser starting cloud (2026-11-14, the user's decision after the measurements): more starting points gave no
  better result on the dev task at several times the training time. See "Denser starting cloud (dropped)".
- Restarting WebODM's worker from the SplatMe page, and starting a training from the task's panel when the
  worker does not hear of completed tasks (2026-11-15, the user's decision): an administrator restarts WebODM
  by hand once after installing or updating, as the README says.

**Done**

- Documentation after the release (2026-11-17): `docs/how-it-works.md` (How It Works: what SplatMe takes from
  WebODM, and how OpenSplat trains a model, from WebODM 4.0.0's `app/splats.py` and OpenSplat e33f9dd), the
  network path from WebODM to a node on another machine in Getting Started's checklist, and the `release-check`
  skill (`.claude/skills/release-check`, with its scripts). Published by hand (run 44114401146, documentation
  only).
- The rest of the review's findings (2026-11-16): D–H in `splatme/training.py` and `node.py`, N and O in
  `splatme/public` and `templates/options.html`, R and the job's `ref` in `node/splatnode.py`, S in
  `node/splatnode.sh`, U in `release.yml`. Tests: 13 in `test_splatme.py` (one a `TransactionTestCase` with two
  requests at once), 5 in `node/tests`; pages, the script and the workflow's step checked live. See "The rest of
  the review's findings (built)".
- Release check of 0.2.0 (2026-11-16): 0.1.1 and node 0.2.0 from the published release on a throwaway WebODM,
  upgraded to `dist/splatme-0.2.0.zip` and node 0.2.2, data kept, trainings before and after. See "Release check
  of 0.2.0 (done)".
- Fixes from the review of 0.2.0 (2026-11-16), in 0.2.0 with splat node 0.2.2: A, B, C, I, J, K, L, M (the plugin),
  P, Q (the node), T (the release) and the documentation. See "Fixes from the review of 0.2.0 (built)".
- Release review of 0.2.0 (2026-11-16): findings A–U, the documentation's corrections and removals, the live
  sweep. See "Release review of 0.2.0 (done)".
- Splash image and thanks (2026-11-16), in 0.2.0: `docs/assets/splash/`, the top and the Thanks section of
  `README.md` and `docs/index.md`. See "Splash image and thanks (built)".
- The splat node made robust (2026-11-16), splat node 0.2.2 in SplatMe 0.2.0: `node/splatnode.py` (the store and
  `Node.transition`, the supervised worker, the deadlines, `trash/` and `broken/`, the routes), `TestFailures` and
  `TestTrainerOutput` in `node/tests/test_splatnode.py` with the stand-in's misbehaving modes and the captured
  OpenSplat output, `SPLATNODE_STALL_MINUTES` in `splatnode.sh` and `compose.yml`, the release's check by the
  image's inputs. See "The splat node made robust (built)".
- Documentation on GitHub Pages (2026-11-16), in 0.2.0: `docs/` (Home, Getting Started, the reference pages
  moved from the README, Changelog included from `CHANGELOG.md`), `zensical.toml`, `docs/requirements.txt`
  (hashed lock), the `docs` and `docs-deploy` jobs in `release.yml`, the short README, the admin page's links.
  See "Documentation on GitHub Pages (built)".
- Guided splat node setup (2026-11-16), in 0.2.0: the install steps on Administration → SplatMe
  (`templates/node.html`: `#splatme-guide`, `#splatme-guide-toggle`, `placeGuide`, `copy`), the README's
  "HTTPS to a node on another machine", `splatnode.sh upgrade` keeping `SPLATNODE_BIND`. See "Guided splat node
  setup (built)".
- Fixes from the release review (2026-11-16), released as 0.2.0 with splat node 0.2.1: every finding of the
  review of 0.1.1, in three merged branches (`install-fixes`, `training-fixes`, `page-fixes`) and
  `release/0.2.0`; tests in `node/tests`, `splatme/tests/test_splatme.py` (88) and `splatme/public/__tests__`
  (73). See "Fixes from the release review (built)".
- Install, upgrade and uninstall (2026-11-16): the repository made public after a privacy check (a place name
  removed from the files; the history kept, the user's choice); `dev/build-zip.sh`; the release workflow
  (`.github/workflows/release.yml`), run by hand once: the zip in 9 s, the node's image built and pushed in 12
  minutes (`ghcr.io/winuxnomacs/splatme-node:0.2.0` and `latest`, public by inheriting the repository's access);
  `node/splatnode.sh`, checked with the local and the published image, standalone and connected to a throwaway
  WebODM with SplatMe from the zip. The directory entry waits for the release (phase 1). See "Install, upgrade
  and uninstall (built)".
- Training defaults and the form's tables (2026-11-15): 30,000 steps (OpenSplat's own) at Image Size 1,600 by
  default (`training.DEFAULTS`, `TrainDialog.jsx`, `formFromOptions`); under Steps a fixed table of the
  trainer's stages with hover tips (`trainingStages`, `stagesCells`, `STAGE_TIPS`, `StagesTable.jsx`, Settings'
  copy in `options.html`), also under More Steps; under Image Size a table of each camera's photos as they are
  and as trained (`trainedSize`, `imageSizeRows`, `ImageSizeTable.jsx`, the check's `photo_sizes` from
  `training.photo_sizes`, the New Task panel's first JPEG); Image Size's hint says photos are scaled down
  whole, never cropped; the Quality hints without "laptop GPU". Tests: Jest's "the trainer's stages under
  Steps" and "the photos' size under Image Size", Django's check tests. See "Training defaults and the form's
  tables (built)".
- Thermal tasks (2026-11-15): DJI Thermal Analyzer's tasks listed and trained, their temperature TIFFs drawn
  as JPEGs over one range for the whole task in a Thermal Colours palette (nine: Grayscale, Black Hot, Iron and
  WebODM's own maps), given to WebODM's export through a stand-in task (`thermal.py`; `training.py`'s
  `compatible`, `problem`, `parse_options`' `palette`, `export_and_send`'s Drawing stage; `api.py`'s `check`
  `thermal` and `status` `thermal`); Thermal Colours in place of Ignore Sky in `OptionsFields.jsx` and on
  Settings (`options.html`); the row names the palette and range (`trainingView.js` `thermalText`). Tests: six
  Django tests (`# Thermal tasks`), Jest's "a thermal task's colours". See "Thermal tasks (built)".
- OpenSplat presets (2026-11-15): a study of OpenSplat's code and 25 measured trainings, then Draft 3,000 steps
  (2,000 grew nothing), Standard 7,000, a new Fine 15,000 and High 30,000, each hint with its time and GPU
  memory; a note for step counts the trainer handles badly (`trainingView.js` `stepsNote`, also in
  `templates/options.html`); the Image Size and Max Gaussians hints say which to lower when the GPU runs out of
  memory; the node built from OpenSplat e33f9dd. Tests: `trainingView.test.js`. See "OpenSplat presets (built)".
- Only compatible tasks on SplatMe → Tasks (2026-11-15, from `new.md`): `training.compatible` (JPEG photos,
  and once completed what a training needs; or splats already), used by api.py's `tasks`, which leaves out
  projects with no such task and adds `addable`; New Task With Splats above the list (`Tasks.jsx`). Test:
  `test_the_tasks_list_leaves_out_tasks_splatme_cannot_train_and_projects_with_none`. See "Only compatible
  tasks on SplatMe → Tasks (built)".
- New tasks in SplatMe (2026-11-15): New Task With Splats in each project's heading on SplatMe → Tasks
  (`public/NewTask.jsx`: SplatMe's panel above WebODM's own `NewTaskPanel`; `public/newTask.js`: the task
  created, its training setting saved, the files uploaded, the task committed, through WebODM's task API);
  rows show the processing's progress and error (api.py's `tasks`: `running_progress`, `last_error`); the
  Dashboard's button is a link to it, and `panelSettings.js` and `notice.js` are gone. Tests:
  `newTask.test.js` (Jest), the tasks list's Django test; a live creation in the browser. See "New tasks in
  SplatMe (built)".
- SplatMe's Tasks page (2026-11-15; a bug: SplatMe's answer to the task panel's hook dropped other plugins'
  buttons): the side menu's SplatMe is a submenu, SplatMe → Tasks (`templates/tasks.html`,
  `public/Tasks.jsx`, rows of `TrainSplats.jsx`; api.py's `tasks`) and SplatMe → Settings (`settings.html`,
  now at `/plugins/splatme/settings/`); the Dashboard's task panel has only a Splats line with Open in SplatMe
  (`TaskLine.jsx`, placed by `Dashboard.jsx`); SplatMe's panel above Edit Task, `find-task` and the task panel
  hook's button are gone. Tests: `test_the_tasks_list_has_the_tasks_of_the_projects_the_user_may_see_with_their_splats`,
  `test_the_tasks_and_settings_pages_are_in_the_menu_and_need_a_login`, Jest's rows and line
  (`trainingView.test.js`); the browser check showed Lightning's Share on the first task panel opened. See
  "SplatMe's Tasks page (built)".
- SplatMe in Administration (2026-11-15): the splat node's address and token are changed on a SplatMe page
  under Administration (superusers); every user sees the node's state and address on the side menu's SplatMe
  page; each user saves their own New Task With Splats options, and the administrators' are the starting
  point. `splatme/templates/admin.html`, `settings.html`, `node.html`, `options.html`, `public/main.js` (the
  Administration item), `plugin.py` (`admin/`), `api.py` (`url` for everyone, `automation` per user,
  `automation/shared`), `training.py` (`own_options`, `shared_options`). Tests: 2 new and 2 changed in
  `test_splatme.py` (64). See "SplatMe in Administration (built)".

- Time left (2026-11-15): "Step 4,650 of 7,000, about 12 min left" in the task's panel while it trains.
  `splatme/training.py` (`time_left`, `keep_window`, `left_text`, `step_status`, in `wait_for_node`),
  `api.py` (`time_left` in the status). Tests: 3 new in `test_splatme.py` (62). See "Time left (built)".

- Less fragile page parts (2026-11-15): SplatMe says where it cannot add its parts to WebODM's pages (notices,
  the Edit Task panel's "cannot tell which task"), warns while WebODM's worker does not hear of completed tasks,
  finds an Edit Task panel's task by its name when React's props are not there, places its button itself so
  other plugins' buttons beside Import show too, and has Change back in the task's panel.
  `splatme/public/Dashboard.jsx`, `NewTaskButton.jsx`, `EditTaskSplats.jsx`, `AutoDialog.jsx`,
  `TrainSplats.jsx`, `panelSettings.js`, `notice.js`, `restartText.js`, `main.js`; `training.py` (`listens`),
  `api.py` (`find-task`, `listening` in the status and for everyone in `automation`). Tests: 2 new in
  `test_splatme.py` (59), 4 new in Jest (40). See "Less fragile page parts (built)".

- SplatMe's panel (2026-11-15): above WebODM's New Task panel opened with New Task With Splats, and above every
  Edit Task panel, as DJI Thermal Analyzer's is above its task panel: Train Splats When Completed and the
  options. Replaces the button's pressed state and the task panel's Change (and `AutoDialog.jsx`).
  `splatme/public/SplatMePanel.jsx`, `NewTaskButton.jsx`, `EditTaskSplats.jsx` (with `main.js`, Dashboard
  only), `panelSettings.js` (was `newTaskSettings.js`), `TrainSplats.jsx`, `api.py` (`automation?ranges=1`
  again, no `new_task`). Tests: 4 new in Jest (36), 1 changed in `test_splatme.py`. See "SplatMe's panel
  (built)".

- New Task With Splats (2026-11-15): a button beside "Select Images and GCP" in a project on the Dashboard;
  only a task created with it is trained by itself. It replaces the control in the Edit Task Options dialog
  and the administrators' default for every task. `splatme/public/NewTaskButton.jsx`, `main.js` (the
  `addNewTaskButton` hook), `newTaskSettings.js`, `AutoDialog.jsx`, `training.py` (`new_task_options`,
  `get_auto`), `api.py` (`task/<id>/auto` with `new_task`, `automation`), `templates/settings.html` ("New Task
  With Splats"). Tests: 1 new in `test_splatme.py` (57 in all), Jest unchanged in number (32). See "New Task
  With Splats (built)".

- Crop To Boundary (2026-11-14): a task processed with a boundary GeoJSON shows only the splats inside it.
  `splatme/crop.py`, `training.py` (`import_model`, the `crop` option, `cropped`), `api.py` (`check`'s
  `boundary`), `public/OptionsFields.jsx`, `public/trainingView.js`, `templates/settings.html`. Tests: 4 in
  `test_splatme.py`, 1 in Jest. See "Crop To Boundary (built)".
- Ignore Sky (2026-11-14): a checkbox in the Train Splats dialog, the Train Splats When Completed dialog and
  the SplatMe page's Automatic Training form; the worker masks the sky in the exported photos and the trainer
  ignores it. `splatme/sky.py`, `training.py` (`export_and_send`, the `masking` state, `sky_masks`),
  `public/OptionsFields.jsx`, `public/trainingView.js`, `templates/settings.html`. Tests: 9 in
  `test_splatme.py`, 2 in Jest. See "Ignore Sky (built)".
- Continue training (2026-11-14): the Train Splats dialog on a task's panel offers Start Over or Continue From
  Step N for a task SplatMe trained, and continuing asks only More Steps. Splat node 0.2.0 (`node/splatnode.py`:
  a job's model is a `.ply`; a zip that holds `resume.ply` continues it), `splatme/training.py` (`start` with
  `resume`, `trained_steps`, `convert`, `import_model`), `api.py` (`check`'s `trained_steps`),
  `public/TrainDialog.jsx`, `public/trainingView.js` (`continueFromForm`, `defaultMoreSteps`). Tests: 2 in
  `node/tests`, 3 in `test_splatme.py`, 3 in Jest. Checked on the dev stack with the real node: 2,000 steps,
  then continued to 3,000 (the node's job started at step 2,010; WebODM's converter took 15 s for a 125 MB
  `.ply`), run in a process of its own because the dev worker still has the old code; the dialog in a headless
  browser at desktop and phone width, with the train request answered by the check. Not checked: the continued
  model in the 3D view. The user then continued the task from the browser through WebODM's worker, which had
  not been restarted: 3,000 to 6,000 steps, imported as a `.rad` with the `.ply` kept.

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
  Windows app was planned, then dropped (2026-11-15: see "Native Windows app (dropped)"). 3.3.2 is not supported (its splat code is the same, so it could be added).
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
  redoes the alignment.
- **The service in the splat node is written in Python**, standard library only.
- **Thermal tasks are a later phase** (built since, differently: see "Thermal tasks (built)"): TIFFs converted to radiometric JPEGs with the DJI thermal SDK that the
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
  panel, is called once when the panel opens and not again when the task changes.
- WebODM stops listening one moment after the first plugin's answer to a hook (`ApiFactory.js`): a button that
  waits for its script (the hook's dependency list) is dropped when another plugin answers first, and an
  immediate answer drops the others'. SplatMe answers none of the task panel's hooks (see "SplatMe's Tasks
  page (built)"): it trains on its own page and puts its line in the panel itself.
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
  workflow, decided in "Install, upgrade and uninstall".
- **The plugin and the node are updated separately**, so each says its version (`GET /info`) and the plugin names
  the mismatch and what to update, rather than failing mid-job. The node's API changes only by adding.
- **Connecting the two is one settings page**: the address and the token, a "Test Connection" button that says
  what is wrong (unreachable, wrong token, no GPU, version too old), and the node's state. Moving the node to
  another machine is starting it there and changing the address.
- **Nothing to clean by hand**: the node deletes its finished jobs, the plugin deletes its working files, and a
  failed job leaves nothing behind.

## Spike results (2026-11-14)

Machine: RTX 5060 Laptop GPU (8 GB), Docker under WSL2. Task: a residential street on the :8002 stack (220
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
  candidate for the native Windows app (since dropped).
- **nerfstudio: not tried.** Its image (`dromni/nerfstudio:1.1.5`, 13 GB, November 2024) has PyTorch 2.1.2 for
  CUDA 11.8, which does not support an RTX 50; it would have to be rebuilt, and its poses are centred, oriented
  and scaled by default.

Found on the way:

- A task whose images are not JPEG (the thermal tasks' TIFFs) cannot be exported: the plugin says so before
  starting. Drawing them is "Thermal tasks (built)".
- A headless browser draws the 3D view in software, slowly: a screenshot of it needs a small window and a long
  timeout (800x520, four minutes).

## Phase details

### The splat node made robust (built)

**Asked 2026-11-16:** WebODM's maintainer called `node/splatnode.py` fragile (their wording was not found in the
repository's issues, pull requests or commit comments). Reviewed the same day, reading the code and then making each
suspected failure happen against the real service (the tests' stand-in trainer, faults injected by hand).

**Found, run and confirmed:**

- A. The training thread dies on any error outside the training itself (a write failing for a full disk as a job
  starts, in `work()` or in `finish()`), and nothing notices: `/health` answers 200, Docker says healthy, new jobs
  are accepted and wait forever, the first stays "running". Only a restart clears it.
- B. One `job.json` without a `state` stops the node from starting (`KeyError` in `load()`): the container
  restarts in a loop until the file is deleted by hand.
- C. An error the code did not expect (a full disk during an upload) closes the connection without an answer:
  SplatMe says the node does not answer instead of why.
- D. Nothing has a deadline on the trainer: Cancel sends SIGTERM only, so a trainer that does not exit stays
  "running" and holds the queue, and `DELETE` waits for it forever (its request timed out). A trainer that hangs
  without exiting (as OpenSplat did on an unreadable photo, fixed at the pinned commit) holds the GPU for good.
- E. No socket timeout (`Handler.timeout` is None): a client that stalls mid-upload holds a thread and its partly
  written job folder until the node restarts.

**Found by reading:**

- F. `finish()` and `expire()` delete a job's extracted photos (up to gigabytes) while holding the one lock every
  request waits for: SplatMe's status requests time out after 15 s, and 5 minutes without an answer fails a training.
  Not measured.
- G. A job's state has no single owner: job records are changed from several threads, partly outside the lock; state
  changes happen in six places with no check that a change is allowed; the internal `canceling` flag is saved and
  served by the API; `self.process` assumes one job.
- H. Progress and "out of memory" come from OpenSplat's console wording (`STEP_LINE`, a substring); a reworded
  trainer silently loses progress, time left and the memory message, and no test holds real output.
- I. Routing is one `if` chain: a wrong method's 405 says "Not found"; HEAD answers 501.
- J. The tests' stand-in trainer always behaves, and no test fills the disk, damages a job file, stalls a client or
  ignores SIGTERM: why all of the above passed.

**Sound:** zip entry names checked before extraction, the token compared in constant time, `job.json` replaced
atomically, options range-checked, a failed upload cleaned up, the node run as an unprivileged user.

**Root causes, and what changes in the approach:**

1. Errors were handled for a job, not for the machinery that runs the jobs. Now: every loop that runs unattended is
   supervised, and a failure it can't recover from ends the process (crash-only), which Docker restarts
   (`restart: unless-stopped` in every compose file the node is run from) and whose start fails the job that was
   running, as a restart already does.
2. Waits had no deadline. Now: every wait has one (sockets, the trainer's silence, the trainer's stop, a request
   waiting on a job).
3. State had many writers under one lock that also covered slow work. Now: one owner of the jobs' state, one
   function for a state change that refuses an illegal one, copies handed out, and no file work under the lock.
4. The stand-ins only behaved. Now: each failure above has a test that makes it happen, written before the fix and
   seen failing on the current code; the stand-in trainer can misbehave (ignore SIGTERM, go silent, crash).
5. The trainer's output was matched from memory of what it prints. Now: matched against lines captured from a real
   run of the pinned OpenSplat, kept as a test fixture and captured again when the pin changes.

**The design** (same HTTP API and JSON, so SplatMe 0.2.0 needs no change; Python's standard library only, as now):

- **Jobs' state** in one class (the store): `create`, `transition(job_id, to, **fields)` (allowed moves only:
  queued → running or canceled; running → completed, failed or canceled; anything else refused and logged), reads
  answer copies. Saved through the same atomic write. The request to cancel is kept beside the record, not in it.
- **Files** are removed outside the lock: a finished job's leftovers and an expired or deleted job's folder are
  renamed into `trash/` under the lock (instant), and deleted by the worker without it; `trash/` is emptied at start.
- **The worker** catches and logs everything per pass and goes on; a job whose handling raised is failed with the
  error. If the worker's thread ends anyway, `/health` answers 503 and the process exits with an error, so Docker
  restarts it. Its last pass time is in `/health`, so a stuck worker is visible too.
- **Deadlines:** the trainer starts in its own process group; Cancel and stop send SIGTERM, then SIGKILL to the group
  after a grace period (20 s, inside compose's 30 s `stop_grace_period`). A trainer silent longer than
  `SPLATNODE_STALL_MINUTES` is stopped and its job failed with that reason; the default is set from the longest
  silence measured in a real training of the largest dev task (HomerunObliqueRGB, 959 photos), with a margin.
  `Handler.timeout` 120 s per socket read or write. `DELETE` of a running job stops it and answers at once; its
  files go when the trainer has stopped.
- **Startup** never fails on one job: a `job.json` that does not read or lacks a field is moved to `broken/`, named in
  the log, and the node starts.
- **Every request is answered:** an unexpected error answers 500 with its message (507 for a full disk), logged with
  its traceback. Routing is a table of (method, path pattern) → handler: 405 with `Allow`, HEAD wherever GET is.
- **Disk:** uploads in progress reserve their share of the free space, so two at once can't both pass the check.
- **The trainer's output:** progress and the memory message are matched against `node/tests/opensplat-output.txt`,
  lines captured from a real run at the pinned commit (step lines, preprocessing, CUDA's out-of-memory). A running
  job with no step line after its preprocessing logs a warning, so a reworded trainer shows in the log.
- **Version:** splat node 0.2.2 (0.2.1 was never published: the release workflow builds a node version once and
  refuses a changed node without a new one). Getting Started's expected output and the CHANGELOG follow.

**Tests** (`node/tests`, written first, each seen failing on the current code): a full disk at a job's start, at its
end and mid-upload; a damaged `job.json`; a trainer that ignores SIGTERM (Cancel, `DELETE`, stop); a silent trainer;
a stalled upload; the worker's thread ending (503, the exit); an illegal state change; a status request answered
while a large folder is being deleted (timed); the fixture's lines parsed. Then a real training on the dev stack's
node (`dev/webodm.sh up --build splat-node`), cancel and delete during it, and a restart of the throwaway node with a
job running.

**Build order:** the failing tests; the store and the transitions; the worker, the deadlines and the files; the
requests; the fixture from a real run; then the real checks, the docs and the version.

**Open decision:** none in the design (it changes no behaviour SplatMe or an administrator sees, except clearer
errors and stuck states that now end). The stall default is measured, not chosen.

**As built and checked (2026-11-16, branch `node-robust`):**

- The 15 failure tests were seen failing on 0.2.1 first. Three of them first passed for the wrong reason (SIGTERM
  reached the stand-in before it had set itself to ignore it; a timing loop missed the delete): they now wait for
  the trainer's first step and time the request at the delete. Then 38 tests pass, three runs in a row.
- The measured silences: HomerunObliqueRGB (959 photos, 1,600 px, a 559 MB zip, 3,000 steps) on the pinned OpenSplat
  took 133 s; the longest silence was 4.3 s (before the first step line, which comes every 10 steps), the
  extraction 2.2 s. An original-size export of thousands of photos on a slow disk is estimated under 10 minutes,
  mostly extraction: `STALL_MINUTES` is 30.
- A real out-of-memory could not be made on this machine (three trainings at once fit: WSL lets the GPU use the
  computer's memory); its sample is the pinned libtorch's message.
- On a throwaway node from the new image (port 3199, its own volume): a real training completed with its result;
  Cancel ended the trainer in 1.0 s; `DELETE` answered at once and the folder went; `docker stop` with a job
  training took 1.4 s and failed the job ("stopped"); `docker kill` then start failed it ("restarted"); HEAD and
  405 answer; then a job trained; nothing left in `trash/` or `broken/`, no trainer running.
- The dev stack's node rebuilt to 0.2.2 kept its 11 jobs from 0.2.0 (none set aside), and SplatMe's check reads it.
- Also found and fixed: the release workflow's version check failed any second commit within an unreleased node
  version (it compared with the commit that set `VERSION`); it now compares a published version's inputs hash
  (`splatme.node.inputs`, a label the build adds). Run locally: 0.2.0 (no label) noticed and skipped, 0.2.2 built,
  a different hash refused. While running it, its `imagetools create` for `latest` was not stubbed and tried to
  push; it was refused (no registry login here) and `latest` is unchanged (0.2.0's digest).

### Splash image and thanks (built)

Asked 2026-11-16 in `new.md`, before the release:

> add a pre-release phase to add a thank you section to the readme that thanks the primary contributing projects
> with webodm and Piero Toffanin (only personal callout) at the top of the mentions. Link to their official
> projects.
>
> I've added a splash image and a medium sized version of it in the ignored directory. Move both files to an
> appropriate location and check them in. Make the full sized version the readme and documentation splash image,
> use the medium one or resize if necessary.

**The images.** `ignored/splatme-2nd-logo.jpg` (2,912 x 1,440, 2.9 MB) and `ignored/splatme-2nd-logo (Medium).jpg`
(1,366 x 675, 241 KB): the SplatMe title in splashes, a drone and a model being trained, and WebODM's logo and name
at the top left.

- Moved to `docs/assets/splash/` as `splash.jpg` and `splash-medium.jpg` (no spaces or brackets in a path a page
  links to), and committed; `ignored/` no longer has them. They are not in the plugin's zip (only `splatme/` is).
- **Shown at the top of the README and the docs' Home**, above the first line. The full image is the splash; a page
  shows the medium one (241 KB rather than 2.9 MB, still sharp at the width GitHub and the site show it), and a
  click opens the full one. The site's build copies both.
- Its alternative text says what it shows, for a screen reader.

**Thanks.** A "Thanks" section at the end of the README and of the docs' Home (before the licence in the README),
each name linked to the project's official page:

- **Piero Toffanin**, first and the only person named: the creator and maintainer of WebODM, ODX and OpenSplat.
- **WebODM** (https://github.com/WebODM/WebODM): SplatMe is its plugin, and reuses its export, splat conversion and
  3D view.
- **OpenSplat** (https://github.com/WebODM/OpenSplat): the trainer in the splat node.
- **ODX** (https://github.com/WebODM/ODX): the sky model Ignore Sky uses.
- **Splat-Tools** (https://github.com/uav4geo/Splat-Tools): the conversion WebODM runs on a trained model.
- **PyTorch** (https://pytorch.org): libtorch, which OpenSplat trains with.

Each link and each "what it gives SplatMe" checked against the code and the project's page as it is built (who
maintains each one, from its repository, not from memory).

**Also changed:** the repo CLAUDE.md's "The README only introduces SplatMe and links to Getting Started and the docs"
and the same line in the `release-review` skill gain "with its splash image and its thanks".

**Decided with the user** (2026-11-16):

1. The splash is kept as it is, WebODM's logo and name included. Replaced the same day by the user's new images, without WebODM's logo.
2. The splash goes at the top; the 3D view screenshot moves below the first paragraph.
3. The thanks list above, with Piero Toffanin on WebODM's line, linked to https://piero.dev/.

**As built:** the images in `docs/assets/splash/`; the README and the docs' Home open with the medium image,
linked to the full one; the 3D view screenshot stays below the opening paragraphs; "Thanks" ends both (before
the licence in the README). Each link answered (2026-11-16). `zensical build` strict: no issues; the Home page
headless at 1,280 and 320 px: no console errors, no sideways scroll.

### The rest of the review's findings (built)

Asked 2026-11-16: the findings of "Release review of 0.2.0 (done)" left for later are fixed before 0.2.0's tag.
Node 0.2.2 is not published yet, so the node's changes stay 0.2.2 (no new `VERSION`). Each fix gets a test that
makes its failure happen, seen failing first.

*Unattended trainings (training.py)*

- **D**: `start()` replacing a stale record deletes that record's node job first (as `cancel()` of a stale job does);
  an automatic start goes through `start()`, so it is covered too.
- **E**: a new record is created under a lock on SplatMe's own `Plugin` row (`select_for_update`), the one row that
  always exists, since WebODM's data store has no unique key: `start()` reads the current record and writes the new
  one under it, so a second request sees the first's record ("already being trained"). `ensure_follower()`, which
  creates its record the same way, takes the same lock.
- **F**: the follower keeps its samples per node job, not per task, so a new training starts from none.
- **G**: a takeover counts only when the run it replaces had started (`run()` marks its record as it starts): a run
  still waiting in WebODM's worker queue is not a lost worker. A job that fails by the takeover limit while
  importing keeps its node job (the node deletes it after its keep-hours), as its model is finished.
- **H**:
  - splat-tools gets a deadline (1 hour; killed, then "The trained model could not be converted: splat-tools took
    longer than an hour").
  - The model, the kept `.ply` and its options are first written beside their places under temporary names, then
    renamed in place one after another: a failure while writing leaves the task as it was.
  - An answer from the node that is not JSON (a proxy's page) is a `NodeError` ("The splat node at … answered
    something that is not a splat node's answer"), which the follower treats as a node not answering, with its hour
    of patience.
  - An upload whose answer is lost (the connection drops after the zip is sent): SplatMe sends its run id with the
    upload (`ref`, which the node stores and lists in `GET /jobs`); when the answer is lost, it asks the node for the
    job with that `ref`. As built: it follows that job rather than deleting it (the upload did succeed); with no
    such job the training fails as before. Only to a node 0.2.2 or later (an older one refuses `ref`).

*The pages*

- **N**: the Tasks page stops asking while its tab is hidden and asks again when it shows. While a task processes it
  follows that task's status through WebODM's own task API (no folder read) and reloads the whole list only when a
  task's status changes.
- **O**:
  - Labels tied to their fields (`htmlFor`/`id`): Steps, Image Size, Max Gaussians, Quality, Thermal Colours, More
    Steps.
  - A failed New Task With Splats keeps the typed task name.
  - Title Case, one rule (the one most names already follow): articles, conjunctions and prepositions of three
    letters or fewer are lower case unless first ("Set Up a Splat Node", "Install the Plugin"); longer words are
    capitalised ("New Task With Splats", "Continue From Step"). Two names change: Crop To Boundary → **Crop to
    Boundary**, Use The Administrators' Defaults → **Use the Administrators' Defaults**, in the pages and the docs.
    The rule goes into `CLAUDE.md`.

*The splat node and its script*

- **R**:
  - A trainer that has not ended a minute after SIGKILL (stuck in the driver) fails its job ("The trainer could not
    be stopped") and the worker ends, so the process exits and Docker starts it again.
  - A watchdog thread exits the process when the worker's heartbeat is older than its limit (today only `/health`
    says 503, which Docker does not act on).
  - Deleting a running job moves its `job.json` to the trash at once, so a restart before its trainer stops does
    not bring it back as failed.
- **S**:
  - `upgrade` asks first when the node is training (`/info`'s `running`): "A training runs on the node: the upgrade
    restarts the node and that training fails. Upgrade now?" [y/N]. With no terminal it stops and names `--force`.
  - `connect --webodm` on a node that listens on every address says that it will then listen on this machine only
    (a WebODM on another machine can no longer reach it) and asks first.
  - `status` on a node that is not running says how to start it (the `docker compose … up -d` command for its
    folder).

*The release*

- **U** (`release.yml`):
  - Only "manifest unknown" from ghcr.io means a version is not published; any other error fails the job, never a
    build over a published version.
  - `latest` moves only to a version at least as new as the one it points to (its `org.opencontainers.image.version`
    label, compared as versions), so a tag on an older commit or a run by hand cannot move it back.
  - The login reads the token from the step's environment.
  - Tested by running the steps' shell on the host against a stand-in `docker`; the workflow itself first runs with
    the tag.

**Decided with the user (2026-11-16):** the Title Case rule and `upgrade`'s question as proposed above.

**Built (2026-11-16)**, branch `review-findings`. Each new test was seen failing on the code before it. Checked
live:
- The node, as its own container from this branch on another port: a real GPU job keeps its `ref` and is found
  by it; a running job deleted just before a `docker kill` is gone after the start.
- SplatMe → Tasks, on the dev stack in a headless browser with a processing task faked in its answers: one list,
  then WebODM's task API until the status changed, then one list; nothing for 35 s with the tab hidden, one list
  when shown. The labels name their fields. With the create request aborted, New Task With Splats keeps the
  typed name.
- `splatnode.sh` with a stand-in `docker` and `curl`, with and without a terminal.
- The workflow's step, run on the host against ghcr.io's real answers with pushes blocked: unpublished, published,
  older than `latest`, a registry that does not answer.

### Release check of 0.2.0 (done)

On a throwaway production WebODM 4.0.0 (port 8018, project `sm-scratch`, its own volumes and administrator,
removed after), with a copy of a 217-photo task imported from a backup zip made from a copy of its folder (the
dev task untouched), 2026-11-16:

- **0.1.1 as published**: the release's zip and `splatnode.sh` downloaded (the zip's SHA-256 the same as the
  local build's). Load Plugin (.zip) installed it in 8 s; after the restart it registered. The script installed
  node 0.2.0 from ghcr.io, connected to the throwaway, and saved the address and token in SplatMe. A Draft
  (3,000 steps) trained and imported in about 3 minutes. Then set: the default automatic options, the
  administrator's own options and the task's automatic training.
- **The upgrade, as Getting Started says**: Load Plugin (.zip) refused while SplatMe was installed; delete, load
  `dist/splatme-0.2.0.zip` (SHA-256 `4c9d598a…`, from 7886338), restart. Before the restart the plugins row
  still said 0.1.1 and `revive` answered 404 (the old processes); after it, 6 of 6 answered 204. Every SplatMe
  data store row was the same after as before (the job's record, the three options, the node's address, the token,
  which still matches the node's). The node: `main`'s `splatnode.sh upgrade`, with a `docker` wrapper standing in
  for the pull of a published 0.2.2 (it moved `latest` onto the local 0.2.2 build): "The splat node runs version
  0.2.2 (it was 0.2.0). Its jobs and token are kept. The previous image was deleted."
- **On 0.2.0**: SplatMe saw node 0.2.2; Continue trained 0.1.1's model from step 3,000 to 8,000 and imported it.
  Fix A with real Celery: the worker restarted during a training left its record frozen; after 103 s with no sign
  of life, one `GET revive` (what every signed-in page asks) took the training over within a second, and it
  completed. SplatMe → Tasks (View in 3D) and Administration → SplatMe ("The splat node is ready.") loaded
  without console errors.
- Cleaned up: `splatnode.sh uninstall --yes` (the jobs' volume, the tag), the stack's containers, volumes and
  network, the task copy. The dev stack and its node were not touched.

**Run again after "The rest of the review's findings" (2026-11-17)**, the same way, with `dist/splatme-0.2.0.zip`
from e7fd2b6 (SHA-256 `b31c05a5…`) and a node image built from that commit's `node/` (`splatme-node:relcheck`;
the dev stack's image predates the fixes). Added: an upgrade under a running training, and Continue on node 0.2.0.

- **On 0.1.1** (published zip, SHA-256 the same as the release's): node 0.2.0 installed from ghcr.io by the
  published `splatnode.sh`; a Draft trained and imported in 2 minutes; the defaults, the administrator's options and
  the task's automatic training saved.
- **The plugin upgraded under a running training**: a 7,000-step training of 0.1.1 on the node (step 520) while
  SplatMe was deleted, 0.2.0 loaded and WebODM restarted. 0.1.1's worker job died with the restart; the record
  stood still for 106 s; one `GET revive` and 0.2.0's follower took it over within a second (step 4,010 by then),
  and it completed and imported through `replace_files` (`.rad`, `.ply`, options; no staged file left). The record
  gained 0.2.0's fields (`waiting`); every setting was as before, and the token still the node's.
- **Continue on node 0.2.0** (no `ref`, which an older node refuses): 7,000 to 10,000 steps, imported.
- **`splatnode.sh upgrade` during that training, with no terminal**: refused with "…Upgrade once it is done, or run
  again with --force.", exit 1, the node and the training untouched. Once idle: "The splat node runs version 0.2.2
  (it was 0.2.0). Its jobs and token are kept. The previous image was deleted." (a `docker` wrapper standing in for
  the pull of a published 0.2.2).
- **On 0.2.0 with node 0.2.2**: Continue 10,000 to 13,000; the node's `GET /jobs?ref=<run>` found the job. WebODM's
  worker restarted mid-training: the record stood still until SplatMe's pages were opened (GET only), whose revive
  took it over; it completed and imported (iteration 13,000). SplatMe → Tasks (View in 3D) and Administration →
  SplatMe ("The splat node is ready.") without console errors. The Dashboard showed WebODM's welcome page: the
  throwaway had no processing node, so it lists no projects (WebODM's behaviour, not SplatMe's).
- No error or traceback in the webapp's, the worker's or the node's logs; the webapp logged both takeovers.
- Cleaned up as before (and the `relcheck` image); the dev stack and its node not touched.

### Fixes from the review of 0.2.0 (built)

Each with a test seen failing first, then passing (Django 99, Jest 75 with `__tests__/api.test.js`, the node's 40):

- **A**: `training.revive()` takes over every stale job when any task completes or fails (`task_completed`, and a
  new `task_failed` receiver, after the task's own handling) and from any signed-in WebODM page (`main.js` asks
  `GET revive`, 204), at most every 30 s a process (`REVIVE_EVERY`). The follower (`follow_node`, its pass now
  `follow_all`) survives its own errors, closing the database connection; 30 in a row (`FOLLOWER_ERRORS`) end it
  for the next revive to start another. Live: every signed-in page asks it, the login page does not.
- **B**: an HTTP error from the node gets the hour of patience a silent node gets ("Waiting for the splat node to
  answer (it answered 502)"); a training that fails for the node is dropped there. The fake node answers errors on
  request (`failures`).
- **C**: the heartbeat closes a broken database connection.
- **I**: Show Log gives a non-administrator `UNAVAILABLE` rather than the node's error.
- **J, K, L, M**: the Tasks page retries a failed first load and asks again for a list that crossed a row's
  action; the Splats line says why it has nothing ("Sign in again…" for a 403); a request with no answer says
  "WebODM did not answer…" (`api.js`'s `sendTo`); `training.unlisted()` gives the reason a task is not listed
  (the status' `unlisted` with `?listed=1`), shown on the Splats line. Live: a 502 on the first list, then the
  rows 15 s later; a 403 on the line, then its message.
- **P**: CUDA 12.8.2 base images (devel `sha256:7fc48a36…`, base `sha256:b382332b…`, from Docker Hub 2026-11-16),
  `apt-get upgrade` in the final stage. Built and a 3,000-step training of a 217-photo task completed (90 s) on a
  throwaway node; the dev node rebuilt on it.
- **Q**: `splatnode.setting()`: a value that is not a number of at least 1 is logged and its default used (checked
  in the throwaway node's log with `SPLATNODE_STALL_MINUTES=abc`).
- **T**: the node job checks the tag against the manifest before anything is pushed (its script run for v0.2.0
  and v0.2.1).
- **The documentation**: the corrections and removals listed in the review, and `admin.png` retaken (node 0.2.2).

### Release review of 0.2.0 (done)

Asked 2026-11-16, before 0.2.0's tag: a review for bugs and weak areas to harden before SplatMe is published in
WebODM's plugin directory, and of the documentation for accuracy and for saying only as much as it should (a
statement that does not help its reader is removed). The user made it a rule for every release unless they say
otherwise (`CLAUDE.md`; the procedure is the `release-review` skill).

**Builds on** the review of 0.1.1 ("Fixes from the release review (built)"), whose findings were all fixed in
0.2.0. This one reads what changed since `v0.1.1` (37 commits, 44 files) in full, including those fixes (the
follower job of J, the install script's rework), the guided setup and the docs site; then the whole product again
for weak areas, as that review did not look at hardening (limits, timeouts, resource use) or the dependencies'
state. It runs after "The splat node made robust" and applies its lessons to the rest: the plugin's own unattended code (the
follower job and its heartbeat in `training.py`, `splatnode.sh`) gets the same failure-by-failure probing, run, not
only read.

**The parts, read in parallel** (one subagent each, briefed with its files and the skill's lenses; each finding
checked again in the code before it is reported):

- The plugin's Python: `training.py`, `api.py`, `node.py`, `sky.py`, `crop.py`, `thermal.py`, `plugin.py`,
  against WebODM 4.0.0.
- The pages: `splatme/public`, `splatme/templates`.
- The splat node and the release: `node/` (service, Dockerfile, script, compose), `release.yml`,
  `dev/build-zip.sh`, the zip's contents; every pin checked again under the vetting rule.
- The documentation: `docs/`, `README.md`, `CHANGELOG.md`, the pages' own text. Each statement checked against the
  code or a run; each removal and correction listed.

Then a live sweep of the pages on the dev stack (reading only, 320 and 1,280 px, administrator and plain user).

**What comes out:** the findings here, lettered, each with a concrete failure, its weight and whether it was
checked; what was found sound. No change is made during the review.

**Decided with the user (2026-11-16):** the recommendation: A, B, C, I, J, K, L, M, P, Q, T and the documentation go
into 0.2.0; the rest waits, to be reviewed with the user before a release. Then (2026-11-16) the user chose to fix the
rest before 0.2.0 too: "The rest of the review's findings". **Was open:** which go into 0.2.0 and which wait; for the documentation, the list of
removals and corrections is shown before it is applied.

**Found (2026-11-16).** Four parts read in parallel (the plugin's Python, its pages, the node and the release, the
documentation), each finding then re-read in the code; the plugin's follower and the install script were also made
to fail ("run"). No data loss, no permission, CSRF or XSS hole; the 0.1.1 fixes hold. Weights: medium unless marked.

*Unattended trainings (training.py)*

- A. Nothing restarts a lost follower or worker job until someone opens a SplatMe page (run: a database error ends
  the follower; another task completing restarts nothing; a status request does). An automatic training left
  overnight is not imported, and after the node's 48 hours its model is gone ("no longer has this job").
- B. One HTTP error from the node fails every training it has (run: one 502 → failed, the job left training on the
  node). A node behind the documented HTTPS proxy answers 502 while it restarts; a changed token answers 401. The
  hour of patience applies only to a node that does not answer at all.
- C. (low) After a lost database connection the heartbeat never reconnects (no `connection.close()` in its
  `except`): a long silent step is taken over and started again. Plausible.
- D. (low) A stale record replaced by Train or an automatic start leaves its node job training, unfollowed.
- E. (low) Two first Train requests at once make two rows for one key; WebODM's data store then deletes both and
  sets nothing (checked in `app/plugins/data_store.py`): the next start returns no state and trains nothing.
- F. (low) The follower's time-left samples are kept per task, not per training: a task trained again while the
  follower lives starts from the old samples.
- G. (low) The takeover limit counts time a job waits in WebODM's worker queue; its failure while importing deletes
  the finished model on the node. Plausible, rare.
- H. (low) splat-tools runs with no timeout; a failure between the final file moves leaves `splats.rad` replaced but
  the task failed; a non-JSON answer from the node (a proxy's page) shows as "Unexpected error"; an upload whose
  answer is lost leaves the node training it unfollowed.
- I. (low) Show Log answers a public task's anonymous viewer with the node's error text (its address), which Test
  Connection hides from non-administrators.

*The pages*

- J. (low) The Tasks page never retries a failed first load (WebODM restarting when it opens: "The request failed
  (502)." until reloaded); a list answer dropped while a row's action answers can leave a new task unshown.
- K. (low) The Dashboard's Splats line spins forever after a 403 or 404 (an expired session), with no message.
- L. (low) Network errors show the browser's text ("Failed to fetch").
- M. (low) A task SplatMe does not list is told its photos are not JPEG even when the reason is another (compacted,
  missing assets); the Tasks page's empty text leaves out thermal TIFFs.
- N. (low) The Tasks list re-reads every task's folder every 15 s while any task processes, whatever project is
  chosen, also in a hidden tab.
- O. (low) Labels not tied to their fields (Steps, Image Size, Max Gaussians, Quality, Thermal Colours, More Steps);
  a failed New Task With Splats resets the typed task name; Title Case differs for short words ("How to Install a
  Splat Node", "Use The Administrators' Defaults").

*The splat node and its script*

- P. The CUDA 12.8.1 base images are 20 months old and, by NVIDIA's support policy as the reviewer read it, past
  their end of support since 12.8.2 (2026-04-30): Docker Hub may delete them, and then no new node image builds.
  Both tags are still there today. The fix is 12.8.2 (same libtorch), node 0.2.3, and a GPU training again.
- Q. (low) The node's settings are not checked (run: `SPLATNODE_STALL_MINUTES=abc` → a traceback and a restart
  loop; by the code, 0 stops every training at once and a negative keep-hours expires every result).
- R. (low) A trainer stuck past SIGKILL (in the driver) is waited on forever with `/health` ok; a stale heartbeat
  only makes `/health` 503, which Docker does not act on. A job deleted in the moment before its trainer starts can
  return after a restart.
- S. (low) `upgrade` restarts the node during a training without a warning (`/info` says whether one runs);
  `connect --webodm` on a standalone node closes it to other machines without saying so; `status` on a stopped node
  does not say how to start it.

*The release*

- T. A tag whose version is not the manifest's still pushes the node's image as `latest` (the node job runs first;
  only the plugin job checks the version): `splatnode.sh upgrade` then installs a node no release describes.
- U. (low) Any ghcr error reads as "not published" and the version is built again over the published one; a tag
  on an older commit moves `latest` back; the login step puts the token in its script rather than its environment.

*Dependencies (checked 2026-11-16)*: OpenSplat is its main branch's head; the actions are their latest releases,
pinned by SHA; the docs' lock is the latest of each, no advisories. libtorch 2.7.1's advisories are in Python's
`torch.load` and RPC, which OpenSplat does not use: kept, an upgrade planned with new output samples. Dev tools only:
eslint 10.15.0 fixes a moderate minimatch advisory (jest's copy has no fix yet); Django 5.2.19 fixes 5 CVEs in the
IDE pin, which mirrors WebODM 4.0.0's 5.2.18 (the runtime is WebODM's).

*The documentation*: 20 corrections and 22 removals, listed for the user before they are applied. The main ones:
the image is a 4 GB download (6.6 GB unpacked; the script's uninstall says 10 GB); the install with several WebODMs
stops and names them, it does not ask; continuing "or beyond" does grow the model; the DJI plugin's button is DJI
Thermal Task; a trained task's button is Train Splats Again; the admin screenshot shows node 0.2.0 and lacks How to
Install a Splat Node; the README's Requirements and Status sections (on the docs' Home already); internals and
history in Using SplatMe and Install.

*The live sweep*: the Dashboard, SplatMe → Tasks, SplatMe → Settings and Administration → SplatMe at 320 and
1,280 px, as an administrator and a plain user (403 on the administrators' page, WebODM's own): no console error, no
sideways scroll.

*Sound*: permissions on every view, the token never in a page or log, CSRF on every write, no unsafe HTML, inputs
parsed against ranges and whitelists, every node request with a timeout, work folders cleaned, job state changed
under row locks with run ids, the sky model checked by SHA-256, upgrades from 0.1.1 records; the node's design as
built (transitions, deadlines, trash, broken/, path checks, timing-safe token); the script's quoting, its undo of a
failed install, no sudo; the workflow's per-job permissions and SHA-pinned actions.

### Fixes from the release review (built)

A review of 0.1.1 before SplatMe goes into WebODM's plugin directory (2026-11-16): the plugin's Python, its pages,
and the install and upgrade path, each read against WebODM 4.0.0's code, then a sweep of the live pages (the
Dashboard, SplatMe → Tasks, SplatMe → Settings, Administration → SplatMe; 375 and 1,280 px wide, as an
administrator and as a plain user). The sweep found no layout breakdown and no script error. The top finding of each
part was checked again in the code ("checked"); the rest are as the review read them. Nothing here is a data loss or
a security hole; the tokens, permissions, CSRF and file handling were found sound.

**Install and upgrade (node/splatnode.sh, the release workflow, the README)**

- A. `upgrade` and `status` stop silently when the node does not answer (checked: `node_version`'s failing curl
  ends the script under `set -euo pipefail`, exit 7, no message), so the command for a broken node does nothing.
- B. `install` joins the WebODM webapp's alphabetically first network: behind a reverse proxy (`proxy`,
  `traefik`…) Test Connection passes from the webapp while the worker, which runs the trainings, cannot reach the
  node.
- C. `connect --webodm` saves `http://splat-node:3100` in a WebODM that is not on the node's network, and says it
  worked.
- D. Each node upgrade leaves the previous image (6.6 GB) behind; uninstall removes only the current one.
- E. The release workflow builds the node's image only when its version is new: a node change without a version
  bump never ships, a failed `latest` push is never repaired, and the release (with `releases/latest`'s
  `splatnode.sh`) goes live before the image is built.
- F. The README's `./webodm.sh restart` restarts WebODM without the options it was started with (`--port`,
  `--media-dir`, `--ssl`…): its projects can seem gone.
- G. A failed install (port taken, health wait over) leaves `compose.yml`, and `install` then refuses to run
  again; the port is not checked first.
- H. The 6.6 GB image is downloaded before the GPU check (which needs it), and kept when the check fails.
- Lower: `upgrade` reports success when the registry is unreachable (it takes the image as a local one); `upgrade`
  never rewrites `compose.yml`; the printed address (`hostname -I`) can be a Docker or WSL one; exported
  `SPLATNODE_*` variables override `.env`; uninstall clears SplatMe's address but keeps the token; `GET /info` runs
  `opensplat --version` and `nvidia-smi` under the node's lock; finished jobs are not expired while the queue is busy;
  on WebODM older than 4.0.0, Load Plugin (.zip) says it installed SplatMe, which then does not show (WebODM's).

**Trainings (splatme/training.py, node.py, thermal.py, crop.py)**

- I. A task processed again while its splats train gets the old model (checked: the import looks only at the
  status and `georeferenced_model.laz`), and its automatic training is skipped as "already being trained".
- J. Every training holds one of WebODM's worker slots until it ends, even while it only waits in the node's queue:
  many automatic trainings at once can starve WebODM's own processing for hours.
- K. A dropped connection while the model downloads fails a training that finished (the node keeps the model 48
  hours, nothing fetches it again); a node unreachable for 5 minutes fails the job without cancelling it there.
- L. Continue uses the options of the task's last training, not of the one that made the model (checked): after a
  canceled or failed training with other options, Continue sends a model with the wrong SH degree and image size.
- M. Any `.png` or `.tif` in a task's folder hides a JPEG task from SplatMe → Tasks (ODM's `_mask.png` masks,
  `align.tif`), and a GCP or `geo.txt` file makes a thermal task "not thermal" (checked for the first).
- Lower: a job whose worker is killed (memory) is started again every minute while a page is open; the heartbeat
  thread stops on Django's `InterfaceError`; Cancel is ignored once the import starts; a slow node answer after a big
  upload leaves a job nobody follows (15 s timeout); Crop To Boundary keeps what is in a boundary's holes; the
  thermal range holds every photo's sample in memory (about 1.2 GB for 5,000 photos); the status 500s for an
  anonymous viewer of a public task; `onnxruntime` (Ignore Sky) comes with WebODM's `geodeep`, not its own
  requirements.

**The pages (splatme/public)**

- N. On SplatMe → Tasks, another project's New Task With Splats replaces a box that is still uploading (checked):
  the upload goes on unseen, without its warning on leaving the page or its Try Again.
- O. Closing Train Splats (or Change) while Start Training (or Save) is answering loses the answer (checked): the
  training runs, the row shows no progress and stops refreshing.
- P. A refresh that lands between a task completing and its automatic training starting stops the refreshing for
  good, on the Tasks page and in the Dashboard's Splats line.
- Q. The Dashboard's Splats line stops following after one failed request (WebODM restarting, a network blip).
- R. While anything trains, the Tasks page asks for every task (each listing its images folder) every 3 s.
- Lower: the task links miss projects after the Dashboard's first page; a task SplatMe cannot train still gets
  Open in SplatMe, and New Task With Splats accepts non-JPEG photos; SplatMe's click guard in the New Task panel
  also blocks WebODM's other primary buttons there; Enter in More Steps can send Start Training twice; an older
  refresh can overwrite an action's answer; the dialogs do not hold the keyboard's focus; the progress row is too
  wide below 340 px; another plugin's button can land after SplatMe's in the project's button group.

**Decided (2026-11-16, the user):**

- **Everything found goes into 0.2.0**, the lower items and J included (proposed was all but J, R, the dialogs'
  focus and the rest of the lower items). Then a release, checked on a throwaway WebODM as 0.1.0 was, and the
  directory entry with 0.2.0.
- **A task processed again while its splats train** (I): the training is cancelled when the new processing
  completes, and a task set to Train Splats When Completed is then trained again on the new results; otherwise its
  row says the training was cancelled because the task was processed again.

**Design of J** (WebODM runs a plugin's work only through `run_function_async`, and its beat schedule has no room
for a plugin): a training's own job ends once its photos are on the node. One follower job follows every training
the node has queued or running, and imports each as it finishes. It is started, when no live heartbeat in the data
store says it runs, by a training's upload and by the status requests; it ends when no training is left on the node.
That makes one worker slot for all the trainings waiting on the node, rather than one each. The export and the
import still take a slot while they run.

**Build order:** install and upgrade (A–H and their lower items), then the trainings (I, K–M, J, the lower
items), then the pages (N–R, the lower items), each on its own branch with its tests; then the release branch.

**Built and checked (2026-11-16):**

- Install and upgrade: `node/splatnode.sh` against a throwaway WebODM whose webapp was also on a proxy's network
  (`aaa-proxy`): the worker's network chosen, the refusals (two WebODMs, a port in use), a failed install undone
  (a volume it made removed, one an uninstall kept left), status and upgrade with the node stopped, the previous
  image deleted (a `docker` stand-in moved the tag as a pull would), connect moving the node, uninstall clearing
  the token. Not exercised: the GPU check failing after a real download. The release workflow's version check run
  locally: it passes on this branch and fails on 0.1.1's `main` (0.2.0's image files changed after its version).
- Trainings, with real Celery on a throwaway WebODM with a copy of ThermalTest and a throwaway node: while the node
  trained, the worker ran one job (the follower); the export and the import each ran as their own job; Continue
  of a 0.1 model refused without its record, then trained with the model's options; a reprocess (point cloud
  touched, model removed, `completed()` called) canceled the training, dropped its node job and trained again;
  a cancel while the follower held the training kept the model.
- Pages, on the dev stack (reading only): the Tasks page's links (`?id=`) show one project with the task open, the
  dialog keeps and gives back the focus, SplatMe's button stays last, no sideways scroll at 320 px, New Task With
  Splats names a PNG. On the throwaway: Train Splats stays open while its start is answered, only the training's
  row is asked for while it trains (0 lists in 20 s), the list goes on after a task completes (4 in 12 s).
  Not exercised live: New Task With Splats' buttons during an upload (the throwaway had no processing node
  online); covered by the code and Jest.
- Release check: 0.1.1 installed and trained on a throwaway, then upgraded with Load Plugin (.zip) (refused over
  it, then delete, load, restart): the task's record, setting and the node's address kept; node 0.2.0 upgraded to
  a local build of 0.2.1. `dist/splatme-0.2.0.zip` from 7825736: sha256
  `48885cc90306717566d883ad2ab90bcf572b3f803b2bdf4255383030c74170ac`.

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

### Task Options (built, then replaced by New Task With Splats)

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
  not one of WebODM's plugin hooks: it goes when WebODM tells plugins of a created task (phase 2).
- **Not built: SplatMe's row in the New Task panel** (chosen as "Both": the row and the button in the dialog).
  WebODM stops listening to a hook after the first plugin's answer (`ApiFactory.js` removes the listener one
  tick after the first response). Lightning, a core plugin, answers `addNewTaskPanelItem` after loading a
  script; an immediate answer from SplatMe arrives first and Lightning's cost estimate is dropped (tried in
  a browser on the dev stack: with a second plugin answering, the panel has that plugin's item and Lightning
  never asks `is_lightning_node`). Held until the dispatcher is fixed in WebODM (phase 2).

### SplatMe's panel (built)

The user's request (2026-11-15): instead of a button in the Options row of the New Task and Edit Task panels,
a SplatMe settings panel above them, as webodm-dji-thermal's Measurement panel above its New Task panel (its
`ThermalTaskPanel.jsx`). Decided:

- **New Task**: SplatMe's panel shows only on a New Task panel opened with New Task With Splats (and on one
  opened another way when that button is pressed while it is open), with Train Splats When Completed ticked.
- **Edit Task**: SplatMe's panel shows above every Edit Task panel; it replaces the task panel's "Train Splats
  When Completed" Change link and its dialog.
- **WebODM's own New Task panel and upload stay** (DJI Thermal draws its own copy of `NewTaskPanel` and uploads
  itself, because it converts the photos; SplatMe does not need to, and keeps Resize Images and Alignment).

Built:

- Both panels are placed in the page, above WebODM's (`.new-task-panel` in the project, `.edit-task-panel` in
  the task list), as DJI Thermal places its own: not a WebODM hook. Without the place, no panel and WebODM's
  works as ever.
- The choice waits on the page with WebODM's panel and goes to the task when WebODM's own request for that
  panel succeeds: the task's creation (New Task) or its PATCH (Edit Task's Save). Cancel drops it. Review,
  Start Processing and Save wait while SplatMe's numbers are wrong (the panel says why).
- **Which task an Edit Task panel edits** is read from the props React gave WebODM's `EditTaskPanel`
  (`taskOfPanel` in `EditTaskSplats.jsx`): the page names it nowhere and no hook gives it. This relies on React
  16's internals; a WebODM on another React would show no panel there until it is adjusted.
- The task's panel shows "Train Splats When Completed: On: …" only while the task is set to train, without a
  link (Claude's choice: the only sign left on the task, to be dropped if not wanted).

Checked in a headless browser on the dev stack at desktop and phone width, with the creation, the edit, the
setting and the uploads answered by the check (nothing written): no panel from WebODM's own button and the
button adding it; the panel above WebODM's, ticked; a wrong number holding Review; Start Processing sending
the chosen options; the Edit Task panel's choice sent after Save and not after Cancel. Not checked: a real
task trained from either panel.

### New Task With Splats (built)

The user's request (2026-11-15): instead of the control in the Edit Task Options dialog, a "New Task w/Splat"
button beside "Select Images and GCP", as the DJI Thermal Task button of webodm-dji-thermal. Decided:

- **It replaces** the Edit Task Options control ("Task Options (built)" above describes what is gone:
  `OptionsButton.jsx` and the `presetDialogOptionsReady` hook).
- **Only tasks created with the button are trained by themselves.** The administrators' default that trained
  every new task is gone; this replaces the 2026-11-14 decisions "every task that can train is trained" and
  "administrators set the default every new task starts from".
- **webodm-dji-thermal is not touched.** WebODM 4.0.0 keeps only the first plugin's answer to
  `addNewTaskButton` unless all answer at once: SplatMe answers at once, DJI Thermal after loading its script,
  so with both installed the DJI Thermal Task button does not show. Known and accepted; the dispatcher's fix
  is in phase 2. (Fixed since, in "Less fragile page parts": SplatMe places its button itself and no longer
  answers that hook.)

Built (the last two points are Claude's reading of the decisions, to be corrected if wrong):

- **The button** ("New Task With Splats", Dashboard, a project's row of buttons): the task is WebODM's own.
  The button presses WebODM's "Select Images and GCP" (the hook gives a plugin only the project), so the
  picker, the New Task panel, resizing and presets are WebODM's. The New Task panel that opens from that press
  is marked; a press of WebODM's own button or files dropped on the project cancel the mark. While the
  project's New Task panel is open the button shows the mark (pressed, with a tick) and switches it, so a task
  started from dropped files can have it too. The page gives the created task its setting as before
  (`newTaskSettings.js`, hearing WebODM's request that creates the task).
- **The options such a task starts with** are the administrators', on the SplatMe page's "New Task With
  Splats" section (what was the default's options, without the on/off). They are copied to the task when it is
  created; changing them later is for later tasks.
- **A task's panel keeps "Train Splats When Completed" with Change**, on every task: where the options of a
  button's task are changed and the training switched off, and where any existing task can be switched on.

Checked in a headless browser on the dev stack at desktop and phone width, with the creation, the setting and
the uploads answered by the check (nothing created): a panel from WebODM's button is not marked, nor after
SplatMe's picker was canceled; the button switches an open panel; a panel from the button is marked and
Start Processing sends the task's setting (`enabled`, `new_task`); the SplatMe page and the task's dialog.
Not checked: a real task created with the button and trained when it completes; both plugins installed.

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

### Continue training (built)

Decided with the user (2026-11-14): the model to continue from is kept in the task's folder at WebODM, not
only on the node; continuing is a choice in the Train Splats dialog (Start Over / Continue From Step N, then
More Steps), not a button of its own.

- OpenSplat 1.2.2 continues only from a `.ply` (`--resume`; a `.rad` is refused), whose header holds its steps
  (`comment Generated by opensplat at iteration N`); `-n` is the total; the photos are needed again. So the
  node's result is now the `.ply`, and the plugin makes the viewer's `.rad` with WebODM's `splat-tools`, as
  WebODM's own upload does (a level-of-detail `.rad`).
- The `.ply` is `assets/splats/splatme-model.ply` (about 250 bytes per gaussian). Processing the task again
  deletes it with the task's assets. A model uploaded since in WebODM's Splats dialog is newer than it, and
  then nothing is continued. Its steps are read from its header, not from the plugin's record.
- Continuing keeps the earlier training's options (from the task's record; the defaults when it is gone) and
  sends the `.ply` in the training zip as `resume.ply`. Automatic training always starts over.
- The trainer adds gaussians only during the first half of the total steps, so continuing mostly refines the
  gaussians the model has. `--densify-until` could change that; not tried.
- An existing 0.1.0 node is refused with "Update the node".

### Ignore Sky (built)

Decided with the user (2026-11-14): of the masks SplatMe could make, the sky first, found automatically; an
area to train is the next phase (Crop); masks uploaded with the photos and moving objects are not planned.

Checked:

- OpenSplat 1.2.2 reads a mask per image from a `masks/` folder beside `images/` (`findMaskPath`,
  `input_data.cpp`): `<image stem>.png`, a pixel above 127 is trained on, the others ignored; it resizes the
  mask to the image. `--no-masks` turns that off.
- A task keeps no masks: ODX's sky masks (its `sky-removal` option) are made in the processing node and not
  returned.
- ODX's sky model (`skyremoval.zip` v1.0.5 from ODX's GitHub release, an ONNX model with a 384 x 384 input)
  runs with `onnxruntime`, which WebODM has (through `geodeep` in its `requirements.txt`). ODX's code around
  it uses OpenCV, which WebODM lacks: the plugin does the same with Pillow, NumPy and SciPy.
- The dev task (HomerunObliqueRGB) has no sky: its cameras look 40 to 50 degrees below the horizon or
  straight down. The stack has no other task.

Built:

- **Ignore Sky**, off by default; an option of the training (`ignore_sky`), kept when continuing. The node is
  not told: the masks are in the training zip as `masks/<image's name>.png`.
- The worker makes the masks after the export, from the exported (resized) photos, in a stage of its own
  ("Finding the sky"). The sky is looked for only above each photo's horizon, from the shot's rotation and the
  camera's focal length (less a 5 degree margin); photos with nothing above it never load the model. A fisheye
  or a panorama is searched whole.
- The model is downloaded once, checked against a pinned checksum, into the plugin's persistent folder
  (`media/plugins/splatme/models`).
- A finished training says in how many photos sky was found (`sky_masks`).

Checked on the dev stack (2026-11-14), in a process of its own that left the task's model alone: the export of
959 photos with stand-in masks, sent to the real node, which logged "Found 414 masks" and trained. The real
model over the same export: before the horizon limit it masked bright patches (0.5 to 4 % of the picture) in
125 photos of a task that shows no sky, which is why the limit was added; with it, 6 photos are searched and 1
gets a mask (0.6 % of it, at its upper edge). The dialogs and the page in a headless browser, desktop and phone.

**Not measured, by the user's decision (2026-11-14): whether it improves a model.** The dev task shows no sky.
The mask's edge (the guided filter's radius at the mask's size) is untried on real sky.

Not usable from a task: the mesh, the DSM and depth maps. OpenSplat v1.2.2 has no depth or normal supervision,
and the task keeps no depth maps or undistorted photos (OpenSplat undistorts from the camera model itself).

### Crop To Boundary (built)

The user's request (2026-11-14): crop the splats with a GeoJSON file, as the model can be; the crop comes from
the task's GeoJSON.

Checked: the dev task was processed with WebODM's Boundary option (a GeoJSON polygon in the task's options,
WGS84), to which ODX cut the point cloud; `Task.crop` (the Crop button on the task's map) is something else,
empty there, and WebODM's 3D view already hides splats outside it. The trained `.ply` is in the task's
projection less WebODM's export offset (`get_rtc_offset`), so the boundary projects straight onto it. Of the dev
task's 252,780 gaussians (12,000 steps) 6,134 (2.4 %) lay outside its boundary, up to about 2 m.

Built:

- **Crop To Boundary**, a checkbox in the Train Splats dialog (only for a task with a boundary), the Train
  Splats When Completed dialog and the SplatMe page's Automatic Training form; ticked unless turned off
  (the option `crop` is stored only as false).
- The crop is made when the model is imported, on the gaussians' centres, before WebODM's converter. The
  `.ply` kept for continuing is not cropped. A boundary with all or none of the model inside crops nothing.
- The training still sees the photos whole: no masks and no cut of the starting cloud (ODX already cut it).

Checked on the dev stack: the task's real model cropped into a scratch file (246,646 of 252,780 kept, 0.1 s)
and converted by WebODM's converter; the dialogs and the page in a headless browser. Not checked: a training
from the browser, and the cropped model in the 3D view.

### Time left (built)

The user's request (2026-11-15): the estimated time left beside the current step and the total, in the task's
panel while a training runs ("Training Splats: Step 4,650 of 7,000, about 12 min left").

Design (no decision open), built so:

- **Worked out where the training is followed**: the worker's loop that asks the node for its job every few
  seconds (`training.py`, `follow`). It keeps the steps it saw with their times, in memory (the loop is one
  process), and works out the rate from the last few minutes, not from the start: OpenSplat's steps slow down
  as the model grows (it adds gaussians until well after 7,000 steps), so an average from the start would
  promise too little time.
- **Shown once it means something**: after half a minute of steps and some tens of steps; before that only
  "Step N of M". Rounded: "less than a minute left", "about 12 min left", "about 1 h 20 min left" (the panel
  already writes durations this way, `trainingView.js`'s `duration`). A continued training counts only the
  steps of this run (the node's step starts at the model's own).
- **The steps only**: the stages before (exporting, finding the sky, sending) and after (importing, cropping)
  are not in it; the text says "left" of the steps, beside "Step N of M". The node's API is unchanged.
- Tests: the estimate from a series of (time, step) samples, as a plain function (Django test), and its text.

Built: the samples are kept for the last 3 minutes plus the latest one before (`keep_window`); the estimate
shows after 30 s and 20 steps of this training; the status also has `time_left` in seconds, cleared when the
model is imported. The step numbers are now written with thousands separators. Not checked: a real training
(the worker runs a training with the code it loaded, so it shows from a training started after WebODM's
worker restarts).

### SplatMe in Administration (built)

The user's request (2026-11-15): changing the splat node's address and token moves to a SplatMe item under
Administration in the side menu, so only administrators can change it; the node's information (state, GPU,
OpenSplat, jobs) stays on the side menu's SplatMe page too, with the configured Node Address, so every user sees
it. Checked in the code: WebODM's Administration list is fixed in `logged_in_base.html` (drawn only for staff
accounts), and plugins have no hook to add to it; `main_menu()` items show to every user.

Decisions (2026-11-15, the user's):

- **Under Administration**, placed by `main.js` (every page): after WebODM draws the side menu, a "SplatMe"
  item is added at the end of Administration's list (found by its Plugins link, `/admin/app/plugin/`). Not an
  official hook: if a WebODM changes the menu, the item is missing and the page still works by its address.
- **New Task With Splats defaults: each user their own.** On the side menu's SplatMe page every user saves their
  own set, which fills their New Task With Splats panel (and an Edit Task panel of a task with no setting yet).
  The administrators' set, edited on the admin page, is the starting point for users who have not saved one;
  "Use The Administrators' Defaults" drops a user's own set.

Design:

- **The admin page** (`/plugins/splatme/admin/`, new mount point, title "SplatMe"): the node's information, the
  Node Address and Token form with Save and Test Connection (moved from the SplatMe page), and the
  administrators' New Task With Splats defaults ("for users who have not saved their own"). For superusers, as
  today's settings are; a staff account that is not a superuser sees Administration and so the link: the page
  shows it the information read-only and says only a superuser can change it. Other accounts get WebODM's 403.
- **The SplatMe page** (side menu): the node's information plus "Node Address: http://splat-node:3100" for every
  user (the token is never shown); for superusers a link to the admin page; the user's own New Task With
  Splats form.
- **API**: `node` gives `url` to every user (POST stays superusers only). `automation` reads and saves the
  user's own defaults (any user; `own` says whether they saved one; a reset drops it), kept in the plugin's
  per-user data store (`get_user_data_store`); `automation/shared` (superusers to save) holds the
  administrators' set, the store key used today, so a saved default carries over. A task's own setting is
  unchanged: it is saved on the task when created or edited, and the worker reads only that.
- Tests: Django for the address shown to a plain user, each user's defaults and the starting point, the admin
  page's permissions; the browser check of both pages as a superuser and as a plain user (writes answered by
  the check), and of the Administration item at phone width.

Built so. The admin page's 403 for other accounts is Django's own. Checked in a headless browser as the dev
superuser at desktop and phone width (the item, both pages, the saves answered by the check); a plain user's
SplatMe page was checked by answering the node and options reads as the server answers a plain user (the
server side of that is in the Django tests), not with a second account.

### SplatMe's Tasks page (built)

The bug (found 2026-11-15, when the user asked whether the button clash remains): WebODM stops listening to a
hook one moment after the first plugin's answer (`ApiFactory.js`). SplatMe answers the task panel's
`addTaskActionButton` at once, so a plugin that answers after loading its script loses its button on the first
task panel opened after each page load (its script is cached for the next). Seen in a headless browser with
Lightning's Share button (a core plugin; shown only with a Lightning key, given to its script in the check's
browser): missing on the first panel with SplatMe, shown on both with SplatMe's script blocked. Cesium ion
answers the same way (from its code, not run). DJI Thermal's panel buttons answer at once and show beside
SplatMe's, but drop those plugins' buttons by themselves too. SplatMe's own button is not at risk.

The user's proposal (2026-11-15): SplatMe stops answering that hook and manages training on its own page,
where it has complete control, through WebODM's API and its own; settings move to a Settings page.

Decisions (2026-11-15, the user's):

- **SplatMe → Tasks and SplatMe → Settings**: the side menu's SplatMe item becomes a submenu. Settings is
  today's SplatMe page (the node's state and address, the user's own New Task With Splats defaults).
  Administration → SplatMe stays as built.
- **The task panel keeps a small line**, placed by SplatMe without a hook (as the New Task With Splats button):
  "Splats: trained, 7,000 steps · Open in SplatMe" (or training, its step; or none), opening the task on the
  Tasks page. If a WebODM draws the panel differently, the line is missing and nothing else is lost.
- **SplatMe's panel above Edit Task goes**: a task's Train Splats When Completed and its options are set on the
  Tasks page only. The panel above New Task (New Task With Splats) stays.
- **Creating a task in SplatMe is a later phase**: until then the Tasks page's New Task With Splats points to
  the Dashboard's button. (Built since: "New tasks in SplatMe (built)".)

Design:

- **The Tasks page** (`/plugins/splatme/`, Settings moves to `/plugins/splatme/settings/`): the tasks the user
  can see, by project (a project filter), each with WebODM's status, its splats (none, training with the step
  and time left, trained with its steps and time, failed with the reason) and its actions: Train Splats or
  Train Splats Again (continue), Cancel, Log, View in 3D (WebODM's 3D view), and Train Splats When Completed
  with Change. Tasks that cannot be trained (failed, canceled, not JPEG) say why. `?task=<id>` opens on that
  task. Built by webpack from today's parts (`TrainSplats.jsx`, `TrainDialog.jsx`, `AutoDialog.jsx`,
  `LogDialog.jsx`, `trainingView.js`), for mobile too.
- **One request for the page**: a new `tasks` API lists the tasks the user may see (WebODM's project
  permissions, as `find-task` does) with each one's SplatMe status, so the page does not ask once per task; it
  asks again every few seconds while a task processes or trains.
- **The task panel's line**: found by the expanded panel's "Task ID" (the id WebODM prints there), not React's
  props; `task/<id>/status` for its text.
- **Removed**: `addTaskActionButton` in `main.js`, `EditTaskSplats.jsx` and `find-task`, and the Edit Task
  part of `panelSettings.js`.
- Tests: Django for the `tasks` list (permissions, statuses); Jest for what a row shows; the browser check of
  the Tasks page (desktop, phone), the panel's line, and Lightning's Share button on the first panel opened
  (with its script given a key, as in the bug's check).

As built (2026-11-15): as designed, with these details. Each row's `TrainSplats.jsx` is given its status by the
page and has no timer of its own; the page asks for the list every 3 s while a task trains and every 15 s while
one processes (`trainingView.nextRefresh`), not otherwise. A task's name opens it on the Dashboard; a task that
cannot be trained shows View in 3D when it has a model, and why. `tasks` leaves out tasks still receiving their
photos (`partial`), as the Dashboard does, and takes `?project=<id>`; it calls `training.follow` for each task,
as the status does, so a job that lost its worker is taken over from the page too. The panel's line is a row of
WebODM's info table under Task ID, following a training (3 s) or a processing task (15 s) by itself. Checked in
a headless browser: panel 1 showed Share and SplatMe's line (Share was missing there before), no Train Splats
button; the Tasks page at 1280 px and 390 px (no horizontal scroll), `?task=` marking the task, the Train Splats
and Change dialogs, a training row and a failed task (the list rewritten in the browser). Checked as a real plain
user too (2026-11-15, a dev account the user made): the menu has Tasks and Settings and no Administration item,
the Tasks page lists only their own project, Settings shows the node and its address without the form, the
admin page answers 403, and `node` sends no `token_set`. Not checked: a list of many tasks (one request, but a
data store read or two per task); a project shared with a user for viewing only (Django tests cover it).

### New tasks in SplatMe (built)

SplatMe → Tasks creates a task itself, with Train Splats When Completed, and follows its processing and
training.

Builds on: the Tasks page (one `tasks` request, asked again while a task processes or trains), SplatMePanel
(Train Splats When Completed, Quality, Ignore Sky, Crop To Boundary, Advanced, from the user's New Task With
Splats defaults), `POST task/<id>/auto`, and WebODM's own task API, which its New Task panel uses
(`ProjectListItem.jsx`): `POST /api/projects/<pid>/tasks/` with `partial: true` (name, options,
processing_node, auto_processing_node, align_to, resize_to: resizing is done by the server), then each file to
`.../tasks/<tid>/upload/` (Dropzone's chunk fields optional; WebODM's nginx has no body size limit), then
`.../tasks/<tid>/commit/`, which starts processing.

Design (checked in WebODM's and webodm-dji-thermal's code):

- **New Task With Splats on the Tasks page**: a button in each project's heading (the user needs
  `change_project`, as for training). It opens the browser's file picker (WebODM's accepted types: images,
  text files such as GCP, geo.txt and image_groups.txt, .las/.laz, video, .srt, .dng, .nef, .gpx), then a
  panel in that project's section: SplatMe's panel (as on the Dashboard today) above **WebODM's own New Task
  panel**, imported from WebODM (`webodm/components/NewTaskPanel`, as webodm-dji-thermal does), so the name,
  processing node, options and presets, resize, align to and the GCP and map previews are WebODM's, and stay
  WebODM's when it changes them.
- **SplatMe uploads the task itself**: create the partial task, save its training setting with `POST
  task/<id>/auto` *before* any file goes (so it is there whenever the task completes, with no listening to
  WebODM's requests), upload the files a few at a time with retries (as webodm-dji-thermal's `upload.js`),
  then commit. The row shows the upload's progress; leaving the page while it runs asks first (it would stop
  the upload). If a file still fails after the retries: Try Again for the files left, or Cancel, which deletes
  the partial task.
- **Processing followed in the row**: WebODM's status with its progress (`running_progress`) and, for a failed
  task, WebODM's error (`last_error`); the `tasks` answer gains both. Then the training as today. Processing
  actions (cancel, restart, delete) stay on the Dashboard, linked from the task's name.
- Tests: Jest for the upload's steps (the order, retries, cancel) with WebODM's API stubbed; Django for the new
  fields; a browser check that creates a small task on the dev stack and deletes it afterwards (a write the
  user is asked about first).

Decided with the user (2026-11-15):

- **The Dashboard's New Task With Splats opens SplatMe's**: the button (still placed by SplatMe beside Select
  Images and GCP) goes to SplatMe → Tasks with that project's new task open (`?project=<id>&new=1`). A browser
  opens a file picker only on a click on that page, so the panel there starts with Select Images and GCP.
  SplatMe's panel above WebODM's New Task panel on the Dashboard goes, and with it the saving on hearing
  WebODM's requests (`panelSettings.js`): a task made from WebODM's own New Task panel is not trained by itself,
  as today, and can be set with Change.
- **Processing actions stay on the Dashboard**: the row shows the status, the progress and WebODM's error; the
  task's name links to its panel.

As built (2026-11-15): as designed. The page's New Task With Splats opens the file picker at once; from the
Dashboard (`?new=1&name=<project>`; WebODM's page does not print a project's id, so the link carries the name
WebODM prints in `.project-name`), the box opens with Select Images and GCP, or a project choice when the name
is not one project's. The new task's name is suggested from the first photo's date ("Splats - 9/8/2026"),
without WebODM's online place lookup. A task WebODM created after a cancel is removed at once; a commit is not
sent again by itself (a second commit would process the task twice). After the commit the task shows in its
project, marked. The Tasks page's bundle is 345 KiB (WebODM's panel, with its map preview, comes with it).

Checked (2026-11-15, the user approved the writes): read only, the Dashboard's link with the project's name, the
box from it, SplatMe's panel above WebODM's (processing node, options, resize), an option out of range stopping
Review, a creation refused (the panel back, with the reason), 390 px with no horizontal scroll. Live, in admin's
First Project: 3 photos uploaded from the page, the requests in order (create, `auto`, 3 uploads, commit), the
setting saved (Standard), the row "Running, 4%" with Train Splats When Completed On; then WebODM's own Cancel and
Remove. An upload canceled after the creation: `remove/` sent, the box closed, the files still in flight
refused (404). Afterwards neither task nor its setting was left. Not checked live: a file in parts (the photos
were under 8 MB; Jest covers the fields), Try Again after a failed file (Jest), a slow connection.

### Native Windows app (dropped)

Decided with the user (2026-11-15): **SplatMe requires Docker for the splat node on Windows too.** On WebODM's
native Windows app, the administrator runs the same node image in Docker Desktop (WSL2, NVIDIA driver), as on a
Docker install: the most prebuilt and reliable way for administrators, and the same experience for users. Dropped:
a native Windows splat node (a Windows CUDA build of OpenSplat and libtorch to publish and maintain) and the
worker running the trainer itself (gigabytes of binaries outside the plugin's zip, a second backend, training
competing with processing).

What the plugin needs from the native app, read in WebODM's code but not checked on the app: its plugin build
has Windows cases (`npm.cmd`, `webpack-cli.cmd` in `app/plugins/functions.py`), so the zip's page scripts should
build. Unknown: the app's WebODM version (SplatMe needs 4.0.0), whether it has `splat-tools` on its PATH (the
trained model's conversion, `training.py`), onnxruntime and SciPy (Ignore Sky), how its worker is restarted
(`restartText.js` says `./webodm.sh restart`), and the address WebODM reaches the node at (`localhost:3108` from
the host).

To check on the user's native install (it runs on their Windows machine): the version; the zip uploaded and
enabled, its pages built; the node's address saved and tested; one training, imported and shown in 3D; a task
trained by itself after the app's restart. Then the README's install steps for Windows and the restart wording.

Checked on the user's native app (2026-11-15, a throwaway instance; writes approved), from WSL through a
temporary relay (the app listens on Windows' 127.0.0.1 only):

- **WebODM 4.0.0** on Python 3.14 (waitress, Celery with eventlet, PostgreSQL 18, Valkey), in desktop mode (the
  login page signs the local user in).
- **No Node, npm or webpack**: WebODM's plugin build skips the page scripts, so **the zip must ship
  `public/build`** (it is used as is when present). A zip with the dev stack's build installed and enabled from
  Administration → Plugins; SplatMe → Tasks, Settings, its admin page and the Dashboard's buttons all worked, with
  no errors in the page.
- **The splat node in Docker Desktop is reached at `http://localhost:3108`** from the native app: Test Connection
  showed the node and its GPU. A thermal task was refused before starting (TIFF), as on Docker.
- **A Draft training ran to the end** (export on Windows, the node's training, the model downloaded) and then
  **failed: no `splat-tools`**. The native app has none anywhere, so WebODM's own Splats import cannot convert
  there either. Splat-Tools publishes a Windows build (v1.0.3, `x86_64-pc-windows-msvc.zip`) beside the Linux
  one WebODM's Docker image installs.
- `listening` is false until the app is restarted (not done: the app is the user's); the restart wording and
  "as seen from WebODM's own containers" on the settings pages assume Docker.
- Left on the instance: SplatMe installed and enabled, the node set, one failed training.

Dropped by the user after this check (2026-11-15): WebODM's native app is not ready for SplatMe, which is
fine. Not pursued: Splat-Tools' Windows build downloaded by the plugin, the node doing the conversion, a zip
with the page scripts built for the native app.

### Less fragile page parts (built)

The release is experimental, so some fragility is accepted; this lessens it without a pull request to WebODM
(the user's request, 2026-11-15). What is fragile: the Edit Task panel's task is read from React 16's
internals; the panels and the button are placed by WebODM's page markup; the choice is saved on hearing
WebODM's own requests; New Task With Splats presses Select Images and GCP.

Decided with the user (2026-11-15), and built so:

- **Never fail silently**: New Task With Splats that opens no New Task panel says so in the project; an Edit
  Task panel whose task is not found says the training cannot be set there; a setting that could not be saved
  says which task and why (not only in the browser's console); while WebODM's worker does not hear of
  completed tasks (not restarted since SplatMe was installed or updated), SplatMe's panel and a task set to
  train say that WebODM has to be restarted once (the status then tells everyone whether the worker listens,
  not only administrators).
- **A second way to find an Edit Task panel's task**: by its name in its project's task list, used only when
  exactly one task there has that name (agreed: a task cannot be renamed while it runs).
- **SplatMe places its button itself**, after the other buttons beside Import, instead of answering
  `addNewTaskButton`: WebODM 4.0.0 stops listening to that hook shortly after the first answer, so SplatMe's
  immediate answer drops DJI Thermal's (which answers after loading its script), and any other plugin's that
  answers late. Out of the hook, SplatMe drops none. (Agreed in principle; the Import menu and the New Task
  panel's item were weighed and have the same race.)
- **Change comes back** beside "Train Splats When Completed" in the task's panel, which shows the line on every
  task (Off too), with its dialog (Train Splats When Completed, Quality, Ignore Sky, Crop To Boundary,
  Advanced): the way to set the training that uses only WebODM's hooks (`addTaskActionButton`), so it works
  when the page-placed panels do not, and shows whether a task is set to train without opening Edit.
- For the release phase: a committed browser check run against each new WebODM before supporting it, and the
  page parts turned off on a WebODM newer than tested.

Built notes:

- `listening` comes from asking the worker (`run_function_async`, up to 5 s), remembered in the data store:
  10 minutes when it listens, 1 minute when it does not (`training.listens`); the SplatMe page asks afresh for
  administrators. The task's panel asks only for a task set to train.
- A save that was not heard: the panel's save button pressed last (Review, Start Processing, Save; Cancel
  clears it) and the panel closed with no request of WebODM's heard: a notice that the setting was not saved.
- `find-task` restricts to projects the user has their own permission on (`accept_global_perms=False`, as
  WebODM's project list): every user has the global view permission.

Checked in a headless browser on the dev stack (writes answered by the check): one button, in the project's
group; the panel, ticked, and the setting sent on Start Processing; a refused setting shown as a notice (phone
width); the task's line with Change and its dialog, and the warning in it and in the Edit Task panel's panel
while the status says the worker does not listen (the check changed the answer); the Edit Task panel's task
found by names with React's props removed, its setting sent after Save; "cannot tell which task" when neither
says. Not checked: both plugins installed together.

### Only compatible tasks on SplatMe → Tasks (built)

Requested 2026-11-15 (`new.md`): in the SplatMe Tasks view, don't show empty projects or projects that don't
have any compatible tasks.

Builds on: the Tasks page (api.py's `tasks`, one request; `Tasks.jsx`), `training.problem` (why a task cannot
train: not completed, no point cloud, compacted, cameras unreadable, images not JPEG, images gone) and New Task
With Splats in each project's heading.

Today (from the code and the native check): every project the user may see is listed, an empty one with "No
tasks in this project."; every task is a row, and a completed thermal task shows Train Splats, whose dialog then
says only JPEG images can be trained on. The Project filter lists every project.

Proposed:

- **A task is compatible** when its photos are JPEG (the image files in its folder, by extension: a directory
  listing, cheap for a list; `problem` reads the task's cameras, too slow for every row), whatever its status:
  one still processing is listed, and trains when it completes. Tasks that already have splats are always
  listed. Decided by the server, in `tasks`.
- **A project is listed when it has a compatible task**; the Project filter lists only those.
- **New Task With Splats for a project not listed** (an empty one, the user's first): a New Task With Splats
  above the projects, which opens the box with its project choice (`NewTask.jsx` has it, for the Dashboard's
  link when the name is not one project's). The Dashboard's button keeps opening the box for its project, listed
  or not.
- When nothing is listed: a sentence saying no task can be trained yet, with New Task With Splats.
- Thermal tasks (DJI Thermal Analyzer's) became compatible with "Thermal tasks (built)".

Decided with the user (2026-11-15):

- **Incompatible tasks are hidden inside a listed project too, silently** (no count).
- **A completed task is compatible only if it can train or already has splats**: one with JPEG photos but no
  point cloud, compacted, or whose images are gone is hidden like a thermal task (checked from its assets and
  files, not its cameras).
- **Next, before the presets.**

As built (2026-11-15): as designed. An image file other than JPEG (TIFF, PNG, DNG, NEF, RAW, WebP, BMP, GIF)
makes a task incompatible, text files (GCP, geo.txt) do not; a task with no photo left is incompatible. A failed
or canceled task with JPEG photos is listed (it can be processed again). New Task With Splats above the list
opens the file picker for a user's only project, or the box with a project choice; the projects' own buttons
stay. A project asked for in the address that is not listed shows them all. Checked in the browser (read only):
as admin, the empty First Project not listed and in the box's choice; as testuser, the sentence for nothing to
list and the picker at once; 390 px. The dev stack has no thermal task (the Django test covers them).

### OpenSplat presets (built)

Requested 2026-11-15 (`new.md`): become an expert in OpenSplat, to choose the best presets SplatMe should offer
to guide users. Part of the plugin's refinement, before the first release.

Builds on: the Quality choice and Advanced section (Draft 2,000 steps, Standard 7,000, High 30,000; Steps,
Image Size, Max Gaussians), `training.DEFAULTS` (7,000 steps, 1,600 px), the node's option ranges
(`NODE_OPTIONS`: steps, max_gaussians, sh_degree) and the measurements in "Denser starting cloud" (dropped).

- **Study**: OpenSplat's source in `ignored/OpenSplat` (a clone of https://github.com/WebODM/OpenSplat, at
  e33f9dd, two commits after the node's pinned 62fd86f: check what they change). Every command-line option,
  its default and what it does in training (densification and pruning schedule, SH degree steps, downscaling,
  learning rates, refinement intervals, `--val`), what drives GPU memory and time, and what a resumed training
  keeps.
- **Measure** on the dev stack's tasks (an RGB task with oblique photos, a nadir-only task, a small one):
  steps against held-out PSNR, time and GPU memory, and the options the study points to, on the dev GPU (8 GB).
- **Propose** to the user: the presets (names, what each sets, the default), which options the Advanced
  section shows and their ranges, guidance in the dialogs (what a preset costs in time and memory, a warning
  when a task is likely to exceed the node's GPU), and whether the node should report its GPU so the plugin
  suggests a preset.

Open decisions (with the user, after the study): the presets themselves; new options exposed (and through the
node's `NODE_OPTIONS`); whether presets depend on the task (photo count, oblique or nadir) or the node's GPU;
moving the node to OpenSplat's newer commit.

**Study of OpenSplat's code (2026-11-15, at e33f9dd).** The trainer is FastGS-style (multi-view scored
densification and pruning), not the original 3DGS schedule.

- **The two commits after the node's pin** (688944f, e33f9dd): a CI change, and a fix to the image decoder. A
  decode failure was printed and its slot dropped, which could leave training waiting for that frame forever; it
  now fails the training with "Image decode failed". The staging buffers move from each slot to each decoder
  thread. No change to training or options: a reason to move the node to e33f9dd, nothing else.
- **The schedule follows the steps** (`-n`, default 30,000):
  - Densification (clone and split, from a score over 10 random training photos) every `--refine-every` (500)
    steps, after `--densify-from` (500) and while below `--densify-until` (-1: half the steps, at most 15,000).
    The opacity is reset every 3,000 steps while densifying.
  - After densification, a final prune every 3,000 steps (faint gaussians and the worst scored).
  - The optimiser steps every step while densifying, then accumulates gradients and steps every 32 steps, and
    every 64 after two thirds of the steps (at most 20,000): the late steps are cheaper.
  - The position learning rate decays over the steps; SH degree grows by one every `--sh-degree-interval`
    (1,000) steps up to `--sh-degree` (3).
- **Draft (2,000 steps) never densifies**: densification runs only at a step above 500, below 1,000 and a
  multiple of 500, and none is. Its model is the starting point cloud, optimised and never grown. 3,000 steps
  densifies at 1,000 only; 4,000 at 1,000 and 1,500.
- **Max Gaussians is a soft cap**: a densification stops growing only once the count is already at the cap, so
  one refine can go past it (the extra clones it allows are those that would be cloned anyway).
- **GPU memory** follows the gaussians (each carries 59 floats at SH degree 3, plus Adam's two moments and the
  gradients) and the image size (the rasteriser's tiles and per-pixel buffers). Images are decoded on demand from
  a compressed cache in RAM (90% of it), so the photo count costs RAM and preparation time, not GPU memory.
- **Other options**: `--downscale-factor` (the node's `downscale`, which SplatMe does not use: its Image Size
  resizes in WebODM's export instead), `--num-downscales` and `--resolution-schedule` (train at lower
  resolution first), `--ssim-weight` (0.2), `--loss-thresh` (0.1), `--no-edge-guidance`, `--no-masks`, `--val`
  (holds one photo out and prints its PSNR at the end).
- **A resumed training** (`--resume`, SplatMe's Continue Training) loads the gaussians and the step count from
  the `.ply` header; the optimiser's state starts over, and the schedule continues from that step against the new
  `-n`.

**Measured (2026-11-15).** OpenSplat 62fd86f (the node's pin) run by hand in `sm-splat-node` on WebODM's own
export (`prepare_export`, 1,600 px unless said), RTX 5060 Laptop GPU (8 GB, about 1.2 GB used by the desktop
before a run; the memory below is the peak above that), one photo held out (`--val`). The time includes the
trainer's preparation of the photos. HomerunObliqueII9: 217 oblique photos. Photo A is `…_0133_V.JPG`, photo B
`…_0071_V.JPG`; PSNR compares only within a photo.

| Steps | Time | GPU memory | Gaussians at the end | PSNR, photo A | PSNR, photo B |
|---|---|---|---|---|---|
| 2,000 | 82 s | 2.2 GB | 405,004 (none grown) | 16.77 | 17.69 |
| 2,000, refining every 250 from 250 | 87 s | 2.5 GB | 408,347 | 17.69 | |
| 3,000 | 119 s | 2.3 GB | 406,657 | 17.68 | 19.21 |
| 4,000 | 139 s | 2.6 GB | 208,192 | 15.58 | |
| 6,000 | 200 s | 2.7 GB | 415,057 | 19.61 | 21.49 |
| 7,000 | 270 s | 3.5 GB | 224,455 | 20.63 | 21.76 |
| 9,000 | 304 s | 3.8 GB | 206,569 | 20.95 | |
| 10,000 | 339 s | 3.8 GB | 206,308 | 21.10 | 23.32 |
| 12,000 | 500 s | 4.3 GB | 240,854 | 22.06 | |
| 15,000 | 603 s | 4.7 GB | 236,416 | 22.44 | |
| 20,000 | 1,003 s | 5.6 GB | 265,498 | 23.06 | |
| 30,000 | 1,558 s | 6.5 GB | 326,504 | 23.77 | 27.57 |
| 30,000, Max Gaussians 1 million | 1,597 s | 6.2 GB | 330,888 | 23.81 | |
| 7,000, 1,000 px | 170 s | 1.8 GB | 207,567 | 20.51 (at 1,000 px) | |
| 7,000, 2,400 px | 564 s | 6.8 GB | 233,306 | 20.23 (at 2,400 px) | |
| 7,000, SH degree 1 | 264 s | 3.3 GB | 216,526 | 19.89 | |
| 7,000, SH degree 2 | 269 s | 3.4 GB | 226,430 | 20.26 | |

HomerunObliqueRGB, 1,005 photos (the trainer's own pick of a held-out photo, `…151152_0038_V.JPG`):

| Steps | Time | GPU memory | Gaussians at the end | PSNR |
|---|---|---|---|---|
| 7,000 | 275 s | 4.9 GB | 262,024 | 19.66 |
| 30,000 | 1,252 s | 6.6 GB | 543,634 (858,204 at its peak, step 14,500) | 21.56 |

- **More steps keep paying up to 30,000**: from 7,000, each doubling of the time gave about 1 dB on photo A;
  photo B gained 5.8 dB from 7,000 to 30,000. No plateau was reached.
- **The step count interacts with the schedule.** 2,000 steps grows nothing (see the study); 4,000 steps is
  worse than 3,000, because its final prune at 3,000 halves a weak model and the optimiser then steps only
  every 32 steps. 6,000 has no final prune, 7,000 one at 6,000, and 7,000 is still better: a prune late in a
  longer training does no harm.
- **Time and memory follow the steps and the image size, hardly the photo count**: 1,005 photos at 30,000
  steps took less time than 217 (21 against 26 minutes) and 0.1 GB more memory. The photos are decoded on
  demand from RAM.
- **Max Gaussians did not matter on these tasks**: no training came near 5 million (the trainer's default) or
  1 million. Memory is driven by the image size (2,400 px: 6.8 GB at 7,000 steps) and the steps.
- **Image Size**: 2,400 px gave nothing at 7,000 steps for twice the time and nearly all of the GPU; 1,000 px
  saved half the memory and a third of the time.
- **SH degree** below 3 lost 0.4 to 0.7 dB and saved almost nothing.
- **30,000 steps on 8 GB** peaked at 6.6 GB above the desktop's 1.2 GB: it fits, with about 0.3 GB to spare.
- Earlier runs on HomerunObliqueRGB ("Denser starting cloud") measured 6.5 GB at 7,000 steps where this one
  measured 4.9 GB; not looked into (a different export, 959 photos then, and a different way of sampling).
- Not measured: a nadir-only task (the dev stack has none; the one from the spike is on the user's own WebODM),
  a small task (under 100 photos), a GPU other than the 8 GB one, OpenSplat at e33f9dd (it changes no training
  code).

**Decided with the user (2026-11-15).**

- Quality: Draft 3,000 steps (was 2,000, which grows nothing), Standard 7,000 (the default), a new Fine 15,000,
  High 30,000. No node change.
- Advanced: the hints change (Image Size is what to lower when the GPU runs out of memory; Max Gaussians is a
  limit for very large scenes), and a custom step count the trainer handles badly gets a note. Max Gaussians
  stays.
- No GPU warning for now: each preset's hint gives the measured time and GPU memory instead. (Found while
  building: the node's `GET /info` already reports its GPU's name and memory, so a warning later needs no node
  change.)
- The node moves to OpenSplat e33f9dd (it holds all of 62fd86f, plus the decoder's fix).

**As built and checked.**

- `public/trainingView.js`: `PRESETS` (four, each hint with its time and GPU memory on a laptop GPU at Image
  Size 1,600) and `stepsNote(steps)`: up to 2,000 steps grows nothing; 3,001 to 5,999 trains worse than 3,000
  (the final prune at 3,000 with too few steps left). `OptionsFields.jsx` shows the note under Quality when it
  is Custom, and the new Image Size and Max Gaussians hints. `templates/options.html` (SplatMe → Settings and
  its Administration page) has the same presets, note and hints in plain script. A setting saved at 2,000 steps
  now shows as Custom, with the note.
- `node/Dockerfile`: OpenSplat at e33f9dd (still v1.2.2).
- Tests: `trainingView.test.js` (the presets, no preset has a note, both notes' bounds, values that are not
  steps): Jest 52, ESLint, Ruff, the node's tests and the 70 Django tests pass.
- Browser (headless, admin, every request but a GET blocked): New Task With Splats on SplatMe → Tasks (two
  scratch photos picked, nothing uploaded) and SplatMe → Settings show the four presets with their hints, the
  notes at 4,000, 2,000 and 1,500 steps and none at 12,000, 3,000 back to Draft, the new hints, no page error,
  no horizontal scroll at 390 px.
- The dev node rebuilt from e33f9dd (`dev/webodm.sh up --build splat-node`): `GET /info` names it, and a
  3,000-step job sent to its API with HomerunObliqueII9's export trained in 103 s, densified at step 1,000 and
  returned a 406,628-gaussian model; the job was deleted. Not trained through SplatMe, which would have
  replaced a dev task's splats: the pin changes only the node.

### Thermal tasks (built)

WebODM's export refuses images that are not JPEG, and a thermal task's are TIFFs.

**Found (2026-11-15, reading only, on the user's DJI Thermal Analyzer stack at :8002):**

- **No conversion is needed.** A task made by DJI Thermal Analyzer's Thermal Task button holds TIFFs of
  temperatures, not R-JPEGs: single-band float32, degrees Celsius, 640 × 512 on the M4T (`converter.convert`,
  dji-thermal-cli's `temp_c` TIFF). The R-JPEGs are not kept. Each TIFF's XMP has `Camera:BandName="LWIR"` (what
  ODM goes by) and DJI Thermal Analyzer's own namespace `urn:dji-thermal-cli:xmp:1.0` (`dtc`), after the pixels,
  which the TIFF's tag 700 points to. Drawing the temperatures needs only numpy and Pillow (WebODM's): neither
  that plugin nor DJI's SDK has to be installed.
- **One range for the whole task.** A photo stretched to its own range (as DJI's previews are) shows the same roof
  in a different shade in each view, and the model blurs.
- **The task's point cloud is grayscale** (ODM's thermal colouring), the starting colours of every palette.
- **WebODM 4.0.0 ships matplotlib's colour maps** (`app.vendor.rio_tiler.colormap.cmap`: gray, magma, inferno,
  plasma, viridis, cividis, jet and their `_r`), which its map layers offer; DJI's own palettes (Iron Red,
  Arctic...) exist only inside DJI's photos and cannot be bundled.
- **The export can be reused whole**: `prepare_export` reads the shots' names from `odm_report/shots.geojson` and
  each image from `task.get_image_path`. Given a stand-in for the task that answers both with the drawn JPEGs
  (and everything else as the task), it writes the cameras, the images and the sampled point cloud as for any
  task: nothing of WebODM is copied.

**Decided with the user (2026-11-15):**

- **Only DJI Thermal Analyzer's tasks**: every photo a TIFF with its `dtc` metadata. Other thermal TIFFs (in
  hundredths of a kelvin, or raw counts, and none at hand to test) stay unlisted, as today.
- **Thermal Colours chosen per training**: Grayscale (white is hot, the default), Black Hot, Iron (SplatMe's own,
  from colour stops: black, purple, red, yellow, white), Magma, Inferno, Plasma, Viridis, Cividis, Jet (WebODM's
  own maps). The hottest is the right-hand end, as WebODM's map layers draw them.
- **The test task**: a thermal task on the dev stack (:8008) from ThermalTest's 218 TIFFs (copied from :8002,
  reading only there), processed and trained, and kept for later checks.
- **Released with SplatMe's own** (not tied to webodm-dji-thermal any more: nothing of it is used).
  webodm-dji-thermal is still not touched from here. Reading a temperature back from a trained model (its 3D
  page) would be a change in that repo, raised with the user there.

**The design:**

- `thermal.py`: whether a task is DJI Thermal Analyzer's (`is_thermal`: its first TIFF's tag 700, read without the
  pixels), the palettes (`PALETTES`: key, name, 256 colours from WebODM's maps or Iron's stops), and `draw(task,
  palette, folder, progress)`: a first pass over every photo for the task's range (low and high percentiles of
  all pixels, so the cold sky and a few hot pixels do not flatten the rest), a second writing each photo as
  `<name>.jpg` in the palette, and a stand-in task for `prepare_export`. Returns the range in °C.
- `training.py`: `compatible` and `problem` accept a thermal task; `export_and_send` draws before exporting (its
  own stage, "Drawing the thermal photos"); the option `palette` (default `gray`) checked like the others,
  saved in automatic training's options and the user's and administrators' defaults; a continued training keeps
  its palette, as it keeps the other options. Ignore Sky is not applied to a thermal task (the sky model is for
  colour photos). The job's record keeps `thermal: {palette, low, high}`.
- `api.py`: `check` says `thermal`, `status` passes the job's `thermal`.
- The pages: **Thermal Colours** under Quality in the Train Splats and Change dialogs of a thermal task, in the
  New Task With Splats panel when the photos picked are TIFFs, and on SplatMe → Settings (and its Administration
  page) with the hint "For DJI Thermal Analyzer's tasks"; Ignore Sky hidden for a thermal task. The task's row
  says "Thermal Colours: Grayscale, 10.3 °C (black) to 43.5 °C (white)", in WebODM's unit system as DJI Thermal
  Analyzer shows temperatures.
- The README and the API table.

**Build order:** `thermal.py` with Django tests (TIFFs made in the test, with and without the `dtc` metadata;
the range; the drawn JPEGs; the stand-in export); then `training.py` and `api.py` with their tests; the pages
with Jest (`trainingView.js`: the palettes, the row's text); the test task on :8008 and a training of it,
measured (the presets' times on 640 × 512 frames), and a check in the browser.

**As built and checked (2026-11-15, branch `thermal-tasks`):**

- As designed, with: the range from the 1st and 99th percentiles of every 4th pixel across and down; the Drawing
  stage has no share of the progress bar (it takes seconds); `palette` is kept in the options only when it is
  not `gray`, as `ignore_sky` and `crop` only when not their default.
- The test task on :8008: project Thermal, task ThermalTest (218 TIFFs copied from :8002's ThermalTest, uploaded
  in parts through WebODM's API with that task's options), processed on the dev node, kept. Recognised, no
  problem, range 14.88 to 47.27 °C (the pixels themselves -17.5 to 55.4: the cold 1% is sky). A contact sheet of
  four photos in Grayscale and Iron: the roofs, the ground and the vegetation the same shade from photo to photo.
- Trained through SplatMe with Standard and Iron: drawing and export 7 s, training to completed in 72 s, GPU
  peak 1.85 GB (with about 0.9 GB the desktop holds). **WebODM's worker ran the old code** (its pool process had
  imported SplatMe before the change) and failed the first try with the export's "not a JPEG"; the worker was not
  restarted (the user's stack), and the job ran instead through the same `training.run` in `sm-webapp`. Anyone
  updating the plugin restarts WebODM, as the README says.
- Measured on the node with the task's export in Grayscale (as for the presets, photo 0102 held out):

  | Quality | Time | GPU memory | Gaussians | PSNR |
  |---|---|---|---|---|
  | Draft 3,000 | 35 s | 0.9 GB | 278k | 29.06 |
  | Standard 7,000 | 74 s | 1.0 GB | 56k | 29.77 |
  | Fine 15,000 | 136 s | 1.0 GB | 84k | 33.13 |
  | High 30,000 | 288 s | 1.1 GB | 113k | 33.84 |

  About a quarter of the RGB times. The final prune leaves few gaussians on these smooth frames (Standard: 29k
  of 176k in the Iron training). The PSNRs are not comparable with the RGB ones (one channel, smooth pictures).
  The README says so; the presets' hints, measured on RGB photos, are unchanged.
- Browser (admin, GETs only): the row reads "Splats trained (7,000 steps) in 1 min 9 s. Thermal Colours: Iron,
  from 14.9 °C to 47.3 °C."; Train Splats Again → Start Over shows Thermal Colours with the nine palettes and no
  Ignore Sky; Settings shows Thermal Colours (Grayscale); no horizontal scroll at 390 px; no page error (only the
  dev livereload, and WebODM's 3D page asking for the task's point cloud). The 3D view draws no splats in
  headless Chromium, for an RGB task alike: the model was not looked at in 3D.
- Checks: Django 77 (SplatMe's with WebODM's `test_plugins` and `test_splats`), Jest 56, ESLint, Ruff.

### Training defaults and the form's tables (built)

Asked by the user (2026-11-15), built on branch `defaults-full-size`:

- **Defaults: 30,000 steps at Image Size 1,600.** The user first chose 30,000 steps on the photos as they are
  (Image Size 0), OpenSplat's own defaults: the trainer grows the model until half the steps (at most 15,000),
  so 30,000 grows it for half its steps. A measured training at full size (HomerunObliqueII9, 217 photos at
  4,032 x 3,024, 30,000 steps) reached step 5,800 in 75 minutes, about 15 times slower than at 1,600 (26
  minutes for all 30,000), with 7.8 of the GPU's 8 GB in use and 420,000 gaussians, still growing; it was
  stopped there and the user chose Image Size 1,600. In `training.DEFAULTS`, the Train Splats dialog's
  starting values and `formFromOptions`. Options already saved (the administrators' defaults, a user's own, a
  task's setting) keep their values.
- **Steps' hint** says what the steps do: the model grows in the first half (up to step 15,000), then is
  refined; steps beyond 30,000 only refine it.
- **Under Steps, a table of the trainer's stages**: the share of the steps in Warm-up, Growing (with its
  rounds), Refining and Polishing, from OpenSplat's schedule at the node's pinned commit (`trainingStages` in
  `trainingView.js`, `StagesTable.jsx`, Settings' copy in `options.html`); each heading's hover tip says what
  the stage does; under More Steps for the more steps of a continued model.
- **Under Image Size, a table of the photos**: each camera's photo size, its size at the Image Size entered (as
  WebODM's `compute_target_size` computes it), and the change of the longer side and of the pixels
  (`imageSizeRows`, `ImageSizeTable.jsx`; `api.py`'s check gives `photo_sizes` from `cameras.json`; the New
  Task panel reads the first JPEG's). Settings has no task, so no table.
- Both tables are of fixed size, directly under their values.
- **Image Size's hint** says larger photos are scaled down whole, each keeping its full view: nothing is
  cropped, only fine detail is lost.
- From `new.md` (2026-11-15): **no "laptop GPU"** in the hints or the README, just "a GPU". The Quality hints
  keep the times and memory measured at 1,600 px; High says it is the default, and Standard is no longer "the
  place to start".
- **Not built (the user's decision)**: a memory column in the Image Size table. Memory is roughly a fixed part,
  a part per pixel and a part per gaussian (1.8, 3.5 and 6.8 GB at 1,000, 1,600 and 2,400 px, 7,000 steps),
  so a percentage would be an estimate, unmeasured beyond 4.3 megapixels, and would hide whether it fits.

### Install, upgrade and uninstall (built)

From `new.md` (2026-11-15): install, upgrade and uninstall are automated as far as is sensible and helpful, for
both the plugin and the splat node. The user (2026-11-15): automate the install before the docs, which then
describe it.

Found in WebODM 4.0.0:

- **Administration → Plugins has an Install Plugins browser** (`PluginBrowser.jsx`): it reads
  `https://plugins.webodm.org/index.json`, built from WebODM-Plugins' `directory.json` on each merge there,
  and installs or updates a listed plugin in one click (an Update button when the listed version differs from
  the installed one). An external plugin is listed by a pull request adding its release zip's URL and SHA-256
  to `directory.json`; each release changes both. The directory also builds a `-prebuilt` zip for WebODMs that
  cannot build page scripts.
- **Upload Plugin** (`admin.py`'s `plugin_upload`) installs a zip with a single root folder, and with
  `upgrade` replaces an installed one ("restart WebODM to apply the changes"). **Delete** removes the plugin's
  folder and its row (`delete_plugin`), calling nothing in the plugin: its data store rows stay.
- **A Docker install builds a plugin's page scripts itself**: the webapp image has `webpack` (`can_build`), so
  the zip need not ship `public/build`. (The native Windows app cannot, and is not supported.)

Decided with the user (2026-11-15):

- **The plugin**: listed in WebODM's plugin directory (one-click Install and Update), and the zip attached to
  each GitHub release for Upload Plugin. Each release's directory entry is a pull request to WebODM-Plugins,
  opened only with the user's approval of that change.
- **The splat node**: a one-command script with install, upgrade and uninstall. Install checks Docker,
  Compose and the GPU runtime, generates the token, writes the compose file and its `.env` (token readable by
  its owner only), pulls the published image and starts it, and prints the address and token. Upgrade pulls the
  new image and restarts, keeping the jobs. Uninstall stops and removes it, and asks before deleting its data.
  The plain `docker compose` commands stay documented.
- **Connecting**: when the node is installed on WebODM's machine, the script finds WebODM's webapp container,
  puts the node on WebODM's Docker network and saves the address and token in SplatMe's settings (its own data
  store, through WebODM's `manage.py`), then says to restart WebODM once if the plugin is new. On another
  machine it prints the address and token to enter on SplatMe's page in Administration.
- **The repository is made public now**, after a check of its files and history for anything private, so the
  published image and the script are tested end to end as an administrator would use them (and Actions
  minutes are free). The user makes it public.

Checked on a throwaway production WebODM 4.0.0 (2026-11-15; the pinned images without the dev files, port
8018, its own volumes, removed after):

- **`dev/build-zip.sh`'s zip installs with Upload Plugin** in 8 s, enabled, and WebODM builds its page scripts
  itself (`public/build` appears). SplatMe's pages, menu and API answer, without console errors.
- **Until WebODM restarts, SplatMe works only in part**: gunicorn's other processes have not loaded it, so its
  scripts and API answer 404 now and then (2 of 10 requests for `Dashboard.js`); after the restart all answer
  and the worker listens. The README said Train Splats works without a restart: corrected.
- **Upload Plugin refuses a plugin that is installed** ("Please remove it before uploading one with the same
  name"): only the Install Plugins browser sends `upgrade`. Upgrading by zip is Delete, Upload, restart, and
  keeps SplatMe's settings (its data store rows are keyed by name, not tied to the plugin's row): a saved node
  address survived an upgrade to a 0.1.1 zip.

Built (2026-11-15): `dev/build-zip.sh` (the zip and its SHA-256, reproducible from a commit, the manifest's
version checked); `.github/workflows/release.yml` (a `v*` tag or by hand: the zip on a GitHub release, the node's
image on ghcr.io tagged with the node's version and `latest`, not rebuilt when that version is published; only
`actions/checkout`, pinned by commit; not yet run on GitHub, and actionlint not run: the sandbox refused its
image); `node/splatnode.sh` (install, upgrade, status, connect, uninstall). Checked with the image built here
(`splatme-node:dev`) in a scratch folder and project, standalone and connected to a throwaway production WebODM
with SplatMe installed from the zip:

- install checks Docker, Compose and the GPU (`nvidia-smi -L` in the node's image), writes `compose.yml` and
  `.env` (mode 600, a 64-hex-digit token), starts the node and waits for `/health`; a second install is refused.
- **WebODM is found by each container's configured image and Compose service** (`webapp`): `docker ps` shows an
  image pinned by digest only by its ID. With several WebODMs (this machine has two, three with the throwaway
  one) install refuses and names them, writing nothing; `--webodm <container>` picks one.
- Connected: the node joins WebODM's network as `splat-node`, its port bound to 127.0.0.1, and SplatMe's settings
  get `http://splat-node:3100` and the token (passed to `docker exec` in the environment, not on a command line);
  SplatMe reached it (version 0.2.0). Standalone: every address, and the address and token printed.
- upgrade keeps the jobs and token; uninstall without a terminal says no to every question (the jobs' volume
  kept, and said so); with `--yes` it cleared SplatMe's setting, deleted the volume, and kept an image another
  container uses, saying so.

- **With the published image** (2026-11-16, after the run by hand): pullable without a login (the package
  inherits the public repository's access, the account's default); install downloaded it and started the node
  in 4 minutes, connected to a throwaway WebODM whose SplatMe then reached it (0.2.0, OpenSplat 1.2.2 at
  e33f9dd, the GPU and its memory); status, upgrade and uninstall `--yes` (the image deleted) worked. The image
  is 6.6 GB; the runner had 86 GB free after the build, so the clean-up step is a margin.
- The script fetched with `curl` from `main` and piped to `bash` runs (2026-11-16, its usage message).

Build order (as planned):

1. The privacy check; the user makes the repository public.
2. Something that builds `splatme.zip` (the `splatme/` folder as its single root, without `public/build`,
   `__pycache__` or tests' caches) and its SHA-256.
3. The release workflow, run by a pushed `v*` tag or by hand, never by an ordinary push: the zip and its SHA-256
   attached to the GitHub release, the node's image built and pushed to ghcr.io (versioned and `latest`). The
   package's visibility is set to public once, by the user.
4. The node's script (install, upgrade, uninstall, status), tested on the dev machine with a locally built image
   first, then with a published one (which needs a tag the user pushes).
5. The directory entry, at the release (phase 1, Docs and first release).

### Documentation on GitHub Pages (built)

Asked by the user (2026-11-16), before 0.2.0's tag: the documentation moves to GitHub Pages (the repository is
public); the README still introduces the plugin and links to the documentation. A **Getting Started** section
walks through a fresh install and an upgrade, linked from the README directly under its first section (the
description and the banner image).

This changes an earlier decision: "The docs are the README (no `docs/` folder)" (2026-11-16, in "1. Docs and
first release"). It is kept there as history.

What there is now: the README (293 lines) holds everything: Requirements, Install, Upgrade, Uninstall, Using it,
The splat node (and HTTPS to a node on another machine), The plugin's API, Development, Licence; four
screenshots in `screenshots/`. Links into it: Administration → SplatMe's Set Up a Splat Node
(`templates/node.html`: `#install`, `#https-to-a-node-on-another-machine`); the manifest's `homepage` is the
repository.

Design:

- **A `docs/` folder of Markdown pages**, built into a site at `https://winuxnomacs.github.io/webodm-splatme/`:
  - **Home**: what SplatMe does, the banner image, the requirements, where to go next.
  - **Getting Started**: a walk-through in order, each step with what to expect and how to check it worked.
    *Fresh install*: check the requirements (the GPU in a container: one `docker run --gpus all … nvidia-smi`),
    the plugin (Install Plugins, or Load Plugin (.zip)), restart WebODM with its options, the splat node
    (Administration → SplatMe's Set Up a Splat Node: the tab for WebODM's machine or another), the node shown
    ready, a first training on SplatMe → Tasks, the model in the task's 3D view. *Upgrade*: from 0.1.x to 0.2.0
    (delete and Load Plugin (.zip), or Update in Install Plugins; restart; `splatnode.sh upgrade`; what is kept;
    check the node's version on Administration → SplatMe), then any later version the same way.
  - **Install, Upgrade, Uninstall** (the reference, as the README has it now), **Using SplatMe** (the README's
    "Using it"), **The Splat Node** (with HTTPS to a node on another machine), **The Plugin's API**,
    **Development**, **Changelog** (from `CHANGELOG.md`).
  - The screenshots move to `docs/`, used by the pages; Getting Started may want one new one of Set Up a Splat
    Node (shown to the user before it is committed, as before).
- **The README**: the title, the description, the banner image, then right under them **Getting Started** and
  **Documentation** links, then the status line (releases, issues, the plan) and the licence. Its other
  sections move to the docs, nothing dropped.
- **Links**: Set Up a Splat Node's links go to the docs pages; the plugin's other pages have none. The
  manifest's `homepage` stays the repository (the directory and WebODM's plugin list point there, and the README
  links on to the docs).
- **Publishing**: a workflow builds the site and deploys it with GitHub's Pages actions. Pages is turned on in
  the repository's settings (Source: GitHub Actions) once, by the user or with their approval.
- **0.2.0**: the docs site goes up with the 0.2.0 release; the zip is rebuilt (the admin page's links); the
  CHANGELOG says where the docs are. Repo `CLAUDE.md`: "keep the README current" becomes the docs, and where
  they live.

Checks: the site built locally and read headless (every page, the navigation, the search if the tool has one,
phone width, dark mode if it has one), every internal link and anchor followed, the commands in Getting Started
compared with `splatnode.sh` and WebODM's labels, the admin page's links; after the release, the live site.

Decided with the user (2026-11-16):

- **The site is built with Zensical** (the user's choice, 2026-11-16, after the assessment below and a second
  look at its risks): pinned exactly in `requirements-dev.txt` and in the release job, upgraded only on purpose;
  `font = false` (no Google Fonts: system fonts, no outside service); link and anchor validation on, in strict
  mode, so a broken link fails the build; the theme's search, navigation, Copy buttons on code blocks, and light
  and dark following the system. The pages stay plain Markdown in `docs/`, so leaving Zensical later costs
  little.
- **The site is published with each release tag**, and by hand: a job in `release.yml` (no push trigger), so
  the docs describe the released version, whose commands fetch `releases/latest`.
- **Pages is switched on by Claude** (Settings → Pages → Source: GitHub Actions, with `gh api`) just before the
  0.2.0 tag, after the user confirms at that moment.

#### The docs site's tool: assessment (2026-11-16)

Checked on 2026-11-16 from GitHub's API (each repository, its releases, contributors and the last 3 months of
commits) and PyPI's JSON. Our need is small: about eight Markdown pages, navigation, heading anchors, tables,
code blocks with a Copy button, light and dark, built in a release job.

| Candidate | Last release | Releases, 12 months | Commits, 3 months | Status | What it pulls in |
|---|---|---|---|---|---|
| MkDocs (`mkdocs/mkdocs`) | 1.6.1, 2024-08-30 | 0 | 0 | unmaintained: 183 open issues and PRs | — |
| Material for MkDocs | 9.8.1, 2026-11-07 | 9 | 29, 3 authors | PyPI "7 - Inactive": maintenance mode, fixes until 2027-05-05 | MkDocs <2 and 10 more |
| Zensical (`zensical/zensical`) | 0.1.1, 2026-11-10 (0.1.0 on 11-05) | 67 (about weekly) | 100, 3 authors: squidfunk 56, pawamoy 43, one other 1 | PyPI "4 - Beta", 0.x; 4 open issues and PRs; MIT | 9 packages (click, jinja2, markdown, pathspec, pygments, pymdown-extensions, pyyaml, tomli, zensical-ui pinned exactly) |
| Jekyll (`jekyll/jekyll`) | 4.4.1, 2025-01-29 | 0 | 7 | slow: 267 open issues and PRs | Ruby, Bundler, gems |
| GitHub's own builder (`pages-gem`, `jekyll-build-pages`) | pages-gem v233, 2026-11-03; the action 1.0.13, 2024-08-06 | 1; 0 | 7; 1 | still runs Jekyll 3.10.0 and its old Sass converter | Ruby, inside GitHub's action |
| Just the Docs (theme) | 0.12.0, 2026-01-23 | 5 | 35, 3 authors | active, small team; 99 open issues and PRs | Jekyll |
| Python-Markdown (for our own) | 3.11.3, 2026-11-05 | 7 | 51, 17 authors | PyPI "5 - Production/Stable", since 2008; BSD-3 | nothing |
| markdown-it-py (for our own) | 4.3.0, 2026-11-10 | 3 | 42, 24 authors | PyPI "5 - Production/Stable"; MIT | mdurl |

Every option deploys with GitHub's Pages actions (`actions/configure-pages` 6.0.0, 2026-03;
`upload-pages-artifact` 5.0.0, 2026-04; `deploy-pages` 5.0.1, 2026-09), GitHub's own and the supported way.

Reading:

- **MkDocs and Material for MkDocs**: out. One is unmaintained, the other inactive with an end date.
- **Zensical**: active and well run, but young: 0.1.0 came out 11 days ago, releases come weekly in 0.x (so
  changes that break a site are to be expected), nearly all work is two people's, and it brings nine packages
  and a binary UI package pinned exactly. We would inherit its churn while it settles.
- **Jekyll**: slow, and GitHub's own builder is stuck on Jekyll 3.10; Just the Docs is active but small. It
  adds Ruby to a Python and JavaScript repository.
- **Our own**: a short Python script in `dev/` (about 200 to 300 lines with its template and CSS) on
  Python-Markdown, which is stable, depends on nothing, and has many maintainers. It reads `docs/*.md` and a
  page list, writes HTML pages with navigation, GitHub-style heading anchors, tables, code blocks with a Copy
  button, light and dark following the system, and checks every internal link and anchor while building. No
  search at first: eight pages and a side menu do without it (a small index later if wanted). We maintain the
  script and its look ourselves, and the docs stay plain Markdown that any later tool reads.

Recommendation: our own on Python-Markdown. Zensical is the one to look at again once it is past 0.x.
The user first chose our own on Python-Markdown, then Zensical (2026-11-16), on a second look: the parts that
render the content are mature (Python-Markdown and pymdown-extensions, as Material for MkDocs used, and
Material's theme by the same team); issues get answered within a day (median of the last 100 closed: 0 days);
leaving costs little, as the docs stay plain Markdown. The risks taken on, with what answers them: weekly 0.x
releases (one breaking change in the last 20: two musl builds dropped; Python 3.10 dropped), answered by an
exact pin and deliberate upgrades; Google Fonts by default, answered by `font = false`; its validation settings
"deprecated in their current form" (to move to a new parser), checked at each upgrade; two main maintainers and
a commercial side (Zensical Studio), answered by the low cost of leaving; a compiled wheel (Linux, macOS,
Windows), which we cannot patch.

Built (2026-11-16) on branch `docs-site`:

- `docs/`: `index.md` (Home: the introduction, the requirements, where to go next), `getting-started.md` (new:
  check what you need, with `docker run --rm --gpus all ubuntu nvidia-smi -L` before the 6.6 GB download; the
  plugin; the restart; the splat node in two tabs, quoting the script's own messages; a first Draft training;
  the upgrade from 0.1.x to 0.2.0 with its expected output; later versions), and `install.md`, `using.md`,
  `splat-node.md`, `api.md` moved from the README by a script (each section's boundary asserted, nested lists
  re-indented for Python-Markdown, links rewritten), `development.md`, `changelog.md` (includes `CHANGELOG.md`
  with pymdownx.snippets, the path checked). The screenshots moved to `docs/assets/screenshots/` (git mv).
- `zensical.toml`: strict, link and anchor validation, `font = false`, the theme's search, Copy buttons,
  instant navigation, light/dark/system toggle.
- `docs/requirements.txt`: Zensical 0.1.1 and what it pulls in (click, jinja2, markdown, markupsafe, pathspec,
  pygments, pymdown-extensions, pyyaml, tomli, zensical-ui) locked with hashes for Python 3.12, the runner's.
  Their health checked on 2026-11-16 (GitHub's API, 6 months of commits): pymdown-extensions 100 commits by 6
  (licence MIT on PyPI; GitHub reads it as NOASSERTION for its added notices), pathspec 100 by 19, tomli 14 by
  3, click 100 by 4, Pygments 91 by 30, PyYAML 2 by 2 (slow but stable and everywhere: accepted), Python-Markdown
  as in the assessment.
- `release.yml`: `docs` builds the site on every run (the runner's `python3 -m venv`, which its image provides
  with `python3-venv`; `pip install --require-hashes --no-deps`; `zensical build --clean`) and uploads it with
  `actions/upload-pages-artifact` (pinned by SHA, v5.0.0); `docs-deploy` (after `docs` and `plugin`, for a tag
  or with the new input "Publish the documentation") deploys with `actions/deploy-pages` (pinned by SHA,
  v5.0.1) to the `github-pages` environment. No `setup-python` or `configure-pages`: not needed. No new trigger.
- README: the description, the banner, then Getting Started and Documentation, Requirements (two lines),
  Status, Licence. Admin page: the HTTPS link to `splat-node/#https-to-a-node-on-another-machine`, the upgrade
  and uninstall line to `install/`. CLAUDE.md: where the docs are and how they are built and published.

Checked: strict build clean, and a deliberately broken link and anchor failed it (exit 1); the CI steps run in
a fresh Python 3.12 venv from the hashed lock; the built site served on a scratch port under
`/webodm-splatme/` and read headless: every page loads with its images, 46 internal links and their anchors
resolve, Copy buttons on the 10 code blocks (8 in Getting Started), Getting Started's tabs switch and Copy
copies the shown tab's command, search finds "Ignore Sky" in 5 pages (desktop and phone), dark scheme follows
the system, no page scrolls sideways at 320 px, no console errors, no request leaves the site (no fonts or
scripts from outside).

**For the tag** (with the user's confirmation then): Pages switched on with Source: GitHub Actions; the
`github-pages` environment allows deployments only from the default branch by default, so a deployment rule
for tags `v*` is added, or the tag's `docs-deploy` is refused. Until the release publishes it, the README's and
the admin page's links to the site do not answer.

### Guided splat node setup (built)

Asked by the user (2026-11-16, before 0.2.0's tag): on Administration → SplatMe, under Splat Node, concise
copy-paste steps to install a splat node. With no node set they stand where the node's health box is; with a
node set they are behind a collapsible link under that box.

What is there now: `templates/node.html` (shared by Administration → SplatMe and SplatMe → Settings) shows the
health box (`#splatme-state`: ready, or the error with "Node Address: not set"), then the Node Address and Token
form for superusers on the admin page. The steps are in the README's Install (step 3) only.

Design:

- **Administration → SplatMe only** (the `editable` page, for superusers). SplatMe → Settings is unchanged: its
  readers cannot install anything.
- **No node set** (`url` empty): a panel **Set Up a Splat Node** in place of the red box. **A node set**: the
  health box as now, then a link **How to Install a Splat Node** that opens the same panel below it.
- **The panel**, in the README's words, shortened:
  1. What the machine needs: an NVIDIA GPU (GTX 16 or RTX 20 to RTX 50 series), its driver, Docker with
     Compose v2, and the NVIDIA Container Toolkit (linked).
  2. **On WebODM's machine**: the `curl … | bash -s install` command in a box with a **Copy** button; the node
     joins WebODM's network and fills this form itself; reload the page. With several WebODMs:
     `--webodm <webapp container>`.
  3. **On another machine**: the same command with `--standalone` (port 3100, `--port`); it prints the address
     and token to enter below, then Test Connection and Save; only WebODM's machine should reach that port
     (plain HTTP, see phase 3).
  4. A node installed before SplatMe: `… | bash -s connect`.
- **Copy** uses `navigator.clipboard` where the page is a secure context, else a selected text area and
  `document.execCommand("copy")` (a WebODM on plain HTTP by its IP is not a secure context); the command stays
  selectable either way.
- Plain script in `node.html`, as the page is now; WebODM's theme classes (`panel`, `well`/`pre`), no colours;
  works at phone width (the command box scrolls sideways, not the page). Title Case for its name and buttons.
- README: a line under Install that the steps are also on Administration → SplatMe; the admin screenshot
  retaken only if the user wants it.
- 0.2.0 is not tagged yet: the panel goes into 0.2.0 (CHANGELOG, the zip rebuilt). The node is unchanged, so no
  new node VERSION.

Checks planned: headless on the dev stack, reading only (GET): with the node set (link closed, opens, Copy
fills the clipboard), and with no node set; phone width (320 px), no sideways scroll.

Decided with the user (2026-11-16):

- **With a node set but not answering**, the link stays closed (as with any node set): the node is usually
  down or its token wrong, not missing.
- **The README's admin screenshot is kept**; the README says the steps are also on Administration → SplatMe.
- **HTTPS goes into 0.2.0 as docs only** (option A of phase 3): a README section on a TLS proxy in front of a
  standalone node, built on this phase's branch.

Built (2026-11-16) as designed, on branch `node-setup`. Checked headless on the dev stack, reading only: with
the node set, the state then the closed link, which opens and closes the steps (`aria-expanded` follows); Copy
put the command in the clipboard, through the Clipboard API on localhost and through the fallback with
`isSecureContext` forced false (no text area left behind); with no node set (the page's GET answered with no
address by the browser, not by clearing the dev stack's setting, so no throwaway WebODM was needed), the steps
in the state's place, no link, the form below them; SplatMe → Settings has none of it; 320 px, no sideways
scroll. The first screenshots showed each command cut off before its end, the part that differs: the commands
now wrap. `splatnode.sh`'s `write_files` checked in a scratch folder: a hand-set `SPLATNODE_BIND` survives an
upgrade, a node on WebODM's network gets `127.0.0.1:`, a fresh standalone install every address. The HTTPS
proxy docs were not tried with a real domain and certificate. Ruff, ESLint, Jest 73, Django 88.

Changed with the user (2026-11-16): the three sections are tabs (On WebODM's Machine, the default; On Another
Machine; A Node Installed Before SplatMe), one shown at a time, with the upgrade and uninstall line under them
for all three. Bootstrap's `nav-tabs` look with the page's own switching (`showTab`), tab roles and arrow keys.
Checked headless: the default tab, a click, ArrowRight moving and wrapping with the focus, Copy in a tab
(the Clipboard API and the fallback); at 320 px the tabs stack, no sideways scroll. Django 88.

### 4. HTTPS to the splat node (proposed)

Asked by the user (2026-11-16): what it takes to connect to the splat node over HTTPS/TLS, and whether it
belongs in 0.2.0.

What matters: on WebODM's machine (the default install) the node is on WebODM's Docker network and bound to
127.0.0.1, so nothing crosses a wire and TLS adds nothing. A node on another machine (`--standalone`) is
reached over plain HTTP: the token, the task's photos (the training zip) and the trained model cross the
network in clear. The README says to let only WebODM's machine reach the port.

What already works: SplatMe takes an `https://` Node Address (`api.py` accepts it) and `node.py` uses
`requests`, which verifies the certificate against its bundled CAs. So a node behind a TLS proxy with a
publicly trusted certificate (Caddy, nginx, a tunnel) works today with no code change; it is just not
documented, and a self-signed certificate is refused.

Ways to add it, smallest first:

- **A. Docs only** (an hour): a README section with a Caddy example in front of the node, with a real domain
  name; bind the node to 127.0.0.1. Covers administrators with a domain.
- **B. Self-signed TLS in the node, pinned in SplatMe** (about two days with tests): `splatnode.sh install
  --standalone` makes a certificate (openssl, in the script or the image), `splatnode.py` serves HTTPS with
  `ssl.SSLContext` (stdlib; a new node VERSION and image), the script prints the certificate's SHA-256
  fingerprint beside the address and token; Administration → SplatMe gets a **Certificate Fingerprint** field,
  and `node.py` checks the server's certificate against it instead of a CA (a `requests` adapter). Works without
  a domain, no CA to trust in WebODM's containers (which SplatMe must not change). Upgrade: existing standalone
  nodes stay HTTP until reinstalled or upgraded with a flag.
- **C. A Caddy sidecar in the node's compose file** (`--tls <domain>`, automatic certificates): needs a domain
  and port 80/443 reachable from the internet for the certificate; more moving parts than B.

Decided with the user (2026-11-16): A (docs) goes into 0.2.0 with phase 1; B stays proposed here (Later 3), a
phase of its own after the directory entry if the user wants it. The recommendation it was decided on: not in 0.2.0. B touches the node's image, the script, the plugin's settings and the upgrade of
existing nodes: a new node release and its own testing on two machines, which would hold 0.2.0's fixes back.
0.2.0 can carry A (docs) at no risk; B is a phase of its own after the directory entry.

### 1. Docs and first release

README, docs, the zip, the splat node's image, the entry for WebODM-Plugins' `directory.json`. The docs describe
the install, upgrade and uninstall automated in "Install, upgrade and uninstall (built)", and what an uninstall leaves (the plugin's data store
rows, the trained models in tasks).

Decided with the user (2026-11-14):

- The splat node is published as a prebuilt image on GitHub's registry (ghcr.io), so an administrator runs it
  with one `docker run`: no clone, no compile. Built and pushed by a workflow that runs only for a pushed
  release tag (and by hand), never for an ordinary push. The user makes the repository public before the
  release, and pushes the tag. A new package starts private on ghcr.io: its visibility is set to public once.
- The administrator's steps the release must make true: run the node's image; upload `splatme.zip` in
  Administration > Plugins and enable it; restart WebODM once; enter the node's address and token on the
  SplatMe page.

Already built in "Install, upgrade and uninstall (built)": the zip, the release workflow, the published image
(0.2.0), the node's script, and the check that a production WebODM builds an uploaded plugin's page scripts.

Decided with the user (2026-11-16):

- **The first release is 0.1.0**, and the manifest stays `"experimental": true`.
- **The docs are the README** (no `docs/` folder): install (the node's script, then the plugin from Install
  Plugins or Upload Plugin, then one restart of WebODM), upgrade (Update in Install Plugins, or Delete and
  Upload; `splatnode.sh upgrade`), uninstall and what it leaves (SplatMe's settings in WebODM's database, the
  trained models in their tasks, the node's jobs and image).
- **The zip is named with its version** (`splatme-0.1.0.zip`), as the user's other plugins' are, so each
  directory entry points at its own file.
- **The node's script is attached to each GitHub release**, and the docs fetch it from
  `…/releases/latest/download/splatnode.sh`, so administrators get the released script, never `main`'s.
- **Screenshots in the README**, taken headless on the dev stack from tasks the user names, each shown to the
  user before it is committed (they may show places or imagery).

Build order: the zip's name and the script on the release (workflow, `dev/build-zip.sh`, the script's own
`SELF`); the README; the screenshots; `release/0.1.0` (changelog, merged); the user pushes the tag `v0.1.0`; the
release checked (the zip from Load Plugin (.zip) on a throwaway WebODM, the script from
`releases/latest`); the directory entry, a pull request to WebODM-Plugins opened only with the user's approval.

Built (2026-11-16): the zip named `splatme-<version>.zip` and the script attached to the release
(`dev/build-zip.sh`, `release.yml`, the script's `SELF` and usage); the README's Install, Upgrade and Uninstall
(WebODM's own labels checked: Install Plugins, Install, Update, Load Plugin (.zip), the row's bin; the database
rows' clean-up command matched SplatMe's 8 rows on the dev stack and nothing else, counted, not run); four
screenshots of ThermalTest in `screenshots/`, approved by the user (the 3D view renders headless once HEAD
requests are let through: the viewer asks for the model with HEAD first); `CHANGELOG.md`; all checks passed
(Ruff, ESLint, Jest 67, the node's tests, Django 72).

Released (2026-11-16): `v0.1.0`, pushed with the user's approval; the workflow made the release (the zip, its
`.sha256`, `splatnode.sh`) and skipped the node's image (0.2.0 published). Checked: the release's zip matches a
local build of the tagged commit once built in UTC (zip times are local: `dev/build-zip.sh` now builds in UTC);
`releases/latest/download/splatnode.sh` runs; the zip installs with Load Plugin (.zip) on a throwaway WebODM.
There the first Dashboard after the restart threw in `Dashboard.js` (`observe` on a missing `document.body`:
`main.js`, in the page's head, imported it at once), so that page had no SplatMe button or line; not
reproduced in 25 more loads. Fixed in **0.1.1** (`main.js` starts the Dashboard's parts once the page is
parsed), checked on the dev stack and by upgrading the throwaway WebODM by delete and load (10 Dashboards, the
pages, no errors). `v0.1.1` pushed with the user's approval and released (the zip's SHA-256
`c4eb9592d5a5d05026b9078a41c314fdd4f7be0463668f35ed7454cc86981c7b`, the same as a local build of the commit;
`releases/latest` is 0.1.1).

Left: the directory entry (0.1.1's URL and SHA-256 appended to WebODM-Plugins' `directory.json`, from the user's
fork, as TweakUI's was). Its change and description were drafted and shown; the user chose "Not now"
(2026-11-16), so nothing was sent. It is opened only when the user approves it.

**0.2.0 released (2026-11-17).** Pages switched on by the user (source GitHub Actions; the `github-pages`
environment allows `main` and tags `v*`). The site is served at https://winuxnomacs.com/webodm-splatme/: the
user's site `winuxnomacs.github.io` has that custom domain, so the `github.io` addresses redirect there. Enforce
HTTPS was off on that site's repository and is now on. `v0.2.0` pushed with the user's approval on e88386c; the
run published node 0.2.2 on ghcr.io (`latest` moved to it; its inputs label the hash of `node/`), the release
"SplatMe 0.2.0" (the zip's SHA-256 `d2e6443eb95fde59f5196643848afd3b63c843b28333ac761c365233208221a4`, the same
as a local build of the tag; `releases/latest/download/splatnode.sh` the tag's) and the docs. The directory
entry (0.2.0's URL and SHA-256 appended to `directory.json`) is commit f103215 on branch `add-splatme` of the
user's fork, pushed with the user's approval; the user opened it as WebODM-Plugins #9 (2026-11-17).

Considered and dropped (2026-11-17, the user's decision): changing WebODM so that SplatMe trains without its own
splat node. The three ways (the splat node started by `webodm.sh --gpu`; a GPU worker image training in WebODM's
worker; a splat stage in ODX's processing) each lose something the separate node gives: a GPU on another machine,
trainings that survive WebODM's restarts, and SplatMe's own options and continuing.

### 5. Pull requests to WebODM (a SplatMe section in Task Options, the New Task panel's row)

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

### 6. Steps for an Image Size (proposed)

Asked by the user (2026-11-15): recommend the steps for the Image Size entered, so they see what resolution and
steps trade before starting. Neither OpenSplat's code nor its README recommends either value or links them, so
the numbers must be measured: a grid of Image Size (1,000, 1,600, 2,400, 3,200, full) against steps (7,000,
15,000, 30,000) on two kinds of task, each scored on one held-out photo rendered at full resolution, with time
and peak GPU memory (about 25 to 30 trainings, a night of the GPU). Then the node gives its GPU memory in
`/info`, and the fields show the recommended steps, the time and memory, and warn when a choice will not fit.
Also worth trying: a later end to the growing for large photos (`--densify-until`), as the growing stops at step
15,000 however many steps. No percentage of quality is shown: it depends on the scene and the steps. Not yet
decided by the user.

### 7. OpenSplat's other training options (to evaluate before the release after 0.2.0)

Asked by the user (2026-11-17): review OpenSplat for further quality options SplatMe could offer. Recorded to be
evaluated again before the next release after 0.2.0, likely with quality testing first.

Builds on: "OpenSplat presets (built)" (the study of every option, and the measurements of steps, Image Size,
SH degree and Max Gaussians on the dev GPU) and "Continue training (built)".

**Review (2026-11-17, OpenSplat at e33f9dd, the node's pin and still upstream's latest commit).** No new field
in Advanced is recommended: what is left either belongs inside a preset or an Image Size, or means nothing to
someone choosing a training.

- **Worth measuring**:
  - `--densify-until` (default half the steps, at most 15,000): the step after which the trainer only refines
    the gaussians it has. High (30,000) stops growing at 15,000, and a continued training past that step grows
    nothing. A later end could add detail to large scenes and continued trainings, for more GPU memory.
  - `--num-downscales` (default 0, off) with `--resolution-schedule` (3,000): train on smaller copies of the
    photos first, doubling their size every few thousand steps. 2,400 px gave nothing at 7,000 steps for twice
    the time; starting small is the usual remedy, and saves time early on. The scoring that chooses where to
    add detail uses the same smaller photos.
  - Either would be set by a preset or by the Image Size, not shown as a field.
- **Smaller extras**: `--refine-every` and `--densify-from` (500 each) earlier for Draft, which densifies once
  (at step 1,000): 250 from 250 gave 0.9 dB at 2,000 steps. `--val` as a quality score in the training's log
  (one photo held out and scored by PSNR at the end, at the cost of not training on it).
- **Not worth exposing**: `--ssim-weight` (0.2, the usual mix of pixel and structural loss), `--loss-thresh`
  (0.1) and `--no-edge-guidance` (internal to the multi-view scoring), `--sh-degree-interval` (1,000),
  `--no-masks` (Ignore Sky needs the masks), `--downscale-factor` (Image Size resizes in WebODM's export).

**Quality testing first.** On the dev GPU (8 GB), each scored on held-out photos at full resolution, with time
and peak GPU memory: `--densify-until` later on High and on a continued training; coarse-to-fine at 2,400 px and
full size; optionally Draft refining every 250. About 12 to 16 trainings (30,000 steps takes about 26 minutes),
an evening; one night with phase 5's grid. Also a nadir-only task and a small one, which the presets' study
lacked.

**What adopting one needs**: new node options (node 0.2.3: a new `VERSION`, as the image is built once per
version), sent only to a node that has them (as `REF_VERSION` gates `ref`: an older node refuses an unknown
option), the presets' hints measured again, and Continue keeping the options a model was trained with.

Open decisions (with the user, after the testing): which options a preset or Image Size sets, and whether `--val`'s
score is shown.
