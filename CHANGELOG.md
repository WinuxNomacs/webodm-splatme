# Changelog

The plugin's versions (`splatme/manifest.json`). The splat node has its own version (`node/splatnode.py`), named
where a release needs a newer one.

## Unreleased

LichtFeld Studio as a second trainer, and several splat nodes at once: install an OpenSplat and a LichtFeld Studio
node side by side and choose which trains. **Needs WebODM 4.0.1 or later**: update WebODM first (each release now
needs the newest WebODM of its day; an older one does not load SplatMe). Needs splat node 0.3.0 for LichtFeld
Studio and for continuing a model the other trainer made; SplatMe still trains on a node of 0.2.0 or later (**Test
Connection** says what it lacks).

- **LichtFeld Studio**: `splatnode.sh install --trainer lichtfeld` installs a node that trains with it (its image,
  `ghcr.io/winuxnomacs/splatme-node-lichtfeld`, 1.4 GB, is published with each release beside OpenSplat's). Its
  first training on a GPU starts about 2 minutes late, as it builds its GPU code for that GPU. With it, the forms
  offer **Strategy** and **Exposure Correction**, and show only the options it has (no Grow Until nor steps
  table).
- **SH Degree** is in the forms, for either trainer.
- **Several splat nodes**: Administration → SplatMe lists every node, and adds, edits, tests, removes and reorders
  them (**Add a Splat Node**, **Make Default**); a node training a task is neither removed nor moved to another
  address. The node set up before becomes the first, the default, named after its trainer. `splatnode.sh --name
  <name>` installs a node of its own beside the first, for both trainers on one machine.
- With two or more nodes, **Splat Node** in Train Splats, Change, SplatMe's panel and SplatMe → Settings chooses
  the one that trains; the options shown are its trainer's, and each trainer keeps its own saved options. A node
  removed since leaves the settings that chose it on the default.
- **Continue From Step** works on any node whose trainer can read the model, whichever trainer made it (node 0.3.0
  rewrites a LichtFeld Studio model for OpenSplat; LichtFeld Studio reads OpenSplat's as it is), keeping the
  model's Image Size, Crop to Boundary, Ignore Sky and palette; the dialog names the nodes that can when the chosen
  one can't.
- An option saved for another trainer is left out of a training, which names it, instead of refusing to start.
- Splat nodes' addresses are shown to superusers only.
- Train Splats no longer resets Steps or Image Size typed in before the dialog finished loading.
- After an upgrade, browsers load SplatMe's new pages at once instead of their old scripts from the cache, which
  could last hours.
- A node that is training no longer shows as not answering, or as having no GPU, on a machine where `nvidia-smi`
  slows down under a training: Train Splats can queue another training then, and an automatic training no longer
  fails. Node 0.3.0 answers with its last GPU reading while it trains; with an older node, SplatMe accepts a busy
  node that reports no GPU.
- The splat node refuses an upload that would unpack to more than its disk or its model's size, kills what a
  trainer leaves running, and serves at most 128 connections at once. `splatnode.sh uninstall --yes` keeps an
  image built on the machine, and the script no longer puts the token on `curl`'s command line.
- API: `GET nodes`, `POST nodes`, `POST` and `DELETE nodes/<id>`; `node` on `train`, `auto` and `automation`;
  `check`'s `nodes` with `continue_problem`. The node's `/info` says what a model needs to be continued
  (`continue_from`), and a job takes `resume_steps`.

## 0.4.0 (2026-11-23)

Cleaning up WebODM's textured 3D model, and better splat training. Needs splat node 0.2.3 for Grow Until (an older
node refuses a training only when Grow Until is set) and for datasets of 2 to 4.3 GB (below); **Test Connection**
says what an older node lacks. Restart WebODM once after the upgrade: until then Update the Model and Continue From
Step fail.

- **3D model cleanup and repair**: **Edit** now edits the task's textured 3D model too (**Splats** and **3D
  Model** above the editor's view; a task with a textured model but no splats opens on it). **Remove Floating
  Pieces** and **Fill Holes** act on the whole model. The **Brush** paints on the model's surface, sized in
  metres: **Fill** (the holes painted over, with the texture beside them), **Clone** (a good area's texture copied
  where it paints, filling the holes under it), **Smooth**, **Flatten**, **Raise**, **Lower**, **Remove** and
  **Restore**; the wheel sizes it. **Remove Object** takes off an object painted over, or outlined with a lasso or
  a polygon, down to the surface it stands on, and lays that surface again with the texture round it. **Straighten**
  makes a broken edge (a gutter, an eave) straight: traced by points clicked along it, it is moved straight between
  its ends, the surface near it with it; each end can be raised or lowered to level it or set a pitch. A box, polygon or lasso can **Remove** or **Keep
  Inside**, or **Move Inside** (raise, shift or stretch it, with a soft edge). A **Repair** row starts each repair.
  Their settings change a step at a time with - and +.
  Filled holes take the texture of the surface beside them. The view shows the edits as
  they change; **Update the Model** writes them into the GLB (WebODM's 3D view and share links) and the OBJ (the
  Textured Model download) in seconds, keeping the original files, so **Clear Edits** then **Update the Model**
  puts the model back. A brush stroke that jumps to another surface (off an eave down to the ground) ends there
  and starts again, one Undo for the whole drag; on a phone, one finger paints and two fingers turn the view. A
  fill goes when a later edit takes the surface round it. Update the Model waits for WebODM to finish processing the
  task, and refuses an update whose Clone and wide fills need a texture over 16,384 pixels a side. **Textured Model
  (3D Tiles)** in WebODM's downloads keeps the unedited model. See
  [Editing the 3D Model](https://winuxnomacs.github.io/webodm-splatme/editing-model/).
- **Splat training**: **Grow Until**, under Advanced and on **Continue From Step**, sets the step the model stops
  growing at (blank keeps the trainer's own: half the steps, at most 15,000), so a long training or a continued
  one can add gaussians; **Continue From Step** shows the stages table only when the added steps grow the model.
  The summary on **SplatMe → Tasks** gives the day and the trainer's own time (a continued model's whole training
  included), with Ignore Sky's and the waiting apart.
- **Edit Splats**: **Apply** is now **Update the Model**, with a line under it saying whether the task's model
  has the edits as they are; **Side View** is **Reset View**, and a double-click centres the view on the splat
  under the pointer; the tool in use is highlighted, and another tool's button ends it; **Redo**, and keys:
  Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, Delete, B, L, P and X; **Add Box** starts a third of the model's width and
  removes what is inside it.
- **SplatMe → Tasks**: each row has its status line above its buttons, **Edit** beside **Train Splats** as a main
  action, and **View in 3D** and **Download .ply** in a menu on a phone; a picture of the model, taken by Edit
  Splats. One **New Task With Splats** button, at the top.
- **Image Size** left blank means full size (it showed 0).
- Shorter page introductions, each with a link into the documentation.
- **API**: `task/<id>/model-edits` (GET, PUT), `model-original` and `model-apply` (with `cancel`);
  `task/<id>/thumbnail` (GET, PUT); `status` adds `times`, `resume`, `earlier_training`, `thumbnail`,
  `model_editable` and `model_apply`; `check` adds `trained_grow_until`; `node` adds `update`.
- The 3D model's editor uses three.js 0.187.0's GLTF and Draco loaders (MIT) and the Draco decoder from the same
  package (Apache-2.0), vendored with their hashes.
- **Documentation**: a new page, **Editing the 3D Model**.
- Fixed: a training whose dataset zip was between 2 GiB and about 4.3 GB (a few thousand photos at a large Image
  Size) failed with "Invalid zip archive": OpenSplat's zip reader refuses the ZIP64 offsets WebODM's export gives
  entries past 2 GiB. Splat node 0.2.3 unpacks the dataset itself and gives OpenSplat the folder; the zip is deleted
  once unpacked, so a training also needs less disk on the node.
- Fixed: on a case-insensitive disk (a WebODM whose media folder is on one), New Task With Splats showed nothing.

## 0.3.0 (2026-11-19)

Editing a trained model. Works with splat node 0.2.0 or later; no new node (0.2.2 is the latest). Restart WebODM
once after the upgrade: until then Apply and Continue From Step fail.

- **Edit Splats**, from **Edit** on a task's row on **SplatMe → Tasks**: the model SplatMe trained, in a 3D view,
  with a list of edits. **Add Box** and **Draw Polygon** keep or remove what is inside them; the **Lasso** and the
  **Brush** remove what is under them on screen, through to the back, and the Brush's **Restore** paints back what
  the edits before it removed; **Remove Floaters** (Light, Medium or Strong) removes the splats far from the rest
  and the oversized ones; **Colour Adjust** changes the whole model's brightness, contrast, saturation and warmth.
  The view hides what the edits remove as they change; they are saved as they are made, with **Undo** and **Clear
  Edits**. Only those who may change the task's project can edit.
- **Apply** makes the task's model again from its trained model with the edits, so WebODM's 3D view, its download
  and share links show the edited model; **Cancel** stops it, leaving the model as it was. A later training of the
  task applies the edits again. The trained model itself is never changed: **Clear Edits**, then **Apply**, makes
  it whole again.
- **Download .ply**, on **Edit Splats** and on each trained task's row, gives the task's model with its saved
  edits as a `.ply`, for other splat tools; anyone who may see the task may download it.
- **The trained model moved** from the task's assets to its `data/splatme` folder, so share links and WebODM's
  **All Assets** download no longer give the uncut model. A model trained by 0.2 moves there when SplatMe first needs it.
- **API**: `task/<id>/edits` (GET, PUT), `apply` (with `cancel`), `download`, `model` and `floaters`; `status`
  adds `edited`, `edits_error`, `editable` and `apply`. See [the plugin's API](https://winuxnomacs.github.io/webodm-splatme/api/).
- The editor's 3D view uses three.js 0.187.0 and Spark 2.4.0 (both MIT), vendored in the plugin with their
  hashes. The zip now includes SplatMe's licence.
- **Documentation**: a new page, **Editing Splats**, and the upgrade from 0.2 in **Getting Started**.

## 0.2.0 (2026-11-16)

Fixes from a review of 0.1.1. Works with splat node 0.2.0 or later; node 0.2.2 comes with it.

- **Trainings waiting on the node** no longer take one of WebODM's worker places each: a training's own worker
  job ends once the node has its photos, and one job follows all the node's trainings. Many trainings at once no
  longer hold up WebODM's own processing.
- **A task processed again while its splats train** has that training canceled (its model would not fit the new
  results), and is trained again when set to Train Splats When Completed.
- **Continue** trains with the options the model was trained with, not those of the task's last training (a
  canceled one, say). A model trained by 0.1 continues only while its training is the task's last.
- **Trainings left unattended** are picked up again after WebODM's worker restarts: when any task completes or
  fails, or any WebODM page opens, not only SplatMe's. The job that follows the node's trainings outlives a
  database error.
- A download of the model that drops is tried again; a node that stops answering, or answers an error (a proxy
  while the node restarts), is waited for up to an hour, then asked to drop the job. A cancel during the import keeps the task's model. A job whose worker keeps dying
  (memory) fails with the reason.
- GCP, geo and image group files, alignment files and ODM's masks no longer hide a task from SplatMe → Tasks, nor
  make a thermal task not thermal. Crop to Boundary leaves out what is in a boundary's holes. A thermal task of
  thousands of photos finds its range in bounded memory.
- **SplatMe → Tasks**: New Task With Splats no longer replaces a task whose files are being sent; it names photos
  SplatMe cannot train. Closing Train Splats or Change while it is answered no longer loses the training or the
  setting. A task set to train is followed when it completes, until its training shows. A task's name opens the Dashboard at its project, wherever it is in
  the pages. The dialogs keep the keyboard's focus.
- **Dashboard**: the Splats line keeps following after a failed request, and leaves out Open in SplatMe for a
  task SplatMe cannot train. SplatMe's button stays last among the project's buttons.
- **Trainings left unattended**, more: Train or an automatic start over a training that lost its worker deletes
  that training's job on the node; two first Train requests at once start one training; a training waiting in
  WebODM's worker queue no longer counts as a lost worker, and one that fails that way while importing keeps its
  model on the node; the time left is told from each training's own steps. The model's conversion has an hour;
  the task's model, the file it continues from and its options are replaced together, or not at all; a proxy's
  page in place of the node's answer is waited for like a node that does not answer; a training whose upload's
  answer was lost follows the job the node made (node 0.2.2).
- **SplatMe → Tasks** asks only for the rows that move while tasks process (a processing task through WebODM's
  own API), and nothing while its tab is hidden. Its fields' labels name their fields; New Task With Splats keeps
  the typed name after a failure. Crop to Boundary and Use the Administrators' Defaults are spelled as the other
  names are.
- **New task upload**: a file whose part is lost is sent again from its first part (WebODM appends parts).
- **node/splatnode.sh**: upgrade and status work when the node does not answer; install joins the network
  WebODM's worker uses (behind a reverse proxy it joined the proxy's); connect moves the node to a reinstalled
  WebODM's network; upgrade rewrites the compose file and deletes the previous image (6.6 GB each, unpacked); a failed
  install is undone; a port in use is refused first; uninstall clears the token too. Upgrade asks first while the
  node trains (that training would fail; `--force` with no terminal); connect asks before a node that listened
  on every address listens on its machine only; status says how to start a node that is not running.
- **Splat node 0.2.2**: a failure inside the node no longer leaves it stuck or silent. A full disk fails the job it
  hit and the next one trains; a trainer that won't stop is killed, and one that prints nothing for a long time is
  stopped (`SPLATNODE_STALL_MINUTES`); a damaged job file is set aside instead of keeping the node from starting;
  every error is answered with its message; deleting a job answers at once, and the job stays deleted through a
  restart. If its worker stops anyway, or stops beating, or a trainer outlasts SIGKILL, the node exits and Docker
  starts it again. A job keeps the client's `ref`, to be found by it. `/info` no longer holds up the jobs while it asks the GPU; finished jobs expire
  while the queue is busy too. A setting that is not a number, or is too small, is logged and its default used.
  Built on CUDA 12.8.2, with the base image's packages brought up to date.
- **The documentation moved to its own site**, https://winuxnomacs.github.io/webodm-splatme/, published with each
  release, with a new **Getting Started**: a fresh install from start to a first trained model, and an upgrade,
  each step with what to expect. The README introduces SplatMe and links to it.
- **Administration → SplatMe** has the splat node's install steps, each command with a Copy button: in place
  of the node's state while no node is set, and behind How to Install a Splat Node under it once one is.
- `splatnode.sh upgrade` keeps a node's `SPLATNODE_BIND`, so a node bound to its own machine behind an HTTPS
  proxy stays so.

## 0.1.1 (2026-11-16)

- On the Dashboard, the New Task With Splats button and a task panel's Splats line were sometimes missing: SplatMe's
  script could start before the page was parsed.

## 0.1.0 (2026-11-16)

The first release, marked experimental. Needs WebODM 4.0.0 or later in Docker, and a splat node 0.2.0 or later
(`ghcr.io/winuxnomacs/splatme-node`) on a machine with an NVIDIA GPU.

- **Train Splats** on **SplatMe → Tasks**: trains a completed task's Gaussian splats on the splat node
  ([OpenSplat](https://github.com/WebODM/OpenSplat) 1.2.2) and puts the model in the task's 3D view, as a model
  uploaded by hand. Quality presets (Draft, Standard, Fine, High, the default) and Advanced (Steps, with the
  share of each training stage; Image Size, with the photos' size before and after; Max Gaussians).
- **Continue** a trained model by more steps instead of starting over.
- **Ignore Sky** leaves the sky out of the training (ODX's sky model); **Crop To Boundary** cuts the model to
  the task's boundary.
- **Thermal tasks** (DJI Thermal Analyzer's TIFFs), drawn in a palette chosen in **Thermal Colours**, with one
  temperature range for the whole task.
- **New Task With Splats** creates a task that is trained when it completes processing; any task can be set to
  do so (**Train Splats When Completed**). Users save their own options on **SplatMe → Settings**;
  administrators set the defaults on **Administration → SplatMe**, with the node's address and token.
- Each training shows its stage, progress, time left and log; on the Dashboard, a task's panel has a
  **Splats** line.
- **node/splatnode.sh** installs, upgrades and uninstalls the splat node, and connects it to SplatMe when
  WebODM runs on the same machine.
