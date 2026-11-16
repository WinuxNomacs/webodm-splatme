# SplatMe

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically.

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on its Tasks page trains a task's splats on a GPU and
puts the model in the task's 3D view.

![A thermal task's trained splats in WebODM's 3D view](screenshots/model.png)

**Status: experimental** (the [releases](https://github.com/WinuxNomacs/webodm-splatme/releases) and their
[changes](CHANGELOG.md)). It has been used on WebODM 4.0.0 in Docker with an 8 GB NVIDIA GPU. Problems and ideas go in the repository's
[issues](https://github.com/WinuxNomacs/webodm-splatme/issues); what is planned is in
[upcoming-changes.md](upcoming-changes.md).

## Requirements

- WebODM 4.0.0 or later, installed with Docker. WebODM's native Windows app is not supported: it has no
  `splat-tools` to convert a trained model, and cannot build a plugin's page scripts. On an older WebODM,
  **Load Plugin (.zip)** says SplatMe was installed but WebODM then does not show it (and refuses it as already
  there): update WebODM first.
- An NVIDIA GPU that Docker can use, for the training container (the "splat node"), on WebODM's machine or
  another one: Docker, Docker Compose and the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## Install

By a WebODM administrator, in this order:

1. **The plugin**: in WebODM, **Administration → Plugins → Install Plugins**, find SplatMe (marked
   Experimental) and press **Install**. Or download `splatme-<version>.zip` from the
   [latest release](https://github.com/WinuxNomacs/webodm-splatme/releases/latest) and send it with **Load
   Plugin (.zip)** on the same page.
2. **Restart WebODM once**, with the options it was started with: `./webodm.sh restart` in WebODM's folder,
   plus any options given to `./webodm.sh start` (`--port`, `--hostname`, `--media-dir`, `--ssl`…), which
   `webodm.sh` does not remember. WebODM's web server runs several
   processes and only the one that received the plugin loads it, so until the restart SplatMe's pages, scripts
   and API fail now and then; and WebODM's worker, which tells SplatMe a task has completed, loads plugins only
   when it starts. Until then SplatMe → Settings, SplatMe's panel and a task set to train say that tasks are
   not trained by themselves yet.
3. **The splat node**, on the machine with the GPU:

   ```
   curl -fsSL https://github.com/WinuxNomacs/webodm-splatme/releases/latest/download/splatnode.sh | bash -s install
   ```

   It downloads the node's image (6.6 GB; deleted again when a container cannot use the GPU), checks the GPU and
   starts the node; a failed install is undone, so it can be run again. **On WebODM's machine** the node joins
   the Docker network of WebODM's worker (which runs the trainings; behind a reverse proxy WebODM's web server is
   on the proxy's network too), listens on that machine only, and SplatMe's settings get
   its address and token: there is nothing to enter. (With several WebODMs on the machine, it names them and
   asks for one: `--webodm <its webapp container>`. A node installed before the plugin is connected afterwards
   with `connect`, which also moves the node to a reinstalled WebODM's network.) **On another machine**, or with `--standalone`, it listens on port 3100 (`--port`) and
   prints its address and token: enter them on **Administration → SplatMe** in WebODM's side menu, where **Test
   Connection** says what is wrong (no answer, wrong token, no GPU, a node too old) before anything is saved.
   Every request to the node needs its token, but the connection is plain HTTP: let only WebODM's machine reach
   that port.

   ![Administration → SplatMe, connected to the splat node](screenshots/admin.png)

Then train a task on **SplatMe → Tasks** (below).

## Upgrade

Between trainings: a training running during an upgrade picks up again or fails with a message.

- **The plugin**: **Install Plugins** shows **Update** when a newer SplatMe is listed. With the zip instead:
  delete SplatMe on Administration → Plugins (its row's bin), then **Load Plugin (.zip)** with the new zip, which
  WebODM refuses while a plugin of that name is installed. Either way SplatMe's settings, users' options and tasks' trainings are
  kept (they are in WebODM's database, not in the plugin's folder). **Restart WebODM once** afterwards. The
  sky model is downloaded again by the next training with Ignore Sky, as an update replaces the plugin's folder.
- **The splat node**: `curl -fsSL …/splatnode.sh | bash -s upgrade` (the same address as above) downloads the
  newest image, restarts the node with the script's current compose file, keeping its jobs, token and port, and
  deletes the previous image. SplatMe needs a node of version 0.2.0 or
  later, and **Test Connection** says when the node is older.

## Uninstall

- **The splat node**: `curl -fsSL …/splatnode.sh | bash -s uninstall` stops and removes the node and its folder
  (`~/splatnode`), and asks before deleting its jobs' data and its image, and before removing it from
  SplatMe's settings (`--yes` answers yes to all).
- **The plugin**: its row's bin on Administration → Plugins removes the plugin's folder, with the sky model it
  downloaded. It leaves:
  - **The trained models**: each task keeps its model in its 3D view, as a model uploaded by hand, and the
    model as the trainer wrote it (`assets/splats/splatme-model.ply`, kept for continuing a training), both
    deleted with the task. To delete only the kept ones (the tasks then cannot be continued):
    `docker exec webapp sh -c 'rm -f /webodm/app/media/project/*/task/*/assets/splats/splatme-model.ply'`.
  - **SplatMe's settings and records** in WebODM's database (the node's address and token, the
    administrators' defaults, users' options, each task's training), which a reinstall finds again. To delete
    them:
    `docker exec webapp python manage.py shell -c "from app.models import PluginDatum; PluginDatum.objects.filter(key__startswith='splatme::').delete()"`.

## Using it

![SplatMe → Tasks with a trained thermal task](screenshots/tasks.png)

Every user sees on **SplatMe → Settings** in the side menu whether the node is ready, its address, its GPU and
its queue (never the token, and what is wrong with the node only as "ask an administrator"). The node's address
and token are on **Administration → SplatMe** (superusers): WebODM has no plugin hook for Administration, so
SplatMe adds its item to the list as WebODM 4.0.0 draws it; the page itself is at `/plugins/splatme/admin/`.

1. **Train**: on **SplatMe → Tasks** in the side menu, which lists the tasks SplatMe can train in the projects
   the user can see (a **Project** filter narrows it), press **Train Splats** on a completed task. A task is
   listed when its photos are JPEG (or DJI Thermal Analyzer's TIFFs, below) and, once completed, it has what a
   training needs (a point cloud, its photos), or when it already has splats; a project with no such task is not
   listed. **New Task With Splats** above the
   list creates a task in any project the user may change, listed or not. Choose a **Quality**: Draft
   (3,000 steps), Standard (7,000), Fine (15,000) or High (30,000, the default: OpenSplat's own). On an 8 GB GPU
   at the default image size, training takes about 2, 5, 10 and 25 minutes and up to 3, 5, 5 and 7 GB of GPU
   memory, whatever the number of photos. The dialog says first if the task cannot be trained, and warns when
   nearly all photos point straight down.

   <img src="screenshots/train.png" alt="The Train Splats dialog with Advanced open" width="400">

   **Advanced** has the steps, the image size and the most gaussians as numbers:
   - **Steps**: the trainer grows the model (adds gaussians where the photos show detail it lacks) in the first
     half of the steps, up to step 15,000, then refines it; steps beyond 30,000 only refine it. A table under
     the number gives the share of the steps in each stage, with how many times the model is grown: **Warm-up**
     (the starting points from the point cloud adjusted), **Growing**, **Refining** (the model adjusted once
     every 32 photos, faint gaussians removed every 3,000 steps) and **Polishing** (the same, once every 64
     photos); each heading's hover tip says what the stage does. A number of steps the trainer handles badly
     gets a note: up to 2,000 steps grows no new gaussians, and 3,001 to 5,999 trains worse than 3,000.
   - **Image Size** (1,600 by default): the photos' longer side as the trainer sees them. Larger photos are
     scaled down whole, so each keeps its full view: nothing is cropped, only fine detail is lost; smaller ones
     are not enlarged, and 0 keeps them as they are. It is what to lower when the GPU runs out of memory, which
     depends on it most. A table under the number gives the task's photo size (one row per camera), its size
     at the Image Size entered, and how much the longer side and the pixels change. Full-size photos cost far
     more: a training of 12-megapixel photos at 30,000 steps ran about 15 times slower than at 1,600 and
     filled an 8 GB GPU before its model had finished growing.
   - **Max Gaussians**: the most gaussians the model may grow to, a limit for very large scenes.

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

   **Thermal tasks**: a task made by the DJI Thermal Analyzer plugin's Thermal Task button holds TIFFs of
   temperatures, which SplatMe draws as pictures to train on. It uses one range for the whole task, from its coldest to its hottest pixels (the coldest and hottest 1% left
   out), so a surface has the same colour in every photo. **Thermal Colours** in the dialog, which takes the
   place of Ignore Sky, chooses the palette: Grayscale (white is hot, the default), Black Hot, Iron, Magma,
   Inferno, Plasma, Viridis, Cividis or Jet (all but Iron are WebODM's own colour maps). The task's line then
   names the palette and the temperatures it spans, in WebODM's unit system. Thermal photos are small (640 × 512
   on DJI's M4T): training takes about a quarter of the times above and about 1 GB of GPU memory, and Fine is
   much sharper than Standard. DJI Thermal Analyzer itself need
   not be installed for this; TIFFs from other software, whose temperatures may be in another unit, are not
   listed.

   A task SplatMe has trained can be trained further instead of starting over: the dialog then opens with
   **Start Over** and **Continue From Step** (the steps the model has), and continuing asks only **More
   Steps**. The other options stay as the model was trained. Continuing sharpens the model the task has: the
   model grows only before half the new total of steps (and before step 15,000), so continuing a model by as
   many steps again, or beyond, adds no gaussians (the steps table says so), and a model that lacks detail
   everywhere is better started over at a higher Quality. Processing the task again, or uploading another model in WebODM's Splats dialog, ends what can
   be continued.
2. **Follow it**: the task's row shows the stage (while training, the step, such as "Step 4,650 of 7,000,
   about 12 min left": the time the steps left take at the rate of the last few minutes, once it can tell), a
   progress bar, **Cancel** and **Show Log** (the trainer's output), to everyone who can see the task and after
   a reload. When it is done, **View in 3D** opens the model. A task that cannot be trained (failed or canceled
   processing; for users who may only look at the project, any task) says why.

   On the Dashboard, a task's panel has a **Splats** line under its Task ID ("Trained, 7,000 steps", or the
   training's step) with **Open in SplatMe**, which opens the Tasks page at that task. Training is not in the
   task's panel itself: WebODM keeps only the first plugin's answer to that panel's hook, so a SplatMe button
   there dropped other plugins' buttons (such as Lightning's Share).

3. **Train automatically**: on **SplatMe → Tasks**, press **New Task With Splats** in a project's heading
   (or beside **Select Images and GCP** in a project on the Dashboard, which opens it there) and pick the
   photos, with a GCP file and other text files if the task has them. WebODM's own New Task panel opens (name,
   processing node, options, resize, alignment), with SplatMe's panel above it: **Train Splats When
   Completed**, ticked, with the Quality, Ignore Sky (or Thermal Colours when the photos picked are TIFFs), Crop
   To Boundary and Advanced. On **Start Processing**,
   SplatMe creates the task through WebODM's API, saves its training setting, uploads the files (a large file
   in parts, each sent again if the connection drops) and starts its processing; the row then follows the
   processing (its progress, and WebODM's error if it fails) and the training. If some files still fail,
   **Try Again** sends them, or **Cancel** removes the task. Leaving the page during the upload stops it.
   Unticked, or made from WebODM's own Select Images and GCP, the task is an ordinary one. The panel
   starts with the user's own options, saved on **SplatMe → Settings** (**New Task With Splats**); until they
   save some, with the administrators' defaults from **Administration → SplatMe** (High until they change
   them). On **SplatMe → Tasks**, every task shows **Train Splats When Completed** with **Change**, which
   switches the training on or off and changes its options. A training that could not start shows on the task
   as a failed training, with the reason.

   WebODM has no plugin hooks for the Dashboard's button and the task panel's line, so SplatMe puts them in the
   page as WebODM 4.0.0 draws it (the button beside other plugins' buttons, such as DJI Thermal Analyzer's). If
   a WebODM version draws its page differently, they are not there, and the Tasks page still creates, trains
   and sets the training.

Training needs the right to change the task's project. The task must have completed with a point cloud and
still have its photos (JPEG, or DJI Thermal Analyzer's TIFFs). The trained model replaces the task's splat model only when training succeeds,
and then shows in the task's 3D view like a model uploaded by hand. WebODM converts it for its viewer with its
own converter, as it does a model uploaded by hand; the model as the trainer wrote it is kept in the task's
folder (`assets/splats/splatme-model.ply`, about 250 bytes per gaussian) for continuing, and counts in the
task's size.

## The splat node

[node/splatnode.sh](node/splatnode.sh) writes a compose file and its `.env` (with the token, readable by its
owner only) to `~/splatnode` (`SPLATNODE_DIR`); `status` says whether the node answers, and `connect` gives
SplatMe the node's address and token again (after installing SplatMe, or reinstalling WebODM, whose network the
node then joins; `connect --webodm <container>` connects a node installed `--standalone` to a WebODM on the same
machine). The node's settings are read from that `.env` only, not from variables of the same names in the shell. Without the
script: `SPLATNODE_TOKEN=<a secret> docker compose -f node/compose.yml up -d`, from a checkout (add `--build` to
compile the image instead, which downloads libtorch and compiles [OpenSplat](https://github.com/WebODM/OpenSplat),
v1.2.2 for CUDA 12.8: GTX 16 and RTX 20 to RTX 50 series, and takes a while). The image is
`ghcr.io/winuxnomacs/splatme-node`, tagged with the node's version and `latest`.

The node trains one job at a time and queues the others, and deletes a finished job after 48 hours
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

## The plugin's API

Under `/api/plugins/splatme/`, with a WebODM login.

| Request | Does |
|---|---|
| `GET node` | The node's state or that it is not available, and its `url`; for administrators also what is wrong and `token_set`. The token is never sent back |
| `POST node` (`url`, `token`, `save`) | Administrators: sets the address and token; with `save` false only tries them |
| `GET task/<id>/check` | Before training: why the task or the node cannot train, warnings, the options' ranges, `boundary` (whether the task was processed with one), `thermal` (whether its photos are DJI Thermal Analyzer's TIFFs), `photo_sizes` (the photos' `[width, height]`, one per camera, empty before processing) and `trained_steps`: the steps of the model a training can continue from |
| `POST task/<id>/train` | Trains a completed task's splats. Options: `steps` (30000), `image_size` (1600, the photos' longer side in pixels, larger photos scaled down whole; 0 keeps them as they are), `max_gaussians`, `sh_degree`, `ignore_sky` (true leaves the sky out; not for a thermal task), `crop` (false keeps the splats outside the task's boundary), `palette` (a thermal task's colours: `gray`, the default, `gray_r`, `iron`, `magma`, `inferno`, `plasma`, `viridis`, `cividis`, `jet`). With `resume` true it continues the task's trained model: `steps` is then how many more, and the other options are the earlier training's |
| `GET task/<id>/status` | The job's `state`, `progress`, `status`, `error`, `sky_masks` (in how many photos sky was found, with `ignore_sky`), `cropped` (the gaussians left out for being outside the boundary), `thermal` (a thermal task's `palette` and the range it spans, `low` and `high`, in degrees Celsius), `time_left` (while training, the seconds the steps left should take, once known), whether the task has a splat model and whether the user may train it; for a task set to train, `listening` (whether WebODM's worker tells the plugin of completed tasks) |
| `POST task/<id>/cancel` | Stops the job |
| `GET task/<id>/log?offset=<bytes>` | The trainer's output |
| `GET task/<id>/auto` | Whether the task is trained when it completes, with which options |
| `POST task/<id>/auto` | Sets that for the task: `enabled` and the options of `train` |
| `GET automation` | The options SplatMe's panel starts with for the user's new task: their own (`own` true) or the administrators' defaults, and `listening`, whether WebODM's worker tells the plugin of completed tasks. With `?ranges=1` also the node's range of each option |
| `POST automation` (options) | Saves the user's own options; with `reset` true drops them |
| `GET automation/shared`, `POST automation/shared` (options) | The administrators' defaults, for users who saved none of their own; superusers set them |
| `GET tasks` | The tasks SplatMe can train in the projects the user may see (`?project=<id>` for one), by project (a project with none is left out), each with WebODM's `status`, `running_progress` and `last_error`, and its `splats` as `task/<id>/status` gives them; and `addable`, the projects the user may add a task to: SplatMe's Tasks page, in one request |

## Development

See [CLAUDE.md](CLAUDE.md): `dev/webodm.sh up` runs WebODM 4.0.0 with the plugin mounted, on
http://localhost:8008.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
