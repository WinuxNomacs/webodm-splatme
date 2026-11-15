import React from 'React';
import ReactDOM from 'ReactDOM';
import $ from 'jquery';
import { _, interpolate } from 'webodm/classes/gettext';
import SplatMePanel from './SplatMePanel';
import { request } from './api';
import { showNotice } from './notice';
import { createPanelSettings, isCreation } from './panelSettings';
import { NOT_LISTENING } from './restartText';
import { formFromOptions, optionsFromForm } from './trainingView';

// One for the page: the choices of the tasks not created yet (panelSettings.js)
const newTaskSettings = createPanelSettings($, isCreation, (taskId, setting, task) => {
    request("POST", "task/" + taskId + "/auto", setting).catch(e => {
        showNotice(interpolate(_("the training setting of the new task \"%(name)s\" was not saved: %(error)s Set it with Change on SplatMe's Tasks page."), {name: task.name || taskId, error: e.message}));
    });
}, 1000, () => {
    showNotice(_("WebODM created the task in a way SplatMe does not know, so its training setting was not saved. Set it with Change on SplatMe's Tasks page."));
});

// WebODM's own New Task panel in a project, not SplatMe's
const WEBODM_PANEL = ".new-task-panel:not(.splatme-panel)";
// How long after files are picked WebODM's New Task panel should have opened
const PANEL_WAIT = 3000;

// The New Task With Splats button of a project on the Dashboard, put by Dashboard.jsx after the buttons beside
// WebODM's Select Images and GCP (not through WebODM's addNewTaskButton hook: it keeps only the first plugin's
// answer, and SplatMe's would drop a plugin's that answers after loading its script). The task is WebODM's own:
// the button presses Select Images and GCP, so the files are picked and the New Task panel is filled as for any
// task, and SplatMe's panel opens above it (as DJI Thermal Analyzer's does), with Train Splats When Completed
// ticked and the options the administrators chose. Pressed while a New Task panel opened another way is open, it
// adds SplatMe's panel to that one. A task created from a New Task panel without SplatMe's is not trained by
// itself.
export default class NewTaskButton extends React.Component {
    constructor(props){
        super(props);
        this.state = {panel: null, shown: false, enabled: true, form: formFromOptions(null), advanced: false, error: null, listening: null};
        this.container = document.createElement("div");
        this.container.className = "splatme-panel-container";
    }

    componentDidMount(){
        this._mounted = true;
        this.item = this.button.closest(".project-list-item");
        const group = this.button.closest(".btn-group");
        this.uploadButton = group && group.querySelector("button.btn-primary");
        if (!this.item || !this.uploadButton) return;
        // WebODM tells a plugin neither that the panel opened nor that it closed
        this.observer = new MutationObserver(this.look);
        this.observer.observe(this.item, {childList: true, subtree: true});
        // Files picked with WebODM's own button, or dropped on the project, are an ordinary task's
        this.uploadButton.addEventListener("click", this.handleOwnPick, true);
        this.item.addEventListener("drop", this.disarm, true);
        // Before WebODM's own handlers: Review and Start Processing wait for SplatMe's options to be right
        this.item.addEventListener("click", this.handlePanelClick, true);
        // Files picked after this button: WebODM's panel should open
        document.addEventListener("change", this.handlePicked, true);
        this.look();
        request("GET", "automation?ranges=1").then(answer => {
            this.ranges = answer.ranges;
            this.initial = formFromOptions(answer.options);
            if (!this._mounted) return;
            this.setState({listening: answer.listening});
            // The numbers typed before the ranges came are checked again
            this.change(this.touched ? {} : {form: this.initial});
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
        clearTimeout(this.waitTimer);
        if (this.observer) this.observer.disconnect();
        if (this.uploadButton) this.uploadButton.removeEventListener("click", this.handleOwnPick, true);
        if (this.item){
            this.item.removeEventListener("drop", this.disarm, true);
            this.item.removeEventListener("click", this.handlePanelClick, true);
        }
        document.removeEventListener("change", this.handlePicked, true);
        if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
    }

    handleOwnPick = () => {
        if (!this.pressing) this.armed = false;
    };

    disarm = () => {
        this.armed = false;
    };

    handlePicked = e => {
        if (!this.armed || !e.target.files || !e.target.files.length) return;
        clearTimeout(this.waitTimer);
        this.waitTimer = setTimeout(() => {
            if (!this._mounted || !this.armed) return;
            this.armed = false;
            showNotice(_("New Task With Splats could not find WebODM's New Task panel on this page. Create the task with Select Images and GCP, then set its training with Change on SplatMe's Tasks page."));
        }, PANEL_WAIT);
    };

    look = () => {
        if (!this._mounted) return;
        const panel = this.item.querySelector(WEBODM_PANEL);
        if (panel === this.state.panel) return;
        const show = !!panel && this.armed;
        this.armed = false;
        clearTimeout(this.waitTimer);
        if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.setState({panel, shown: false}, () => { if (show) this.show(); });
    };

    // SplatMe's panel, above WebODM's, as it starts: ticked, with the administrators' options
    show(){
        const panel = this.state.panel;
        panel.parentNode.insertBefore(this.container, panel);
        this.touched = false;
        this.change({shown: true, enabled: true, form: this.initial || formFromOptions(null), advanced: false});
    }

    // A change of the panel's values: what the task will be given follows at once
    change(values){
        const next = Object.assign({}, this.state, values);
        const { options, error } = optionsFromForm(next.form, this.ranges);
        if (next.panel && next.shown) newTaskSettings.set(next.panel, next.enabled && !error ? Object.assign({enabled: true}, options) : null);
        this.setState(Object.assign(values, {error: next.enabled ? error && _(error) : null}));
    }

    handlePanelClick = e => {
        const { panel, shown, enabled, form } = this.state;
        if (!shown || !panel.contains(e.target)) return;
        if (e.target.closest("button.btn-danger")){
            newTaskSettings.pressed(panel, false);
            return;
        }
        if (!e.target.closest("button.btn-primary")) return;
        const { error } = optionsFromForm(form, this.ranges);
        if (!enabled || !error){
            newTaskSettings.pressed(panel, true);
            return;
        }
        this.change({});
        e.preventDefault();
        e.stopPropagation();
        this.container.scrollIntoView({behavior: "smooth", block: "start"});
    };

    handleClick = () => {
        if (!this.uploadButton){
            showNotice(_("New Task With Splats could not find WebODM's Select Images and GCP button on this page. Create the task with WebODM's button, then set its training with Change on SplatMe's Tasks page."));
            return;
        }
        if (this.state.panel){
            this.show();
            return;
        }
        // The files are not picked yet, and may never be: the panel that opens next from this press is the one
        this.armed = true;
        this.pressing = true;
        this.uploadButton.click();
        this.pressing = false;
    };

    render(){
        const { shown, enabled, form, advanced, error, listening } = this.state;
        return (
            <React.Fragment>
                <button type="button" className="btn btn-default btn-sm splatme-new-task" disabled={shown}
                        ref={el => { if (el) this.button = el; }} onClick={this.handleClick}
                        title={_("Create a task whose Gaussian splats are trained when it completes processing")}>
                    <i className="fa fa-splat fa-fw"></i> <span className="hidden-xs">{_("New Task With Splats")}</span>
                </button>
                {shown ? ReactDOM.createPortal(
                    <SplatMePanel enabled={enabled} form={form} advanced={advanced} error={error}
                                  warning={enabled && listening === false ? _(NOT_LISTENING) : null}
                                  onEnabled={value => { this.touched = true; this.change({enabled: value}); }}
                                  onChange={(name, value) => { this.touched = true; this.change({form: Object.assign({}, form, {[name]: value})}); }}
                                  onAdvanced={open => this.setState({advanced: open})} />,
                    this.container) : ""}
            </React.Fragment>
        );
    }
}
