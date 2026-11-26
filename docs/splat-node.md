# The Splat Node

[node/splatnode.sh](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/splatnode.sh) writes a compose file and its `.env` (with the token, readable by its
owner only) to `~/splatnode` (`SPLATNODE_DIR`); `status` says whether the node answers, and `connect` gives
SplatMe the node's address and token again (after installing SplatMe, or reinstalling WebODM, whose network the
node then joins; `connect --webodm <container>` connects a node installed `--standalone` to a WebODM on the same
machine, after asking, as the node then listens on that machine only; `--force` does not ask). The node's settings are read from that `.env` only, not from variables of the same names in the shell. Without the
script: `SPLATNODE_TOKEN=<a secret> docker compose -f node/compose.yml up -d`, from a checkout (add `--build` to
compile the image instead, which downloads libtorch and compiles [OpenSplat](https://github.com/WebODM/OpenSplat),
v1.2.2 for CUDA 12.8: GTX 16 and RTX 20 to RTX 50 series; the build needs about 27 GB of disk). The image is
`ghcr.io/winuxnomacs/splatme-node`, tagged with the node's version and `latest`.

## Trainers

A node runs one trainer, chosen at install: `splatnode.sh install --trainer opensplat` (the default) or
`--trainer lichtfeld`. `status` names it, and `upgrade` keeps it; to change it, uninstall the node, then install
it again with the other.

| Trainer | Image |
| --- | --- |
| [OpenSplat](https://github.com/WebODM/OpenSplat) 1.2.2 | `ghcr.io/winuxnomacs/splatme-node` |
| [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio) v0.5.4.3 | `ghcr.io/winuxnomacs/splatme-node-lichtfeld`, about a seventh of OpenSplat's size on disk |

LichtFeld Studio's first training on a GPU starts about 2 minutes late: it builds its GPU code for that GPU, then keeps it in the node's volume for the next ones.
[How It Works](how-it-works.md) describes how each trainer trains. `node/compose.yml` runs OpenSplat's node only.

## Jobs

The node trains one job at a time and queues the others, and deletes a finished job after 48 hours
(`SPLATNODE_KEEP_HOURS`). A training whose trainer prints nothing for 30 minutes is stopped and fails with that
reason (`SPLATNODE_STALL_MINUTES`). Both are set in `~/splatnode/.env`, then `splatnode.sh upgrade`; a value that is not
a number, or is below 1, is logged and the default used. If the node's own worker stops or hangs, or a trainer
cannot be stopped, the node exits and Docker starts it again; the training it was running fails with a message.
`status` says how to start a node that is not running.

## API

Its API ([node/splatnode.py](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/splatnode.py)), with `Authorization: Bearer <token>`:

| Request | Does |
|---|---|
| `GET /health` | Whether the node works (no token needed): 503 when its worker has stopped |
| `GET /info` | The node, its trainer (`trainer`, its version; `trainer_kind`, `opensplat` or `lichtfeld`; `supports`, whether it takes `masks` and can `continue` a model; `continue_from`, the `properties` a model needs for it to continue it and the SH degrees it takes, `sh_degrees`: node 0.3.0), its GPU, its queue and the options a job accepts, each with its default and its `min` and `max`, its `choices`, or `"type": "bool"` |
| `POST /jobs?steps=7000` | Starts a job; the body is a WebODM splats training zip. Options, those of the node's trainer only (another is refused): OpenSplat's `steps`, `max_gaussians`, `sh_degree`, `downscale`, `densify_until` (node 0.2.3: OpenSplat's `--densify-until`, at most `steps` - 3,000); LichtFeld Studio's `steps`, `max_gaussians`, `sh_degree`, `strategy` (`mrnf`, `mcmc` or `igs+`), `exposure_correction` (`true` or `false`). Masks in the zip (`masks/<image's name>.png`, black is ignored) are applied. A zip that also holds `resume.ply` (a splat model, written by either trainer) continues that model: `steps` is then the total, and `resume_steps` gives the model's steps (needed unless OpenSplat wrote it, whose model says them). OpenSplat continues another trainer's model rewritten in its own form (the same values); LichtFeld Studio reads either as it is, and trains the steps between. Either trains at the model's SH degree. A model the trainer can't continue (no splat properties, an SH degree it doesn't take, cut short) is refused with the reason. `ref=<name>` (up to 64 letters, digits, `-` or `_`) is kept with the job |
| `GET /jobs`, `GET /jobs/<id>` | State (`queued`, `running`, `completed`, `failed`, `canceled`), progress, error, and once completed `trained_steps`, the steps its model was trained to (node 0.3.0); `GET /jobs?ref=<name>` lists the jobs with that ref |
| `GET /jobs/<id>/log?offset=<bytes>` | The trainer's output from that byte on |
| `GET /jobs/<id>/result` | The trained model (`.ply`, which WebODM converts for its viewer) |
| `POST /jobs/<id>/cancel`, `DELETE /jobs/<id>` | Stops a job; deletes it |

## Licences and Source

Each image holds its trainer's licence beside the trainer, and its `splatme.trainer.source` label links to the
trainer's source at the commit it was built from. The node's own code (`splatnode.py`) is SplatMe's, AGPL-3.0.
Both images are built by a Dockerfile in this repository, at the release's tag, which pins every source they are
built from. This is where to find them, not legal advice.

| Image | Licences (in the image) | Built from |
| --- | --- | --- |
| `splatme-node` | OpenSplat: AGPL-3.0 (`/opt/opensplat/LICENSE.txt`) | [OpenSplat](https://github.com/WebODM/OpenSplat) at the commit of [node/Dockerfile](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/Dockerfile)'s `OPENSPLAT_COMMIT`, and PyTorch's libtorch (2.7.1 for CUDA 12.8, by checksum) |
| `splatme-node-lichtfeld` | LichtFeld Studio: GPL-3.0-or-later with its NVIDIA GPU library exception (`/opt/lichtfeld/LICENSE`, `LICENSE-EXCEPTION.txt`); the libraries built with it, each with its licence (`/opt/lichtfeld/THIRD-PARTY-LICENSES.md`) | [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio) at the commit of [node/lichtfeld.Dockerfile](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/lichtfeld.Dockerfile)'s `LFS_COMMIT`, its libraries from [vcpkg](https://github.com/microsoft/vcpkg) at `VCPKG_COMMIT` |

Both run on NVIDIA's CUDA base image, under NVIDIA's terms; LichtFeld Studio's image also holds the CUDA runtime,
cuRAND and nvJPEG libraries it loads.

## HTTPS to a node on another machine

On WebODM's machine the node is reached on WebODM's Docker network, and nothing crosses the wire. A node on
another machine is reached over plain HTTP: its token, the task's photos and the trained model cross the network
in clear. To encrypt them, put a TLS proxy in front of the node, on the node's machine, with a certificate WebODM
trusts: a public one, such as Let's Encrypt's (SplatMe checks the certificate, so a self-signed one is refused).
With [Caddy](https://caddyserver.com/docs/install) and a domain name that points at the node's machine (ports 80
and 443 reachable, for the certificate):

1. Make the node listen on its own machine only: in `~/splatnode/.env` set `SPLATNODE_BIND=127.0.0.1:` (with
    the colon), then run `splatnode.sh upgrade`, which restarts the node and keeps that setting.
2. In `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`:

    ```
    splatnode.example.com {
        reverse_proxy 127.0.0.1:3100
    }
    ```

3. On **Administration → SplatMe**: Node Address `https://splatnode.example.com`, **Test Connection**, **Save**.

Caddy sets no limit on a request's size. Another proxy may need one lifted for the training zip, which holds the
task's photos (nginx: `client_max_body_size 0;`).
