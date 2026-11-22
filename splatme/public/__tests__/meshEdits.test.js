import { weld, openEdges, loops, components } from "../meshEdits";

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
