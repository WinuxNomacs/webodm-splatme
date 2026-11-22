// Update the Model for a task's textured model (meshes.py runs it in WebODM's worker, with Node): the task's original
// GLB read with WebODM's own gltf-transform and Draco (its package.json, as app/scripts/glbopti.js uses them), its
// edits applied by meshEdits.js (the rule the editor's preview uses), then written as a GLB (Draco, the task's
// CESIUM_RTC kept) and as an OBJ with its MTL, as WebODM's texturing writes them: piece k of the GLB is the MTL's
// k-th material, an OBJ's v is 1 less the GLB's.
//
//   node meshApply.mjs <original.glb> <original.mtl> <edits.json> <out folder>
//
// It writes model.glb, model.obj, model.mtl and report.json ({triangles, removed, floating, flattened, moved, filled,
// added, cloned})
// into the out folder, with FILL_TEXTURE when the edits fill holes and CLONE_TEXTURE when they clone texture (each a
// material of its own after the model's: a JPEG inside the GLB), and exits 1 with the reason on stderr when it cannot. WEBODM_DIR: where WebODM's
// node_modules are (/webodm).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { weld, applyEdits, editedPieces, fillColours, fillAtlas, sampleImage, cloneRegions, cloneAtlas, sampleRegion, regionRect } from './public/meshEdits.js';
import { applyShape } from './public/editShapes.js';

const require = createRequire(path.join(process.env.WEBODM_DIR || '/webodm', 'package.json'));
const { NodeIO, Extension } = require('@gltf-transform/core');
const { KHRONOS_EXTENSIONS } = require('@gltf-transform/extensions');
const { draco, prune } = require('@gltf-transform/functions');
const draco3d = require('draco3dgltf');
const sharp = require('sharp');

const FILL_MATERIAL = 'splatme_fill';
const FILL_TEXTURE = 'odm_textured_model_geo_splatme_fill_map_Kd.png';
const CLONE_MATERIAL = 'splatme_clone';
const CLONE_TEXTURE = 'odm_textured_model_geo_splatme_clone_map_Kd.png';
const SAMPLE_SIZE = 256;  // texels: the copy of each texture the fills' colours come from (as the editor's preview)

// WebODM's GLB is placed by CESIUM_RTC (the task's offset): kept as read
class CesiumRTC extends Extension {
    extensionName = 'CESIUM_RTC';
    static EXTENSION_NAME = 'CESIUM_RTC';
    read(context){ this.rtc = context.jsonDoc.json.extensions?.CESIUM_RTC; }
    write(context){
        if (this.rtc){
            context.jsonDoc.json.extensions = context.jsonDoc.json.extensions || {};
            context.jsonDoc.json.extensions.CESIUM_RTC = this.rtc;
        }
    }
}

// Each corner's normal: the mean of its triangles' normals, weighted by their area
function normals(positions, indices){
    const out = new Float32Array(positions.length);
    for (let t = 0; t < indices.length; t += 3){
        const a = 3 * indices[t], b = 3 * indices[t + 1], c = 3 * indices[t + 2];
        const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [a, b, c]){
            out[i] += nx;
            out[i + 1] += ny;
            out[i + 2] += nz;
        }
    }
    for (let i = 0; i < out.length; i += 3){
        const length = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
        out[i] /= length;
        out[i + 1] /= length;
        out[i + 2] /= length;
    }
    return out;
}

// The OBJ, written in parts (a model's OBJ is around 100 MB): each piece's corners as v, vt and vn of one number
function writeObj(file, mtlName, materials, pieces){
    const fd = fs.openSync(file, 'w');
    const lines = [];
    const flush = () => {
        if (lines.length){
            fs.writeSync(fd, lines.join('\n') + '\n');
            lines.length = 0;
        }
    };
    const put = line => {
        lines.push(line);
        if (lines.length >= 50000) flush();
    };
    const f6 = x => x.toFixed(6);
    put('mtllib ' + mtlName);
    let base = 1;
    for (const piece of pieces){
        if (!piece.indices.length) continue;
        const p = piece.positions, uv = piece.uvs, n = piece.normals;
        for (let i = 0; i < p.length; i += 3) put('v ' + f6(p[i]) + ' ' + f6(p[i + 1]) + ' ' + f6(p[i + 2]));
        for (let i = 0; i < p.length / 3; i++) put('vt ' + f6(uv[2 * i]) + ' ' + f6(1 - uv[2 * i + 1]));
        for (let i = 0; i < n.length; i += 3) put('vn ' + f6(n[i]) + ' ' + f6(n[i + 1]) + ' ' + f6(n[i + 2]));
        put('usemtl ' + materials[piece.piece]);
        const idx = piece.indices;
        for (let t = 0; t < idx.length; t += 3){
            const a = base + idx[t], b = base + idx[t + 1], c = base + idx[t + 2];
            put('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + c + '/' + c + '/' + c);
        }
        base += p.length / 3;
    }
    flush();
    fs.closeSync(fd);
}

async function main(){
    const [glbFile, mtlFile, editsFile, out] = process.argv.slice(2);
    if (!out) throw new Error('usage: node meshApply.mjs <original.glb> <original.mtl> <edits.json> <out folder>');
    const edits = JSON.parse(fs.readFileSync(editsFile, 'utf8'));
    const mtl = fs.readFileSync(mtlFile, 'utf8');
    const materials = mtl.split(/\r?\n/).filter(l => l.startsWith('newmtl ')).map(l => l.slice(7).trim());

    const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).registerExtensions([CesiumRTC]).registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule()});
    const doc = await io.read(glbFile);
    const primitives = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
    if (primitives.length !== materials.length){
        throw new Error(`The model's GLB has ${primitives.length} pieces and its MTL ${materials.length} materials: they do not match.`);
    }
    const pieces = primitives.map(p => ({
        positions: p.getAttribute('POSITION').getArray(), uvs: p.getAttribute('TEXCOORD_0').getArray(), indices: p.getIndices().getArray()}));

    const surface = weld(pieces);
    const result = applyEdits(surface, edits, applyShape);
    const edited = editedPieces(pieces, surface, result);

    // The fills: their colours from small copies of the textures they border, a texture made for them
    const copies = new Map();
    const textureOf = async k => {
        if (!copies.has(k)){
            const texture = primitives[k].getMaterial()?.getBaseColorTexture();
            copies.set(k, texture ? await sharp(Buffer.from(texture.getImage())).resize(SAMPLE_SIZE, SAMPLE_SIZE, {fit: 'fill'})
                .ensureAlpha().raw().toBuffer() : null);
        }
        return copies.get(k);
    };
    const needed = new Set();
    fillColours(surface, pieces, result.fills, k => { needed.add(k); return [0, 0, 0]; });
    for (const k of needed) await textureOf(k);
    const colours = fillColours(surface, pieces, result.fills, (k, u, v) => copies.get(k) ? sampleImage(copies.get(k), SAMPLE_SIZE, u, v) : [128, 128, 128]);
    const fillTexture = fillAtlas(result.fills, colours, result.positions);

    // The clones: the parts of the textures they read, at full size, then a texture made for them
    const regions = new Map();
    for (const [k, r] of cloneRegions(surface, pieces, result)){
        const texture = primitives[k].getMaterial()?.getBaseColorTexture();
        if (!texture) continue;
        const image = sharp(Buffer.from(texture.getImage()));
        const { width, height } = await image.metadata();
        const rect = regionRect(r, width, height);
        const rgba = await image.extract({left: rect.x0, top: rect.y0, width: rect.w, height: rect.h}).ensureAlpha().raw().toBuffer();
        regions.set(k, {...rect, rgba, width, height});
    }
    const cloneTexture = cloneAtlas(surface, pieces, result, (k, u, v) => regions.has(k) ? sampleRegion(regions.get(k), u, v) : [128, 128, 128]);

    // Each made texture a material after the model's, as the first one is (unlit), and a piece of its own
    const extras = [[fillTexture, FILL_MATERIAL, FILL_TEXTURE], [cloneTexture, CLONE_MATERIAL, CLONE_TEXTURE]].filter(([made]) => made);
    for (const [made, name] of extras){
        edited.push({piece: materials.length, ...made.piece});
        materials.push(name);
    }
    for (const piece of edited) piece.normals = normals(piece.positions, piece.indices);

    // The GLB: each primitive's attributes replaced; one left with no triangle goes, its texture with it (prune)
    const buffer = doc.getRoot().listBuffers()[0];
    const accessor = (array, type) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    const base = primitives[0].getMaterial();
    for (const [made, name, file] of extras){
        const raw = {raw: {width: made.width, height: made.height, channels: 4}};
        const jpeg = await sharp(Buffer.from(made.rgba.buffer), raw).jpeg({quality: 90}).toBuffer();
        await sharp(Buffer.from(made.rgba.buffer), raw).png().toFile(path.join(out, file));
        const material = base.clone().setName(name);
        material.setBaseColorTexture(doc.createTexture(name).setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'));
        const primitive = doc.createPrimitive().setMaterial(material);
        doc.getRoot().listMeshes()[0].addPrimitive(primitive);
        primitives.push(primitive);
    }
    edited.forEach(piece => {
        const primitive = primitives[piece.piece];
        if (!piece.indices.length){
            primitive.dispose();
            return;
        }
        primitive.setAttribute('POSITION', accessor(piece.positions, 'VEC3'));
        primitive.setAttribute('NORMAL', accessor(piece.normals, 'VEC3'));
        primitive.setAttribute('TEXCOORD_0', accessor(piece.uvs, 'VEC2'));
        primitive.setIndices(accessor(piece.indices, 'SCALAR'));
    });
    await doc.transform(prune(), draco());
    await io.write(path.join(out, 'model.glb'), doc);

    writeObj(path.join(out, 'model.obj'), 'odm_textured_model_geo.mtl', materials, edited);
    const lines = extras.flatMap(([, name, file]) => ['newmtl ' + name, 'Ka 1.000000 1.000000 1.000000', 'Kd 1.000000 1.000000 1.000000',
        'Ks 0.000000 0.000000 0.000000', 'Tr 0.000000', 'illum 1', 'Ns 1.000000', 'map_Kd ' + file]);
    fs.writeFileSync(path.join(out, 'model.mtl'), lines.length ? mtl.replace(/\s*$/, '\n') + lines.join('\n') + '\n' : mtl);
    const triangles = edited.reduce((sum, p) => sum + p.indices.length / 3, 0);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({triangles, removed: result.removed, floating: result.floating,
        flattened: result.flattened, moved: result.moved, filled: result.fills.length, added: result.added, cloned: result.cloned}));
}

main().catch(e => {
    process.stderr.write(String((e && e.message) || e) + '\n');
    process.exit(1);
});
