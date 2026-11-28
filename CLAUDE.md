# CLAUDE.md

What Claude needs to know to work on SplatMe, a WebODM plugin that trains a task's Gaussian splats automatically.
General working rules (branches, phases, testing) live in the user's own CLAUDE.md; this file holds what is
specific to this repository. It is committed and public: nothing private, nothing true only on one machine. Keep
it short; edit in place.

## Rules for this repository

- **The plugin is `splatme/`**: the released zip has that folder as its single root. Dev tools (`dev/`,
  `package.json`, `eslint.config.mjs`, `ruff.toml`, `requirements-dev.txt`) stay outside it.
- **Official plugin rules only**: the guide (https://docs.webodm.org/plugin-development-guide, also
  `ignored/WebODM-Docs`) and `ignored/WebODM-Plugins/guidance/index.md`:
  - Extension points are only those of `app/plugins/plugin_base.py` (`include_js_files`, `include_css_files`,
    `build_jsx_components`, `main_menu`, `app_mount_points`, `api_mount_points`, data stores,
    `get_dynamic_script`), the signals of `app/plugins/signals.py` and the `PluginsAPI` hooks in
    `app/static/app/js/classes/plugins/` (`App.ready`, `Dashboard.*`, `Map.*`, `ModelView.addActionButton`,
    `SharePopup.addLinkControl`, `Workers.*`). No Django models or migrations (data goes in the plugin's data
    stores).
  - **No changes to WebODM itself.** A feature that needs a hook WebODM lacks is reported to the user first;
    a pull request to WebODM is made only after the user approves that specific change, and is small and
    targeted, with only critical tests.
  - No hard-coded colours: WebODM's theme variables (`app/templates/app/theme.css`). Look like the rest of
    WebODM, work on mobile, vanilla code over libraries (Python modules only from WebODM's `requirements.txt`),
    async work through `run_function_async` (`app/plugins/worker.py`).
  - The manifest says `"experimental": true` until the user decides otherwise; licence AGPL-3.0.
  - The guide's "no tests unless asked" does not apply: the user's rules ask for tests.
- **WebODM 4.0.1, Docker installs** (Python 3.14, Django 5.2, DRF 3.18): `webodmMinVersion` is 4.0.1 and Ruff
  targets py314. `webodmMinVersion` is raised only when SplatMe's code needs a newer WebODM than 4.0.0, and stays
  there until code needs more; otherwise SplatMe is taken to work on any 4.x. Development and each release are tested
  on WebODM's latest 4.x release (the dev stack's pin). A user with a problem is asked to update WebODM and SplatMe
  to their latest releases first (the user's rule, 2026-11-28). 0.5.0's 4.0.1 came from a misreading of this rule,
  not from its code. The native Windows app is not supported (it has no `splat-tools` and cannot build a plugin's
  page scripts); 3.3.2 is not supported yet.
- **WebODM's own splat code is reused, not copied**: the export (`app/splats.py`, `prepare_export`), the
  conversion (`splat-tools`, run as `worker/tasks.py`'s `process_splats` runs it, on the `.ply` the trainer writes) and the asset (`splats.rad`,
  `assets/splats/model.rad`), which the 3D view, the download and the share links already serve. The plugin adds
  the training between them, which runs in a companion GPU container (the "splat node"), not in WebODM's
  containers: they have no GPU.
- **The plugin's code**: `training.py` (a task's job and its record, automatic training and its settings),
  `sky.py` (Ignore Sky: masks of the sky in a training's photos, made with ODX's sky model),
  `crop.py` (Crop to Boundary: the trained model cut to the task's boundary GeoJSON),
  `edits.py` (a task's splat edits: Box, Polygon and Lasso shapes and Brush strokes, kept in the task's projection, Colour Adjust, and Remove
  Floaters, found on the whole trained model with scipy's `cKDTree`; they cut the shown model after a training
  and in Apply Edits, `training.apply`),
  `thermal.py` (DJI Thermal Analyzer's TIFFs drawn in a palette, one range for the task),
  `node.py` (the splat node's API as the plugin uses it), `api.py` (the views), `plugin.py` (the mount points,
  the menu item, the scripts, the signal receivers). State is
  kept only in the plugin's global data store: an update of an uploaded plugin replaces its folder,
  `get_persistent_path()` included.
- **The plugin's pages**: `templates/tasks.html` (SplatMe → Tasks, which starts `public/Tasks.jsx`: the tasks
  SplatMe can train that the user may see (`training.compatible`), from api.py's `tasks`, each row a
  `TrainSplats.jsx` with `TrainDialog.jsx`, `AutoDialog.jsx`
  (Change), `OptionsFields.jsx` (with `StagesTable.jsx` and `ImageSizeTable.jsx`), `LogDialog.jsx`, `Dialog.jsx` and `api.js`; and `NewTask.jsx`, New Task With
  Splats: `SplatMePanel.jsx` above WebODM's own `NewTaskPanel` (imported from WebODM, as webodm-dji-thermal
  does), then `taskUpload.js`, the upload through WebODM's task API), `templates/settings.html`
  (SplatMe → Settings) and `templates/admin.html` (its page under Administration, whose item `main.js` adds),
  both from `node.html` and `options.html` (plain script), and `templates/editor.html` (Edit Splats, from Edit on
  a task's row: `public/Editor.jsx`, the panel, and `public/editor/viewer.js`, the 3D view, a plain ES module
  loaded through the page's import map (which versions its own modules' URLs: plugin.py's `editor_modules`) with three.js and Spark vendored in `public/vendor` (its README has their
  versions and hashes); `public/editShapes.js`, the shapes' rule shared by both and Jest). `public/main.js` (ES5, on every page) starts
  `public/Dashboard.jsx` on the Dashboard, which puts in the page what WebODM has no hook for:
  `NewTaskButton.jsx` (the New Task With Splats button, a link to the Tasks page's new task for the project
  WebODM's page names) and `TaskLine.jsx` (the task panel's Splats line, found by its
  Task ID). SplatMe answers none of WebODM's task panel hooks: WebODM keeps the first answer and drops the
  other plugins'. The `.jsx` are built by WebODM's webpack into `public/build`, which git ignores, as it does
  the generated `webpack.config.js`. The pages load each bundle by a URL with a version made from its built files
  (plugin.py's `bundle_version`; main.js asks `/plugins/splatme/bundles`), since the server gives `public/` no
  Cache-Control and a browser would keep the old bundle for hours after an upgrade. `restartText.js` holds the
  restart notice's words.
  `public/trainingView.js` (what they show, as plain functions), `api.js` and `taskUpload.js` are what Jest tests.
- **The splat node is `node/`**: `splatnode.py` (the HTTP job service, Python's standard library only, running
  on the image's Python 3.12), `Dockerfile` (OpenSplat built for CUDA 12.8, then a second stage with only what
  runs; base images pinned by digest, OpenSplat by commit, libtorch by checksum), `splatnode.sh` (install,
  upgrade, status, connect, uninstall: writes its own compose file and token to `~/splatnode`, joins WebODM's
  network and saves the address and token in SplatMe's settings through `manage.py` when WebODM runs on the same
  machine; test it with `SPLATNODE_DIR`, `SPLATNODE_PROJECT` and `SPLATNODE_IMAGE=splatme-node:dev` (with no
  terminal, as when piped: `setsid -w bash node/splatnode.sh ... </dev/null`), against a
  throwaway WebODM, never the user's stacks) and `compose.yml` (running it without the script). It is not part of
  the plugin's zip. The service is built to fail safely (its docstring lists how): its job state changes only in
  `Node.transition`, files are deleted outside the lock, every wait has a deadline, and a failure its worker
  can't survive exits the process for Docker to restart. Keep it so: a change to it adds a test in `node/tests`
  that makes its failure happen. OpenSplat's output is parsed against `node/tests/opensplat-output.txt` (a real
  run) and `opensplat-out-of-memory.txt` (from the pinned libtorch): capture both again when the pin changes.
  `lichtfeld.Dockerfile` is the same node with LichtFeld Studio (its own build at a pinned commit, its install
  rules, then a runtime stage; `docker build -f node/lichtfeld.Dockerfile -t splatme-node-lichtfeld:dev node`).
  Its output (through a pseudo-terminal) is parsed against `node/tests/lichtfeld-output.txt`, `-failure.txt`,
  `-stopped.txt` (real runs) and `-out-of-memory.txt` (composed from its messages): capture them again on a new pin. A model to continue from is read
  against both trainers' real headers, `node/tests/opensplat-model.ply` and `lichtfeld-model.ply` (two splats
  each): capture them again on a new pin too.
- **Every release is reviewed first, unless the user says otherwise for that release**: the code for bugs and
  weak areas to harden, and the documentation for accuracy and for saying only what helps its reader. The
  `release-review` skill in `.claude/skills` has the procedure; its findings go to the user, who decides which
  are fixed before the tag. Then the `release-check` skill rehearses an existing user's upgrade on a throwaway
  WebODM (the last release installed, upgraded to the new zip and node), run again if shipped code changes after.
- **Never push and never tag.** `.github/workflows/release.yml` runs only for a pushed `v*` tag (which must be
  the manifest's version) or by hand: it attaches `splatme-<version>.zip` (built by `dev/build-zip.sh`) and
  `node/splatnode.sh` (which the docs fetch from `releases/latest`) to a GitHub release, and pushes the node's two images, `ghcr.io/winuxnomacs/splatme-node` (OpenSplat) and `splatme-node-lichtfeld`
  (a matrix in one job, each pushed under `run-<run id>`; once both are built the `publish` job gives them the node's
  own version and `latest`, then checks both pull without a login: a new package starts private on ghcr.io and must
  be made public), before the release is created; then it publishes the docs site to GitHub Pages (by hand only with "Publish the documentation";
  a run by hand builds both images too, without pushing them, before the docs deploy: OpenSplat's about 30
  minutes). A change to either Dockerfile or `node/splatnode.py` needs a new `VERSION` there: a version's image is built
  once, and carries a hash of its Dockerfile and `splatnode.py`, so a release whose node changed under a published version fails. Never add a
  push or pull-request trigger.
- **Each release's entry in WebODM's plugin directory** (the release zip's URL and SHA-256 appended to
  WebODM-Plugins' `directory.json`) is a branch pushed to the user's fork, `WinuxNomacs/WebODM-Plugins`, from
  upstream's `main`, with the user's approval; the user reviews it and opens the pull request on GitHub.
- **The documentation is the site in `docs/`** (https://winuxnomacs.github.io/webodm-splatme/, served at
  https://winuxnomacs.com/webodm-splatme/: the account's user site has that custom domain), built with
  Zensical (`zensical.toml`; pinned in `requirements-dev.txt` and, with hashes, in `docs/requirements.txt`, which
  the release builds from: upgrade both together). The README only introduces SplatMe (its splash image and
  thanks included) and links to Getting Started and the docs. "Keep the README current" means these pages here: Getting Started, the reference pages,
  and the admin page's links into them (`templates/node.html`). `.venv/bin/zensical build` is strict (a broken
  link or anchor fails it, but not a list item swallowed by the paragraph above it: a bullet after an indented
  paragraph in the item before needs a blank line, so check the rendered page); `.venv/bin/zensical serve`
  previews on http://localhost:8000. The site is published
  with each release, so it describes the released version.
- **Names in the UI are in Title Case**: headings, buttons, menu items and setting names ("Train Splats");
  descriptions and messages are sentences. Articles, conjunctions and prepositions of three letters or fewer are
  lower case unless first ("Set Up a Splat Node", "Crop to Boundary"); longer ones are capitalised ("New Task With
  Splats", "Continue From Step").
- Planned in `upcoming-changes.md` (with what the design must respect); new requests arrive in `new.md`
  (untracked).

## Dev environment

- `ignored/WebODM` is a checkout of https://github.com/WebODM/WebODM (ignored by git) at tag `v4.0.1`, the commit
  the pinned image was built from. The dev server runs that checkout, so a branch checked out there (a PR to
  WebODM) is live. `ignored/WebODM-3.3.2` is the same at `v3.3.2` (for reference; nothing runs it),
  `ignored/WebODM-Docs` is https://github.com/WebODM/Docs and `ignored/WebODM-Plugins`
  https://github.com/WebODM/WebODM-Plugins (the directory, its guidance and other plugins' source).
- `dev/webodm.sh up | down | logs [service] | ps` runs WebODM 4.0.1 in dev mode with `splatme/` mounted as
  `/webodm/coreplugins/splatme`, on http://localhost:8008, containers `sm-webapp`, `sm-worker`, `sm-db`,
  `sm-broker`, `sm-node-odx-1`, project and volumes `webodm-splatme`, so it runs beside other WebODMs. The images
  are pinned by digest in `dev/webodm.sh`. The processing node uses the GPU when the machine has one Docker can
  use (`SM_GPU=auto`, the default: WebODM's `nodeodx:gpu` image with the GPU reserved, `dev/compose.gpu.yml`);
  `SM_GPU=0` runs it on the CPU. With a GPU the stack also has the splat node (`sm-splat-node`, built from
  `node/` on the first `up`, `dev/compose.splatnode.yml`): http://splat-node:3100 from WebODM's containers,
  http://localhost:3108 from the host, token `dev-token`; and a second one with LichtFeld Studio
  (`sm-splat-node-lichtfeld`, `dev/compose.lichtfeld.yml`, `SM_LICHTFELD=0` leaves it out):
  http://splat-node-lichtfeld:3100, http://localhost:3109, the same token. After a change to `node/`:
  `dev/webodm.sh up --build splat-node splat-node-lichtfeld`.
- **`splatme/` is mounted live**, and the server reloads on every save: an undefined name 500s the pages that use
  it. Check a Python change with Ruff before it lands in `splatme/`.
- The plugin's code runs in two containers: views in `sm-webapp`, `run_function_async` jobs in `sm-worker`. They
  share `/webodm/app/media` (tasks, the plugin's persistent folder). The worker imports every plugin once, when it
  starts (Celery's Django checks import `app.urls`), without calling `register()`: a module-level signal
  receiver is connected there, and after a change to `splatme/` it keeps the receivers it connected until it
  restarts. A `run_function_async` job started after a change was seen running the new code without a restart
  (2026-11-15, a continued training from the browser), yet a job calling a function added since failed with
  `AttributeError` until `sm-worker` restarted (2026-11-18, `training.apply`): restart the worker before a
  live check of new worker code. The dev stack's containers may be restarted without asking while no WebODM task
  is processing (check its tasks first; the user's decision, 2026-11-22).
- The first start runs WebODM's dev setup (npm install, webpack, migrations) for several minutes before the server
  answers. The startup log then shows `Registered [coreplugins.splatme.plugin]`.
- Host tools: `uv venv --python 3.13 .venv && uv pip install -r requirements-dev.txt` (Django and DRF for the IDE,
  Ruff); `npm ci` (Jest, ESLint, Playwright, pinned in `package.json`). VSCode: interpreter `.venv`,
  `ignored/WebODM` on Pylance's extra paths (local `.vscode/settings.json`).
- A change to a `.jsx` or to a module it imports is live only once rebuilt: the dev server builds at its start
  and does not watch. Rebuild with
  `docker exec -w /webodm/coreplugins/splatme/public sm-webapp webpack-cli`.

## Tests and checks

The `test` skill in `.claude/skills` has the steps; the `editor-check` skill, the editor checked live (a scenario
against a throwaway copy of a task, with the preview's timings); the `release-review` skill, the review before a
release; the `release-check` skill, the upgrade rehearsal before the tag. The `trainer-benchmark` skill trains and scores trainers outside WebODM on held-out photos; its numbers are in
`dev/benchmarks/check-task.json`.

- Django: `docker exec -w /webodm sm-webapp python manage.py test --noinput coreplugins.splatme.tests.test_splatme`.
  One run at a time: runs share the stack's test database.
- Ruff: `.venv/bin/ruff check .`
- Jest: `npm test` (jsdom, babel-jest; Babel's settings in `package.json`). ESLint: `npm run lint -- splatme`.
- The splat node's service: `python3 -m unittest discover -s node/tests -t node` (on the host, against a
  stand-in trainer, `node/tests/fake_trainer.py`; no GPU or container needed).
- Live checks: headless Playwright (Node) against http://localhost:8008 with a dev account from the user. Expected
  console error in dev mode: `localhost:35729/livereload.js` refused (WebODM's pages ask for that port; this stack
  maps livereload to 35737).
- WebODM's Django CSRF check applies to a plugin's API (WebODM routes it through a plain Django view): a POST,
  PATCH or DELETE needs the session's CSRF token even with basic or JWT authentication.
