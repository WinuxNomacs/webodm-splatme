// What SplatMe's Tasks page, its dialogs and the task panel's line show, as plain functions of the plugin's
// answers (api.py): no React here, so Jest tests them as they are.

// The Quality choice: the trainer's steps, and what to expect of each
export const PRESETS = [
    {key: "draft", label: "Draft", steps: 2000, hint: "A quick look at whether the dataset trains well. Soft detail."},
    {key: "standard", label: "Standard", steps: 7000, hint: "A good model for most datasets. The place to start."},
    {key: "high", label: "High", steps: 30000, hint: "The sharpest model. Takes several times longer than Standard."}
];

// A job's states in order, with the share of the whole bar each takes (measured on 220 photos: the export and the
// training take nearly all of the time)
const STAGES = [
    {state: "starting", label: "Starting", share: 0},
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
    return {steps: text(options.steps, 7000), image_size: text(options.image_size, 1600), max_gaussians: text(options.max_gaussians, ""), ignore_sky: !!options.ignore_sky, crop: options.crop !== false};
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

// How a finished job is summed up beside the button, or "" when there is nothing to say
export function resultText(job){
    if (!job || !job.state) return "";
    if (job.state === "completed"){
        const took = job.started && job.finished ? " in " + duration(job.finished - job.started) : "";
        const steps = (job.options || {}).steps;
        // sky_masks: in how many photos Ignore Sky found sky; not there when it was off
        const sky = job.sky_masks == null ? "" : job.sky_masks > 0 ?
            " Sky ignored in " + Number(job.sky_masks).toLocaleString("en-US") + (job.sky_masks === 1 ? " photo." : " photos.") :
            " No photo shows the sky.";
        return "Splats trained" + (steps ? " (" + Number(steps).toLocaleString("en-US") + " steps)" : "") + took + "." + sky +
            (job.cropped ? " Cropped to the task's boundary." : "");
    }
    if (job.state === "failed") return "Training failed: " + (job.error || "see the log.");
    if (job.state === "canceled") return "Training canceled.";
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
