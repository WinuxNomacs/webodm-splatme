---
name: test
description: Run the SplatMe plugin's checks (Ruff, the splat node's tests, Django tests in the dev container) before committing or merging.
---

# Tests and checks

From the repo root, with the dev stack up (`dev/webodm.sh ps`; start it with `dev/webodm.sh up`): WebODM 4.0.0,
`sm-webapp`, http://localhost:8008.

1. **Ruff**: `.venv/bin/ruff check .`
2. **The splat node's service** (after a change to `node/`): `python3 -m unittest discover -s node/tests -t node`.
   It runs on the host against a stand-in trainer. A change to the trainer's command or the image is also checked
   with a real job: `dev/webodm.sh up --build splat-node`, then post a training zip to http://localhost:3108/jobs
   (token `dev-token`) and wait for `completed`.
3. **Django**: `docker exec -w /webodm sm-webapp python manage.py test --noinput coreplugins.splatme.tests.test_splatme`.
   Before a merge, also WebODM's plugin tests (`app.tests.test_plugins`) and, for changes that use WebODM's splat
   code, `app.tests.test_splats`. Never two Django runs at once: they share the stack's test database.
   A test run starts WebODM in test mode, which adds a `test` plugin row to the dev database; until the webapp
   restarts, Administration > Plugins fails (500). Remove the row afterwards:
   `docker exec -w /webodm sm-webapp python manage.py shell -c "from app.plugins.functions import sync_plugin_db; sync_plugin_db()"`

A failure is reported with its output. Before calling one pre-existing, check whether it also fails on `main`.
