import { keepMask, strokeRing, insideLasso, boundaryMask, insideShapes, insideRing, framing, newBox, cleanRing, editLabel, sizeText, applyText } from '../editShapes';

const xs = Float32Array.from([0, 3, 0.5, 0]);
const ys = Float32Array.from([0, 0, -0.5, -1.5]);
const zs = Float32Array.from([5, 5, 5, 5]);
const kept = edits => Array.from(keepMask(xs, ys, zs, edits));

describe("keepMask", () => {
    test("keeps every splat without edits", () => {
        expect(kept([])).toEqual([1, 1, 1, 1]);
    });

    test("a polygon removing what is inside removes only the splats inside it, as the server's test does", () => {
        expect(kept([{type: "polygon", keep: false, ring: [[2, -1], [4, -1], [4, 1], [2, 1]]}])).toEqual([1, 0, 1, 1]);
    });

    test("a polygon keeping what is inside removes the rest, at all heights", () => {
        const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        expect(kept([{type: "polygon", keep: true, ring}])).toEqual([1, 0, 1, 0]);
    });

    test("a turned box keeps what is inside it in its own axes, as the server's test does", () => {
        const box = {type: "box", keep: true, center: [0.25, -0.25, 5], size: [1, 0.2, 1], turn: -45};
        expect(kept([box])).toEqual([1, 0, 1, 0]);
        expect(kept([{...box, turn: 0}])).toEqual([0, 0, 0, 0]);
    });

    test("a box's height counts: splats above or below it are outside", () => {
        const box = {type: "box", keep: false, center: [0, 0, 0], size: [100, 100, 8], turn: 0};
        expect(kept([box])).toEqual([1, 1, 1, 1]);
        expect(kept([{...box, size: [100, 100, 12]}])).toEqual([0, 0, 0, 0]);
    });

    test("all the edits must keep a splat for it to stay", () => {
        const keepLeft = {type: "polygon", keep: true, ring: [[-1, -2], [1, -2], [1, 2], [-1, 2]]};
        const removeLow = {type: "box", keep: false, center: [0, -1.5, 5], size: [1, 1, 1], turn: 0};
        expect(kept([keepLeft, removeLow])).toEqual([1, 0, 1, 0]);
    });

    test("writes into the array it is given", () => {
        const out = new Uint8Array(4);
        expect(keepMask(xs, ys, zs, [], out)).toBe(out);
        expect(Array.from(out)).toEqual([1, 1, 1, 1]);
    });
});

test("a ring's crossing rule leaves out a point on its far side", () => {
    expect(insideRing([[0, 0], [2, 0], [1, 2]], 1, 0.5)).toBe(true);
    expect(insideRing([[0, 0], [2, 0], [1, 2]], 1.9, 1.5)).toBe(false);
});

test("the framing leaves out the floaters far from the rest", () => {
    const n = 100;
    const a = Array.from({length: n}, (_, i) => i / 10);
    a[0] = -1000;
    a[n - 1] = 1000;
    const frame = framing(a, a, a);
    expect(frame.min[0]).toBeGreaterThan(0);
    expect(frame.max[0]).toBeLessThan(10);
    expect(frame.center[0]).toBeCloseTo((frame.min[0] + frame.max[0]) / 2);
});

test("a new box sits over the middle of the framing, half its width, taller than it", () => {
    const box = newBox({center: [1.234, 2, 3], size: [10, 4, 2]});
    expect(box).toEqual({type: "box", keep: true, center: [1.23, 2, 3], size: [5, 2, 3], turn: 0});
});

test("a ring is kept without its closing corner and repeated corners", () => {
    expect(cleanRing([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]]);
});

test("the list words an edit by its kind and size", () => {
    expect(editLabel({type: "box", size: [12.345, 3, 1000]})).toBe("Box, 12.3 × 3 × 1,000 m");
    expect(editLabel({type: "polygon", ring: [[0, 0], [1, 0], [1, 1]]})).toBe("Polygon, 3 corners");
});

test("sizes are in megabytes, gigabytes above one", () => {
    expect(sizeText(53784100)).toBe("51 MB");
    expect(sizeText(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
});

describe("applyText", () => {
    test("says nothing before the first Apply", () => {
        expect(applyText(null)).toBe("");
    });
    test("says what an Apply is doing, how it failed, or what it removed", () => {
        expect(applyText({state: "applying", status: "Converting the model"})).toBe("Applying the edits: Converting the model.");
        expect(applyText({state: "failed", error: "splat-tools failed"})).toBe("Applying the edits failed: splat-tools failed");
        expect(applyText({state: "completed", edited: 1234})).toBe("Edits applied. 1,234 splats removed.");
        expect(applyText({state: "completed", edited: 1})).toBe("Edits applied. 1 splat removed.");
        expect(applyText({state: "completed", edited: null})).toBe("Edits applied. No splat removed.");
    });
});

describe("the boundary", () => {
    const square = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]];
    test("keeps what is inside one of its polygons and outside their holes", () => {
        const holed = [square[0], [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]]];
        expect(insideShapes([holed], 0.5, 0.5)).toBe(true);
        expect(insideShapes([holed], 0, 0)).toBe(false);
        expect(insideShapes([holed, [[[-0.1, -0.1], [0.1, -0.1], [0, 0.1]]]], 0, 0)).toBe(true);
    });

    test("hides the splats outside it, under the edits", () => {
        const base = boundaryMask(xs, ys, [square]);
        expect(Array.from(base)).toEqual([1, 0, 1, 0]);
        expect(Array.from(keepMask(xs, ys, zs, [], null, base))).toEqual([1, 0, 1, 0]);
        const removeMiddle = {type: "box", keep: false, center: [0, 0, 5], size: [0.2, 0.2, 1], turn: 0};
        expect(Array.from(keepMask(xs, ys, zs, [removeMiddle], null, base))).toEqual([0, 0, 1, 0]);
    });

    test("crops nothing when it has nothing of the model inside, or all of it, or is not there", () => {
        expect(boundaryMask(xs, ys, [[[[50, 50], [51, 50], [51, 51]]]])).toBeNull();
        expect(boundaryMask(xs, ys, [[[[-9, -9], [9, -9], [9, 9], [-9, 9]]]])).toBeNull();
        expect(boundaryMask(xs, ys, [])).toBeNull();
    });
});

describe("the lasso", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const square = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

    test("removes what falls inside it on screen, as the server's test does", () => {
        expect(kept([{type: "lasso", keep: false, ring: square, view: identity}])).toEqual([0, 1, 0, 1]);
    });

    test("leaves what is behind the camera", () => {
        const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0];
        expect(kept([{type: "lasso", keep: false, ring: square, view: behind}])).toEqual([1, 1, 1, 1]);
    });

    test("divides by the perspective's w, as the server's test does", () => {
        const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
        const ring = [[0.5, -0.1], [0.7, -0.1], [0.7, 0.1], [0.5, 0.1]];
        expect(insideLasso({ring, view: perspective}, 3, 0, 5)).toBe(true);
        expect(kept([{type: "lasso", keep: false, ring, view: perspective}])).toEqual([1, 0, 1, 1]);
    });

    test("is words in the list", () => {
        expect(editLabel({type: "lasso", ring: square})).toBe("Lasso, 4 corners");
    });

    test("a stroke keeps a corner every few pixels, in -1 to 1 with y up", () => {
        const points = [[0, 0], [1, 0], [5, 0], [5, 1], [100, 50], [200, 100]];
        expect(strokeRing(points, 200, 100, 3)).toEqual([[-1, 1], [-0.95, 1], [0, 0], [1, -1]]);
    });

    test("a long stroke is thinned to the most corners an edit may have", () => {
        const points = Array.from({length: 5000}, (_, i) => [i, 0]);
        expect(strokeRing(points, 5000, 100, 1).length).toBeLessThanOrEqual(2000);
    });
});
