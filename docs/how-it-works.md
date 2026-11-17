# How It Works

What happens to a task between **Train Splats** and its model in the 3D view: what SplatMe takes from WebODM, and
how [OpenSplat](https://github.com/WebODM/OpenSplat) turns it into Gaussian splats. Taken from WebODM 4.0.0's
`app/splats.py` and OpenSplat's code at the commit the splat node is built from (`e33f9dd`, OpenSplat 1.2.2).

In short: WebODM's processing has already worked out where every photo was taken from and made a coloured point
cloud. OpenSplat turns each point into a small, coloured, semi-transparent blob (a *gaussian*), then spends the
training's steps rendering the blobs from the photos' viewpoints, comparing each render with its photo, and
nudging, adding and removing blobs until the renders match.

## 1. What Comes From WebODM

Nothing is reconstructed again. A training starts from four results of the task's processing:

| From the task | Used for |
|---|---|
| The photos | What every render is compared with |
| `cameras.json` | Each camera's focal length, centre and lens distortion |
| `shots.geojson` | Where each photo was taken from, and which way it faced |
| `georeferenced_model.laz` | The dense point cloud: the starting blobs |

WebODM's own export (`prepare_export`, the same as **Download Training Data** in a task's **Splats** dialog) writes
them in COLMAP's format, which OpenSplat reads:

- **`cameras.bin`**: the cameras, OpenSfM's lens models mapped to COLMAP's.
- **`images.bin`**: each photo's pose. The 2D feature points are left out; OpenSplat does not use them.
- **`points3D.bin`**: the point cloud thinned by PDAL, so that points are at least a set distance apart. The
  distance is chosen for about 125,000 points over the area seen from above; walls and roofs add more (a
  217-photo oblique task kept about 405,000).
- **`images/`**: the photos, JPEG only, resized to the training's **Image Size** (Lanczos, quality 95).

Every coordinate is shifted by the task's local offset, so that the numbers stay small.

SplatMe adds to that zip: a sky mask per photo in `masks/` (**Ignore Sky**), and the task's last trained model as
`resume.ply` (**Continue From Step**). A thermal task's photos are first drawn in the chosen palette, and the
export is made from those.

## 2. Preparing the Scene

- **Normalising**: OpenSplat centres the scene on the cameras' average position and scales it so that the
  farthest camera is at distance 1; the points move with it. The scene's size, used below, is the cameras' spread
  (times 1.1).
- **The photos**: each photo is read once, its lens distortion removed and its mask fitted to it, and kept in a
  cache of compressed JPEGs that may grow to 90% of the machine's memory. While training, a few threads decode the
  next steps' photos ahead of time.
- A photo that sees none of the points is left out.

## 3. The Starting Model

Each point becomes one gaussian:

| Property | Starts as |
|---|---|
| Position | The point's |
| Size | The average distance to its three nearest points, the same along all three axes |
| Rotation | None |
| Colour | The point's colour |
| Opacity | 10% |

The colour is stored as *spherical harmonics*, which let it change with the angle it is seen from: at degree 3
(**SH degree**), 16 numbers per colour channel, of which only the first starts set. A gaussian at degree 3 holds 59
numbers; that is why GPU memory follows the number of gaussians.

## 4. One Training Step

Each step takes one photo (the photos come round in a shuffled loop):

1. **Render**: every gaussian is projected into that camera as a 2D ellipse, coloured for the direction it is seen
   from, and the ellipses are blended front to back over a black background, in tiles of 16 × 16 pixels.
2. **Compare**: the loss is 80% the average difference of the pixels and 20% their structural similarity (SSIM).
   Where a mask covers part of the photo, those pixels do not count, and a penalty pushes the blobs there towards
   transparent: that is how Ignore Sky keeps the sky out of the model.
3. **Learn**: the loss is traced back to each gaussian's position, size, rotation, colour and opacity, and an
   optimiser (Adam) moves them. How far it moves the positions shrinks over the training, from 1.6e-4 to 1.6e-6 of
   the scene's size; the other rates stay the same.

At 7,000 steps, a task of 217 photos has each photo compared about 32 times.

## 5. The Schedule

OpenSplat trains as FastGS does (a faster variant of the original Gaussian splatting training). How the
training's steps are spent depends on their total:

| Phase | When | What happens |
|---|---|---|
| Colour detail | From the start | The colour's angle detail opens one degree every 1,000 steps: one plain colour until step 1,000, all of it from step 3,000 |
| Growing | Every 500 steps, from step 1,000 until half the steps (at most step 15,000) | Blobs are added where the renders are worst (below) |
| Opacity reset | Every 3,000 steps while growing | Every blob is turned down to 1% opacity: those that matter earn it back, the others can then be pruned |
| Refining | Once growing ends | No new blobs. The optimiser gathers the steps' changes and applies them every 32 steps, then every 64 after two thirds of the steps (at most step 20,000): the late steps cost less |
| Final pruning | Every 3,000 steps after growing | Blobs under 10% opacity, the worst-scored, and any that flew far off or grew huge are removed |

**How growing chooses**: 10 random photos are rendered, and each one's worst pixels marked. Each gaussian scores
the bad pixels it covers, averaged over the photos; one on an edge in the photo scores more. A
gaussian covering more than 5 bad pixels, and pulled hard by the training since the last growing, is copied if it is
small, or split into two smaller ones (at 1/1.6 of its size, placed at random within it) if it is large. Blobs that
are almost invisible, or (after step 3,000) too large, become candidates for removal, and half of them are
removed, mostly those with the worst error. Opacity is then capped at 80%. **Max Gaussians** only stops the
copying, once the count has reached it.

For example, **Standard** (7,000 steps) grows the model at steps 1,000 to 3,000 (with an opacity reset at 3,000)
until step 3,500; the optimiser applies every step until then, every 32 steps until about step 4,670, then every
64; the final pruning runs at step 6,000. **High** (30,000 steps) grows until step 15,000, with four opacity resets,
and prunes at steps 18,000, 21,000, 24,000 and 27,000.

That schedule is why a few step counts train worse than their neighbours (the hint under **Steps** says which):
up to 2,000 steps grow nothing, and from 3,001 to 5,999 steps the final pruning at step 3,000 cuts a model that is
still weak, with too few steps left to recover.

## 6. The Result

The trainer writes the gaussians as a `.ply` (position, colour, opacity, size and rotation of each), moved back to
the task's coordinates, so the model lines up in the task's 3D view; its header says the step it was saved at
(`Generated by opensplat at iteration 7000`). SplatMe keeps that file whole in the task's folder
(`assets/splats/splatme-model.ply`), for continuing. For the 3D view, it cuts a copy to the task's boundary
(**Crop to Boundary**) and converts it with WebODM's `splat-tools`, as WebODM's own import of a model does, into
the level-of-detail `.rad` that the 3D view, the download and the share links use.

**Continue From Step** sends that `.ply` back: the trainer loads its gaussians and its step, starts the optimiser
afresh, and carries on the schedule from that step towards the new total. As growing ends at half the total (and
at step 15,000), continuing a model mostly sharpens the gaussians it already has.
