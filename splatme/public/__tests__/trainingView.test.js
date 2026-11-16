import { PRESETS, presetOfSteps, stepsNote, overallProgress, stageText, panelMode, optionsFromForm, duration, resultText, formFromOptions, autoText, continueFromForm, defaultMoreSteps, taskStatusText, rowNote, nextRefresh, splatsLine, runningPercent, FAST, SLOW, THERMAL_PALETTES, DEFAULT_PALETTE, thermalText, temperatureText, trainingStages, stagesCells, STAGE_TIPS } from "../trainingView";

describe("the Quality choice", () => {
    test("the default of 7,000 steps is Standard", () => {
        expect(presetOfSteps(7000)).toBe("standard");
        expect(presetOfSteps("3000")).toBe("draft");
        expect(PRESETS.map(p => [p.key, p.steps])).toEqual([["draft", 3000], ["standard", 7000], ["fine", 15000], ["high", 30000]]);
    });

    test("a number of steps no preset has is Custom, the earlier Draft's 2,000 too", () => {
        expect(presetOfSteps(12345)).toBe("custom");
        expect(presetOfSteps("2000")).toBe("custom");
        expect(presetOfSteps("")).toBe("custom");
    });

    test("no preset is a number of steps the trainer handles badly", () => {
        for (const preset of PRESETS) expect(stepsNote(preset.steps)).toBe("");
    });

    test("up to 2,000 steps is said to grow nothing", () => {
        expect(stepsNote(2000)).toMatch(/does not grow the model/);
        expect(stepsNote("1")).toMatch(/does not grow the model/);
        expect(stepsNote(2001)).toBe("");
    });

    test("between 3,001 and 5,999 steps is said to train worse than 3,000", () => {
        expect(stepsNote(3001)).toMatch(/trains worse than 3,000/);
        expect(stepsNote("4000")).toMatch(/trains worse than 3,000/);
        expect(stepsNote(5999)).toMatch(/trains worse than 3,000/);
        expect(stepsNote(6000)).toBe("");
    });

    test("a value that is not a number of steps has no note", () => {
        expect(stepsNote("")).toBe("");
        expect(stepsNote("abc")).toBe("");
        expect(stepsNote(0)).toBe("");
        expect(stepsNote(2500.5)).toBe("");
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
        expect(form).toEqual({steps: "2000", image_size: "0", max_gaussians: "500000", ignore_sky: false, crop: true, palette: "gray"});
        expect(optionsFromForm(form, null).options).toEqual({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(formFromOptions(null)).toEqual({steps: "30000", image_size: "0", max_gaussians: "", ignore_sky: false, crop: true, palette: "gray"});
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

describe("a thermal task's colours", () => {
    test("the palettes are thermal.py's, Grayscale first and the default", () => {
        expect(THERMAL_PALETTES.map(p => p.key)).toEqual(["gray", "gray_r", "iron", "magma", "inferno", "plasma", "viridis", "cividis", "jet"]);
        expect(DEFAULT_PALETTE).toBe("gray");
    });

    test("a palette is an option only when it is not the default", () => {
        const form = formFromOptions({steps: 7000, image_size: 1600, palette: "iron"});
        expect(form.palette).toBe("iron");
        expect(optionsFromForm(form, null).options).toEqual({steps: 7000, image_size: 1600, palette: "iron"});
        expect(optionsFromForm({...form, palette: "gray"}, null).options).toEqual({steps: 7000, image_size: 1600});
    });

    test("the row names the palette and the range it spans, in the user's unit", () => {
        const drawn = {palette: "iron", low: 10.31, high: 43.49};
        expect(thermalText(drawn, false)).toBe("Thermal Colours: Iron, from 10.3 °C to 43.5 °C.");
        expect(thermalText(drawn, true)).toBe("Thermal Colours: Iron, from 50.6 °F to 110.3 °F.");
        expect(temperatureText(-5, false)).toBe("-5.0 °C");
        expect(resultText({state: "completed", options: {steps: 7000}, thermal: {palette: "gray", low: 1, high: 2}}))
            .toBe("Splats trained (7,000 steps). Thermal Colours: Grayscale, from 1.0 °C to 2.0 °C.");
        expect(thermalText(null)).toBe("");
    });

    test("drawing the thermal photos is a stage of its own", () => {
        expect(stageText({state: "drawing", status: "Finding the temperature range"})).toBe("Drawing the thermal photos: Finding the temperature range");
        expect(overallProgress({state: "drawing", progress: 50})).toBe(0);
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

describe("a task's processing in its row", () => {
    test("a running task shows how far WebODM is, in whole percent", () => {
        expect(runningPercent({status: 20, running_progress: 0.456})).toBe(46);
    });

    test("a task that is not running shows no percent", () => {
        expect(runningPercent({status: 10, running_progress: 0})).toBeNull();
        expect(runningPercent({status: 40, running_progress: 1})).toBeNull();
        expect(runningPercent({status: 20})).toBeNull();
    });
});

describe("the trainer's stages under Steps", () => {
    const shares = (total, from) => trainingStages(total, from).stages.map(s => s.percent);

    test("up to 30,000 steps about half grow the model, a sixth refine it and a third polish it", () => {
        expect(stagesCells(30000)).toEqual([
            {label: "Warm-up", value: "2%", rounds: null}, {label: "Growing", value: "48%", rounds: "28 rounds"},
            {label: "Refining", value: "17%", rounds: null}, {label: "Polishing", value: "33%", rounds: null}]);
        expect([shares(7000), trainingStages(7000).rounds]).toEqual([[7, 43, 17, 33], 5]);
        expect(stagesCells(3000)[1]).toEqual({label: "Growing", value: "33%", rounds: "1 round"});
    });

    test("beyond 30,000 steps the extra steps only polish the model", () => {
        expect(trainingStages(60000)).toEqual({rounds: 28, stages: [
            {key: "warmup", label: "Warm-up", steps: 500, percent: 1}, {key: "growing", label: "Growing", steps: 14500, percent: 24},
            {key: "refining", label: "Refining", steps: 5000, percent: 8}, {key: "polishing", label: "Polishing", steps: 40000, percent: 67}]});
    });

    test("up to 2,000 steps the model is never grown, so growing has none of them", () => {
        expect(shares(2000)).toEqual([50, 0, 17, 33]);
        expect(stagesCells(2000)[1]).toEqual({label: "Growing", value: "0%", rounds: "0 rounds"});
    });

    test("the percentages always add up to 100", () => {
        for (let n = 1; n <= 70000; n += 37){
            expect([n, shares(n).reduce((a, b) => a + b, 0)]).toEqual([n, 100]);
        }
    });

    test("continuing a model counts only the more steps, against the new total", () => {
        // 7,000 more on a 7,000-step model: the growing ends at 7,000, so nothing is grown
        expect(shares(14000, 7000)).toEqual([0, 0, 33, 67]);
        expect([shares(30000, 3000), trainingStages(30000, 3000).rounds]).toEqual([[0, 44, 19, 37], 23]);
    });

    test("each stage's heading says what the trainer does in it, the same on Settings", () => {
        expect(Object.keys(STAGE_TIPS)).toEqual(stagesCells(30000).map(c => c.label));
        const html = require("fs").readFileSync(__dirname + "/../../templates/options.html", "utf8");
        const settings = [...html.matchAll(/<abbr title="([^"]*)">([^<]*)<\/abbr>/g)].map(m => [m[2], m[1].replace(/&#x27;/g, "'")]);
        expect(settings).toEqual(Object.entries(STAGE_TIPS));
    });

    test("a number that is not a training's shows a dash in every cell, so the table keeps its size", () => {
        for (const value of ["", "1.5", "abc"]){
            expect(stagesCells(value).map(c => [c.value, c.rounds])).toEqual([["–", null], ["–", "–"], ["–", null], ["–", null]]);
        }
        expect(trainingStages(7000, 7000)).toBeNull();
    });
});
