# SplatMe

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically.

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on its Tasks page trains a task's splats on a GPU and
puts the model in the task's 3D view.

**Status: in development.** The training container (the "splat node") works, and the plugin trains a task
through it, from **SplatMe → Tasks** or by itself when a task completes. There is no release yet. The
plan is in [upcoming-changes.md](upcoming-changes.md).

## Requirements

- WebODM 4.0.0 or later, installed with Docker. WebODM's native Windows app is not supported: it has no
  `splat-tools` to convert a trained model, and cannot build a plugin's page scripts.
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

1. **Connect the node** (superusers): **Administration → SplatMe** in WebODM's side menu. Enter the node's
   address as WebODM's containers reach it (`http://<host>:3100`) and its token; **Test Connection** says what
   is wrong (no answer, wrong token, no GPU, a node too old) before anything is saved. Every user sees on
   **SplatMe → Settings** in the side menu whether the node is ready, its address, its GPU and its queue (never the
   token, and what is wrong with the node only as "ask an administrator"). WebODM has no plugin hook for
   Administration, so SplatMe adds its item to the list as WebODM 4.0.0 draws it; the page itself is at
   `/plugins/splatme/admin/`.
2. **Train**: on **SplatMe → Tasks** in the side menu, which lists the tasks of every project the user can see
   (a **Project** filter narrows it), press **Train Splats** on a completed task. Choose a **Quality**: Draft
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
3. **Follow it**: the task's row shows the stage (while training, the step, such as "Step 4,650 of 7,000,
   about 12 min left": the time the steps left take at the rate of the last few minutes, once it can tell), a
   progress bar, **Cancel** and **Show Log** (the trainer's output), to everyone who can see the task and after
   a reload. When it is done, **View in 3D** opens the model. A task that cannot be trained (failed or canceled
   processing; for users who may only look at the project, any task) says why.

   On the Dashboard, a task's panel has a **Splats** line under its Task ID ("Trained, 7,000 steps", or the
   training's step) with **Open in SplatMe**, which opens the Tasks page at that task. Training is not in the
   task's panel itself: WebODM keeps only the first plugin's answer to that panel's hook, so a SplatMe button
   there dropped other plugins' buttons (such as Lightning's Share).

4. **Train automatically**: on **SplatMe → Tasks**, press **New Task With Splats** in a project's heading
   (or beside **Select Images and GCP** in a project on the Dashboard, which opens it there) and pick the
   photos, with a GCP file and other text files if the task has them. WebODM's own New Task panel opens (name,
   processing node, options, resize, alignment), with SplatMe's panel above it: **Train Splats When
   Completed**, ticked, with the Quality, Ignore Sky, Crop To Boundary and Advanced. On **Start Processing**,
   SplatMe creates the task through WebODM's API, saves its training setting, uploads the files (a large file
   in parts, each sent again if the connection drops) and starts its processing; the row then follows the
   processing (its progress, and WebODM's error if it fails) and the training. If some files still fail,
   **Try Again** sends them, or **Cancel** removes the task. Leaving the page during the upload stops it.
   Unticked, or made from WebODM's own Select Images and GCP, the task is an ordinary one. The panel
   starts with the user's own options, saved on **SplatMe → Settings** (**New Task With Splats**); until they
   save some, with the administrators' defaults from **Administration → SplatMe** (Standard until they change
   them). On **SplatMe → Tasks**, every task shows **Train Splats When Completed** with **Change**, which
   switches the training on or off and changes its options. A training that could not start shows on the task
   as a failed training, with the reason.

   WebODM has no plugin hooks for the Dashboard's button and the task panel's line, so SplatMe puts them in the
   page as WebODM 4.0.0 draws it (the button beside other plugins' buttons, such as DJI Thermal Analyzer's). If
   a WebODM version draws its page differently, they are not there, and the Tasks page still creates, trains
   and sets the training.

   **Restart WebODM once after installing or updating the plugin** (`./webodm.sh restart`): WebODM's worker
   loads plugins only when it starts, and it is the worker that tells SplatMe a task has completed. Until
   then SplatMe → Settings, SplatMe's panel and a task set to train say that tasks are not trained by
   themselves yet; **Train Splats** works without a restart.

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
| `GET node` | The node's state or that it is not available, and its `url`; for administrators also what is wrong and `token_set`. The token is never sent back |
| `POST node` (`url`, `token`, `save`) | Administrators: sets the address and token; with `save` false only tries them |
| `GET task/<id>/check` | Before training: why the task or the node cannot train, warnings, the options' ranges, `boundary` (whether the task was processed with one) and `trained_steps`: the steps of the model a training can continue from |
| `POST task/<id>/train` | Trains a completed task's splats. Options: `steps` (7000), `image_size` (1600, the photos' longer side in pixels; 0 keeps them as they are), `max_gaussians`, `sh_degree`, `ignore_sky` (true leaves the sky out), `crop` (false keeps the splats outside the task's boundary). With `resume` true it continues the task's trained model: `steps` is then how many more, and the other options are the earlier training's |
| `GET task/<id>/status` | The job's `state`, `progress`, `status`, `error`, `sky_masks` (in how many photos sky was found, with `ignore_sky`), `cropped` (the gaussians left out for being outside the boundary), `time_left` (while training, the seconds the steps left should take, once known), whether the task has a splat model and whether the user may train it; for a task set to train, `listening` (whether WebODM's worker tells the plugin of completed tasks) |
| `POST task/<id>/cancel` | Stops the job |
| `GET task/<id>/log?offset=<bytes>` | The trainer's output |
| `GET task/<id>/auto` | Whether the task is trained when it completes, with which options |
| `POST task/<id>/auto` | Sets that for the task: `enabled` and the options of `train` |
| `GET automation` | The options SplatMe's panel starts with for the user's new task: their own (`own` true) or the administrators' defaults, and `listening`, whether WebODM's worker tells the plugin of completed tasks. With `?ranges=1` also the node's range of each option |
| `POST automation` (options) | Saves the user's own options; with `reset` true drops them |
| `GET automation/shared`, `POST automation/shared` (options) | The administrators' defaults, for users who saved none of their own; superusers set them |
| `GET tasks` | The tasks of the projects the user may see (`?project=<id>` for one), by project, each with WebODM's `status`, `running_progress` and `last_error`, and its `splats` as `task/<id>/status` gives them: SplatMe's Tasks page, in one request |

## Development

See [CLAUDE.md](CLAUDE.md): `dev/webodm.sh up` runs WebODM 4.0.0 with the plugin mounted, on
http://localhost:8008.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
