# SplatMe

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically.

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on a task trains the splats on a GPU and puts the
model in the task's 3D view.

**Status: in development.** The plugin registers in WebODM and does nothing yet. The plan is in
[upcoming-changes.md](upcoming-changes.md).

## Requirements

- WebODM 4.0.0 or later, installed with Docker.
- An NVIDIA GPU that Docker can use, for the training container.

## Development

See [CLAUDE.md](CLAUDE.md): `dev/webodm.sh up` runs WebODM 4.0.0 with the plugin mounted, on
http://localhost:8008.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
