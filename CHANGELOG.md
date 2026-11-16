# Changelog

The plugin's versions (`splatme/manifest.json`). The splat node has its own version (`node/splatnode.py`), named
where a release needs a newer one.

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
