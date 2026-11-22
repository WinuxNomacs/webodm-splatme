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
