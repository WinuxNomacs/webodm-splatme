import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _ } from 'webodm/classes/gettext';
import SplatMePanel from './SplatMePanel';
import { request } from './api';
import { createPanelSettings, isEdit } from './panelSettings';
import { formFromOptions, optionsFromForm } from './trainingView';
import './TrainSplats.scss';

// One for the page: the choices made in Edit Task panels not saved yet (panelSettings.js)
const editSettings = createPanelSettings($, isEdit, (taskId, setting) => {
    request("POST", "task/" + taskId + "/auto", setting).catch(e => {
        console.error("SplatMe: the task's setting was not saved: " + e.message);
    });
});

// The task an Edit Task panel edits. WebODM puts nothing in the page that names it, and gives a plugin no hook
// there: it is read from the props React gave the panel (React 16 keeps them on the element). Without it,
// SplatMe's panel is not shown and WebODM's works as ever.
export function taskOfPanel(element){
    const key = Object.keys(element).find(k => k.indexOf("__reactInternalInstance$") === 0 || k.indexOf("__reactFiber$") === 0);
    let fiber = key ? element[key] : null;
    for (let i = 0; fiber && i < 5; i++, fiber = fiber.return){
        const props = fiber.memoizedProps;
        if (props && props.task && props.task.id && typeof props.onSave === "function") return props.task;
    }
    return null;
}

// SplatMe's panel above WebODM's Edit Task panel (a task's Edit on the Dashboard): the task's automatic
// training, saved with the task when the Edit Task panel's Save succeeds, dropped with its Cancel.
class EditTaskSplats extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        panel: PropTypes.object.isRequired     // WebODM's Edit Task panel's element
    };

    constructor(props){
        super(props);
        this.state = {loaded: false, enabled: false, form: formFromOptions(null), advanced: false, error: null, showCrop: true};
    }

    componentDidMount(){
        this._mounted = true;
        // Before WebODM's own handler: Save waits for SplatMe's options to be right
        this.props.panel.addEventListener("click", this.holdSave, true);
        request("GET", "task/" + this.props.taskId + "/auto").then(auto => {
            if (this._mounted) this.setState({loaded: true, enabled: !!auto.enabled, form: formFromOptions(auto.options)});
        }).catch(() => {});
        request("GET", "task/" + this.props.taskId + "/check").then(check => {
            this.ranges = check.ranges;
            if (!this._mounted) return;
            this.setState({showCrop: !!check.boundary});
            if (this.touched) this.change({});  // the numbers typed before the ranges came are checked again
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
        this.props.panel.removeEventListener("click", this.holdSave, true);
    }

    change(values){
        this.touched = true;
        const next = Object.assign({}, this.state, values);
        const { options, error } = optionsFromForm(next.form, this.ranges);
        // Switched off, the options are kept when they are right, and left to the defaults when not
        let setting = error ? null : Object.assign({enabled: next.enabled}, options);
        if (!next.enabled && error) setting = {enabled: false};
        editSettings.set(this.props.panel, setting, this.props.taskId);
        this.setState(Object.assign(values, {error: next.enabled ? error && _(error) : null}));
    }

    holdSave = e => {
        if (!this.state.enabled || !e.target.closest(".actions .save")) return;
        const { error } = optionsFromForm(this.state.form, this.ranges);
        if (!error) return;
        this.change({});
        e.preventDefault();
        e.stopPropagation();
        ReactDOM.findDOMNode(this).scrollIntoView({behavior: "smooth", block: "start"});
    };

    render(){
        const { loaded, enabled, form, advanced, error, showCrop } = this.state;
        if (!loaded) return null;
        return (
            <SplatMePanel enabled={enabled} form={form} advanced={advanced} error={error} showCrop={showCrop}
                          onEnabled={value => this.change({enabled: value})}
                          onChange={(name, value) => this.change({form: Object.assign({}, form, {[name]: value})})}
                          onAdvanced={open => this.setState({advanced: open})} />
        );
    }
}

// Watches the Dashboard for Edit Task panels and puts SplatMe's above each (main.js starts it)
export default function watch(){
    const open = [];    // {panel, container}
    let pending = false;

    function look(){
        pending = false;
        for (let i = open.length - 1; i >= 0; i--){
            if (open[i].panel.isConnected) continue;
            ReactDOM.unmountComponentAtNode(open[i].container);
            if (open[i].container.parentNode) open[i].container.parentNode.removeChild(open[i].container);
            open.splice(i, 1);
        }
        document.querySelectorAll(".edit-task-panel").forEach(panel => {
            if (open.some(o => o.panel === panel)) return;
            const task = taskOfPanel(panel);
            if (!task) return;
            const container = document.createElement("div");
            container.className = "splatme-panel-container";
            panel.parentNode.insertBefore(container, panel);
            open.push({panel, container});
            ReactDOM.render(<EditTaskSplats taskId={String(task.id)} panel={panel} />, container);
        });
    }

    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(look, 0);
    }).observe(document.body, {childList: true, subtree: true});
    look();
}
