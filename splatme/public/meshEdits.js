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
//   {op: "flatten", ...shape}  the triangles whose centres the shape covers made flat: their vertices moved onto
//                              the plane that best fits the selection's rim (its border with the rest), which
//                              stays where it is; with no rim (a whole piece), the plane of its own vertices
//   {type: "floating", size}   the pieces of surface of fewer than size triangles, all but the largest
// The edits apply in the list's order.
export const OPS = ["delete", "flatten"];
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

// The plane through points that fits them best (least squares): {point: their mean, normal}, or null for fewer than
// 3 or points along a line. points: the surface's vertices, by number in positions
export function fitPlane(positions, vertices){
    const n = vertices.length;
    if (n < 3) return null;
    let cx = 0, cy = 0, cz = 0;
    for (const v of vertices){
        cx += positions[3 * v];
        cy += positions[3 * v + 1];
        cz += positions[3 * v + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    // Their covariance; the normal is its eigenvector of the smallest eigenvalue (Jacobi's rotations)
    const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const v of vertices){
        const d = [positions[3 * v] - cx, positions[3 * v + 1] - cy, positions[3 * v + 2] - cz];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
    }
    const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++){
        const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
        if (off < 1e-15) break;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]){
            if (Math.abs(a[p][q]) < 1e-18) continue;
            const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < 3; k++){
                const akp = a[k][p], akq = a[k][q];
                a[k][p] = c * akp - s * akq;
                a[k][q] = s * akp + c * akq;
            }
            for (let k = 0; k < 3; k++){
                const apk = a[p][k], aqk = a[q][k];
                a[p][k] = c * apk - s * aqk;
                a[q][k] = s * apk + c * aqk;
            }
            for (let k = 0; k < 3; k++){
                const vkp = vectors[k][p], vkq = vectors[k][q];
                vectors[k][p] = c * vkp - s * vkq;
                vectors[k][q] = s * vkp + c * vkq;
            }
        }
    }
    const values = [a[0][0], a[1][1], a[2][2]];
    const sorted = [0, 1, 2].sort((i, j) => values[i] - values[j]);
    if (values[sorted[1]] <= 1e-12 * Math.max(1, values[sorted[2]])) return null;  // along a line
    const i = sorted[0];
    let normal = [vectors[0][i], vectors[1][i], vectors[2][i]];
    if (normal[2] < 0) normal = normal.map(x => -x);  // up, for a level surface
    return {point: [cx, cy, cz], normal};
}

// A selection's triangles flattened: their vertices but those on the selection's rim moved onto the plane fitted to
// the rim (to the selection's own vertices without a rim), along its normal, in positions
function flatten(surface, kept, selected, positions){
    const { faces, count } = surface;
    const n = faces.length / 3;
    const inside = new Uint8Array(count), outside = new Uint8Array(count);
    for (let f = 0; f < n; f++){
        if (!kept[f]) continue;
        const mark = selected[f] ? inside : outside;
        mark[faces[3 * f]] = mark[faces[3 * f + 1]] = mark[faces[3 * f + 2]] = 1;
    }
    const rim = [], moved = [];
    for (let v = 0; v < count; v++){
        if (!inside[v]) continue;
        if (outside[v]) rim.push(v);
        else moved.push(v);
    }
    const plane = fitPlane(positions, rim.length >= 3 ? rim : moved);
    if (!plane) return 0;
    const [px, py, pz] = plane.point, [nx, ny, nz] = plane.normal;
    for (const v of moved){
        const d = (positions[3 * v] - px) * nx + (positions[3 * v + 1] - py) * ny + (positions[3 * v + 2] - pz) * nz;
        positions[3 * v] -= d * nx;
        positions[3 * v + 1] -= d * ny;
        positions[3 * v + 2] -= d * nz;
    }
    return moved.length;
}

// The edits on the surface: {kept: Uint8Array per triangle, positions: the surface's vertices after them (a copy),
// removed: triangles taken out, floating: of them, those Remove Floating Pieces took, flattened: vertices moved}. applyShape: editShapes.js's,
// given so this module imports nothing.
export function applyEdits(surface, edits, applyShape){
    const n = surface.faces.length / 3;
    const kept = new Uint8Array(n).fill(1);
    const positions = Float64Array.from(surface.positions);
    let at = null;  // the triangles' centres, made again when the vertices move
    let floating = 0, flattened = 0;
    for (const edit of edits){
        if (edit.op === "delete"){
            at = at || centres(surface.faces, positions);
            applyShape(at.xs, at.ys, at.zs, edit, kept, null);
        } else if (edit.op === "flatten"){
            at = at || centres(surface.faces, positions);
            // What the shape covers: what removing it would take out (a shape that keeps its inside: the rest)
            const covered = applyShape(at.xs, at.ys, at.zs, {...edit, restore: false}, new Uint8Array(n).fill(1), null);
            for (let f = 0; f < n; f++) covered[f] = covered[f] ? 0 : 1;
            const count = flatten(surface, kept, covered, positions);
            if (count){
                flattened += count;
                at = null;  // the vertices moved
            }
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
    return {kept, positions, removed, floating, flattened};
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
