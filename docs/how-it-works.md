# How It Works

What happens to a task between **Train Splats** and its model in the 3D view: what SplatMe takes from WebODM, and
how the splat node's trainer, [OpenSplat](https://github.com/WebODM/OpenSplat) or
[LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio), turns it into Gaussian splats.

In short: WebODM's processing has already worked out where every photo was taken from and made a coloured point
cloud. The trainer turns each point into a small, coloured, semi-transparent blob (a *gaussian*), then spends the
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
them in COLMAP's format, which both trainers read:

- **`cameras.bin`**: the cameras, OpenSfM's lens models mapped to COLMAP's.
- **`images.bin`**: each photo's pose. The 2D feature points are left out.
- **`points3D.bin`**: the point cloud thinned by PDAL, so that points are at least a set distance apart. The
  distance is chosen for about 125,000 points over the area seen from above; walls and roofs add more (a
  217-photo oblique task kept about 405,000).
- **`images/`**: the photos, JPEG only, resized to the training's **Image Size** (Lanczos, quality 95).

Every coordinate is shifted by the task's local offset, so that the numbers stay small.

SplatMe adds to that zip: a sky mask per photo in `masks/` (**Ignore Sky**), and the task's last trained model as
`resume.ply` (**Continue From Step**). A thermal task's photos are first drawn in the chosen palette, and the
export is made from those.

## 2. With OpenSplat

### Preparing the Scene

- **Normalising**: OpenSplat centres the scene on the cameras' average position and scales it so that the
  farthest camera is at distance 1; the points move with it. The scene's size, used below, is the cameras' spread
  (times 1.1).
- **The photos**: each photo is read once, its lens distortion removed and its mask fitted to it, and kept in a
  cache of compressed JPEGs that may grow to 90% of the machine's memory. While training, a few threads decode the
  next steps' photos ahead of time.
- A photo that sees none of the points is left out.

### The Starting Model

Each point becomes one gaussian:

| Property | Starts as |
|---|---|
| Position | The point's |
| Size | The average distance to its three nearest points, the same along all three axes |
| Rotation | None |
| Colour | The point's colour |
| Opacity | 10% |

The colour is stored as *spherical harmonics*, which let it change with the angle it is seen from: at degree 3,
OpenSplat's default, 16 numbers per colour channel, of which only the first starts set. A gaussian at degree 3 holds 59
numbers; that is why GPU memory follows the number of gaussians.

### One Training Step

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

### The Schedule

OpenSplat trains as FastGS does (a faster variant of the original Gaussian splatting training). How the
training's steps are spent depends on their total:

| Phase | When | What happens |
|---|---|---|
| Colour detail | From the start | The colour's angle detail opens one degree every 1,000 steps: one plain colour until step 1,000, all of it from step 3,000 |
| Growing | Every 500 steps, from step 1,000 until half the steps (at most step 15,000), or until **Grow Until** | Blobs are added where the renders are worst (below) |
| Opacity reset | Every 3,000 steps while growing | Every blob is turned down to 1% opacity: those that matter earn it back, the others can then be pruned |
| Refining | Once growing ends | No new blobs. The optimiser gathers the steps' changes and applies them every 32 steps, then every 64 after two thirds of the steps (at most step 20,000; if growing ends later, every 64 from there): the late steps cost less |
| Final pruning | Every 3,000 steps after growing | Blobs under 10% opacity, the worst-scored, and any that flew far off or grew huge are removed |

**How growing chooses**: 10 random photos are rendered, and each one's worst pixels marked. Each gaussian scores
the bad pixels it covers, averaged over the photos; one on an edge in the photo scores more. A
gaussian covering more than 5 bad pixels, and pulled hard by the training since the last growing, is copied if it is
small, or split into two smaller ones (at 1/1.6 of its size, placed at random within it) if it is large. Blobs that
are almost invisible, or (after step 3,000) too large, become candidates for removal, and half of them are
removed, mostly those with the worst error. Opacity is then capped at 80%. **Max Gaussians** only stops the
copying, once the count has reached it.

For example, **Standard** (7,000 steps) grows the model every 500 steps from step 1,000 until step 3,500
(with an opacity reset at 3,000); the optimiser applies every step until then, every 32 steps until about step 4,670, then every
64; the final pruning runs at step 6,000. **High** (30,000 steps) grows until step 15,000, with four opacity resets,
and prunes at steps 18,000, 21,000, 24,000 and 27,000.

That schedule is why a few step counts train worse than their neighbours (the hint under **Steps** says which):
up to 2,000 steps grow nothing, and from 3,001 to 5,999 steps the final pruning at step 3,000 cuts a model that is
still weak, with too few steps left to recover.

### Continuing

**Continue From Step** sends the task's model back: OpenSplat loads its gaussians and its step, starts the optimiser
afresh, and carries on the schedule from that step towards the new total. As growing ends at half the total (and
at step 15,000), continuing a model mostly sharpens the gaussians it already has, unless **Grow Until** is set past
the model's step: the model then grows again until it. A model LichtFeld Studio made is first rewritten into
OpenSplat's form (the same values, its properties in OpenSplat's order, with the step SplatMe kept with it), and
trained at its SH degree; OpenSplat cannot continue a model of SH degree 0.

## 3. With LichtFeld Studio

The splat node runs it as `LichtFeld-Studio --headless -d <dataset> -o <folder> --export ply --undistort --log-level info -i <Steps>`,
with **Max Gaussians** as `--max-cap`, **Strategy**, **SH Degree** and **Exposure Correction** when they are set,
`--mask-mode ignore` with **Ignore Sky**, and, when continuing, `--init <the model>` with `-i` the steps left. Its three strategies (**MRNF**, the default, **MCMC** and **IGS+**) share how the scene is prepared and how a
step trains; they differ in how the model grows, and in some of their defaults.

### Preparing the Scene

- **No normalising**: the scene stays in the task's coordinates. Its size, which MCMC and IGS+ scale their steps
  by, is the median distance of the points from the cameras' average position.
- **The photos**: each photo and its mask are undistorted once, into a camera without lens distortion. They are
  kept in memory as JPEGs, in a cache that may grow to 90% of the machine's memory, and decoded on the GPU. A
  photo's longer side is cut to 3,840 pixels: only full-size photos larger than that are resized.
- Every photo is trained on; none is held out.

### The Starting Model

Each point becomes one gaussian; a point cloud of more points than **Max Gaussians** is first thinned to it, at
random.

| Property | Starts as |
|---|---|
| Position | The point's |
| Size | The same along all three axes. MRNF: a quarter of the sum of the distances to its two nearest points, at least 0.001 and at most a tenth of the scene's middle width. MCMC and IGS+: a tenth of the average distance to its three nearest points |
| Rotation | None |
| Colour | The point's colour, as the first of its spherical harmonics |
| Opacity | 50% (MRNF, MCMC) or 10% (IGS+) |

### One Training Step

Each step takes one photo (the photos come round in a shuffled loop):

1. **Render**: as OpenSplat, with a rasterizer derived from FastGS's: tiles of 16 × 16 pixels, over a black
   background.
2. **Compare**: the loss is the average difference of the pixels and their structural similarity (SSIM), 78% and
   22% with MRNF, 80% and 20% with the others. MRNF adds a term for the photo's edges (from step 2,000), weighs thin
   structures more, and adds small penalties that keep the gaussians' sizes and colours in check; MCMC adds a
   penalty on opacity and one on size; IGS+ adds none. With every strategy, from step 1,000, each photo may be warped
   slightly to match the renders, which absorbs small errors in its camera. Where a mask covers part of the photo
   (**Ignore Sky**), those pixels do not count and earn no growing. Unlike OpenSplat, nothing pushes the
   gaussians there towards transparent.
3. **Learn**: an optimiser (Adam) moves each gaussian's position, size, rotation, colour and opacity. How far it
   moves the positions shrinks over the training: with MRNF from 2.2e-5 to 2e-7 of the scene's middle width, with
   MCMC from 1.6e-5 of the scene's size to a hundredth of that, with IGS+ to a tenth.

The colour's angle detail opens one degree every 1,000 steps, as with OpenSplat.

### Exposure Correction

On by default with MRNF, off with MCMC and IGS+ (LichtFeld Studio's defaults, which SplatMe's forms follow). Beside
the model, the trainer learns each photo's exposure and colour balance, each camera's vignetting (its lens's
darkening towards the edges), and, from step 1,000, a coarse grid of local brightness and colour per photo. Each
render is corrected by them before it is compared with its photo, so light that changed between photos goes into
them instead of into the model. After every step, their average over the photos is taken away, so the model keeps
the photos' average appearance.

None of them is exported: the `.ply` holds only the model, which the 3D view shows as it is. The vignetting is why
it can look a little brighter than the photos' edges: on a 217-photo task, the vignetting learned darkened a
1,600 × 1,200 photo by 7.5% on average (by 26% in its corners), so the model is the scene without the lens's
darkening.

### The Schedule

**Steps** does not change when things happen: LichtFeld Studio's schedule is that of its 30,000-step default,
whatever the total. A shorter training stops before its later phases: at 7,000 steps, MRNF is still growing the
model at its last step.

| | MRNF (the default) | MCMC | IGS+ |
|---|---|---|---|
| **Max Gaussians** when blank | 5,000,000 | 1,000,000 | 4,000,000 |
| Refines | Every 163 steps, until step 28,500 | Every 100 steps, from step 500 until 25,000 | Every 500 steps, from step 500 until 15,000 |
| Grows | Until step 15,000, by a share of the gaussians whose error is high (more for a higher Max Gaussians: about 12% more gaussians per refine at 5,000,000) | By 5% per refine until Max Gaussians, then only moves them | Towards a count that rises on a curve, from the starting count to Max Gaussians at step 15,000 |
| Chooses | Gaussians with a high error since the last refine, more often on edges; each is split in two along its longest axis | Moves the faded gaussians (0.5% opacity or less) onto those with a high error | As MRNF, among the gaussians with the highest error |
| Opacity reset | None: each refine turns the gaussians seen down a little, and those that matter earn it back | None | Every 3,000 steps until step 15,000, to at most 10% |
| Removes | At each refine, those under 1/255 opacity; their places go to splits of visible gaussians | None: they are moved instead | At each refine, those under 0.5% opacity |

MRNF also adds a few thousand gaussians once every photo has been seen (3,158 on a 217-photo task): small bright or
dark spots, such as lamps, that several photos agree on and the point cloud has no point for. Past step 15,000,
it slows the learning of opacity and colour towards the end. With MRNF, **Max Gaussians** is a hard limit, and the GPU memory for it is reserved at the start; growing also stops short when the
GPU's free memory runs low. Trained to 30,000 steps on a 217-photo task, MRNF reached its 5,000,000 gaussians by
step 4,000.

### Continuing

**Continue From Step** sends the task's model and its steps: the node runs LichtFeld Studio with `--init` on the
model, for the steps between. It loads the model's gaussians in place of the point cloud (thinned at random to
**Max Gaussians** if it has more) and trains them on a schedule that starts again from step 0: the model grows
again, the optimiser starts afresh, the colour's angle detail opens again from one plain colour, and Exposure
Correction is learned again. It reads an OpenSplat model as it is, and trains at that model's SH degree.

### Running Out of GPU Memory

A step that runs out of memory is tried again after the trainer frees what it can, and growing holds back when the
GPU's free memory runs low. A training that still cannot go on fails with "The GPU ran out of memory. Try a smaller image size or fewer
gaussians."

## 4. The Result

The trainer writes the gaussians as a `.ply` (position, colour, opacity, size and rotation of each) in the task's
coordinates, so the model lines up in the task's 3D view; its header says the step it was saved at
(OpenSplat's `Generated by opensplat at iteration 7000`, LichtFeld Studio's `lichtfeld_provenance` with its
`iteration`). SplatMe keeps that file whole in the task's folder
(`data/splatme/splatme-model.ply`, not with the task's downloadable assets), for continuing and editing. For the 3D
view, it cuts a copy to the task's boundary (**Crop to Boundary**) and by the task's [edits](editing.md), and
converts it with WebODM's `splat-tools`, as WebODM's own import of a model does, into
the level-of-detail `.rad` that the 3D view, the download and the share links use.

*As of WebODM 4.0.1 (`app/splats.py`), OpenSplat 1.2.2 at the commit the splat node is built from (`e33f9dd`), and
LichtFeld Studio v0.5.4.3 (`06c9a04`), with the command line the splat node gives it.*
