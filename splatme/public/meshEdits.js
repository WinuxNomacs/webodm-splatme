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
//   {op: "flatten", ...shape}  the triangles whose centres the shape covers made flat: their vertices moved onto
//                              the plane that best fits the selection's rim (its border with the rest), which
//                              stays where it is; with no rim (a whole piece), the plane of its own vertices
//   {op: "fill", ...shape}     the holes whose rims the shape covers (all their vertices) filled
//   {op: "object", ...shape}   Remove Object: the triangles whose centres the shape covers removed, then the holes
//                              that leaves filled
//   {op: "move", ...shape, offset: [x, y, z], scale: [x, y, z], soft: metres}
//                              the vertices of the triangles the shape covers scaled about their middle and moved;
//                              those within soft metres of them moved part of the way (less the farther), so the
//                              surface stretches instead of tearing
//   {op: "smooth", ...shape, passes}
//                              the covered vertices moved toward their neighbours' middle, passes times, the rim fixed
//   {op: "straighten", ...shape, line: [[x, y, z], [x, y, z]], strength, reach}
//                              the covered vertices (not the rim) pulled toward the line, strength (0 to 1) of the
//                              way at the line, fading to nothing at reach metres from it: an edge made straight
//   {type: "floating", size}   the pieces of surface of fewer than size triangles, all but the largest
//   {type: "holes", size}      Fill Holes: every hole of at most size edges filled
// A hole is a loop of open edges that goes round as a hole's do, not as a piece's outer rim (holes); a fill is triangles
// between its rim's vertices (fillHole), coloured from around the rim (fillColours, fillAtlas). The edits apply in
// the list's order: a fill's triangles close their hole for the edits after it.
export const OPS = ["delete", "flatten", "fill", "object", "move", "smooth", "straighten"];
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
    return {ring, triangles: Int32Array.from(earClip(xs, ys)), xs, ys};
}

// The holes of the kept surface and the fills so far: [{rim: surface vertices}]. A loop of open edges is a hole when
// it turns clockwise around the surface beside it (seen from the side its triangles face), as a hole's edges go; a
// piece's outer rim turns the other way.
function holes(surface, kept, fills, positions){
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
    const edges = openEdges(all, count, keep);
    const faceOf = new Map();
    for (const [a, b, f] of edges){
        faceOf.set(a * count + b, f);
        faceOf.set(b * count + a, f);
    }
    const p = positions;
    return loops(edges).filter(rim => {
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
        for (let v = 0; v < count; v++){
            if (inside[v] || !outside[v]) continue;
            const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
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
    for (const [v, x, y, z] of out){
        p[3 * v] = x;
        p[3 * v + 1] = y;
        p[3 * v + 2] = z;
    }
    return out.length;
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

// Straighten: the selection's vertices but its rim pulled toward the line, less the farther; the vertices moved
function straighten(surface, kept, selected, positions, edit){
    const { inside, outside } = sides(surface, kept, selected);
    const [a, b] = edit.line, { strength, reach } = edit;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length2 = dx * dx + dy * dy + dz * dz;
    let moved = 0;
    for (let v = 0; v < surface.count; v++){
        if (!inside[v] || outside[v]) continue;
        const px = positions[3 * v], py = positions[3 * v + 1], pz = positions[3 * v + 2];
        const t = length2 ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / length2)) : 0;
        const qx = a[0] + t * dx, qy = a[1] + t * dy, qz = a[2] + t * dz;
        const d = Math.hypot(px - qx, py - qy, pz - qz);
        if (d >= reach) continue;
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
    const n = surface.faces.length / 3;
    const kept = new Uint8Array(n).fill(1);
    const positions = Float64Array.from(surface.positions);
    let at = null;  // the triangles' centres, made again when the vertices move
    let floating = 0, flattened = 0, moved = 0;
    // The triangles a shape covers: what removing it would take out (a shape that keeps its inside: the rest)
    const coveredBy = edit => {
        at = at || centres(surface.faces, positions);
        const covered = applyShape(at.xs, at.ys, at.zs, {...edit, restore: false}, new Uint8Array(n).fill(1), null);
        for (let f = 0; f < n; f++) covered[f] = covered[f] ? 0 : 1;
        return covered;
    };
    const fills = [];
    const fill = chosen => {
        for (const hole of chosen){
            if (hole.rim.length > MAX_HOLE) continue;
            const made = fillHole(positions, hole.rim);
            if (made) fills.push(made);
        }
    };
    for (const edit of edits){
        if (edit.op === "object"){
            at = at || centres(surface.faces, positions);
            const before = kept.slice();
            applyShape(at.xs, at.ys, at.zs, {...edit, keep: false, restore: false}, kept, null);
            const touched = new Uint8Array(surface.count);
            for (let f = 0; f < n; f++){
                if (before[f] && !kept[f]) touched[surface.faces[3 * f]] = touched[surface.faces[3 * f + 1]] = touched[surface.faces[3 * f + 2]] = 1;
            }
            fill(holes(surface, kept, fills, positions).filter(hole => hole.rim.some(v => touched[v])));
        } else if (edit.op === "fill"){
            const xs = new Float64Array(surface.count), ys = new Float64Array(surface.count), zs = new Float64Array(surface.count);
            for (let v = 0; v < surface.count; v++){
                xs[v] = positions[3 * v];
                ys[v] = positions[3 * v + 1];
                zs[v] = positions[3 * v + 2];
            }
            const outside = applyShape(xs, ys, zs, {...edit, keep: false, restore: false}, new Uint8Array(surface.count).fill(1), null);
            fill(holes(surface, kept, fills, positions).filter(hole => hole.rim.every(v => !outside[v])));
        } else if (edit.type === "holes"){
            fill(holes(surface, kept, fills, positions).filter(hole => hole.rim.length <= edit.size));
        } else if (edit.op === "delete"){
            at = at || centres(surface.faces, positions);
            applyShape(at.xs, at.ys, at.zs, edit, kept, null);
        } else if (["flatten", "move", "smooth", "straighten"].includes(edit.op)){
            const covered = coveredBy(edit);
            const count = edit.op === "flatten" ? flatten(surface, kept, covered, positions) :
                edit.op === "move" ? move(surface, kept, covered, positions, edit) :
                edit.op === "smooth" ? smooth(surface, kept, covered, positions, edit.passes) : straighten(surface, kept, covered, positions, edit);
            if (count){
                if (edit.op === "flatten") flattened += count;
                moved += count;
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
    const added = fills.reduce((sum, f) => sum + f.triangles.length / 3, 0);
    return {kept, positions, removed, floating, flattened, fills, added, moved};
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

// Each fill's colours: an [r, g, b] (0 to 255) for each vertex of its rim, the model's texture there, from a corner
// of a triangle at that vertex. sample(piece, u, v): the colour of a piece's texture at u, v (glTF's: v down).
export function fillColours(surface, pieces, fills, sample){
    if (!fills.length) return [];
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
