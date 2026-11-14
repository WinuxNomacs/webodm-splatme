import React from 'React';
import PropTypes from 'prop-types';
import $ from 'jquery';
import { _ } from 'webodm/classes/gettext';
import AutoDialog from './AutoDialog';
import { request } from './api';
import { createNewTaskSettings } from './newTaskSettings';
import { autoText } from './trainingView';
import './TrainSplats.scss';

// One for the page: the settings of the tasks not created yet (newTaskSettings.js)
const newTaskSettings = createNewTaskSettings($, (taskId, setting) => {
    request("POST", "task/" + taskId + "/auto", {...setting.options, enabled: setting.enabled}).catch(e => {
        console.error("SplatMe: the new task's setting was not saved: " + e.message);
    });
});

// SplatMe's part of WebODM's Edit Task Options dialog (the Options row's Edit button, in the New Task and Edit
// Task panels), drawn below one of its options: whether the task's splats are trained when it completes, with a
// dialog to change it. The setting is not one of the dialog's options: it is saved when chosen, whatever the
// dialog's own Save and Cancel do. An existing task's is saved on the server at once; a new task's waits on
// the page until WebODM creates the task.
export default class OptionsButton extends React.Component {
    static propTypes = {
        taskId: PropTypes.string    // none for a task that is not created yet
    };

    constructor(props){
        super(props);
        this.state = {auto: null, ranges: null, open: false, container: null, panel: null};
    }

    componentDidMount(){
        this._mounted = true;
        const container = this.element.closest(".modal");
        if (this.props.taskId){
            this.setState({container});
            request("GET", "task/" + this.props.taskId + "/auto").then(auto => {
                if (this._mounted) this.setState({auto});
            }).catch(() => {});
            return;
        }
        const panel = this.element.closest(".new-task-panel");
        if (!panel) return;
        this.setState({container, panel});
        request("GET", "automation?ranges=1").then(answer => {
            if (!this._mounted) return;
            this.fallback = {enabled: answer.enabled, options: answer.options, own: false};
            this.setState({auto: newTaskSettings.get(panel) || this.fallback, ranges: answer.ranges});
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    handleSaved = auto => {
        if (!this.props.taskId){
            newTaskSettings.set(this.state.panel, auto.own ? auto : null);
            if (!auto.own) auto = this.fallback;
        }
        this.setState({auto, open: false});
    };

    render(){
        const { auto, open } = this.state;
        return (
            <div className="splatme-options" ref={el => { if (el) this.element = el; }}>
                {auto ?
                    <React.Fragment>
                        <label>SplatMe</label><br/>
                        <button type="button" className="btn btn-sm btn-default splatme-options-button" onClick={() => this.setState({open: true})}
                                title={_("Train this task's splats when it completes processing")}>
                            <i className="fa fa-magic fa-fw"></i> {_("Train Splats When Completed")}: <b>{_(autoText(auto))}</b>
                        </button>
                    </React.Fragment> : ""}
                {open ?
                    <AutoDialog taskId={this.props.taskId} auto={auto} ranges={this.state.ranges} container={this.state.container}
                                onSaved={this.handleSaved} onClose={() => this.setState({open: false})} /> : ""}
            </div>
        );
    }
}
