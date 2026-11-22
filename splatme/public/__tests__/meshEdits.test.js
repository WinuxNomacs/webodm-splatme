import { weld, openEdges, loops, components, applyEdits, editedPieces, centres, fitPlane, earClip, fillColours, fillAtlas, sampleImage, planeFrame, cloneAtlas, cloneRegions, sampleRegion, splitFills, stampAxes, insideStamp, createPreview, PREVIEW_STATES, strokeFaces, startEdits } from "../meshEdits";
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

    test("a Move with no offset and no stretch moves no points", () => {
        const surface = weld(grid(4));
        const still = {...middle, op: "move", offset: [0, 0, 0], scale: [1, 1, 1], soft: 0.5};
        expect(applyEdits(surface, [still], applyShape).moved).toBe(0);
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

describe("fills with detail", () => {
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

describe("Clone Texture's stamps", () => {
    // A 4 by 4 grid whose texture's colour says where it is: red x / 4, green y / 4 (of 255)
    const pieces = () => grid(4).map(p => {
        const uvs = new Float32Array(p.positions.length / 3 * 2);
        for (let c = 0; c < p.positions.length / 3; c++){
            uvs[2 * c] = p.positions[3 * c] / 4;
            uvs[2 * c + 1] = p.positions[3 * c + 1] / 4;
        }
        return {...p, uvs};
    });
    const sample = (_piece, u, v) => [u * 255, v * 255, 0];
    const stamp = (center, size, spin = 0) => ({center, normal: [0, 0, 1], size, spin});
    const stamps = list => ({type: "stamps", op: "clone", source: [1, 1, 0], feather: 0, stamps: list});
    // The atlas's colour at a point x, y of the level grid
    function colourAt(atlas, x, y){
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
    }

    test("a stamp covers the points within half its size of its middle along its sides and its plane", () => {
        const level = stamp([0, 0, 0], 1);
        expect(insideStamp(level, 0.45, -0.45, 0)).toBe(true);
        expect(insideStamp(level, 0.55, 0, 0)).toBe(false);
        expect(insideStamp(level, 0, 0, 0.6)).toBe(false);
        const turned = stamp([0, 0, 0], 1, 45);
        expect(insideStamp(turned, 0.45, -0.45, 0)).toBe(false);  // a corner of the level square, outside the turned one
        expect(insideStamp(turned, 0.65, 0, 0)).toBe(true);  // toward a corner of the turned one
        const { n, a, b } = stampAxes([0, 0, 2], 30);
        expect(n).toEqual([0, 0, 1]);
        expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeCloseTo(0);
    });

    test("each stamp clones the triangles under it, a later stamp winning over an earlier", () => {
        const surface = weld(pieces());
        const result = applyEdits(surface, [stamps([stamp([3.5, 2.5, 0], 1), stamp([3.5, 2.5, 0], 1.1)])], applyShape);
        expect(result.cloned).toBe(2);
        expect(result.clones.length).toBe(1);
        expect(result.clones[0].edit.patch).toBe(1.1);
        expect(applyEdits(surface, [stamps([stamp([3.5, 2.5, 0], 1), stamp([0.5, 0.5, 0], 1)])], applyShape).cloned).toBe(4);
    });

    test("a stamp fills the holes whose whole rim it covers, textured in line with the stamp", () => {
        const model = grid(4, (i, j) => i === 2 && j === 2).map(p => {
            const uvs = new Float32Array(p.positions.length / 3 * 2);
            for (let c = 0; c < p.positions.length / 3; c++){
                uvs[2 * c] = p.positions[3 * c] / 4;
                uvs[2 * c + 1] = p.positions[3 * c + 1] / 4;
            }
            return {...p, uvs};
        });
        const surface = weld(model);
        expect(applyEdits(surface, [stamps([stamp([2.5, 2.5, 0], 0.9)])], applyShape).fills.length).toBe(0);  // its rim is not all inside
        const result = applyEdits(surface, [stamps([stamp([2.5, 2.5, 0], 1.2)])], applyShape);
        expect(result.fills.length).toBe(1);
        expect(splitFills(result.fills).detailed.length).toBe(1);
        const atlas = cloneAtlas(surface, model, result, sample);
        for (const [x, y] of [[2.5, 2.5], [2.7, 2.4], [2.3, 2.75]]){
            const colour = colourAt(atlas, x, y);
            expect(colour[0]).toBeCloseTo((1 + x - 2.5) / 4 * 255, -0.7);
            expect(colour[1]).toBeCloseTo((1 + y - 2.5) / 4 * 255, -0.7);
        }
    });

    test("a stamp's patch has its middle where the stamp is, turned with it", () => {
        const model = pieces();
        const surface = weld(model);
        for (const spin of [0, 30, -120]){
            const s = stamp([3.5, 2.5, 0], 2, spin);
            const result = applyEdits(surface, [stamps([s])], applyShape);
            const atlas = cloneAtlas(surface, model, result, sample);
            const { a, b } = stampAxes(s.normal, spin);
            // 0.4 m along the stamp's sides is 0.4 m along the source's (u east, v north on level ground: b runs south at no turn)
            for (const [da, db] of [[0, 0], [0.4, 0], [0, 0.4], [-0.3, 0.2]]){
                const x = 3.5 + da * a[0] + db * b[0], y = 2.5 + da * a[1] + db * b[1];
                const colour = colourAt(atlas, x, y);
                expect(colour[0]).toBeCloseTo((1 + da) / 4 * 255, -0.7);
                expect(colour[1]).toBeCloseTo((1 - db) / 4 * 255, -0.7);
            }
        }
    });
});

describe("the preview", () => {
    // A 6 by 6 grid with two holes, and edits of each kind
    const surface = weld(grid(6, (i, j) => (i === 1 && j === 1) || (i === 4 && j === 3)));
    const box = (center, size) => ({type: "box", keep: false, center, size, turn: 0});
    const edits = {
        remove: {...box([5.5, 5.5, 0], [0.9, 0.9, 1]), op: "delete"},
        move: {...box([3, 3, 0], [2, 2, 1]), op: "move", offset: [0, 0, 0.5], scale: [1, 1, 1], soft: 1},
        smooth: {...box([3, 3, 0], [2, 2, 1]), op: "smooth", passes: 3},
        holes: {type: "holes", size: 10},
        clone: {...box([0.5, 4.5, 0], [0.9, 0.9, 5]), op: "clone", source: [2.5, 0.5, 0], patch: 1, feather: 0, spin: 0},
        stamps: {type: "stamps", op: "clone", source: [2.5, 0.5, 0], feather: 0, stamps: [{center: [1.5, 1.5, 0], normal: [0, 0, 1], size: 1.2, spin: 0}]},
    };
    const summary = r => ({kept: Array.from(r.kept), positions: Array.from(r.positions), removed: r.removed, moved: r.moved, added: r.added,
        fills: r.fills.map(f => [f.ring, !!f.clone]), clones: r.clones.map(c => [c.edit.op, Array.from(c.faces)]), cloned: r.cloned});

    test("answers what applyEdits does, however the list changes", () => {
        const preview = createPreview(surface, applyShape);
        const { remove, move, smooth, holes, clone, stamps } = edits;
        const lists = [[], [remove], [remove, move], [remove, {...move, offset: [0, 0, 1]}], [remove, {...move, offset: [0, 0, 1]}, holes],
            [remove, {...move, offset: [0, 0, 1]}, holes, clone], [remove, smooth, holes, clone], [stamps], [remove, holes, stamps],
            [remove, holes, {...stamps, stamps: [...stamps.stamps, {center: [4.5, 3.5, 0], normal: [0, 0, 1], size: 1.2, spin: 0}]}],
            [remove], [], [holes, move, smooth, clone, remove, stamps], [holes, move, smooth, clone, remove, {...stamps, feather: 0.1}]];
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

    test("painting over every hole fills those Fill Holes fills (holes found from the painted edges only)", () => {
        const surface = weld(grid(6, (i, j) => (i === 1 && j === 1) || (i === 4 && j === 3) || (i === 3 && j === 4)));
        const painted = applyEdits(surface, [paint("fill", [stroke([[3, 3, 0]], 10)])], applyShape);
        const whole = applyEdits(surface, [{type: "holes", size: 50}], applyShape);
        expect(painted.fills.map(f => [...f.ring].sort())).toEqual(whole.fills.map(f => [...f.ring].sort()));
        expect(painted.fills.length).toBe(3);  // the two touching at a corner are two (a pinched rim)
    });

    test("a clone painted in several strokes copies from the same offset in each, in one frame", () => {
        const model = textured();
        const surface = weld(model);
        const strokes = [stroke([[4.5, 4.5, 0], [4.5, 3.5, 0]], 0.6), stroke([[3.5, 4.5, 0], [3.5, 3.5, 0]], 0.6)];
        const result = applyEdits(surface, [paint("clone", strokes, {source: [1.5, 1.5, 0], target: [4.5, 4.5, 0], normal: up, feather: 0})], applyShape);
        expect(result.clones.length).toBe(2);
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
