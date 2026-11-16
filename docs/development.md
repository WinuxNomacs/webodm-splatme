# Development

SplatMe is developed against WebODM 4.0.0 in Docker. From a checkout of the
[repository](https://github.com/WinuxNomacs/webodm-splatme), `dev/webodm.sh up` runs WebODM with the plugin
mounted, on http://localhost:8008. The repository's
[CLAUDE.md](https://github.com/WinuxNomacs/webodm-splatme/blob/main/CLAUDE.md) has the layout of the code, the
dev environment, and how to run the checks (Ruff, ESLint, Jest, the splat node's tests and the Django tests).

## This Documentation

The pages are Markdown in `docs/`, built into this site by [Zensical](https://zensical.org/), pinned in
`requirements-dev.txt`. With the dev tools installed (`uv venv --python 3.13 .venv && uv pip install -r
requirements-dev.txt`):

- `.venv/bin/zensical serve` previews the site at http://localhost:8000 and rebuilds it on every change.
- `.venv/bin/zensical build` builds it into `site/`. The build is strict: a broken link or anchor fails it.

The site is published with each release, by the release workflow, so it always describes the released version.
