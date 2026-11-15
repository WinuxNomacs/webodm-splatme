# SplatMe

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically.

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on a task trains the splats on a GPU and puts the
model in the task's 3D view.

**Status: in development.** The training container (the "splat node") works, and the plugin trains a task
through it, from the "Train Splats" button or by itself when a task completes. There is no release yet. The
plan is in [upcoming-changes.md](upcoming-changes.md).

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
| `POST /jobs?steps=7000` | Starts a job; the body is a WebODM splats training zip. Options: `steps`, `max_gaussians`, `sh_degree`, `downscale`. Masks in the zip (`masks/<image's name>.png`, black is ignored) are applied. A zip that also holds `resume.ply` (an earlier job's result) continues that model: `steps` is then the total |
| `GET /jobs`, `GET /jobs/<id>` | State (`queued`, `running`, `completed`, `failed`, `canceled`), progress, error |
| `GET /jobs/<id>/log?offset=<bytes>` | The trainer's output from that byte on |
| `GET /jobs/<id>/result` | The trained model (`.ply`, which WebODM converts for its viewer) |
| `POST /jobs/<id>/cancel`, `DELETE /jobs/<id>` | Stops a job; deletes it |

## Using it

1. **Connect the node** (administrators): **SplatMe** in WebODM's side menu. Enter the node's address as
   WebODM's containers reach it (`http://<host>:3100`) and its token; **Test Connection** says what is wrong
   (no answer, wrong token, no GPU, a node too old) before anything is saved. Other users see only whether the
   node is ready, its GPU and its queue.
2. **Train**: on the Dashboard, open a completed task and press **Train Splats**. Choose a **Quality**: Draft
   (2,000 steps), Standard (7,000) or High (30,000); **Advanced** has the steps, the image size and the most
   gaussians as numbers. The dialog says first if the task cannot be trained, and warns when nearly all photos
   point straight down.

   **Ignore Sky** is for photos that show the sky, which a training otherwise turns into haze around the
   model: SplatMe finds the sky in each photo and the training leaves those pixels out. It looks only above
   each photo's horizon, known from where the camera pointed, so photos that look down are not searched. Finding the sky takes a few minutes more (about 0.2 s a
   photo on WebODM's CPU), and the task's line then says in how many photos it was found. The first training
   with it downloads the sky model (180 MB, the one ODX uses for its sky removal) from ODX's releases on
   github.com into WebODM's media folder (`plugins/splatme/models`), so WebODM must reach that address once.

   **Crop To Boundary** shows for a task that was processed with a boundary (a GeoJSON file in WebODM's
   Boundary option) and is ticked: the splats outside the boundary are left out of the model the task shows,
   as the processing leaves them out of the point cloud and the mesh. The training itself still sees the
   photos whole, and the model kept for continuing is not cropped.

   A task SplatMe has trained can be trained further instead of starting over: the dialog then opens with
   **Start Over** and **Continue From Step** (the steps the model has), and continuing asks only **More
   Steps**. The other options stay as the model was trained. Continuing sharpens the model the task has; it
   adds few new gaussians, so a model that lacks detail everywhere is better started over at a higher
   Quality. Processing the task again, or uploading another model in WebODM's Splats dialog, ends what can
   be continued.
3. **Follow it**: the task's panel shows the stage, a progress bar, **Cancel** and **Show Log** (the trainer's
   output), to everyone who can see the task and after a reload. When it is done, **View in 3D** opens the model.

4. **Train automatically**: a task's panel has **Train Splats When Completed** with **Change**: turned on, the
   task is trained when it completes processing, and again each time it is processed again, with the Quality
   chosen there. It can be set while the task is still processing. The same setting is in WebODM's **Edit
   Task Options** dialog (the **Edit** button of the Options row, when creating a task and when editing one):
   open **Point Cloud** and press **Train Splats When Completed** under SplatMe. It is saved when chosen
   there, whatever is then done with the dialog's other options; a new task gets it when it is created.
   Administrators set the default for every
   task without a setting of its own on the **SplatMe** page (**Automatic Training**); it is off until they
   turn it on. A training that could not start shows on the task as a failed training, with the reason.

   **Restart WebODM once after installing or updating the plugin** (`./webodm.sh restart`): WebODM's worker
   loads plugins only when it starts, and it is the worker that tells SplatMe a task has completed. Until
   then the SplatMe page says that automatic training is not active yet; the button works without a restart.

Training needs the right to change the task's project. The task must have completed with a point cloud and
still have its photos (JPEG). The trained model replaces the task's splat model only when training succeeds,
and then shows in the task's 3D view like a model uploaded by hand. WebODM converts it for its viewer with its
own converter, as it does a model uploaded by hand; the model as the trainer wrote it is kept in the task's
folder (`assets/splats/splatme-model.ply`, about 250 bytes per gaussian) for continuing, and counts in the
task's size.

The plugin needs a splat node of version 0.2.0 or later; **Test Connection** says when the node is older.
Update the node with the command that started it.

## The plugin's API

Under `/api/plugins/splatme/`, with a WebODM login.

| Request | Does |
|---|---|
| `GET node` | The node's state or that it is not available; for administrators also its address and what is wrong. The token is never sent back |
| `POST node` (`url`, `token`, `save`) | Administrators: sets the address and token; with `save` false only tries them |
| `GET task/<id>/check` | Before training: why the task or the node cannot train, warnings, the options' ranges, `boundary` (whether the task was processed with one) and `trained_steps`: the steps of the model a training can continue from |
| `POST task/<id>/train` | Trains a completed task's splats. Options: `steps` (7000), `image_size` (1600, the photos' longer side in pixels; 0 keeps them as they are), `max_gaussians`, `sh_degree`, `ignore_sky` (true leaves the sky out), `crop` (false keeps the splats outside the task's boundary). With `resume` true it continues the task's trained model: `steps` is then how many more, and the other options are the earlier training's |
| `GET task/<id>/status` | The job's `state`, `progress`, `status`, `error`, `sky_masks` (in how many photos sky was found, with `ignore_sky`), `cropped` (the gaussians left out for being outside the boundary), whether the task has a splat model and whether the user may train it |
| `POST task/<id>/cancel` | Stops the job |
| `GET task/<id>/log?offset=<bytes>` | The trainer's output |
| `GET task/<id>/auto` | Whether the task is trained when it completes, with which options, and whether that is the task's `own` setting or the default |
| `POST task/<id>/auto` | Sets that for the task: `enabled` and the options of `train`; `reset` true follows the default again |
| `GET automation` | The default for tasks without a setting of their own; for administrators also `listening`, whether WebODM's worker tells the plugin of completed tasks. With `?ranges=1`: the default and the node's range of each option |
| `POST automation` (`enabled`, options) | Administrators: sets the default |

## Development

See [CLAUDE.md](CLAUDE.md): `dev/webodm.sh up` runs WebODM 4.0.0 with the plugin mounted, on
http://localhost:8008.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
