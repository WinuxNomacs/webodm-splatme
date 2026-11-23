import { weld, openEdges, loops, components, applyEdits, editedPieces, centres, fitPlane, earClip, fillColours, fillAtlas, sampleImage, planeFrame, cloneAtlas, cloneRegions, sampleRegion, splitFills, cloneAxes, createPreview, PREVIEW_STATES, strokeFaces, startEdits } from "../meshEdits";
import { applyShape } from "../editShapes";
import speck from "./speck.json";
import thinHole from "./thinhole.json";
import neckHole from "./neckhole.json";

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
    // The Flatten brush over the middle 2 by 2 squares: their rim is the ring of vertices around (2, 2), at z 0
    const brush = (point, radius) => ({type: "paint", op: "flatten", strokes: [{points: [point], radius, view: [0, 0, 1]}]});
    const middle = brush([2, 2, 0], 0.9);

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

    test("a stroke covering nothing changes nothing", () => {
        const surface = weld(bump());
        const result = applyEdits(surface, [brush([50, 50, 0], 1)], applyShape);
        expect(result.flattened).toBe(0);
        expect(Array.from(result.positions)).toEqual(Array.from(surface.positions));
    });
});

test("Flatten on a whole piece, with no rim, uses the plane of its own vertices", () => {
    const pieces = [{positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0.2, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3])}];
    const surface = weld(pieces);
    const brush = {type: "paint", op: "flatten", strokes: [{points: [[0.5, 0.5, 0]], radius: 5, view: [0, 0, 1]}]};
    const result = applyEdits(surface, [brush], applyShape);
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

describe("Move and the Smooth brush", () => {
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

    test("a Move with no offset and no stretch moves no points", () => {
        const surface = weld(grid(4));
        const still = {...middle, op: "move", offset: [0, 0, 0], scale: [1, 1, 1], soft: 0.5};
        expect(applyEdits(surface, [still], applyShape).moved).toBe(0);
    });

    test("Smooth lowers a spike toward its neighbours, its rim fixed, more with more passes", () => {
        const pieces = grid(4);
        for (const p of pieces) for (let i = 0; i < p.positions.length; i += 3) if (p.positions[i] === 2 && p.positions[i + 1] === 2) p.positions[i + 2] = 1;
        const surface = weld(pieces);
        const smooth = passes => ({type: "paint", op: "smooth", passes, strokes: [{points: [[2, 2, 0]], radius: 0.9, view: [0, 0, 1]}]});
        const one = applyEdits(surface, [smooth(1)], applyShape);
        const five = applyEdits(surface, [smooth(5)], applyShape);
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
    const middle = {type: "straighten", line: [[1, 2, 0], [3, 2, 0]]};
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

    test("leaves the vertices beyond its reach, and those on the line, where they are", () => {
        const surface = surfaceWithBump();
        const far = applyEdits(surface, [{...middle, strength: 1, reach: 0.2}], applyShape);
        expect(far.moved).toBe(0);  // the bump is 0.3 m away; (1, 2), (2, 2)'s neighbours on the line need no move
        expect(height(surface, far, 2, 2)).toBeCloseTo(0.3);
        const raised = {...middle, line: [[1, 2, 1], [3, 2, 1]], strength: 1, reach: 1.5};
        const result = applyEdits(surface, [raised], applyShape);
        expect(height(surface, result, 0, 0)).toBe(0);  // 2.4 m from the line
        expect(height(surface, result, 1, 1)).toBeGreaterThan(0);  // 1.4 m: pulled a little
        expect(height(surface, result, 2, 2)).toBeGreaterThan(0.3);  // toward the line above
    });
});

describe("Clone Texture's frames and texture", () => {
    test("a plane's frame has v the most upward, u across", () => {
        const level = planeFrame([0, 0, 1]);
        expect(level.v.map(x => Math.round(x) + 0)).toEqual([0, 1, 0]);
        expect(level.u.map(x => Math.round(x) + 0)).toEqual([1, 0, 0]);
        const wall = planeFrame([1, 0, 0]);
        expect(wall.v.map(x => Math.round(x) + 0)).toEqual([0, 0, 1]);
        expect(wall.u.map(x => Math.round(x) + 0)).toEqual([0, 1, 0]);
    });

    test("an anchored clone's square has the normal given, its sides at right angles", () => {
        const { n, a, b } = cloneAxes([0, 0, 2], 30);
        expect(n).toEqual([0, 0, 1]);
        expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeCloseTo(0);
    });

    test("a loaded region is sampled bilinearly, clamped to its edge", () => {
        const region = {rgba: Uint8ClampedArray.from([0, 0, 0, 255, 100, 100, 100, 255]), x0: 2, y0: 0, w: 2, h: 1, width: 4, height: 1};
        expect(sampleRegion(region, 2.5 / 4, 0.5)[0]).toBeCloseTo(0);
        expect(sampleRegion(region, 3 / 4, 0.5)[0]).toBeCloseTo(50);
        expect(sampleRegion(region, 0.99, 0.5)[0]).toBeCloseTo(100);
    });
});

describe("fills with detail", () => {
    test("a wide fill with no surface beside it to copy is drawn in its rim's colours, not left out", () => {
        // A 30 cm opening atop a 60 cm deep box: the walls beside it stand square to it, the bottom is out of reach
        const corners = [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]];
        const positions = [...corners.flatMap(([x, y]) => [x, y, 0]), ...corners.flatMap(([x, y]) => [x, y, -0.6])];
        const indices = [];
        for (let k = 0; k < 4; k++){
            const a = k, b = (k + 1) % 4;
            indices.push(a, b, b + 4, a, b + 4, a + 4);
        }
        indices.push(4, 5, 6, 4, 6, 7);
        // Each triangle facing out of the box
        for (let t = 0; t < indices.length; t += 3){
            const [a, b, c] = indices.slice(t, t + 3).map(v => positions.slice(3 * v, 3 * v + 3));
            const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
            const out = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3 - [0.15, 0.15, -0.3][i]);
            if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
        }
        const pieces = [{positions: Float32Array.from(positions), indices: Uint32Array.from(indices), uvs: new Float32Array(16).fill(0.5)}];
        const surface = weld(pieces);
        const result = applyEdits(surface, [{type: "paint", op: "fill", strokes: [{points: [[0.15, 0.15, 0]], radius: 0.5, view: [1, 0, 0.3]}]}], applyShape);
        expect(result.fills.length).toBe(1);
        expect(splitFills(result.fills).detailed.length).toBe(1);
        const atlas = cloneAtlas(surface, pieces, result, () => [200, 100, 50]);
        expect(atlas && atlas.piece.indices.length / 3).toBe(result.added);
        // Its texels are the rim's colour, around the triangles too (no black at its edge)
        let dark = 0;
        for (let i = 0; i < atlas.rgba.length; i += 4) if (atlas.rgba[i] < 100) dark++;
        expect(dark).toBe(0);
    });

    test("a wide fill is textured from beside it, a narrow one keeps the smooth blend", () => {
        // A 5 by 5 grid, 1 m squares, its middle square missing (0.7 m wide from its middle), all one red texture
        const model = grid(5, (i, j) => i === 2 && j === 2).map(p => ({...p, uvs: new Float32Array(p.positions.length / 3 * 2).fill(0.5)}));
        const surface = weld(model);
        const result = applyEdits(surface, [{type: "holes", size: 4}], applyShape);
        expect(result.fills.length).toBe(1);
        expect(splitFills(result.fills).detailed.length).toBe(1);
        expect(splitFills(result.fills).smooth.length).toBe(0);
        const regions = cloneRegions(surface, model, result);
        expect(regions.size).toBeGreaterThan(0);
        const atlas = cloneAtlas(surface, model, result, () => [200, 50, 50]);
        expect(atlas.piece.indices.length).toBe(6);
        const u = (atlas.piece.uvs[0] + atlas.piece.uvs[2] + atlas.piece.uvs[4]) / 3, v = (atlas.piece.uvs[1] + atlas.piece.uvs[3] + atlas.piece.uvs[5]) / 3;
        const i = 4 * (Math.floor(v * atlas.height) * atlas.width + Math.floor(u * atlas.width));
        expect(Array.from(atlas.rgba.slice(i, i + 3)).map(Math.round)).toEqual([200, 50, 50]);

        // The same hole a tenth the size is narrow
        const small = grid(5, (i, j) => i === 2 && j === 2).map(p => ({...p, positions: p.positions.map(x => x / 10)}));
        const tiny = applyEdits(weld(small), [{type: "holes", size: 4}], applyShape);
        expect(splitFills(tiny.fills).smooth.length).toBe(1);
    });
});

describe("the preview", () => {
    // A 6 by 6 grid with two holes, and edits of each kind
    const surface = weld(grid(6, (i, j) => (i === 1 && j === 1) || (i === 4 && j === 3)));
    const box = (center, size) => ({type: "box", keep: false, center, size, turn: 0});
    const edits = {
        remove: {...box([5.5, 5.5, 0], [0.9, 0.9, 1]), op: "delete"},
        move: {...box([3, 3, 0], [2, 2, 1]), op: "move", offset: [0, 0, 0.5], scale: [1, 1, 1], soft: 1},
        smooth: {type: "paint", op: "smooth", passes: 3, strokes: [{points: [[3, 3, 0]], radius: 1, view: [0, 0, 1]}]},
        straighten: {type: "straighten", line: [[1, 2.4, 0], [5, 2.4, 0]], strength: 1, reach: 1},
        holes: {type: "holes", size: 10},
        clone: {type: "paint", op: "clone", source: [2.5, 0.5, 0], target: [0.5, 4.5, 0], normal: [0, 0, 1], feather: 0,
            strokes: [{points: [[0.5, 4.5, 0]], radius: 0.45, view: [0, 0, 1]}]},
    };
    const summary = r => ({kept: Array.from(r.kept), positions: Array.from(r.positions), removed: r.removed, moved: r.moved, added: r.added,
        fills: r.fills.map(f => [f.ring, !!f.clone]), clones: r.clones.map(c => [c.edit.op, Array.from(c.faces)]), cloned: r.cloned});

    test("answers what applyEdits does, however the list changes", () => {
        const preview = createPreview(surface, applyShape);
        const { remove, move, smooth, straighten, holes, clone } = edits;
        const lists = [[], [remove], [remove, move], [remove, {...move, offset: [0, 0, 1]}], [remove, {...move, offset: [0, 0, 1]}, holes],
            [remove, {...move, offset: [0, 0, 1]}, holes, clone], [remove, smooth, holes, clone], [straighten], [remove, holes, straighten],
            [remove, holes, {...straighten, reach: 0.5}], [remove], [], [holes, move, smooth, clone, remove, straighten],
            [holes, move, smooth, clone, remove, {...straighten, strength: 0.5}]];
        for (const list of lists) expect(summary(preview(list))).toEqual(summary(applyEdits(surface, list, applyShape)));
    });

    test("keeps no more than a few states however many edits change", () => {
        const preview = createPreview(surface, applyShape);
        const list = [];
        for (let i = 0; i < PREVIEW_STATES + 4; i++){
            list.push({...edits.remove, center: [i % 6 + 0.5, 5.5, 0]});
            expect(summary(preview(list))).toEqual(summary(applyEdits(surface, list, applyShape)));
            list[i] = {...list[i], center: [i % 6 + 0.5, 4.5, 0]};
            expect(summary(preview(list))).toEqual(summary(applyEdits(surface, list, applyShape)));
        }
    });
});

describe("the surface brush", () => {
    // A 6 by 6 grid at z 0, facing up (+z), its texture's colour saying where it is (red x / 6, green y / 6)
    const textured = hole => grid(6, hole).map(p => {
        const uvs = new Float32Array(p.positions.length / 3 * 2);
        for (let c = 0; c < p.positions.length / 3; c++){
            uvs[2 * c] = p.positions[3 * c] / 6;
            uvs[2 * c + 1] = p.positions[3 * c + 1] / 6;
        }
        return {...p, uvs};
    });
    const sample = (_piece, u, v) => [u * 255, v * 255, 0];
    const up = [0, 0, 1];
    const stroke = (points, radius, view = up) => ({points, radius, view});
    const paint = (op, strokes, more = {}) => ({type: "paint", op, strokes, ...more});

    test("a stroke covers the triangles whose centres are within its radius of its path, facing it", () => {
        const surface = weld(grid(6));
        const state = startEdits(surface);
        // Along y = 2.5 from x 1 to 4, radius 0.4: the two triangles of each square on that row from x 1 to 4,
        // whose centres are 1/6 m off the row's middle (both within 0.4)
        expect(strokeFaces(surface, state, stroke([[1, 2.5, 0], [4, 2.5, 0]], 0.4)).length).toBe(8);
        expect(strokeFaces(surface, state, stroke([[1, 2.5, 0], [4, 2.5, 0]], 0.4, [0, 0, -1])).length).toBe(0);  // from below: none face it
        expect(strokeFaces(surface, state, stroke([[2.5, 2.5, 0]], 0.3)).length).toBe(2);  // a dab
        expect(strokeFaces(surface, state, stroke([[2.5, 2.5, 3]], 0.5)).length).toBe(0);  // above the surface
    });

    test("Remove and Restore take out and put back what each stroke covers", () => {
        const surface = weld(grid(6));
        const removed = applyEdits(surface, [paint("delete", [stroke([[1, 2.5, 0], [4, 2.5, 0]], 0.4)])], applyShape);
        expect(removed.removed).toBe(8);
        const back = applyEdits(surface, [paint("delete", [stroke([[1, 2.5, 0], [4, 2.5, 0]], 0.4)]), paint("restore", [stroke([[2.5, 2.5, 0]], 0.4)])], applyShape);
        expect(back.removed).toBe(6);
    });

    test("Raise lifts the surface most on the path, fading to nothing at the radius, and Lower is a negative amount", () => {
        const surface = weld(grid(6));
        const height = (r, x, y) => { for (let v = 0; v < surface.count; v++) if (surface.positions[3 * v] === x && surface.positions[3 * v + 1] === y) return r.positions[3 * v + 2]; };
        const lifted = applyEdits(surface, [paint("raise", [stroke([[3, 3, 0]], 1.5)], {amount: 0.1})], applyShape);
        expect(height(lifted, 3, 3)).toBeCloseTo(0.1);
        expect(height(lifted, 4, 3)).toBeGreaterThan(0);
        expect(height(lifted, 4, 3)).toBeLessThan(0.1);
        expect(height(lifted, 5, 3)).toBe(0);
        const twice = applyEdits(surface, [paint("raise", [stroke([[3, 3, 0]], 1.5), stroke([[3, 3, 0]], 1.5)], {amount: 0.1})], applyShape);
        expect(height(twice, 3, 3)).toBeCloseTo(0.2);
        const lowered = applyEdits(surface, [paint("raise", [stroke([[3, 3, 0]], 1.5)], {amount: -0.1})], applyShape);
        expect(height(lowered, 3, 3)).toBeCloseTo(-0.1);
        // The stroke after a raise still finds the triangles it moved
        expect(applyEdits(surface, [paint("raise", [stroke([[3, 3, 0]], 1.5)], {amount: 0.5}), paint("delete", [stroke([[3, 3, 0.5]], 0.6)])], applyShape).removed).toBeGreaterThan(0);
    });

    test("Fill fills the holes whose whole rim the paint covers, textured from beside them however small", () => {
        const surface = weld(textured((i, j) => i === 2 && j === 2));
        expect(applyEdits(surface, [paint("fill", [stroke([[2.5, 2.5, 0]], 0.5)])], applyShape).fills.length).toBe(0);  // the rim's corners are farther
        const result = applyEdits(surface, [paint("fill", [stroke([[2.5, 2.5, 0]], 1.4)])], applyShape);
        expect(result.fills.length).toBe(1);
        expect(splitFills(result.fills).detailed.length).toBe(1);
        expect(result.removed).toBe(0);
    });

    test("Clone copies the texture from the source's offset onto what the strokes cover, and into the holes under them", () => {
        const model = textured((i, j) => i === 4 && j === 4);
        const surface = weld(model);
        const clone = paint("clone", [stroke([[4.5, 4.5, 0], [4.5, 3.5, 0]], 1.2)], {source: [1.5, 1.5, 0], target: [4.5, 4.5, 0], normal: up, feather: 0});
        const result = applyEdits(surface, [clone], applyShape);
        expect(result.fills.length).toBe(1);
        expect(result.fills[0].clone).toBeTruthy();
        const atlas = cloneAtlas(surface, model, result, sample);
        // The colour at a point is the source's 3 m to the left and below
        const colourAt = (x, y) => {
            const p = atlas.piece.positions, uv = atlas.piece.uvs;
            for (let t = 0; t < p.length / 9; t++){
                const [ax, ay, bx, by, cx, cy] = [p[9 * t], p[9 * t + 1], p[9 * t + 3], p[9 * t + 4], p[9 * t + 6], p[9 * t + 7]];
                const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area, wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area, wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                const u = uv[6 * t] * wa + uv[6 * t + 2] * wb + uv[6 * t + 4] * wc, v = uv[6 * t + 1] * wa + uv[6 * t + 3] * wb + uv[6 * t + 5] * wc;
                const i = 4 * (Math.floor(v * atlas.height) * atlas.width + Math.floor(u * atlas.width));
                return Array.from(atlas.rgba.slice(i, i + 2));
            }
            return null;
        };
        for (const [x, y] of [[4.5, 4.5], [4.2, 3.6], [4.7, 4.1]]){
            const colour = colourAt(x, y);
            expect(colour[0]).toBeCloseTo((x - 3) / 6 * 255, -0.7);
            expect(colour[1]).toBeCloseTo((y - 3) / 6 * 255, -0.7);
        }
    });

    test("a later clone over the same triangles wins, and none is textured without a surface near its source", () => {
        const model = textured();
        const surface = weld(model);
        const clone = source => paint("clone", [stroke([[4.5, 4.5, 0]], 0.45)], {source, target: [4.5, 4.5, 0], normal: up, feather: 0});
        const twice = applyEdits(surface, [clone([1.5, 1.5, 0]), clone([2.5, 1.5, 0])], applyShape);
        expect(twice.clones.length).toBe(1);
        expect(twice.clones[0].edit.source).toEqual([2.5, 1.5, 0]);
        expect(cloneAtlas(surface, model, applyEdits(surface, [clone([50, 50, 0])], applyShape), sample)).toBeNull();
    });

    test("a clone piece with no surface near its source leaves its triangles their own texture, and its fills that beside them", () => {
        // A 12 m grid, a hole at x 7 to 8: copied from the left edge, the stroke's far end (and the hole) copy from off the model
        const model = grid(12, (i, j) => i === 7 && j === 5).map(p => ({...p, uvs: new Float32Array(p.positions.length / 3 * 2).fill(0.5)}));
        const surface = weld(model);
        const strokes = [stroke([[11.5, 5.5, 0], [5.5, 5.5, 0]], 0.6)];
        const result = applyEdits(surface, [paint("clone", strokes, {source: [0.5, 5.5, 0], target: [11.5, 5.5, 0], normal: up, feather: 0})], applyShape);
        expect(result.cloned).toBeGreaterThan(0);  // the pieces near the start copy from the model
        const drawn = editedPieces(model, surface, result).reduce((sum, p) => sum + p.indices.length / 3, 0);
        expect(drawn + result.cloned).toBe(surface.faces.length / 3);
        const atlas = cloneAtlas(surface, model, {...result, fills: []}, () => [9, 9, 9]);
        expect(atlas.piece.indices.length / 3).toBe(result.cloned);  // every cloned triangle in the clones' texture
        expect(result.fills.length).toBe(1);
        expect(result.fills[0].clone).toBeUndefined();
        expect(splitFills(result.fills).detailed.length).toBe(1);
    });

    // A 10 cm grid with a hole at (0.2, 0.2) to (0.3, 0.3); flip: the triangles at its far corner (0.3, 0.3) turned to
    // face away, as the crumpled surface around a hole often does
    const smallGrid = (flip = false) => {
        const pieces = grid(6, (i, j) => i === 2 && j === 2).map(p => ({positions: p.positions.map(x => x / 10), indices: p.indices.slice()}));
        if (flip){
            for (const p of pieces){
                for (let t = 0; t < p.indices.length; t += 3){
                    const uses = [0, 1, 2].some(k => Math.abs(p.positions[3 * p.indices[t + k]] - 0.3) < 1e-6 && Math.abs(p.positions[3 * p.indices[t + k] + 1] - 0.3) < 1e-6);
                    if (uses) [p.indices[t + 1], p.indices[t + 2]] = [p.indices[t + 2], p.indices[t + 1]];
                }
            }
        }
        return weld(pieces);
    };

    test("a hole under the paint is filled though the triangles at its far side face away", () => {
        const surface = smallGrid(true);
        const result = applyEdits(surface, [paint("fill", [stroke([[0.25, 0.25, 0]], 0.2)])], applyShape);
        expect(result.fills.length).toBe(1);
        // Behind the surface (painted from below, every triangle facing up), nothing is filled
        expect(applyEdits(smallGrid(), [paint("fill", [stroke([[0.25, 0.25, 0]], 0.2, [0, 0, -1])])], applyShape).fills.length).toBe(0);
    });

    test("a speck under the paint is filled though its loop turns as a rim does (a real one, from a roof)", () => {
        // speck.json: a check model's triangles around a 4-edge gap that holes's winding test takes for a piece's rim
        // (its rim pinches nearby), in metres from the gap's middle, and the view it was painted from
        const { positions, indices, loop, view } = speck;
        const surface = weld([{positions: Float32Array.from(positions), indices: Uint32Array.from(indices)}]);
        const ring = new Set(loop.map(c => surface.vertexOf[0][c]));
        const result = applyEdits(surface, [paint("fill", [stroke([[0, 0, 0]], 0.3, view)])], applyShape);
        expect(result.fills.some(f => f.ring.length === ring.size && f.ring.every(v => ring.has(v)))).toBe(true);
        // Fill Holes, which goes by the winding alone, leaves it
        const whole = applyEdits(surface, [{type: "holes", size: 50}], applyShape);
        expect(whole.fills.some(f => f.ring.length === ring.size && f.ring.every(v => ring.has(v)))).toBe(false);
    });

    test("a long thin hole under the paint is filled though its rim turns as an outer rim does (a real one, from a roof)", () => {
        // thinhole.json: a model's triangles within 25 cm of a 15-edge hole 34 cm long (wider than the brush), whose
        // crumpled rim turns as a piece's outer rim does; in metres from its middle, with a stroke along its rim and
        // the view it was painted from. The surface beside it goes on past the paint, so it is no piece's outer rim
        const { positions, indices, loop, points, view } = thinHole;
        const surface = weld([{positions: Float32Array.from(positions), indices: Uint32Array.from(indices)}]);
        const ring = new Set(loop.map(c => surface.vertexOf[0][c]));
        const same = f => f.ring.length === ring.size && f.ring.every(v => ring.has(v));
        expect(applyEdits(surface, [paint("fill", [stroke(points, 0.1, view)])], applyShape).fills.some(same)).toBe(true);
        // Fill Holes, which goes by the winding alone, leaves it
        expect(applyEdits(surface, [{type: "holes", size: 50}], applyShape).fills.some(same)).toBe(false);
        // A piece wholly under the paint keeps its outer rim open (the grid painted all over: only its hole is filled)
        const piece = weld(grid(4, (i, j) => i === 1 && j === 1));
        const all = applyEdits(piece, [paint("fill", [stroke([[2, 2, 0]], 10)])], applyShape);
        expect(all.fills.map(f => f.ring.length)).toEqual([4]);
    });

    test("a hole whose rim runs on past the paint is filled where it closes as seen from the stroke (a real one, from a roof)", () => {
        // neckhole.json: a model's triangles within 90 cm of a dab over a hole 30 cm across, in metres from the dab,
        // with the dab and the view it was painted from. The hole's rim goes on down a wall 64 cm deep and away as a
        // seam under the surface, closing no loop; seen along the view it comes back to within 3 cm of itself
        const { positions, indices, loop, points, radius, view } = neckHole;
        const surface = weld([{positions: Float32Array.from(positions), indices: Uint32Array.from(indices)}]);
        const ring = new Set(loop.map(c => surface.vertexOf[0][c]));
        const over = fills => fills.filter(f => f.ring.filter(v => ring.has(v)).length >= ring.size - 2);
        const painted = applyEdits(surface, [paint("fill", [stroke(points, radius, view)])], applyShape);
        expect(over(painted.fills).length).toBe(1);
        // laid out across the view, as it is seen
        const normal = over(painted.fills)[0].plane.normal, length = Math.hypot(...view);
        expect(Math.abs(normal[0] * view[0] + normal[1] * view[1] + normal[2] * view[2]) / length).toBeCloseTo(1, 6);
        // Clone fills it too
        const cloned = applyEdits(surface, [paint("clone", [stroke(points, radius, view)], {source: [0.3, 0, 0], target: [0, 0, 0], normal: view})], applyShape);
        expect(over(cloned.fills).length).toBe(1);
    });

    test("a rim running straight on past the paint closes nothing (no neck)", () => {
        // The grid's outer edge along y = 0 under a stroke: no two of its vertices come close across the view
        const surface = weld(grid(6));
        expect(applyEdits(surface, [paint("fill", [stroke([[1, 0.1, 0], [4, 0.1, 0]], 0.6)])], applyShape).fills).toEqual([]);
    });

    test("a flap touching the surface at one vertex is not capped when painted over, though the surface goes on past the paint", () => {
        // A square flap lifted off a 10-m grid, sharing one of its corners: its outer rim turns as a piece's does
        const flap = {positions: Float32Array.from([5, 5, 0, 5.8, 5.2, 0.3, 5.8, 5.8, 0.4, 5.2, 5.8, 0.3]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3])};
        const surface = weld([...grid(10), flap]);
        expect(surface.count).toBe(121 + 3);
        const result = applyEdits(surface, [paint("fill", [stroke([[5.5, 5.5, 0]], 1)])], applyShape);
        expect(result.fills).toEqual([]);
    });

    test("painting over every hole fills those Fill Holes fills (holes found from the painted edges only)", () => {
        const surface = weld(grid(6, (i, j) => (i === 1 && j === 1) || (i === 4 && j === 3) || (i === 3 && j === 4)));
        const painted = applyEdits(surface, [paint("fill", [stroke([[3, 3, 0]], 10)])], applyShape);
        const whole = applyEdits(surface, [{type: "holes", size: 50}], applyShape);
        expect(painted.fills.map(f => [...f.ring].sort())).toEqual(whole.fills.map(f => [...f.ring].sort()));
        expect(painted.fills.length).toBe(3);  // the two touching at a corner are two (a pinched rim)
    });

    test("a clone painted in several strokes copies from the same offset in each of their pieces, in one frame", () => {
        const model = textured();
        const surface = weld(model);
        const strokes = [stroke([[4.5, 4.5, 0], [4.5, 3.5, 0]], 0.6), stroke([[3.5, 4.5, 0], [3.5, 3.5, 0]], 0.6)];
        const result = applyEdits(surface, [paint("clone", strokes, {source: [1.5, 1.5, 0], target: [4.5, 4.5, 0], normal: up, feather: 0})], applyShape);
        expect(result.clones.length).toBeGreaterThan(2);  // the strokes cut into pieces, one clone each
        const atlas = cloneAtlas(surface, model, result, sample);
        const p = atlas.piece.positions, uv = atlas.piece.uvs;
        const colourAt = (x, y) => {
            for (let t = 0; t < p.length / 9; t++){
                const [ax, ay, bx, by, cx, cy] = [p[9 * t], p[9 * t + 1], p[9 * t + 3], p[9 * t + 4], p[9 * t + 6], p[9 * t + 7]];
                const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area, wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area, wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                const u = uv[6 * t] * wa + uv[6 * t + 2] * wb + uv[6 * t + 4] * wc, v = uv[6 * t + 1] * wa + uv[6 * t + 3] * wb + uv[6 * t + 5] * wc;
                const i = 4 * (Math.floor(v * atlas.height) * atlas.width + Math.floor(u * atlas.width));
                return Array.from(atlas.rgba.slice(i, i + 2));
            }
            return null;
        };
        for (const [x, y] of [[4.6, 4.2], [3.4, 3.8], [3.9, 4.1], [4.1, 3.7]]){
            const colour = colourAt(x, y);
            expect(colour[0]).toBeCloseTo((x - 3) / 6 * 255, -0.7);
            expect(colour[1]).toBeCloseTo((y - 3) / 6 * 255, -0.7);
        }
    });

    test("the preview answers as applyEdits does as strokes are added", () => {
        const surface = weld(textured((i, j) => i === 2 && j === 2));
        const preview = createPreview(surface, applyShape);
        const strokes = [stroke([[2.5, 2.5, 0]], 1.4), stroke([[1, 4.5, 0], [4, 4.5, 0]], 0.4), stroke([[3, 1, 0]], 1)];
        const summary = r => ({kept: Array.from(r.kept), positions: Array.from(r.positions), fills: r.fills.map(f => f.ring), moved: r.moved});
        for (const op of ["fill", "delete", "raise", "smooth"]){
            for (let k = 1; k <= strokes.length; k++){
                const list = [paint(op, strokes.slice(0, k), {amount: 0.1})];
                expect(summary(preview(list))).toEqual(summary(applyEdits(surface, list, applyShape)));
            }
        }
    });
});
