# Changelog

The plugin's versions (`splatme/manifest.json`). The splat node has its own version (`node/splatnode.py`), named
where a release needs a newer one.

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
  make a thermal task not thermal. Crop To Boundary leaves out what is in a boundary's holes. A thermal task of
  thousands of photos finds its range in bounded memory.
- **SplatMe → Tasks**: New Task With Splats no longer replaces a task whose files are being sent; it names photos
  SplatMe cannot train. Closing Train Splats or Change while it is answered no longer loses the training or the
  setting. A task set to train is followed when it completes, until its training shows; while only trainings are
  followed, only their rows are asked for. A task's name opens the Dashboard at its project, wherever it is in
  the pages. The dialogs keep the keyboard's focus.
- **Dashboard**: the Splats line keeps following after a failed request, and leaves out Open in SplatMe for a
  task SplatMe cannot train. SplatMe's button stays last among the project's buttons.
- **New task upload**: a file whose part is lost is sent again from its first part (WebODM appends parts).
- **node/splatnode.sh**: upgrade and status work when the node does not answer; install joins the network
  WebODM's worker uses (behind a reverse proxy it joined the proxy's); connect moves the node to a reinstalled
  WebODM's network; upgrade rewrites the compose file and deletes the previous image (6.6 GB each); a failed
  install is undone; a port in use is refused first; uninstall clears the token too.
- **Splat node 0.2.2**: a failure inside the node no longer leaves it stuck or silent. A full disk fails the job it
  hit and the next one trains; a trainer that won't stop is killed, and one that prints nothing for a long time is
  stopped (`SPLATNODE_STALL_MINUTES`); a damaged job file is set aside instead of keeping the node from starting;
  every error is answered with its message; deleting a job answers at once. If its worker stops anyway, the node
  exits and Docker starts it again. `/info` no longer holds up the jobs while it asks the GPU; finished jobs expire
  while the queue is busy too.
- **The documentation moved to its own site**, https://winuxnomacs.github.io/webodm-splatme/, published with each
  release, with a new **Getting Started**: a fresh install from start to a first trained model, and an upgrade,
  each step with what to expect. The README introduces SplatMe and links to it.
- **Administration → SplatMe** has the splat node's install steps, each command with a Copy button: in place
  of the node's state while no node is set, and behind How to Install a Splat Node under it once one is.
- The docs say to restart WebODM with the options it was started with, and how to reach a node on another
  machine over HTTPS (a TLS proxy in front of it); `splatnode.sh upgrade` keeps a node's `SPLATNODE_BIND`, so a
  node bound to its own machine behind that proxy stays so.

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
