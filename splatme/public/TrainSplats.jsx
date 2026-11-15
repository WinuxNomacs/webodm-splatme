import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import TrainDialog from './TrainDialog';
import LogDialog from './LogDialog';
import AutoDialog from './AutoDialog';
import { NOT_LISTENING } from './restartText';
import { request } from './api';
import { overallProgress, stageText, panelMode, resultText, autoText } from './trainingView';

// A task's splats on SplatMe's Tasks page (Tasks.jsx): the Train Splats button, while a training runs its stage,
// a progress bar, Cancel and Show Log, and whether the task is trained when it completes, with Change. The page
// asks for every task's status at once and gives this row its own (status); an action's answer goes back to the
// page (onStatus), and so does a wish to ask again (onRefresh).
export default class TrainSplats extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        projectId: PropTypes.number.isRequired,
        status: PropTypes.object.isRequired,
        onStatus: PropTypes.func.isRequired,
        onRefresh: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {dialog: false, log: false, auto: false, canceling: false, error: null};
    }

    componentDidMount(){
        this._mounted = true;
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    componentDidUpdate(previous){
        if (previous.status !== this.props.status && !this.props.status.active && this.state.canceling){
            this.setState({canceling: false});
        }
    }

    setStatus = status => this.props.onStatus(status);

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

    handleAutoSaved = () => {
        this.setState({auto: false});
        this.props.onRefresh();  // the status says again whether the worker listens, now that it may matter
    };

    // Whether the task is trained when it completes, with Change for those who may train it
    renderAuto(status){
        if (!status.auto) return "";
        return (
            <div className="splatme-auto">
                <i className="fa fa-magic fa-fw"></i> {_("Train Splats When Completed")}: <b>{_(autoText(status.auto))}</b>
                {status.can_train ?
                    <a href="javascript:void(0)" className="splatme-auto-change" onClick={() => this.setState({auto: true})}>{_("Change")}</a> : ""}
                {status.auto.enabled && status.listening === false ?
                    <div className="text-warning splatme-auto-warning"><i className="fa fa-exclamation-triangle fa-fw"></i> {_(NOT_LISTENING)}</div> : ""}
            </div>
        );
    }

    renderProgress(status){
        const percent = overallProgress(status);
        return (
            <div className="splatme-progress">
                <div className="splatme-stage"><i className="fa fa-splat fa-fw"></i> {_("Training Splats")}: {stageText(status)}</div>
                <div className="splatme-bar-row">
                    {/* The number is beside the bar, not in it: WebODM's Dashboard asks before leaving the page
                        while a visible .progress-bar's text is between 0 and 100 (its uploads), and leaving
                        does not stop a training */}
                    <div className="progress">
                        <div className="progress-bar progress-bar-success active" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                             aria-valuenow={percent} style={{width: percent + "%"}}></div>
                    </div>
                    <span className="splatme-percent">{percent}%</span>
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
                {status.has_splats && !waiting ?
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
        const { dialog, log, auto, error } = this.state;
        const { status } = this.props;
        const mode = panelMode(status);
        if (mode === "hidden") return null;
        return (
            <div className="splatme-task">
                {mode === "progress" ? this.renderProgress(status) : this.renderButton(status, mode === "waiting")}
                {this.renderAuto(status)}
                {error ? <div className="text-danger">{error}</div> : ""}
                {dialog ? <TrainDialog taskId={this.props.taskId} onStarted={this.handleStarted} onClose={() => this.setState({dialog: false})} /> : ""}
                {auto ? <AutoDialog taskId={this.props.taskId} auto={status.auto} onSaved={this.handleAutoSaved} onClose={() => this.setState({auto: false})} /> : ""}
                {log ? <LogDialog taskId={this.props.taskId} active={!!status.active} onClose={() => this.setState({log: false})} /> : ""}
            </div>
        );
    }
}
