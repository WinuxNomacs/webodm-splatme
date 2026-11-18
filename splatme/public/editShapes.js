// The shapes of the Edit Splats page, as plain functions: which splats they keep (the same rule as edits.py, so
// what the page shows hidden is what Apply cuts), the view's framing, and the words for the list. A plain ES module
// with no imports: the page's 3D view (editor/viewer.js) loads it as the browser's own module, the panel
// (Editor.jsx) through webpack, and Jest tests it.
//
//   box      {type: "box", keep, center: [x, y, z], size: [x, y, z] (whole lengths), turn: degrees about the vertical}
//   polygon  {type: "polygon", keep, ring: [[x, y], ...]} seen from above, all heights
//   keep     true keeps what is inside and removes the rest; false removes what is inside

export const MAX_EDITS = 200;
export const MAX_CORNERS = 2000;
// Above this the page warns before loading the trained model whole (bytes of the .ply)
export const LARGE_MODEL = 400 * 1024 * 1024;

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

export function inside(edit, x, y, z){
    return edit.type === "box" ? insideBox(edit, x, y, z) : insideRing(edit.ring, x, y);
}

// Which splats the edits keep (1) or remove (0), for centres given as three arrays; into out when given
export function keepMask(xs, ys, zs, edits, out){
    const n = xs.length;
    const keep = out || new Uint8Array(n);
    keep.fill(1);
    for (const edit of edits){
        // A polygon's bounding box first: most splats are far from it
        let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
        if (edit.type === "polygon"){
            minX = Math.min(...edit.ring.map(p => p[0]));
            maxX = Math.max(...edit.ring.map(p => p[0]));
            minY = Math.min(...edit.ring.map(p => p[1]));
            maxY = Math.max(...edit.ring.map(p => p[1]));
        }
        for (let i = 0; i < n; i++){
            if (!keep[i]) continue;
            const x = xs[i], y = ys[i];
            const within = x >= minX && x <= maxX && y >= minY && y <= maxY && inside(edit, x, y, zs[i]);
            if (within !== edit.keep) keep[i] = 0;
        }
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

// A new box: over the middle of what the view frames, half its size
export function newBox(frame){
    return {
        type: "box", keep: true, center: frame.center.map(round), turn: 0,
        size: [frame.size[0] / 2, frame.size[1] / 2, frame.size[2] * 1.5].map(round)
    };
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

// The list's words for an edit
export function editLabel(edit){
    if (edit.type === "box"){
        const [x, y, z] = edit.size.map(v => Number(v.toFixed(1)).toLocaleString("en-US"));
        return "Box, " + x + " × " + y + " × " + z + " m";
    }
    return "Polygon, " + edit.ring.length + " corners";
}

// The size of a file in words: "54 MB"
export function sizeText(bytes){
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
    return Math.max(1, Math.round(bytes / 1024 / 1024)) + " MB";
}

// What the panel says of the last Apply Edits, or "" when there is none
export function applyText(apply){
    if (!apply || !apply.state) return "";
    if (apply.state === "applying") return "Applying the edits: " + (apply.status || "starting") + ".";
    if (apply.state === "failed") return "Applying the edits failed: " + (apply.error || "unknown error.");
    if (apply.state === "completed"){
        const removed = apply.edited ? Number(apply.edited).toLocaleString("en-US") + (apply.edited === 1 ? " splat" : " splats") + " removed." : "No splat removed.";
        return "Edits applied. " + removed;
    }
    return "";
}
