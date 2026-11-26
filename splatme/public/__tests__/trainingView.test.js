import { stepsGrow, PRESETS, presetOfSteps, stepsNote, overallProgress, stageText, panelMode, optionsFromForm, duration, resultText, formFromOptions, autoText, continueFromForm, defaultMoreSteps, taskStatusText, rowNote, nextRefresh, splatsLine, runningPercent, FAST, SLOW, THERMAL_PALETTES, DEFAULT_PALETTE, thermalText, temperatureText, trainingStages, stagesCells, STAGE_TIPS, growUntilRange, trainedSize, imageSizeRows, justCompleted, dashboardLink, trainerView, continueState, strategyChoices, exposureChecked, nodeLabel, startingNode, settingOptions } from "../trainingView";

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
        expect(optionsFromForm({steps: "7000", image_size: "8"}, ranges).error).toBe("Image Size is between 16 and 100000, or blank for full size.");
    });

    test("without the node's ranges the server is left to judge", () => {
        expect(optionsFromForm({steps: "999999999", image_size: "1600"}, null)).toEqual({options: {steps: 999999999, image_size: 1600}});
    });
});

describe("Image Size left blank", () => {
    test("is full size, sent as 0, as 0 still is", () => {
        expect(optionsFromForm({steps: "7000", image_size: " "}, null).options).toEqual({steps: 7000, image_size: 0});
        expect(optionsFromForm({steps: "7000", image_size: "0"}, null).options).toEqual({steps: 7000, image_size: 0});
    });
    test("keeps the photos as they are in the Image Size table", () => {
        expect(imageSizeRows([[4000, 3000]], "")[0].trained).toBe("4,000 × 3,000");
    });
    test("is how full size is shown", () => {
        expect(formFromOptions({steps: 7000, image_size: 0}).image_size).toBe("");
        expect(formFromOptions({steps: 7000}).image_size).toBe("1600");
    });
});

describe("a continued training's stages", () => {
    test("are shown only when the added steps grow the model", () => {
        expect(stepsGrow(37000, 30000, "")).toBe(false);  // the trainer's own: growing ended at 15,000
        expect(stepsGrow(37000, 30000, "33000")).toBe(true);
        expect(stepsGrow(7000, 0, "")).toBe(true);
        expect(stepsGrow("abc", 0, "")).toBe(false);
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
        expect(resultText({state: "canceled", error: "The task was processed again while its splats trained."}))
            .toBe("Training canceled: The task was processed again while its splats trained.");
        expect(resultText({state: null})).toBe("");
    });

    // 22 Nov 2026 at noon UTC: the same day in every time zone a test runs in
    const NOON = Date.UTC(2026, 10, 22, 12) / 1000;
    test("its training time is told apart from the rest, with the day it ended", () => {
        const job = {state: "completed", options: {steps: 7000}, started: NOON - 600, finished: NOON, resume: null, earlier_training: 0,
                     times: {starting: 20, exporting: 60, uploading: 30, queued: 40, training: 270, importing: 30}};
        expect(resultText(job)).toBe("Splats trained (7,000 steps) on 22 Nov 2026: 4 min 30 s of training. Preparing, transfers and waiting took 3 min 0 s.");
    });
    test("Ignore Sky's time is given on its own", () => {
        const job = {state: "completed", options: {steps: 7000}, finished: NOON, sky_masks: 12, times: {training: 270, masking: 120, exporting: 0.4}};
        expect(resultText(job)).toBe("Splats trained (7,000 steps) on 22 Nov 2026: 4 min 30 s of training. Sky ignored in 12 photos. Finding the sky took 2 min 0 s.");
    });
    test("a continued training counts the earlier training too, when it is known", () => {
        const job = {state: "completed", options: {steps: 14000}, finished: NOON, resume: 7000, earlier_training: 270, times: {training: 300}};
        expect(resultText(job)).toBe("Splats trained (14,000 steps) on 22 Nov 2026: 9 min 30 s of training, 5 min 0 s of it for the last 7,000.");
        expect(resultText({...job, earlier_training: null})).toBe("Splats trained (14,000 steps) on 22 Nov 2026: 5 min 0 s of training for the last 7,000.");
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
        expect(form).toEqual({steps: "2000", image_size: "", max_gaussians: "500000", sh_degree: "", densify_until: "", strategy: "", exposure_correction: null, ignore_sky: false, crop: true, palette: "gray"});
        expect(optionsFromForm(form, null).options).toEqual({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(formFromOptions(null)).toEqual({steps: "30000", image_size: "1600", max_gaussians: "", sh_degree: "", densify_until: "", strategy: "", exposure_correction: null, ignore_sky: false, crop: true, palette: "gray"});
        expect(optionsFromForm(formFromOptions({steps: 30000, image_size: 1600, densify_until: 20000}), null).options)
            .toEqual({steps: 30000, image_size: 1600, densify_until: 20000});
    });

    test("Grow Until is optional, from 1,000 to 3,000 less than Steps", () => {
        const ranges = {steps: {min: 1, max: 200000}, densify_until: {min: 1000, max: 200000}};
        const form = {steps: "30000", image_size: "1600", max_gaussians: ""};
        expect(optionsFromForm({...form, densify_until: " "}, ranges).options).toEqual({steps: 30000, image_size: 1600});
        expect(optionsFromForm({...form, densify_until: "27000"}, ranges).options).toEqual({steps: 30000, image_size: 1600, densify_until: 27000});
        expect(optionsFromForm({...form, densify_until: "27001"}, ranges).error).toBe("Grow Until is at most 27000: 3000 less than Steps.");
        expect(optionsFromForm({...form, densify_until: "999"}, ranges).error).toBe("Grow Until is between 1000 and 200000.");
        expect(optionsFromForm({...form, densify_until: "999"}, null).error).toBe("Grow Until is between 1000 and 200000.");
        expect(optionsFromForm({...form, steps: "3999", densify_until: "1000"}, ranges).error).toBe("Grow Until needs Steps of 4000 or more.");
    });

    test("Crop to Boundary is on unless it is unticked", () => {
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

    test("Grow Until may make the model grow again, from 1,000 after its steps to 3,000 before the last", () => {
        expect(continueFromForm("10000", 30000, null, "")).toEqual({options: {resume: true, steps: 10000}});
        expect(continueFromForm("10000", 30000, null, "37000")).toEqual({options: {resume: true, steps: 10000, densify_until: 37000}});
        expect(continueFromForm("10000", 30000, null, "30999").error).toBe("Grow Until is between 31000 and 37000.");
        expect(continueFromForm("10000", 30000, null, "37001").error).toBe("Grow Until is between 31000 and 37000.");
        expect(continueFromForm("10000", 30000, null, "3e4").error).toBe("Grow Until is a whole number.");
        expect(continueFromForm("3999", 30000, null, "31000").error).toBe("Grow Until needs More Steps of 4000 or more.");
        expect(growUntilRange(30000, 4000)).toEqual({min: 31000, max: 31000});
        expect(growUntilRange(30000, 3999)).toBeNull();
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
        // Edits being applied are followed as a training is
        expect(nextRefresh(list({status: 40, splats: {apply: {state: "applying"}}}))).toBe(FAST);
        expect(nextRefresh(list({status: 40, splats: {apply: {state: "completed"}}}))).toBe(0);
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
    const shares3 = (total, from, growUntil) => trainingStages(total, from, growUntil).stages.map(s => s.percent);

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

    test("Grow Until moves the end of the growing, and past where polishing would start leaves no refining", () => {
        expect(trainingStages(30000, 0, "")).toEqual(trainingStages(30000));
        expect(trainingStages(30000, 0, " 10000 ").stages.map(s => s.percent)).toEqual([2, 32, 33, 33]);
        expect([shares3(30000, 0, 27000), trainingStages(30000, 0, 27000).rounds]).toEqual([[2, 88, 0, 10], 52]);
        expect([shares3(40000, 30000, 37000), trainingStages(40000, 30000, 37000).rounds]).toEqual([[0, 70, 0, 30], 13]);
    });
});

describe("the photos' size under Image Size", () => {
    test("the longer side is brought down to the Image Size and the other in proportion, as WebODM's export does", () => {
        expect(imageSizeRows([[5280, 3956]], "1600")).toEqual([{source: "5,280 × 3,956", trained: "1,600 × 1,199", side: "−70%", pixels: "−91%"}]);
        expect(trainedSize(3956, 5280, 1600)).toEqual([1199, 1600]);  // portrait
    });

    test("0, or an Image Size above the photos', keeps them as they are", () => {
        expect(imageSizeRows([[640, 512]], "0")).toEqual([{source: "640 × 512", trained: "640 × 512", side: "0%", pixels: "0%"}]);
        expect(imageSizeRows([[640, 512]], "1600")[0].trained).toBe("640 × 512");
    });

    test("a half pixel is rounded as Python rounds it, to the even neighbour", () => {
        expect(trainedSize(1000, 5, 100)).toEqual([100, 0 + 1]);   // 0.5 → 0, then at least 1
        expect(trainedSize(1000, 25, 100)).toEqual([100, 2]);      // 2.5 → 2
        expect(trainedSize(1000, 35, 100)).toEqual([100, 4]);      // 3.5 → 4
    });

    test("each camera's photos have a row, and a number the training does not take shows dashes", () => {
        const rows = imageSizeRows([[5280, 3956], [640, 512]], "8");
        expect(rows.map(r => [r.source, r.trained, r.side, r.pixels])).toEqual([["5,280 × 3,956", "–", "–", "–"], ["640 × 512", "–", "–", "–"]]);
        expect(imageSizeRows([[640, 512]], "")[0].trained).toBe("640 × 512");  // blank: full size
        expect(imageSizeRows([], "1600")).toEqual([]);
    });
});

describe("a task that just completed", () => {
    const auto = {enabled: true};
    it("is one set to train that was processing and now has completed with no training yet", () => {
        expect(justCompleted({task_status: 20, auto}, {task_status: 40, active: false, auto})).toBe(true);
        expect(justCompleted({task_status: null, auto}, {task_status: 40, auto})).toBe(true);
    });
    it("is not one already training, one not set to train, nor one that was completed before", () => {
        expect(justCompleted({task_status: 20, auto}, {task_status: 40, active: true, auto})).toBe(false);
        expect(justCompleted({task_status: 20, auto: {enabled: false}}, {task_status: 40, auto: {enabled: false}})).toBe(false);
        expect(justCompleted({task_status: 40, auto}, {task_status: 40, auto})).toBe(false);
        expect(justCompleted(null, {task_status: 40, auto})).toBe(false);
        expect(justCompleted({task_status: 20, auto}, {task_status: 30, auto})).toBe(false);
    });
});

describe("the link to a task on the Dashboard", () => {
    it("shows only the task's project, with the task's panel open", () => {
        expect(dashboardLink(12, "ab-cd")).toBe("/dashboard/?id=12&project_task_open=12&project_task_expanded=ab-cd");
    });
});

describe("the splat node's trainer", () => {
    const lichtfeld = {trainer_kind: "lichtfeld", supports: {masks: true, continue: true}, ranges: {steps: {min: 1, max: 200000}}};

    test("without the node's answer, or from a node before 0.3.0, the forms show everything, as for OpenSplat", () => {
        for (const node of [null, {ranges: {steps: {min: 1, max: 9}, densify_until: {min: 1000, max: 9}}}]){
            const view = trainerView(node);
            expect([view.kind, view.opensplat, view.masks, view.continues]).toEqual(["opensplat", true, true, true]);
            expect(view.has("densify_until")).toBe(true);
        }
    });

    test("another trainer hides OpenSplat's texts and the options its node does not have", () => {
        const view = trainerView(lichtfeld);
        expect([view.kind, view.opensplat]).toEqual(["lichtfeld", false]);
        expect([view.has("steps"), view.has("max_gaussians"), view.has("densify_until")]).toEqual([true, false, false]);
        expect(trainerView({...lichtfeld, supports: {masks: false}}).masks).toBe(false);
    });

    test("a form leaves out the options the node lacks and Ignore Sky when it takes no masks, so saving clears them", () => {
        const form = {steps: "30000", image_size: "1600", max_gaussians: "1000", densify_until: "9000", ignore_sky: true};
        expect(optionsFromForm(form, lichtfeld.ranges, lichtfeld).options).toEqual({steps: 30000, image_size: 1600, ignore_sky: true});
        expect(optionsFromForm(form, lichtfeld.ranges, {...lichtfeld, supports: {masks: false}}).options).toEqual({steps: 30000, image_size: 1600});
        expect(optionsFromForm(form, null, null).options).toEqual({steps: 30000, image_size: 1600, max_gaussians: 1000, densify_until: 9000, ignore_sky: true});
    });

    test("a model is continued only on a node whose trainer made it and continues models", () => {
        expect(continueState({trained_steps: 0, node: lichtfeld})).toEqual({can: false, note: ""});
        expect(continueState({trained_steps: 7000, node: null})).toEqual({can: true, note: ""});
        expect(continueState({trained_steps: 7000, trained_kind: "lichtfeld", node: lichtfeld})).toEqual({can: true, note: ""});
        expect(continueState({trained_steps: 7000, node: lichtfeld}).note).toBe(
            "This task's model was trained with OpenSplat, and the splat node trains with LichtFeld Studio: the training starts over.");
        expect(continueState({trained_steps: 7000, trained_kind: "lichtfeld", node: {...lichtfeld, supports: {continue: false}}}).note).toBe(
            "LichtFeld Studio cannot continue a model: the training starts over.");
    });

    test("a finished training names the options it left out", () => {
        const job = {state: "completed", options: {steps: 7000}, times: {training: 60}, finished: 0, skipped: ["Grow Until"]};
        expect(resultText(job)).toMatch(/ Left out, as the splat node's trainer does not have it: Grow Until\.$/);
        expect(resultText({state: "failed", error: "x", skipped: ["Max Gaussians", "Grow Until"]})).toBe(
            "Training failed: x Left out, as the splat node's trainer does not have them: Max Gaussians, Grow Until.");
        expect(resultText({...job, skipped: []})).not.toMatch(/Left out/);
    });
});

describe("a LichtFeld Studio node's options", () => {
    const node = {trainer_kind: "lichtfeld", supports: {masks: true, continue: true}, ranges: {
        steps: {min: 1, max: 200000}, max_gaussians: {min: 1000, max: 50000000}, sh_degree: {min: 0, max: 3},
        strategy: {choices: ["mrnf", "mcmc", "igs+"]}, exposure_correction: {type: "bool"}}};

    test("a strategy and SH Degree 0 are sent, and Exposure Correction only when not the strategy's default", () => {
        const form = {...formFromOptions(null), strategy: "mrnf", sh_degree: "0", exposure_correction: false};
        expect(optionsFromForm(form, node.ranges, node).options).toEqual(
            {steps: 30000, image_size: 1600, sh_degree: 0, strategy: "mrnf", exposure_correction: false});
        expect(optionsFromForm(formFromOptions(null), node.ranges, node).options).toEqual({steps: 30000, image_size: 1600});
        const mcmc = {...formFromOptions(null), strategy: "mcmc"};
        expect(optionsFromForm(mcmc, node.ranges, node).options).toEqual({steps: 30000, image_size: 1600, strategy: "mcmc"});
        expect(optionsFromForm({...mcmc, exposure_correction: true}, node.ranges, node).options).toEqual(
            {steps: 30000, image_size: 1600, strategy: "mcmc", exposure_correction: true});
    });

    test("Exposure Correction is ticked for MRNF or no strategy, unticked for MCMC and IGS+, until it is changed", () => {
        const form = formFromOptions(null);
        expect(["", "mrnf", "mcmc", "igs+"].map(strategy => exposureChecked({...form, strategy}))).toEqual([true, true, false, false]);
        expect(exposureChecked({...form, strategy: "mcmc", exposure_correction: true})).toBe(true);
        expect(exposureChecked({...form, strategy: "mrnf", exposure_correction: false})).toBe(false);
    });

    test("a strategy the node does not offer, or an SH Degree out of its range, is refused", () => {
        const form = formFromOptions(null);
        expect(optionsFromForm({...form, strategy: "fast"}, node.ranges, node).error).toBe("Strategy is one of MRNF, MCMC, IGS+.");
        expect(optionsFromForm({...form, sh_degree: "4"}, node.ranges, node).error).toBe("SH Degree is between 0 and 3.");
    });

    test("saved options come back into the form", () => {
        const form = formFromOptions({steps: 30000, strategy: "igs+", exposure_correction: true, sh_degree: 2});
        expect([form.strategy, form.exposure_correction, form.sh_degree]).toEqual(["igs+", true, "2"]);
        expect(formFromOptions({steps: 30000, exposure_correction: false}).exposure_correction).toBe(false);
        // A value that is the strategy's default follows the strategy again
        expect(formFromOptions({steps: 30000, strategy: "mcmc", exposure_correction: false}).exposure_correction).toBe(null);
        expect(formFromOptions({steps: 30000}).exposure_correction).toBe(null);
    });

    test("an OpenSplat node gets none of LichtFeld's options", () => {
        const opensplat = {trainer_kind: "opensplat", ranges: {steps: {min: 1, max: 200000}, sh_degree: {min: 1, max: 3}}};
        const form = {...formFromOptions(null), strategy: "mcmc", exposure_correction: false, sh_degree: "2"};
        expect(optionsFromForm(form, opensplat.ranges, opensplat).options).toEqual({steps: 30000, image_size: 1600, sh_degree: 2});
    });

    test("the strategies are the node's, or SplatMe's own when it did not answer", () => {
        expect(strategyChoices({strategy: {choices: ["mcmc"]}})).toEqual(["mcmc"]);
        expect(strategyChoices(null)).toEqual(["mrnf", "mcmc", "igs+"]);
    });
});

describe("several splat nodes", () => {
    const nodes = [{id: "default", name: "Splat Node", trainer_kind: "opensplat", continue_problem: "OpenSplat can't continue this task's model: it has no rot_3."},
                   {id: "lf", name: "LichtFeld", trainer_kind: "lichtfeld", continue_problem: null},
                   {id: "off", name: "Spare", trainer_kind: null, continue_problem: null}];
    const node = {trainer_kind: "opensplat", supports: {masks: true, continue: true}, ranges: {}};

    test("a node is named with its trainer, or as not available", () => {
        expect(nodeLabel(nodes[1])).toBe("LichtFeld (LichtFeld Studio)");
        expect(nodeLabel(nodes[2])).toBe("Spare (not available)");
    });

    test("a node named as its trainer is not named twice", () => {
        expect(nodeLabel({id: "x", name: "LichtFeld Studio", trainer_kind: "lichtfeld"})).toBe("LichtFeld Studio");
        expect(nodeLabel({id: "y", name: "OpenSplat", trainer_kind: "opensplat"})).toBe("OpenSplat");
        expect(nodeLabel({id: "z", name: "OpenSplat", trainer_kind: "lichtfeld"})).toBe("OpenSplat (LichtFeld Studio)");
    });

    test("continuing on the chosen node follows the server's judgement and names the nodes that can", () => {
        expect(continueState({trained_steps: 10, node, nodes, node_id: "lf"})).toEqual({can: true, note: ""});
        expect(continueState({trained_steps: 10, node, nodes, node_id: "default"})).toEqual({can: false, note:
            "OpenSplat can't continue this task's model: it has no rot_3. Choose LichtFeld under Splat Node to continue it; on this node the training starts over."});
        const alone = [nodes[0]];
        expect(continueState({trained_steps: 10, node, nodes: alone, node_id: "default"}).note).toBe(
            "OpenSplat can't continue this task's model: it has no rot_3. No splat node set up can continue it: the training starts over.");
    });

    test("the dialog starts on a node that can continue the model when the default can't", () => {
        expect(startingNode({trained_steps: 10, nodes, node_id: "default"})).toBe("lf");
        expect(startingNode({trained_steps: 0, nodes, node_id: "default"})).toBe("default");
        expect(startingNode({trained_steps: 10, nodes: [nodes[0]], node_id: "default"})).toBe("default");
        expect(startingNode({})).toBe(null);
    });

    test("a setting gives each trainer its own options, else those it was saved with", () => {
        const setting = {options: {steps: 7000}, by_kind: {lichtfeld: {steps: 30000, strategy: "mcmc"}}};
        expect(settingOptions(setting, "lichtfeld")).toEqual({steps: 30000, strategy: "mcmc"});
        expect(settingOptions(setting, "opensplat")).toEqual({steps: 7000});
        expect(settingOptions(null, "opensplat")).toBe(null);
    });
});
