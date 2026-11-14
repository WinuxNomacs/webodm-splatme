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
- **WebODM 4.0.0, Docker installs** (Python 3.14, Django 5.2, DRF 3.18): `webodmMinVersion` is 4.0.0 and Ruff
  targets py314. The native Windows app and 3.3.2 are not supported yet.
- **WebODM's own splat code is reused, not copied**: the export (`app/splats.py`, `prepare_export`), the
  conversion (`splat-tools`, as `worker/tasks.py`'s `process_splats`) and the asset (`splats.rad`,
  `assets/splats/model.rad`), which the 3D view, the download and the share links already serve. The plugin adds
  the training between them, which runs in a companion GPU container (the "splat node"), not in WebODM's
  containers: they have no GPU.
- **The plugin's code**: `training.py` (a task's job and its record, automatic training and its settings),
  `node.py` (the splat node's API as the plugin uses it), `api.py` (the views), `plugin.py` (the mount points,
  the menu item, the scripts, the signal receivers). State is
  kept only in the plugin's global data store: an update of an uploaded plugin replaces its folder,
  `get_persistent_path()` included.
- **The plugin's pages**: `public/main.js` (ES5, on every page: adds SplatMe's part to a task's panel on the
  Dashboard and to the Edit Task Options dialog), `public/OptionsButton.jsx` (that dialog's part, with
  `newTaskSettings.js`: a new task's setting, held on the page until WebODM creates the task),
  `public/TrainSplats.jsx` with `TrainDialog.jsx`, `AutoDialog.jsx`, `OptionsFields.jsx`,
  `LogDialog.jsx`, `Dialog.jsx` and `api.js` (built by WebODM's webpack into `public/build`, which git ignores, as it does the generated `webpack.config.js`),
  `public/trainingView.js` (what they show, as plain functions: this and `newTaskSettings.js` are what Jest
  tests) and
  `templates/settings.html` (the side menu's SplatMe page, plain script). WebODM asks a plugin for a task's
  button once, when the panel opens: the component follows the task itself through the status view.
- **The splat node is `node/`**: `splatnode.py` (the HTTP job service, Python's standard library only, running
  on the image's Python 3.12), `Dockerfile` (OpenSplat built for CUDA 12.8, then a second stage with only what
  runs; base images pinned by digest, OpenSplat by commit, libtorch by checksum) and `compose.yml` (how a user
  runs it). It is not part of the plugin's zip.
- **Never push and never tag.** No workflow exists yet.
- **Names in the UI are in Title Case**: headings, buttons, menu items and setting names ("Train Splats");
  descriptions and messages are sentences.
- Planned in `upcoming-changes.md` (with what the design must respect); new requests arrive in `new.md`
  (untracked).

## Dev environment

- `ignored/WebODM` is a checkout of https://github.com/WebODM/WebODM (ignored by git) at tag `v4.0.0`, the commit
  the pinned image was built from. The dev server runs that checkout, so a branch checked out there (a PR to
  WebODM) is live. `ignored/WebODM-3.3.2` is the same at `v3.3.2` (for reference; nothing runs it),
  `ignored/WebODM-Docs` is https://github.com/WebODM/Docs and `ignored/WebODM-Plugins`
  https://github.com/WebODM/WebODM-Plugins (the directory, its guidance and other plugins' source).
- `dev/webodm.sh up | down | logs [service] | ps` runs WebODM 4.0.0 in dev mode with `splatme/` mounted as
  `/webodm/coreplugins/splatme`, on http://localhost:8008, containers `sm-webapp`, `sm-worker`, `sm-db`,
  `sm-broker`, `sm-node-odx-1`, project and volumes `webodm-splatme`, so it runs beside other WebODMs. The images
  are pinned by digest in `dev/webodm.sh`. The processing node uses the GPU when the machine has one Docker can
  use (`SM_GPU=auto`, the default: WebODM's `nodeodx:gpu` image with the GPU reserved, `dev/compose.gpu.yml`);
  `SM_GPU=0` runs it on the CPU. With a GPU the stack also has the splat node (`sm-splat-node`, built from
  `node/` on the first `up`, `dev/compose.splatnode.yml`): http://splat-node:3100 from WebODM's containers,
  http://localhost:3108 from the host, token `dev-token`. After a change to `node/`:
  `dev/webodm.sh up --build splat-node`.
- **`splatme/` is mounted live**, and the server reloads on every save: an undefined name 500s the pages that use
  it. Check a Python change with Ruff before it lands in `splatme/`.
- The plugin's code runs in two containers: views in `sm-webapp`, `run_function_async` jobs in `sm-worker`. They
  share `/webodm/app/media` (tasks, the plugin's persistent folder). The worker imports every plugin once, when it
  starts (Celery's Django checks import `app.urls`), without calling `register()`: a module-level signal
  receiver is connected there, and after a change to `splatme/` the worker runs the old code, receivers
  included, until it restarts.
- The first start runs WebODM's dev setup (npm install, webpack, migrations) for several minutes before the server
  answers. The startup log then shows `Registered [coreplugins.splatme.plugin]`.
- Host tools: `uv venv --python 3.13 .venv && uv pip install -r requirements-dev.txt` (Django and DRF for the IDE,
  Ruff); `npm ci` (Jest, ESLint, Playwright, pinned in `package.json`). VSCode: interpreter `.venv`,
  `ignored/WebODM` on Pylance's extra paths (local `.vscode/settings.json`).
- A change to a `.jsx` or to a module it imports is live only once rebuilt: the dev server builds at its start
  and does not watch. Rebuild with
  `docker exec -w /webodm/coreplugins/splatme/public sm-webapp webpack-cli`.

## Tests and checks

The `test` skill in `.claude/skills` has the steps.

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
