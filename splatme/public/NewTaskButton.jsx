import React from 'React';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _ } from 'webodm/classes/gettext';
import { request } from './api';
import { createNewTaskSettings } from './newTaskSettings';
import './TrainSplats.scss';

// What a task created with the button is given: automatic training, with the options the administrators chose
const SETTING = {enabled: true, new_task: true};

// One for the page: the settings of the tasks not created yet (newTaskSettings.js)
const newTaskSettings = createNewTaskSettings($, (taskId, setting) => {
    request("POST", "task/" + taskId + "/auto", setting).catch(e => {
        console.error("SplatMe: the new task's setting was not saved: " + e.message);
    });
});

// The New Task With Splats button of a project on the Dashboard, beside WebODM's Select Images and GCP
// (main.js). The task is WebODM's own: the button presses Select Images and GCP, so the files are picked and
// the New Task panel is filled as for any task, and the task created from that panel has its splats trained
// when it completes. While the project's New Task panel is open, the button shows whether that is so and
// switches it: on a panel opened with it, off on one opened by WebODM's button or by dropped files.
export default class NewTaskButton extends React.Component {
    static propTypes = {
        projectId: PropTypes.number
    };

    constructor(props){
        super(props);
        this.state = {panel: null, on: false};
    }

    componentDidMount(){
        this.item = this.button.closest(".project-list-item");
        this.uploadButton = this.button.parentNode.querySelector("button.btn-primary");
        if (!this.item || !this.uploadButton) return;
        // WebODM tells a plugin neither that the panel opened nor that it closed
        this.observer = new MutationObserver(this.look);
        this.observer.observe(this.item, {childList: true, subtree: true});
        // Files picked with WebODM's own button, or dropped on the project, are an ordinary task's
        this.uploadButton.addEventListener("click", this.handleOwnPick, true);
        this.item.addEventListener("drop", this.disarm, true);
        this.look();
    }

    componentWillUnmount(){
        if (this.observer) this.observer.disconnect();
        if (this.uploadButton) this.uploadButton.removeEventListener("click", this.handleOwnPick, true);
        if (this.item) this.item.removeEventListener("drop", this.disarm, true);
    }

    handleOwnPick = () => {
        if (!this.pressing) this.armed = false;
    };

    disarm = () => {
        this.armed = false;
    };

    look = () => {
        const panel = this.item.querySelector(".new-task-panel");
        if (panel === this.state.panel) return;
        if (panel && this.armed){
            newTaskSettings.set(panel, SETTING);
            this.armed = false;
        }
        this.setState({panel, on: !!(panel && newTaskSettings.get(panel))});
    };

    handleClick = () => {
        const { panel, on } = this.state;
        if (panel){
            newTaskSettings.set(panel, on ? null : SETTING);
            this.setState({on: !on});
            return;
        }
        // The files are not picked yet, and may never be: the panel that opens next from this press is the one
        this.armed = true;
        this.pressing = true;
        this.uploadButton.click();
        this.pressing = false;
    };

    render(){
        const { panel, on } = this.state;
        let title = _("Create a task whose Gaussian splats are trained when it completes processing");
        if (panel) title = on ? _("This task's splats are trained when it completes processing. Press to create it without.") :
                                _("Press to train this task's splats when it completes processing.");
        return (
            <button type="button" className={"btn btn-default btn-sm splatme-new-task" + (on ? " active" : "")}
                    ref={el => { if (el) this.button = el; }} onClick={this.handleClick} title={title} aria-pressed={panel ? on : undefined}>
                <i className={on ? "fa fa-check fa-fw" : "fa fa-splat fa-fw"}></i> <span className="hidden-xs">{_("New Task With Splats")}</span>
            </button>
        );
    }
}
