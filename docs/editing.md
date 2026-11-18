# Editing Splats

A trained model often has haze and stray splats around the scene (floaters), or more ground than you want to
show. **Edit** crops it to the part you want, removes what you don't and can adjust its colours. The edits are shapes kept with the task:
they cut the model SplatMe trained, so nothing is lost. A training of the task, later (**Continue From Step** or
a new one), applies them again.

## Opening the Editor

On **SplatMe → Tasks**, a task whose splats SplatMe trained has **Edit** beside **View in 3D**. It opens **Edit
Splats**: the trained model in a 3D view, with the edits' panel to its right, or below it on a phone. Only those
who may change the task's project can edit it. Others see the edits but cannot change them.

The page loads the trained model whole into the browser, which takes about a second for a model of 200,000
splats. A model larger than 400 MB (about 1.7 million splats) asks first: it may be slow, or fail on a phone or a
computer with little memory.

There is no **Edit** for a task whose model came from WebODM's own **Splats** dialog, or whose model was
replaced there since its training: only a model SplatMe trained can be edited.

## The Edits

Each shape **Keeps Inside** (removes everything outside it) or **Removes Inside**; the **Brush** and **Remove
Floaters** only remove. A splat stays only when every
edit keeps it. The view hides what the edits remove as you change them, by the same rule **Apply** uses. It also
hides what lies outside the task's boundary when the model was trained with **Crop to Boundary**, as the task's
model leaves it out. The view holds splat positions a little less precisely than the trained model, so a few
splats right on an edge may end up on the other side when applied.

- **Add Box**: a box over the middle of the model. Its handles move it, size it (**Size**) and turn it about the
  vertical (**Turn**). The fields under the list set its centre, size and turn exactly, in metres and degrees.
- **Draw Polygon**: the view turns to look straight down. Click the corners, then click the first corner, or
  double-click, or press **Finish** (Enter) to close it. Escape or **Cancel** stops. A polygon cuts at every
  height.
- **Lasso**: drag around what to remove, in any view (one finger on a phone); letting go closes it. It removes
  everything inside it on screen, through to the back, so turn the view first until what you want gone is apart
  from what you keep. **Go to Its View**, beside it in the list, turns the view back to where it was drawn.
- **Brush**: paint over what to remove (one finger on a phone). Like the Lasso, it removes everything under the
  brush on screen, through to the back. The view holds still while you paint, so every stroke until **Done** (or
  Escape) is one edit in the list ("Brush, 3 strokes"), and **Undo** takes back the last stroke; turn the view
  between sessions. **Size** sets the brush's width on screen, from 5 to 100 pixels; the [ and ] keys change it
  too. **Go to Its View** works as for a lasso.
- **Remove Floaters**: removes the splats far from the rest and the oversized ones (the smears and streaks across
  the sky), judged on the whole trained model, so the other edits don't change which ones they are. Its strength,
  in the list, is **Light**, **Medium** (the start) or **Strong**; the list says how many splats it removes besides
  those **Crop to Boundary** already leaves out. A task has one.
- **Colour Adjust**: changes the whole model's **Brightness**, **Contrast**, **Saturation** and **Warmth** (more
  red and less blue, or the reverse). Each slider goes from -100 to 100 and starts at 0, no change; pick it in the
  list to show its sliders again, and **Undo** takes back one slider's move. The view shows the change as you
  move them. The part of a splat's colour that changes with the viewing angle (shine, a sky's tint on a roof)
  changes only when applied, so the applied model can look slightly different from the view. A task has one.

Once drawn, a shape is hidden from the view, which shows only what it cuts; pick its edit in the list to show
the shape again, and a box's handles and fields with it. **Undo** takes back the last change, and **Clear
Edits** removes them all. **Top View** and **Side View** frame the model again.

Edits are saved as you make them ("Saved" under the list); leaving the page before then asks first.

## Applying Them

**Apply** makes the task's model again from its trained model with the edits, as the end of a training does:
cut to the task's boundary first when it was trained with **Crop to Boundary**, then by the edits, then
recoloured by **Colour Adjust**. It takes about
as long as the end of a training (the conversion of the model). WebODM's 3D view, the download and the share links
then show the edited model. **SplatMe → Tasks** shows the Apply while it runs.

To make the model whole again, **Clear Edits**, then **Apply**.

Edits saved by a newer SplatMe (or read by a WebODM not restarted since an upgrade) may not read: the page says
so, **Apply** and trainings leave them as they are and go on without them, and a change on the page replaces
them.

**Apply** is refused while the task's splats train, and a training is refused while edits are applied. Edits
that together remove every splat are not applied, and the model stays as it was. A training whose edits would
remove every splat imports its model without them and says so.
