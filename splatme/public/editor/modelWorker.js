// The textured model's edits worked out away from the page (a module Web Worker started by viewer.js), so that the
// view never freezes while they are: the preview (meshEdits.js's createPreview, the rule Update the Model uses), the
// textures of the fills and clones, and each piece's triangles to draw. Only the latest list of edits is worked on:
// one sent while another is worked on replaces any still waiting.
//
// Messages in: {type: "load", modules: {meshEdits, editShapes} (their URLs, versioned as the page's import map gives
// them: a worker has no import map), pieces: [{positions, indices, uvs}], images: [ImageBitmap or null]} once, then
// {type: "edits", seq, edits}. Out: {type: "loaded", surface}, {type: "result", seq, ...} (see answerFor) or
// {type: "error", seq, message}.
let weld, createPreview, fillColours, fillAtlas, splitFills, sampleImage, cloneParts, packParts, applyShape;

const SAMPLE_SIZE = 256;  // texels: the copy of each texture the smooth fills' colours come from (as meshApply.mjs's)
const TILE = 256;  // texels: the squares of a texture read at a time, when first needed
const CHUNK = 8;  // metres: the squares (from above) the clones' and wide fills' texture is drawn in, each apart, so
                  // that an edit sends and the view uploads again only the squares it changed

let model = null;  // {pieces, surface, preview, cache, images, copies, regions}
let waiting = null, working = false;

self.onmessage = async event => {
    const message = event.data;
    if (message.type === "load"){
        try {
            ({ weld, createPreview, fillColours, fillAtlas, splitFills, sampleImage, cloneParts, packParts } = await import(message.modules.meshEdits));
            ({ applyShape } = await import(message.modules.editShapes));
        } catch (e){
            self.postMessage({type: "error", seq: 0, message: String(e && e.stack || e)});
            return;
        }
        const surface = weld(message.pieces);
        model = {pieces: message.pieces, surface, preview: createPreview(surface, applyShape), cache: new Map(),
            images: message.images, copies: new Map(), tiles: new Map(), moved: false, sent: new Map(),
            sentIndices: [], sentCorners: []};
        self.postMessage({type: "loaded", surface: {count: surface.count, faces: surface.faces, positions: surface.positions,
            vertexOf: surface.vertexOf, pieceOf: surface.pieceOf, localOf: surface.localOf}});
        if (waiting && !working) work();
        return;
    }
    if (message.type === "edits"){
        waiting = message;
        if (model && !working) work();
    }
};

function work(){
    working = true;
    while (waiting){
        const { seq, edits } = waiting;
        waiting = null;
        try {
            const { answer, transfer } = answerFor(edits);
            self.postMessage({type: "result", seq, ...answer}, transfer);
        } catch (e){
            self.postMessage({type: "error", seq, message: String(e && e.stack || e)});
        }
    }
    working = false;
}

// A canvas holding piece k's texture, to read parts of
function textureContext(k){
    const image = model.images[k];
    if (!image) return null;
    if (!model.canvases) model.canvases = new Map();
    if (!model.canvases.has(k)){
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d", {willReadFrequently: true});
        context.drawImage(image, 0, 0);
        model.canvases.set(k, context);
    }
    return model.canvases.get(k);
}

// A small copy of piece k's texture (SAMPLE_SIZE square, RGBA), made once; null for a piece with none
function textureCopy(k){
    if (!model.copies.has(k)){
        const image = model.images[k];
        let copy = null;
        if (image){
            const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
            const context = canvas.getContext("2d", {willReadFrequently: true});
            context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
            copy = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        }
        model.copies.set(k, copy);
    }
    return model.copies.get(k);
}

// Piece k's texture at full size, its colour at u, v: bilinear, clamped to its edge (as meshApply.mjs reads it,
// sampleRegion over the parts it needs). The texels are read a TILE square at a time, when first needed.
function sampleTexture(k, u, v){
    const image = model.images[k];
    if (!image) return [128, 128, 128];
    const { width, height } = image;
    const fx = u * width - 0.5, fy = v * height - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const out = [0, 0, 0];
    for (let n = 0; n < 4; n++){
        const dx = n & 1, dy = n >> 1;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        if (!w) continue;
        const x = Math.min(width - 1, Math.max(0, x0 + dx)), y = Math.min(height - 1, Math.max(0, y0 + dy));
        const tile = tileAt(k, x, y, width, height);
        const i = 4 * ((y % TILE) * tile.w + (x % TILE));
        out[0] += tile.rgba[i] * w;
        out[1] += tile.rgba[i + 1] * w;
        out[2] += tile.rgba[i + 2] * w;
    }
    return out;
}
// The TILE square of piece k's texture holding texel x, y: read when first needed
function tileAt(k, x, y, width, height){
    let grid = model.tiles.get(k);
    if (!grid){
        grid = {columns: Math.ceil(width / TILE), tiles: []};
        model.tiles.set(k, grid);
    }
    const cx = (x / TILE) | 0, cy = (y / TILE) | 0, at = cy * grid.columns + cx;
    let tile = grid.tiles[at];
    if (!tile){
        const w = Math.min(TILE, width - cx * TILE), h = Math.min(TILE, height - cy * TILE);
        tile = grid.tiles[at] = {w, rgba: textureContext(k).getImageData(cx * TILE, cy * TILE, w, h).data};
    }
    return tile;
}

// A list's numbers as one, to tell whether it changed (with its length, collisions do not matter in practice)
function listHash(list){
    let h1 = 0x811c9dc5 | 0, h2 = 0;
    for (let i = 0; i < list.length; i++){
        h1 = Math.imul(h1 ^ list[i], 16777619);
        h2 = (h2 + Math.imul(list[i] | 0, i + 1)) | 0;
    }
    return h1 + "." + h2;
}

// An atlas as the view draws it: its triangles' positions, uvs and indices, its texture's size and texels
function atlasOut(atlas, transfer){
    if (!atlas) return null;
    transfer.push(atlas.piece.positions.buffer, atlas.piece.uvs.buffer, atlas.piece.indices.buffer, atlas.rgba.buffer);
    return {positions: atlas.piece.positions, uvs: atlas.piece.uvs, indices: atlas.piece.indices, width: atlas.width, height: atlas.height, rgba: atlas.rgba};
}

// The edits' result for the view: what each piece draws (its triangles' corners, and its corners' places when the
// edits moved any), the fills and clones as atlases, the counts the panel shows, and kept and positions for the
// view's own use (the source square, the stamp)
function answerFor(edits){
    const { surface, pieces } = model;
    const timing = {}, t0 = performance.now();
    let mark = t0;
    const lap = name => { const now = performance.now(); timing[name] = Math.round(now - mark); mark = now; };
    const result = model.preview(edits);
    lap("edits");
    const transfer = [];
    // Each piece's kept triangles that no clone took
    const lists = pieces.map(() => []);
    const { pieceOf, localOf } = surface;
    for (let f = 0; f < result.kept.length; f++) if (result.kept[f] && result.cloneOf[f] < 0) lists[pieceOf[f]].push(localOf[f]);
    // Only the pieces whose triangles changed since the last answer (null: as before)
    const indices = pieces.map((piece, k) => {
        const list = lists[k], signature = list.length + ":" + listHash(list);
        if (model.sentIndices[k] === signature) return null;
        model.sentIndices[k] = signature;
        const source = piece.indices;
        const index = new Uint32Array(list.length * 3);
        for (let j = 0; j < list.length; j++){
            const t = 3 * list[j];
            index[3 * j] = source[t];
            index[3 * j + 1] = source[t + 1];
            index[3 * j + 2] = source[t + 2];
        }
        transfer.push(index.buffer);
        return index;
    });
    lap("indices");
    // The pieces' corners where the edits put them, when any moved (or moved before: back where they were)
    let corners = null;
    if (result.moved || model.moved){
        // Only the pieces whose corners changed since the last answer (null: as before)
        corners = pieces.map((_piece, k) => {
            const ids = surface.vertexOf[k], array = new Float32Array(ids.length * 3);
            for (let c = 0; c < ids.length; c++){
                const v = 3 * ids[c];
                array[3 * c] = result.positions[v];
                array[3 * c + 1] = result.positions[v + 1];
                array[3 * c + 2] = result.positions[v + 2];
            }
            const signature = listHash(new Int32Array(array.buffer));
            if (model.sentCorners[k] === signature) return null;
            model.sentCorners[k] = signature;
            transfer.push(array.buffer);
            return array;
        });
        model.moved = result.moved > 0;
    }
    lap("corners");
    // The smooth fills, coloured from around them
    const smooth = splitFills(result.fills).smooth;
    let fills = null;
    if (smooth.length){
        const colours = fillColours(surface, pieces, smooth, (k, u, v) => {
            const copy = textureCopy(k);
            return copy ? sampleImage(copy, SAMPLE_SIZE, u, v) : [128, 128, 128];
        });
        fills = atlasOut(fillAtlas(smooth, colours, result.positions), transfer);
    }
    lap("fills");
    // The clones and the wider fills, textured from the model's own texture, in CHUNK squares: those whose parts
    // changed since the last answer sent again ({changed: [{key, atlas}], kept: [keys]}; the view drops the rest)
    const groups = new Map();
    if (result.clones.length || splitFills(result.fills).detailed.length){
        for (const part of cloneParts(surface, pieces, result, sampleTexture, model.cache)){
            const key = Math.floor(part.centre[0] / CHUNK) + "," + Math.floor(part.centre[1] / CHUNK);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(part);
        }
    }
    const clones = {changed: [], kept: []};
    for (const [key, parts] of groups){
        const signature = parts.map(part => part.key).join("\n");
        if (model.sent.get(key) === signature) clones.kept.push(key);
        else {
            clones.changed.push({key, atlas: atlasOut(packParts(parts, result.positions), transfer)});
            model.sent.set(key, signature);
        }
    }
    for (const key of [...model.sent.keys()]) if (!groups.has(key)) model.sent.delete(key);
    lap("clones");
    const kept = result.kept;
    transfer.push(kept.buffer);
    // The vertices where the edits put them, only when they moved any (the view has them as they were)
    const positions = corners ? Float64Array.from(result.positions) : null;
    if (positions) transfer.push(positions.buffer);
    return {
        answer: {indices, corners, fills, clones, kept, positions, timing,
            counts: {removed: result.removed, floating: result.floating, flattened: result.flattened, moved: result.moved, cloned: result.cloned,
                filled: result.fills.length, added: result.added}},
        transfer,
    };
}
