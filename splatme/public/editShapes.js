// The shapes of the Edit Splats page, as plain functions: which splats they keep (the same rule as edits.py, so
// what the page shows hidden is what Apply cuts), the view's framing, and the words for the list. A plain ES module
// with no imports: the page's 3D view (editor/viewer.js) loads it as the browser's own module, the panel
// (Editor.jsx) through webpack, and Jest tests it.
//
//   box      {type: "box", keep, center: [x, y, z], size: [x, y, z] (whole lengths), turn: degrees about the vertical}
//   polygon  {type: "polygon", keep, ring: [[x, y], ...]} seen from above, all heights
//   lasso    {type: "lasso", keep, ring: [[x, y], ...] on the screen (-1 to 1), view: the camera's view-projection
//            matrix (16 numbers, column-major), camera: {position, target}}: what is in front of that camera and
//            falls inside the ring, through to the back
//   brush    {type: "brush", strokes: [{size, points: [[x, y], ...]}] on the screen (-1 to 1), view and camera as a
//            lasso's, aspect: the screen's width over its height}, no keep: removes what is in front of that camera
//            within size of a stroke's line, through to the back; distances in half the screen's height (x times
//            aspect first). restore: true (the Restore Brush) puts back what the edits before it removed instead
//   keep     true keeps what is inside and removes the rest; false removes what is inside
//   floaters {type: "floaters", strength: "light" | "medium" | "strong"}, at most one, no keep: the splats far from
//            their neighbours or oversized, which the server finds on the whole model (edits.floaters, the API's
//            task/<id>/floaters) and the page hides by their numbers
//   colour   {type: "colour", brightness, contrast, saturation, warmth} (each -1 to 1, 0 for no change), at most one,
//            no keep: the whole model's colours (colourMatrix, as edits.colour_matrix)

export const MAX_EDITS = 200;
export const MAX_CORNERS = 2000;
export const MAX_STROKES = 500;
export const MAX_BRUSH_POINTS = 20000;
// The Brush's size on the screen, in pixels across its middle
export const BRUSH_SIZES = [5, 100];
// Above this the page warns before loading the trained model whole (bytes of the .ply)
export const LARGE_MODEL = 400 * 1024 * 1024;
export const STRENGTHS = [["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]];
// Colour Adjust's sliders: the edit's field and its name in the panel
export const COLOURS = [["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Saturation"], ["warmth", "Warmth"]];
const LUMA = [0.2126, 0.7152, 0.0722];

export function insideBox(box, x, y, z){
    const turn = box.turn * Math.PI / 180;
    const c = Math.cos(turn), s = Math.sin(turn);
    const dx = x - box.center[0], dy = y - box.center[1];
    // In the box's own axes: turned back by its turn
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    return Math.abs(u) <= box.size[0] / 2 && Math.abs(v) <= box.size[1] / 2 && Math.abs(z - box.center[2]) <= box.size[2] / 2;
}

// The crossing rule of crop.inside: an odd number of the ring's edges crossed going right from the point
export function insideRing(ring, x, y){
    let within = false;
    let [xj, yj] = ring[ring.length - 1];
    for (const [xi, yi] of ring){
        if (yi !== yj && ((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) within = !within;
        xj = xi;
        yj = yi;
    }
    return within;
}

export function insideLasso(lasso, x, y, z){
    const m = lasso.view;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(w > 0)) return false;  // behind the camera a point projects mirrored: never inside
    return insideRing(lasso.ring, (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w);
}

// Where a point is on a lasso's or a brush's screen (-1 to 1), or null behind its camera (it projects mirrored)
function onScreen(view, x, y, z){
    const m = view;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(w > 0)) return null;
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w];
}

// How far (squared) u, v is from the piece of line a to b
function distance2(u, v, ax, ay, bx, by){
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const pu = u - ax, pv = v - ay;
    const t = length > 0 ? Math.min(Math.max((pu * dx + pv * dy) / length, 0), 1) : 0;
    const ex = pu - t * dx, ey = pv - t * dy;
    return ex * ex + ey * ey;
}

// The pieces of a stroke's line, x times aspect: a stroke of one point is a piece from it to itself
function pieces(stroke, aspect){
    const points = stroke.points.map(([x, y]) => [x * aspect, y]);
    if (points.length === 1) return [[points[0], points[0]]];
    return points.slice(1).map((q, i) => [points[i], q]);
}

// Whether a brush paints over a point, as edits.brushed answers for many
export function insideBrush(brush, x, y, z){
    const p = onScreen(brush.view, x, y, z);
    if (!p) return false;
    const u = p[0] * brush.aspect, v = p[1];
    return brush.strokes.some(stroke => pieces(stroke, brush.aspect).some(([a, b]) =>
        distance2(u, v, a[0], a[1], b[0], b[1]) <= stroke.size * stroke.size));
}

// Which splats (of those keep still keeps) a brush paints over, set to 0 in keep: the splats sorted across its
// screen once, so each piece of a stroke looks only at those beside it (edits.brushed's way)
// A brush's strokes on keep: removed under them, or put back for a restore (never what base, the boundary, hides)
function brushOut(brush, xs, ys, zs, keep, base){
    const restore = !!brush.restore;
    const open = i => (restore ? !keep[i] && (!base || base[i]) : keep[i]);
    const us = new Float64Array(xs.length), vs = new Float64Array(xs.length);
    const order = [];
    for (let i = 0; i < xs.length; i++){
        if (!open(i)) continue;
        const p = onScreen(brush.view, xs[i], ys[i], zs[i]);
        if (!p) continue;
        us[i] = p[0] * brush.aspect;
        vs[i] = p[1];
        order.push(i);
    }
    order.sort((a, b) => us[a] - us[b]);
    const across = Float64Array.from(order, i => us[i]);
    // The first of the sorted at or after value
    const firstFrom = value => {
        let lo = 0, hi = across.length;
        while (lo < hi){
            const mid = (lo + hi) >> 1;
            if (across[mid] < value) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    for (const stroke of brush.strokes){
        const r = stroke.size, r2 = r * r;
        for (const [a, b] of pieces(stroke, brush.aspect)){
            const top = Math.max(a[1], b[1]) + r, bottom = Math.min(a[1], b[1]) - r, right = Math.max(a[0], b[0]) + r;
            for (let k = firstFrom(Math.min(a[0], b[0]) - r); k < across.length && across[k] <= right; k++){
                const i = order[k];
                if (!open(i) || vs[i] < bottom || vs[i] > top) continue;
                if (distance2(us[i], vs[i], a[0], a[1], b[0], b[1]) <= r2) keep[i] = restore ? 1 : 0;
            }
        }
    }
}

export function inside(edit, x, y, z){
    if (edit.type === "box") return insideBox(edit, x, y, z);
    if (edit.type === "brush") return insideBrush(edit, x, y, z);
    if (edit.type === "lasso") return insideLasso(edit, x, y, z);
    return insideRing(edit.ring, x, y);
}

// Which of the points are inside one of the polygons, each a list of rings (its outline, then its holes), as
// crop.inside answers for the task's boundary
export function insideShapes(shapes, x, y){
    return shapes.some(rings => rings.reduce((within, ring) => within !== insideRing(ring, x, y), false));
}

// Which splats the task's boundary keeps, for a model trained with Crop to Boundary, or null when it keeps them all,
// or none (then it crops nothing, as on the server)
export function boundaryMask(xs, ys, shapes){
    if (!shapes || !shapes.length) return null;
    const keep = new Uint8Array(xs.length);
    let kept = 0;
    for (let i = 0; i < xs.length; i++){
        if (insideShapes(shapes, xs[i], ys[i])){
            keep[i] = 1;
            kept++;
        }
    }
    return kept === 0 || kept === xs.length ? null : keep;
}

// Which splats the edits keep (1) or remove (0), for centres given as three arrays; into out when given; of those
// base keeps when given (the boundary's); less the splats numbered in floaters when given (the server's answer for
// the edits' floaters)
export function keepMask(xs, ys, zs, edits, out, base, floaters){
    const n = xs.length;
    const keep = out || new Uint8Array(n);
    if (base) keep.set(base);
    else keep.fill(1);
    // In the list's order, as edits.keep_mask: the floaters where their edit is, a restore after what it puts back
    for (const edit of edits){
        if (edit.type === "colour") continue;
        if (edit.type === "floaters"){
            if (floaters) for (const i of floaters) if (i >= 0 && i < n) keep[i] = 0;
            continue;
        }
        applyShape(xs, ys, zs, edit, keep, base);
    }
    return keep;
}

// One shape or brush on keep, in place, as keepMask applies each: a removing shape takes out what it covers, a
// keeping one the rest, a restore puts back what it covers (never what base, the boundary, hides). The model's edits
// (meshEdits.js) apply theirs to the triangles' centres the same way.
export function applyShape(xs, ys, zs, edit, keep, base){
    if (edit.type === "brush"){
        brushOut(edit, xs, ys, zs, keep, base);
        return keep;
    }
    // A polygon's bounding box first: most points are far from it
    let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
    if (edit.type === "polygon"){
        minX = Math.min(...edit.ring.map(p => p[0]));
        maxX = Math.max(...edit.ring.map(p => p[0]));
        minY = Math.min(...edit.ring.map(p => p[1]));
        maxY = Math.max(...edit.ring.map(p => p[1]));
    }
    for (let i = 0; i < xs.length; i++){
        if (!keep[i]) continue;
        const x = xs[i], y = ys[i];
        const within = x >= minX && x <= maxX && y >= minY && y <= maxY && inside(edit, x, y, zs[i]);
        if (within !== edit.keep) keep[i] = 0;
    }
    return keep;
}

function quantile(values, f){
    const sorted = Float64Array.from(values).sort();
    return sorted.length ? sorted[Math.floor(f * (sorted.length - 1))] : 0;
}

// Where to look: the middle 90% of the centres on each axis (floaters far out make the whole extent useless)
export function framing(xs, ys, zs){
    const min = [quantile(xs, 0.05), quantile(ys, 0.05), quantile(zs, 0.05)];
    const max = [quantile(xs, 0.95), quantile(ys, 0.95), quantile(zs, 0.95)];
    return {min, max, center: min.map((v, i) => (v + max[i]) / 2), size: min.map((v, i) => Math.max(max[i] - v, 0.01))};
}

// A new box: over the middle of what the view frames, a third of its width, removing what is inside (a box that
// kept its inside would hide nearly the whole model at once)
export function newBox(frame){
    return {
        type: "box", keep: false, center: frame.center.map(round), turn: 0,
        size: [frame.size[0] / 3, frame.size[1] / 3, frame.size[2] * 1.5].map(round)
    };
}

// Straighten's box from its line: along the line, past each end and to each side by margin, turned to it
export function boxAroundLine(line, margin){
    const [a, b] = line;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const turn = ((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360;
    return {
        type: "box", keep: false, center: [0, 1, 2].map(i => round((a[i] + b[i]) / 2)), turn: round(turn),
        size: [Math.hypot(dx, dy) + 2 * margin, 2 * margin, Math.abs(b[2] - a[2]) + 2 * margin].map(round)
    };
}

// Undo and Redo: the edit lists before each change (undo) and those taken back (redo). A new change clears Redo.
export const HISTORY_STEPS = 200;
export function newHistory(){
    return {undo: [], redo: []};
}
export function recordChange(history, before){
    return {undo: [...history.undo, before].slice(-HISTORY_STEPS), redo: []};
}
// Answers {history, edits} (the edits to show), or null when there is nothing to take back
export function undoChange(history, current){
    if (!history.undo.length) return null;
    return {history: {undo: history.undo.slice(0, -1), redo: [...history.redo, current]}, edits: history.undo[history.undo.length - 1]};
}
export function redoChange(history, current){
    if (!history.redo.length) return null;
    return {history: {undo: [...history.undo, current], redo: history.redo.slice(0, -1)}, edits: history.redo[history.redo.length - 1]};
}

// To the centimetre, which is all a field shows
export function round(v){
    return Math.round(v * 100) / 100;
}

// A ring as kept: without a last corner repeating the first, nor corners repeating the one before
export function cleanRing(ring){
    const out = [];
    for (const p of ring){
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
    }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
}

// The edits' floaters strength, or null when they keep them
export function floatersStrength(edits){
    const edit = edits.find(e => e.type === "floaters");
    return edit ? edit.strength : null;
}

// The edits' Colour Adjust, or null
export function colourEdit(edits){
    return edits.find(e => e.type === "colour") || null;
}

export function newColour(){
    return {type: "colour", brightness: 0, contrast: 0, saturation: 0, warmth: 0};
}

// Colour Adjust as a matrix (rows of red, green, blue) and an offset on a colour (0 to 1): c' = m c + t, the same as
// edits.colour_matrix. Warmth more red and less blue, brightness a gain, saturation away from or towards the
// colour's grey, contrast away from or towards the middle grey
export function colourMatrix(edit){
    const warm = [1 + 0.2 * edit.warmth, 1, 1 - 0.2 * edit.warmth];
    const gain = 1 + 0.5 * edit.brightness, s = 1 + edit.saturation, k = Math.pow(2, edit.contrast);
    const m = [];
    for (let r = 0; r < 3; r++){
        for (let c = 0; c < 3; c++) m.push(k * gain * ((r === c ? s : 0) + (1 - s) * LUMA[c]) * warm[c]);
    }
    const t = 0.5 * (1 - k);
    return {m, t: [t, t, t]};
}

// The list's note for a Colour Adjust: its sliders away from 0, as the panel shows them (-100 to 100)
export function colourText(edit){
    const changed = COLOURS.filter(([name]) => edit[name]).map(([name, label]) => {
        const value = Math.round(edit[name] * 100);
        return label + " " + (value > 0 ? "+" : "") + value;
    });
    return changed.length ? changed.join(", ") : "No change yet";
}

// The list's words for an edit (floaters: with how many splats they are, once known)
export function editLabel(edit, count){
    if (edit.type === "colour") return "Colour Adjust";
    if (edit.type === "floating") return "Floating Pieces";
    if (edit.type === "floaters"){
        return count == null ? "Floaters" : "Floaters, " + Number(count).toLocaleString("en-US") + (count === 1 ? " splat" : " splats");
    }
    if (edit.type === "brush") return (edit.restore ? "Restore Brush, " : "Brush, ") + edit.strokes.length + (edit.strokes.length === 1 ? " stroke" : " strokes");
    if (edit.type === "box"){
        const [x, y, z] = edit.size.map(v => Number(v.toFixed(1)).toLocaleString("en-US"));
        return "Box, " + x + " × " + y + " × " + z + " m";
    }
    return (edit.type === "lasso" ? "Lasso, " : "Polygon, ") + edit.ring.length + " corners";
}

// A freehand stroke as a lasso's ring: a corner only once the pointer has moved minPixels from the last one
// (points in pixels, the ring in -1 to 1 of a view width x height), at most MAX_CORNERS of them
export function strokeRing(points, width, height, minPixels){
    const kept = [];
    for (const p of points){
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minPixels) kept.push(p);
    }
    const step = Math.ceil(kept.length / MAX_CORNERS);
    return kept.filter((_p, i) => i % step === 0).map(([x, y]) => [round4(x / width * 2 - 1), round4(1 - y / height * 2)]);
}

// A brush stroke as kept: its points (pixels of a view width x height) a point only once the pointer has moved
// minPixels from the last one, in -1 to 1 with y up, and its size (pixels across its middle) in half the view's
// height; at most MAX_BRUSH_POINTS points
export function brushStroke(points, width, height, sizePixels, minPixels){
    const kept = [];
    for (const p of points){
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minPixels) kept.push(p);
    }
    // The last point where the pointer let go, so the stroke ends under it
    const end = points[points.length - 1];
    if (kept.length && end !== kept[kept.length - 1]) kept.push(end);
    const step = Math.ceil(kept.length / MAX_BRUSH_POINTS);
    return {
        size: round4(sizePixels / 2 / (height / 2)),
        points: kept.filter((_p, i) => i % step === 0).map(([x, y]) => [round4(x / width * 2 - 1), round4(1 - y / height * 2)])
    };
}

// The stroke added to the Brush session's edit, the last of edits, when it was painted in the same view, removes
// or restores as it does (restore) and has room for it; else a new brush edit after them (the session's first
// stroke: fresh). Answers the edits
export function addStroke(edits, stroke, view, aspect, camera, fresh, restore, op){
    const last = edits[edits.length - 1];
    const same = !fresh && last && last.type === "brush" && !!last.restore === !!restore && last.op === op && last.aspect === aspect && last.view.length === view.length &&
        last.view.every((v, i) => v === view[i]) && last.strokes.length < MAX_STROKES &&
        last.strokes.reduce((n, s) => n + s.points.length, 0) + stroke.points.length <= MAX_BRUSH_POINTS;
    if (same) return [...edits.slice(0, -1), {...last, strokes: [...last.strokes, stroke]}];
    const edit = {type: "brush", strokes: [stroke], view, aspect, camera};
    if (restore) edit.restore = true;
    if (op) edit.op = op;
    return [...edits, edit];
}

function round4(v){
    return Math.round(v * 10000) / 10000;
}

// The size of a file in words: "54 MB"
export function sizeText(bytes){
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
    return Math.max(1, Math.round(bytes / 1024 / 1024)) + " MB";
}

// What the panel says of the last Apply Edits (Update the Model) while it runs, or when it failed or was
// canceled; "" otherwise
export function applyText(apply){
    if (!apply || !apply.state) return "";
    if (apply.state === "applying") return "Applying the edits: " + (apply.status || "starting") + ".";
    if (apply.state === "failed") return "Applying the edits failed: " + (apply.error || "unknown error.");
    if (apply.state === "canceled") return "Applying the edits was canceled: the task's model is as it was.";
    return "";
}

// Whether the task's model has the saved edits (applied: true, false, or null when it is not known, for a model made
// before SplatMe kept it), with the last Update's count while it made the model shown. kind: "splats" (the count
// is apply.edited, in splats) or "model" (the textured model: apply.removed, in triangles)
export function modelText(applied, apply, kind = "splats"){
    if (applied === false) return "The edits changed since the task's model was made: Update the Model for its 3D view, download and share links to show them.";
    if (applied !== true) return "";
    if (apply && apply.state === "completed"){
        const count = kind === "model" ? apply.removed : apply.edited, unit = kind === "model" ? "triangle" : "splat";
        const removed = count ? Number(count).toLocaleString("en-US") + " " + unit + (count === 1 ? "" : "s") + " removed" : "no " + unit + " removed";
        return "The task's model has these edits (" + removed + ").";
    }
    return "The task's model has these edits.";
}

const PLY_TYPES = {char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4,
    int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8};

// The splats' positions read from the trained .ply's bytes (binary little-endian, as the trainer writes it), as Apply
// reads them: 32-bit, where Spark's packed splats keep 16 bits, which is up to a metre out at a few hundred metres up.
// Answers {count, xs, ys, zs}; throws for a file that is not such a .ply.
export function plyPositions(bytes){
    const head = String.fromCharCode.apply(null, bytes.subarray(0, Math.min(bytes.length, 16384)));  // ASCII
    const end = head.indexOf("end_header\n");
    if (!head.startsWith("ply\n") || end < 0) throw new Error("The trained model is not a .ply file.");
    let count = null, stride = 0, element = null;
    const offsets = {};
    for (const line of head.slice(0, end).split("\n")){
        const words = line.trim().split(/\s+/);
        if (words[0] === "format" && words[1] !== "binary_little_endian") throw new Error("The trained model's format is not binary little-endian.");
        if (words[0] === "element"){
            // The vertices first, so their rows start right after the header
            if (element === null && words[1] !== "vertex") throw new Error("The trained model's splats are not its first element.");
            element = words[1];
            if (element === "vertex") count = parseInt(words[2], 10);
        } else if (words[0] === "property" && element === "vertex"){
            const size = PLY_TYPES[words[1]];
            if (!size) throw new Error("The trained model has a property of a type it cannot read: " + words[1] + ".");
            offsets[words[2]] = [stride, words[1]];
            stride += size;
        }
    }
    for (const axis of ["x", "y", "z"]){
        if (!offsets[axis] || offsets[axis][1] !== "float" && offsets[axis][1] !== "float32") throw new Error("The trained model has no 32-bit " + axis + ".");
    }
    const start = end + "end_header\n".length;
    if (!(count >= 0) || bytes.length < start + count * stride) throw new Error("The trained model is shorter than its header says.");
    const data = new DataView(bytes.buffer, bytes.byteOffset + start, count * stride);
    const xs = new Float32Array(count), ys = new Float32Array(count), zs = new Float32Array(count);
    const [ox, oy, oz] = [offsets.x[0], offsets.y[0], offsets.z[0]];
    for (let i = 0, row = 0; i < count; i++, row += stride){
        xs[i] = data.getFloat32(row + ox, true);
        ys[i] = data.getFloat32(row + oy, true);
        zs[i] = data.getFloat32(row + oz, true);
    }
    return {count, xs, ys, zs};
}
