import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import TrainDialog from './TrainDialog';
import LogDialog from './LogDialog';
import { request } from './api';
import { overallProgress, stageText, panelMode, resultText } from './trainingView';
import './TrainSplats.scss';

const FAST = 3000;  // between questions while a training runs
const SLOW = 15000; // while the task itself is still processing

// SplatMe's part of a task's expanded panel on the Dashboard (main.js): the Train Splats button, and while a
// training runs its stage, a progress bar, Cancel and Show Log. WebODM asks a plugin for this once, when the panel
// opens, so the component follows the task by itself: it asks the plugin for the task's status (api.py), which
// is the same for everyone looking at the task and survives a reload of the page.
export default class TrainSplats extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        projectId: PropTypes.number.isRequired
    };

    constructor(props){
        super(props);
        this.state = {status: null, dialog: false, log: false, canceling: false, error: null};
    }

    componentDidMount(){
        this._mounted = true;
        this.refresh();
    }

    componentWillUnmount(){
        this._mounted = false;
        clearTimeout(this.timer);
    }

    refresh = () => {
        clearTimeout(this.timer);
        request("GET", "task/" + this.props.taskId + "/status").then(status => {
            if (this._mounted) this.setStatus(status);
        }).catch(() => {
            // The task is gone, or the server is restarting: ask again while there was something to follow
            if (this._mounted && this.state.status) this.timer = setTimeout(this.refresh, SLOW);
        });
    };

    setStatus = status => {
        clearTimeout(this.timer);
        this.setState({status, canceling: status.active ? this.state.canceling : false});
        const mode = panelMode(status);
        if (mode === "progress") this.timer = setTimeout(this.refresh, FAST);
        else if (mode === "waiting") this.timer = setTimeout(this.refresh, SLOW);
    };

    handleStarted = status => {
        this.setState({dialog: false, error: null});
        this.setStatus(status);
    };

    handleCancel = () => {
        if (!window.confirm(_("Stop this training? The task keeps the splats model it has."))) return;
        this.setState({canceling: true, error: null});
        request("POST", "task/" + this.props.taskId + "/cancel").then(status => {
            if (this._mounted) this.setStatus(status);
        }).catch(e => {
            if (this._mounted) this.setState({canceling: false, error: e.message});
        });
    };

    renderProgress(status){
        const percent = overallProgress(status);
        return (
            <div className="splatme-progress">
                <div className="splatme-stage"><i className="fa fa-splat fa-fw"></i> {_("Training Splats")}: {stageText(status)}</div>
                <div className="splatme-bar-row">
                    <div className="progress">
                        <div className="progress-bar progress-bar-success active" style={{width: percent + "%"}}>{percent}%</div>
                    </div>
                    {status.can_train ?
                        <button type="button" className="btn btn-sm btn-default" disabled={this.state.canceling} onClick={this.handleCancel}>
                            <i className={this.state.canceling ? "fa fa-circle-notch fa-spin fa-fw" : "glyphicon glyphicon-remove-circle"}></i> {_("Cancel")}
                        </button> : ""}
                    <button type="button" className="btn btn-sm btn-default" onClick={() => this.setState({log: true})}>
                        <i className="fa fa-file-alt fa-fw"></i> {_("Show Log")}
                    </button>
                </div>
            </div>
        );
    }

    renderButton(status, waiting){
        const result = waiting ? "" : resultText(status);
        return (
            <div className="splatme-idle">
                <button type="button" className="btn btn-sm btn-primary" disabled={waiting} onClick={() => this.setState({dialog: true})}
                        title={waiting ? _("The task has not completed processing.") : _("Train this task's Gaussian splats on the splat node")}>
                    <i className="fa fa-splat fa-fw"></i> {status.has_splats && !waiting ? _("Train Splats Again") : _("Train Splats")}
                </button>
                {status.state === "completed" && status.has_splats ?
                    <a className="btn btn-sm btn-default" href={"/3d/project/" + this.props.projectId + "/task/" + this.props.taskId + "/?t=splats"}>
                        <i className="fa fa-cube fa-fw"></i> {_("View in 3D")}
                    </a> : ""}
                {status.state === "failed" ?
                    <button type="button" className="btn btn-sm btn-default" onClick={() => this.setState({log: true})}>
                        <i className="fa fa-file-alt fa-fw"></i> {_("Show Log")}
                    </button> : ""}
                {result ? <span className={"splatme-result" + (status.state === "failed" ? " text-danger" : "")}>{result}</span> : ""}
            </div>
        );
    }

    render(){
        const { status, dialog, log, error } = this.state;
        const mode = panelMode(status);
        if (mode === "hidden") return null;
        return (
            <div className="splatme-task">
                {mode === "progress" ? this.renderProgress(status) : this.renderButton(status, mode === "waiting")}
                {error ? <div className="text-danger">{error}</div> : ""}
                {dialog ? <TrainDialog taskId={this.props.taskId} onStarted={this.handleStarted} onClose={() => this.setState({dialog: false})} /> : ""}
                {log ? <LogDialog taskId={this.props.taskId} active={!!status.active} onClose={() => this.setState({log: false})} /> : ""}
            </div>
        );
    }
}
