import { PRESETS, presetOfSteps, overallProgress, stageText, panelMode, optionsFromForm, duration, resultText, formFromOptions, autoText } from "../trainingView";

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
        const stages = ["starting", "exporting", "uploading", "queued", "training", "importing"];
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

    test("half of the training is past the export and well short of the end", () => {
        expect(overallProgress({state: "training", progress: 50})).toBe(65);
    });

    test("no job, or a state it does not know, shows nothing done", () => {
        expect(overallProgress(null)).toBe(0);
        expect(overallProgress({state: "failed", progress: 80})).toBe(0);
        expect(overallProgress({state: "training", progress: 250})).toBe(95);
    });

    test("the stage is named, with the job's own detail when it gives one", () => {
        expect(stageText({state: "training", status: "Step 1200 of 7000"})).toBe("Training: Step 1200 of 7000");
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
        expect(resultText({state: "failed", error: "CUDA out of memory"})).toBe("Training failed: CUDA out of memory");
        expect(resultText({state: "canceled"})).toBe("Training canceled.");
        expect(resultText({state: null})).toBe("");
    });
});

describe("a task's automatic training", () => {
    test("it is named by its Quality, and says when it is the administrators' default", () => {
        expect(autoText({enabled: true, options: {steps: 7000}, own: true})).toBe("On: Standard");
        expect(autoText({enabled: true, options: {steps: 30000}, own: false})).toBe("On: High (the default)");
        expect(autoText({enabled: false, options: {steps: 7000}, own: false})).toBe("Off (the default)");
        expect(autoText({enabled: false, options: {}, own: true})).toBe("Off");
    });

    test("steps no preset has are given as a number", () => {
        expect(autoText({enabled: true, options: {steps: 12000}, own: true})).toBe("On: 12,000 steps");
    });

    test("every preset says what to expect of it", () => {
        for (const preset of PRESETS) expect(preset.hint.length).toBeGreaterThan(10);
    });

    test("saved options fill the form, and the form gives them back", () => {
        const form = formFromOptions({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(form).toEqual({steps: "2000", image_size: "0", max_gaussians: "500000"});
        expect(optionsFromForm(form, null).options).toEqual({steps: 2000, image_size: 0, max_gaussians: 500000});
        expect(formFromOptions(null)).toEqual({steps: "7000", image_size: "1600", max_gaussians: ""});
    });
});
