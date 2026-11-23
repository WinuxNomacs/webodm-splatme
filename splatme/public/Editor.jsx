import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { request, downloadUrl } from './api';
import { newBox, cleanRing, editLabel, sizeText, applyText, modelText, newHistory, recordChange, undoChange, redoChange, floatersStrength, addStroke, colourEdit, colourText, newColour, LARGE_MODEL, MAX_EDITS, STRENGTHS, BRUSH_SIZES, COLOURS } from './editShapes';
import './Editor.scss';

const SAVE_AFTER = 600;  // ms after the last change before the edits are saved
const POLL = 2000;  // ms between looks at an Apply Edits that runs
const TRAINING_POLL = 10000;  // ms between looks at a training that keeps Apply disabled
const FIELD_NAMES = {center: "Centre", size: "Size", turn: "Turn"};
const AXES = ["X", "Y", "Z"];
const ICONS = {paint: "fa-paint-brush", box: "fa-cube", polygon: "fa-draw-polygon", lasso: "fa-pencil-alt", brush: "fa-paint-brush", floaters: "fa-broom", colour: "fa-palette", floating: "fa-broom", holes: "fa-fill-drip", straighten: "fa-ruler-horizontal"};
const SHAPES = ["box", "polygon", "lasso", "brush"];
// Remove Floating Pieces: the pieces of surface under this many triangles go
const FLOATING_SIZES = [[100, "Small"], [1000, "Medium"], [10000, "Large"]];
// Fill Holes: the holes of up to this many edges are filled
const HOLE_SIZES = [[10, "Small"], [50, "Medium"], [200, "Large"]];
// What the splats' Brush does: its mode, its button and what its panel says
const BRUSH_MODES = [
    ["remove", "Remove", "Paint over what to remove. Everything under the brush on screen goes, through to the back."],
    ["restore", "Restore", "Paint over what to bring back. Everything under the brush on screen that the edits listed before removed comes back, through to the back."],
];
const OPS_SHOWN = ["object", "move"];  // the model's shape edits beside Keep and Remove Inside
// The settings Move and Straighten start with, and their steps: [name, axis or null, label, unit, step, low, high,
// shown as (a factor to show it in the unit)]
const OP_DEFAULTS = {move: {offset: [0, 0, 0], scale: [1, 1, 1], soft: 0.5}, straighten: {strength: 1, reach: 0.3, soft: 0.5, lift: [0, 0]}};
const OP_PARAMS = ["offset", "scale", "soft"];
// The model's Repair buttons: the surface brush's modes (Remove Object's too), a box doing Move, and Straighten's line
const REPAIRS = [
    ["fill", "Fill", "fill-drip", "Paint over holes: those under the paint are filled with the texture beside them"],
    ["clone", "Clone Texture", "clone", "Click a good area on the model, then paint where its texture is needed"],
    ["smooth", "Smooth", "water", "Paint over bumps and broken surface to even it out"],
    ["flatten", "Flatten", "grip-lines", "Paint over a surface to make it flat"],
    ["move", "Move", "arrows-alt", "A box that raises, shifts or stretches what it covers, a step at a time"],
    ["straighten", "Straighten", "ruler-horizontal", "Click points along a broken edge on the model, end to end: it is made straight between its ends"],
    ["object", "Remove Object", "eraser", "Paint over an object to remove it down to the surface it stands on, or outline it with Lasso or Polygon"],
];
// The surface brush's modes (the 3D model's Brush): [mode, label, its edit's op, what it does]
const PAINT_MODES = [
    ["fill", "Fill", "fill", "Paint over holes: each hole whose whole edge is under the paint is filled with the texture beside it."],
    ["clone", "Clone", "clone", "Click the middle of a good area, then paint: the texture is copied from the same distance and direction from the good area as from where you started painting."],
    ["smooth", "Smooth", "smooth", "Paint over bumps and broken surface: each stroke evens it out more."],
    ["flatten", "Flatten", "flatten", "Paint over a surface to make it flat, onto the plane of its edge."],
    ["raise", "Raise", "raise", "Each stroke lifts the surface under it by the step, the most at the middle."],
    ["lower", "Lower", "raise", "Each stroke lowers the surface under it by the step, the most at the middle."],
    ["remove", "Remove", "delete", "Paint over what to remove: only the surface under the circle, never what is behind it."],
    ["restore", "Restore", "restore", "Paint over what to bring back of what the edits before this one removed."],
    ["object", "Remove Object", "object", "Paint over the whole object, its foot too: what stands above the surface round it goes, and the surface under it is laid again with the texture round it."],
];
const PAINT_RADIUS = 0.25;  // metres: the surface brush at first
const PAINT_RADII = [0.02, 5];  // as viewer.js's
const RAISE_STEP = 0.02;  // metres: Raise's and Lower's step at first
const PAINT_REPAIRS = ["fill", "clone", "smooth", "flatten", "object"];  // the Repair buttons that start the surface brush
const paintOp = mode => PAINT_MODES.find(([m]) => m === mode)[2];
const PAINT_NOTES = {fill: "Fills the holes it painted over", clone: "Copies the texture picked where it painted", smooth: "Smooths what it painted over",
    flatten: "Flattens what it painted over", raise: "Raises what it painted over", lower: "Lowers what it painted over",
    delete: "Removes what it painted over", restore: "Brings back what it painted over", object: "Removes the object it painted over and fills where it stood"};
const OP_STEPS = {
    move: [
        ["offset", 2, "Up", "m", 0.05, -100, 100, 1], ["offset", 0, "East", "m", 0.05, -100, 100, 1],
        ["offset", 1, "North", "m", 0.05, -100, 100, 1], ["scale", 0, "Stretch East", "%", 5, 10, 1000, 100],
        ["scale", 1, "Stretch North", "%", 5, 10, 1000, 100], ["scale", 2, "Stretch Up", "%", 5, 10, 1000, 100],
        ["soft", null, "Soft Edge", "m", 0.25, 0, 20, 1],
    ],
    straighten: [["strength", null, "Strength", "%", 10, 0, 100, 100], ["reach", null, "Reach", "m", 0.05, 0.05, 20, 1],
        ["soft", null, "Soft Edge", "m", 0.1, 0, 20, 1], ["lift", 0, "Start Height", "m", 0.05, -20, 20, 1], ["lift", 1, "End Height", "m", 0.05, -20, 20, 1]],
};
// The steps an edit's settings take: Straighten's own, else its op's
const stepsOf = edit => edit.type === "straighten" ? "straighten" : edit.op;
const BRUSH_SIZE = 30;  // the Brush's size at first, in pixels across
const THUMBNAIL_WIDTH = 320;  // the picture of the model on its row in SplatMe → Tasks, in pixels across
const THUMBNAIL_AFTER = 2000;  // ms after the model shows before its picture is taken (the splats settle)

// Edit Splats (templates/editor.html, Edit on a task's row in SplatMe → Tasks): the task's trained model in a 3D view
// (editor/viewer.js, loaded by loadViewer through the page's import map) and this panel beside it, below it on a
// phone. Box, Polygon and Lasso edits keep or remove the splats inside them, the Brush removes those painted over,
// Remove Floaters the splats far from the rest or oversized (found by the server); the view hides what they remove as they change.
// Colour Adjust changes the whole model's colours, shown as its sliders move. They are saved as they are made. Apply makes the task's model again from its trained model with them
// (training.py's Apply Edits), which the 3D view, the download and the share links then show.
class EditorPanel extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        loadViewer: PropTypes.func.isRequired,
        kind: PropTypes.oneOf(["splats", "model"]).isRequired,  // the trained splats, or the textured 3D model
        switcher: PropTypes.node  // Splats or 3D Model, under the heading
    };

    // The API's path for the task: "edits" and "apply" are the splats', "model-edits" and "model-apply" the model's
    path(name){
        return "task/" + this.props.taskId + "/" + (this.isModel() ? "model-" : "") + name;
    }

    isModel(){
        return this.props.kind === "model";
    }

    constructor(props){
        super(props);
        this.floaters = {};  // the server's floaters by strength: a promise of the splats' numbers
        this.state = {
            info: null, error: null, edits: [], selected: -1, mode: "translate", drawing: null, loading: false,
            progress: null, loaded: null, saving: false, saved: true, saveError: null, apply: null, applyError: null,
            starting: false, drafts: {}, lassoing: false, floaters: null, floatersError: null,
            brushing: false, brushSize: BRUSH_SIZE, brushMode: "remove",
            painting: null,  // the surface brush: {mode, radius, step, source, normal}
            history: newHistory()  // the edits before each change, for Undo, and those taken back, for Redo
        };
    }

    componentDidMount(){
        this._mounted = true;
        window.addEventListener("beforeunload", this.handleLeave);
        window.addEventListener("keydown", this.handleKey);
        request("GET", this.path("edits")).then(info => {
            if (!this._mounted) return;
            this.savedEdits = info.edits;
            this.setState({info, edits: info.edits, apply: info.apply});
            if (info.model && info.model.size <= LARGE_MODEL) this.loadModel();
            if (info.apply && info.apply.state === "applying") this.poll();
            if (info.training && !this.isModel()) this.followTraining();
        }).catch(e => {
            if (this._mounted) this.setState({error: e.message});
        });
    }

    componentDidUpdate(_props, prev){
        if (prev.edits !== this.state.edits || prev.loaded !== this.state.loaded) this.showFloaters();
    }

    // The edits' floaters hidden in the view, asked of the server once for each strength
    showFloaters(){
        const strength = floatersStrength(this.state.edits);
        if (!strength){
            if (this.viewer) this.viewer.setFloaters(null);
            if (this.state.floaters || this.state.floatersError) this.setState({floaters: null, floatersError: null});
            return;
        }
        if (!this.state.loaded || (this.state.floaters && this.state.floaters.strength === strength)) return;
        if (!this.floaters[strength]){
            this.floaters[strength] = request("GET", "task/" + this.props.taskId + "/floaters?strength=" + strength);
            this.floaters[strength].catch(() => { delete this.floaters[strength]; });  // asked again on the next change
        }
        this.floaters[strength].then(found => {
            if (!this._mounted || floatersStrength(this.state.edits) !== strength) return;
            const count = this.viewer.setFloaters(found.removed);
            this.setState({floaters: {strength, count}, floatersError: null});
        }).catch(e => {
            // The server's reason says what failed; a request that never got there does not
            const text = e.status ? e.message : _("The floaters could not be found:") + " " + e.message;
            if (this._mounted && floatersStrength(this.state.edits) === strength) this.setState({floatersError: text});
        });
    }

    componentWillUnmount(){
        this._mounted = false;
        window.removeEventListener("beforeunload", this.handleLeave);
        window.removeEventListener("keydown", this.handleKey);
        clearTimeout(this.saveTimer);
        clearTimeout(this.pollTimer);
        clearTimeout(this.trainingTimer);
        clearTimeout(this.thumbnailTimer);
        if (this.viewer) this.viewer.dispose();
    }

    // The browser asks before leaving while edits are not saved yet
    handleLeave = e => {
        if (!this.state.saved){
            e.preventDefault();
            e.returnValue = "";
        }
    };

    // The page's keys, unless typing in a field: Ctrl+Z Undo, Ctrl+Shift+Z or Ctrl+Y Redo, Delete the selected edit,
    // B L P X the Brush, Lasso, Polygon and Box (the view has a tool's own keys: Esc, Enter, [ and ])
    handleKey = e => {
        const target = e.target;
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        const { info, loaded } = this.state;
        if (!info || !info.can_edit || info.editable || !loaded) return;
        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !e.altKey){
            if (key === "z" && !e.shiftKey) this.undo();
            else if ((key === "z" && e.shiftKey) || key === "y") this.redo();
            else return;
            e.preventDefault();
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const action = {delete: () => this.removeSelected(), b: this.brush, l: this.lasso, p: this.drawPolygon, x: this.addBox}[key];
        if (!action) return;
        e.preventDefault();
        action();
    };

    loadModel = () => {
        const { info } = this.state;
        this.setState({loading: true, error: null});
        this.props.loadViewer().then(m => {
            if (!this._mounted) return null;
            this.viewer = m.createViewer(this.view, {
                onBoxChange: this.handleBoxChange,
                onPolygon: this.handlePolygon,
                onCorners: count => this.setState({drawing: count}),
                onLasso: this.handleLasso,
                onLassoEnd: () => this.setState({lassoing: false}),
                onLine: this.handleLine,
                onLineEnd: () => this.setState({lining: false}),
                onLinePoints: linePoints => this.setState({linePoints}),
                onLineChange: this.handleLineChange,
                onBrushStroke: this.handleBrushStroke,
                onBrushSize: brushSize => this.setState({brushSize}),
                onBrushEnd: () => this.setState({brushing: false}),
                onPaintStroke: this.handlePaintStroke,
                onPaintSource: (source, normal) => {
                    this.freshPaint = true;
                    this.setState({painting: this.state.painting && {...this.state.painting, source, normal}});
                },
                onPaintRadius: radius => this.setState({painting: this.state.painting && {...this.state.painting, radius}}),
                onPaintEnd: () => this.setState({painting: null}),
                onModelMasked: (removed, floating) => this.setState({modelResult: {removed, floating}}),
                onModelBusy: modelBusy => this.setState({modelBusy})
            });
            this.viewer.setMode(this.state.mode);
            const progress = e => {
                if (this._mounted && e && e.total) this.setState({progress: Math.round(e.loaded / e.total * 100)});
            };
            return this.isModel() ? this.viewer.loadModel(info.model.url, progress) : this.viewer.load(info.model.url, progress, info.boundary);
        }).then(loaded => {
            if (!this._mounted || !loaded) return;
            this.setState({loading: false, loaded});
            this.viewer.setEdits(this.state.edits, this.state.selected);
            if (this.state.info.applied !== false && !this.isModel()) this.queueThumbnail();
        }).catch(e => {
            if (this._mounted) this.setState({loading: false, error: _("The model did not load:") + " " + ((e && e.message) || e)});
        });
    };

    // After a failed load: the view made anew
    reload = () => {
        if (this.viewer){
            this.viewer.dispose();
            this.viewer = null;
        }
        this.loadModel();
    };

    // A change of the edits from the panel: remembered for Undo (unless it goes on the last change: merge), shown,
    // saved shortly
    change(edits, selected, merge){
        // The model's shapes delete what they cover (meshes.py's op)
        if (this.isModel()){
            edits = edits.map(e => {
                if (!SHAPES.includes(e.type)) return e;
                const op = e.op || "delete";
                return {...OP_DEFAULTS[op], ...e, op};
            });
        }
        const history = merge ? this.state.history : recordChange(this.state.history, this.state.edits);
        this.setState({edits, selected, drafts: {}, history});
        if (this.viewer) this.viewer.setEdits(edits, selected);
        this.queueSave();
    }

    // A box dragged in the view: the view has it already
    handleBoxChange = (index, box) => {
        const now = Date.now();
        // One Undo step for each drag: a change more than a second after the last starts another
        const fresh = this.dragIndex !== index || now - this.dragTime > 1000;
        this.dragIndex = index;
        this.dragTime = now;
        const edits = this.state.edits.slice();
        edits[index] = box;
        this.setState({edits, drafts: {}, history: fresh ? recordChange(this.state.history, this.state.edits) : this.state.history});
        this.queueSave();
    };

    handlePolygon = ring => {
        const clean = cleanRing(ring);
        this.setState({drawing: null});
        if (clean.length < 3) return;
        // A polygon keeps its inside for splats; on the model it removes it (keeping would take nearly all), or the
        // object it outlines
        const op = this.state.outlining ? {op: "object"} : {};
        this.change([...this.state.edits, {type: "polygon", keep: !this.isModel(), ring: clean, ...op}], -1);
    };

    handleLasso = ({ring, view, camera}) => {
        this.setState({lassoing: false});
        const op = this.state.outlining ? {op: "object"} : {};
        this.change([...this.state.edits, {type: "lasso", keep: false, ring, view, camera, ...op}], -1);
    };

    // The tool in use: "lasso", "brush", "polygon" or null
    activeTool(){
        const { lassoing, brushing, drawing, lining, painting } = this.state;
        return lassoing ? "lasso" : brushing || painting ? "brush" : drawing !== null ? "polygon" : lining ? "line" : null;
    }

    // Straighten's traced line, clicks on the model (handleLine): for Straighten edit index, or a new one (-1)
    drawLine(index){
        this.endTool();
        if (!this.viewer) return;
        this.lineIndex = index;
        this.setState({lining: true, linePoints: 0});
        this.viewer.startLine(index);
    }

    handleLine = points => {
        const edits = this.state.edits.slice();
        let index = this.lineIndex;
        this.setState({lining: false});
        if (index < 0){  // the Repair button's: the edit made now
            if (edits.length >= MAX_EDITS) return;
            index = edits.length;
            edits.push({type: "straighten", points, ...OP_DEFAULTS.straighten});
        } else if (edits[index]) edits[index] = {...edits[index], points};
        else return;
        this.change(edits, index);
    };

    // A point of the picked edit's traced line dragged on the model
    handleLineChange = (index, points) => {
        const edits = this.state.edits.slice();
        if (!edits[index]) return;
        edits[index] = {...edits[index], points};
        this.change(edits, this.state.selected);
    };

    // The tool in use stopped as Esc stops it (a polygon's corners and a lasso being drawn are dropped)
    endTool(){
        if (!this.viewer) return;
        this.viewer.cancelLasso();
        this.viewer.endBrush();
        this.viewer.cancelPolygon();
        this.viewer.cancelLine();
        this.viewer.endPaint();
        this.setState({lassoing: false, brushing: false, drawing: null, lining: false, painting: null});
    }

    // A tool's button: ends the tool in use; starts it unless it was the one in use
    canStart(tool){
        const was = this.activeTool();
        this.endTool();
        return was !== tool && !!this.viewer && this.state.info.can_edit && this.state.edits.length < MAX_EDITS;
    }

    // object (true): its outline for Remove Object, started from Remove Object's brush panel
    lasso = object => {
        if (!this.canStart("lasso")) return;
        this.setState({selected: -1, lassoing: true, outlining: object === true});
        this.viewer.startLasso();
    };

    // Painting: the session's strokes go into one edit (Undo takes back the last), until Done
    brush = () => {
        if (this.isModel()){
            if (this.state.painting) this.endTool();
            else this.startPainting(this.lastPaintMode || "fill");
            return;
        }
        if (!this.canStart("brush")) return;
        this.freshBrush = true;
        this.setState({selected: -1, brushing: true});
        this.viewer.startBrush(this.state.brushSize, this.state.brushMode === "restore");
    };

    // What the Brush does (BRUSH_MODES), from its panel: the next stroke starts an edit of its own
    setBrushMode(brushMode){
        if (brushMode === this.state.brushMode) return;
        this.freshBrush = true;
        this.setState({brushMode});
        if (this.viewer) this.viewer.setBrushRestore(brushMode === "restore");
    }

    handleBrushStroke = ({stroke, view, aspect, camera}) => {
        const { edits } = this.state;
        const mode = this.state.brushMode;
        const next = addStroke(edits, stroke, view, aspect, camera, this.freshBrush, mode === "restore");
        if (next.length > edits.length && edits.length >= MAX_EDITS){
            this.viewer.endBrush();
            return;
        }
        this.freshBrush = false;
        this.change(next, -1);
    };

    // The surface brush (the 3D model's Brush and the Repair row's Fill, Clone Texture, Smooth and Flatten): each
    // stroke one Undo, the strokes of a mode in one edit until the mode changes
    startPainting(mode){
        this.endTool();
        const { loaded, info, edits } = this.state;
        if (!this.viewer || !loaded || !info.can_edit || edits.length >= MAX_EDITS) return;
        const last = this.lastPaint || {radius: PAINT_RADIUS, step: RAISE_STEP};
        const painting = {mode, radius: last.radius, step: last.step, source: null, normal: null};
        this.freshPaint = true;
        this.lastPaintMode = mode;
        this.setState({selected: -1, painting});
        this.viewer.startPaint(paintOp(mode), painting.radius, null);
    }

    setPainting(changes){
        const painting = {...this.state.painting, ...changes};
        if (changes.mode && changes.mode !== this.state.painting.mode){
            this.freshPaint = true;
            this.lastPaintMode = changes.mode;
            painting.source = null;
        }
        if (changes.step !== undefined) this.freshPaint = true;  // a new amount: a new edit
        painting.radius = Math.min(PAINT_RADII[1], Math.max(PAINT_RADII[0], Math.round(painting.radius * 1000) / 1000));
        this.lastPaint = {radius: painting.radius, step: painting.step};
        this.setState({painting});
        if (this.viewer) this.viewer.setPaint(paintOp(painting.mode), painting.radius, painting.source);
    }

    handlePaintStroke = (stroke, normal) => {
        const { painting } = this.state;
        if (!painting) return;
        const edits = this.state.edits.slice();
        const op = paintOp(painting.mode), amount = painting.mode === "lower" ? -painting.step : painting.step;
        const last = edits[edits.length - 1];
        const points = last && last.type === "paint" ? last.strokes.reduce((sum, s) => sum + s.points.length, 0) : 0;
        const same = !this.freshPaint && last && last.type === "paint" && last.op === op && last.strokes.length < 500 &&
            points + stroke.points.length <= 20000 && (op !== "raise" || last.amount === amount) &&
            (op !== "clone" || (last.source && painting.source && last.source.join() === painting.source.join()));
        this.lastPaint = {radius: painting.radius, step: painting.step};
        if (same) edits[edits.length - 1] = {...last, strokes: [...last.strokes, stroke]};
        else {
            if (edits.length >= MAX_EDITS) return;
            const edit = {type: "paint", op, strokes: [stroke]};
            if (op === "raise") edit.amount = amount;
            if (op === "clone"){
                if (!painting.source) return;
                Object.assign(edit, {source: painting.source, target: stroke.points[0], normal, feather: 0.02});
            }
            edits.push(edit);
        }
        this.freshPaint = false;
        this.change(edits, -1);
    };

    setBrushSize(brushSize){
        this.setState({brushSize});
        if (this.viewer) this.viewer.setBrushSize(brushSize);
    }

    addFloaters = () => {
        this.endTool();
        const { edits } = this.state;
        if (this.hasFloaters() || edits.length >= MAX_EDITS) return;
        this.change([...edits, this.isModel() ? {type: "floating", size: 1000} : {type: "floaters", strength: "medium"}], -1);
    };

    addHoles = () => {
        this.endTool();
        const { edits } = this.state;
        if (this.hasHoles() || edits.length >= MAX_EDITS) return;
        this.change([...edits, {type: "holes", size: HOLE_SIZES[0][0]}], -1);
    };

    hasHoles(){
        return this.state.edits.some(e => e.type === "holes");
    }

    // Whether the list has its Remove Floaters (splats) or Remove Floating Pieces (the model) already
    hasFloaters(){
        return this.isModel() ? this.state.edits.some(e => e.type === "floating") : !!floatersStrength(this.state.edits);
    }

    setFloatingSize(index, size){
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], size};
        this.change(edits, this.state.selected);
    }

    addColour = () => {
        this.endTool();
        const { edits } = this.state;
        if (colourEdit(edits) || edits.length >= MAX_EDITS) return;
        this.change([...edits, newColour()], edits.length);
    };

    // A Colour Adjust slider moved: one Undo step for each slider's drag, as for a box's
    setColour(index, name, value){
        const now = Date.now();
        const drag = index + name;
        const fresh = this.colourDrag !== drag || now - this.colourTime > 1000;
        this.colourDrag = drag;
        this.colourTime = now;
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], [name]: value};
        this.setState({edits, history: fresh ? recordChange(this.state.history, this.state.edits) : this.state.history});
        if (this.viewer) this.viewer.setColour(edits[index]);
        this.queueSave();
    }

    setStrength(index, strength){
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], strength};
        this.change(edits, this.state.selected);
    }

    queueSave(){
        clearTimeout(this.saveTimer);
        this.setState({saved: false});
        this.saveTimer = setTimeout(this.save, SAVE_AFTER);
    }

    // One save at a time, so they reach the server in order: one asked for while another runs follows it. Answers
    // once the edits as they are now are saved.
    save = () => {
        clearTimeout(this.saveTimer);
        if (this.saving) return this.saving.catch(() => null).then(() => this.save());
        const edits = this.state.edits;
        if (edits === this.savedEdits && !this.state.saveError){
            this.setState({saved: true});
            return Promise.resolve();
        }
        this.setState({saving: true});
        this.saving = request("PUT", this.path("edits"), {edits}).then(info => {
            this.saving = null;
            this.savedEdits = edits;
            if (!this._mounted) return;
            // Saved unless they changed while the request ran
            this.setState({saving: false, saveError: null, saved: this.state.edits === edits,
                           info: {...this.state.info, applied: info.applied}});
        }, e => {
            this.saving = null;
            if (this._mounted) this.setState({saving: false, saveError: e.message});
            throw e;
        });
        return this.saving;
    };

    addBox = () => {
        this.endTool();
        const { edits, loaded, info } = this.state;
        if (!loaded || !info.can_edit || edits.length >= MAX_EDITS) return;
        this.change([...edits, newBox(loaded.frame)], edits.length);
    };

    // A Repair button: the surface brush in its mode, Straighten's line to click, or a box doing its op in the middle
    // of the view
    addRepair(op){
        if (PAINT_REPAIRS.includes(op)){
            this.startPainting(op);
            return;
        }
        this.endTool();
        const { edits, loaded, info } = this.state;
        if (!loaded || !info.can_edit || edits.length >= MAX_EDITS) return;
        if (op === "straighten"){
            this.drawLine(-1);
            return;
        }
        this.change([...edits, {...newBox(loaded.frame), op}], edits.length);
    }

    drawPolygon = object => {
        if (!this.canStart("polygon")) return;
        this.setState({selected: -1, drawing: 0, outlining: object === true});
        this.viewer.startPolygon();
    };

    // An edit picked in the list (picked again: none); only: picked even when it already is
    select(index, only = false){
        const selected = !only && this.state.selected === index ? -1 : index;
        this.setState({selected, drafts: {}});
        if (this.viewer) this.viewer.setEdits(this.state.edits, selected);
    }

    // What a shape does: keep or remove its inside, or (the model's) Remove Object or Move Inside
    setAction(index, action){
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], keep: action === "keep"};
        if (this.isModel()){
            const op = OPS_SHOWN.includes(action) ? action : "delete";
            const kept = Object.fromEntries(Object.entries(edits[index]).filter(([name]) => !OP_PARAMS.includes(name)));
            edits[index] = {...kept, ...OP_DEFAULTS[op], op};
        }
        this.change(edits, this.state.selected);
    }

    remove(index){
        const edits = this.state.edits.filter((_e, i) => i !== index);
        const { selected } = this.state;
        this.change(edits, selected === index ? -1 : selected > index ? selected - 1 : selected);
    }

    removeSelected(){
        if (this.state.selected >= 0 && this.state.selected < this.state.edits.length) this.remove(this.state.selected);
    }

    undo = () => this.step(undoChange(this.state.history, this.state.edits));
    redo = () => this.step(redoChange(this.state.history, this.state.edits));

    // Undo or Redo's edits shown and saved (a brush still painting starts a new edit with its next stroke)
    step(taken){
        if (!taken) return;
        const { edits, history } = taken;
        const selected = this.state.selected < edits.length ? this.state.selected : -1;
        this.freshBrush = true;
        this.setState({edits, selected, drafts: {}, history});
        if (this.viewer) this.viewer.setEdits(edits, selected);
        this.queueSave();
    }

    clear = () => {
        if (!window.confirm(_("Remove all the edits? Update the Model afterwards for the task's model to be whole again."))) return;
        this.change([], -1);
    };

    setMode(mode){
        this.setState({mode});
        if (this.viewer) this.viewer.setMode(mode);
    }

    // A box's field typed in: the box changes once the text is a number (a size more than 0)
    setField(field, axis, text){
        const key = field + axis;
        const drafts = {...this.state.drafts, [key]: text};
        const value = parseFloat(text);
        const valid = text.trim() !== "" && isFinite(value) && (field !== "size" || value > 0);
        if (!valid){
            this.setState({drafts});
            return;
        }
        const index = this.state.selected;
        const box = {...this.state.edits[index]};
        if (field === "turn") box.turn = ((value % 360) + 360) % 360;
        else {
            box[field] = box[field].slice();
            box[field][axis] = value;
        }
        const edits = this.state.edits.slice();
        edits[index] = box;
        // A field's typing is one Undo step, as a box's drag is
        const now = Date.now();
        const merge = this.fieldKey === index + key && now - this.fieldTime < 1000;
        this.fieldKey = index + key;
        this.fieldTime = now;
        this.change(edits, index, merge);
        this.setState({drafts});
    }

    apply = () => {
        this.setState({starting: true, applyError: null});
        this.save().then(() => request("POST", this.path("apply"))).then(status => {
            if (!this._mounted) return;
            this.setState({starting: false, apply: status.apply});
            if (status.apply && status.apply.state === "applying") this.poll();
            else this.refresh();
        }).catch(e => {
            if (this._mounted) this.setState({starting: false, applyError: e.message});
        });
    };

    cancelApply = () => {
        this.setState({canceling: true, applyError: null});
        request("POST", this.path("apply"), {cancel: true}).then(status => {
            if (this._mounted) this.setState({canceling: false, apply: status.apply});
        }).catch(e => {
            if (this._mounted) this.setState({canceling: false, applyError: e.message});
        });
    };

    poll(){
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => {
            // The splats' Apply is in the task's status; the model's update in its edits
            request("GET", this.isModel() ? this.path("edits") : "task/" + this.props.taskId + "/status").then(status => {
                if (!this._mounted) return;
                this.setState({apply: status.apply});
                if (status.apply && status.apply.state === "applying") this.poll();
                else this.refresh();
            }).catch(e => {
                if (!this._mounted) return;
                if (e.status) this.setState({applyError: e.message});  // the session ended, the task is gone
                else this.poll();  // WebODM restarting: look again
            });
        }, POLL);
    }

    // What the server says of the edits now: whether the model was made with them, whether a training runs
    refresh(){
        return request("GET", this.path("edits")).then(info => {
            if (!this._mounted) return info;
            this.setState({info: {...this.state.info, applied: info.applied, training: info.training}});
            if (info.applied && this.state.apply && this.state.apply.state === "completed" && !this.isModel()) this.queueThumbnail();
            return info;
        }).catch(() => null);
    }

    // A picture of the view sent as the task's thumbnail, for its row in SplatMe → Tasks: when the model shows
    // what the task's model has (after loading, and after an update). Nothing is said when it fails: it is a nicety.
    queueThumbnail(){
        clearTimeout(this.thumbnailTimer);
        if (!this.state.info.can_edit) return;
        this.thumbnailTimer = setTimeout(() => {
            if (!this._mounted || !this.viewer) return;
            this.viewer.capture(THUMBNAIL_WIDTH)
                .then(picture => picture ? request("PUT", "task/" + this.props.taskId + "/thumbnail", picture) : null)
                .catch(() => null);
        }, THUMBNAIL_AFTER);
    }

    // A training running when the page opened keeps Apply disabled until it ends
    followTraining(){
        clearTimeout(this.trainingTimer);
        this.trainingTimer = setTimeout(() => {
            this.refresh().then(info => {
                if (this._mounted && (!info || info.training)) this.followTraining();
            });
        }, TRAINING_POLL);
    }

    renderBoxFields(box){
        const { drafts, mode } = this.state;
        const field = (name, axis, value, step) => {
            const key = name + axis;
            return (
                <input type="number" step={step} className="form-control input-sm" aria-label={_(FIELD_NAMES[name]) + (axis !== "" ? " " + AXES[axis] : "")}
                       value={key in drafts ? drafts[key] : value} onChange={e => this.setField(name, axis, e.target.value)} />
            );
        };
        return (
            <div className="splatme-editor-box">
                <div className="btn-group btn-group-sm splatme-editor-modes" role="group" aria-label={_("What the handles do")}>
                    {[["translate", _("Move"), "fa-arrows-alt"], ["scale", _("Size"), "fa-expand"], ["rotate", _("Turn"), "fa-sync-alt"]].map(([m, label, icon]) => (
                        <button key={m} type="button" className={"btn btn-default" + (mode === m ? " active" : "")} onClick={() => this.setMode(m)}>
                            <i className={"fa fa-fw " + icon}></i> {label}
                        </button>
                    ))}
                </div>
                <table className="splatme-editor-fields">
                    <tbody>
                        <tr><th></th>{AXES.map(a => <th key={a}>{a}</th>)}</tr>
                        <tr><th>{_("Centre")}</th>{box.center.map((v, i) => <td key={i}>{field("center", i, v, 0.1)}</td>)}</tr>
                        <tr><th>{_("Size")}</th>{box.size.map((v, i) => <td key={i}>{field("size", i, v, 0.1)}</td>)}</tr>
                        <tr><th>{_("Turn")}</th><td>{field("turn", "", box.turn, 1)}</td><td colSpan="2">{_("degrees")}</td></tr>
                    </tbody>
                </table>
            </div>
        );
    }

    // Move's or Smooth's settings, each with - and + to change it a step at a time (each step one Undo)
    // While the surface brush is on: its modes, what the mode does, its size (and Raise's step), and Done
    renderPainting(){
        const { mode, radius, step, source } = this.state.painting;
        const help = PAINT_MODES.find(([m]) => m === mode)[3];
        const row = (label, shown, unit, minus, plus, disabledMinus, disabledPlus) => (
            <tr>
                <th>{_(label)}</th>
                <td><button type="button" className="btn btn-sm btn-default" aria-label={_(label) + " -"} disabled={disabledMinus} onClick={minus}><i className="fa fa-minus fa-fw"></i></button></td>
                <td className="splatme-editor-step-value">{shown}</td>
                <td><button type="button" className="btn btn-sm btn-default" aria-label={_(label) + " +"} disabled={disabledPlus} onClick={plus}><i className="fa fa-plus fa-fw"></i></button></td>
                <td>{unit}</td>
            </tr>
        );
        return (
            <div className="alert alert-info splatme-editor-drawing">
                <div className="btn-group btn-group-sm splatme-editor-brush-mode" role="group" aria-label={_("What the brush does")}>
                    {PAINT_MODES.map(([m, label]) =>
                        <button key={m} type="button" className={"btn " + (mode === m ? "btn-primary" : "btn-default")} aria-pressed={mode === m}
                                onClick={() => this.setPainting({mode: m})}>{_(label)}</button>)}
                </div>
                <p>{mode === "clone" && !source ? _("Click the middle of a good area on the model to copy from.") : _(help)}
                {" "}{_("Drag to paint; Alt+drag or the middle button turns the view, right-drag moves it. The wheel or [ and ] size the brush, Shift+wheel zooms.")}</p>
                <table className="splatme-editor-fields splatme-editor-steps">
                    <tbody>
                        {row("Size", (2 * radius).toFixed(2), "m", () => this.setPainting({radius: radius / 1.25}), () => this.setPainting({radius: radius * 1.25}),
                            radius <= PAINT_RADII[0], radius >= PAINT_RADII[1])}
                        {mode === "raise" || mode === "lower" ?
                            row("Step", Math.round(step * 100), "cm", () => this.setPainting({step: Math.max(0.01, Math.round((step - 0.01) * 100) / 100)}),
                                () => this.setPainting({step: Math.min(1, Math.round((step + 0.01) * 100) / 100)}), step <= 0.01, step >= 1) : null}
                    </tbody>
                </table>
                <div className="splatme-editor-drawing-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => this.endTool()}>{_("Done")}</button>
                    {mode === "object" ?
                        <button type="button" className="btn btn-sm btn-default" title={_("Drag round the object instead")} onClick={() => this.lasso(true)}>
                            <i className="fa fa-pencil-alt fa-fw"></i> {_("Lasso")}
                        </button> : null}
                    {mode === "object" ?
                        <button type="button" className="btn btn-sm btn-default" title={_("Click a polygon round the object, from above, instead")} onClick={() => this.drawPolygon(true)}>
                            <i className="fa fa-draw-polygon fa-fw"></i> {_("Polygon")}
                        </button> : null}
                    {mode === "clone" && source ?
                        <button type="button" className="btn btn-sm btn-default" onClick={() => this.setPainting({mode: "clone", source: null})}>{_("Pick the Source Again")}</button> : null}
                </div>
            </div>
        );
    }

    renderOpFields(index, edit){
        // A setting the edit was saved without (a line traced before its heights were): its start
        const current = name => edit[name] !== undefined ? edit[name] : OP_DEFAULTS[stepsOf(edit)][name];
        const value = (name, axis) => axis === null ? current(name) : current(name)[axis];
        const set = (name, axis, raw, low, high, factor) => {
            if (!Number.isFinite(raw)) return;
            const v = Math.min(high, Math.max(low, raw)) / factor;
            const edits = this.state.edits.slice();
            const changed = {...edits[index]};
            if (axis === null) changed[name] = name === "passes" ? Math.round(v) : Math.round(v * 1000) / 1000;
            else {
                changed[name] = current(name).slice();
                changed[name][axis] = Math.round(v * 1000) / 1000;
            }
            edits[index] = changed;
            this.change(edits, this.state.selected);
        };
        return (
            <table className="splatme-editor-fields splatme-editor-steps">
                <tbody>
                    {OP_STEPS[stepsOf(edit)].map(([name, axis, label, unit, step, low, high, factor]) => {
                        const shown = Math.round(value(name, axis) * factor * 1000) / 1000;
                        return (
                            <tr key={name + axis}>
                                <th>{_(label)}</th>
                                <td><button type="button" className="btn btn-sm btn-default" aria-label={_(label) + " -"} disabled={shown <= low}
                                            onClick={() => set(name, axis, shown - step, low, high, factor)}><i className="fa fa-minus fa-fw"></i></button></td>
                                <td><input type="number" step={step} min={low} max={high} className="form-control input-sm" aria-label={_(label)} value={shown}
                                           onChange={e => set(name, axis, parseFloat(e.target.value), low, high, factor)} /></td>
                                <td><button type="button" className="btn btn-sm btn-default" aria-label={_(label) + " +"} disabled={shown >= high}
                                            onClick={() => set(name, axis, shown + step, low, high, factor)}><i className="fa fa-plus fa-fw"></i></button></td>
                                <td>{unit}</td>
                            </tr>
                        );
                    })}
                </tbody>
                {edit.type === "straighten" ?
                    <tfoot>
                        <tr><td colSpan="5">
                            <button type="button" className="btn btn-sm btn-default" onClick={() => this.drawLine(index)}
                                    title={_("Trace it on the model again; or drag a point of the line in the view")}>
                                <i className="fa fa-pencil-alt fa-fw"></i> {_("Draw the Line Again")}
                            </button>
                        </td></tr>
                    </tfoot> : null}
            </table>
        );
    }

    renderColourFields(index, edit){
        return (
            <div className="splatme-editor-colour">
                {COLOURS.map(([name, label]) => {
                    const value = Math.round(edit[name] * 100);
                    return (
                        <label key={name}>
                            <span>{_(label)}</span>
                            <input type="range" min="-100" max="100" value={value}
                                   onChange={e => this.setColour(index, name, parseInt(e.target.value, 10) / 100)} />
                            <span className="splatme-editor-colour-value">{value > 0 ? "+" + value : value}</span>
                        </label>
                    );
                })}
            </div>
        );
    }

    renderList(){
        const { edits, selected, info } = this.state;
        if (!edits.length) return <p className="splatme-editor-empty">{this.isModel() ? _("No edits yet. The tools above remove, fill and repair parts of the model.") : _("No edits yet. The tools above keep or remove parts of the model, or adjust its colours.")}</p>;
        return (
            <ul className="list-group splatme-editor-list">
                {edits.map((edit, i) => (
                    <li key={i} className={"list-group-item" + (i === selected ? " active" : "")}>
                        <a href="javascript:void(0)" onClick={() => this.select(i)} title={edit.type === "box" ? _("Show this box's handles and fields") : edit.type === "colour" ? _("Show its sliders") : ""}>
                            <i className={"fa fa-fw " + ICONS[edit.type]}></i> {edit.type === "floating" ? this.floatingLabel() : edit.type === "holes" ? this.holesLabel() : editLabel(edit, this.floatersCount(edit))}
                        </a>
                        {(edit.type === "lasso" || edit.type === "brush") && edit.camera && this.viewer ?
                            <a href="javascript:void(0)" className="splatme-editor-goto" onClick={() => this.viewer.goTo(edit.camera)}>{_("Go to Its View")}</a> : ""}
                        <div className="splatme-editor-item-actions">
                            {edit.type === "brush" ? <span className="splatme-editor-item-note">{edit.restore ? _("Brings back what it painted over") : edit.op === "object" ? _("Removes what it painted over and fills the hole") : _("Removes what it painted over")}</span> :
                            edit.type === "holes" ?
                                <select className="form-control input-sm" value={edit.size} disabled={!info.can_edit}
                                        aria-label={_("Which holes to fill")} onChange={e => this.setFloatingSize(i, parseInt(e.target.value, 10))}>
                                    {HOLE_SIZES.map(([size, label]) => <option key={size} value={size}>{_(label)} ({_("up to")} {size} {_("edges")})</option>)}
                                </select> :
                            edit.type === "colour" ? <span className="splatme-editor-item-note">{colourText(edit)}</span> :
                            edit.type === "straighten" ? <span className="splatme-editor-item-note">{_("Makes its traced line straight between its ends")}</span> :
                            edit.type === "paint" ? <span className="splatme-editor-item-note">{_(PAINT_NOTES[edit.op === "raise" && edit.amount < 0 ? "lower" : edit.op])}</span> :
                            edit.type === "floating" ?
                                <select className="form-control input-sm" value={edit.size} disabled={!info.can_edit}
                                        aria-label={_("Which pieces to remove")} onChange={e => this.setFloatingSize(i, parseInt(e.target.value, 10))}>
                                    {FLOATING_SIZES.map(([size, label]) => <option key={size} value={size}>{_(label)} ({_("under")} {size.toLocaleString("en-US")} {_("triangles")})</option>)}
                                </select> :
                            edit.type === "floaters" ?
                                <select className="form-control input-sm" value={edit.strength} disabled={!info.can_edit}
                                        aria-label={_("How many floaters to remove")} onChange={e => this.setStrength(i, e.target.value)}>
                                    {STRENGTHS.map(([value, label]) => <option key={value} value={value}>{_(label)}</option>)}
                                </select> :
                                <select className="form-control input-sm" value={OPS_SHOWN.includes(edit.op) ? edit.op : edit.keep ? "keep" : "remove"} disabled={!info.can_edit}
                                        aria-label={_("What this edit does")} onChange={e => this.setAction(i, e.target.value)}>
                                    <option value="keep">{_("Keep Inside")}</option>
                                    <option value="remove">{_("Remove Inside")}</option>
                                    {this.isModel() && edit.type !== "box" ? <option value="object">{_("Remove Object")}</option> : ""}
                                    {this.isModel() ? <option value="move">{_("Move Inside")}</option> : ""}
                                </select>}
                            {info.can_edit ?
                                <button type="button" className="btn btn-sm btn-default" title={_("Delete this edit (Delete when it is selected)")} aria-label={_("Delete")} onClick={() => this.remove(i)}>
                                    <i className="fa fa-trash fa-fw"></i>
                                </button> : ""}
                        </div>
                    </li>
                ))}
            </ul>
        );
    }

    // Remove Floating Pieces in the list, with how many triangles the edits take with it, once the view has said
    floatingLabel(){
        const result = this.viewer && this.state.loaded ? this.viewer.modelResult() : null;
        if (!result) return _("Floating Pieces");
        return _("Floating Pieces") + ", " + result.floating.toLocaleString("en-US") + " " + (result.floating === 1 ? _("triangle") : _("triangles"));
    }

    // Fill Holes in the list, with how many holes the edits fill, once the view has said
    holesLabel(){
        const result = this.viewer && this.state.loaded ? this.viewer.modelResult() : null;
        if (!result) return _("Holes");
        return _("Holes") + ", " + result.filled.toLocaleString("en-US") + " " + _("filled");
    }

    // How many splats the floaters edit is, once the server has said (null before)
    floatersCount(edit){
        const { floaters } = this.state;
        return edit.type === "floaters" && floaters && floaters.strength === edit.strength ? floaters.count : null;
    }

    renderSaveState(){
        const { saving, saved, saveError } = this.state;
        if (saveError) return <div className="text-danger">{_("The edits were not saved:")} {saveError}</div>;
        if (saving || !saved) return <div className="splatme-editor-save">{_("Saving")}</div>;
        return <div className="splatme-editor-save">{_("Saved")}</div>;
    }

    renderDownload(){
        const { saving, saved, saveError } = this.state;
        const title = _("The trained model with these edits, as Update the Model makes it, in the .ply format other splat tools open");
        if (saving || !saved || saveError){
            return (
                <button type="button" className="btn btn-sm btn-default splatme-editor-download" disabled title={_("The edits must be saved first")}>
                    <i className="fa fa-download fa-fw"></i> {_("Download .ply")}
                </button>
            );
        }
        return (
            <a className="btn btn-sm btn-default splatme-editor-download" href={downloadUrl(this.props.taskId)} title={title}>
                <i className="fa fa-download fa-fw"></i> {_("Download .ply")}
            </a>
        );
    }

    renderPanel(){
        const { info, edits, selected, loaded, drawing, apply, applyError, starting, lassoing, brushing, brushSize, brushMode } = this.state;
        const canEdit = info.can_edit && !!loaded;
        const busy = !canEdit || edits.length >= MAX_EDITS;
        const tool = this.activeTool();
        const toolClass = name => "btn btn-sm " + (tool === name ? "btn-primary active" : "btn-default");
        const applying = !!apply && apply.state === "applying";
        const box = selected >= 0 && edits[selected] && edits[selected].type === "box" ? edits[selected] : null;
        const colour = selected >= 0 && edits[selected] && edits[selected].type === "colour" ? edits[selected] : null;
        const stepped = selected >= 0 && edits[selected] && OP_STEPS[stepsOf(edits[selected])] ? edits[selected] : null;
        return (
            <div className="splatme-editor-panel">
                <div className="splatme-editor-tools">
                    <button type="button" className="btn btn-sm btn-default" disabled={busy} onClick={this.addBox}
                            title={_("A box that removes what is inside it, or keeps only that (X)")}>
                        <i className="fa fa-cube fa-fw"></i> {_("Add Box")}
                    </button>
                    <button type="button" className={toolClass("polygon")} disabled={busy && tool !== "polygon"} onClick={this.drawPolygon}
                            aria-pressed={tool === "polygon"} title={_("Draw a polygon from above that keeps what is inside it, or removes it (P)")}>
                        <i className="fa fa-draw-polygon fa-fw"></i> {_("Draw Polygon")}
                    </button>
                    <button type="button" className={toolClass("lasso")} disabled={busy && tool !== "lasso"} onClick={this.lasso} aria-pressed={tool === "lasso"}
                            title={_("Draw around what to remove: everything inside on screen goes, through to the back (L)")}>
                        <i className="fa fa-pencil-alt fa-fw"></i> {_("Lasso")}
                    </button>
                    <button type="button" className={toolClass("brush")} disabled={busy && tool !== "brush"} onClick={this.brush} aria-pressed={tool === "brush"}
                            title={_("Paint over what to remove, or what to bring back: everything under the brush on screen, through to the back (B)")}>
                        <i className="fa fa-paint-brush fa-fw"></i> {_("Brush")}
                    </button>
                    {this.isModel() ?
                        <button type="button" className="btn btn-sm btn-default" disabled={busy || this.hasFloaters()}
                                onClick={this.addFloaters} title={_("Remove the small pieces of surface apart from the rest of the model")}>
                            <i className="fa fa-broom fa-fw"></i> {_("Remove Floating Pieces")}
                        </button> : ""}
                    {this.isModel() ?
                        <button type="button" className="btn btn-sm btn-default" disabled={busy || this.hasHoles()}
                                onClick={this.addHoles} title={_("Fill the model's small holes, coloured from around each one")}>
                            <i className="fa fa-fill-drip fa-fw"></i> {_("Fill Holes")}
                        </button> :
                        <button type="button" className="btn btn-sm btn-default" disabled={busy || this.hasFloaters()}
                                onClick={this.addFloaters} title={_("Remove the splats far from the rest, and the oversized ones")}>
                            <i className="fa fa-broom fa-fw"></i> {_("Remove Floaters")}
                        </button>}
                    {this.isModel() ? "" :
                        <button type="button" className="btn btn-sm btn-default" disabled={busy || !!colourEdit(edits)}
                                onClick={this.addColour} title={_("Change the whole model's brightness, contrast, saturation and warmth")}>
                            <i className="fa fa-palette fa-fw"></i> {_("Colour Adjust")}
                        </button>}
                </div>
                {this.isModel() ? <h4>{_("Repair")}</h4> : ""}
                {this.isModel() ?
                    <div className="splatme-editor-tools splatme-editor-repairs" role="group" aria-label={_("Repair")}>
                        {REPAIRS.map(([op, label, icon, title]) =>
                            <button key={op} type="button" className={"btn btn-sm " + ((op === "straighten" && this.state.lining && this.lineIndex < 0) || (this.state.painting && this.state.painting.mode === op) ? "btn-primary active" : "btn-default")}
                                    disabled={busy} onClick={() => this.addRepair(op)} title={_(title)}>
                                <i className={"fa fa-" + icon + " fa-fw"}></i> {_(label)}
                            </button>)}
                    </div> : ""}
                {this.state.lining ?
                    <div className="alert alert-info splatme-editor-drawing">
                        {_("Click points along the edge where it is now, from where it is straight at one end to where it is straight at the other; double-click the last, or Finish. Backspace takes back the last point. The edge is then made straight between the first and last points, the surface within Reach moving with it.")}
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-primary" disabled={(this.state.linePoints || 0) < 3} onClick={() => this.viewer.finishLine()}>{_("Finish")}</button>
                            <button type="button" className="btn btn-sm btn-default" onClick={() => this.endTool()}>{_("Cancel")}</button>
                        </div>
                    </div> : ""}
                {lassoing ?
                    <div className="alert alert-info splatme-editor-drawing">
                        {this.state.outlining ? _("Drag around the object to remove: what stands above the surface round it goes, and the surface under it is laid again.") :
                            _("Drag around what to remove. Everything inside on screen goes, through to the back: turn the view first to see it apart.")}
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-default" onClick={() => this.viewer.cancelLasso()}>{_("Cancel")}</button>
                        </div>
                    </div> : ""}
                {this.state.painting ? this.renderPainting() : ""}
                {brushing ?
                    <div className="alert alert-info splatme-editor-drawing">
                        <div className="btn-group btn-group-sm splatme-editor-brush-mode" role="group" aria-label={_("What the brush does")}>
                            {BRUSH_MODES.map(([mode, label]) =>
                                <button key={mode} type="button" className={"btn " + (brushMode === mode ? "btn-primary" : "btn-default")} aria-pressed={brushMode === mode}
                                        onClick={() => this.setBrushMode(mode)}>{_(label)}</button>)}
                        </div>
                        <p>{_(BRUSH_MODES.find(([mode]) => mode === brushMode)[2])}
                        {" "}{_("The view holds still while you paint: press Done to turn it.")}</p>
                        <label className="splatme-editor-brush-size">
                            {_("Size")}
                            <input type="range" min={BRUSH_SIZES[0]} max={BRUSH_SIZES[1]} value={brushSize}
                                   onChange={e => this.setBrushSize(parseInt(e.target.value, 10))} />
                            <span>{brushSize} px</span>
                        </label>
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => this.viewer.endBrush()}>{_("Done")}</button>
                        </div>
                    </div> : ""}
                {drawing !== null ?
                    <div className="alert alert-info splatme-editor-drawing">
                        {this.state.outlining ? _("Click the corners of a polygon round the object, in the view from above. Click the first corner, or double-click, to close it.") :
                            _("Click the polygon's corners in the view from above. Click the first corner, or double-click, to close it.")}
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-primary" disabled={drawing < 3} onClick={() => this.viewer.finishPolygon()}>{_("Finish")}</button>
                            <button type="button" className="btn btn-sm btn-default" onClick={() => this.endTool()}>{_("Cancel")}</button>
                        </div>
                    </div> : ""}
                <div className="splatme-editor-views">
                    <button type="button" className="btn btn-sm btn-default" disabled={!loaded} onClick={() => this.viewer.topView()}>
                        <i className="fa fa-arrow-down fa-fw"></i> {_("Top View")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={!loaded} onClick={() => this.viewer.frameView()}
                            title={_("Back to the view the page opened with")}>
                        <i className="fa fa-home fa-fw"></i> {_("Reset View")}
                    </button>
                </div>
                {loaded ? <p className="splatme-editor-hint">{_("Drag to turn, right-drag to move, scroll to zoom, double-click to centre.")}</p> : ""}
                <h4>{_("Edits")}</h4>
                {info.unreadable ?
                    <p className="text-warning">{info.unreadable} {_("They may be from another version of SplatMe: ask an administrator to restart WebODM. A change here replaces them.")}</p> : ""}
                {this.renderList()}
                {this.state.floatersError ? <p className="text-danger">{_("The floaters could not be found:")} {this.state.floatersError}</p> : ""}
                {box && canEdit ? this.renderBoxFields(box) : ""}
                {colour && canEdit ? this.renderColourFields(selected, colour) : ""}
                {stepped && canEdit ? this.renderOpFields(selected, stepped) : ""}
                {info.can_edit ?
                    <div className="splatme-editor-history">
                        <button type="button" className="btn btn-sm btn-default" disabled={!this.state.history.undo.length} onClick={this.undo} title={_("Undo (Ctrl+Z)")}>
                            <i className="fa fa-undo fa-fw"></i> {_("Undo")}
                        </button>
                        <button type="button" className="btn btn-sm btn-default" disabled={!this.state.history.redo.length} onClick={this.redo} title={_("Redo (Ctrl+Shift+Z)")}>
                            <i className="fa fa-redo fa-fw"></i> {_("Redo")}
                        </button>
                        <button type="button" className="btn btn-sm btn-default" disabled={!edits.length} onClick={this.clear}>
                            <i className="fa fa-eraser fa-fw"></i> {_("Clear Edits")}
                        </button>
                        {this.renderSaveState()}
                    </div> : ""}
                {info.can_edit ?
                    <div className="splatme-editor-apply">
                        <button type="button" className="btn btn-primary" disabled={applying || starting || (info.training && !this.isModel())}
                                title={this.isModel() ? _("Make the task's textured 3D model again from its original, with these edits, for WebODM's 3D view, share links and Textured Model download") :
                                    _("Make the task's splat model again from its trained model, with these edits, for its 3D view, download and share links")} onClick={this.apply}>
                            <i className={(applying || starting ? "fa fa-circle-notch fa-spin" : "fa fa-check") + " fa-fw"}></i> {_("Update the Model")}
                        </button>
                        {applying ?
                            <button type="button" className="btn btn-sm btn-default" disabled={this.state.canceling} onClick={this.cancelApply}
                                    title={_("Stop applying the edits: the task's model stays as it was")}>
                                <i className="fa fa-times fa-fw"></i> {_("Cancel")}
                            </button> : this.isModel() ? "" : this.renderDownload()}
                        {info.training && !this.isModel() ? <p className="text-warning">{_("The task's splats are being trained: update the model when the training is done.")}</p> : ""}
                        {applyText(apply) ? <p className={apply.state === "failed" ? "text-danger" : ""}>{applyText(apply)}</p> : ""}
                        {!applying && modelText(info.applied, apply, this.props.kind) ?
                            <p className={"splatme-editor-model " + (info.applied ? "text-success" : "text-warning")}>{modelText(info.applied, apply, this.props.kind)}</p> : ""}
                        {applyError ? <p className="text-danger">{applyError}</p> : ""}
                        {apply && apply.state === "completed" && info.applied ?
                            <a className="btn btn-sm btn-default" href={"/3d/project/" + info.project + "/task/" + this.props.taskId + "/" + (this.isModel() ? "" : "?t=splats")}>
                                <i className="fa fa-cube fa-fw"></i> {_("View in 3D")}
                            </a> : ""}
                    </div> : ""}
            </div>
        );
    }

    renderViewNote(){
        const { info, loading, loaded, progress, error } = this.state;
        if (error){
            return (
                <div className="splatme-editor-note">
                    <p className="text-danger">{error}</p>
                    {info && info.model ? <button type="button" className="btn btn-default" onClick={this.reload}>{_("Try Again")}</button> : ""}
                </div>
            );
        }
        if (loading) return <div className="splatme-editor-note"><i className="fa fa-circle-notch fa-spin fa-fw"></i> {this.isModel() ? _("Loading the 3D model") : _("Loading the trained model")}{progress != null ? " (" + progress + "%)" : ""}</div>;
        if (!loaded && info && info.model && info.model.size > LARGE_MODEL){
            return (
                <div className="splatme-editor-note">
                    <p>{_("This model is large:")} {sizeText(info.model.size)}{info.model.splats ? ", " + Number(info.model.splats).toLocaleString("en-US") + " " + _("splats") : ""}. {_("It is loaded whole, which may be slow, or fail on a phone or a computer with little memory.")}</p>
                    <button type="button" className="btn btn-primary" onClick={this.loadModel}>{_("Load Anyway")}</button>
                </div>
            );
        }
        return null;
    }

    // "854,042 triangles, 53,471 of them removed by the edits."
    modelStats(loaded){
        const result = this.viewer ? this.viewer.modelResult() : null;
        const removed = result && result.removed ? ", " + result.removed.toLocaleString("en-US") + " " + _("of them removed by the edits") : "";
        const flattened = result && result.moved ? "; " + result.moved.toLocaleString("en-US") + " " + (result.moved === 1 ? _("point moved") : _("points moved")) : "";
        const cloned = result && result.cloned ? "; " + result.cloned.toLocaleString("en-US") + " " + (result.cloned === 1 ? _("triangle retextured") : _("triangles retextured")) : "";
        const filled = result && result.filled ? "; " + result.filled.toLocaleString("en-US") + " " + (result.filled === 1 ? _("hole filled") : _("holes filled")) : "";
        const line = loaded.triangles.toLocaleString("en-US") + " " + _("triangles") + removed + flattened + filled + cloned + ".";
        return this.state.modelBusy ? <span>{line} <i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Showing the edits…")}</span> : line;
    }

    render(){
        const { info, error, loaded } = this.state;
        const heading = (
            <div>
                <h3><i className="fa fa-splat fa-fw"></i> {this.isModel() ? _("Edit 3D Model") : _("Edit Splats")}{info ? ": " + (info.name || this.props.taskId) : ""}</h3>
                <p><a href="../../">{_("Back to SplatMe Tasks")}</a></p>
                {this.props.switcher || ""}
            </div>
        );
        if (!info){
            return <div>{heading}{error ? <p className="text-danger">{error}</p> : <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading")}</p>}</div>;
        }
        if (!info.can_edit){
            // The trained model (or the textured model's original), uncut, is only for those who may edit
            return (
                <div>
                    {heading}
                    <p className="text-warning">{this.isModel() ? _("Only those who may change this task's project may edit its 3D model.") : _("Only those who may change this task's project may edit its splats.")}</p>
                    {!info.editable && !this.isModel() ? <div className="splatme-editor-apply">{this.renderDownload()}</div> : ""}
                </div>
            );
        }
        return (
            <div>
                {heading}
                {info.editable ? <p className="text-warning">{info.editable}</p> :
                    <div className="splatme-editor">
                        <div className="splatme-editor-view" ref={el => { this.view = el; }}>
                            {this.renderViewNote()}
                        </div>
                        {this.renderPanel()}
                    </div>}
                {loaded && this.isModel() ? <p className="splatme-editor-stats">{this.modelStats(loaded)}</p> : ""}
                {loaded && !this.isModel() ? <p className="splatme-editor-stats">{Number(loaded.splats).toLocaleString("en-US")} {_("splats")}
                    {loaded.outside ? ", " + Number(loaded.outside).toLocaleString("en-US") + " " + _("of them hidden for being outside the task's boundary (the model was trained with Crop to Boundary)") : ""}.</p> : ""}
            </div>
        );
    }
}

// Edit Splats' page: the task's splats or its textured 3D model, chosen above the panel. It starts with the splats
// when the task has a model SplatMe trained, else with the 3D model; ?model=1 in the address asks for the 3D model.
export default class EditorPage extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        loadViewer: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        const asked = /[?&]model=1(&|$)/.test(window.location.search);
        this.state = {kind: asked ? "model" : null, choices: null};
    }

    componentDidMount(){
        this._mounted = true;
        request("GET", "task/" + this.props.taskId + "/status").then(status => {
            if (!this._mounted) return;
            const choices = {splats: !!status.editable, model: !!status.model_editable};
            this.setState({choices, kind: this.state.kind || (choices.splats || !choices.model ? "splats" : "model")});
        }).catch(() => {
            if (this._mounted) this.setState({choices: {splats: true, model: true}, kind: this.state.kind || "splats"});
        });
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    choose(kind){
        if (kind === this.state.kind) return;
        const url = new URL(window.location.href);
        if (kind === "model") url.searchParams.set("model", "1");
        else url.searchParams.delete("model");
        window.history.replaceState(null, "", url.pathname + url.search);
        this.setState({kind});
    }

    render(){
        const { kind, choices } = this.state;
        if (!kind) return <div><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading")}</div>;
        const switcher = choices && choices.splats && choices.model ?
            <div className="btn-group splatme-editor-kind" role="group" aria-label={_("What to edit")}>
                {[["splats", _("Splats"), "fa-splat"], ["model", _("3D Model"), "fa-cube"]].map(([k, label, icon]) => (
                    <button key={k} type="button" className={"btn btn-sm " + (kind === k ? "btn-primary active" : "btn-default")}
                            aria-pressed={kind === k} onClick={() => this.choose(k)}>
                        <i className={"fa fa-fw " + icon}></i> {label}
                    </button>
                ))}
            </div> : null;
        return <EditorPanel key={kind} kind={kind} taskId={this.props.taskId} loadViewer={this.props.loadViewer} switcher={switcher} />;
    }
}
