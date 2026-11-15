import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _ } from 'webodm/classes/gettext';
import SplatMePanel from './SplatMePanel';
import { request } from './api';
import { createPanelSettings, isCreation } from './panelSettings';
import { formFromOptions, optionsFromForm } from './trainingView';
import './TrainSplats.scss';

// One for the page: the choices of the tasks not created yet (panelSettings.js)
const newTaskSettings = createPanelSettings($, isCreation, (taskId, setting) => {
    request("POST", "task/" + taskId + "/auto", setting).catch(e => {
        console.error("SplatMe: the new task's setting was not saved: " + e.message);
    });
});

// WebODM's own New Task panel in a project, not SplatMe's
const WEBODM_PANEL = ".new-task-panel:not(.splatme-panel)";

// The New Task With Splats button of a project on the Dashboard, beside WebODM's Select Images and GCP
// (main.js). The task is WebODM's own: the button presses Select Images and GCP, so the files are picked and
// the New Task panel is filled as for any task, and SplatMe's panel opens above it (as DJI Thermal Analyzer's
// does), with Train Splats When Completed ticked and the options the administrators chose. Pressed while a
// New Task panel opened another way is open, it adds SplatMe's panel to that one. A task created from a New
// Task panel without SplatMe's is not trained by itself.
export default class NewTaskButton extends React.Component {
    static propTypes = {
        projectId: PropTypes.number
    };

    constructor(props){
        super(props);
        this.state = {panel: null, shown: false, enabled: true, form: formFromOptions(null), advanced: false, error: null};
        this.container = document.createElement("div");
        this.container.className = "splatme-panel-container";
    }

    componentDidMount(){
        this._mounted = true;
        this.item = this.button.closest(".project-list-item");
        this.uploadButton = this.button.parentNode.querySelector("button.btn-primary");
        if (!this.item || !this.uploadButton) return;
        // WebODM tells a plugin neither that the panel opened nor that it closed
        this.observer = new MutationObserver(this.look);
        this.observer.observe(this.item, {childList: true, subtree: true});
        // Files picked with WebODM's own button, or dropped on the project, are an ordinary task's
        this.uploadButton.addEventListener("click", this.handleOwnPick, true);
        this.item.addEventListener("drop", this.disarm, true);
        // Before WebODM's own handlers: Review and Start Processing wait for SplatMe's options to be right
        this.item.addEventListener("click", this.holdSave, true);
        this.look();
        request("GET", "automation?ranges=1").then(answer => {
            this.ranges = answer.ranges;
            this.initial = formFromOptions(answer.options);
            // The numbers typed before the ranges came are checked again
            if (this._mounted) this.change(this.touched ? {} : {form: this.initial});
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
        if (this.observer) this.observer.disconnect();
        if (this.uploadButton) this.uploadButton.removeEventListener("click", this.handleOwnPick, true);
        if (this.item){
            this.item.removeEventListener("drop", this.disarm, true);
            this.item.removeEventListener("click", this.holdSave, true);
        }
        if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
    }

    handleOwnPick = () => {
        if (!this.pressing) this.armed = false;
    };

    disarm = () => {
        this.armed = false;
    };

    look = () => {
        if (!this._mounted) return;
        const panel = this.item.querySelector(WEBODM_PANEL);
        if (panel === this.state.panel) return;
        const show = !!panel && this.armed;
        this.armed = false;
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

    holdSave = e => {
        const { panel, shown, enabled, form } = this.state;
        if (!shown || !enabled || !panel.contains(e.target) || !e.target.closest("button.btn-primary")) return;
        const { error } = optionsFromForm(form, this.ranges);
        if (!error) return;
        this.change({});
        e.preventDefault();
        e.stopPropagation();
        this.container.scrollIntoView({behavior: "smooth", block: "start"});
    };

    handleClick = () => {
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
        const { shown, enabled, form, advanced, error } = this.state;
        return (
            <React.Fragment>
                <button type="button" className="btn btn-default btn-sm splatme-new-task" disabled={shown}
                        ref={el => { if (el) this.button = el; }} onClick={this.handleClick}
                        title={_("Create a task whose Gaussian splats are trained when it completes processing")}>
                    <i className="fa fa-splat fa-fw"></i> <span className="hidden-xs">{_("New Task With Splats")}</span>
                </button>
                {shown ? ReactDOM.createPortal(
                    <SplatMePanel enabled={enabled} form={form} advanced={advanced} error={error}
                                  onEnabled={value => { this.touched = true; this.change({enabled: value}); }}
                                  onChange={(name, value) => { this.touched = true; this.change({form: Object.assign({}, form, {[name]: value})}); }}
                                  onAdvanced={open => this.setState({advanced: open})} />,
                    this.container) : ""}
            </React.Fragment>
        );
    }
}
