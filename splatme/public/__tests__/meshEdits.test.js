import { weld, openEdges, loops, components, applyEdits, editedPieces, centres } from "../meshEdits";
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
