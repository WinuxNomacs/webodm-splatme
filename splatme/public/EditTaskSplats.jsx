import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _, interpolate } from 'webodm/classes/gettext';
import SplatMePanel from './SplatMePanel';
import { request } from './api';
import { showNotice } from './notice';
import { createPanelSettings, isEdit } from './panelSettings';
import { NOT_LISTENING } from './restartText';
import { formFromOptions, optionsFromForm } from './trainingView';

// One for the page: the choices made in Edit Task panels not saved yet (panelSettings.js)
const editSettings = createPanelSettings($, isEdit, (taskId, setting, task) => {
    request("POST", "task/" + taskId + "/auto", setting).catch(e => {
        showNotice(interpolate(_("the training setting of the task \"%(name)s\" was not saved: %(error)s Set it with Change in the task's panel."), {name: task.name || taskId, error: e.message}));
    });
}, 1000, () => {
    showNotice(_("WebODM saved the task in a way SplatMe does not know, so its training setting was not saved. Set it with Change in the task's panel."));
});

// The task an Edit Task panel edits, from the props React gave the panel (React 16 keeps them on the element):
// WebODM puts nothing in the page that names it, and gives a plugin no hook there. Null without them.
export function taskOfPanel(element){
    const key = Object.keys(element).find(k => k.indexOf("__reactInternalInstance$") === 0 || k.indexOf("__reactFiber$") === 0);
    let fiber = key ? element[key] : null;
    for (let i = 0; fiber && i < 5; i++, fiber = fiber.return){
        const props = fiber.memoizedProps;
        if (props && props.task && props.task.id && typeof props.onSave === "function") return props.task;
    }
    return null;
}

// The names the page shows around an Edit Task panel: its task's (the task's row) and its project's
export function namesAround(element){
    const row = element.closest(".task-list-item");
    const outer = row && row.parentElement && row.parentElement.closest(".task-list-item");
    const link = (outer || row) && (outer || row).querySelector(".name-link");
    const project = element.closest(".project-list-item");
    const title = project && project.querySelector(".project-name");
    const text = title && Array.from(title.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
    return link && text ? {project: text, task: link.textContent.trim()} : null;
}

// The task's id: from React's props, or else by its name and its project's (SplatMe's server answers only when
// exactly one task the user may see has them; a running task cannot be renamed). Null when neither says.
export function findTaskId(element){
    const task = taskOfPanel(element);
    if (task) return Promise.resolve(String(task.id));
    const names = namesAround(element);
    if (!names) return Promise.resolve(null);
    return request("GET", "find-task?project=" + encodeURIComponent(names.project) + "&task=" + encodeURIComponent(names.task))
        .then(answer => answer.id, () => null);
}

// SplatMe's panel above WebODM's Edit Task panel (a task's Edit on the Dashboard, put there by Dashboard.jsx):
// the task's automatic training, saved with the task when the Edit Task panel's Save succeeds, dropped with its
// Cancel. When the task cannot be told, it says where else the training is set.
export default class EditTaskSplats extends React.Component {
    static propTypes = {
        panel: PropTypes.object.isRequired     // WebODM's Edit Task panel's element
    };

    constructor(props){
        super(props);
        this.state = {taskId: null, lost: false, loaded: false, enabled: false, form: formFromOptions(null), advanced: false,
                      error: null, showCrop: true, listening: null};
    }

    componentDidMount(){
        this._mounted = true;
        // Before WebODM's own handler: Save waits for SplatMe's options to be right
        this.props.panel.addEventListener("click", this.handlePanelClick, true);
        findTaskId(this.props.panel).then(taskId => {
            if (!this._mounted) return;
            if (!taskId){
                this.setState({lost: true});
                return;
            }
            this.setState({taskId});
            this.load(taskId);
        });
    }

    load(taskId){
        request("GET", "task/" + taskId + "/status").then(status => {
            if (!this._mounted) return;
            this.setState({loaded: true, enabled: !!status.auto.enabled, form: formFromOptions(status.auto.options), listening: status.listening});
            // A task not set to train says nothing of the worker: the page asks, for when it is ticked here
            if (status.listening != null) return;
            return request("GET", "automation").then(answer => {
                if (this._mounted) this.setState({listening: answer.listening});
            });
        }).catch(() => {});
        request("GET", "task/" + taskId + "/check").then(check => {
            this.ranges = check.ranges;
            if (!this._mounted) return;
            this.setState({showCrop: !!check.boundary});
            if (this.touched) this.change({});  // the numbers typed before the ranges came are checked again
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
        this.props.panel.removeEventListener("click", this.handlePanelClick, true);
    }

    change(values){
        this.touched = true;
        const next = Object.assign({}, this.state, values);
        const { options, error } = optionsFromForm(next.form, this.ranges);
        // Switched off, the options are kept when they are right, and left to the defaults when not
        let setting = error ? null : Object.assign({enabled: next.enabled}, options);
        if (!next.enabled && error) setting = {enabled: false};
        editSettings.set(this.props.panel, setting, this.state.taskId);
        this.setState(Object.assign(values, {error: next.enabled ? error && _(error) : null}));
    }

    handlePanelClick = e => {
        if (!this.state.taskId) return;
        const actions = e.target.closest(".actions");
        if (!actions || !e.target.closest("button")) return;
        if (!e.target.closest(".save")){
            editSettings.pressed(this.props.panel, false);
            return;
        }
        const { error } = optionsFromForm(this.state.form, this.ranges);
        if (!this.state.enabled || !error){
            editSettings.pressed(this.props.panel, true);
            return;
        }
        this.change({});
        e.preventDefault();
        e.stopPropagation();
        ReactDOM.findDOMNode(this).scrollIntoView({behavior: "smooth", block: "start"});
    };

    render(){
        const { lost, loaded, enabled, form, advanced, error, showCrop, listening } = this.state;
        if (lost){
            return (
                <div className="new-task-panel theme-background-highlight splatme-panel">
                    <i className="fa fa-splat fa-fw"></i> <b>SplatMe</b> &mdash; {_("SplatMe cannot tell which task this is, so its training is not set here. Set it with Change beside Train Splats When Completed, in the task's panel.")}
                </div>
            );
        }
        if (!loaded) return null;
        return (
            <SplatMePanel enabled={enabled} form={form} advanced={advanced} error={error} showCrop={showCrop}
                          warning={enabled && listening === false ? _(NOT_LISTENING) : null}
                          onEnabled={value => this.change({enabled: value})}
                          onChange={(name, value) => this.change({form: Object.assign({}, form, {[name]: value})})}
                          onAdvanced={open => this.setState({advanced: open})} />
        );
    }
}
