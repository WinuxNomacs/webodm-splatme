// What the Train Splats button, its dialog and the progress show, as plain functions of the plugin's answers
// (api.py): no React here, so Jest tests them as they are.

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
    {state: "exporting", label: "Exporting the photos", share: 30},
    {state: "uploading", label: "Sending to the splat node", share: 5},
    {state: "queued", label: "Waiting in the splat node's queue", share: 0},
    {state: "training", label: "Training", share: 60},
    {state: "importing", label: "Importing the model", share: 5}
];

// WebODM's task status codes (nodeodm/status_codes.py)
export const TASK_QUEUED = 10, TASK_RUNNING = 20, TASK_COMPLETED = 40;

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

// What the panel shows for a task: "hidden", "waiting" (the task is still processing), "progress" or "button"
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
    return {options};
}

// A training's options (api.py) as the fields of the options form
export function formFromOptions(options){
    options = options || {};
    const text = (value, fallback) => String(value == null ? fallback : value);
    return {steps: text(options.steps, 7000), image_size: text(options.image_size, 1600), max_gaussians: text(options.max_gaussians, "")};
}

// A task's automatic training in a few words: "On: Standard" or "Off", and whether that is the default
export function autoText(auto){
    if (!auto) return "";
    let text = "Off";
    if (auto.enabled){
        const steps = (auto.options || {}).steps;
        const preset = PRESETS.find(p => p.steps === Number(steps));
        text = "On: " + (preset ? preset.label : Number(steps).toLocaleString("en-US") + " steps");
    }
    return text + (auto.own ? "" : " (the default)");
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
        return "Splats trained" + took + ".";
    }
    if (job.state === "failed") return "Training failed: " + (job.error || "see the log.");
    if (job.state === "canceled") return "Training canceled.";
    return "";
}
