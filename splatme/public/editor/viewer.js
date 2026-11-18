// The Edit Splats page's 3D view (templates/editor.html): the task's trained model loaded whole by Spark, the edits
// drawn over it, and the splats they remove hidden, by the same rule Apply cuts with (editShapes.js). A plain ES
// module that the browser loads through the page's import map: three.js and Spark are vendored in public/vendor,
// not built by webpack. The panel (Editor.jsx) drives it.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { SparkRenderer, SplatMesh, utils } from "@sparkjsdev/spark";
import { keepMask, boundaryMask, framing, round, strokeRing, brushStroke, colourEdit, colourMatrix, BRUSH_SIZES } from "../editShapes.js";

const CLICK_PIXELS = 5;  // a press that moves less than this is a click, not a turn of the view
const CORNER_PIXELS = 10;  // a click this close to the first corner closes the polygon
const STROKE_PIXELS = 3;  // a lasso's corners at least this far apart
const BRUSH_STEP = 1.25;  // the [ and ] keys' change of the brush's size

// A colour of WebODM's theme (theme.css), read from an element given one of its classes: no colour is set here
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
// brush's size, onBrushEnd() when painting stops
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
    let rgb = null, colourShown = "";  // the splats' colours as trained; the Colour Adjust shown ("": none)
    let edits = [], selected = -1, handles = [], maskQueued = false;
    let drawing = null;  // {corners: [[x, y]], line}
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

    // The splats each edit removes hidden (opacity 0), the others as trained
    function applyMask(){
        maskQueued = false;
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
            group.add(stroke.points.length === 1 ? new THREE.LineLoop(geometry, lineMaterial(colors.remove)) : new THREE.Line(geometry, lineMaterial(colors.remove)));
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
            // Floaters and Colour Adjust have no shape: an empty group keeps the handles numbered as the edits
            const object = edit.type === "box" ? boxObject(edit) : edit.type === "lasso" ? lassoObject(edit) :
                edit.type === "brush" ? brushObject(edit) : edit.type === "floaters" || edit.type === "colour" ? new THREE.Group() : polygonObject(edit);
            // Only the edit picked in the list shows its shape: the others show only in what they hide
            object.visible = i === selected;
            object.renderOrder = 10;
            object.traverse(o => { o.renderOrder = 10; });
            shapes.add(object);
            return object;
        });
        if (selected >= 0 && edits[selected] && edits[selected].type === "box") transform.attach(handles[selected]);
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
        const color = "#" + colors.remove.getHexString();
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
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.down = true;
    }
    function onPointerUp(event){
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
    function onDoubleClick(){
        if (drawing && drawing.corners.length >= 3) finishPolygon();
    }
    function onPointerLeave(){
        if (brush && !brush.down){
            brush.at = null;
            drawBrush();
        }
    }
    function onKey(event){
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
        if (event.key === "Escape") cancelPolygon();
        else if (event.key === "Enter") finishPolygon();
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKey);

    // Drawing a lasso: the view holds still while the pointer draws around what to cut, and letting go closes it
    function startLasso(){
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
    function startBrush(size){
        cancelPolygon();
        cancelLasso();
        endBrush();
        transform.detach();
        controls.enabled = false;
        brush = {size, points: [], down: false, at: null};
        overlay.style.display = "block";
        canvas.style.cursor = "crosshair";
        drawBrush();
    }
    function setBrushSize(size){
        if (!brush) return;
        brush.size = size;
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
            mesh = new SplatMesh({url, onProgress});
            scene.add(mesh);
            await mesh.initialized;
            const n = mesh.packedSplats.numSplats;
            xs = new Float32Array(n);
            ys = new Float32Array(n);
            zs = new Float32Array(n);
            opacity = new Float32Array(n);
            rgb = new Float32Array(n * 3);
            mesh.forEachSplat((i, center, scales, quaternion, alpha, color) => {
                xs[i] = center.x;
                ys[i] = center.y;
                zs[i] = center.z;
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
        // How many splats the edits leave
        keptCount(){
            return shown ? shown.reduce((a, b) => a + b, 0) : 0;
        },
        startPolygon, cancelPolygon, finishPolygon, startLasso, cancelLasso, startBrush, setBrushSize, endBrush, goTo, frameView, topView,
        dispose(){
            renderer.setAnimationLoop(null);
            observer.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("dblclick", onDoubleClick);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            window.removeEventListener("keydown", onKey);
            transform.dispose();
            controls.dispose();
            clearGroup(shapes);
            if (mesh) mesh.dispose();
            renderer.dispose();
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
    };
}
