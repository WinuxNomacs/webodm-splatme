import { weld, openEdges, loops, components, applyEdits, editedPieces, centres, fitPlane, earClip, fillColours, fillAtlas, sampleImage, planeFrame, cloneAtlas, cloneRegions, sampleRegion } from "../meshEdits";
import { applyShape } from "../editShapes";

// A 3 by 3 grid of squares (two triangles each) in the z = 0 plane, split into two pieces as WebODM's GLB splits a
// model by texture: the pieces repeat the corners they share
function grid(n = 3, hole = null){
    const pieces = [{positions: [], indices: []}, {positions: [], indices: []}];
    for (let i = 0; i < n; i++){
        for (let j = 0; j < n; j++){
            if (hole && hole(i, j)) continue;
            const piece = pieces[i < n / 2 ? 0 : 1];
            const base = piece.positions.length / 3;
            piece.positions.push(i, j, 0, i + 1, j, 0, i + 1, j + 1, 0, i, j + 1, 0);
            piece.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    return pieces.map(p => ({positions: Float32Array.from(p.positions), indices: Uint32Array.from(p.indices)}));
}

describe("the surface of a model's pieces", () => {
    test("welds the corners the pieces repeat into one vertex each", () => {
        const surface = weld(grid());
        expect(surface.count).toBe(16);
        expect(surface.faces.length / 3).toBe(18);
        expect(Array.from(surface.pieceOf).filter(k => k === 1).length).toBe(6);
    });

    test("welds corners closer than the tolerance, not farther", () => {
        const pieces = [{positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2])},
                        {positions: Float32Array.from([1.0002, 0, 0, 0, 1.0002, 0, 1, 1, 0]), indices: Uint32Array.from([0, 2, 1])}];
        expect(weld(pieces).count).toBe(4);
        expect(weld(pieces, 0.00001).count).toBe(6);
    });
});

describe("holes", () => {
    test("a whole grid has only its outer rim open", () => {
        const surface = weld(grid());
        const edges = openEdges(surface.faces, surface.count);
        expect(edges.length).toBe(12);
        expect(loops(edges).map(r => r.length)).toEqual([12]);
    });

    test("a missing square is a hole of four edges beside the rim", () => {
        const surface = weld(grid(3, (i, j) => i === 1 && j === 1));
        const rings = loops(openEdges(surface.faces, surface.count)).map(r => r.length).sort((a, b) => a - b);
        expect(rings).toEqual([4, 12]);
    });

    test("triangles left out count as removed", () => {
        const surface = weld(grid());
        const kept = new Uint8Array(18).fill(1);
        kept[8] = kept[9] = 0;  // the middle square
        expect(loops(openEdges(surface.faces, surface.count, kept)).map(r => r.length).sort((a, b) => a - b)).toEqual([4, 12]);
    });
});

test("a rim pinched at a vertex gives a loop on each side of it", () => {
    // Two squares' rims meeting at vertex 0: 0-1-2-3 and 0-4-5-6
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6], [6, 0]];
    for (const order of [edges, edges.slice().reverse(), [...edges.slice(4), ...edges.slice(0, 4)]]){
        const rings = loops(order).map(r => r.slice().sort((x, y) => x - y).join(","));
        expect(rings.sort()).toEqual(["0,1,2,3", "0,4,5,6"]);
    }
    expect(loops([[0, 1], [1, 2]])).toEqual([]);  // not closed
});

test("a loop whose edges do not all go the same way is found, turned the way most go", () => {
    const ring = loops([[0, 1], [2, 1], [2, 3], [3, 0]])[0];
    expect(ring.length).toBe(4);
    const along = [[0, 1], [2, 3], [3, 0]].filter(([a, b]) => ring.some((v, i) => v === a && ring[(i + 1) % 4] === b)).length;
    expect(along).toBe(3);
});

describe("floating pieces", () => {
    test("a separate square is a component of its own", () => {
        const pieces = grid();
        pieces.push({positions: Float32Array.from([10, 10, 0, 11, 10, 0, 11, 11, 0, 10, 11, 0]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3])});
        const surface = weld(pieces);
        const parts = components(surface.faces, surface.count);
        expect(parts.sizes.slice().sort((a, b) => b - a)).toEqual([18, 2]);
        expect(parts.label[18]).toBe(parts.label[19]);
        expect(parts.label[18]).not.toBe(parts.label[0]);
    });
});

// A brush over the whole screen, seen from straight above the grid
const ABOVE = [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, -0.01, 0, -0.15, -0.15, 0, 1];

describe("a model's edits", () => {
    const withUvs = pieces => pieces.map(p => ({...p, uvs: new Float32Array(p.positions.length / 3 * 2).map((_v, i) => i / 100)}));

    test("a box removes the triangles whose centres are inside it", () => {
        const pieces = withUvs(grid());
        const surface = weld(pieces);
        const box = {op: "delete", type: "box", keep: false, center: [1.5, 1.5, 0], size: [1, 1, 1], turn: 0};
        const result = applyEdits(surface, [box], applyShape);
        expect(result.removed).toBe(2);
        const out = editedPieces(pieces, surface, result);
        expect(out.reduce((sum, p) => sum + p.indices.length / 3, 0)).toBe(16);
        expect(loops(openEdges(surface.faces, surface.count, result.kept)).map(r => r.length).sort((a, b) => a - b)).toEqual([4, 12]);
    });

    test("a box that keeps its inside removes the rest", () => {
        const surface = weld(grid());
        const box = {op: "delete", type: "box", keep: true, center: [1.5, 1.5, 0], size: [1, 1, 1], turn: 0};
        expect(applyEdits(surface, [box], applyShape).removed).toBe(16);
    });

    test("a restoring brush puts back what the edits before it removed", () => {
        const surface = weld(grid());
        const box = {op: "delete", type: "box", keep: false, center: [1.5, 1.5, 0], size: [3, 3, 1], turn: 0};
        const restore = {op: "delete", type: "brush", restore: true, aspect: 1, view: ABOVE, strokes: [{size: 4, points: [[0, 0], [0.01, 0]]}]};
        expect(applyEdits(surface, [box], applyShape).removed).toBe(18);
        expect(applyEdits(surface, [box, restore], applyShape).removed).toBe(0);
        expect(applyEdits(surface, [restore, box], applyShape).removed).toBe(18);
    });

    test("Remove Floating Pieces takes the small pieces, never the largest", () => {
        const pieces = grid();
        pieces.push({positions: Float32Array.from([10, 10, 0, 11, 10, 0, 11, 11, 0, 10, 11, 0]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3])});
        const surface = weld(pieces);
        expect(applyEdits(surface, [{type: "floating", size: 5}], applyShape)).toMatchObject({removed: 2, floating: 2});
        expect(applyEdits(surface, [{type: "floating", size: 100}], applyShape)).toMatchObject({removed: 2, floating: 2});
        expect(applyEdits(surface, [{type: "floating", size: 2}], applyShape).removed).toBe(0);
    });

    test("the edited pieces keep their uvs and leave out unused corners", () => {
        const pieces = withUvs(grid());
        const surface = weld(pieces);
        const keepOne = {op: "delete", type: "box", keep: true, center: [0.5, 0.5, 0], size: [1, 1, 1], turn: 0};
        const out = editedPieces(pieces, surface, applyEdits(surface, [keepOne], applyShape));
        expect(out[0].indices.length).toBe(6);
        expect(out[0].positions.length).toBe(12);
        expect(Array.from(out[0].uvs)).toEqual(Array.from(pieces[0].uvs.slice(0, 8)));
        expect(out[1].indices.length).toBe(0);
    });

    test("the triangles' centres are their corners' mean", () => {
        const at = centres(Int32Array.from([0, 1, 2]), Float64Array.from([0, 0, 0, 3, 0, 0, 0, 3, 3]));
        expect([at.xs[0], at.ys[0], at.zs[0]]).toEqual([1, 1, 1]);
    });
});

describe("Flatten", () => {
    // A flat 4 by 4 grid with its middle vertex (2, 2) raised: a bump
    function bump(){
        const pieces = grid(4);
        for (const p of pieces){
            for (let i = 0; i < p.positions.length; i += 3){
                if (p.positions[i] === 2 && p.positions[i + 1] === 2) p.positions[i + 2] = 0.5;
            }
        }
        return pieces;
    }
    // Over the middle 2 by 2 squares: their rim is the ring of vertices around (2, 2), at z 0
    const middle = {op: "flatten", type: "box", keep: false, center: [2, 2, 0], size: [1.9, 1.9, 5], turn: 0};

    test("a plane fitted to points finds their mean and normal", () => {
        const plane = fitPlane(Float64Array.from([0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]), [0, 1, 2, 3]);
        expect(plane.point).toEqual([0.5, 0.5, 1]);
        expect(plane.normal.map(x => Math.round(x * 1e6) / 1e6)).toEqual([0, 0, 1]);
        expect(fitPlane(Float64Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2]), [0, 1, 2])).toBeNull();  // a line
    });

    test("lowers a bump onto the plane of the selection's rim, the rim staying where it is", () => {
        const pieces = bump();
        const surface = weld(pieces);
        const result = applyEdits(surface, [middle], applyShape);
        expect(result.removed).toBe(0);
        expect(result.flattened).toBe(1);
        for (let v = 0; v < surface.count; v++) expect(Math.abs(result.positions[3 * v + 2])).toBeLessThan(1e-9);
    });

    test("moves every corner welded to a vertex, in each piece", () => {
        const pieces = bump();
        const surface = weld(pieces);
        const out = editedPieces(pieces, surface, applyEdits(surface, [middle], applyShape));
        for (const piece of out) for (let i = 2; i < piece.positions.length; i += 3) expect(Math.abs(piece.positions[i])).toBeLessThan(1e-6);
    });

    test("a shape covering nothing changes nothing", () => {
        const surface = weld(bump());
        const box = {op: "flatten", type: "box", keep: false, center: [50, 50, 0], size: [1, 1, 1], turn: 0};
        const result = applyEdits(surface, [box], applyShape);
        expect(result.flattened).toBe(0);
        expect(Array.from(result.positions)).toEqual(Array.from(surface.positions));
    });
});

test("Flatten on a whole piece, with no rim, uses the plane of its own vertices", () => {
    const pieces = [{positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0.2, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3])}];
    const surface = weld(pieces);
    const box = {op: "flatten", type: "box", keep: false, center: [0.5, 0.5, 0], size: [5, 5, 5], turn: 0};
    const result = applyEdits(surface, [box], applyShape);
    expect(result.flattened).toBe(4);
    const plane = fitPlane(result.positions, [0, 1, 2, 3]);
    for (let v = 0; v < 4; v++){
        const d = [0, 1, 2].reduce((sum, k) => sum + (result.positions[3 * v + k] - plane.point[k]) * plane.normal[k], 0);
        expect(Math.abs(d)).toBeLessThan(1e-9);
    }
});

describe("filling holes", () => {
    const area = (xs, ys, tris) => {
        let sum = 0;
        for (let t = 0; t < tris.length; t += 3){
            const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
            sum += ((xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a])) / 2;
        }
        return sum;
    };
    // The open edges of the kept triangles and the fills together
    const rimsAfter = (surface, result) => {
        const extra = result.fills.flatMap(f => Array.from(f.triangles, t => f.ring[t]));
        const faces = Int32Array.from([...surface.faces, ...extra]);
        const kept = Uint8Array.from([...result.kept, ...new Array(extra.length / 3).fill(1)]);
        return loops(openEdges(faces, surface.count, kept)).map(r => r.length).sort((a, b) => a - b);
    };
    const middleGone = () => weld(grid(3, (i, j) => i === 1 && j === 1));

    test("ear clipping covers a polygon that is not convex, each triangle its way round", () => {
        const xs = [0, 2, 2, 1, 1, 0], ys = [0, 0, 1, 1, 2, 2];  // an L
        const tris = earClip(xs, ys);
        expect(tris.length).toBe(12);
        expect(area(xs, ys, tris)).toBeCloseTo(3);
        for (let t = 0; t < tris.length; t += 3) expect(area(xs, ys, tris.slice(t, t + 3))).toBeGreaterThan(0);
        const back = earClip(xs.slice().reverse(), ys.slice().reverse());
        expect(area(xs.slice().reverse(), ys.slice().reverse(), back)).toBeCloseTo(-3);
    });

    test("Fill Holes closes the holes up to its size, never the outer rim, the triangles facing as their neighbours", () => {
        const surface = middleGone();
        const result = applyEdits(surface, [{type: "holes", size: 4}], applyShape);
        expect(result.fills.length).toBe(1);
        expect(result.added).toBe(2);
        expect(result.removed).toBe(0);
        expect(rimsAfter(surface, result)).toEqual([12]);  // each new edge meets its neighbour's going the other way
        expect(applyEdits(surface, [{type: "holes", size: 3}], applyShape).added).toBe(0);
        expect(applyEdits(weld(grid()), [{type: "holes", size: 1000}], applyShape).added).toBe(0);
    });

    test("an outer rim pinched at a corner is no hole, nor is one seen from below", () => {
        // Two squares meeting at a corner: their rim is two loops, each going round as an outer rim does
        const corner = weld(grid(2, (i, j) => (i + j) % 2 === 1));
        expect(applyEdits(corner, [{type: "holes", size: 100}], applyShape).added).toBe(0);
        // The grid with a hole, its triangles facing down: the hole is still one
        const down = grid(3, (i, j) => i === 1 && j === 1).map(p => ({...p, indices: p.indices.slice().reverse()}));
        expect(applyEdits(weld(down), [{type: "holes", size: 4}], applyShape).added).toBe(2);
    });

    test("a fill shape closes the holes whose whole rim it covers", () => {
        const surface = middleGone();
        const around = {op: "fill", type: "box", keep: false, center: [1.5, 1.5, 0], size: [1.2, 1.2, 1], turn: 0};
        expect(applyEdits(surface, [around], applyShape).added).toBe(2);
        const part = {...around, center: [1.2, 1.5, 0], size: [0.6, 1.2, 1]};
        expect(applyEdits(surface, [part], applyShape).added).toBe(0);
    });

    test("Remove Object takes out what the shape covers and fills the hole it leaves", () => {
        const surface = weld(grid());
        const object = {op: "object", type: "box", keep: false, center: [1.5, 1.5, 0], size: [1, 1, 1], turn: 0};
        const result = applyEdits(surface, [object], applyShape);
        expect(result.removed).toBe(2);
        expect(result.added).toBe(2);
        expect(rimsAfter(surface, result)).toEqual([12]);
        // At the model's edge, the hole joins the outer rim: nothing to fill
        const edge = {...object, center: [0.5, 1.5, 0]};
        expect(applyEdits(surface, [edge], applyShape)).toMatchObject({removed: 2, added: 0});
    });

    test("a later Fill Holes counts a hole already filled as closed", () => {
        const surface = middleGone();
        const result = applyEdits(surface, [{type: "holes", size: 4}, {type: "holes", size: 4}], applyShape);
        expect(result.fills.length).toBe(1);
    });

    test("the fills' piece has a texture of the colours around their rims", () => {
        const pieces = grid(3, (i, j) => i === 1 && j === 1).map(p => ({...p, uvs: new Float32Array(p.positions.length / 3 * 2).fill(0.5)}));
        const surface = weld(pieces);
        const result = applyEdits(surface, [{type: "holes", size: 4}], applyShape);
        const colours = fillColours(surface, pieces, result.fills, piece => piece === 0 ? [200, 100, 0] : [200, 100, 0]);
        expect(Array.from(colours[0])).toEqual([200, 100, 0, 200, 100, 0, 200, 100, 0, 200, 100, 0]);
        const atlas = fillAtlas(result.fills, colours, result.positions);
        expect(atlas.piece.indices.length).toBe(6);
        expect(atlas.piece.positions.length).toBe(12);
        for (const uv of atlas.piece.uvs){
            expect(uv).toBeGreaterThanOrEqual(0);
            expect(uv).toBeLessThanOrEqual(1);
        }
        const u = atlas.piece.uvs[0], v = atlas.piece.uvs[1];
        const x = Math.floor(u * atlas.width), y = Math.min(atlas.height - 1, Math.floor(v * atlas.height));
        expect(Array.from(atlas.rgba.slice(4 * (y * atlas.width + x), 4 * (y * atlas.width + x) + 4))).toEqual([200, 100, 0, 255]);
        expect(fillAtlas([], [], result.positions)).toBeNull();
    });

    test("a texture is sampled at the nearest texel, rows from the top", () => {
        const rgba = Uint8ClampedArray.from([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
        expect(sampleImage(rgba, 2, 0.1, 0.1)).toEqual([1, 1, 1]);
        expect(sampleImage(rgba, 2, 0.9, 0.9)).toEqual([4, 4, 4]);
        expect(sampleImage(rgba, 2, 1.9, 0.1)).toEqual([2, 2, 2]);
    });
});

describe("Move and Smooth", () => {
    // Over the middle 2 by 2 squares of a 4 by 4 grid: their 9 vertices, (2, 2) alone not on their rim
    const middle = {type: "box", keep: false, center: [2, 2, 0], size: [1.9, 1.9, 5], turn: 0};
    const at = (positions, surface, x, y) => {
        for (let v = 0; v < surface.count; v++){
            if (surface.positions[3 * v] === x && surface.positions[3 * v + 1] === y) return Array.from(positions.slice(3 * v, 3 * v + 3));
        }
        return null;
    };

    test("Move raises what the shape covers, the rest staying put without a soft edge", () => {
        const surface = weld(grid(4));
        const raise = {...middle, op: "move", offset: [0, 0, 0.5], scale: [1, 1, 1], soft: 0};
        const result = applyEdits(surface, [raise], applyShape);
        expect(result.moved).toBe(9);
        expect(at(result.positions, surface, 1, 1)).toEqual([1, 1, 0.5]);
        expect(at(result.positions, surface, 0, 0)).toEqual([0, 0, 0]);
        expect(result.removed).toBe(0);
    });

    test("Move's soft edge takes the vertices near the selection part of the way, less the farther", () => {
        const surface = weld(grid(4));
        const raise = {...middle, op: "move", offset: [0, 0, 1], scale: [1, 1, 1], soft: 1.5};
        const result = applyEdits(surface, [raise], applyShape);
        const near = at(result.positions, surface, 0, 2)[2], corner = at(result.positions, surface, 0, 0)[2];
        expect(near).toBeGreaterThan(0);
        expect(near).toBeLessThan(1);
        expect(corner).toBeLessThan(near);  // farther: sqrt(2) from (1, 1)
        expect(at(result.positions, surface, 2, 2)[2]).toBe(1);
    });

    test("Move stretches the selection about its middle", () => {
        const surface = weld(grid(4));
        const stretch = {...middle, op: "move", offset: [0, 0, 0], scale: [2, 1, 1], soft: 0};
        const result = applyEdits(surface, [stretch], applyShape);
        expect(at(result.positions, surface, 1, 1)).toEqual([0, 1, 0]);
        expect(at(result.positions, surface, 3, 2)).toEqual([4, 2, 0]);
    });

    test("Smooth lowers a spike toward its neighbours, its rim fixed, more with more passes", () => {
        const pieces = grid(4);
        for (const p of pieces) for (let i = 0; i < p.positions.length; i += 3) if (p.positions[i] === 2 && p.positions[i + 1] === 2) p.positions[i + 2] = 1;
        const surface = weld(pieces);
        const one = applyEdits(surface, [{...middle, op: "smooth", passes: 1}], applyShape);
        const five = applyEdits(surface, [{...middle, op: "smooth", passes: 5}], applyShape);
        expect(one.moved).toBe(1);
        expect(at(one.positions, surface, 2, 2)[2]).toBeCloseTo(0.5);
        expect(at(five.positions, surface, 2, 2)[2]).toBeCloseTo(1 / 32);
        expect(at(five.positions, surface, 1, 1)[2]).toBe(0);
    });
});

describe("Straighten", () => {
    // A 4 by 4 grid whose vertex (2, 2) sticks up 0.3 m from the line y = 2 along the ground
    const surfaceWithBump = () => {
        const pieces = grid(4);
        for (const p of pieces) for (let i = 0; i < p.positions.length; i += 3) if (p.positions[i] === 2 && p.positions[i + 1] === 2) p.positions[i + 2] = 0.3;
        return weld(pieces);
    };
    const middle = {type: "box", keep: false, center: [2, 2, 0], size: [1.9, 1.9, 5], turn: 0, op: "straighten", line: [[1, 2, 0], [3, 2, 0]]};
    const height = (surface, result, x, y) => {
        for (let v = 0; v < surface.count; v++) if (surface.positions[3 * v] === x && surface.positions[3 * v + 1] === y) return result.positions[3 * v + 2];
        return null;
    };

    test("pulls the surface toward the line, more with more strength, none at 0", () => {
        const surface = surfaceWithBump();
        const z = strength => height(surface, applyEdits(surface, [{...middle, strength, reach: 1}], applyShape), 2, 2);
        expect(z(0)).toBeCloseTo(0.3);
        expect(z(0.5)).toBeLessThan(0.3);
        expect(z(1)).toBeLessThan(z(0.5));
        expect(z(1)).toBeGreaterThanOrEqual(0);
    });

    test("leaves the vertices beyond its reach, and the selection's rim, where they are", () => {
        const surface = surfaceWithBump();
        const far = applyEdits(surface, [{...middle, strength: 1, reach: 0.2}], applyShape);
        expect(far.moved).toBe(0);
        expect(height(surface, far, 2, 2)).toBeCloseTo(0.3);
        const tilted = {...middle, line: [[1, 2, 1], [3, 2, 1]], strength: 1, reach: 5};
        const result = applyEdits(surface, [tilted], applyShape);
        expect(height(surface, result, 1, 1)).toBe(0);  // on the rim
        expect(height(surface, result, 2, 2)).toBeGreaterThan(0.3);  // toward the line above
    });
});

describe("Clone Texture", () => {
    // A 4 by 4 grid, its two pieces' textures plain red (x under 2) and plain blue
    const pieces = () => grid(4).map(p => ({...p, uvs: new Float32Array(p.positions.length / 3 * 2).fill(0.5)}));
    const sample = piece => piece === 0 ? [255, 0, 0] : [0, 0, 255];
    const target = {op: "clone", type: "box", keep: false, center: [3.5, 2, 0], size: [0.9, 3.9, 5], turn: 0, source: [1, 2, 0], patch: 1, spin: 0};

    test("a plane's frame has v the most upward, u across", () => {
        const level = planeFrame([0, 0, 1]);
        expect(level.v.map(x => Math.round(x) + 0)).toEqual([0, 1, 0]);
        expect(level.u.map(x => Math.round(x) + 0)).toEqual([1, 0, 0]);
        const wall = planeFrame([1, 0, 0]);
        expect(wall.v.map(x => Math.round(x) + 0)).toEqual([0, 0, 1]);
        expect(wall.u.map(x => Math.round(x) + 0)).toEqual([0, 1, 0]);
    });

    test("the covered triangles move to a piece of their own, textured from the source", () => {
        const model = pieces();
        const surface = weld(model);
        const result = applyEdits(surface, [{...target, feather: 0}], applyShape);
        expect(result.cloned).toBe(8);  // the last column's 4 squares
        expect(result.removed).toBe(0);
        const out = editedPieces(model, surface, result);
        expect(out.reduce((sum, p) => sum + p.indices.length / 3, 0)).toBe(24);
        const regions = cloneRegions(surface, model, result);
        expect([...regions.keys()].sort()).toEqual([0, 1]);
        const atlas = cloneAtlas(surface, model, result, sample);
        expect(atlas.piece.indices.length).toBe(24);
        // Every texel the triangles cover is the source's red
        const u = (atlas.piece.uvs[0] + atlas.piece.uvs[2] + atlas.piece.uvs[4]) / 3, v = (atlas.piece.uvs[1] + atlas.piece.uvs[3] + atlas.piece.uvs[5]) / 3;
        const i = 4 * (Math.floor(v * atlas.height) * atlas.width + Math.floor(u * atlas.width));
        expect(Array.from(atlas.rgba.slice(i, i + 3))).toEqual([255, 0, 0]);
    });

    test("the feather keeps the triangles' own texture at their edge, the source's further in", () => {
        const model = pieces();
        const surface = weld(model);
        const result = applyEdits(surface, [{...target, feather: 2}], applyShape);
        const atlas = cloneAtlas(surface, model, result, sample);
        // Along the middle row of the clone's part: bluer at its edges than at its middle
        const row = Math.floor(atlas.height / 2);
        const blues = [];
        for (let x = 0; x < atlas.width; x++) if (atlas.rgba[4 * (row * atlas.width + x) + 3]) blues.push(atlas.rgba[4 * (row * atlas.width + x) + 2]);
        expect(blues.length).toBeGreaterThan(0);
        expect(Math.max(...blues)).toBeGreaterThan(0);
    });

    test("a later clone over the same triangles wins, and none is textured without a source near", () => {
        const surface = weld(pieces());
        const twice = applyEdits(surface, [{...target, feather: 0}, {...target, feather: 0, source: [3, 2, 0]}], applyShape);
        expect(twice.clones.length).toBe(1);
        expect(twice.clones[0].edit.source).toEqual([3, 2, 0]);
        const nowhere = applyEdits(surface, [{...target, source: [50, 50, 0], feather: 0}], applyShape);
        expect(cloneAtlas(surface, pieces(), nowhere, sample)).toBeNull();
    });

    test("a loaded region is sampled bilinearly, clamped to its edge", () => {
        const region = {rgba: Uint8ClampedArray.from([0, 0, 0, 255, 100, 100, 100, 255]), x0: 2, y0: 0, w: 2, h: 1, width: 4, height: 1};
        expect(sampleRegion(region, 2.5 / 4, 0.5)[0]).toBeCloseTo(0);
        expect(sampleRegion(region, 3 / 4, 0.5)[0]).toBeCloseTo(50);
        expect(sampleRegion(region, 0.99, 0.5)[0]).toBeCloseTo(100);
    });
});
