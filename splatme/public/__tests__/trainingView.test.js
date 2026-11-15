import { PRESETS, presetOfSteps, overallProgress, stageText, panelMode, optionsFromForm, duration, resultText, formFromOptions, autoText, continueFromForm, defaultMoreSteps, taskStatusText, rowNote, nextRefresh, splatsLine, FAST, SLOW } from "../trainingView";

describe("the Quality choice", () => {
    test("the default of 7,000 steps is Standard", () => {
        expect(presetOfSteps(7000)).toBe("standard");
        expect(presetOfSteps("2000")).toBe("draft");
        expect(PRESETS.map(p => p.key)).toEqual(["draft", "standard", "high"]);
    });

    test("a number of steps no preset has is Custom", () => {
        expect(presetOfSteps(12345)).toBe("custom");
        expect(presetOfSteps("")).toBe("custom");
    });
});

describe("the progress bar", () => {
    test("it never goes back from one stage to the next", () => {
        const stages = ["starting", "exporting", "masking", "uploading", "queued", "training", "importing"];
        let last = 0;
        for (const state of stages){
            for (const progress of [0, 50, 100]){
                const now = overallProgress({state, progress});
                expect(now).toBeGreaterThanOrEqual(last);
                last = now;
            }
        }
        expect(last).toBe(100);
        expect(overallProgress({state: "completed"})).toBe(100);
    });

    test("finding the sky has its own stage between the export and the sending", () => {
        expect(stageText({state: "masking", status: "Photo 3 of 40"})).toBe("Finding the sky: Photo 3 of 40");
        expect(overallProgress({state: "masking", progress: 100})).toBe(overallProgress({state: "uploading", progress: 0}));
    });

    test("half of the training is past the export and well short of the end", () => {
        expect(overallProgress({state: "training", progress: 50})).toBe(65);
    });

    test("no job, or a state it does not know, shows nothing done", () => {
        expect(overallProgress(null)).toBe(0);
        expect(overallProgress({state: "failed", progress: 80})).toBe(0);
        expect(overallProgress({state: "training", progress: 250})).toBe(95);
    });

    test("the stage is named, with the job's own detail when it gives one", () => {
        expect(stageText({state: "training", status: "Step 1,200 of 7,000"})).toBe("Training: Step 1,200 of 7,000");
        expect(stageText({state: "importing", status: ""})).toBe("Importing the model");
        expect(stageText({state: null})).toBe("");
    });
});

describe("what a task's panel shows", () => {
    const completed = {task_status: 40, can_train: true, active: false};

    test("a completed task its user may change gets the button", () => {
        expect(panelMode(completed)).toBe("button");
    });

    test("a running training shows its progress to everyone who sees the task", () => {
        expect(panelMode({...completed, active: true, can_train: false})).toBe("progress");
    });

    test("a task still processing gets a button that waits", () => {
        expect(panelMode({...completed, task_status: 20})).toBe("waiting");
        expect(panelMode({...completed, task_status: 10})).toBe("waiting");
    });

    test("nothing for someone who may not train, a failed task, or before the status is known", () => {
        expect(panelMode({...completed, can_train: false})).toBe("hidden");
        expect(panelMode({...completed, task_status: 20, can_train: false})).toBe("hidden");
        expect(panelMode({...completed, task_status: 30})).toBe("hidden");
        expect(panelMode(null)).toBe("hidden");
    });
});

describe("the dialog's options", () => {
    const ranges = {steps: {min: 1, max: 200000}, max_gaussians: {min: 0, max: 50000000}};

    test("the fields become whole numbers, and an empty Max Gaussians is left to the trainer", () => {
        expect(optionsFromForm({steps: "7000", image_size: " 1600 ", max_gaussians: ""}, ranges))
            .toEqual({options: {steps: 7000, image_size: 1600}});
        expect(optionsFromForm({steps: "2000", image_size: "0", max_gaussians: "500000"}, ranges))
            .toEqual({options: {steps: 2000, image_size: 0, max_gaussians: 500000}});
    });

    test("a field that is empty, not a number or out of the node's range is named", () => {
        expect(optionsFromForm({steps: "", image_size: "1600"}, ranges).error).toBe("Steps is needed.");
        expect(optionsFromForm({steps: "7e3", image_size: "1600"}, ranges).error).toBe("Steps is a whole number.");
        expect(optionsFromForm({steps: "0", image_size: "1600"}, ranges).error).toBe("Steps is between 1 and 200000.");
        expect(optionsFromForm({steps: "7000", image_size: "8"}, ranges).error).toBe("Image Size is between 16 and 100000, or 0.");
    });

    test("without the node's ranges the server is left to judge", () => {
        expect(optionsFromForm({steps: "999999999", image_size: "1600"}, null)).toEqual({options: {steps: 999999999, image_size: 1600}});
    });
});

describe("a finished training", () => {
    test("its time is in seconds, minutes or hours", () => {
        expect(duration(42.4)).toBe("42 s");
        expect(duration(226)).toBe("3 min 46 s");
        expect(duration(3725)).toBe("1 h 2 min");
    });

    test("it is summed up beside the button", () => {
        expect(resultText({state: "completed", started: 100, finished: 326})).toBe("Splats trained in 3 min 46 s.");
        expect(resultText({state: "completed", options: {steps: 14000}, started: 100, finished: 160})).toBe("Splats trained (14,000 steps) in 1 min 0 s.");
        expect(resultText({state: "completed", sky_masks: 120, started: 100, finished: 160})).toBe("Splats trained in 1 min 0 s. Sky ignored in 120 photos.");
        expect(resultText({state: "completed", cropped: 6134})).toBe("Splats trained. Cropped to the task's boundary.");
        expect(resultText({state: "completed", sky_masks: 1})).toBe("Splats trained. Sky ignored in 1 photo.");
        expect(resultText({state: "completed", sky_masks: 0})).toBe("Splats trained. No photo shows the sky.");
        expect(resultText({state: "failed", error: "CUDA out of memory"})).toBe("Training failed: CUDA out of memory");
        expect(resultText({state: "canceled"})).toBe("Training canceled.");
        expect(resultText({state: null})).toBe("");
    });
});

describe("a task's automatic training", () => {
    test("it is named by its Quality", () => {
        expect(autoText({enabled: true, options: {steps: 7000}})).toBe("On: Standard");
        expect(autoText({enabled: true, options: {steps: 30000}})).toBe("On: High");
        expect(autoText({enabled: false, options: {steps: 7000}})).toBe("Off");
        expect(autoText({enabled: false, options: {}})).toBe("Off");
    });

    test("steps no preset has are given as a number", () => {
        expect(autoText({enabled: true, options: {steps: 12000}})).toBe("On: 12,000 steps");
    });

    test("every preset says what to expect of it", () => {
        for (const preset of PRESETS) expect(preset.hint.length).toBeGreaterThan(10);
    });

    test("saved options fill the form, and the form gives them back", () => {
        const form = formFromOptions({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(form).toEqual({steps: "2000", image_size: "0", max_gaussians: "500000", ignore_sky: false, crop: true});
        expect(optionsFromForm(form, null).options).toEqual({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(formFromOptions(null)).toEqual({steps: "7000", image_size: "1600", max_gaussians: "", ignore_sky: false, crop: true});
    });

    test("Crop To Boundary is on unless it is unticked", () => {
        expect(optionsFromForm({steps: "2000", image_size: "1600", crop: true}, null).options).toEqual({steps: 2000, image_size: 1600});
        expect(optionsFromForm({steps: "2000", image_size: "1600", crop: false}, null).options).toEqual({steps: 2000, image_size: 1600, crop: false});
        expect(formFromOptions({steps: 2000, crop: false}).crop).toBe(false);
    });

    test("Ignore Sky is an option only when it is ticked", () => {
        const form = formFromOptions({steps: 2000, image_size: 1600, ignore_sky: true});
        expect(form.ignore_sky).toBe(true);
        expect(optionsFromForm(form, null).options).toEqual({steps: 2000, image_size: 1600, ignore_sky: true});
        expect(optionsFromForm({...form, ignore_sky: false}, null).options).toEqual({steps: 2000, image_size: 1600});
    });
});

describe("continuing a trained model", () => {
    const ranges = {steps: {min: 1, max: 200000}};

    test("More Steps becomes a request to continue", () => {
        expect(continueFromForm(" 3000 ", 7000, ranges)).toEqual({options: {resume: true, steps: 3000}});
        expect(continueFromForm("3000", 7000, null)).toEqual({options: {resume: true, steps: 3000}});
    });

    test("More Steps that is missing, not a number or beyond the node's total is named", () => {
        expect(continueFromForm("", 7000, ranges).error).toBe("More Steps is needed.");
        expect(continueFromForm("1.5", 7000, ranges).error).toBe("More Steps is a whole number.");
        expect(continueFromForm("0", 7000, ranges).error).toBe("More Steps is between 1 and 193000.");
        expect(continueFromForm("193001", 7000, ranges).error).toBe("More Steps is between 1 and 193000.");
        expect(continueFromForm("1", 200000, ranges).error).toMatch(/Start over instead/);
    });

    test("More Steps starts as as many again, within the node's limit", () => {
        expect(defaultMoreSteps(7000, ranges)).toBe(7000);
        expect(defaultMoreSteps(150000, ranges)).toBe(50000);
        expect(defaultMoreSteps(7000, null)).toBe(7000);
    });
});

describe("a task's row on the Tasks page", () => {
    test("says WebODM's status of the task", () => {
        expect(taskStatusText(40)).toBe("Completed");
        expect(taskStatusText(30)).toBe("Failed");
        expect(taskStatusText(null)).toBe("Waiting for a processing node");
    });

    test("says why a task without the button cannot be trained", () => {
        expect(rowNote({task_status: 30, can_train: true})).toMatch(/failed processing/);
        expect(rowNote({task_status: 50, can_train: true})).toMatch(/canceled/);
        expect(rowNote({task_status: 40, can_train: false})).toMatch(/Only those who may change this project/);
        expect(rowNote({task_status: 40, can_train: true})).toBe("");
        expect(rowNote({task_status: 40, can_train: false, active: true})).toBe("");
    });
});

describe("the Tasks page's list", () => {
    const list = (...tasks) => [{tasks}];

    test("is asked for often while a task trains, now and then while one processes, and not otherwise", () => {
        expect(nextRefresh(list({status: 40, splats: {active: true}}, {status: 20, splats: {}}))).toBe(FAST);
        expect(nextRefresh(list({status: 40, splats: {}}, {status: 20, splats: {}}))).toBe(SLOW);
        expect(nextRefresh(list({status: null, splats: {}}))).toBe(SLOW);
        expect(nextRefresh(list({status: 40, splats: {}}, {status: 30, splats: {}}))).toBe(0);
        expect(nextRefresh([])).toBe(0);
    });
});

describe("the task panel's line on the Dashboard", () => {
    test("says how far a training is", () => {
        expect(splatsLine({active: true, state: "training", status: "Step 400 of 7,000"})).toBe("Training: Step 400 of 7,000");
    });

    test("says the steps of a trained model", () => {
        expect(splatsLine({state: "completed", has_splats: true, options: {steps: 7000}})).toBe("Trained, 7,000 steps");
        // A model WebODM was given by hand: no training of SplatMe's
        expect(splatsLine({state: null, has_splats: true})).toBe("Trained");
    });

    test("says a task is trained when it completes, a failed training, or none", () => {
        expect(splatsLine({state: null, task_status: 20, auto: {enabled: true}})).toBe("Trained when the task completes");
        expect(splatsLine({state: "failed", has_splats: false})).toBe("Training failed");
        expect(splatsLine({state: null, task_status: 40, auto: {enabled: false}})).toBe("None");
    });
});
