# The Plugin's API

Under `/api/plugins/splatme/`, with a WebODM login. A POST also needs the session's CSRF token (`X-CSRFToken`), as
WebODM routes a plugin's API through a plain Django view.

| Request | Does |
|---|---|
| `GET node` | The node's state or that it is not available, and its `url`; for administrators also what is wrong and `token_set`. The token is never sent back |
| `POST node` (`url`, `token`, `save`) | Administrators: sets the address and token; with `save` false only tries them |
| `GET task/<id>/check` | Before training: why the task or the node cannot train, warnings, the options' ranges, `boundary` (whether the task was processed with one), `thermal` (whether its photos are DJI Thermal Analyzer's TIFFs), `photo_sizes` (the photos' `[width, height]`, one per camera, empty before processing) and `trained_steps`: the steps of the model a training can continue from |
| `POST task/<id>/train` | Trains a completed task's splats. Options: `steps` (30000), `image_size` (1600, the photos' longer side in pixels, larger photos scaled down whole; 0 keeps them as they are), `max_gaussians`, `sh_degree`, `ignore_sky` (true leaves the sky out; not for a thermal task), `crop` (false keeps the splats outside the task's boundary), `palette` (a thermal task's colours: `gray`, the default, `gray_r`, `iron`, `magma`, `inferno`, `plasma`, `viridis`, `cividis`, `jet`). With `resume` true it continues the task's trained model: `steps` is then how many more, and the other options are the ones that model was trained with |
| `GET task/<id>/status` | The job's `state`, `progress`, `status`, `error`, `sky_masks` (in how many photos sky was found, with `ignore_sky`), `cropped` (the gaussians left out for being outside the boundary), `thermal` (a thermal task's `palette` and the range it spans, `low` and `high`, in degrees Celsius), `time_left` (while training, the seconds the steps left should take, once known), whether the task has a splat model and whether the user may train it; for a task set to train, `listening` (whether WebODM's worker tells the plugin of completed tasks). With `?listed=1` also `listed`, whether SplatMe → Tasks lists the task, and `unlisted`, why not |
| `POST task/<id>/cancel` | Stops the job |
| `GET task/<id>/log?offset=<bytes>` | The trainer's output from that byte on; the offset to ask from next is in the `X-Log-Offset` header |
| `GET task/<id>/auto` | Whether the task is trained when it completes, with which options |
| `POST task/<id>/auto` | Sets that for the task: `enabled` and the options of `train` |
| `GET automation` | The options SplatMe's panel starts with for the user's new task: their own (`own` true) or the administrators' defaults, and `listening`, whether WebODM's worker tells the plugin of completed tasks. With `?ranges=1` also the node's range of each option |
| `POST automation` (options) | Saves the user's own options; with `reset` true drops them |
| `GET automation/shared`, `POST automation/shared` (options) | The administrators' defaults, for users who saved none of their own; superusers set them |
| `GET revive` | Takes over the trainings that lost their worker (WebODM's pages ask it); answers 204 |
| `GET tasks` | The tasks SplatMe can train in the projects the user may see (`?project=<id>` for one), by project (a project with none is left out), each with WebODM's `status`, `running_progress` and `last_error`, and its `splats` as `task/<id>/status` gives them; and `addable`, the projects the user may add a task to: SplatMe's Tasks page, in one request |
