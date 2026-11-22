// The Edit Splats page's 3D view (templates/editor.html): the task's trained model loaded whole by Spark, the edits
// drawn over it, and the splats they remove hidden, by the same rule Apply cuts with (editShapes.js). A plain ES
// module that the browser loads through the page's import map: three.js and Spark are vendored in public/vendor,
// not built by webpack. The panel (Editor.jsx) drives it.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { SparkRenderer, SplatMesh, utils } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { keepMask, applyShape, boundaryMask, framing, round, strokeRing, brushStroke, colourEdit, colourMatrix, plyPositions, BRUSH_SIZES } from "../editShapes.js";
import { weld, applyEdits, fillColours, fillAtlas, splitFills, sampleImage, cloneSource, cloneRegions, cloneAtlas, sampleRegion, regionRect } from "../meshEdits.js";

const SAMPLE_SIZE = 256;  // texels: the copy of each texture the fills' colours come from (as meshApply.mjs's)

const DRACO_DECODER = "/plugins/splatme/vendor/draco/";  // three.js's own, vendored (WebODM's is too old for it)

const CLICK_PIXELS = 5;  // a press that moves less than this is a click, not a turn of the view
const CORNER_PIXELS = 10;  // a click this close to the first corner closes the polygon
const STROKE_PIXELS = 3;  // a lasso's corners at least this far apart
const PICK_PIXELS = 12;  // how far from the pointer a double click finds a splat to centre on
const BRUSH_STEP = 1.25;  // the [ and ] keys' change of the brush's size

// A colour of WebODM's theme (theme.css), read from an element given one of its classes: no colour is set here
// The file at url, whole, telling onProgress({loaded, total}) as it comes
async function fetchBytes(url, onProgress){
    const res = await fetch(url, {credentials: "same-origin"});
    if (!res.ok) throw new Error(res.status === 404 ? "The trained model is gone, or you may not edit it." : "The request failed (" + res.status + ").");
    const total = parseInt(res.headers.get("Content-Length") || "0", 10) || 0;
    const reader = res.body.getReader();
    let bytes = new Uint8Array(total || 1 << 20), loaded = 0;
    for (;;){
        const { done, value } = await reader.read();
        if (done) break;
        if (loaded + value.length > bytes.length){  // no length given, or a wrong one: grown
            const more = new Uint8Array(Math.max(bytes.length * 2, loaded + value.length));
            more.set(bytes.subarray(0, loaded));
            bytes = more;
        }
        bytes.set(value, loaded);
        loaded += value.length;
        if (onProgress) onProgress({loaded, total});
    }
    return loaded === bytes.length ? bytes : bytes.slice(0, loaded);
}

function themeColor(container, className, property){
    const probe = document.createElement("span");
    probe.className = className;
    probe.style.display = "none";
    container.appendChild(probe);
    const value = getComputedStyle(probe)[property];
    container.removeChild(probe);
    return new THREE.Color(value && value !== "rgba(0, 0, 0, 0)" ? value : getComputedStyle(container).color);
}

function lineMaterial(color){
    // Over the splats, always: they are drawn without depth for the lines to hide behind
    return new THREE.LineBasicMaterial({color, depthTest: false, transparent: true});
}

// handlers: onBoxChange(index, box) while a box is dragged, onPolygon(ring) when one is closed, onCorners(count)
// while one is drawn, onLasso({ring, view, camera}) when a lasso is drawn, onLassoEnd() when lasso drawing stops,
// onBrushStroke({stroke, view, aspect, camera}) for each brush stroke, onBrushSize(pixels) when a key changes the
// brush's size, onBrushEnd() when painting stops, onModelMasked(removed, floating) when the textured model's
// edits have been shown (triangles)
export function createViewer(container, handlers){
    const colors = {
        keep: themeColor(container, "theme-background-success", "backgroundColor"),
        remove: themeColor(container, "theme-background-failed", "backgroundColor"),
    };
    const renderer = new THREE.WebGLRenderer({antialias: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    scene.add(new SparkRenderer({renderer}));
    const shapes = new THREE.Group();
    shapes.renderOrder = 10;
    scene.add(shapes);
    const transform = new TransformControls(camera, canvas);
    transform.setSpace("local");
    scene.add(transform.getHelper());

    let mesh = null, xs, ys, zs, opacity, shown, keep, base = null, frame = null, floaters = null;
    // The task's textured model, when this view shows it instead of splats: {group, meshes, pieces, surface, kept}
    let model = null;
    let rgb = null, colourShown = "";  // the splats' colours as trained; the Colour Adjust shown ("": none)
    let edits = [], selected = -1, handles = [], maskQueued = false;
    let drawing = null;  // {corners: [[x, y]], line}
    let placing = null;  // Straighten's line being placed: {first: its first end (Vector3) or null, object}
    let dragging = null;  // an end of the picked edit's Straighten line being dragged: {end: 0 or 1}
    let lasso = null;  // {points: [[x, y] in pixels], down}
    let brush = null;  // {size: pixels across, points: [[x, y] in pixels], down, at: [x, y] the pointer, or null}
    // The lasso's stroke, drawn on a flat canvas over the view
    const overlay = document.createElement("canvas");
    overlay.style.cssText = "position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; display: none;";
    container.appendChild(overlay);

    function resize(){
        const width = container.clientWidth, height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });

    // The model's triangles each edit removes hidden, by meshEdits.js's rule (the one Update the Model runs): each
    // piece drawn with the triangles kept only, its corners where Flatten moved them
    function applyModelMask(){
        // While Straighten's line is placed, the edit it is for is left out: what it hid can be clicked on
        const shown = placing && placing.skip >= 0 ? edits.filter((_e, i) => i !== placing.skip) : edits;
        const result = applyEdits(model.surface, shown, applyShape);
        model.kept = result;
        if (result.moved || model.moved){
            model.meshes.forEach((m, k) => {
                const ids = model.surface.vertexOf[k], attribute = m.geometry.attributes.position, array = attribute.array;
                for (let c = 0; c < ids.length; c++){
                    const v = 3 * ids[c];
                    array[3 * c] = result.positions[v];
                    array[3 * c + 1] = result.positions[v + 1];
                    array[3 * c + 2] = result.positions[v + 2];
                }
                attribute.needsUpdate = true;
                m.geometry.computeBoundingSphere();
                m.geometry.computeBoundingBox();
            });
            model.moved = result.moved > 0;
        }
        showFills(result);
        showClones(result);
        if (selected >= 0 && edits[selected] && edits[selected].source) drawShapes();  // its source square follows the surface
        const lists = model.pieces.map(() => []);
        const { pieceOf, localOf } = model.surface;
        for (let f = 0; f < result.kept.length; f++) if (result.kept[f] && result.cloneOf[f] < 0) lists[pieceOf[f]].push(localOf[f]);
        model.meshes.forEach((m, k) => {
            const source = model.pieces[k].indices, list = lists[k];
            const index = new Uint32Array(list.length * 3);
            for (let j = 0; j < list.length; j++){
                const t = 3 * list[j];
                index[3 * j] = source[t];
                index[3 * j + 1] = source[t + 1];
                index[3 * j + 2] = source[t + 2];
            }
            m.geometry.setIndex(new THREE.BufferAttribute(index, 1));
            m.visible = list.length > 0;
        });
        if (handlers.onModelMasked) handlers.onModelMasked(result.removed, result.floating);
    }

    // A small copy of piece k's texture (SAMPLE_SIZE square, RGBA), made once; null for a piece with none
    function textureCopy(k){
        if (!model.copies.has(k)){
            const image = model.meshes[k].material && model.meshes[k].material.map && model.meshes[k].material.map.image;
            let copy = null;
            if (image){
                const canvas2 = document.createElement("canvas");
                canvas2.width = canvas2.height = SAMPLE_SIZE;
                const context = canvas2.getContext("2d", {willReadFrequently: true});
                context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                copy = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
            }
            model.copies.set(k, copy);
        }
        return model.copies.get(k);
    }

    // A part of piece k's texture at full size, read once: {rgba, x0, y0, w, h, width, height} (sampleRegion's)
    function textureRegion(k, r){
        const image = model.meshes[k].material && model.meshes[k].material.map && model.meshes[k].material.map.image;
        if (!image) return null;
        const rect = regionRect(r, image.width, image.height);
        const key = k + ":" + rect.x0 + "," + rect.y0 + "," + rect.w + "," + rect.h;
        if (!model.regions.has(key)){
            const canvas2 = document.createElement("canvas");
            canvas2.width = rect.w;
            canvas2.height = rect.h;
            const context = canvas2.getContext("2d", {willReadFrequently: true});
            context.drawImage(image, rect.x0, rect.y0, rect.w, rect.h, 0, 0, rect.w, rect.h);
            model.regions.set(key, {...rect, rgba: context.getImageData(0, 0, rect.w, rect.h).data, width: image.width, height: image.height});
        }
        return model.regions.get(key);
    }

    // The triangles Clone Texture covers, drawn with the texture Update the Model makes for them
    function showClones(result){
        if (model.clones){
            model.clones.parent.remove(model.clones);
            model.clones.geometry.dispose();
            model.clones.material.map.dispose();
            model.clones.material.dispose();
            model.clones = null;
        }
        if (!result.clones.length && !splitFills(result.fills).detailed.length) return;
        const regions = new Map();
        for (const [k, r] of cloneRegions(model.surface, model.pieces, result)){
            const region = textureRegion(k, r);
            if (region) regions.set(k, region);
        }
        const atlas = cloneAtlas(model.surface, model.pieces, result, (k, u, v) => regions.has(k) ? sampleRegion(regions.get(k), u, v) : [128, 128, 128]);
        if (!atlas) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(atlas.piece.positions, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(atlas.piece.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(atlas.piece.indices, 1));
        const map = new THREE.DataTexture(new Uint8Array(atlas.rgba.buffer), atlas.width, atlas.height, THREE.RGBAFormat);
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = map.minFilter = THREE.LinearFilter;
        map.needsUpdate = true;
        model.clones = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({map, side: THREE.DoubleSide}));
        model.meshes[0].parent.add(model.clones);
    }

    // A clone's source: a square on the surface's plane, its size across, about the point picked
    function sourceObject(edit){
        if (!model || !model.kept) return null;
        const source = cloneSource(model.surface, model.kept.positions, model.kept.kept, edit);
        if (!source) return null;
        const c = new THREE.Vector3(...source.point), u = new THREE.Vector3(...source.u).multiplyScalar(source.half);
        const v = new THREE.Vector3(...source.v).multiplyScalar(source.half);
        const corners = [c.clone().sub(u).sub(v), c.clone().add(u).sub(v), c.clone().add(u).add(v), c.clone().sub(u).add(v)];
        const object = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), lineMaterial(colors.keep));
        object.renderOrder = 10;
        return object;
    }

    // The holes the edits fill, drawn with the texture Update the Model makes for them
    function showFills(result){
        if (model.fills){
            model.fills.parent.remove(model.fills);
            model.fills.geometry.dispose();
            model.fills.material.map.dispose();
            model.fills.material.dispose();
            model.fills = null;
        }
        const smooth = splitFills(result.fills).smooth;  // the wider ones are textured as clones are
        if (!smooth.length) return;
        const colours = fillColours(model.surface, model.pieces, smooth, (k, u, v) => {
            const copy = textureCopy(k);
            return copy ? sampleImage(copy, SAMPLE_SIZE, u, v) : [128, 128, 128];
        });
        const atlas = fillAtlas(smooth, colours, result.positions);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(atlas.piece.positions, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(atlas.piece.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(atlas.piece.indices, 1));
        const map = new THREE.DataTexture(new Uint8Array(atlas.rgba.buffer), atlas.width, atlas.height, THREE.RGBAFormat);
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = map.minFilter = THREE.LinearFilter;
        map.needsUpdate = true;
        model.fills = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({map, side: THREE.DoubleSide}));
        model.meshes[0].parent.add(model.fills);
    }

    // The splats each edit removes hidden (opacity 0), the others as trained
    function applyMask(){
        maskQueued = false;
        if (model){
            applyModelMask();
            return;
        }
        if (!mesh) return;
        keepMask(xs, ys, zs, edits, keep, base, floaters);
        const packed = mesh.packedSplats.packedArray, encoding = mesh.packedSplats.splatEncoding;
        let changed = false;
        for (let i = 0; i < keep.length; i++){
            if (keep[i] !== shown[i]){
                utils.setPackedSplatOpacity(packed, i, keep[i] ? opacity[i] : 0, encoding);
                shown[i] = keep[i];
                changed = true;
            }
        }
        if (recolour(packed, encoding)) changed = true;
        if (changed){
            mesh.packedSplats.needsUpdate = true;
            mesh.updateVersion();
        }
    }

    // The edits' Colour Adjust on the trained colours, when it changed: answers whether it did. The view's light
    // that changes with the angle stays as trained (Apply adjusts it too)
    function recolour(packed, encoding){
        const adjust = colourEdit(edits);
        const change = adjust ? colourMatrix(adjust) : null;
        const key = change ? JSON.stringify(change) : "";
        if (key === colourShown) return false;
        const { m, t } = change || {m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]};
        for (let i = 0, j = 0; i < rgb.length / 3; i++, j += 3){
            const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2];
            utils.setPackedSplatRgb(packed, i, m[0] * r + m[1] * g + m[2] * b + t[0], m[3] * r + m[4] * g + m[5] * b + t[1],
                m[6] * r + m[7] * g + m[8] * b + t[2], encoding);
        }
        colourShown = key;
        return true;
    }

    function queueMask(){
        if (maskQueued) return;
        maskQueued = true;
        requestAnimationFrame(applyMask);
    }

    function heights(){
        return frame ? [frame.min[2] - frame.size[2] * 0.25, frame.max[2] + frame.size[2] * 0.25] : [0, 1];
    }

    // A box: an outline of a unit cube in an object placed, sized and turned as the box, which the handles move
    function boxObject(edit){
        const object = new THREE.Object3D();
        object.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), lineMaterial(edit.keep ? colors.keep : colors.remove)));
        object.position.set(...edit.center);
        object.scale.set(...edit.size);
        object.rotation.set(0, 0, edit.turn * Math.PI / 180);
        return object;
    }

    // A lasso: its ring where it meets the depth of the model's middle, seen from its view
    function lassoObject(edit){
        const view = new THREE.Matrix4().fromArray(edit.view);
        const back = view.clone().invert();
        const middle = frame ? new THREE.Vector3(...frame.center) : new THREE.Vector3();
        const depth = middle.applyMatrix4(view).z;
        const points = edit.ring.map(([x, y]) => new THREE.Vector3(x, y, depth).applyMatrix4(back));
        return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(edit.keep ? colors.keep : colors.remove));
    }

    // A brush: each stroke's line where it meets the depth of the model's middle, seen from its view (a stroke of
    // one point: its circle)
    function brushObject(edit){
        const view = new THREE.Matrix4().fromArray(edit.view);
        const back = view.clone().invert();
        const middle = frame ? new THREE.Vector3(...frame.center) : new THREE.Vector3();
        const depth = middle.applyMatrix4(view).z;
        const group = new THREE.Group();
        for (const stroke of edit.strokes){
            let points = stroke.points;
            if (points.length === 1){
                const [x, y] = points[0];
                points = Array.from({length: 24}, (_v, k) => {
                    const a = k / 24 * Math.PI * 2;
                    return [x + Math.cos(a) * stroke.size / edit.aspect, y + Math.sin(a) * stroke.size];
                });
            }
            const line = points.map(([x, y]) => new THREE.Vector3(x, y, depth).applyMatrix4(back));
            const geometry = new THREE.BufferGeometry().setFromPoints(line);
            const color = edit.restore ? colors.keep : colors.remove;
            group.add(stroke.points.length === 1 ? new THREE.LineLoop(geometry, lineMaterial(color)) : new THREE.Line(geometry, lineMaterial(color)));
        }
        return group;
    }

    // A polygon: its ring drawn at the bottom and the top of the model, joined at each corner
    function polygonObject(edit){
        const [low, high] = heights();
        const points = [];
        edit.ring.forEach((p, i) => {
            const q = edit.ring[(i + 1) % edit.ring.length];
            points.push(p[0], p[1], low, q[0], q[1], low, p[0], p[1], high, q[0], q[1], high, p[0], p[1], low, p[0], p[1], high);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        return new THREE.LineSegments(geometry, lineMaterial(edit.keep ? colors.keep : colors.remove));
    }

    function clearGroup(group){
        for (const child of [...group.children]){
            group.remove(child);
            child.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        }
    }

    function drawShapes(){
        transform.detach();
        clearGroup(shapes);
        handles = edits.map((edit, i) => {
            // Floaters, Colour Adjust and the model's whole-model edits have no shape: an empty group keeps the
            // handles numbered as the edits
            const object = edit.type === "box" ? boxObject(edit) : edit.type === "lasso" ? lassoObject(edit) :
                edit.type === "brush" ? brushObject(edit) : edit.type === "polygon" ? polygonObject(edit) : new THREE.Group();
            // Only the edit picked in the list shows its shape: the others show only in what they hide
            object.visible = i === selected;
            object.renderOrder = 10;
            object.traverse(o => { o.renderOrder = 10; });
            shapes.add(object);
            return object;
        });
        // The picked edit's Straighten line, apart from its shape (a box's object is scaled and turned)
        const picked = selected >= 0 ? edits[selected] : null;
        if (picked && picked.line) shapes.add(lineObject(new THREE.Vector3(...picked.line[0]), new THREE.Vector3(...picked.line[1])));
        if (picked && picked.source){
            const square = sourceObject(picked);
            if (square) shapes.add(square);
        }
        if (selected >= 0 && edits[selected] && edits[selected].type === "box") transform.attach(handles[selected]);
    }

    // Straighten's line: a line between its ends, each end a dot
    function lineObject(a, b){
        const group = new THREE.Group();
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMaterial(colors.keep)));
        const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints([a, b]),
            new THREE.PointsMaterial({color: colors.keep, size: 10, sizeAttenuation: false, depthTest: false, transparent: true}));
        group.add(dots);
        group.traverse(o => { o.renderOrder = 10; });
        return group;
    }

    // The model's surface under the pointer (its fills included), or null
    function surfacePoint(event){
        if (!model) return null;
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const targets = model.meshes.filter(m => m.visible);
        if (model.fills) targets.push(model.fills);
        const hit = raycaster.intersectObjects(targets, false)[0];
        return hit ? hit.point.clone() : null;
    }

    // Where the pointer is on the plane through a point that faces the view (for a line off the model)
    function facingPoint(event, through){
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const normal = camera.getWorldDirection(new THREE.Vector3());
        return raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through), new THREE.Vector3());
    }

    // An end of the picked edit's line within reach of the pointer on screen: 0, 1 or -1
    function lineEndAt(event){
        const edit = selected >= 0 ? edits[selected] : null;
        if (!edit || !edit.line) return -1;
        const rect = canvas.getBoundingClientRect();
        camera.updateMatrixWorld();
        for (const end of [0, 1]){
            const p = new THREE.Vector3(...edit.line[end]).project(camera);
            const x = (p.x + 1) / 2 * rect.width, y = (1 - p.y) / 2 * rect.height;
            if (Math.hypot(x - (event.clientX - rect.left), y - (event.clientY - rect.top)) <= CORNER_PIXELS) return end;
        }
        return -1;
    }

    // Placing Straighten's line: a click on the model drops its first end, a line follows the pointer from it, and
    // a second click ends it (onLine(line)); the view still turns between clicks
    // skip: the edit the line is for, left out of the view meanwhile; count: its points (1: a single point, Clone
    // Texture's source)
    function startLine(skip = -1, count = 2){
        endBrush();
        cancelPolygon();
        cancelLasso();
        cancelLine();
        transform.detach();
        placing = {first: null, object: null, skip, count};
        canvas.style.cursor = "crosshair";
        if (skip >= 0) queueMask();
    }
    function cancelLine(){
        if (!placing) return;
        if (placing.object){
            scene.remove(placing.object);
            clearGroup(placing.object);
        }
        const skipped = placing.skip >= 0;
        placing = null;
        canvas.style.cursor = "";
        drawShapes();
        if (skipped) queueMask();
        if (handlers.onLineEnd) handlers.onLineEnd();
    }
    function drawPlacing(to){
        if (placing.object){
            scene.remove(placing.object);
            clearGroup(placing.object);
        }
        placing.object = lineObject(placing.first, to || placing.first);
        scene.add(placing.object);
    }
    function placeLine(event){
        const point = surfacePoint(event);
        if (!point) return;
        if (placing.count === 1){
            cancelLine();
            if (handlers.onLine) handlers.onLine([point.toArray().map(round)]);
            return;
        }
        if (!placing.first){
            placing.first = point;
            drawPlacing(null);
            return;
        }
        const line = [placing.first, point].map(v => v.toArray().map(round));
        cancelLine();
        if (handlers.onLine) handlers.onLine(line);
    }

    // The dragged box back as an edit: its turn only about the vertical (the view's own ring may tilt it)
    transform.addEventListener("objectChange", () => {
        const object = transform.object;
        const index = handles.indexOf(object);
        if (index < 0) return;
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
        const turn = Math.atan2(axis.y, axis.x);
        object.rotation.set(0, 0, turn);
        const box = {
            ...edits[index],
            center: object.position.toArray().map(round),
            size: object.scale.toArray().map(v => Math.max(round(Math.abs(v)), 0.01)),
            turn: round(((turn * 180 / Math.PI) % 360 + 360) % 360)
        };
        edits[index] = box;
        queueMask();
        if (handlers.onBoxChange) handlers.onBoxChange(index, box);
    });
    transform.addEventListener("dragging-changed", e => { controls.enabled = !e.value; });

    // Drawing a polygon: a click adds a corner where it meets the ground (a level plane through the model's middle)
    const pointer = {x: 0, y: 0, down: false};
    function groundPoint(event){
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(frame ? frame.center[2] : 0));
        const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        return hit ? [round(hit.x), round(hit.y)] : null;
    }
    function screenOf(corner){
        const v = new THREE.Vector3(corner[0], corner[1], frame ? frame.center[2] : 0).project(camera);
        const rect = canvas.getBoundingClientRect();
        return [(v.x + 1) / 2 * rect.width + rect.left, (1 - v.y) / 2 * rect.height + rect.top];
    }
    function near(corner, event, pixels){
        const [x, y] = screenOf(corner);
        return Math.hypot(x - event.clientX, y - event.clientY) < pixels;
    }
    function drawDrawing(){
        if (drawing.line){
            shapes.remove(drawing.line);
            drawing.line.geometry.dispose();
            drawing.line.material.dispose();
        }
        // On the plane the clicks meet, so that it is under the pointer from any side
        const z = frame ? frame.center[2] : 0;
        const geometry = new THREE.BufferGeometry().setFromPoints(drawing.corners.map(p => new THREE.Vector3(p[0], p[1], z)));
        drawing.line = new THREE.Line(geometry, lineMaterial(colors.keep));
        drawing.line.renderOrder = 11;
        shapes.add(drawing.line);
        if (handlers.onCorners) handlers.onCorners(drawing.corners.length);
    }
    function drawStroke(){
        const rect = canvas.getBoundingClientRect();
        overlay.width = rect.width;
        overlay.height = rect.height;
        const context = overlay.getContext("2d");
        context.clearRect(0, 0, overlay.width, overlay.height);
        if (!lasso || lasso.points.length < 2) return;
        context.strokeStyle = "#" + colors.remove.getHexString();
        context.lineWidth = 2;
        context.beginPath();
        lasso.points.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
        context.closePath();
        context.stroke();
    }
    // The brush's stroke as it is painted, and its circle under the pointer
    function drawBrush(){
        const rect = canvas.getBoundingClientRect();
        overlay.width = rect.width;
        overlay.height = rect.height;
        const context = overlay.getContext("2d");
        context.clearRect(0, 0, overlay.width, overlay.height);
        if (!brush) return;
        const color = "#" + (brush.restore ? colors.keep : colors.remove).getHexString();
        if (brush.points.length){
            context.globalAlpha = 0.4;
            context.strokeStyle = color;
            context.lineWidth = brush.size;
            context.lineCap = "round";
            context.lineJoin = "round";
            context.beginPath();
            brush.points.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
            if (brush.points.length === 1) context.lineTo(brush.points[0][0] + 0.01, brush.points[0][1]);
            context.stroke();
            context.globalAlpha = 1;
        }
        if (brush.at){
            context.strokeStyle = color;
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(brush.at[0], brush.at[1], brush.size / 2, 0, Math.PI * 2);
            context.stroke();
        }
    }
    function endBrushStroke(){
        const rect = canvas.getBoundingClientRect();
        const stroke = brushStroke(brush.points, rect.width, rect.height, brush.size, Math.max(2, brush.size / 8));
        brush.points = [];
        brush.down = false;
        drawBrush();
        camera.updateMatrixWorld();
        const view = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray();
        const shot = {position: camera.position.toArray().map(round), target: controls.target.toArray().map(round)};
        if (handlers.onBrushStroke) handlers.onBrushStroke({stroke, view, aspect: Math.round(rect.width / rect.height * 1e6) / 1e6, camera: shot});
    }
    function strokePoint(event){
        const rect = canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }
    function onPointerMove(event){
        if (placing && placing.first){
            drawPlacing(surfacePoint(event) || facingPoint(event, placing.first));
            return;
        }
        if (dragging){
            const point = surfacePoint(event);
            if (!point) return;
            const edit = {...edits[selected], line: edits[selected].line.slice()};
            edit.line[dragging.end] = point.toArray().map(round);
            edits[selected] = edit;
            drawShapes();
            return;
        }
        if (brush){
            brush.at = strokePoint(event);
            if (brush.down) brush.points.push(brush.at);
            drawBrush();
            return;
        }
        if (!lasso || !lasso.down) return;
        lasso.points.push(strokePoint(event));
        drawStroke();
    }
    function endStroke(){
        const rect = canvas.getBoundingClientRect();
        const ring = strokeRing(lasso.points, rect.width, rect.height, STROKE_PIXELS);
        if (ring.length < 3){
            lasso.points = [];
            lasso.down = false;
            drawStroke();
            return;  // a click, not a loop: draw again
        }
        camera.updateMatrixWorld();
        const view = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray();
        const shot = {position: camera.position.toArray().map(round), target: controls.target.toArray().map(round)};
        cancelLasso();
        if (handlers.onLasso) handlers.onLasso({ring, view, camera: shot});
    }
    function onPointerDown(event){
        if (brush){
            brush.down = true;
            brush.at = strokePoint(event);
            brush.points = [brush.at];
            canvas.setPointerCapture(event.pointerId);
            drawBrush();
            return;
        }
        if (lasso){
            lasso.down = true;
            lasso.points = [strokePoint(event)];
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        if (!placing && !drawing){
            const end = lineEndAt(event);
            if (end >= 0){
                dragging = {end};
                controls.enabled = false;
                canvas.setPointerCapture(event.pointerId);
                return;
            }
        }
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.down = true;
    }
    function onPointerUp(event){
        if (dragging){
            dragging = null;
            controls.enabled = true;
            queueMask();
            if (handlers.onLineChange) handlers.onLineChange(selected, edits[selected].line);
            return;
        }
        if (placing){
            const click = pointer.down && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= CLICK_PIXELS;
            pointer.down = false;
            if (click) placeLine(event);
            return;
        }
        if (brush){
            if (brush.down) endBrushStroke();
            return;
        }
        if (lasso && lasso.down){
            endStroke();
            return;
        }
        if (!pointer.down || !drawing) return;
        pointer.down = false;
        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > CLICK_PIXELS) return;  // the view turned
        const corners = drawing.corners;
        if (corners.length >= 3 && near(corners[0], event, CORNER_PIXELS)){
            finishPolygon();
            return;
        }
        if (corners.length && near(corners[corners.length - 1], event, CLICK_PIXELS)) return;  // a double click's second
        const point = groundPoint(event);
        if (!point) return;
        corners.push(point);
        drawDrawing();
    }
    // A touch the system took over (a gesture, a call): the stroke is dropped
    function onPointerCancel(){
        if (brush && brush.down){
            brush.down = false;
            brush.points = [];
            drawBrush();
        } else if (lasso && lasso.down){
            lasso.down = false;
            lasso.points = [];
            drawStroke();
        }
        pointer.down = false;
    }
    function onDoubleClick(event){
        if (drawing){
            if (drawing.corners.length >= 3) finishPolygon();
            return;
        }
        if (!lasso && !brush) centreOn(event);
    }
    // A double click with no tool: the view moves (not turns) so that the nearest splat shown under the pointer is
    // its centre, which it then turns about
    function centreOn(event){
        if (model){
            centreOnModel(event);
            return;
        }
        if (!mesh || !shown) return;
        const rect = canvas.getBoundingClientRect();
        const px = event.clientX - rect.left, py = event.clientY - rect.top;
        camera.updateMatrixWorld();
        const e = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
        const reach = PICK_PIXELS * PICK_PIXELS;
        let best = -1, bestDepth = Infinity;
        for (let i = 0; i < shown.length; i++){
            if (!shown[i]) continue;
            const x = xs[i], y = ys[i], z = zs[i];
            const w = e[3] * x + e[7] * y + e[11] * z + e[15];
            if (w <= 0 || w >= bestDepth) continue;
            const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2 * rect.width - px;
            const sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2 * rect.height - py;
            if (sx * sx + sy * sy > reach) continue;
            best = i;
            bestDepth = w;
        }
        if (best < 0) return;
        const point = new THREE.Vector3(xs[best], ys[best], zs[best]);
        camera.position.add(point.clone().sub(controls.target));
        controls.target.copy(point);
        controls.update();
    }
    // The same for the textured model: the surface under the pointer
    function centreOnModel(event){
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(model.meshes.filter(m => m.visible), false)[0];
        if (!hit) return;
        camera.position.add(hit.point.clone().sub(controls.target));
        controls.target.copy(hit.point);
        controls.update();
    }
    function onPointerLeave(){
        if (brush && !brush.down){
            brush.at = null;
            drawBrush();
        }
    }
    function onKey(event){
        if (placing && event.key === "Escape") cancelLine();
        if (lasso && event.key === "Escape") cancelLasso();
        if (brush){
            if (event.key === "Escape") endBrush();
            else if (event.key === "[" || event.key === "]"){
                const size = Math.round(Math.min(Math.max(brush.size * (event.key === "]" ? BRUSH_STEP : 1 / BRUSH_STEP), BRUSH_SIZES[0]), BRUSH_SIZES[1]));
                setBrushSize(size);
                if (handlers.onBrushSize) handlers.onBrushSize(size);
            }
        }
        if (!drawing) return;
        if (event.key === "Escape"){
            cancelPolygon();
            if (handlers.onCorners) handlers.onCorners(null);  // as Cancel does
        } else if (event.key === "Enter") finishPolygon();
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKey);

    // Drawing a lasso: the view holds still while the pointer draws around what to cut, and letting go closes it
    function startLasso(){
        cancelLine();
        endBrush();
        cancelPolygon();
        cancelLasso();
        transform.detach();
        controls.enabled = false;
        lasso = {points: [], down: false};
        overlay.style.display = "block";
        drawStroke();
    }
    function cancelLasso(){
        if (!lasso) return;
        lasso = null;
        controls.enabled = true;
        overlay.style.display = "none";
        drawShapes();
        if (handlers.onLassoEnd) handlers.onLassoEnd();
    }
    // Painting with the brush: the view holds still while strokes are painted, each letting go one stroke, until
    // endBrush (Done or Escape)
    function startBrush(size, restore){
        cancelLine();
        cancelPolygon();
        cancelLasso();
        endBrush();
        transform.detach();
        controls.enabled = false;
        brush = {size, restore: !!restore, points: [], down: false, at: null};
        overlay.style.display = "block";
        canvas.style.cursor = "crosshair";
        drawBrush();
    }
    function setBrushSize(size){
        if (!brush) return;
        brush.size = size;
        drawBrush();
    }
    // The Brush between removing and restoring (the Restore Brush): only the cursor's colour changes here
    function setBrushRestore(restore){
        if (!brush) return;
        brush.restore = !!restore;
        drawBrush();
    }
    function endBrush(){
        if (!brush) return;
        brush = null;
        controls.enabled = true;
        overlay.style.display = "none";
        canvas.style.cursor = "";
        drawShapes();
        if (handlers.onBrushEnd) handlers.onBrushEnd();
    }
    // The camera back where a lasso or a brush was drawn
    function goTo(shot){
        if (!shot) return;
        camera.position.set(...shot.position);
        controls.target.set(...shot.target);
        controls.update();
    }

    function startPolygon(){
        cancelLine();
        endBrush();
        cancelLasso();
        cancelPolygon();
        transform.detach();
        drawing = {corners: [], line: null};
        topView();
        if (handlers.onCorners) handlers.onCorners(0);
    }
    function cancelPolygon(){
        if (!drawing) return;
        if (drawing.line){
            shapes.remove(drawing.line);
            drawing.line.geometry.dispose();
            drawing.line.material.dispose();
        }
        drawing = null;
        drawShapes();
    }
    function finishPolygon(){
        if (!drawing || drawing.corners.length < 3) return;
        const ring = drawing.corners.slice();
        cancelPolygon();
        if (handlers.onPolygon) handlers.onPolygon(ring);
    }

    // Views: from the side and above, framing the middle of the model; and straight down
    function place(offset){
        if (!frame) return;
        const [cx, cy, cz] = frame.center;
        const span = Math.max(frame.size[0], frame.size[1], frame.size[2]);
        camera.near = span / 1000;
        camera.far = span * 50;
        camera.position.set(cx + offset[0] * span, cy + offset[1] * span, cz + offset[2] * span);
        controls.target.set(cx, cy, cz);
        camera.updateProjectionMatrix();
        controls.update();
    }
    function frameView(){
        place([0, -0.8, 0.8]);
    }
    function topView(){
        place([0, -0.001, 1.3]);
    }

    return {
        // The model at url, loaded whole, with what the task's boundary leaves out hidden (boundary: polygons of
        // rings, empty for none): answers {splats, frame, outside} (outside: how many the boundary hides)
        async load(url, onProgress, boundary){
            const bytes = await fetchBytes(url, onProgress);
            // The positions as Apply reads them, before Spark takes the bytes (it may hand them to its worker)
            const positions = plyPositions(bytes);
            mesh = new SplatMesh({fileBytes: bytes, fileType: "ply"});
            scene.add(mesh);
            await mesh.initialized;
            const n = mesh.packedSplats.numSplats;
            if (n !== positions.count) throw new Error("The trained model read as " + n + " splats, not the " + positions.count + " of its header.");
            ({xs, ys, zs} = positions);
            opacity = new Float32Array(n);
            rgb = new Float32Array(n * 3);
            mesh.forEachSplat((i, center, scales, quaternion, alpha, color) => {
                opacity[i] = alpha;
                rgb[3 * i] = color.r;
                rgb[3 * i + 1] = color.g;
                rgb[3 * i + 2] = color.b;
            });
            shown = new Uint8Array(n).fill(1);
            keep = new Uint8Array(n);
            base = boundaryMask(xs, ys, boundary);
            const outside = base ? n - base.reduce((a, b) => a + b, 0) : 0;
            frame = framing(xs, ys, zs);
            frameView();
            drawShapes();
            queueMask();
            return {splats: n, frame, outside};
        },
        // The task's textured model (WebODM's GLB, at url) instead of splats, loaded whole: answers {triangles,
        // frame}. Its pieces are welded into one surface (meshEdits.js), which the edits then cut.
        async loadModel(url, onProgress){
            const bytes = await fetchBytes(url, onProgress);
            const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_DECODER));
            const gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer, "", resolve, reject));
            const meshes = [];
            gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
            const pieces = meshes.map(m => ({
                positions: m.geometry.attributes.position.array, indices: m.geometry.index.array.slice(),
                uvs: m.geometry.attributes.uv ? m.geometry.attributes.uv.array : null}));
            const surface = weld(pieces);
            model = {group: gltf.scene, meshes, pieces, surface, kept: null, copies: new Map(), fills: null, clones: null, regions: new Map()};
            scene.add(gltf.scene);
            const n = surface.count;
            xs = new Float64Array(n);
            ys = new Float64Array(n);
            zs = new Float64Array(n);
            for (let i = 0; i < n; i++){
                xs[i] = surface.positions[3 * i];
                ys[i] = surface.positions[3 * i + 1];
                zs[i] = surface.positions[3 * i + 2];
            }
            frame = framing(xs, ys, zs);
            frameView();
            drawShapes();
            queueMask();
            return {triangles: surface.faces.length / 3, frame};
        },
        // What the model's edits do now: {removed, floating, added} triangles, flattened points and filled holes (null
        // before the model shows)
        modelResult(){
            return model && model.kept ? {removed: model.kept.removed, floating: model.kept.floating, flattened: model.kept.flattened, moved: model.kept.moved, cloned: model.kept.cloned,
                filled: model.kept.fills.length, added: model.kept.added} : null;
        },
        // The edits to show, and which one has the handles (-1: none)
        setEdits(list, index){
            edits = list.map(edit => ({...edit}));
            selected = index;
            drawShapes();
            queueMask();
        },
        // The splats the edits' floaters are, by their numbers in the model (null: none): answers how many of them
        // the boundary leaves, which are those Apply removes for them
        setFloaters(numbers){
            floaters = numbers;
            queueMask();
            return numbers ? numbers.filter(i => !base || base[i]).length : 0;
        },
        // A Colour Adjust's sliders moved: only the colours change (the splats hidden stay as they are)
        setColour(edit){
            const index = edits.findIndex(e => e.type === "colour");
            if (index < 0) return;
            edits[index] = {...edit};
            requestAnimationFrame(() => {
                if (mesh && recolour(mesh.packedSplats.packedArray, mesh.packedSplats.splatEncoding)){
                    mesh.packedSplats.needsUpdate = true;
                    mesh.updateVersion();
                }
            });
        },
        // What the handles do: "translate" (move), "scale" (size) or "rotate" (turn, about the vertical only)
        setMode(mode){
            transform.setMode(mode);
            transform.showX = transform.showY = mode !== "rotate";
        },
        // A picture of the view as it is, without the shapes and handles: a promise of a JPEG Blob at most width
        // pixels across (null when there is no model, or the browser could not make it)
        capture(width){
            return new Promise(resolve => {
                if (!mesh) return resolve(null);
                const helper = transform.getHelper();
                const was = [shapes.visible, helper.visible];
                shapes.visible = helper.visible = false;
                renderer.render(scene, camera);
                // Copied before the browser shows the frame, which clears the drawing buffer
                const w = Math.min(width, canvas.width), h = Math.max(1, Math.round(canvas.height * w / canvas.width));
                const out = document.createElement("canvas");
                out.width = w;
                out.height = h;
                out.getContext("2d").drawImage(canvas, 0, 0, w, h);
                [shapes.visible, helper.visible] = was;
                out.toBlob(resolve, "image/jpeg", 0.8);
            });
        },
        // How many splats the edits leave
        keptCount(){
            return shown ? shown.reduce((a, b) => a + b, 0) : 0;
        },
        startPolygon, cancelPolygon, finishPolygon, startLasso, cancelLasso, startLine, cancelLine, startBrush, setBrushSize, setBrushRestore, endBrush, goTo, frameView, topView,
        dispose(){
            renderer.setAnimationLoop(null);
            observer.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("dblclick", onDoubleClick);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            window.removeEventListener("keydown", onKey);
            transform.dispose();
            controls.dispose();
            clearGroup(shapes);
            if (mesh) mesh.dispose();
            if (model){
                model.group.traverse(o => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material){
                        if (o.material.map) o.material.map.dispose();
                        o.material.dispose();
                    }
                });
            }
            renderer.dispose();
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
    };
}
