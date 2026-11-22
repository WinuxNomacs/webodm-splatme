import { keepMask, strokeRing, insideLasso, insideBrush, brushStroke, addStroke, MAX_BRUSH_POINTS, boundaryMask, insideShapes, insideRing, framing, newBox, cleanRing, editLabel, sizeText, applyText, modelText, newHistory, recordChange, undoChange, redoChange, HISTORY_STEPS, floatersStrength, colourEdit, colourMatrix, colourText, newColour, plyPositions } from '../editShapes';

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

test("a new box sits over the middle of the framing, a third of its width, taller than it, removing its inside", () => {
    const box = newBox({center: [1.234, 2, 3], size: [9, 6, 2]});
    expect(box).toEqual({type: "box", keep: false, center: [1.23, 2, 3], size: [3, 2, 3], turn: 0});
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
        expect(applyText({state: "completed", edited: 1234})).toBe("");
    });
});

describe("whether the task's model has the edits", () => {
    test("says the edits changed since the model was made", () => {
        expect(modelText(false, {state: "completed", edited: 5})).toMatch(/^The edits changed since the task's model was made/);
    });
    test("says the model has them, with the last Update's count only while it made the model", () => {
        expect(modelText(true, {state: "completed", edited: 1234})).toBe("The task's model has these edits (1,234 splats removed).");
        expect(modelText(true, {state: "completed", edited: 1})).toBe("The task's model has these edits (1 splat removed).");
        expect(modelText(true, {state: "completed", edited: 0})).toBe("The task's model has these edits (no splat removed).");
        expect(modelText(true, null)).toBe("The task's model has these edits.");
        expect(modelText(true, {state: "failed"})).toBe("The task's model has these edits.");
    });
    test("says nothing when it is not known", () => {
        expect(modelText(null, null)).toBe("");
        expect(modelText(undefined, {state: "completed"})).toBe("");
    });
});

describe("Undo and Redo", () => {
    test("take back a change and bring it back", () => {
        let h = recordChange(newHistory(), ["a"]);
        const undone = undoChange(h, ["a", "b"]);
        expect(undone.edits).toEqual(["a"]);
        const redone = redoChange(undone.history, undone.edits);
        expect(redone.edits).toEqual(["a", "b"]);
        expect(redone.history.redo).toEqual([]);
        expect(undoChange(redone.history, redone.edits).edits).toEqual(["a"]);
    });
    test("a new change clears Redo", () => {
        const undone = undoChange(recordChange(newHistory(), []), ["x"]);
        expect(undone.history.redo.length).toBe(1);
        expect(recordChange(undone.history, []).redo).toEqual([]);
    });
    test("there is nothing to take back or bring back at first", () => {
        expect(undoChange(newHistory(), [])).toBeNull();
        expect(redoChange(newHistory(), [])).toBeNull();
    });
    test("keeps a limited number of steps", () => {
        let h = newHistory();
        for (let i = 0; i < HISTORY_STEPS + 5; i++) h = recordChange(h, [i]);
        expect(h.undo.length).toBe(HISTORY_STEPS);
        expect(h.undo[0]).toEqual([5]);
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

describe("the brush", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const brush = (strokes, aspect = 1, view = identity) => ({type: "brush", strokes, view, aspect});
    const line = {size: 0.6, points: [[-0.2, 0], [0.2, 0]]};

    test("removes what is within its size of a stroke's line on screen, as the server's test does", () => {
        expect(kept([brush([line])])).toEqual([0, 1, 0, 1]);
    });

    test("measures across the screen in the screen's height: a wider screen stretches x", () => {
        expect(kept([brush([line], 2)])).toEqual([0, 1, 1, 1]);
    });

    test("a stroke of one point is a circle", () => {
        expect(kept([brush([{size: 0.1, points: [[3, 0]]}])])).toEqual([1, 0, 1, 1]);
    });

    test("leaves what is behind the camera", () => {
        const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0];
        expect(kept([brush([line], 1, behind)])).toEqual([1, 1, 1, 1]);
    });

    test("the whole view's quick rule removes the same splats as the rule for one splat", () => {
        const n = 3000;
        const rx = new Float32Array(n), ry = new Float32Array(n), rz = new Float32Array(n);
        let seed = 7;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < n; i++){
            rx[i] = random() * 4 - 2;
            ry[i] = random() * 4 - 2;
            rz[i] = random() * 4 + 1;
        }
        const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0.1, -0.2, 0, 0];
        const edit = brush([{size: 0.15, points: [[-0.5, -0.5], [0, 0.1], [0.4, 0.3]]}, {size: 0.05, points: [[0.6, -0.6]]}], 1.5, perspective);
        const mask = keepMask(rx, ry, rz, [edit]);
        let removed = 0;
        for (let i = 0; i < n; i++){
            expect(mask[i]).toBe(insideBrush(edit, rx[i], ry[i], rz[i]) ? 0 : 1);
            removed += 1 - mask[i];
        }
        expect(removed).toBeGreaterThan(50);
    });

    test("is words in the list", () => {
        expect(editLabel(brush([line]))).toBe("Brush, 1 stroke");
        expect(editLabel(brush([line, line]))).toBe("Brush, 2 strokes");
    });

    test("a stroke keeps a point every few pixels and where it let go, its size in half the view's height", () => {
        const points = [[0, 0], [1, 0], [5, 0], [6, 0], [200, 100]];
        expect(brushStroke(points, 200, 100, 20, 3)).toEqual({size: 0.2, points: [[-1, 1], [-0.95, 1], [1, -1]]});
        expect(brushStroke([[100, 50]], 200, 100, 20, 3).points).toEqual([[0, 0]]);
        expect(brushStroke(Array.from({length: 30000}, (_, i) => [i, 0]), 30000, 100, 20, 1).points.length).toBeLessThanOrEqual(MAX_BRUSH_POINTS);
    });

    test("a session's strokes in one view go into one edit; a new session or another view starts another", () => {
        const box = {type: "box", keep: true, center: [0, 0, 0], size: [1, 1, 1], turn: 0};
        const camera = {position: [0, 0, 1], target: [0, 0, 0]};
        let edits = addStroke([box], line, identity, 1, camera, true);
        expect(edits.length).toBe(2);
        edits = addStroke(edits, line, identity.slice(), 1, camera, false);
        expect(edits.length).toBe(2);
        expect(edits[1].strokes.length).toBe(2);
        expect(addStroke(edits, line, identity, 1.5, camera, false).length).toBe(3);
        expect(addStroke(edits, line, identity, 1, camera, true).length).toBe(3);
        expect(edits[0]).toBe(box);
    });

    test("a restore stroke starts an edit of its own after removing ones, and is kept as a restore", () => {
        const camera = {position: [0, 0, 1], target: [0, 0, 0]};
        let edits = addStroke([], line, identity, 1, camera, true);
        expect(edits[0].restore).toBeUndefined();
        edits = addStroke(edits, line, identity, 1, camera, false, true);
        expect(edits.length).toBe(2);
        expect(edits[1].restore).toBe(true);
        expect(addStroke(edits, line, identity, 1, camera, false, true).length).toBe(2);
        expect(addStroke(edits, line, identity, 1, camera, false, false).length).toBe(3);
        expect(editLabel(edits[1])).toBe("Restore Brush, 1 stroke");
    });

    describe("Restore Brush", () => {
        const restore = {...brush([line]), restore: true};  // over splats 0 and 2
        const aroundOrigin = {type: "box", keep: false, center: [0, -0.5, 5], size: [2, 3, 1], turn: 0};  // 0, 2 and 3
        const onlySecond = {type: "box", keep: true, center: [3, 0, 5], size: [1, 1, 1], turn: 0};
        const floaters = {type: "floaters", strength: "medium"};

        test("puts back what the edits before it removed, and nothing an edit after it removes", () => {
            expect(kept([aroundOrigin, restore])).toEqual([1, 1, 1, 0]);
            expect(kept([restore, aroundOrigin])).toEqual([0, 1, 0, 0]);
            expect(kept([onlySecond, restore])).toEqual([1, 1, 1, 0]);
            expect(kept([restore])).toEqual([1, 1, 1, 1]);
        });

        test("puts back floaters listed before it, as the server does", () => {
            expect(Array.from(keepMask(xs, ys, zs, [floaters, restore], null, null, [0, 3]))).toEqual([1, 1, 1, 0]);
            expect(Array.from(keepMask(xs, ys, zs, [restore, floaters], null, null, [0, 3]))).toEqual([0, 1, 1, 0]);
        });

        test("never puts back what the task's boundary hides", () => {
            const base = Uint8Array.from([1, 1, 0, 1]);
            expect(Array.from(keepMask(xs, ys, zs, [aroundOrigin, restore], null, base))).toEqual([1, 1, 0, 0]);
        });
    });
});

describe("floaters", () => {
    const floaters = {type: "floaters", strength: "medium"};

    test("hide the splats the server numbered, with the shapes and the boundary", () => {
        expect(Array.from(keepMask(xs, ys, zs, [floaters], null, null, [1, 3]))).toEqual([1, 0, 1, 0]);
        const removeFirst = {type: "box", keep: false, center: [0, 0, 5], size: [0.2, 0.2, 1], turn: 0};
        expect(Array.from(keepMask(xs, ys, zs, [floaters, removeFirst], null, Uint8Array.from([1, 1, 0, 1]), [3]))).toEqual([0, 1, 0, 0]);
    });

    test("hide nothing before the server has answered, and ignore numbers beyond the model", () => {
        expect(kept([floaters])).toEqual([1, 1, 1, 1]);
        expect(Array.from(keepMask(xs, ys, zs, [floaters], null, null, [-1, 4, 99]))).toEqual([1, 1, 1, 1]);
    });

    test("are the edits' strength, or none", () => {
        expect(floatersStrength([{type: "polygon"}, floaters])).toBe("medium");
        expect(floatersStrength([{type: "polygon"}])).toBeNull();
    });

    test("are words in the list, with how many once known", () => {
        expect(editLabel(floaters)).toBe("Floaters");
        expect(editLabel(floaters, 1638)).toBe("Floaters, 1,638 splats");
        expect(editLabel(floaters, 1)).toBe("Floaters, 1 splat");
    });
});

describe("Colour Adjust", () => {
    const apply = (edit, c) => {
        const { m, t } = colourMatrix({...newColour(), ...edit});
        return [0, 1, 2].map(r => m[3 * r] * c[0] + m[3 * r + 1] * c[1] + m[3 * r + 2] * c[2] + t[r]);
    };
    const close = (got, want) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
    const c = [0.6, 0.3, 0.2];

    test("changes nothing at its start", () => {
        close(apply({}, c), c);
    });

    test("is the same change as the server's on a colour", () => {
        // As test_colour_adjust_changes_the_colours_and_the_light_that_changes_with_the_view in the Django tests
        close(apply({brightness: 1}, c), [0.9, 0.45, 0.3]);
        const grey = 0.2126 * 0.6 + 0.7152 * 0.3 + 0.0722 * 0.2;
        close(apply({saturation: -1}, c), [grey, grey, grey]);
        close(apply({warmth: 1}, c), [0.72, 0.3, 0.16]);
        close(apply({contrast: 1}, c), [0.7, 0.1, -0.1]);
        close(apply({contrast: -1}, c), [0.55, 0.4, 0.35]);
    });

    test("keeps every splat and shows no shape of its own", () => {
        expect(kept([newColour()])).toEqual([1, 1, 1, 1]);
        expect(colourEdit([{type: "floaters", strength: "light"}, {...newColour(), warmth: 0.5}]).warmth).toBe(0.5);
        expect(colourEdit([])).toBeNull();
    });

    test("is named in the list with its sliders away from 0", () => {
        expect(editLabel(newColour())).toBe("Colour Adjust");
        expect(colourText(newColour())).toBe("No change yet");
        expect(colourText({...newColour(), brightness: 0.2, warmth: -0.15})).toBe("Brightness +20, Warmth -15");
    });
});

describe("plyPositions", () => {
    const ascii = text => Uint8Array.from(text, c => c.charCodeAt(0));
    function ply(header, rows){
        const head = ascii(header);
        const body = new Float32Array(rows.flat());
        const bytes = new Uint8Array(head.length + body.byteLength);
        bytes.set(head);
        bytes.set(new Uint8Array(body.buffer), head.length);
        return bytes;
    }
    const HEADER = "ply\nformat binary_little_endian 1.0\ncomment Generated by opensplat at iteration 10\nelement vertex 2\n" +
        "property float x\nproperty float y\nproperty float z\nproperty float opacity\nend_header\n";

    test("reads the positions at full precision, where 16 bits would round them", () => {
        // 1,500 m up: 16 bits keep it to the metre
        const found = plyPositions(ply(HEADER, [[1.25, -2.5, 1500.3, 0.9], [0.1, 0.2, 1500.7, 0.9]]));
        expect(found.count).toBe(2);
        expect(Array.from(found.xs)).toEqual([1.25, 0.10000000149011612]);
        expect(Array.from(found.ys)).toEqual([-2.5, 0.20000000298023224]);
        expect(found.zs[0]).toBeCloseTo(1500.3, 3);
        expect(found.zs[1]).toBeCloseTo(1500.7, 3);
    });

    test("finds the positions wherever they are in a row, within a byte array's view", () => {
        const header = HEADER.replace("property float x\nproperty float y\nproperty float z\nproperty float opacity\n",
            "property float opacity\nproperty uchar flag\nproperty float z\nproperty float y\nproperty float x\n");
        // A row of 17 bytes: opacity, a byte, then z, y and x
        const head = ascii(header);
        const bytes = new Uint8Array(3 + head.length + 34);
        bytes.set(head, 3);
        const data = new DataView(bytes.buffer, 3 + head.length);
        [[0.5, 7, 3, 2, 1], [0.5, 7, 6, 5, 4]].forEach((row, i) => {
            data.setFloat32(i * 17, row[0], true);
            data.setUint8(i * 17 + 4, row[1]);
            data.setFloat32(i * 17 + 5, row[2], true);
            data.setFloat32(i * 17 + 9, row[3], true);
            data.setFloat32(i * 17 + 13, row[4], true);
        });
        const found = plyPositions(bytes.subarray(3));
        expect(Array.from(found.xs)).toEqual([1, 4]);
        expect(Array.from(found.ys)).toEqual([2, 5]);
        expect(Array.from(found.zs)).toEqual([3, 6]);
    });

    test("refuses a file it cannot read as the trainer's .ply", () => {
        expect(() => plyPositions(ascii("not a ply"))).toThrow("not a .ply");
        expect(() => plyPositions(ply(HEADER.replace("binary_little_endian", "ascii"), []))).toThrow("binary little-endian");
        expect(() => plyPositions(ply(HEADER.replace("property float z", "property double z"), [[1, 2, 3, 4]]))).toThrow("no 32-bit z");
        expect(() => plyPositions(ply(HEADER, [[1, 2, 3, 4]]))).toThrow("shorter than its header");
        expect(() => plyPositions(ply(HEADER.replace("element vertex 2", "element face 1\nproperty float a\nelement vertex 2"), [])))
            .toThrow("not its first element");
    });
});

test("a canceled Apply says the task's model is as it was", () => {
    expect(applyText({state: "canceled"})).toBe("Applying the edits was canceled: the task's model is as it was.");
});
