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
export const STEPS_HINT = "How long the trainer works on the model. It grows the model in the first half of the steps, up to step 15,000 unless Grow Until says otherwise, then refines it.";
export const GROW_UNTIL_HINT = "The step the model stops growing at: until then the trainer adds gaussians where the photos show detail the model lacks. Later can give large scenes more detail, for more GPU memory and time. From 1,000 to 3,000 less than Steps.";
const GROW_FROM = 500, GROW_EVERY = 500, GROW_UNTIL = 15000, POLISH_FROM = 20000;
// Grow Until's limits (the splat node's): the growing goes on for 1,000 steps at least (on Continue, after the
// model's), and the training for 3,000 after it
export const GROW_AT_LEAST = 1000, AFTER_GROWING = 3000;

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
// are a warm-up. growUntil: Grow Until, when set (else the trainer's own: half the steps, at most 15,000); growing
// past where polishing would start leaves no refining. The percentages are whole and add up to 100.
export function trainingStages(total, from, growUntil){
    total = Number(total);
    from = Math.max(0, Number(from) || 0);
    if (!Number.isInteger(total) || total <= from) return null;
    const set = Number(String(growUntil == null ? "" : growUntil).trim() || NaN);
    const grownUntil = Number.isInteger(set) && set > 0 ? set : Math.min(GROW_UNTIL, Math.floor(total / 2));
    const polishFrom = Math.max(grownUntil, Math.min(POLISH_FROM, Math.floor(total * 2 / 3)));
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

// Whether the steps from+1 to total grow the model: a continued training's stages table is shown only then (its
// warm-up and growing at 0% read as a mistake otherwise)
export function stepsGrow(total, from, growUntil){
    const result = trainingStages(total, from, growUntil);
    return !!result && result.rounds > 0;
}

// The stages' table under Steps as text, cell by cell: [{label, value}] with the growing's rounds after its share,
// a dash for each when the number is not a training's
export function stagesCells(total, from, growUntil){
    const result = trainingStages(total, from, growUntil);
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
// the Image Size is not a number the training takes (blank is full size)
export function imageSizeRows(photoSizes, imageSize){
    const text = String(imageSize == null ? "" : imageSize).trim();
    const value = text === "" ? 0 : /^\d+$/.test(text) ? parseInt(text, 10) : NaN;  // blank: full size
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
export function optionsFromForm(form, ranges, node){
    const fields = [
        {name: "steps", label: "Steps", required: true},
        {name: "image_size", label: "Image Size", required: false, zero: true, blank: 0},  // blank: full size
        {name: "max_gaussians", label: "Max Gaussians", required: false, optional: true},
        {name: "sh_degree", label: "SH Degree", required: false, optional: true},
        {name: "densify_until", label: "Grow Until", required: false, optional: true, range: {min: GROW_AT_LEAST, max: 200000}}
    ];
    const view = trainerView(node);
    const options = {};
    for (const field of fields){
        if (field.optional && !view.has(field.name)) continue;  // hidden: the node's trainer has no such option
        const text = String(form[field.name] == null ? "" : form[field.name]).trim();
        if (text === ""){
            if (field.required) return {error: field.label + " is needed."};
            if (field.blank !== undefined) options[field.name] = field.blank;
            continue;
        }
        if (!/^\d+$/.test(text)) return {error: field.label + " is a whole number."};
        const value = parseInt(text, 10);
        const range = field.name === "image_size" ? {min: 16, max: 100000} : (ranges || {})[field.name] || field.range;
        if (range && !(field.zero && value === 0) && (value < range.min || value > range.max)){
            return {error: field.label + " is between " + range.min + " and " + range.max + (field.zero ? ", or blank for full size." : ".")};
        }
        options[field.name] = value;
    }
    if (options.densify_until != null && options.densify_until > options.steps - AFTER_GROWING){
        if (options.steps < GROW_AT_LEAST + AFTER_GROWING) return {error: "Grow Until needs Steps of " + (GROW_AT_LEAST + AFTER_GROWING) + " or more."};
        return {error: "Grow Until is at most " + (options.steps - AFTER_GROWING) + ": " + AFTER_GROWING + " less than Steps."};
    }
    if (view.has("strategy") && form.strategy){
        const choices = strategyChoices(ranges);
        if (choices.indexOf(form.strategy) < 0) return {error: "Strategy is one of " + choices.map(strategyLabel).join(", ") + "."};
        options.strategy = form.strategy;
    }
    // Sent only when it is not the strategy's own default (LichtFeld Studio: on for MRNF only)
    const exposure = exposureChecked(form);
    if (view.has("exposure_correction") && exposure !== exposureDefault(form.strategy)) options.exposure_correction = exposure;
    if (form.ignore_sky && view.masks) options.ignore_sky = true;
    if (form.crop === false) options.crop = false;
    if (form.palette && form.palette !== DEFAULT_PALETTE) options.palette = form.palette;
    return {options};
}

// The help of the trainer options OpenSplat's schedule does not describe (options.html has the same words)
export const SH_DEGREE_HINT = "How much a gaussian's colour may change with the direction it is seen from: 0 the same from every side, 3 the most (shine, reflections), for a larger model and more GPU memory.";
export const STRATEGY_HINT = "How the trainer adds, moves and removes gaussians. MCMC keeps the model within Max Gaussians, moving them to where the photos need detail.";
export const EXPOSURE_HINT = "The trainer learns each photo's brightness and colour apart from the model, so light that changed between photos does not end up in it. The 3D view shows the model without them: it can look a little brighter than the photos' edges. On by default with MRNF, off with MCMC and IGS+, as in LichtFeld Studio.";

// Exposure Correction's default, LichtFeld Studio's own: on for MRNF (its default strategy), off for MCMC and IGS+
export function exposureDefault(strategy){
    return !strategy || strategy === "mrnf";
}

// Whether the form's Exposure Correction is ticked: what the user chose, or the strategy's default (null)
export function exposureChecked(form){
    return typeof form.exposure_correction === "boolean" ? form.exposure_correction : exposureDefault(form.strategy);
}

// LichtFeld Studio's strategies (how it adds, moves and removes gaussians), as the forms name them
export const STRATEGY_LABELS = {mrnf: "MRNF", mcmc: "MCMC", "igs+": "IGS+"};
export const strategyLabel = key => STRATEGY_LABELS[key] || key;

// The strategies the node offers (ranges: as for optionsFromForm), or those SplatMe knows when it did not answer
export function strategyChoices(ranges){
    const range = (ranges || {}).strategy;
    return range && Array.isArray(range.choices) ? range.choices : Object.keys(STRATEGY_LABELS);
}

// The trainers a splat node may run (its trainer_kind), as the pages name them
export const TRAINER_LABELS = {opensplat: "OpenSplat", lichtfeld: "LichtFeld Studio"};
const trainerLabel = kind => TRAINER_LABELS[kind] || kind;

// What the options forms show for the splat node's trainer. node: the "node" of task/<id>/check or automation
// ({trainer_kind, supports, ranges}), or null when the node did not answer (everything shows; the server checks).
// opensplat: OpenSplat's schedule is described (the presets' times, the stage table, the steps notes); has(name): the
// node has that option; masks: Ignore Sky; continues: a model can be continued.
export function trainerView(node){
    const n = node || {};
    const supports = n.supports || {};
    return {
        kind: n.trainer_kind || "opensplat",
        opensplat: !n.trainer_kind || n.trainer_kind === "opensplat",
        masks: supports.masks !== false,
        continues: supports.continue !== false,
        has: name => !n.ranges || Object.prototype.hasOwnProperty.call(n.ranges, name)
    };
}

// Whether the task's model can be continued (check: task/<id>/check's answer): {can, note}, note saying why not when
// it has a model the node cannot continue (made by another trainer, or a trainer that does not continue models)
export function continueState(check){
    const c = check || {};
    if (!c.trained_steps) return {can: false, note: ""};
    if (!c.node) return {can: true, note: ""};  // the node did not answer: the dialog says so, and nothing starts
    const view = trainerView(c.node);
    const made = c.trained_kind || "opensplat";
    if (made !== view.kind){
        return {can: false, note: "This task's model was trained with " + trainerLabel(made) + ", and the splat node trains with " + trainerLabel(view.kind) + ": the training starts over."};
    }
    if (!view.continues) return {can: false, note: trainerLabel(view.kind) + " cannot continue a model: the training starts over."};
    return {can: true, note: ""};
}

// Continuing a trained model: the More Steps and Grow Until fields as a training request, or {error}.
// trained: the steps the model has; ranges: as for optionsFromForm (the node's limit is on the total); a blank
// Grow Until keeps the model's
export function continueFromForm(more, trained, ranges, growUntil){
    const text = String(more == null ? "" : more).trim();
    if (text === "") return {error: "More Steps is needed."};
    if (!/^\d+$/.test(text)) return {error: "More Steps is a whole number."};
    const value = parseInt(text, 10);
    const range = (ranges || {}).steps;
    const max = range ? range.max - trained : Infinity;
    if (max < 1) return {error: "This model has as many steps as the splat node trains. Start over instead."};
    if (value < 1 || value > max) return {error: "More Steps is between 1 and " + max + "."};
    const options = {resume: true, steps: value};
    const grow = String(growUntil == null ? "" : growUntil).trim();
    if (grow !== ""){
        const range = growUntilRange(trained, value);
        if (!range) return {error: "Grow Until needs More Steps of " + (GROW_AT_LEAST + AFTER_GROWING) + " or more."};
        if (!/^\d+$/.test(grow)) return {error: "Grow Until is a whole number."};
        const step = parseInt(grow, 10);
        if (step < range.min || step > range.max) return {error: "Grow Until is between " + range.min + " and " + range.max + "."};
        options.densify_until = step;
    }
    return {options};
}

// The steps Grow Until may be when continuing a model of trained steps by more: {min, max}, or null when none
export function growUntilRange(trained, more){
    const min = trained + GROW_AT_LEAST, max = trained + more - AFTER_GROWING;
    return max >= min ? {min, max} : null;
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
    // Image Size 0 (the photos as they are) shows as blank, with the placeholder "Full size"
    return {steps: text(options.steps, 30000), image_size: options.image_size === 0 ? "" : text(options.image_size, 1600), max_gaussians: text(options.max_gaussians, ""), sh_degree: text(options.sh_degree, ""), densify_until: text(options.densify_until, ""), strategy: options.strategy || "", exposure_correction: typeof options.exposure_correction === "boolean" && options.exposure_correction !== exposureDefault(options.strategy) ? options.exposure_correction : null, ignore_sky: !!options.ignore_sky, crop: options.crop !== false, palette: options.palette || DEFAULT_PALETTE};
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

// The options a training left out, as the splat node's trainer does not have them (saved for another trainer)
function skippedText(job){
    const skipped = job.skipped || [];
    return skipped.length ? " Left out, as the splat node's trainer does not have " + (skipped.length === 1 ? "it" : "them") + ": " + skipped.join(", ") + "." : "";
}

// How a finished job is summed up beside the button, or "" when there is nothing to say.
// imperial: temperatures in Fahrenheit (WebODM's unit system)
export function resultText(job, imperial){
    if (!job || !job.state) return "";
    if (job.state === "completed"){
        const steps = (job.options || {}).steps;
        const stepsText = steps ? " (" + Number(steps).toLocaleString("en-US") + " steps)" : "";
        // sky_masks: in how many photos Ignore Sky found sky; not there when it was off
        const sky = job.sky_masks == null ? "" : job.sky_masks > 0 ?
            " Sky ignored in " + Number(job.sky_masks).toLocaleString("en-US") + (job.sky_masks === 1 ? " photo." : " photos.") :
            " No photo shows the sky.";
        const rest = (job.cropped ? " Cropped to the task's boundary." : "") + (job.thermal ? " " + thermalText(job.thermal, imperial) : "") + skippedText(job);
        const times = job.times;
        if (!times || times.training == null){
            // A record of SplatMe 0.3 or before: from the request to the end
            const took = job.started && job.finished ? " in " + duration(job.finished - job.started) : "";
            return "Splats trained" + stepsText + took + "." + sky + rest;
        }
        const day = job.finished ? " on " + new Date(job.finished * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"}) : "";
        let training = duration(times.training) + " of training";
        if (job.resume && steps > job.resume){
            const last = " for the last " + Number(steps - job.resume).toLocaleString("en-US");
            training = typeof job.earlier_training === "number" ?
                duration(job.earlier_training + times.training) + " of training, " + duration(times.training) + " of it" + last :
                training + last;
        }
        const masking = times.masking || 0;
        const other = Object.keys(times).reduce((sum, stage) => stage === "training" || stage === "masking" ? sum : sum + times[stage], 0);
        return "Splats trained" + stepsText + day + ": " + training + "." + sky +
            (masking >= 1 ? " Finding the sky took " + duration(masking) + "." : "") +
            (other >= 1 ? " Preparing, transfers and waiting took " + duration(other) + "." : "") + rest;
    }
    if (job.state === "failed") return "Training failed: " + (job.error || "see the log.") + skippedText(job);
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
            if (task.splats && (task.splats.active || (task.splats.apply && task.splats.apply.state === "applying"))) return FAST;
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
