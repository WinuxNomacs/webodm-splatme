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
// pairs of surface vertices in the direction their triangle goes, with that triangle: [a, b, triangle]. kept:
// Uint8Array per triangle (null: all)
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
            if (a !== b && single.has(a < b ? a * count + b : b * count + a)) edges.push([a, b, f]);
        }
    }
    return edges;
}

// Open edges chained into loops of surface vertices, each turned the way most of its edges go (a mesh's triangles
// do not always all turn the same way). A rim that touches itself at a vertex (pinched) gives a loop on each side of
// it; edges that close no loop are dropped.
export function loops(edges){
    const ends = new Map(), forward = new Map();
    edges.forEach(([a, b], i) => {
        for (const v of [a, b]){
            if (!ends.has(v)) ends.set(v, []);
            ends.get(v).push(i);
        }
        if (!forward.has(a)) forward.set(a, new Set());
        forward.get(a).add(b);
    });
    const used = new Uint8Array(edges.length);
    const nextFrom = v => {
        const list = ends.get(v);
        while (list && list.length){
            const e = list.pop();
            if (!used[e]) return e;
        }
        return -1;
    };
    const out = [];
    const emit = ring => {
        let along = 0;
        for (let i = 0; i < ring.length; i++){
            const next = forward.get(ring[i]);
            if (next && next.has(ring[(i + 1) % ring.length])) along++;
        }
        out.push(2 * along >= ring.length ? ring : ring.reverse());
    };
    for (let i = 0; i < edges.length; i++){
        if (used[i]) continue;
        // A walk along unused edges: each time it comes back to a vertex on it, the loop since is cut off; at a
        // dead end it steps back
        const path = [edges[i][0]], at = new Map([[edges[i][0], 0]]);
        let e = i;
        for (;;){
            if (e < 0){
                if (path.length <= 1) break;
                at.delete(path.pop());
                e = nextFrom(path[path.length - 1]);
                continue;
            }
            used[e] = 1;
            const here = path[path.length - 1], [a, b] = edges[e], w = a === here ? b : a;
            const s = at.get(w);
            if (s !== undefined){
                const ring = path.slice(s);
                for (let k = s + 1; k < path.length; k++) at.delete(path[k]);
                path.length = s + 1;
                if (ring.length >= 3) emit(ring);
            } else {
                at.set(w, path.length);
                path.push(w);
            }
            e = nextFrom(path[path.length - 1]);
        }
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
//   {op: "object", ...shape}   Remove Object: the triangles whose centres the shape covers removed, then the holes
//                              that leaves filled
//   {op: "move", ...shape, offset: [x, y, z], scale: [x, y, z], soft: metres}
//                              the vertices of the triangles the shape covers scaled about their middle and moved;
//                              those within soft metres of them moved part of the way (less the farther), so the
//                              surface stretches instead of tearing
//   {type: "straighten", line: [[x, y, z], [x, y, z]], strength, reach}
//                              the kept surface's vertices within reach metres of the line pulled toward it,
//                              strength (0 to 1) of the way at the line, fading to nothing at reach: an edge made
//                              straight
//   {type: "paint", op, strokes: [{points: [[x, y, z], ...], radius: metres, view: [x, y, z]}], ...}
//                              the surface brush: each stroke covers the triangles whose centres are within radius
//                              of its path and that face view (toward where it was painted from: never the back
//                              of the model); op is one of PAINT_OPS: "delete" and "restore" (remove, or put back
//                              what the edits before removed), "smooth" (passes a stroke), "flatten", "raise"
//                              (amount metres a stroke along the covered surface's normal, fading to nothing at the
//                              radius; less than 0 lowers), "fill" (the holes whose whole rim the strokes cover,
//                              textured from beside them) and "clone" (source and target [x, y, z], normal at the
//                              target, feather: what the strokes cover textured from the surface at the offset from
//                              target to source, the holes under them filled with it; after all the edits)
//   {type: "floating", size}   the pieces of surface of fewer than size triangles, all but the largest
//   {type: "holes", size}      Fill Holes: every hole of at most size edges filled
// A hole is a loop of open edges that goes round as a hole's do, not as a piece's outer rim (holes); a fill is triangles
// between its rim's vertices (fillHole), coloured from around the rim (fillColours, fillAtlas). The edits apply in
// the list's order: a fill's triangles close their hole for the edits after it.
export const OPS = ["delete", "object", "move"];  // the shapes' ops
export const MAX_FLOATING = 100000;  // triangles: the largest size Remove Floating Pieces takes
export const MAX_HOLE = 5000;  // edges: no hole longer is filled

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
    const { count } = surface;
    const { inside, outside } = sides(surface, kept, selected);
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

// A polygon's triangles by ear clipping: xs, ys its corners in order; triangles as corner numbers, each going the
// polygon's way round. A polygon that crosses itself still gets triangles (the corner that is no ear clipped anyway).
export function earClip(xs, ys){
    const n = xs.length;
    let area = 0;
    for (let i = 0; i < n; i++){
        const j = (i + 1) % n;
        area += xs[i] * ys[j] - xs[j] * ys[i];
    }
    const sign = area < 0 ? -1 : 1;
    const left = Array.from({length: n}, (_v, i) => i);
    const out = [];
    const cross = (a, b, c) => ((xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a])) * sign;
    let i = 0, misses = 0;
    while (left.length > 3){
        const m = left.length;
        i %= m;
        const a = left[(i + m - 1) % m], b = left[i], c = left[(i + 1) % m];
        let ear = cross(a, b, c) > 0;
        for (let k = 0; ear && k < m; k++){
            const p = left[k];
            if (p === a || p === b || p === c) continue;
            if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) ear = false;
        }
        if (ear || misses >= m){
            out.push(a, b, c);
            left.splice(i, 1);
            misses = 0;
        } else {
            i++;
            misses++;
        }
    }
    out.push(left[0], left[1], left[2]);
    return out;
}

// A hole's fill: its rim (surface vertices, in the direction its open edges go) the other way round, as the
// triangles beside it go, and triangles between them, made on the rim's plane. null for a rim along a line.
export function fillHole(positions, rim){
    const ring = Int32Array.from(rim).reverse();
    const plane = fitPlane(positions, ring);
    if (!plane) return null;
    const [nx, ny, nz] = plane.normal;
    // Two directions across the plane
    const ux0 = Math.abs(nx) < 0.9 ? 1 : 0, uy0 = ux0 ? 0 : 1;
    let ux = uy0 * nz, uy = -ux0 * nz, uz = ux0 * ny - uy0 * nx;
    const length = Math.hypot(ux, uy, uz);
    ux /= length;
    uy /= length;
    uz /= length;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const xs = new Float64Array(ring.length), ys = new Float64Array(ring.length);
    ring.forEach((v, i) => {
        const dx = positions[3 * v] - plane.point[0], dy = positions[3 * v + 1] - plane.point[1], dz = positions[3 * v + 2] - plane.point[2];
        xs[i] = dx * ux + dy * uy + dz * uz;
        ys[i] = dx * vx + dy * vy + dz * vz;
    });
    let mx = 0, my = 0;
    for (let i = 0; i < xs.length; i++){
        mx += xs[i] / xs.length;
        my += ys[i] / xs.length;
    }
    let radius = 0;
    for (let i = 0; i < xs.length; i++) radius = Math.max(radius, Math.hypot(xs[i] - mx, ys[i] - my));
    return {ring, triangles: Int32Array.from(earClip(xs, ys)), xs, ys, radius, plane};
}

// The holes of the kept surface and the fills so far: [{rim: surface vertices}]. A loop of open edges is a hole when
// it turns clockwise around the surface beside it (seen from the side its triangles face), as a hole's edges go; a
// piece's outer rim turns the other way.
// near (optional, a Uint8Array per vertex): only the holes whose rim is all near vertices, found from the edges
// between them (the same holes there as without it, without going over every edge of the model); and a loop there
// is a hole whichever way it turns when the surface beside it goes on past the near vertices (a piece's outer rim
// encloses the piece: one whose rim is all near lies there too). Real holes are often long and thin, chains of
// specks joined by slits, their rims so crumpled that they turn as an outer rim does. small (metres): a loop no
// wider is a hole whichever way it turns (where a rim pinches at a vertex, the loops it is cut into do not always
// turn as a hole's do)
function holes(surface, kept, fills, positions, near = null, small = 0){
    const { faces, count } = surface;
    let all = faces, keep = kept;
    const extra = fills.reduce((sum, fill) => sum + fill.triangles.length, 0);
    if (extra){
        all = new Int32Array(faces.length + extra);
        all.set(faces);
        keep = new Uint8Array(all.length / 3).fill(1);
        keep.set(kept);
        let at = faces.length;
        for (const fill of fills) for (const t of fill.triangles) all[at++] = fill.ring[t];
    }
    if (near){
        const touching = new Uint8Array(all.length / 3);
        for (let f = 0; f < touching.length; f++) touching[f] = keep[f] && (near[all[3 * f]] || near[all[3 * f + 1]] || near[all[3 * f + 2]]) ? 1 : 0;
        keep = touching;
    }
    let edges = openEdges(all, count, keep);
    if (near) edges = edges.filter(([a, b]) => near[a] && near[b]);
    // With near: which pieces of the surface there go on past it (have a triangle with a corner not near)
    let pieces = null, beyond = null;
    if (near){
        pieces = components(all, count, keep);
        beyond = new Uint8Array(pieces.sizes.length);
        for (let f = 0; f < keep.length; f++){
            if (keep[f] && !(near[all[3 * f]] && near[all[3 * f + 1]] && near[all[3 * f + 2]])) beyond[pieces.label[f]] = 1;
        }
    }
    const faceOf = new Map();
    for (const [a, b, f] of edges){
        faceOf.set(a * count + b, f);
        faceOf.set(b * count + a, f);
    }
    const p = positions;
    // A loop at most small metres across (its box's diagonal)
    const within = rim => {
        if (!small) return false;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const v of rim) for (let i = 0; i < 3; i++){
            lo[i] = Math.min(lo[i], p[3 * v + i]);
            hi[i] = Math.max(hi[i], p[3 * v + i]);
        }
        return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) <= small;
    };
    return loops(edges).filter(rim => {
        if (within(rim)) return true;
        if (beyond && beyond[pieces.label[faceOf.get(rim[0] * count + rim[1])]]) return true;
        // The loop's vector area, and the normals of the triangles along it (by their area)
        let ax = 0, ay = 0, az = 0, nx = 0, ny = 0, nz = 0;
        const o = 3 * rim[0];
        for (let i = 0; i < rim.length; i++){
            const a = rim[i], b = rim[(i + 1) % rim.length];
            const x1 = p[3 * a] - p[o], y1 = p[3 * a + 1] - p[o + 1], z1 = p[3 * a + 2] - p[o + 2];
            const x2 = p[3 * b] - p[o], y2 = p[3 * b + 1] - p[o + 1], z2 = p[3 * b + 2] - p[o + 2];
            ax += y1 * z2 - z1 * y2;
            ay += z1 * x2 - x1 * z2;
            az += x1 * y2 - y1 * x2;
            const f = faceOf.get(a * count + b);
            if (f === undefined) continue;
            const i0 = 3 * all[3 * f], i1 = 3 * all[3 * f + 1], i2 = 3 * all[3 * f + 2];
            const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2];
            const vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
            nx += uy * vz - uz * vy;
            ny += uz * vx - ux * vz;
            nz += ux * vy - uy * vx;
        }
        return ax * nx + ay * ny + az * nz < 0;
    }).map(rim => ({rim}));
}

// The vertices of the kept triangles selected (a Uint8Array per vertex), and of the kept ones not selected
function sides(surface, kept, selected){
    const { faces, count } = surface;
    const inside = new Uint8Array(count), outside = new Uint8Array(count);
    for (let f = 0; f < faces.length / 3; f++){
        if (!kept[f]) continue;
        const mark = selected[f] ? inside : outside;
        mark[faces[3 * f]] = mark[faces[3 * f + 1]] = mark[faces[3 * f + 2]] = 1;
    }
    return {inside, outside};
}

// Move: the selection's vertices scaled about their middle and moved, those within the soft edge part of the way;
// the vertices moved
function move(surface, kept, selected, positions, edit){
    const { inside, outside } = sides(surface, kept, selected);
    const count = surface.count, p = positions;
    const list = [];
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < count; v++){
        if (!inside[v]) continue;
        list.push(v);
        cx += p[3 * v];
        cy += p[3 * v + 1];
        cz += p[3 * v + 2];
    }
    if (!list.length) return 0;
    cx /= list.length;
    cy /= list.length;
    cz /= list.length;
    const [ox, oy, oz] = edit.offset, [sx, sy, sz] = edit.scale, soft = edit.soft;
    const target = v => [cx + (p[3 * v] - cx) * sx + ox, cy + (p[3 * v + 1] - cy) * sy + oy, cz + (p[3 * v + 2] - cz) * sz + oz];
    // The soft edge: each vertex outside within soft of one inside, weighted by how near; the inside's as they were
    const weights = new Map();
    if (soft > 0){
        const key = (x, y, z) => x + "," + y + "," + z;
        const cells = new Map();
        for (const v of list){
            const k = key(Math.floor(p[3 * v] / soft), Math.floor(p[3 * v + 1] / soft), Math.floor(p[3 * v + 2] / soft));
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(v);
        }
        // Only the vertices within soft of the selection's bounds can be within soft of it
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const v of list) for (let i = 0; i < 3; i++){
            lo[i] = Math.min(lo[i], p[3 * v + i] - soft);
            hi[i] = Math.max(hi[i], p[3 * v + i] + soft);
        }
        for (let v = 0; v < count; v++){
            if (inside[v] || !outside[v]) continue;
            const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
            if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
            const gx = Math.floor(x / soft), gy = Math.floor(y / soft), gz = Math.floor(z / soft);
            let best = soft * soft;
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++){
                const near = cells.get(key(gx + i, gy + j, gz + k));
                if (!near) continue;
                for (const u of near){
                    const d = (p[3 * u] - x) ** 2 + (p[3 * u + 1] - y) ** 2 + (p[3 * u + 2] - z) ** 2;
                    if (d < best) best = d;
                }
            }
            if (best < soft * soft){
                const t = 1 - Math.sqrt(best) / soft;
                weights.set(v, t * t * (3 - 2 * t));
            }
        }
    }
    const moves = [];
    for (const v of list) moves.push([v, 1]);
    for (const [v, w] of weights) moves.push([v, w]);
    const out = moves.map(([v, w]) => {
        const t = target(v);
        return [v, p[3 * v] + (t[0] - p[3 * v]) * w, p[3 * v + 1] + (t[1] - p[3 * v + 1]) * w, p[3 * v + 2] + (t[2] - p[3 * v + 2]) * w];
    });
    let moved = 0;
    for (const [v, x, y, z] of out){
        if (x === p[3 * v] && y === p[3 * v + 1] && z === p[3 * v + 2]) continue;  // a step back to nothing moves none
        p[3 * v] = x;
        p[3 * v + 1] = y;
        p[3 * v + 2] = z;
        moved++;
    }
    return moved;
}

// Smooth: the selection's vertices but its rim moved halfway toward their neighbours' middle, passes times; the
// vertices moved
function smooth(surface, kept, selected, positions, passes){
    const { faces, count } = surface;
    const { inside, outside } = sides(surface, kept, selected);
    const free = new Uint8Array(count);
    let moved = 0;
    for (let v = 0; v < count; v++){
        if (inside[v] && !outside[v]){
            free[v] = 1;
            moved++;
        }
    }
    if (!moved) return 0;
    // Each free vertex's neighbours, along the kept triangles' edges (CSR)
    const start = new Int32Array(count + 1);
    const n = faces.length / 3;
    for (let f = 0; f < n; f++){
        if (!kept[f]) continue;
        for (let k = 0; k < 3; k++){
            const a = faces[3 * f + k];
            if (free[a]) start[a + 1] += 2;
        }
    }
    for (let v = 0; v < count; v++) start[v + 1] += start[v];
    const next = start.slice(0, count), around = new Int32Array(start[count]);
    for (let f = 0; f < n; f++){
        if (!kept[f]) continue;
        for (let k = 0; k < 3; k++){
            const a = faces[3 * f + k];
            if (!free[a]) continue;
            around[next[a]++] = faces[3 * f + (k + 1) % 3];
            around[next[a]++] = faces[3 * f + (k + 2) % 3];
        }
    }
    const list = [];
    for (let v = 0; v < count; v++) if (free[v]) list.push(v);
    const fresh = new Float64Array(list.length * 3);
    for (let pass = 0; pass < passes; pass++){
        list.forEach((v, i) => {
            let x = 0, y = 0, z = 0;
            const m = start[v + 1] - start[v];
            for (let j = start[v]; j < start[v + 1]; j++){
                const u = around[j];
                x += positions[3 * u];
                y += positions[3 * u + 1];
                z += positions[3 * u + 2];
            }
            fresh[3 * i] = (positions[3 * v] + x / m) / 2;
            fresh[3 * i + 1] = (positions[3 * v + 1] + y / m) / 2;
            fresh[3 * i + 2] = (positions[3 * v + 2] + z / m) / 2;
        });
        list.forEach((v, i) => {
            positions[3 * v] = fresh[3 * i];
            positions[3 * v + 1] = fresh[3 * i + 1];
            positions[3 * v + 2] = fresh[3 * i + 2];
        });
    }
    return moved;
}

// Straighten: the kept surface's vertices within reach of the line pulled toward it, less the farther; the vertices
// moved
function straighten(surface, kept, positions, edit){
    const used = new Uint8Array(surface.count), { faces } = surface;
    for (let f = 0; f < kept.length; f++) if (kept[f]) used[faces[3 * f]] = used[faces[3 * f + 1]] = used[faces[3 * f + 2]] = 1;
    const [a, b] = edit.line, { strength, reach } = edit;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length2 = dx * dx + dy * dy + dz * dz;
    let moved = 0;
    for (let v = 0; v < surface.count; v++){
        if (!used[v]) continue;
        const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2];
        const t = length2 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / length2)) : 0;
        const qx = a[0] + t * dx, qy = a[1] + t * dy, qz = a[2] + t * dz;
        const d = Math.hypot(px - qx, py - qy, pz - qz);
        if (d >= reach || d < 1e-9) continue;  // on the line: nothing to move
        const s = 1 - d / reach, w = strength * s * s * (3 - 2 * s);
        if (!w) continue;
        positions[3 * v] += (qx - px) * w;
        positions[3 * v + 1] += (qy - py) * w;
        positions[3 * v + 2] += (qz - pz) * w;
        moved++;
    }
    return moved;
}

// The edits on the surface: {kept: Uint8Array per triangle, positions: the surface's vertices after them (a copy),
// removed: triangles taken out, floating: of them, those Remove Floating Pieces took, flattened: vertices moved,
// fills: the holes filled, as fillHole gives them, added: their triangles, moved: vertices Flatten, Move and Smooth
// moved}. applyShape: editShapes.js's,
// given so this module imports nothing.
export function applyEdits(surface, edits, applyShape){
    const state = startEdits(surface);
    for (const edit of edits) applyEdit(surface, state, edit, applyShape);
    return finishEdits(surface, state);
}

// The surface brush (paint edits)
export const PAINT_OPS = ["delete", "restore", "fill", "clone", "smooth", "flatten", "raise"];
const PAINT_CELL = 0.25;  // metres: the cells the triangles are found through, by where their centres were
const PAINT_FAR = 2;  // metres: past this, the vertices moved too far for the grid; the triangles are all looked at

// The triangles by where their centres are before any edit, in PAINT_CELL cells: made once a surface
const paintGrids = new WeakMap();
function paintGrid(surface){
    if (!paintGrids.has(surface)){
        const at = centres(surface.faces, surface.positions), lists = new Map();
        for (let f = 0; f < at.xs.length; f++){
            const key = Math.floor(at.xs[f] / PAINT_CELL) + "," + Math.floor(at.ys[f] / PAINT_CELL) + "," + Math.floor(at.zs[f] / PAINT_CELL);
            let list = lists.get(key);
            if (!list) lists.set(key, list = []);
            list.push(f);
        }
        const cells = new Map();
        for (const [key, list] of lists) cells.set(key, Int32Array.from(list));
        paintGrids.set(surface, cells);
    }
    return paintGrids.get(surface);
}

// The squared distance from a point to a segment
function segment2(px, py, pz, a, b){
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length2 = dx * dx + dy * dy + dz * dz;
    const t = length2 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / length2)) : 0;
    const x = a[0] + t * dx - px, y = a[1] + t * dy - py, z = a[2] + t * dz - pz;
    return x * x + y * y + z * z;
}
// A stroke's path as segments (a dab: one point, a segment of no length)
function strokeSegments(stroke){
    const p = stroke.points;
    if (p.length === 1) return [[p[0], p[0]]];
    const out = [];
    for (let i = 1; i < p.length; i++) out.push([p[i - 1], p[i]]);
    return out;
}
// The squared distance from a point to a stroke's path
function stroke2(stroke, x, y, z){
    let best = Infinity;
    for (const [a, b] of strokeSegments(stroke)) best = Math.min(best, segment2(x, y, z, a, b));
    return best;
}

// The triangles a stroke covers: their centres (where they are now) within its radius of its path, facing its view.
// near (optional, a Uint8Array per vertex): the vertices within its radius of its path marked too, whichever way
// their triangles face
export function strokeFaces(surface, state, stroke, near = null){
    const { faces } = surface, p = state.positions, r = stroke.radius, n = faces.length / 3;
    const seen = new Uint8Array(n), out = [];
    const [vx, vy, vz] = stroke.view;
    const consider = f => {
        if (seen[f]) return;
        seen[f] = 1;
        const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
        if (near) for (const v of [a, b, c]) if (!near[v / 3] && stroke2(stroke, p[v], p[v + 1], p[v + 2]) <= r * r) near[v / 3] = 1;
        const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
        if (stroke2(stroke, cx, cy, cz) > r * r) return;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
        if ((uy * wz - uz * wy) * vx + (uz * wx - ux * wz) * vy + (ux * wy - uy * wx) * vz <= 0) return;  // faces away
        out.push(f);
    };
    if (state.shift > PAINT_FAR){
        for (let f = 0; f < n; f++) consider(f);
    } else {
        const cells = paintGrid(surface), reach = r + state.shift + (near ? PAINT_CELL : 0);
        for (const [a, b] of strokeSegments(stroke)){
            const lo = [0, 1, 2].map(i => Math.floor((Math.min(a[i], b[i]) - reach) / PAINT_CELL));
            const hi = [0, 1, 2].map(i => Math.floor((Math.max(a[i], b[i]) + reach) / PAINT_CELL));
            for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++){
                const list = cells.get(x + "," + y + "," + z);
                if (list) for (const f of list) consider(f);
            }
        }
    }
    return Int32Array.from(out);
}

// The paint grid as faceGrid's near(point, reach, visit), its cells widened by how far the vertices moved; null (all
// the triangles looked at) once they moved too far for it
function sourceGrid(surface, state){
    if (state.shift > PAINT_FAR) return null;
    const cells = paintGrid(surface);
    return {
        near(point, reach, visit){
            const lo = point.map(t => Math.floor((t - reach - state.shift) / PAINT_CELL)), hi = point.map(t => Math.floor((t + reach + state.shift) / PAINT_CELL));
            for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++){
                const list = cells.get(x + "," + y + "," + z);
                if (list) for (const f of list) visit(f);
            }
        }
    };
}

// After vertices moved: the centres are made again when next needed, and how far any vertex now is from where it was
function movedNow(surface, state){
    state.at = null;
    const p = state.positions, q = surface.positions;
    let most = 0;
    for (let i = 0; i < p.length; i += 3) most = Math.max(most, (p[i] - q[i]) ** 2 + (p[i + 1] - q[i + 1]) ** 2 + (p[i + 2] - q[i + 2]) ** 2);
    state.shift = Math.sqrt(most);
}

// Raise (or lower): the stroke's triangles' vertices moved amount along their mean normal (facing the view), the
// most on the path, fading to nothing at the radius; the vertices moved
function raise(surface, state, stroke, covered, amount){
    const { faces } = surface, p = state.positions, r = stroke.radius;
    let nx = 0, ny = 0, nz = 0;
    const vertices = new Set();
    for (const f of covered){
        const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
        nx += uy * wz - uz * wy;
        ny += uz * wx - ux * wz;
        nz += ux * wy - uy * wx;
        for (let k = 0; k < 3; k++) vertices.add(faces[3 * f + k]);
    }
    const length = Math.hypot(nx, ny, nz);
    if (!length) return 0;
    const [vx, vy, vz] = stroke.view, sign = nx * vx + ny * vy + nz * vz < 0 ? -1 : 1;
    nx *= sign / length;
    ny *= sign / length;
    nz *= sign / length;
    let moved = 0;
    for (const v of vertices){
        const d = Math.sqrt(stroke2(stroke, p[3 * v], p[3 * v + 1], p[3 * v + 2]));
        if (d >= r) continue;
        const t = 1 - d / r, w = amount * t * t * (3 - 2 * t);
        p[3 * v] += nx * w;
        p[3 * v + 1] += ny * w;
        p[3 * v + 2] += nz * w;
        moved++;
    }
    return moved;
}

export const PAINT_PASSES = 3;  // Smooth's passes a stroke, unless the edit gives its own
export const CLONE_FEATHER = 0.02;  // metres: the clone brush's blend at its edge, unless the edit gives its own
const PAINT_SPECK = 0.5;  // metres: a loop under the paint this wide or less is filled whichever way it turns (holes)
const CLONE_PIECE = 3;  // brush radii: the side of the cubes a Clone stroke is cut into, each a clone of its own
const CLONE_PIECES = [0.5, 4];  // metres: those cubes' side, at least and at most

// A paint edit on the state: each stroke's triangles removed, put back, smoothed, flattened or raised; or, for
// fill and clone, all the strokes' triangles and the holes they cover. fill(holes): applyEdit's.
function paint(surface, state, edit, fill){
    const { kept, positions, n } = state;
    const op = edit.op, union = new Uint8Array(n), strokeFaceLists = [];
    const painted = op === "fill" || op === "clone" ? new Uint8Array(surface.count) : null;  // within the radius
    for (const stroke of edit.strokes){
        const covered = strokeFaces(surface, state, stroke, painted);
        strokeFaceLists.push(covered);
        if (op === "delete" || op === "restore"){
            for (const f of covered) kept[f] = op === "restore" ? 1 : 0;
        } else if (op === "smooth" || op === "flatten" || op === "raise"){
            const mask = new Uint8Array(n);
            for (const f of covered) mask[f] = 1;
            const count = op === "smooth" ? smooth(surface, kept, mask, positions, edit.passes || PAINT_PASSES) :
                op === "flatten" ? flatten(surface, kept, mask, positions) : raise(surface, state, stroke, covered, edit.amount);
            if (count){
                if (op === "flatten") state.flattened += count;
                state.moved += count;
                movedNow(surface, state);
            }
        } else for (const f of covered) union[f] = 1;
    }
    if (op !== "fill" && op !== "clone") return;
    // The holes whose whole rim is within the strokes' radius and that a triangle the strokes cover (one facing them)
    // borders: around a hole the surface is often crumpled, its far side's triangles facing away, yet the hole is
    // under the paint (and one with no triangle facing the strokes is behind the surface, not under the paint).
    // Small loops are holes whichever way they turn (holes's small): a speck under the brush is filled; so is a long
    // thin hole in surface that goes on past the paint (holes's near)
    const touched = new Uint8Array(surface.count);
    for (let f = 0; f < n; f++) if (union[f]) for (let k = 0; k < 3; k++) touched[surface.faces[3 * f + k]] = 1;
    const small = Math.min(PAINT_SPECK, ...edit.strokes.map(stroke => stroke.radius));
    const before = state.fills.length;
    fill(holes(surface, kept, state.fills, positions, painted, small).filter(hole => hole.rim.every(v => painted[v]) && hole.rim.some(v => touched[v])));
    for (let i = before; i < state.fills.length; i++) state.fillDetail[i] = true;
    if (op === "fill") return;
    // Clone: clones of the surface at the offset from target to source, each over a piece of a stroke (a cube of
    // CLONE_PIECE radii), its patch's middle at the piece's middle and that much off at the source, all in the frame
    // of the source picked: the pieces' textures are one texture where they meet, each is made once, and a long
    // stroke's patches and textures stay as small as the brush (one clone for a whole stroke would need a patch as
    // wide as the stroke is long)
    const offset = [0, 1, 2].map(i => edit.source[i] - edit.target[i]);
    const picked = cloneSource(surface, positions, kept, {source: edit.source, patch: 1});
    if (!picked) return;
    const at = centres(surface.faces, positions);
    const feather = edit.feather === undefined ? CLONE_FEATHER : edit.feather;
    const strokeClones = [];
    edit.strokes.forEach((stroke, k) => {
        const side = Math.min(CLONE_PIECES[1], Math.max(CLONE_PIECES[0], CLONE_PIECE * stroke.radius));
        const pieces = new Map();
        for (const f of strokeFaceLists[k]){
            const key = Math.floor(at.xs[f] / side) + "," + Math.floor(at.ys[f] / side) + "," + Math.floor(at.zs[f] / side);
            if (!pieces.has(key)) pieces.set(key, []);
            pieces.get(key).push(f);
        }
        for (const list of pieces.values()){
            const faces = Int32Array.from(list);
            const middle = [at.xs, at.ys, at.zs].map(xs => faces.reduce((sum, f) => sum + xs[f], 0) / faces.length);
            let far = 0;
            for (const f of faces){
                for (let c = 0; c < 3; c++){
                    const v = 3 * surface.faces[3 * f + c];
                    far = Math.max(far, Math.hypot(positions[v] - middle[0], positions[v + 1] - middle[1], positions[v + 2] - middle[2]));
                }
            }
            const clone = {op: "clone", source: middle.map((x, i) => x + offset[i]), sourceNormal: picked.normal,
                patch: Math.min(20, Math.max(0.1, 2 * far + 0.1)), feather, spin: 0, anchor: middle, normal: edit.normal};
            state.clones.push([clone, faces]);
            strokeClones.push({clone, vertices: new Set(Array.from(faces, f => [surface.faces[3 * f], surface.faces[3 * f + 1], surface.faces[3 * f + 2]]).flat())});
        }
    });
    // Each fill under the strokes takes the clone of the last piece over all its rim (or over most of it)
    for (let i = 0; i < state.fills.length; i++){
        const ring = state.fills[i].ring;
        if (i < before && !ring.every(v => painted[v])) continue;
        let best = null, most = 0;
        for (const made of strokeClones){
            if (!made) continue;
            const count = ring.filter(v => made.vertices.has(v)).length;
            if (count >= most){
                best = made.clone;
                most = count;
            }
        }
        if (best) state.fillClone[i] = best;
    }
}

// applyEdits a step at a time, so that a caller can keep the state between edits (createPreview): the state before
// any edit, one edit applied to it, and the result. copyEdits: a state to go on from without changing this one.
export function startEdits(surface){
    const n = surface.faces.length / 3;
    return {
        n, kept: new Uint8Array(n).fill(1), positions: Float64Array.from(surface.positions),
        at: null,  // the triangles' centres, made again when the vertices move (never changed in place)
        floating: 0, flattened: 0, moved: 0,
        fills: [], fillClone: [],  // the holes filled, and the Clone brush's clone each one takes its texture from (or none)
        fillDetail: [],  // whether a fill is textured from beside it whatever its size (the brush's)
        shift: 0,  // metres: the most any vertex has moved from where it was (how far a triangle's centre can be from
                   // where the paint grid has it)
        clones: [],  // [edit, the triangles it covered (Int32Array)]
    };
}
export function copyEdits(state){
    return {...state, kept: state.kept.slice(), positions: state.positions.slice(), fills: state.fills.slice(),
        fillClone: state.fillClone.slice(), fillDetail: state.fillDetail.slice(), clones: state.clones.slice()};
}
export function applyEdit(surface, state, edit, applyShape){
    const { n, kept, positions, fills } = state;
    const centresNow = () => (state.at = state.at || centres(surface.faces, positions));
    // The triangles a shape covers: what removing it would take out (a shape that keeps its inside: the rest)
    const coveredBy = shape => {
        const at = centresNow();
        const covered = applyShape(at.xs, at.ys, at.zs, {...shape, restore: false}, new Uint8Array(n).fill(1), null);
        for (let f = 0; f < n; f++) covered[f] = covered[f] ? 0 : 1;
        return covered;
    };
    const fill = chosen => {
        for (const hole of chosen){
            if (hole.rim.length > MAX_HOLE) continue;
            const made = fillHole(positions, hole.rim);
            if (made){
                fills.push(made);
                state.fillClone.push(null);
                state.fillDetail.push(false);
            }
        }
    };
    if (edit.type === "paint"){
        paint(surface, state, edit, fill);
    } else if (edit.op === "object"){
        const at = centresNow();
        const before = kept.slice();
        applyShape(at.xs, at.ys, at.zs, {...edit, keep: false, restore: false}, kept, null);
        const touched = new Uint8Array(surface.count);
        for (let f = 0; f < n; f++){
            if (before[f] && !kept[f]) touched[surface.faces[3 * f]] = touched[surface.faces[3 * f + 1]] = touched[surface.faces[3 * f + 2]] = 1;
        }
        fill(holes(surface, kept, fills, positions).filter(hole => hole.rim.some(v => touched[v])));
    } else if (edit.type === "holes"){
        fill(holes(surface, kept, fills, positions).filter(hole => hole.rim.length <= edit.size));
    } else if (edit.op === "delete"){
        const at = centresNow();
        applyShape(at.xs, at.ys, at.zs, edit, kept, null);
    } else if (edit.op === "move" || edit.type === "straighten"){
        const count = edit.op === "move" ? move(surface, kept, coveredBy(edit), positions, edit) : straighten(surface, kept, positions, edit);
        if (count){
            state.moved += count;
            movedNow(surface, state);
        }
    } else if (edit.type === "floating"){
        const parts = components(surface.faces, surface.count, kept);
        let largest = -1;
        parts.sizes.forEach((size, i) => { if (largest < 0 || size > parts.sizes[largest]) largest = i; });
        for (let f = 0; f < n; f++){
            const label = parts.label[f];
            if (label >= 0 && label !== largest && parts.sizes[label] < edit.size){
                kept[f] = 0;
                state.floating++;
            }
        }
    }
}
export function finishEdits(surface, state){
    const { n, kept, positions } = state;
    let removed = 0;
    for (let f = 0; f < n; f++) if (!kept[f]) removed++;
    // A clone whose source has no surface left near it (as cloneSource finds it, after all the edits) is left out:
    // its triangles keep their own texture, and its fills are textured from beside them
    const sourced = new Map(), grid = sourceGrid(surface, state);
    const found = edit => {
        const key = edit.source.join(",") + "|" + edit.patch;
        if (!sourced.has(key)) sourced.set(key, !!cloneSource(surface, positions, kept, edit, grid));
        return sourced.get(key);
    };
    const fills = state.fills.map((made, i) => state.fillClone[i] && found(state.fillClone[i]) ? {...made, clone: state.fillClone[i]} :
        state.fillDetail[i] || state.fillClone[i] ? {...made, detail: true} : made);
    const added = fills.reduce((sum, f) => sum + f.triangles.length / 3, 0);
    // Clone Texture: each kept triangle goes to the last clone covering it
    const clones = state.clones.filter(([edit]) => found(edit));
    const cloneOf = new Int32Array(n).fill(-1);
    clones.forEach(([, faces], k) => { for (const f of faces) if (kept[f]) cloneOf[f] = k; });
    const cloned = clones.map(([edit, faces], k) => ({edit, faces: faces.filter(f => cloneOf[f] === k)})).filter(c => c.faces.length);
    const clonedCount = cloned.reduce((sum, c) => sum + c.faces.length, 0);
    return {kept, positions, removed, floating: state.floating, flattened: state.flattened, fills, added, moved: state.moved,
        clones: cloned, cloneOf, cloned: clonedCount};
}

// The edits' result kept between calls, for a view that shows them as they change: preview(edits) answers
// applyEdits(surface, edits, applyShape)'s result, working from the state before the first edit that differs from
// the last call's (most changes are to the last edit). The states before a few recent changes are kept.
export const PREVIEW_STATES = 4;
export function createPreview(surface, applyShape){
    let keys = [];
    const states = new Map([[0, startEdits(surface)]]);  // the state before edit i (its own: never changed)
    return edits => {
        const next = edits.map(edit => JSON.stringify(edit));
        let first = 0;
        while (first < keys.length && first < next.length && keys[first] === next[first]) first++;
        for (const i of [...states.keys()]) if (i > first) states.delete(i);
        const from = Math.max(...[...states.keys()].filter(i => i <= first));
        const state = copyEdits(states.get(from));
        for (let i = from; i < edits.length; i++){
            if (i === first && i > from){
                states.set(i, copyEdits(state));
                // At most PREVIEW_STATES besides the start: the oldest go
                const kept = [...states.keys()].filter(k => k > 0).sort((a, b) => a - b);
                while (kept.length > PREVIEW_STATES) states.delete(kept.shift());
            }
            applyEdit(surface, state, edits[i], applyShape);
        }
        keys = next;
        return finishEdits(surface, state);
    };
}

// The model's pieces after the edits, to draw or to write: for each piece its kept triangles, with the surface's
// vertices after the edits for its corners (a vertex moved moves every corner welded to it) and its own uvs, the
// corners no kept triangle uses left out: [{piece: its number, positions: Float32Array, uvs: Float32Array or null,
// indices: Uint32Array}]
export function editedPieces(pieces, surface, result){
    const triangles = pieces.map(() => []);
    for (let f = 0; f < result.kept.length; f++){
        if (result.kept[f] && !(result.cloneOf && result.cloneOf[f] >= 0)) triangles[surface.pieceOf[f]].push(surface.localOf[f]);
    }
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

// Each fill's colours: an [r, g, b] (0 to 255) for each vertex of its rim, the model's texture there, from a corner
// of a triangle at that vertex. sample(piece, u, v): the colour of a piece's texture at u, v (glTF's: v down).
// The first triangle at each vertex, and the vertex's corner in it: made once a surface (they depend only on its
// triangles)
const firstCorners = new WeakMap();
function cornersOf(surface){
    if (!firstCorners.has(surface)){
        const cornerOf = new Int32Array(surface.count).fill(-1), faceOf = new Int32Array(surface.count);
        const { faces } = surface;
        for (let f = 0; f < faces.length / 3; f++){
            for (let k = 0; k < 3; k++){
                const v = faces[3 * f + k];
                if (cornerOf[v] < 0){
                    faceOf[v] = f;
                    cornerOf[v] = k;
                }
            }
        }
        firstCorners.set(surface, {cornerOf, faceOf});
    }
    return firstCorners.get(surface);
}
export function fillColours(surface, pieces, fills, sample){
    if (!fills.length) return [];
    const { cornerOf, faceOf } = cornersOf(surface);
    return fills.map(fill => {
        const out = new Float32Array(fill.ring.length * 3);
        fill.ring.forEach((v, i) => {
            const f = faceOf[v], piece = surface.pieceOf[f], local = surface.localOf[f];
            const corner = pieces[piece].indices[3 * local + cornerOf[v]], uvs = pieces[piece].uvs;
            const colour = uvs ? sample(piece, uvs[2 * corner], uvs[2 * corner + 1]) : [128, 128, 128];
            out[3 * i] = colour[0];
            out[3 * i + 1] = colour[1];
            out[3 * i + 2] = colour[2];
        });
        return out;
    });
}

// A texture's colour at u, v: rgba (size by size, rows from the top, as glTF's v) at the nearest texel
export function sampleImage(rgba, size, u, v){
    const wrap = t => t - Math.floor(t);
    const x = Math.min(size - 1, Math.floor(wrap(u) * size)), y = Math.min(size - 1, Math.floor(wrap(v) * size));
    const i = 4 * (y * size + x);
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

export const FILL_TEXEL = 0.02;  // metres a texel of the fills' texture covers
export const FILL_CELL = [4, 256];  // texels: the fewest and most across one fill's patch
export const FILL_WIDTH = 2048;  // texels: the fills' texture's width (its height as its patches need)
const FILL_PAD = 2;
const FILL_SAMPLES = 64;  // rim colours blended for each texel, at most

// The fills as one more piece for the model, with a texture made for it: each fill a patch, its rim's colours
// blended across it (inverse distance). {piece: {positions, uvs, indices}, width, height, rgba} or null with no fill.
export function fillAtlas(fills, colours, positions){
    if (!fills.length) return null;
    // Each fill's patch, its size from its extent on its plane
    const cells = fills.map(fill => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < fill.xs.length; i++){
            x0 = Math.min(x0, fill.xs[i]);
            x1 = Math.max(x1, fill.xs[i]);
            y0 = Math.min(y0, fill.ys[i]);
            y1 = Math.max(y1, fill.ys[i]);
        }
        const fit = t => Math.max(FILL_CELL[0], Math.min(FILL_CELL[1], Math.ceil(t / FILL_TEXEL)));
        return {x0, y0, sx: Math.max(x1 - x0, 1e-6), sy: Math.max(y1 - y0, 1e-6), w: fit(x1 - x0), h: fit(y1 - y0)};
    });
    // Shelves, the tallest patches first
    const order = cells.map((_c, i) => i).sort((a, b) => cells[b].h - cells[a].h);
    let x = 0, y = 0, shelf = 0;
    for (const i of order){
        const c = cells[i], w = c.w + 2 * FILL_PAD, h = c.h + 2 * FILL_PAD;
        if (x + w > FILL_WIDTH){
            x = 0;
            y += shelf;
            shelf = 0;
        }
        c.left = x + FILL_PAD;
        c.top = y + FILL_PAD;
        x += w;
        shelf = Math.max(shelf, h);
    }
    const width = FILL_WIDTH, height = y + shelf;
    const rgba = new Uint8ClampedArray(width * height * 4);
    let corners = 0, triangles = 0;
    for (const fill of fills){
        corners += fill.ring.length;
        triangles += fill.triangles.length;
    }
    const piecePositions = new Float32Array(corners * 3), uvs = new Float32Array(corners * 2), indices = new Uint32Array(triangles);
    let base = 0, t = 0;
    fills.forEach((fill, k) => {
        const c = cells[k], colour = colours[k], m = fill.ring.length;
        const step = Math.max(1, Math.floor(m / FILL_SAMPLES));
        const samples = [];
        for (let i = 0; i < m; i += step) samples.push(i);
        // A rim vertex's place in the patch, in texels
        const px = i => c.left + (fill.xs[i] - c.x0) / c.sx * c.w, py = i => c.top + (fill.ys[i] - c.y0) / c.sy * c.h;
        for (let ty = -FILL_PAD; ty < c.h + FILL_PAD; ty++){
            for (let tx = -FILL_PAD; tx < c.w + FILL_PAD; tx++){
                const cx = c.left + tx + 0.5, cy = c.top + ty + 0.5;
                let r = 0, g = 0, b = 0, weights = 0;
                for (const i of samples){
                    const d2 = (px(i) - cx) ** 2 + (py(i) - cy) ** 2;
                    const w = 1 / (d2 + 0.25);
                    r += colour[3 * i] * w;
                    g += colour[3 * i + 1] * w;
                    b += colour[3 * i + 2] * w;
                    weights += w;
                }
                const at = 4 * ((c.top + ty) * width + c.left + tx);
                rgba[at] = r / weights;
                rgba[at + 1] = g / weights;
                rgba[at + 2] = b / weights;
                rgba[at + 3] = 255;
            }
        }
        for (let i = 0; i < m; i++){
            const v = 3 * fill.ring[i];
            piecePositions[3 * (base + i)] = positions[v];
            piecePositions[3 * (base + i) + 1] = positions[v + 1];
            piecePositions[3 * (base + i) + 2] = positions[v + 2];
            uvs[2 * (base + i)] = px(i) / width;
            uvs[2 * (base + i) + 1] = py(i) / height;
        }
        for (const corner of fill.triangles) indices[t++] = base + corner;
        base += m;
    });
    return {piece: {positions: piecePositions, uvs, indices}, width, height, rgba};
}

// A plane's two directions across it: v the most upward (north for a level plane), u across, so that u, v and the
// normal turn as x, y and z do
export function planeFrame(normal){
    const [nx, ny, nz] = normal;
    let vx = -nz * nx, vy = -nz * ny, vz = 1 - nz * nz;  // up, less its part along the normal
    let length = Math.hypot(vx, vy, vz);
    if (length < 0.1){
        vx = -ny * nx;
        vy = 1 - ny * ny;
        vz = -ny * nz;
        length = Math.hypot(vx, vy, vz);
    }
    const v = [vx / length, vy / length, vz / length];
    const u = [v[1] * nz - v[2] * ny, v[2] * nx - v[0] * nz, v[0] * ny - v[1] * nx];
    return {u, v};
}

// A clone's square on its plane about its anchor (the Clone brush's): the normal, and the square's sides' directions
// (a, b), its turn as renderPart turns the patch, so that the patch's square lands on it
export function cloneAxes(normal, spin){
    const length = Math.hypot(...normal) || 1, n = normal.map(x => x / length);
    const { u, v } = planeFrame(n);
    const turn = spin * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn);
    return {n, a: [0, 1, 2].map(i => c * u[i] + s * v[i]), b: [0, 1, 2].map(i => s * u[i] - c * v[i])};
}

// Clone Texture's source: the kept triangles whose centres are within the patch's reach of source, the plane of their
// vertices through source, its frame and the patch's half width; null where no triangle is near
export function cloneSource(surface, positions, kept, edit, grid = null){
    const { faces } = surface, [sx, sy, sz] = edit.source, half = edit.patch / 2, reach2 = 2 * half * half;
    const near = [], vertices = new Set();
    const consider = f => {
        if (!kept[f]) return;
        const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
        const cx = (positions[a] + positions[b] + positions[c]) / 3 - sx;
        const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3 - sy;
        const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3 - sz;
        if (cx * cx + cy * cy + cz * cz > reach2) return;
        near.push(f);
        for (let k = 0; k < 3; k++) vertices.add(faces[3 * f + k]);
    };
    if (grid) grid.near(edit.source, Math.sqrt(reach2), consider);
    else for (let f = 0; f < faces.length / 3; f++) consider(f);
    const plane = fitPlane(positions, [...vertices]);
    if (!plane) return null;
    // A clone brush's strokes share the frame of the source the brush picked, so their textures meet without a seam
    const normal = edit.sourceNormal || plane.normal;
    return {faces: near, point: edit.source, normal, ...planeFrame(normal), half};
}

// The kept triangles' centres in cells, to find those near a point quickly: near(point, reach, visit) visits each
// triangle whose centre may be within reach
export function faceGrid(surface, positions, kept, cell, bounds = null){
    const cells = new Map(), { faces } = surface;
    const key = (x, y, z) => x + "," + y + "," + z;
    for (let f = 0; f < faces.length / 3; f++){
        if (!kept[f]) continue;
        const a = 3 * faces[3 * f], b = 3 * faces[3 * f + 1], c = 3 * faces[3 * f + 2];
        // bounds ([[x, y, z], [x, y, z]]): only the triangles with a corner inside (those near where it is asked)
        if (bounds && !inBounds(bounds, positions, a) && !inBounds(bounds, positions, b) && !inBounds(bounds, positions, c)) continue;
        const k = key(Math.floor((positions[a] + positions[b] + positions[c]) / 3 / cell),
            Math.floor((positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3 / cell),
            Math.floor((positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3 / cell));
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(f);
    }
    return {
        near(point, reach, visit){
            const lo = point.map(t => Math.floor((t - reach) / cell)), hi = point.map(t => Math.floor((t + reach) / cell));
            for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++){
                const list = cells.get(key(x, y, z));
                if (list) for (const f of list) visit(f);
            }
        }
    };
}

export const FILL_DETAIL = 0.1;  // metres: a fill this wide or wider (from its middle) is textured from beside it

// A fill's source beside it: of four patches as wide as the fill, one fill-width away along its plane's
// directions, the one with the most surface facing as the fill does; null when none has any
function fillSource(surface, positions, kept, fill, grid){
    const n = fill.plane.normal, { u, v } = planeFrame(n), r = fill.radius;
    let mx = 0, my = 0, mz = 0;
    for (const vtx of fill.ring){
        mx += positions[3 * vtx] / fill.ring.length;
        my += positions[3 * vtx + 1] / fill.ring.length;
        mz += positions[3 * vtx + 2] / fill.ring.length;
    }
    let best = null, bestScore = 0;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const point = [0, 1, 2].map(i => [mx, my, mz][i] + 2 * r * (du * u[i] + dv * v[i]));
        const edit = {source: point, patch: 2 * r};
        const source = cloneSource(surface, positions, kept, edit, grid);
        if (!source) continue;
        const facing = source.normal[0] * n[0] + source.normal[1] * n[1] + source.normal[2] * n[2];
        const score = source.faces.length * facing * facing;
        if (score > bestScore){
            bestScore = score;
            best = edit;
        }
    }
    return best;
}

function inBounds([lo, hi], positions, i){
    return positions[i] >= lo[0] && positions[i] <= hi[0] && positions[i + 1] >= lo[1] && positions[i + 1] <= hi[1] &&
        positions[i + 2] >= lo[2] && positions[i + 2] <= hi[2];
}

// The fills drawn with the smooth blend (fillAtlas) and those textured from beside them (cloneAtlas)
export function splitFills(fills){
    const detailed = f => f.radius >= FILL_DETAIL || !!f.clone || !!f.detail;  // a Clone brush's fills take its texture; the brush's are all textured
    return {smooth: fills.filter(f => !detailed(f)), detailed: fills.filter(detailed)};
}

export const CLONE_TEXEL = 0.01;  // metres a texel of a source patch covers
const MAX_PATCH = 1024;  // texels across a source patch
const MAX_CELL = 2048;  // texels across one clone's part of the texture
export const CLONE_WIDTH = 4096;  // texels: the clones' texture's width

// Where each piece's texture is read by the clones: {piece: [u0, v0, u1, v1]}, for the caller to load those parts
// Grows regions ({piece: [u0, v0, u1, v1]}) to take in triangle f's texture
function takeRegion(surface, pieces, regions, f){
    const k = surface.pieceOf[f], uvs = pieces[k].uvs;
    if (!uvs) return;
    const r = regions.get(k) || [Infinity, Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++){
        const corner = pieces[k].indices[3 * surface.localOf[f] + c];
        r[0] = Math.min(r[0], uvs[2 * corner]);
        r[1] = Math.min(r[1], uvs[2 * corner + 1]);
        r[2] = Math.max(r[2], uvs[2 * corner]);
        r[3] = Math.max(r[3], uvs[2 * corner + 1]);
    }
    regions.set(k, r);
}

export function cloneRegions(surface, pieces, result){
    const regions = new Map();
    const take = f => takeRegion(surface, pieces, regions, f);
    const sourceOf = clonesSources(surface, result);
    for (const clone of result.clones){
        for (const f of clone.faces) take(f);
        const source = sourceOf(clone.edit);
        if (source) for (const f of source.faces) take(f);
    }
    const detailed = splitFills(result.fills).detailed;
    if (detailed.length){
        const grid = faceGrid(surface, result.positions, result.kept, 0.5);
        const faceOf = firstFaces(surface);
        for (const fill of detailed){
            for (const vtx of fill.ring) take(faceOf[vtx]);
            const edit = fill.clone ? null : fillSource(surface, result.positions, result.kept, fill, grid);
            const source = fill.clone ? sourceOf(fill.clone) : edit && cloneSource(surface, result.positions, result.kept, edit, grid);
            if (source) for (const f of source.faces) take(f);
        }
    }
    return regions;
}

// The clones' sources, each found once however many clones share it (the Clone brush's strokes of one size do)
function clonesSources(surface, result){
    const found = new Map();
    let grid = null;
    return edit => {
        const key = edit.source.join(",") + "|" + edit.patch + "|" + (edit.sourceNormal || "");
        if (!found.has(key)){
            if (!grid && result.clones.length > 1) grid = faceGrid(surface, result.positions, result.kept, 0.5);
            found.set(key, cloneSource(surface, result.positions, result.kept, edit, grid));
        }
        return found.get(key);
    };
}

// A triangle at each surface vertex (the first that has it)
function firstFaces(surface){
    return cornersOf(surface).faceOf;
}

// Fills a triangle's texels: for each texel centre inside a, b, c (texel coordinates), visit(x, y, wa, wb, wc)
function rasterise(a, b, c, width, height, visit){
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!area) return;
    for (let y = y0; y <= y1; y++){
        for (let x = x0; x <= x1; x++){
            const px = x + 0.5, py = y + 0.5;
            const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
            const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
            const wc = 1 - wa - wb;
            if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) visit(x, y, wa, wb, wc);
        }
    }
}

// A face's corner uv: [u, v]
function cornerUv(surface, pieces, f, c){
    const k = surface.pieceOf[f], corner = pieces[k].indices[3 * surface.localOf[f] + c], uvs = pieces[k].uvs;
    return uvs ? [uvs[2 * corner], uvs[2 * corner + 1]] : [0, 0];
}

// A face's texture colour at weights of its corners
function faceColour(surface, pieces, f, wa, wb, wc, sample){
    const a = cornerUv(surface, pieces, f, 0), b = cornerUv(surface, pieces, f, 1), c = cornerUv(surface, pieces, f, 2);
    return sample(surface.pieceOf[f], a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc);
}

// A source patch: the source triangles drawn flat on its plane, size texels square; texels no triangle covers
// take their neighbours' colours. {rgba: Float32Array of r, g, b, size, texel}
function sourcePatch(surface, pieces, positions, source, sample){
    const texel = Math.max(CLONE_TEXEL, 2 * source.half / MAX_PATCH);
    const size = Math.max(2, Math.ceil(2 * source.half / texel));
    const rgb = new Float32Array(size * size * 3), have = new Uint8Array(size * size);
    const { u, v, point } = source;
    const at = vtx => {
        const dx = positions[3 * vtx] - point[0], dy = positions[3 * vtx + 1] - point[1], dz = positions[3 * vtx + 2] - point[2];
        return [(dx * u[0] + dy * u[1] + dz * u[2]) / texel + size / 2, size / 2 - (dx * v[0] + dy * v[1] + dz * v[2]) / texel];
    };
    for (const f of source.faces){
        const { faces } = surface;
        rasterise(at(faces[3 * f]), at(faces[3 * f + 1]), at(faces[3 * f + 2]), size, size, (x, y, wa, wb, wc) => {
            const colour = faceColour(surface, pieces, f, wa, wb, wc, sample);
            const i = y * size + x;
            rgb[3 * i] = colour[0];
            rgb[3 * i + 1] = colour[1];
            rgb[3 * i + 2] = colour[2];
            have[i] = 1;
        });
    }
    fillGaps(rgb, have, size, size);
    return {rgb, size, texel};
}

// Texels not had take the mean of had neighbours, pass after pass; any left, the mean of all
function fillGaps(rgb, have, width, height){
    let missing = 0, mean = [0, 0, 0], had = 0;
    for (let i = 0; i < width * height; i++){
        if (have[i]){
            for (let c = 0; c < 3; c++) mean[c] += rgb[3 * i + c];
            had++;
        } else missing++;
    }
    mean = had ? mean.map(x => x / had) : [128, 128, 128];
    for (let pass = 0; pass < 64 && missing; pass++){
        const next = have.slice();
        for (let y = 0; y < height; y++){
            for (let x = 0; x < width; x++){
                const i = y * width + x;
                if (have[i]) continue;
                let r = 0, g = 0, b = 0, m = 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const j = ny * width + nx;
                    if (!have[j]) continue;
                    r += rgb[3 * j];
                    g += rgb[3 * j + 1];
                    b += rgb[3 * j + 2];
                    m++;
                }
                if (!m) continue;
                rgb[3 * i] = r / m;
                rgb[3 * i + 1] = g / m;
                rgb[3 * i + 2] = b / m;
                next[i] = 1;
                missing--;
            }
        }
        have.set(next);
    }
    for (let i = 0; i < width * height; i++){
        if (have[i]) continue;
        rgb[3 * i] = mean[0];
        rgb[3 * i + 1] = mean[1];
        rgb[3 * i + 2] = mean[2];
    }
}

// The patch's colour at a texel position, repeated mirrored (no seam where copies meet), bilinear
function patchColour(patch, x, y){
    const { size, rgb } = patch;
    const mirror = t => {
        const m = ((t % (2 * size)) + 2 * size) % (2 * size);
        return m < size ? m : 2 * size - 1 - m;
    };
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const out = [0, 0, 0];
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]){
        const i = 3 * (mirror(y0 + dy) * size + mirror(x0 + dx));
        out[0] += rgb[i] * w;
        out[1] += rgb[i + 1] * w;
        out[2] += rgb[i + 2] * w;
    }
    return out;
}

// Each texel's distance (in texels) to the nearest texel outside the mask (chamfer, 3-4)
function distances(mask, width, height){
    const d = new Float32Array(width * height);
    const big = 1e9;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? big : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height) ? 0 : d[y * width + x];
    for (let y = 0; y < height; y++){
        for (let x = 0; x < width; x++){
            const i = y * width + x;
            if (!d[i]) continue;
            d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
        }
    }
    for (let y = height - 1; y >= 0; y--){
        for (let x = width - 1; x >= 0; x--){
            const i = y * width + x;
            if (!d[i]) continue;
            d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
        }
    }
    for (let i = 0; i < d.length; i++) d[i] /= 3;
    return d;
}

// The clones as one more piece for the model, with a texture made for it: each clone's triangles flat on their plane,
// textured with its source patch repeated and blended into their own texture near their edge. sample(piece, u, v):
// a piece's texture's colour (full size) where cloneRegions said. {piece, width, height, rgba} or null with none.
// cache (a Map, optional): each clone's and fill's part kept by what makes it (its settings, its triangles and where
// their corners are), so that a part is made again only when one of those changed; parts no longer needed leave it.
export function cloneAtlas(surface, pieces, result, sample, cache = null){
    return packParts(cloneParts(surface, pieces, result, sample, cache), result.positions);
}

// cloneAtlas in two steps: each clone's and wide fill's part ({key, centre: [x, y, z] of its corners, and what
// renderPart makes}), then parts packed into one texture (packParts), so that a caller can pack them in groups
export function cloneParts(surface, pieces, result, sample, cache = null){
    const parts = [], used = new Set();
    const cached = (key, make) => {
        if (!cache) return make();
        used.add(key);
        if (!cache.has(key)) cache.set(key, make());
        return cache.get(key);
    };
    const sourceOf = clonesSources(surface, result), patches = new Map();
    for (const clone of result.clones){
        const triangles = Array.from(clone.faces, f => [surface.faces[3 * f], surface.faces[3 * f + 1], surface.faces[3 * f + 2]]);
        const own = (t, wa, wb, wc) => faceColour(surface, pieces, clone.faces[t], wa, wb, wc, sample);
        const key = "c" + JSON.stringify(clone.edit) + partKey(clone.faces, triangles, result.positions);
        const part = cached(key, () => {
            const source = sourceOf(clone.edit);
            return source && renderPart(surface, pieces, result.positions, triangles, own, source, clone.edit, sample, patches);
        });
        if (part) parts.push({...part, key, centre: partCentre(part.triangles, result.positions)});
    }
    // The fills wide enough: textured from beside them, blended from their rim's colours at the edge. With a cache, a
    // fill's part is kept while its rim is where it was (its source beside it is not looked for again)
    const detailed = splitFills(result.fills).detailed;
    let grid = null;
    const fillParts = detailed.map(fill => {
        const triangles = [];
        for (let t = 0; t < fill.triangles.length; t += 3) triangles.push([fill.ring[fill.triangles[t]], fill.ring[fill.triangles[t + 1]], fill.ring[fill.triangles[t + 2]]]);
        return {fill, triangles, key: "f" + JSON.stringify(fill.clone || null) + partKey(fill.ring, triangles, result.positions)};
    });
    // The rims' colours of the fills whose parts are to be made, read together (each read goes over the whole model)
    const making = fillParts.filter(({key}) => !cache || !cache.has(key));
    // The grid their sources are found through: only around them (fillSource looks two widths away, a width across)
    const near = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const { fill } of making){
        for (const v of fill.ring) for (let i = 0; i < 3; i++){
            near[0][i] = Math.min(near[0][i], result.positions[3 * v + i] - 4 * fill.radius - 0.5);
            near[1][i] = Math.max(near[1][i], result.positions[3 * v + i] + 4 * fill.radius + 0.5);
        }
    }
    const rimColours = new Map(fillColours(surface, pieces, making.map(m => m.fill), sample).map((c, i) => [making[i].fill, c]));
    for (const { fill, triangles, key } of fillParts){
        const part = cached(key, () => {
            grid = grid || faceGrid(surface, result.positions, result.kept, 0.5, near);
            const edit = fill.clone ? null : fillSource(surface, result.positions, result.kept, fill, grid);
            // With no surface to copy beside it, its rim's colours alone (as a narrower fill's), never left undrawn
            const source = fill.clone ? sourceOf(fill.clone) : edit && cloneSource(surface, result.positions, result.kept, edit, grid);
            const colours = rimColours.get(fill);
            // Its own colour: the rim's colours blended by distance, as fillAtlas's
            const step = Math.max(1, Math.floor(fill.ring.length / FILL_SAMPLES));
            const rim = [];
            for (let i = 0; i < fill.ring.length; i += step) rim.push(i);
            const p = result.positions;
            const own = (t, wa, wb, wc) => {
                const [a, b, c] = triangles[t];
                const x = p[3 * a] * wa + p[3 * b] * wb + p[3 * c] * wc, y = p[3 * a + 1] * wa + p[3 * b + 1] * wb + p[3 * c + 1] * wc;
                const z = p[3 * a + 2] * wa + p[3 * b + 2] * wb + p[3 * c + 2] * wc;
                let r = 0, g = 0, bl = 0, weights = 0;
                for (const i of rim){
                    const vtx = fill.ring[i];
                    const w = 1 / ((p[3 * vtx] - x) ** 2 + (p[3 * vtx + 1] - y) ** 2 + (p[3 * vtx + 2] - z) ** 2 + 1e-6);
                    r += colours[3 * i] * w;
                    g += colours[3 * i + 1] * w;
                    bl += colours[3 * i + 2] * w;
                    weights += w;
                }
                return [r / weights, g / weights, bl / weights];
            };
            // A Clone brush's fill: in line with its clone's texture around it, no blend
            const settings = !source ? {feather: Infinity, spin: 0} : fill.clone ? {...fill.clone, feather: 0} : {feather: fill.radius / 2, spin: 0};
            return renderPart(surface, pieces, result.positions, triangles, own, source, settings, sample, patches);
        });
        if (part) parts.push({...part, key, centre: partCentre(part.triangles, result.positions)});
    }
    if (cache) for (const key of [...cache.keys()]) if (!used.has(key)) cache.delete(key);
    return parts;
}

// Parts packed on shelves in one texture (CLONE_WIDTH texels wide): {piece: their triangles with uvs into it, width,
// height, rgba}, or null with none
export function packParts(parts, resultPositions){
    if (!parts.length) return null;
    // Shelves, the tallest first
    const order = parts.map((_p, i) => i).sort((a, b) => parts[b].h - parts[a].h);
    let x = 0, y = 0, shelf = 0;
    for (const i of order){
        const part = parts[i];
        if (x + part.w > CLONE_WIDTH){
            x = 0;
            y += shelf;
            shelf = 0;
        }
        part.left = x;
        part.top = y;
        x += part.w;
        shelf = Math.max(shelf, part.h);
    }
    const width = Math.min(CLONE_WIDTH, Math.max(...parts.map(part => part.left + part.w))), height = y + shelf;
    const rgba = new Uint8ClampedArray(width * height * 4);
    let count = 0;
    for (const part of parts){
        count += part.triangles.length;
        for (let row = 0; row < part.h; row++) rgba.set(part.rgba.subarray(4 * row * part.w, 4 * (row + 1) * part.w), 4 * ((part.top + row) * width + part.left));
    }
    const positions = new Float32Array(count * 9), uvs = new Float32Array(count * 6), indices = new Uint32Array(count * 3);
    let corner = 0;
    for (const part of parts){
        for (const triangle of part.triangles){
            for (const vtx of triangle){
                const q = part.at.get(vtx);
                positions.set([resultPositions[3 * vtx], resultPositions[3 * vtx + 1], resultPositions[3 * vtx + 2]], 3 * corner);
                uvs[2 * corner] = (part.left + part.tx(q)) / width;
                uvs[2 * corner + 1] = (part.top + part.ty(q)) / height;
                indices[corner] = corner;
                corner++;
            }
        }
    }
    return {piece: {positions, uvs, indices}, width, height, rgba};
}

// The middle of a part's corners
function partCentre(triangles, positions){
    const c = [0, 0, 0];
    let count = 0;
    for (const t of triangles) for (const v of t){
        c[0] += positions[3 * v];
        c[1] += positions[3 * v + 1];
        c[2] += positions[3 * v + 2];
        count++;
    }
    return c.map(x => x / Math.max(1, count));
}

// What a part is made from, as text: its triangles' numbers and where their corners are
function partKey(ids, triangles, positions){
    let sx = 0, sy = 0, sz = 0, sq = 0;
    for (const t of triangles) for (const v of t){
        sx += positions[3 * v];
        sy += positions[3 * v + 1];
        sz += positions[3 * v + 2];
        sq += positions[3 * v] * positions[3 * v + 1] + positions[3 * v + 2] * positions[3 * v + 2];
    }
    let h = 0;
    for (const id of ids) h = (Math.imul(h, 31) + id) | 0;
    return "|" + ids.length + ":" + h + ":" + [sx, sy, sz, sq].join(",");
}

// One part of the clones' texture: triangles (surface vertex triples) flat on their plane, each texel the source
// patch repeated (turned by settings.spin), blended into own(triangle, weights) over settings.feather from the edge
function renderPart(surface, pieces, p, triangles, own, source, settings, sample, patches = null){
    // No source: a patch of nothing, all of it own's (settings.feather Infinity)
    let patch = source ? patches && patches.get(source) : {rgb: new Float32Array(12), size: 2, texel: CLONE_TEXEL};
    if (!patch){
        patch = sourcePatch(surface, pieces, p, source, sample);
        if (patches) patches.set(source, patch);
    }
    const vertices = new Set();
    for (const t of triangles) for (const vtx of t) vertices.add(vtx);
    // An anchored clone's frame is its own, about its anchor (where the patch's middle goes); another's, its
    // triangles' plane
    const anchor = settings.anchor;
    const plane = anchor ? {point: anchor, normal: cloneAxes(settings.normal, 0).n} : fitPlane(p, [...vertices]);
    if (!plane) return null;
    const { u, v } = planeFrame(plane.normal);
    const o = plane.point;
    const at = new Map();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const vtx of vertices){
        const dx = p[3 * vtx] - o[0], dy = p[3 * vtx + 1] - o[1], dz = p[3 * vtx + 2] - o[2];
        const q = [dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2]];
        at.set(vtx, q);
        x0 = Math.min(x0, q[0]);
        x1 = Math.max(x1, q[0]);
        y0 = Math.min(y0, q[1]);
        y1 = Math.max(y1, q[1]);
    }
    const texel = Math.max(patch.texel, (x1 - x0) / MAX_CELL, (y1 - y0) / MAX_CELL);
    const w = Math.max(1, Math.ceil((x1 - x0) / texel)) + 4, h = Math.max(1, Math.ceil((y1 - y0) / texel)) + 4;
    // Texel position of a plane point: 2 texels of margin, rows downward (v up)
    const tx = q => (q[0] - x0) / texel + 2, ty = q => (y1 - q[1]) / texel + 2;
    const mine = new Float32Array(w * h * 3), mask = new Uint8Array(w * h);
    triangles.forEach((triangle, t) => {
        const corners = triangle.map(vtx => at.get(vtx)).map(q => [tx(q), ty(q)]);
        rasterise(corners[0], corners[1], corners[2], w, h, (x, y, wa, wb, wc) => {
            const i = y * w + x;
            mine.set(own(t, wa, wb, wc), 3 * i);
            mask[i] = 1;
        });
    });
    if (!source){
        // The patch of nothing: the mean of own's colours, for the texels around the triangles
        const mean = [0, 0, 0];
        let count = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i]){
            for (let c = 0; c < 3; c++) mean[c] += mine[3 * i + c];
            count++;
        }
        for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) patch.rgb[3 * i + c] = count ? mean[c] / count : 128;
    }
    const near = distances(mask, w, h);
    const spin = (settings.spin || 0) * Math.PI / 180, cs = Math.cos(spin), sn = Math.sin(spin);
    const scale = texel / patch.texel;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++){
        for (let x = 0; x < w; x++){
            const i = y * w + x;
            // The texel's place on the plane in patch texels, turned by spin
            const px = anchor ? (x0 + (x + 0.5 - 2) * texel) / patch.texel : (x + 0.5 - 2) * scale;
            const py = anchor ? ((y + 0.5 - 2) * texel - y1) / patch.texel : (y + 0.5 - 2) * scale;
            const colour = patchColour(patch, cs * px - sn * py + patch.size / 2, sn * px + cs * py + patch.size / 2);
            const feather = settings.feather > 0 ? Math.min(1, near[i] * texel / settings.feather) : 1;
            const blend = mask[i] ? feather : 1;
            for (let c = 0; c < 3; c++) rgba[4 * i + c] = colour[c] * blend + mine[3 * i + c] * (1 - blend);
            rgba[4 * i + 3] = 255;
        }
    }
    return {triangles, w, h, rgba, at, tx, ty};
}

// A texture region as loaded for sample(): rgba of the texels [x0, x0 + w) by [y0, y0 + h) of a width by height
// texture. The colour at u, v, bilinear, clamped to the region.
export function sampleRegion(region, u, v){
    const { rgba, x0, y0, w, h, width, height } = region;
    const fx = u * width - 0.5 - x0, fy = v * height - 0.5 - y0;
    const cx = t => Math.min(w - 1, Math.max(0, t)), cy = t => Math.min(h - 1, Math.max(0, t));
    const xa = Math.floor(fx), ya = Math.floor(fy), tx = fx - xa, ty = fy - ya;
    const out = [0, 0, 0];
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]){
        const i = 4 * (cy(ya + dy) * w + cx(xa + dx));
        out[0] += rgba[i] * wt;
        out[1] += rgba[i + 1] * wt;
        out[2] += rgba[i + 2] * wt;
    }
    return out;
}

// A region's texels for a texture of width by height: [u0, v0, u1, v1] grown by a texel, as whole texels
export function regionRect(r, width, height){
    const x0 = Math.max(0, Math.floor(r[0] * width) - 2), y0 = Math.max(0, Math.floor(r[1] * height) - 2);
    const x1 = Math.min(width, Math.ceil(r[2] * width) + 2), y1 = Math.min(height, Math.ceil(r[3] * height) + 2);
    return {x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0)};
}
