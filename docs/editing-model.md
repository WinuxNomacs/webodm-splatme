# Editing the 3D Model

WebODM's textured 3D model often has small holes where no photo saw the surface, loose bits floating around the
scene, bumpy roofs and walls, crooked gutters, broken shingles, parts sitting too low, and things you would rather
not show (a parked car, a person). **Edit** repairs it: it removes pieces, fills holes, flattens, smooths,
straightens and moves surfaces, removes objects, and copies the texture of a good area over a bad one. Most
repairs are adjusted a step at a time. The edits are kept with the task, and the model's original files are kept
too, so nothing is lost.

## Opening the Editor

On **SplatMe → Tasks**, **Edit** on a task's row opens the editor for those who may change the task's project.
Above the view, **Splats** and **3D Model** switch between the task's splats ([Editing Splats](editing.md)) and
its textured model; a task with only a textured model opens on **3D Model**. The view shows the model as
WebODM's 3D view does, with the edits' panel to its right, or below it on a phone.

![The 3D model's editor: Fill Holes, and a polygon set to Remove Object over a round flower bed on the lawn, filled in its place](assets/screenshots/editing-model.png)

A task can be edited once WebODM has made its textured model (its GLB, OBJ and MTL files).

## The Edits

The tools are those of Editing Splats: **Add Box** (X), **Draw Polygon** (P), **Lasso** (L) and **Brush** (B),
drawn the same way (see [The Edits](editing.md#the-edits) there). A shape acts on the triangles whose centres it
covers. What it does is chosen in the list:

- **Remove Inside** (the start) and **Keep Inside**: remove the triangles inside it, or all the others.
- **Flatten Inside**: makes what it covers flat. The triangles' corners move onto the plane that best fits the
  edge between them and the rest of the model, which stays where it is: a bumpy roof face, a wavy wall, uneven
  ground. Draw the shape over one flat surface at a time: a shape over a roof's ridge flattens both sides into one
  plane.
- **Fill Holes Inside**: fills the holes whose whole edge it covers.
- **Remove Object**: removes what it covers, then fills the hole that leaves, so the ground under a car or a
  person closes over. Draw it close around the object: the fill spans the hole's whole edge.
- **Move Inside**: raises, shifts or stretches what it covers: a roof that sits too low, an eave that should sit
  above the wall below it. The move fades to nothing over a **Soft Edge** around it, so the surface stretches
  instead of tearing.
- **Smooth Inside**: evens out what it covers, its edge fixed: lumpy walls, bent or broken shingles. More
  **Passes**, smoother.
- **Straighten Inside**: pulls what it covers toward a straight line: a gutter, an eave, a ridge, a window
  frame. Choosing it asks for the line: click one end on the model, and a line follows the pointer from it; click
  the other end. While the line is placed, the view leaves this edit out, so what it hid can be clicked. Either
  end can then be dragged on the model, or **Draw the Line Again**. The pull is strongest at the line and fades to
  nothing at **Reach** from it.
- **Clone Texture Inside**: covers what it covers with the texture of a good area: shingles over broken
  shingles, siding over a smear, lawn over a bare patch. It suits a large area; for a patch here and there, the
  **Clone Texture** stamp (below) is quicker. Choosing it asks for one click on the middle of the good
  area. A square of it, **Source Size** across (shown in the view while the edit is picked), is laid flat and
  repeated across the shape's surface, with its rows kept level (north up on level ground); **Turn Texture**
  turns it, and **Feather** blends it into the surface's own texture near the shape's edge. It changes only the
  texture, after all the other edits.

The **Repair** buttons under the tools start the repairs without drawing first: **Flatten**, **Smooth**, **Move**
and **Remove Object** each add a box doing that in the middle of the view, to move and size like any box.
**Straighten** asks for the line first and puts a box around it, as wide as **Reach** each side. To repair inside a polygon or a lasso instead, draw it
and choose the repair in its list; the **Brush** has its own buttons (below).

**Clone Texture** is a stamp. Click the middle of a good area on the model; the pointer then becomes a square showing
its texture, laid on the surface under the pointer, with a tick toward the texture's top. A click drops that
texture there, its middle where the square's is, blended in over a narrow edge, and fills the holes whose whole edge
the square covers with it, in line with the texture around them (fills made earlier inside the square take it too). The wheel turns the square
15 degrees a notch, Ctrl+wheel or **[** and **]** make it 25 cm larger or smaller (or **Size** and **Turn** in the
panel), and Shift+wheel zooms; dragging still turns the view and right-dragging moves it. Each stamp keeps the size
and turn it was dropped with, and a later stamp covers an earlier one. **Done** or Esc stops stamping. The stamps
are one edit in the list, **Clone Stamps**, each one Undo; picked, it shows their squares, its **Feather** (how wide
the blend at each stamp's edge is) and **Add Stamps** to stamp more of the same texture. **Pick the Source Again**,
while stamping, starts a new one from another area.

The picked edit's settings show under the list, each with **-** and **+** to change it a step at a time, and each
step is one **Undo**: Move Inside's **Up**, **East** and **North** (5 cm a step), **Stretch East**, **Stretch North** and
**Stretch Up** (5%) and **Soft Edge** (0.25 m); Smooth Inside's **Passes**; Straighten Inside's **Strength** (10%)
and **Reach** (5 cm); Clone Texture Inside's **Source Size** (0.25 m), **Feather** (5 cm) and **Turn Texture**
(15 degrees). The view shows each step as it is made.

The **Brush**'s panel has buttons for **Remove**, **Restore** (paints back what the edits above it removed),
**Smooth**, **Flatten**, **Fill Holes** and **Remove Object**. Each switch starts a new edit in the list.

Two tools act on the whole model, once each:

- **Remove Floating Pieces**: removes the pieces of surface apart from the rest, smaller than **Small** (100
  triangles), **Medium** (1,000, the start) or **Large** (10,000). The largest piece is never removed. The list
  says how many triangles it takes.
- **Fill Holes**: fills every hole up to **Small** (10 edges around, the start), **Medium** (50) or **Large** (200).
  The list says how many it fills.

The edits apply in the list's order: a fill closes its hole for the edits below it, and a restore brings back
only what the edits above it removed. The model's outer edge is never filled, nor a hole of more than 5,000 edges.

A filled hole 20 cm or more across takes the texture of the surface beside it, repeated across it and blended into
the colours at its edge, so a removed object leaves lawn, gravel or roof in its place. A smaller hole is coloured
from its edge, blended across it. Where a removed object's hole joins older holes beside it, the fill spans them
all and can cover some of the ground around them: draw the shape again, smaller. **Clone Texture Inside** over a
fill replaces its texture with one you choose.

The line under the view says how many triangles the model has, how many the edits remove and retexture, how many
points they move and how many holes they fill. The
view shows the edits as they change, by the same rule **Update the Model** uses; while it works them out, the line
says **Showing the edits…** and the view can still be turned. The first time, a model with many filled holes can take
several seconds; after that, a change works out again only from the edit changed. **Undo**, **Redo**, **Clear
Edits**, the keys, moving around (a double-click centres the view on the surface under the pointer) and saving
work as on [Editing Splats](editing.md#moving-around).

## Updating the Model

**Update the Model** makes the task's textured model again with the edits: the GLB that WebODM's 3D view and the
share links show, and the OBJ with its MTL that the **Textured Model** download gives. It takes seconds (about 7
to 10 for an 850,000-triangle model). Under the button, the editor says whether the task's model has the edits as they
are now. **Cancel**, beside the button while it runs, stops it and leaves the model as it was.

The first update keeps the model's original files in the task's `data/splatme/model` folder, and every update
starts from them, so edits never pile up. To make the model whole again, **Clear Edits**, then **Update the
Model**. The textures the edits make are more images beside the model's, named in the MTL:
`odm_textured_model_geo_splatme_clone_map_Kd.png` (Clone Texture and the wider fills) and
`odm_textured_model_geo_splatme_fill_map_Kd.png` (the smaller fills); an update that needs neither removes it.

A task processed again gets a new model from WebODM. Its edits stay in the list: press **Update the Model** to
apply them to the new one.
