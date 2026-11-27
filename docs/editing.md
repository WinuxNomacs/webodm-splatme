# Editing Splats

A trained model often has haze and stray splats around the scene (floaters), or more ground than you want to
show. **Edit** crops it to the part you want, removes what you don't and can adjust its colours. The edits are kept
with the task and cut a copy of the model SplatMe trained, so nothing is lost. A training of the task, later
(**Continue From Step** or a new one), applies them again.

## Opening Edit Splats

On **SplatMe → Tasks**, a task whose splats SplatMe trained has **Edit** beside **View in 3D**, for those who may
change the task's project. It opens **Edit Splats**: the trained model in a 3D view, with the edits' panel to its
right, or below it on a phone. Anyone who may see the task has **Download .ply** there too.

![Edit Splats with a box picked: its handles in the view, its fields under the list](assets/screenshots/editing.png)

The page loads the trained model whole into the browser. A model larger than 400 MB (about 1.7 million splats)
asks first: it may be slow, or fail on a phone or a computer with little memory.

Only splats SplatMe trained can be edited: a task whose splats came from WebODM's own **Splats** dialog, or were
replaced there since their training, has **Edit** only for its textured 3D model, when it has one.

## The Edits

Each shape **Keeps Inside** (removes everything outside it) or **Removes Inside**, chosen in the list; the
**Brush** removes or restores, and **Remove Floaters** only removes. The edits apply in the list's order, so a
restore brings back only what the edits above it removed.

The view hides what the edits remove as you change them, by the same rule **Update the Model** uses, and what lies outside
the task's boundary when the model was trained with **Crop to Boundary**.

- **Add Box** (X): a box over the middle of the model, a third of its width, that **Removes Inside**. Its handles **Move** it, **Size** it and **Turn** it about the
  vertical. The fields under the list set its centre, size and turn exactly, in metres and degrees.
- **Draw Polygon** (P): the view turns to look straight down. Click the corners, then click the first corner, or
  double-click, or press **Finish** (Enter) to close it. Escape or **Cancel** stops. A polygon cuts at every
  height.
- **Lasso** (L): drag around what to remove, in any view (one finger on a phone); letting go closes it, and Escape or
  **Cancel** stops. It takes everything inside it on screen, through to the back, so turn the view first until
  what you want gone is apart from what you keep. **Go to Its View**, beside it in the list, turns the view back
  to where it was drawn.
- **Brush** (B): paint over what to remove (one finger on a phone). Like the Lasso, it takes everything under the
  brush on screen, through to the back. The view holds still while you paint, so the strokes until **Done** (or
  Escape) are one edit in the list ("Brush, 3 strokes"), and **Undo** takes back the last stroke; turn the view
  between sessions. **Size** sets the brush's width on screen, from 5 to 100 pixels; the [ and ] keys change it
  too. **Go to Its View** works as for a lasso.

    **Restore**, in the brush's panel, paints back instead ("Restore Brush" in the list): everything under the
    brush that the edits above it removed comes back, whether a shape, a lasso, the brush or **Remove Floaters**
    took it out. It never brings back what **Crop to Boundary** leaves out. Switching between **Remove** and
    **Restore** starts a new edit in the list.

- **Remove Floaters**: removes the splats far from the rest and the oversized ones (the smears and streaks across
  the sky), judged on the whole trained model. Its strength, in the list, is **Light**, **Medium** (the start) or
  **Strong**; the list says how many splats it removes besides those **Crop to Boundary** already leaves out. A
  task has one.
- **Colour Adjust**: changes the whole model's **Brightness**, **Contrast**, **Saturation** and **Warmth** (more
  red and less blue, or the reverse). Each slider goes from -100 to 100 and starts at 0, no change; pick it in the
  list to show its sliders again. The view leaves out the part of a colour that changes with the viewing angle
  (shine, a sky's tint on a roof), so the applied model can look slightly different.

The tool in use is highlighted; another tool's button (or its key) ends it as Escape would, and its own button
ends it too. The keys work unless you are typing in a field.

Once drawn, a shape is hidden from the view, which shows only what it cuts; pick its edit in the list to show
the shape again, and a box's handles and fields with it. **Delete** (the key) removes the edit picked in the
list. **Undo** (Ctrl+Z) takes back the last change and **Redo** (Ctrl+Shift+Z or Ctrl+Y) brings it back, until
the next change; **Clear Edits** removes them all, and **Undo** brings them back. Undo and Redo last until the
page is left.

## Moving Around

Drag to turn the view, right-drag (or two fingers) to move it, and scroll (or pinch) to zoom. A double-click on
the model makes the splat under the pointer the view's centre, which it then turns about. **Top View** looks
straight down, and **Reset View** goes back to the view the page opened with.

Edits are saved as you make them ("Saved" under the list); leaving the page before then asks first.

The page also takes a picture of the model for its row on **SplatMe → Tasks**, from the view it opens with when
the task's model has the edits, and from the view as it is after **Update the Model**. A training removes the
picture until the page is opened again.

## Measuring

**Measure** has **Distance**, **Height**, **Area** and **Volume**, measured on the model as it is shown (what the
edits remove is passed through). Click the points on the model; the view still turns, moves and zooms between
clicks. A double-click or **Finish** ends a Distance, an Area or a Volume, a Height ends at its second point,
Backspace takes back the last point, and Escape or **Cancel** stops. **M** starts the last kind used (Distance at
first).

- **Distance**: the length along the points, in 3D and seen from above, and the height change from the first to
  the last.
- **Height**: the height between two points (whichever is clicked first), both elevations and the distance between
  them seen from above.
- **Area**: the area on the surface (on the plane of its corners) and seen from above, and the perimeter.
- **Volume**: worked out by WebODM's own volume, as its map's **Volume** does, on the task's surface model (DSM),
  with the base chosen while you click (WebODM's base methods). It needs the DSM, and its corners within it.

Each point moves onto the task's point cloud (the one WebODM's 3D view shows) where the cloud is under the
pointer, within a few pixels and close to the surface clicked. The point cloud is a sharper surface than the splats:
on a task of 217 photos with a short training, half the splats' centres were 8 cm or more from it, against
1.4 cm between the cloud's points.
A point drawn in red could not be moved (no point of the cloud there, as at an edge or over the sky) and is on the
splats only, less precise; the list says how many such points a measurement has. Positions are as accurate as the
task's georeferencing; lengths, heights and areas depend on it much less.

The numbers are in WebODM's units: metric or imperial, as last chosen on WebODM's map. Each measurement in the
list has **Copy** (its numbers as one line of text) and **Delete**; **Clear Measurements** removes them all.
Measurements are not saved: they last until the page is left.

## Updating the Model

**Update the Model** makes the task's model again from its trained model with the edits, as the end of a training does:
cut to the task's boundary first when it was trained with **Crop to Boundary**, then by the edits, then
recoloured by **Colour Adjust**. It takes as long as converting the model. WebODM's 3D view, the download and the
share links then show the edited model. **SplatMe → Tasks** shows it while it runs. Under the button, **Edit
Splats** says whether the task's model has the edits as they are now ("The task's model has these edits", with
how many splats they removed) or not ("The edits changed since the task's model was made"). **Cancel**, beside
the button while it runs, stops it and leaves the task's model as it was.

To make the model whole again, **Clear Edits**, then **Update the Model**.

**Update the Model** is refused while the task's splats train, and a training is refused while edits are applied. Edits
that together remove every splat are not applied, and the model stays as it was. A training whose edits would
remove every splat imports its model without them and says so.

Edits saved by a newer SplatMe (or read by a WebODM not restarted since an upgrade) may not read, and the page
says so. **Update the Model** then fails with that reason, and a training goes on without them; both leave them as
they are. A change on the page replaces them.

## Downloading the Edited Model

WebODM's own download gives the task's model in its `.rad` format, which few other tools open. **Download .ply**,
beside **Update the Model** on **Edit Splats** and on the task's row on **SplatMe → Tasks**, gives it as a `.ply`, the
format the trainer writes and most splat tools open. It is made as **Update the Model** would make it, with the task's
saved edits, so it has them even before they are applied; on **Edit Splats** the button waits until the edits are
saved. The `.ply` is up to about 250 bytes a splat (50 MB for 200,000). Anyone who may see the task may download it.

The model keeps the task's orientation: up is z, as in Blender, and north is y. Its z is the height above sea
level, so the model sits that high above the origin; x and y are close to it.

## The 3D View's Start View

WebODM's own 3D view keeps a start view for each task: turn the view as you want it, then press **set initial
camera view** under **Scene** in its sidebar. The task's 3D view and its share links then open there, with the
splats as with the point cloud.
