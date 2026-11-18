import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { request } from './api';
import { newBox, cleanRing, editLabel, sizeText, applyText, floatersStrength, addStroke, colourEdit, colourText, newColour, LARGE_MODEL, MAX_EDITS, STRENGTHS, BRUSH_SIZES, COLOURS } from './editShapes';
import './Editor.scss';

const SAVE_AFTER = 600;  // ms after the last change before the edits are saved
const POLL = 2000;  // ms between looks at an Apply Edits that runs
const AXES = ["X", "Y", "Z"];
const ICONS = {box: "fa-cube", polygon: "fa-draw-polygon", lasso: "fa-pencil-alt", brush: "fa-paint-brush", floaters: "fa-broom", colour: "fa-palette"};
const BRUSH_SIZE = 30;  // the Brush's size at first, in pixels across

// Edit Splats (templates/editor.html, Edit on a task's row in SplatMe → Tasks): the task's trained model in a 3D view
// (editor/viewer.js, loaded by loadViewer through the page's import map) and this panel beside it, below it on a
// phone. Box, Polygon and Lasso edits keep or remove the splats inside them, the Brush removes those painted over,
// Remove Floaters the splats far from the rest or oversized (found by the server); the view hides what they remove as they change.
// Colour Adjust changes the whole model's colours, shown as its sliders move. They are saved as they are made. Apply makes the task's model again from its trained model with them
// (training.py's Apply Edits), which the 3D view, the download and the share links then show.
export default class Editor extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        loadViewer: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.history = [];  // the edits before each change, for Undo
        this.floaters = {};  // the server's floaters by strength: a promise of the splats' numbers
        this.state = {
            info: null, error: null, edits: [], selected: -1, mode: "translate", drawing: null, loading: false,
            progress: null, loaded: null, saving: false, saved: true, saveError: null, apply: null, applyError: null,
            starting: false, drafts: {}, lassoing: false, floaters: null, floatersError: null,
            brushing: false, brushSize: BRUSH_SIZE
        };
    }

    componentDidMount(){
        this._mounted = true;
        window.addEventListener("beforeunload", this.handleLeave);
        request("GET", "task/" + this.props.taskId + "/edits").then(info => {
            if (!this._mounted) return;
            this.setState({info, edits: info.edits, apply: info.apply});
            if (info.model && info.model.size <= LARGE_MODEL) this.loadModel();
            if (info.apply && info.apply.state === "applying") this.poll();
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
            if (this._mounted && floatersStrength(this.state.edits) === strength) this.setState({floatersError: e.message});
        });
    }

    componentWillUnmount(){
        this._mounted = false;
        window.removeEventListener("beforeunload", this.handleLeave);
        clearTimeout(this.saveTimer);
        clearTimeout(this.pollTimer);
        if (this.viewer) this.viewer.dispose();
    }

    // The browser asks before leaving while edits are not saved yet
    handleLeave = e => {
        if (!this.state.saved){
            e.preventDefault();
            e.returnValue = "";
        }
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
                onBrushStroke: this.handleBrushStroke,
                onBrushSize: brushSize => this.setState({brushSize}),
                onBrushEnd: () => this.setState({brushing: false})
            });
            this.viewer.setMode(this.state.mode);
            return this.viewer.load(info.model.url, e => {
                if (this._mounted && e && e.total) this.setState({progress: Math.round(e.loaded / e.total * 100)});
            }, info.boundary);
        }).then(loaded => {
            if (!this._mounted || !loaded) return;
            this.setState({loading: false, loaded});
            this.viewer.setEdits(this.state.edits, this.state.selected);
        }).catch(e => {
            if (this._mounted) this.setState({loading: false, error: _("The model did not load:") + " " + ((e && e.message) || e)});
        });
    };

    // A change of the edits from the panel: remembered for Undo, shown, saved shortly
    change(edits, selected){
        this.history.push(this.state.edits);
        this.setState({edits, selected, drafts: {}});
        if (this.viewer) this.viewer.setEdits(edits, selected);
        this.queueSave();
    }

    // A box dragged in the view: the view has it already
    handleBoxChange = (index, box) => {
        const now = Date.now();
        // One Undo step for each drag: a change more than a second after the last starts another
        if (this.dragIndex !== index || now - this.dragTime > 1000) this.history.push(this.state.edits);
        this.dragIndex = index;
        this.dragTime = now;
        const edits = this.state.edits.slice();
        edits[index] = box;
        this.setState({edits, drafts: {}});
        this.queueSave();
    };

    handlePolygon = ring => {
        const clean = cleanRing(ring);
        this.setState({drawing: null});
        if (clean.length < 3) return;
        this.change([...this.state.edits, {type: "polygon", keep: true, ring: clean}], -1);
    };

    handleLasso = ({ring, view, camera}) => {
        this.setState({lassoing: false});
        this.change([...this.state.edits, {type: "lasso", keep: false, ring, view, camera}], -1);
    };

    lasso = () => {
        if (!this.viewer || this.state.edits.length >= MAX_EDITS) return;
        this.setState({selected: -1, lassoing: true});
        this.viewer.startLasso();
    };

    // Painting: the session's strokes go into one edit (Undo takes back the last), until Done
    brush = () => {
        if (!this.viewer || this.state.edits.length >= MAX_EDITS) return;
        this.freshBrush = true;
        this.setState({selected: -1, brushing: true});
        this.viewer.startBrush(this.state.brushSize);
    };

    handleBrushStroke = ({stroke, view, aspect, camera}) => {
        const { edits } = this.state;
        const next = addStroke(edits, stroke, view, aspect, camera, this.freshBrush);
        if (next.length > edits.length && edits.length >= MAX_EDITS){
            this.viewer.endBrush();
            return;
        }
        this.freshBrush = false;
        this.change(next, -1);
    };

    setBrushSize(brushSize){
        this.setState({brushSize});
        if (this.viewer) this.viewer.setBrushSize(brushSize);
    }

    addFloaters = () => {
        const { edits } = this.state;
        if (floatersStrength(edits) || edits.length >= MAX_EDITS) return;
        this.change([...edits, {type: "floaters", strength: "medium"}], -1);
    };

    addColour = () => {
        const { edits } = this.state;
        if (colourEdit(edits) || edits.length >= MAX_EDITS) return;
        this.change([...edits, newColour()], edits.length);
    };

    // A Colour Adjust slider moved: one Undo step for each slider's drag, as for a box's
    setColour(index, name, value){
        const now = Date.now();
        const drag = index + name;
        if (this.colourDrag !== drag || now - this.colourTime > 1000) this.history.push(this.state.edits);
        this.colourDrag = drag;
        this.colourTime = now;
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], [name]: value};
        this.setState({edits});
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

    save = () => {
        clearTimeout(this.saveTimer);
        const edits = this.state.edits;
        this.setState({saving: true});
        return request("PUT", "task/" + this.props.taskId + "/edits", {edits}).then(() => {
            if (!this._mounted) return;
            // Saved unless they changed while the request ran
            this.setState({saving: false, saveError: null, saved: this.state.edits === edits});
        }).catch(e => {
            if (this._mounted) this.setState({saving: false, saveError: e.message});
            throw e;
        });
    };

    addBox = () => {
        const { edits, loaded } = this.state;
        if (!loaded || edits.length >= MAX_EDITS) return;
        this.change([...edits, newBox(loaded.frame)], edits.length);
    };

    drawPolygon = () => {
        if (!this.viewer || this.state.edits.length >= MAX_EDITS) return;
        this.setState({selected: -1});
        this.viewer.startPolygon();
    };

    select(index){
        const selected = this.state.selected === index ? -1 : index;
        this.setState({selected, drafts: {}});
        if (this.viewer) this.viewer.setEdits(this.state.edits, selected);
    }

    setKeep(index, keep){
        const edits = this.state.edits.slice();
        edits[index] = {...edits[index], keep};
        this.change(edits, this.state.selected);
    }

    remove(index){
        const edits = this.state.edits.filter((_e, i) => i !== index);
        const { selected } = this.state;
        this.change(edits, selected === index ? -1 : selected > index ? selected - 1 : selected);
    }

    undo = () => {
        if (!this.history.length) return;
        const edits = this.history.pop();
        const selected = this.state.selected < edits.length ? this.state.selected : -1;
        this.setState({edits, selected, drafts: {}});
        if (this.viewer) this.viewer.setEdits(edits, selected);
        this.queueSave();
    };

    clear = () => {
        if (!window.confirm(_("Remove all the edits? Apply them afterwards for the task's model to be whole again."))) return;
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
        this.change(edits, index);
        this.setState({drafts});
    }

    apply = () => {
        this.setState({starting: true, applyError: null});
        this.save().then(() => request("POST", "task/" + this.props.taskId + "/apply")).then(status => {
            if (!this._mounted) return;
            this.setState({starting: false, apply: status.apply});
            if (status.apply && status.apply.state === "applying") this.poll();
        }).catch(e => {
            if (this._mounted) this.setState({starting: false, applyError: e.message});
        });
    };

    poll(){
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => {
            request("GET", "task/" + this.props.taskId + "/status").then(status => {
                if (!this._mounted) return;
                this.setState({apply: status.apply});
                if (status.apply && status.apply.state === "applying") this.poll();
            }).catch(() => {
                if (this._mounted) this.poll();  // WebODM restarting: look again
            });
        }, POLL);
    }

    renderBoxFields(box){
        const { drafts, mode } = this.state;
        const field = (name, axis, value, step) => {
            const key = name + axis;
            return (
                <input type="number" step={step} className="form-control input-sm" aria-label={name + " " + (AXES[axis] || "")}
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
        if (!edits.length) return <p className="splatme-editor-empty">{_("No edits yet. Add a box or draw a polygon around what to keep, or around what to remove.")}</p>;
        return (
            <ul className="list-group splatme-editor-list">
                {edits.map((edit, i) => (
                    <li key={i} className={"list-group-item" + (i === selected ? " active" : "")}>
                        <a href="javascript:void(0)" onClick={() => this.select(i)} title={edit.type === "box" ? _("Show this box's handles and fields") : edit.type === "colour" ? _("Show its sliders") : ""}>
                            <i className={"fa fa-fw " + ICONS[edit.type]}></i> {editLabel(edit, this.floatersCount(edit))}
                        </a>
                        {(edit.type === "lasso" || edit.type === "brush") && edit.camera && this.viewer ?
                            <a href="javascript:void(0)" className="splatme-editor-goto" onClick={() => this.viewer.goTo(edit.camera)}>{_("Go to Its View")}</a> : ""}
                        <div className="splatme-editor-item-actions">
                            {edit.type === "brush" ? <span className="splatme-editor-item-note">{_("Removes what it painted over")}</span> :
                            edit.type === "colour" ? <span className="splatme-editor-item-note">{colourText(edit)}</span> :
                            edit.type === "floaters" ?
                                <select className="form-control input-sm" value={edit.strength} disabled={!info.can_edit}
                                        aria-label={_("How many floaters to remove")} onChange={e => this.setStrength(i, e.target.value)}>
                                    {STRENGTHS.map(([value, label]) => <option key={value} value={value}>{_(label)}</option>)}
                                </select> :
                                <select className="form-control input-sm" value={edit.keep ? "keep" : "remove"} disabled={!info.can_edit}
                                        aria-label={_("What this edit does")} onChange={e => this.setKeep(i, e.target.value === "keep")}>
                                    <option value="keep">{_("Keep Inside")}</option>
                                    <option value="remove">{_("Remove Inside")}</option>
                                </select>}
                            {info.can_edit ?
                                <button type="button" className="btn btn-sm btn-default" title={_("Delete this edit")} aria-label={_("Delete")} onClick={() => this.remove(i)}>
                                    <i className="fa fa-trash fa-fw"></i>
                                </button> : ""}
                        </div>
                    </li>
                ))}
            </ul>
        );
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

    renderPanel(){
        const { info, edits, selected, loaded, drawing, apply, applyError, starting, lassoing, brushing, brushSize } = this.state;
        const canEdit = info.can_edit && !!loaded;
        const busy = !canEdit || drawing !== null || lassoing || brushing || edits.length >= MAX_EDITS;
        const applying = !!apply && apply.state === "applying";
        const box = selected >= 0 && edits[selected] && edits[selected].type === "box" ? edits[selected] : null;
        const colour = selected >= 0 && edits[selected] && edits[selected].type === "colour" ? edits[selected] : null;
        return (
            <div className="splatme-editor-panel">
                {!info.can_edit ? <p className="text-warning">{_("Only those who may change this project edit its splats.")}</p> : ""}
                <div className="splatme-editor-tools">
                    <button type="button" className="btn btn-sm btn-default" disabled={busy} onClick={this.addBox}>
                        <i className="fa fa-cube fa-fw"></i> {_("Add Box")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={busy} onClick={this.drawPolygon}>
                        <i className="fa fa-draw-polygon fa-fw"></i> {_("Draw Polygon")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={busy} onClick={this.lasso}
                            title={_("Draw around what to remove: everything inside on screen goes, through to the back")}>
                        <i className="fa fa-pencil-alt fa-fw"></i> {_("Lasso")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={busy} onClick={this.brush}
                            title={_("Paint over what to remove: everything under the brush on screen goes, through to the back")}>
                        <i className="fa fa-paint-brush fa-fw"></i> {_("Brush")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={busy || !!floatersStrength(edits)}
                            onClick={this.addFloaters} title={_("Remove the splats far from the rest, and the oversized ones")}>
                        <i className="fa fa-broom fa-fw"></i> {_("Remove Floaters")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={busy || !!colourEdit(edits)}
                            onClick={this.addColour} title={_("Change the whole model's brightness, contrast, saturation and warmth")}>
                        <i className="fa fa-palette fa-fw"></i> {_("Colour Adjust")}
                    </button>
                </div>
                {lassoing ?
                    <div className="alert alert-info splatme-editor-drawing">
                        {_("Drag around what to remove. Everything inside on screen goes, through to the back: turn the view first to see it apart.")}
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-default" onClick={() => this.viewer.cancelLasso()}>{_("Cancel")}</button>
                        </div>
                    </div> : ""}
                {brushing ?
                    <div className="alert alert-info splatme-editor-drawing">
                        {_("Paint over what to remove. Everything under the brush on screen goes, through to the back. The view holds still while you paint: press Done to turn it.")}
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
                        {_("Click the polygon's corners in the view from above. Click the first corner, or double-click, to close it.")}
                        <div className="splatme-editor-drawing-actions">
                            <button type="button" className="btn btn-sm btn-primary" disabled={drawing < 3} onClick={() => this.viewer.finishPolygon()}>{_("Finish")}</button>
                            <button type="button" className="btn btn-sm btn-default" onClick={() => { this.viewer.cancelPolygon(); this.setState({drawing: null}); }}>{_("Cancel")}</button>
                        </div>
                    </div> : ""}
                <div className="splatme-editor-views">
                    <button type="button" className="btn btn-sm btn-default" disabled={!loaded} onClick={() => this.viewer.topView()}>
                        <i className="fa fa-arrow-down fa-fw"></i> {_("Top View")}
                    </button>
                    <button type="button" className="btn btn-sm btn-default" disabled={!loaded} onClick={() => this.viewer.frameView()}>
                        <i className="fa fa-crosshairs fa-fw"></i> {_("Side View")}
                    </button>
                </div>
                <h4>{_("Edits")}</h4>
                {info.unreadable ?
                    <p className="text-warning">{info.unreadable} {_("They may be from another version of SplatMe: ask an administrator to restart WebODM. A change here replaces them.")}</p> : ""}
                {this.renderList()}
                {this.state.floatersError ? <p className="text-danger">{_("The floaters could not be found:")} {this.state.floatersError}</p> : ""}
                {box && canEdit ? this.renderBoxFields(box) : ""}
                {colour && canEdit ? this.renderColourFields(selected, colour) : ""}
                {info.can_edit ?
                    <div className="splatme-editor-history">
                        <button type="button" className="btn btn-sm btn-default" disabled={!this.history.length} onClick={this.undo}>
                            <i className="fa fa-undo fa-fw"></i> {_("Undo")}
                        </button>
                        <button type="button" className="btn btn-sm btn-default" disabled={!edits.length} onClick={this.clear}>
                            <i className="fa fa-eraser fa-fw"></i> {_("Clear Edits")}
                        </button>
                        {this.renderSaveState()}
                    </div> : ""}
                {info.can_edit ?
                    <div className="splatme-editor-apply">
                        <button type="button" className="btn btn-primary" disabled={applying || starting || info.training}
                                title={_("Make the task's splat model again from its trained model, with these edits")} onClick={this.apply}>
                            <i className={(applying || starting ? "fa fa-circle-notch fa-spin" : "fa fa-check") + " fa-fw"}></i> {_("Apply")}
                        </button>
                        {info.training ? <p className="text-warning">{_("The task's splats are being trained: apply the edits when the training is done.")}</p> : ""}
                        {apply ? <p className={apply.state === "failed" ? "text-danger" : ""}>{applyText(apply)}</p> : ""}
                        {applyError ? <p className="text-danger">{applyError}</p> : ""}
                        {apply && apply.state === "completed" ?
                            <a className="btn btn-sm btn-default" href={"/3d/project/" + info.project + "/task/" + this.props.taskId + "/?t=splats"}>
                                <i className="fa fa-cube fa-fw"></i> {_("View in 3D")}
                            </a> : ""}
                    </div> : ""}
            </div>
        );
    }

    renderViewNote(){
        const { info, loading, loaded, progress, error } = this.state;
        if (error) return <div className="splatme-editor-note text-danger">{error}</div>;
        if (loading) return <div className="splatme-editor-note"><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading the trained model")}{progress != null ? " (" + progress + "%)" : ""}</div>;
        if (!loaded && info && info.model && info.model.size > LARGE_MODEL){
            return (
                <div className="splatme-editor-note">
                    <p>{_("This model is large:")} {sizeText(info.model.size)}, {Number(info.model.splats).toLocaleString("en-US")} {_("splats")}. {_("It is loaded whole, which may be slow, or fail on a phone or a computer with little memory.")}</p>
                    <button type="button" className="btn btn-primary" onClick={this.loadModel}>{_("Load Anyway")}</button>
                </div>
            );
        }
        return null;
    }

    render(){
        const { info, error, loaded } = this.state;
        if (!info){
            return error ? <p className="text-danger">{error}</p> : <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading")}</p>;
        }
        return (
            <div>
                <h3><i className="fa fa-splat fa-fw"></i> {_("Edit Splats")}: {info.name || this.props.taskId}</h3>
                <p><a href="../../">{_("Back to SplatMe Tasks")}</a></p>
                {info.editable ? <p className="text-warning">{info.editable}</p> :
                    <div className="splatme-editor">
                        <div className="splatme-editor-view" ref={el => { this.view = el; }}>
                            {this.renderViewNote()}
                        </div>
                        {this.renderPanel()}
                    </div>}
                {loaded ? <p className="splatme-editor-stats">{Number(loaded.splats).toLocaleString("en-US")} {_("splats")}
                    {loaded.outside ? ", " + Number(loaded.outside).toLocaleString("en-US") + " " + _("of them hidden for being outside the task's boundary (the model was trained with Crop to Boundary)") : ""}.</p> : ""}
            </div>
        );
    }
}
