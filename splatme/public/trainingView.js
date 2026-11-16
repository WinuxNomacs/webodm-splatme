// What SplatMe's Tasks page, its dialogs and the task panel's line show, as plain functions of the plugin's
// answers (api.py): no React here, so Jest tests them as they are.

// The Quality choice: the trainer's steps, and what to expect of each. The times and memory were measured on an
// 8 GB GPU at Image Size 1,600; they hardly depend on the number of photos (upcoming-changes.md, OpenSplat
// presets). Draft is 3,000 steps: up to 2,000 the trainer grows nothing.
export const PRESETS = [
    {key: "draft", label: "Draft", steps: 3000, hint: "A quick look at whether the dataset trains well. Soft detail. Training takes about 2 minutes and 3 GB of GPU memory."},
    {key: "standard", label: "Standard", steps: 7000, hint: "A good model for most datasets, in a fifth of High's time. Training takes about 5 minutes and 5 GB of GPU memory."},
    {key: "fine", label: "Fine", steps: 15000, hint: "Sharper than Standard. Training takes about 10 minutes and 5 GB of GPU memory."},
    {key: "high", label: "High", steps: 30000, hint: "The sharpest model, and the default: OpenSplat's own number of steps. Training takes about 25 minutes and 7 GB of GPU memory."}
];

// Thermal Colours: the palettes a thermal task's temperatures are drawn in (thermal.py's PALETTES), coldest to hottest
export const THERMAL_PALETTES = [
    {key: "gray", label: "Grayscale"}, {key: "gray_r", label: "Black Hot"}, {key: "iron", label: "Iron"},
    {key: "magma", label: "Magma"}, {key: "inferno", label: "Inferno"}, {key: "plasma", label: "Plasma"},
    {key: "viridis", label: "Viridis"}, {key: "cividis", label: "Cividis"}, {key: "jet", label: "Jet"}
];
export const DEFAULT_PALETTE = "gray";

// What a number of steps the trainer handles badly does, from its schedule (densification runs until half the
// steps, from step 500, every 500; a final prune every 3,000 steps after it); "" for any other
export function stepsNote(steps){
    const n = Number(steps);
    if (!Number.isInteger(n) || n < 1) return "";
    if (n <= 2000) return "Up to 2,000 steps the trainer does not grow the model, only refines the starting points. 3,000 steps or more grow it.";
    if (n > 3000 && n < 6000) return "Between 3,001 and 5,999 steps trains worse than 3,000: the trainer prunes the model at step 3,000 and has too few steps left to recover. Choose 3,000, or 6,000 or more.";
    return "";
}

// What the trainer does in each of its steps, from OpenSplat's schedule (opensplat.cpp's defaults, model.cpp's
// optimizerStepCadence and afterTrain, at the node's pinned commit): it grows the model every 500 steps after step
// 500 and before half the steps (at most 15,000); it then refines it, updating it once every 32 photos, until two
// thirds of the steps (at most 20,000), and polishes it, once every 64 photos, to the end
export const STEPS_HINT = "How long the trainer works on the model. It grows the model in the first half of the steps (up to step 15,000), then refines it; steps beyond 30,000 only refine it.";
const GROW_FROM = 500, GROW_EVERY = 500, GROW_UNTIL = 15000, POLISH_FROM = 20000;

// What each stage does: the hover tip of its column's heading
export const STAGE_TIPS = {
    "Warm-up": "The trainer adjusts the position, size, colour and opacity of the starting points from the task's point cloud, without adding any.",
    "Growing": "Every 500 steps, the trainer adds gaussians where the photos show detail the model lacks, and removes useless ones.",
    "Refining": "The model no longer grows; the trainer adjusts it once every 32 photos and removes faint or redundant gaussians every 3,000 steps.",
    "Polishing": "The same as refining, but adjusting once every 64 photos, for the finest and most stable changes."
};

// The steps from+1 to total in the trainer's stages, all four in order: {stages: [{key, label, steps, percent}],
// rounds}, rounds being how many times it grows the model in them, or null for a number that is not a training's.
// from: the steps a continued model already has. Steps before the growing ends in which it grows the model no more
// are a warm-up. The percentages are whole and add up to 100.
export function trainingStages(total, from){
    total = Number(total);
    from = Math.max(0, Number(from) || 0);
    if (!Number.isInteger(total) || total <= from) return null;
    const grownUntil = Math.min(GROW_UNTIL, Math.floor(total / 2));
    const polishFrom = Math.min(POLISH_FROM, Math.floor(total * 2 / 3));
    let rounds = 0;
    for (let step = GROW_EVERY * (Math.floor(Math.max(from, GROW_FROM) / GROW_EVERY) + 1); step < grownUntil; step += GROW_EVERY) rounds++;
    const span = (a, b) => Math.max(0, Math.min(b, total) - Math.max(a, from));  // the steps a+1 to b of this training
    const growing = rounds ? span(GROW_FROM, grownUntil) : 0;
    const stages = [
        {key: "warmup", label: "Warm-up", steps: span(0, grownUntil) - growing},
        {key: "growing", label: "Growing", steps: growing},
        {key: "refining", label: "Refining", steps: span(grownUntil, polishFrom)},
        {key: "polishing", label: "Polishing", steps: span(polishFrom, total)}
    ];
    // Whole percentages: each rounded down, then the largest remainders rounded up until they add up to 100
    const exact = stages.map(s => s.steps * 100 / (total - from));
    const percents = exact.map(Math.floor);
    const order = exact.map((e, i) => [e - percents[i], i]).sort((x, y) => y[0] - x[0]);
    const missing = 100 - percents.reduce((x, y) => x + y, 0);
    for (let k = 0; k < missing; k++) percents[order[k][1]]++;
    return {stages: stages.map((s, i) => ({...s, percent: percents[i]})), rounds};
}

// The stages' table under Steps as text, cell by cell: [{label, value}] with the growing's rounds after its share,
// a dash for each when the number is not a training's
export function stagesCells(total, from){
    const result = trainingStages(total, from);
    const labels = ["Warm-up", "Growing", "Refining", "Polishing"];
    if (!result) return labels.map(label => ({label, value: "–", rounds: label === "Growing" ? "–" : null}));
    return result.stages.map(s => ({label: s.label, value: s.percent + "%",
        rounds: s.key === "growing" ? result.rounds + (result.rounds === 1 ? " round" : " rounds") : null}));
}

// Python's round(): a half to the even neighbour
function roundHalfEven(x){
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}

// A photo's size as the trainer sees it at an Image Size, as WebODM's export makes it (app/splats.py's
// compute_target_size): the longer side brought down to the Image Size, the other in proportion; never enlarged;
// 0 keeps it as it is
export function trainedSize(width, height, imageSize){
    if (imageSize <= 0 || Math.max(width, height) <= imageSize) return [width, height];
    if (width >= height) return [imageSize, Math.max(1, roundHalfEven(height * imageSize / width))];
    return [Math.max(1, roundHalfEven(width * imageSize / height)), imageSize];
}

// A change as a whole percentage with its sign: "−70%", "0%", "+5%"
function change(ratio){
    const percent = Math.round((ratio - 1) * 100);
    return percent < 0 ? "\u2212" + (-percent) + "%" : percent > 0 ? "+" + percent + "%" : "0%";
}

// The Image Size table's rows, one per size of the task's photos ([[width, height]]): {source, trained, side,
// pixels} as text, the changes those of the longer side and of the pixels; a dash for each but the source when
// the Image Size is not a number the training takes
export function imageSizeRows(photoSizes, imageSize){
    const text = String(imageSize == null ? "" : imageSize).trim();
    const value = /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
    const valid = value === 0 || value >= 16;
    return (photoSizes || []).map(([width, height]) => {
        const source = width.toLocaleString("en-US") + " \u00d7 " + height.toLocaleString("en-US");
        if (!valid) return {source, trained: "–", side: "–", pixels: "–"};
        const [w, h] = trainedSize(width, height, value);
        return {source, trained: w.toLocaleString("en-US") + " \u00d7 " + h.toLocaleString("en-US"),
            side: change(Math.max(w, h) / Math.max(width, height)), pixels: change(w * h / (width * height))};
    });
}

// A job's states in order, with the share of the whole bar each takes (measured on 220 photos: the export and the
// training take nearly all of the time)
const STAGES = [
    {state: "starting", label: "Starting", share: 0},
    {state: "drawing", label: "Drawing the thermal photos", share: 0},  // a thermal task's only, and quick
    {state: "exporting", label: "Exporting the photos", share: 25},
    {state: "masking", label: "Finding the sky", share: 5},
    {state: "uploading", label: "Sending to the splat node", share: 5},
    {state: "queued", label: "Waiting in the splat node's queue", share: 0},
    {state: "training", label: "Training", share: 60},
    {state: "importing", label: "Importing the model", share: 5}
];

// WebODM's task status codes (nodeodm/status_codes.py)
export const TASK_QUEUED = 10, TASK_RUNNING = 20, TASK_FAILED = 30, TASK_COMPLETED = 40, TASK_CANCELED = 50;

// Milliseconds between two askings for the Tasks page's list: often while a training runs, now and then while a
// task processes (it may start training when it completes), not at all otherwise (0)
export const FAST = 3000, SLOW = 15000;

export function presetOfSteps(steps){
    const preset = PRESETS.find(p => p.steps === Number(steps));
    return preset ? preset.key : "custom";
}

// The whole job's progress, 0 to 100, from its state and that state's own progress
export function overallProgress(job){
    if (!job || !job.state) return 0;
    if (job.state === "completed") return 100;
    let done = 0;
    for (const stage of STAGES){
        if (stage.state === job.state){
            const within = Math.max(0, Math.min(100, Number(job.progress) || 0));
            return Math.round(done + stage.share * within / 100);
        }
        done += stage.share;
    }
    return 0;
}

// One line saying what the job is doing: the stage, and the job's own detail when it gives one
export function stageText(job){
    const stage = STAGES.find(s => s.state === (job || {}).state);
    if (!stage) return "";
    return job.status ? stage.label + ": " + job.status : stage.label;
}

// What a task's row shows: "hidden", "waiting" (the task is still processing), "progress" or "button"
export function panelMode(status){
    if (!status) return "hidden";
    if (status.active) return "progress";
    if (status.task_status === TASK_QUEUED || status.task_status === TASK_RUNNING) return status.can_train ? "waiting" : "hidden";
    if (status.task_status !== TASK_COMPLETED || !status.can_train) return "hidden";
    return "button";
}

// The dialog's fields as the options of a training request, or {error} naming the field that is wrong.
// ranges: the splat node's {min, max} per option (api.py's check), when it is known
export function optionsFromForm(form, ranges){
    const fields = [
        {name: "steps", label: "Steps", required: true},
        {name: "image_size", label: "Image Size", required: true, zero: true},
        {name: "max_gaussians", label: "Max Gaussians", required: false}
    ];
    const options = {};
    for (const field of fields){
        const text = String(form[field.name] == null ? "" : form[field.name]).trim();
        if (text === ""){
            if (field.required) return {error: field.label + " is needed."};
            continue;
        }
        if (!/^\d+$/.test(text)) return {error: field.label + " is a whole number."};
        const value = parseInt(text, 10);
        const range = field.name === "image_size" ? {min: 16, max: 100000} : (ranges || {})[field.name];
        if (range && !(field.zero && value === 0) && (value < range.min || value > range.max)){
            return {error: field.label + " is between " + range.min + " and " + range.max + (field.zero ? ", or 0." : ".")};
        }
        options[field.name] = value;
    }
    if (form.ignore_sky) options.ignore_sky = true;
    if (form.crop === false) options.crop = false;
    if (form.palette && form.palette !== DEFAULT_PALETTE) options.palette = form.palette;
    return {options};
}

// Continuing a trained model: the More Steps field as a training request, or {error}.
// trained: the steps the model has; ranges: as for optionsFromForm (the node's limit is on the total)
export function continueFromForm(more, trained, ranges){
    const text = String(more == null ? "" : more).trim();
    if (text === "") return {error: "More Steps is needed."};
    if (!/^\d+$/.test(text)) return {error: "More Steps is a whole number."};
    const value = parseInt(text, 10);
    const range = (ranges || {}).steps;
    const max = range ? range.max - trained : Infinity;
    if (max < 1) return {error: "This model has as many steps as the splat node trains. Start over instead."};
    if (value < 1 || value > max) return {error: "More Steps is between 1 and " + max + "."};
    return {options: {resume: true, steps: value}};
}

// What More Steps starts as: as many again, within the node's limit
export function defaultMoreSteps(trained, ranges){
    const range = (ranges || {}).steps;
    return Math.max(1, range ? Math.min(trained, range.max - trained) : trained);
}

// A training's options (api.py) as the fields of the options form
export function formFromOptions(options){
    options = options || {};
    const text = (value, fallback) => String(value == null ? fallback : value);
    return {steps: text(options.steps, 30000), image_size: text(options.image_size, 1600), max_gaussians: text(options.max_gaussians, ""), ignore_sky: !!options.ignore_sky, crop: options.crop !== false, palette: options.palette || DEFAULT_PALETTE};
}

// A task's automatic training in a few words: "On: Standard" or "Off"
export function autoText(auto){
    if (!auto) return "";
    let text = "Off";
    if (auto.enabled){
        const steps = (auto.options || {}).steps;
        const preset = PRESETS.find(p => p.steps === Number(steps));
        text = "On: " + (preset ? preset.label : Number(steps).toLocaleString("en-US") + " steps");
    }
    return text;
}

// "3 min 5 s" for a number of seconds
export function duration(seconds){
    seconds = Math.max(0, Math.round(seconds));
    if (seconds < 60) return seconds + " s";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + " min " + (seconds % 60) + " s";
    return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
}

// A temperature in degrees Celsius as the user reads them: Fahrenheit when WebODM's unit system is imperial
export function temperatureText(celsius, imperial){
    const value = imperial ? celsius * 9 / 5 + 32 : celsius;
    return value.toLocaleString("en-US", {minimumFractionDigits: 1, maximumFractionDigits: 1}) + (imperial ? " °F" : " °C");
}

// A thermal task's colours and the range they span ({palette, low, high}, from the job)
export function thermalText(drawn, imperial){
    if (!drawn) return "";
    const palette = THERMAL_PALETTES.find(p => p.key === drawn.palette);
    return "Thermal Colours: " + (palette ? palette.label : drawn.palette) + ", from " +
        temperatureText(drawn.low, imperial) + " to " + temperatureText(drawn.high, imperial) + ".";
}

// How a finished job is summed up beside the button, or "" when there is nothing to say.
// imperial: temperatures in Fahrenheit (WebODM's unit system)
export function resultText(job, imperial){
    if (!job || !job.state) return "";
    if (job.state === "completed"){
        const took = job.started && job.finished ? " in " + duration(job.finished - job.started) : "";
        const steps = (job.options || {}).steps;
        // sky_masks: in how many photos Ignore Sky found sky; not there when it was off
        const sky = job.sky_masks == null ? "" : job.sky_masks > 0 ?
            " Sky ignored in " + Number(job.sky_masks).toLocaleString("en-US") + (job.sky_masks === 1 ? " photo." : " photos.") :
            " No photo shows the sky.";
        return "Splats trained" + (steps ? " (" + Number(steps).toLocaleString("en-US") + " steps)" : "") + took + "." + sky +
            (job.cropped ? " Cropped to the task's boundary." : "") + (job.thermal ? " " + thermalText(job.thermal, imperial) : "");
    }
    if (job.state === "failed") return "Training failed: " + (job.error || "see the log.");
    // A training SplatMe stopped itself (the task was processed again) says why
    if (job.state === "canceled") return job.error ? "Training canceled: " + job.error : "Training canceled.";
    return "";
}

// WebODM's status of a task, as its Dashboard words it
export function taskStatusText(code){
    return {10: "Queued", 20: "Running", 30: "Failed", 40: "Completed", 50: "Canceled"}[code] || "Waiting for a processing node";
}

// How far WebODM's processing of a running task is, in percent, or null when it is not running
export function runningPercent(task){
    if (!task || task.status !== TASK_RUNNING || task.running_progress == null) return null;
    return Math.max(0, Math.min(100, Math.round(task.running_progress * 100)));
}

// Why a task's row has no Train Splats button, or "" when it has one or is training
export function rowNote(status){
    if (!status || panelMode(status) !== "hidden") return "";
    if (status.task_status === TASK_FAILED) return "The task failed processing: process it again to train its splats.";
    if (status.task_status === TASK_CANCELED) return "The task's processing was canceled: process it again to train its splats.";
    if (!status.can_train) return "Only those who may change this project train its tasks.";
    return "";
}

// When to ask for the Tasks page's list again (FAST, SLOW or 0), from its projects ({tasks: [{status, splats}]})
export function nextRefresh(projects){
    let wait = 0;
    for (const project of projects || []){
        for (const task of project.tasks || []){
            if (task.splats && task.splats.active) return FAST;
            if (task.status == null || task.status === TASK_QUEUED || task.status === TASK_RUNNING) wait = SLOW;
        }
    }
    return wait;
}

// The task panel's line on the Dashboard: "Trained, 7,000 steps", "Training: Step 400 of 7,000", "None"...
export function splatsLine(status){
    if (!status) return "";
    if (status.active) return stageText(status) || "Training";
    const steps = ((status.state === "completed" && status.options) || {}).steps;
    if (status.has_splats) return "Trained" + (steps ? ", " + Number(steps).toLocaleString("en-US") + " steps" : "");
    if (status.state === "failed") return "Training failed";
    if (status.auto && status.auto.enabled && (status.task_status == null || status.task_status === TASK_QUEUED || status.task_status === TASK_RUNNING)){
        return "Trained when the task completes";
    }
    return "None";
}

// How long refreshes go on after a task set to train is seen completing, until its training shows: WebODM's worker
// starts it moments after the task completes
export const SETTLE = 60000;

// Whether a task set to train went from processing to completed between two of its statuses, with no training yet
export function justCompleted(before, after){
    const processing = s => s.task_status == null || s.task_status === TASK_QUEUED || s.task_status === TASK_RUNNING;
    return !!before && !!after && processing(before) && after.task_status === TASK_COMPLETED && !after.active &&
        !!(after.auto && after.auto.enabled);
}

// The Dashboard with the task's panel open, showing only its project (WebODM's project list takes ?id=), wherever
// that project is in the Dashboard's pages
export function dashboardLink(projectId, taskId){
    return "/dashboard/?id=" + encodeURIComponent(projectId) + "&project_task_open=" + encodeURIComponent(projectId) +
        "&project_task_expanded=" + encodeURIComponent(taskId);
}
