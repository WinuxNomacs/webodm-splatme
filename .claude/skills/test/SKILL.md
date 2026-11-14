---
name: test
description: Run the SplatMe plugin's checks (Ruff, ESLint, Jest, the splat node's tests, Django tests in the dev container) before committing or merging.
---

# Tests and checks

From the repo root, with the dev stack up (`dev/webodm.sh ps`; start it with `dev/webodm.sh up`): WebODM 4.0.0,
`sm-webapp`, http://localhost:8008.

1. **Ruff**: `.venv/bin/ruff check .`
2. **The plugin's scripts** (after a change to `splatme/public` or `splatme/templates`): `npm run lint -- splatme`
   and `npm test` (Jest tests `public/trainingView.js`, what the components show). Then rebuild
   (`docker exec -w /webodm/coreplugins/splatme/public sm-webapp webpack-cli`) and look at the change in a
   headless browser (Playwright, `require("playwright")` from the repo root) on http://localhost:8008: the
   task's panel on the Dashboard, the dialog, the SplatMe page; let only GET requests through unless the check
   must write, and undo what it wrote.
3. **The splat node's service** (after a change to `node/`): `python3 -m unittest discover -s node/tests -t node`.
   It runs on the host against a stand-in trainer. A change to the trainer's command or the image is also checked
   with a real job: `dev/webodm.sh up --build splat-node`, then post a training zip to http://localhost:3108/jobs
   (token `dev-token`) and wait for `completed`.
4. **Django**: `docker exec -w /webodm sm-webapp python manage.py test --noinput coreplugins.splatme.tests.test_splatme`.
   The tests train against a stand-in node (`splatme/tests/fake_node.py`); WebODM's tests run a worker's job
   inside the request that starts it.
   Before a merge, also WebODM's plugin tests (`app.tests.test_plugins`) and, for changes that use WebODM's splat
   code, `app.tests.test_splats`. Never two Django runs at once: they share the stack's test database.
   A test run starts WebODM in test mode, which adds a `test` plugin row to the dev database; until the webapp
   restarts, Administration > Plugins fails (500). Remove the row afterwards:
   `docker exec -w /webodm sm-webapp python manage.py shell -c "from app.plugins.functions import sync_plugin_db; sync_plugin_db()"`

A failure is reported with its output. Before calling one pre-existing, check whether it also fails on `main`.
