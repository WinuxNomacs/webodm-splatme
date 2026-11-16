---
name: release-review
description: The review SplatMe goes through before every release (code bugs, weak areas to harden, the docs' accuracy and economy), unless the user says to skip it. Use before tagging any version.
---

# Release review

Done before every release, on `main` as it will be tagged, unless the user says otherwise for that release.
Reading only: nothing is changed during the review. Its findings go to the user, and the fixes follow as their own
phase.

## 1. Scope

- **What changed since the last release** (`git diff v<last>..main`), read in full.
- **Then a fresh read of the whole product for weak areas**, not only the diff: a weakness that has been there
  since 0.1.0 is still one.
- The parts, each read against the code it depends on (WebODM 4.0.0 in `ignored/WebODM`, OpenSplat at the node's
  pin):
  - the plugin's Python (`splatme/*.py`);
  - its pages (`splatme/public`, `splatme/templates`);
  - the splat node (`node/splatnode.py`, `node/Dockerfile`, `node/splatnode.sh`, `node/compose.yml`);
  - the release (`.github/workflows/release.yml`, `dev/build-zip.sh`, the zip's contents, `docs/requirements.txt`);
  - the documentation (`docs/`, `README.md`, `CHANGELOG.md`, the text on the plugin's pages, `CLAUDE.md`'s
    commands).

The parts can be read in parallel by subagents, each briefed with its files and these lenses. Their findings are
checked again in the code before they are reported.

## 2. What to look for in the code

- **Bugs**: wrong results, crashes, lost updates, races, wrong state after a failure or a restart.
- **Failure paths**: the node or WebODM unreachable, slow or restarting; a disk full; a killed worker; a cancelled
  or repeated request. Each one ends in a clear message and a state that can recover.
- **Security**: permissions on every view (superuser, task owner, anonymous viewer of a public task), CSRF, the
  token never sent to a page or written to a log, file paths built from input, shell quoting in `splatnode.sh`, what
  the node accepts and from whom, what the release workflow can write.
- **Hardening**: timeouts on every request, limits on sizes and counts, retries that stop, memory and disk that
  are given back, nothing that grows without bound.
- **Upgrades**: from the last release to this one, the plugin and the node, with data kept.
- **Dependencies**: every pin (Python, npm, base images, actions, OpenSplat, libtorch) checked again under the
  vetting rule of the user's CLAUDE.md: latest release, advisories, maintenance. Dated evidence goes in the review's
  record.

## 3. Make the failures happen

Reading finds less than running. For each part that runs unattended (the splat node, the plugin's worker jobs
and their heartbeat, `splatnode.sh`), run its failures against the real code, in a scratch folder or a throwaway
instance: a full disk (a write made to fail), a damaged saved file, a dependency that hangs, goes silent or ignores
a stop, a client that stalls, a restart in the middle of a job. Each failure must end in a clear message and a state
that recovers. A failure that leaves something stuck or silent is a finding, reported as "checked", and gets a test
that makes it happen.

## 4. What to look for in the documentation

- **Accuracy**: every statement checked against the code, or against a run when it describes output, a number or
  a timing. A statement nobody can check is rewritten so it can be, or removed.
- **Economy**: every sentence earns its place for the reader at that point. Remove what does not help them do or
  understand something: repetition, history, internals they don't need, hedges, reassurance.
- The README introduces SplatMe and links to Getting Started and the docs, no more.
- Links and anchors resolve (`.venv/bin/zensical build` is strict), screenshots show the current pages.

## 5. A live sweep

The plugin's pages on the dev stack, headless, reading only (GET and HEAD): the Dashboard's Splats line,
SplatMe → Tasks, SplatMe → Settings, Administration → SplatMe; 320 and 1,280 px wide; as an administrator and
as a plain user; console errors read (the dev stack's livereload one is expected).

## 6. The record and what follows

- Each finding: a letter, the part, what fails and how (a concrete case), its weight, and "checked" when it was
  confirmed again in the code or a run. The documentation's findings list each removal and correction.
- Recorded in `upcoming-changes.md` as "Release review of X.Y.Z", with what was found sound.
- The user decides which findings go into the release. The fixes are built on branches with tests (the `test`
  skill), then the release check on a throwaway WebODM (the last release installed, upgraded to this one), then
  the release, which the user approves.
