// The rules of a task's model edits (Remove Floating Pieces, Flatten, Fill Holes, Remove Object) on WebODM's
// textured model, as plain functions over typed arrays: the same code makes the editor's preview in the browser and,
// in WebODM's worker, the model Update the Model writes (meshApply.mjs, through Node). A plain ES module with no
// imports, so both load it as it is.
//
// A model is WebODM's GLB as it reads: pieces (one per texture), each with positions (x, y, z in the task's local
// frame, z up), uvs and triangle indices. The pieces share no vertices, and a piece repeats a vertex along its
// texture's seams, so the surface is found by welding positions: weld() gives every corner a surface vertex.

export const WELD = 0.001;  // metres: corners closer than this are one vertex of the surface

// The pieces' corners welded into surface vertices: {vertexOf: Int32Array per piece (its corner's surface vertex),
// count (surface vertices), faces: Int32Array of 3 surface vertices per triangle, pieceOf / localOf: Int32Array per
// triangle (its piece and its number there), positions: Float64Array of the surface vertices}
export function weld(pieces, tolerance = WELD){
    const cells = new Map();
    const positions = [];
    const vertexOf = [];
    let count = 0;
    for (const piece of pieces){
        const p = piece.positions, n = p.length / 3;
        const ids = new Int32Array(n);
        for (let i = 0; i < n; i++){
            const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
            const key = Math.round(x / tolerance) + "," + Math.round(y / tolerance) + "," + Math.round(z / tolerance);
            let id = cells.get(key);
            if (id === undefined){
                id = count++;
                cells.set(key, id);
                positions.push(x, y, z);
            }
            ids[i] = id;
        }
        vertexOf.push(ids);
    }
    let total = 0;
    for (const piece of pieces) total += piece.indices.length / 3;
    const faces = new Int32Array(total * 3), pieceOf = new Int32Array(total), localOf = new Int32Array(total);
    let f = 0;
    pieces.forEach((piece, k) => {
        const idx = piece.indices, ids = vertexOf[k];
        for (let t = 0; t < idx.length / 3; t++, f++){
            faces[3 * f] = ids[idx[3 * t]];
            faces[3 * f + 1] = ids[idx[3 * t + 1]];
            faces[3 * f + 2] = ids[idx[3 * t + 2]];
            pieceOf[f] = k;
            localOf[f] = t;
        }
    });
    return {vertexOf, count, faces, pieceOf, localOf, positions: Float64Array.from(positions)};
}

// The surface's edges that only one kept triangle has (its open edges: the holes' and the model's outer rim), as
// pairs of surface vertices in the direction their triangle goes. kept: Uint8Array per triangle (null: all)
export function openEdges(faces, count, kept){
    const keys = [];
    const n = faces.length / 3;
    for (let f = 0; f < n; f++){
        if (kept && !kept[f]) continue;
        for (let k = 0; k < 3; k++){
            const a = faces[3 * f + k], b = faces[3 * f + (k + 1) % 3];
            if (a === b) continue;
            keys.push(a < b ? a * count + b : b * count + a);
        }
    }
    const sorted = Float64Array.from(keys).sort();
    const single = new Set();
    for (let i = 0; i < sorted.length; i++){
        if ((i === 0 || sorted[i - 1] !== sorted[i]) && (i === sorted.length - 1 || sorted[i + 1] !== sorted[i])) single.add(sorted[i]);
    }
    const edges = [];
    for (let f = 0; f < n; f++){
        if (kept && !kept[f]) continue;
        for (let k = 0; k < 3; k++){
            const a = faces[3 * f + k], b = faces[3 * f + (k + 1) % 3];
            if (a !== b && single.has(a < b ? a * count + b : b * count + a)) edges.push([a, b]);
        }
    }
    return edges;
}

// Open edges chained into loops of surface vertices; edges that do not close a loop (a pinched rim) are dropped
export function loops(edges){
    const next = new Map();
    for (const [a, b] of edges){
        if (!next.has(a)) next.set(a, []);
        next.get(a).push(b);
    }
    const used = new Set();
    const out = [];
    for (const [a0] of edges){
        if (used.has(a0) || !next.has(a0)) continue;
        const ring = [];
        let a = a0, closed = false;
        while (!used.has(a)){
            used.add(a);
            ring.push(a);
            const options = next.get(a) || [];
            const b = options.find(v => !used.has(v) || v === a0);
            if (b === undefined) break;
            if (b === a0){
                closed = true;
                break;
            }
            a = b;
        }
        if (closed && ring.length >= 3) out.push(ring);
    }
    return out;
}

// The triangles in connected pieces of surface (sharing a vertex): Int32Array of a piece number per triangle, and
// each piece's triangle count. kept: as openEdges
export function components(faces, count, kept){
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = i => {
        while (parent[i] !== i){
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const n = faces.length / 3;
    for (let f = 0; f < n; f++){
        if (kept && !kept[f]) continue;
        const a = find(faces[3 * f]), b = find(faces[3 * f + 1]), c = find(faces[3 * f + 2]);
        parent[b] = a;
        parent[find(c)] = a;
    }
    const label = new Int32Array(n).fill(-1);
    const numbers = new Map();
    const sizes = [];
    for (let f = 0; f < n; f++){
        if (kept && !kept[f]) continue;
        const root = find(faces[3 * f]);
        let id = numbers.get(root);
        if (id === undefined){
            id = sizes.length;
            numbers.set(root, id);
            sizes.push(0);
        }
        label[f] = id;
        sizes[id]++;
    }
    return {label, sizes};
}

// A model's edits, kept in the task's local frame as the splats' are (edits.py, meshes.py):
//   {op: "delete", ...shape}   a Box, Polygon, Lasso or Brush shape of editShapes.js, with its keep (a Brush removes,
//                              or with restore puts back what the edits before it removed): on the triangles' centres
//   {type: "floating", size}   the pieces of surface of fewer than size triangles, all but the largest
// The edits apply in the list's order.
export const OPS = ["delete"];
export const MAX_FLOATING = 100000;  // triangles: the largest size Remove Floating Pieces takes

// The triangles' centres from the surface's vertices, as three arrays (the shapes' tests take them so)
export function centres(faces, positions){
    const n = faces.length / 3;
    const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
    for (let f = 0; f < n; f++){
        const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
        xs[f] = (positions[a] + positions[b] + positions[c]) / 3;
        ys[f] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
        zs[f] = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    }
    return {xs, ys, zs};
}

// The edits on the surface: {kept: Uint8Array per triangle, positions: the surface's vertices after them (a copy),
// removed: triangles taken out, floating: of them, those Remove Floating Pieces took}. applyShape: editShapes.js's,
// given so this module imports nothing.
export function applyEdits(surface, edits, applyShape){
    const n = surface.faces.length / 3;
    const kept = new Uint8Array(n).fill(1);
    const positions = Float64Array.from(surface.positions);
    let at = null;  // the triangles' centres, made again when the vertices move
    let floating = 0;
    for (const edit of edits){
        if (edit.op === "delete"){
            at = at || centres(surface.faces, positions);
            applyShape(at.xs, at.ys, at.zs, edit, kept, null);
        } else if (edit.type === "floating"){
            const parts = components(surface.faces, surface.count, kept);
            let largest = -1;
            parts.sizes.forEach((size, i) => { if (largest < 0 || size > parts.sizes[largest]) largest = i; });
            for (let f = 0; f < n; f++){
                const label = parts.label[f];
                if (label >= 0 && label !== largest && parts.sizes[label] < edit.size){
                    kept[f] = 0;
                    floating++;
                }
            }
        }
    }
    let removed = 0;
    for (let f = 0; f < n; f++) if (!kept[f]) removed++;
    return {kept, positions, removed, floating};
}

// The model's pieces after the edits, to draw or to write: for each piece its kept triangles, with the surface's
// vertices after the edits for its corners (a vertex moved moves every corner welded to it) and its own uvs, the
// corners no kept triangle uses left out: [{piece: its number, positions: Float32Array, uvs: Float32Array or null,
// indices: Uint32Array}]
export function editedPieces(pieces, surface, result){
    const triangles = pieces.map(() => []);
    for (let f = 0; f < result.kept.length; f++) if (result.kept[f]) triangles[surface.pieceOf[f]].push(surface.localOf[f]);
    return pieces.map((piece, k) => {
        const idx = piece.indices, ids = surface.vertexOf[k];
        const corners = piece.positions.length / 3;
        const newIndex = new Int32Array(corners).fill(-1);
        let used = 0;
        const indices = new Uint32Array(triangles[k].length * 3);
        triangles[k].forEach((t, j) => {
            for (let c = 0; c < 3; c++){
                const corner = idx[3 * t + c];
                if (newIndex[corner] < 0) newIndex[corner] = used++;
                indices[3 * j + c] = newIndex[corner];
            }
        });
        const positions = new Float32Array(used * 3), uvs = piece.uvs ? new Float32Array(used * 2) : null;
        for (let corner = 0; corner < corners; corner++){
            const i = newIndex[corner];
            if (i < 0) continue;
            const v = 3 * ids[corner];
            positions[3 * i] = result.positions[v];
            positions[3 * i + 1] = result.positions[v + 1];
            positions[3 * i + 2] = result.positions[v + 2];
            if (uvs){
                uvs[2 * i] = piece.uvs[2 * corner];
                uvs[2 * i + 1] = piece.uvs[2 * corner + 1];
            }
        }
        return {piece: k, positions, uvs, indices};
    });
}
