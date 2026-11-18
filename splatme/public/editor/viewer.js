// The Edit Splats page's 3D view (templates/editor.html): the task's trained model loaded whole by Spark, the edits
// drawn over it, and the splats they remove hidden, by the same rule Apply cuts with (editShapes.js). A plain ES
// module that the browser loads through the page's import map: three.js and Spark are vendored in public/vendor,
// not built by webpack. The panel (Editor.jsx) drives it.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { SparkRenderer, SplatMesh, utils } from "@sparkjsdev/spark";
import { keepMask, boundaryMask, framing, round } from "../editShapes.js";

const CLICK_PIXELS = 5;  // a press that moves less than this is a click, not a turn of the view
const CORNER_PIXELS = 10;  // a click this close to the first corner closes the polygon

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
// while one is drawn
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

    let mesh = null, xs, ys, zs, opacity, shown, keep, base = null, frame = null;
    let edits = [], selected = -1, handles = [], maskQueued = false;
    let drawing = null;  // {corners: [[x, y]], line}

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
        keepMask(xs, ys, zs, edits, keep, base);
        const packed = mesh.packedSplats.packedArray, encoding = mesh.packedSplats.splatEncoding;
        let changed = false;
        for (let i = 0; i < keep.length; i++){
            if (keep[i] !== shown[i]){
                utils.setPackedSplatOpacity(packed, i, keep[i] ? opacity[i] : 0, encoding);
                shown[i] = keep[i];
                changed = true;
            }
        }
        if (changed){
            mesh.packedSplats.needsUpdate = true;
            mesh.updateVersion();
        }
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
        handles = edits.map(edit => {
            const object = edit.type === "box" ? boxObject(edit) : polygonObject(edit);
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
    function onPointerDown(event){
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.down = true;
    }
    function onPointerUp(event){
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
    function onKey(event){
        if (!drawing) return;
        if (event.key === "Escape") cancelPolygon();
        else if (event.key === "Enter") finishPolygon();
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("keydown", onKey);

    function startPolygon(){
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
            mesh.forEachSplat((i, center, scales, quaternion, alpha) => {
                xs[i] = center.x;
                ys[i] = center.y;
                zs[i] = center.z;
                opacity[i] = alpha;
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
        // What the handles do: "translate" (move), "scale" (size) or "rotate" (turn, about the vertical only)
        setMode(mode){
            transform.setMode(mode);
            transform.showX = transform.showY = mode !== "rotate";
        },
        // How many splats the edits leave
        keptCount(){
            return shown ? shown.reduce((a, b) => a + b, 0) : 0;
        },
        startPolygon, cancelPolygon, finishPolygon, frameView, topView,
        dispose(){
            renderer.setAnimationLoop(null);
            observer.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("dblclick", onDoubleClick);
            window.removeEventListener("keydown", onKey);
            transform.dispose();
            controls.dispose();
            clearGroup(shapes);
            if (mesh) mesh.dispose();
            renderer.dispose();
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        }
    };
}
