# SplatMe

[![SplatMe: a drone's photos becoming a trained splat model](docs/assets/splash/splash-medium.jpg)](docs/assets/splash/splash.jpg)

A [WebODM](https://github.com/WebODM/WebODM) plugin that trains a task's Gaussian splats automatically via
[OpenSplat](https://github.com/WebODM/OpenSplat).

WebODM can export a task's training data and display a trained splat model, but the training itself is done by
hand in other software. SplatMe does that step: one button on its Tasks page trains a task's splats on a GPU and
puts the model in the task's 3D view. A task can also be set to train by itself when its processing completes, and
a trained model can be cropped, cleaned of floaters and recoloured before it is shown or downloaded. It is
experimental.

![A thermal task's trained splats in WebODM's 3D view](docs/assets/screenshots/model.png)

**[Getting Started](https://winuxnomacs.github.io/webodm-splatme/getting-started/)**: a fresh install from start
to a first trained model, and an upgrade, step by step.
**[Documentation](https://winuxnomacs.github.io/webodm-splatme/)**: installing, upgrading and uninstalling,
using SplatMe, editing splats and the 3D model, the splat node, how it works, the plugin's API and development.

## Thanks

SplatMe is built on these projects:

- **[WebODM](https://github.com/WebODM/WebODM)** and its creator, **[Piero Toffanin](https://piero.dev/)**:
  SplatMe is a WebODM plugin, and reuses WebODM's export of a task's training data, its splat conversion and
  its 3D view.
- **[OpenSplat](https://github.com/WebODM/OpenSplat)**: the trainer in the splat node.
- **[ODX](https://github.com/WebODM/ODX)**: the sky model Ignore Sky uses.
- **[Splat-Tools](https://github.com/uav4geo/Splat-Tools)**: the conversion WebODM runs on a trained model for its
  3D view.
- **[PyTorch](https://pytorch.org)**: libtorch, which OpenSplat trains with.
- **[Spark](https://github.com/sparkjsdev/spark)** and **[three.js](https://threejs.org)**: the 3D view of Edit
  Splats.

## Licence

AGPL-3.0, see [LICENSE](LICENSE).
