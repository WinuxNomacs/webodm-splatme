# The Splat Node

[node/splatnode.sh](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/splatnode.sh) writes a compose file and its `.env` (with the token, readable by its
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

Its API ([node/splatnode.py](https://github.com/WinuxNomacs/webodm-splatme/blob/main/node/splatnode.py)), with `Authorization: Bearer <token>`:

| Request | Does |
|---|---|
| `GET /info` | The node, its trainer, its GPU, its queue and the options a job accepts |
| `POST /jobs?steps=7000` | Starts a job; the body is a WebODM splats training zip. Options: `steps`, `max_gaussians`, `sh_degree`, `downscale`. Masks in the zip (`masks/<image's name>.png`, black is ignored) are applied. A zip that also holds `resume.ply` (an earlier job's result) continues that model: `steps` is then the total |
| `GET /jobs`, `GET /jobs/<id>` | State (`queued`, `running`, `completed`, `failed`, `canceled`), progress, error |
| `GET /jobs/<id>/log?offset=<bytes>` | The trainer's output from that byte on |
| `GET /jobs/<id>/result` | The trained model (`.ply`, which WebODM converts for its viewer) |
| `POST /jobs/<id>/cancel`, `DELETE /jobs/<id>` | Stops a job; deletes it |

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
