# Editing the 3D Model

WebODM's textured 3D model often has small holes where no photo saw the surface, loose bits floating around the
scene, bumpy roofs and walls, and things you would rather not show (a parked car, a person). **Edit** cleans it up:
it removes pieces, fills holes, flattens surfaces and removes objects, filling the hole each leaves. The edits are
kept with the task, and the model's original files are kept too, so nothing is lost.

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

The **Brush**'s panel has the same choices as buttons: **Remove**, **Restore** (paints back what the edits above
it removed), **Flatten**, **Fill Holes** and **Remove Object**. Each switch starts a new edit in the list.

Two tools act on the whole model, once each:

- **Remove Floating Pieces**: removes the pieces of surface apart from the rest, smaller than **Small** (100
  triangles), **Medium** (1,000, the start) or **Large** (10,000). The largest piece is never removed. The list
  says how many triangles it takes.
- **Fill Holes**: fills every hole up to **Small** (10 edges around, the start), **Medium** (50) or **Large** (200).
  The list says how many it fills.

The edits apply in the list's order: a fill closes its hole for the edits below it, and a restore brings back
only what the edits above it removed. The model's outer edge is never filled, nor a hole of more than 5,000 edges.

A filled hole is coloured from the model's texture around its edge, blended across it. It has the right colours
but no detail, which suits small holes and plain ground better than a large hole in a patterned surface. Where a
removed object's hole joins older holes beside it, the fill spans them all and can cover some of the ground
around them: draw the shape again, smaller.

The line under the view says how many triangles the model has, and how many the edits remove, flatten and fill. The
view shows the edits as they change, by the same rule **Update the Model** uses. **Undo**, **Redo**, **Clear
Edits**, the keys, moving around (a double-click centres the view on the surface under the pointer) and saving
work as on [Editing Splats](editing.md#moving-around).

## Updating the Model

**Update the Model** makes the task's textured model again with the edits: the GLB that WebODM's 3D view and the
share links show, and the OBJ with its MTL that the **Textured Model** download gives. It takes seconds (about 7
for an 850,000-triangle model). Under the button, the editor says whether the task's model has the edits as they
are now. **Cancel**, beside the button while it runs, stops it and leaves the model as it was.

The first update keeps the model's original files in the task's `data/splatme/model` folder, and every update
starts from them, so edits never pile up. To make the model whole again, **Clear Edits**, then **Update the
Model**. The fills' texture is one more image beside the model's
(`odm_textured_model_geo_splatme_fill_map_Kd.png`), named in the MTL; an update with no fill removes it.

A task processed again gets a new model from WebODM. Its edits stay in the list: press **Update the Model** to
apply them to the new one.
