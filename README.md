# SplatMe

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically.

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on a task trains the splats on a GPU and puts the
model in the task's 3D view.

**Status: in development.** The training container (the "splat node") works, and the plugin trains a task
through it from its API; the "Train Splats" button and the settings page are next. The plan is in
[upcoming-changes.md](upcoming-changes.md).

## Requirements

- WebODM 4.0.0 or later, installed with Docker.
- An NVIDIA GPU that Docker can use, for the training container.

## The splat node

Training runs in its own container, on a machine with an NVIDIA GPU and Docker's NVIDIA runtime. It does not
have to be WebODM's machine: WebODM sends it a task's training data over HTTP and fetches the trained model.

```
SPLATNODE_TOKEN=<a secret> docker compose -f node/compose.yml up -d --build
```

The first build downloads libtorch and compiles [OpenSplat](https://github.com/WebODM/OpenSplat) (v1.2.2, for
CUDA 12.8: GTX 16 and RTX 20 to RTX 50 series), which takes a while. The node then listens on port 3100
(`SPLATNODE_PORT`), trains one job at a time and queues the others, and deletes a finished job after 48 hours
(`SPLATNODE_KEEP_HOURS`). Every request needs the token.

Its API ([node/splatnode.py](node/splatnode.py)), with `Authorization: Bearer <token>`:

| Request | Does |
|---|---|
| `GET /info` | The node, its trainer, its GPU, its queue and the options a job accepts |
| `POST /jobs?steps=7000` | Starts a job; the body is a WebODM splats training zip. Options: `steps`, `max_gaussians`, `sh_degree`, `downscale` |
| `GET /jobs`, `GET /jobs/<id>` | State (`queued`, `running`, `completed`, `failed`, `canceled`), progress, error |
| `GET /jobs/<id>/log?offset=<bytes>` | The trainer's output from that byte on |
| `GET /jobs/<id>/result` | The trained model (`.rad`) |
| `POST /jobs/<id>/cancel`, `DELETE /jobs/<id>` | Stops a job; deletes it |

## The plugin's API

Under `/api/plugins/splatme/`, with a WebODM login. Until the settings page exists, an administrator sets the
node's address with `POST node`.

| Request | Does |
|---|---|
| `GET node`, `POST node` (`url`, `token`) | Administrators: the node's address, and its state or what is wrong with it. The token is never sent back |
| `POST task/<id>/train` | Trains a completed task's splats. Options: `steps` (7000), `image_size` (1600, the photos' longer side in pixels; 0 keeps them as they are), `max_gaussians`, `sh_degree` |
| `GET task/<id>/status` | The job's `state`, `progress`, `status`, `error`, and whether the task has a splat model |
| `POST task/<id>/cancel` | Stops the job |
| `GET task/<id>/log?offset=<bytes>` | The trainer's output |

Training needs the right to change the task's project. The task must have completed with a point cloud and
still have its photos (JPEG). The trained model replaces the task's splat model only when training succeeds,
and then shows in the task's 3D view like a model uploaded by hand.

## Development

See [CLAUDE.md](CLAUDE.md): `dev/webodm.sh up` runs WebODM 4.0.0 with the plugin mounted, on
http://localhost:8008.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
