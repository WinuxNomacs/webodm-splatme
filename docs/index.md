# SplatMe

[![SplatMe: a drone's photos becoming a trained splat model](assets/splash/splash-medium.jpg)](assets/splash/splash.jpg)

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically via
[OpenSplat](https://github.com/WebODM/OpenSplat) or [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio).

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on its Tasks page trains a task's splats on a GPU and
puts the model in the task's 3D view. A task can also be set to train by itself when its processing completes.
Its editor crops a trained model and cleans it of floaters, and repairs WebODM's textured 3D model: it removes
floating pieces and objects, fills holes, and straightens, smooths and moves surfaces.

![A thermal task's trained splats in WebODM's 3D view](assets/screenshots/model.png)

**Status: experimental.** It has been used on WebODM 4.0.0 and 4.0.1 in Docker with an 8 GB NVIDIA GPU. See the
[releases](https://github.com/WinuxNomacs/webodm-splatme/releases) and the [changelog](changelog.md). Problems
and ideas go in the repository's [issues](https://github.com/WinuxNomacs/webodm-splatme/issues).

## Requirements

- **WebODM 4.0.1 or later, installed with Docker**. WebODM's
  native Windows app is not supported. On an older WebODM, **Load Plugin (.zip)** says SplatMe was installed but
  WebODM then does not show it (and refuses it as already there): update WebODM first.
- **An NVIDIA GPU that Docker can use**, for the training container (the "splat node"), on WebODM's machine or
  another one: GTX 16 or RTX 20 to RTX 50 series, its driver, Docker with Docker Compose v2, and the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

## Where to Go Next

- **[Getting Started](getting-started.md)**: a fresh install from start to a first trained model, and an upgrade.
- [Install, Upgrade, Uninstall](install.md): the reference for each, and what an uninstall leaves.
- [Using SplatMe](using.md): training, its options, following a training, and training automatically.
- [Editing Splats](editing.md): cropping a trained model, removing floaters, adjusting its colours, and
  downloading it.
- [Editing the 3D Model](editing-model.md): cleaning up and repairing WebODM's textured model: removing floating
  pieces and objects, filling holes, flattening, smoothing, straightening and moving surfaces, and cloning texture.
- [The Splat Node](splat-node.md): the GPU container, its trainers, settings, API, licences and source, and HTTPS to a node on another
  machine.
- [How It Works](how-it-works.md): what SplatMe takes from WebODM, and how OpenSplat and LichtFeld Studio train a model
  from it.
- [The Plugin's API](api.md) and [Development](development.md).

## Thanks

SplatMe is built on these projects:

- **[WebODM](https://github.com/WebODM/WebODM)** and its creator, **[Piero Toffanin](https://piero.dev/)**:
  SplatMe is a WebODM plugin, and reuses WebODM's export of a task's training data, its splat conversion and
  its 3D view.
- **[OpenSplat](https://github.com/WebODM/OpenSplat)** and **[LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio)**:
  the trainers in the splat node.
- **[ODX](https://github.com/WebODM/ODX)**: the sky model Ignore Sky uses.
- **[Splat-Tools](https://github.com/uav4geo/Splat-Tools)**: the conversion WebODM runs on a trained model for its
  3D view.
- **[PyTorch](https://pytorch.org)**: libtorch, which OpenSplat trains with.
- **[Spark](https://github.com/sparkjsdev/spark)**: the editor's view of the splats.
- **[three.js](https://threejs.org)**: the editor's 3D view, and its loading of the textured 3D model.
