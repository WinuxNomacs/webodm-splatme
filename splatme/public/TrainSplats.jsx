import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import TrainDialog from './TrainDialog';
import LogDialog from './LogDialog';
import AutoDialog from './AutoDialog';
import { NOT_LISTENING } from './restartText';
import { request, downloadUrl } from './api';
import { getUnitSystem } from 'webodm/classes/Units';
import { overallProgress, stageText, panelMode, resultText, autoText } from './trainingView';
import { applyText } from './editShapes';

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
        if (!window.confirm(_("Stop this training? The task keeps the splat model it has."))) return;
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

    // The row's status line, then its buttons: Train Splats and Edit first, View in 3D and Download .ply after them
    // (in a menu on a phone)
    renderButton(status, waiting){
        const result = waiting ? "" : resultText(status, getUnitSystem() === "imperial");
        const applying = !!status.apply && status.apply.state === "applying";
        const view = status.has_splats && !waiting ? "/3d/project/" + this.props.projectId + "/task/" + this.props.taskId + "/?t=splats" : null;
        const download = status.editable && !waiting ? downloadUrl(this.props.taskId) : null;
        const more = [
            view ? {href: view, icon: "fa-cube", label: _("View in 3D"), title: _("The splats in WebODM's 3D view")} : null,
            download ? {href: download, icon: "fa-download", label: _("Download .ply"), title: _("The splat model with its edits, as a .ply other splat tools open")} : null
        ].filter(Boolean);
        return (
            <div className="splatme-idle">
                {result ? <div className={"splatme-result" + (status.state === "failed" ? " text-danger" : "")}>{result}</div> : ""}
                {status.apply && status.apply.state !== "completed" ?
                    <div className={"splatme-apply" + (status.apply.state === "failed" ? " text-danger" : "")}>
                        {applying ? <i className="fa fa-circle-notch fa-spin fa-fw"></i> : ""} {applyText(status.apply)}
                    </div> : ""}
                <div className="splatme-actions">
                    <button type="button" className="btn btn-sm btn-primary" disabled={waiting || applying} onClick={() => this.setState({dialog: true})}
                            title={waiting ? _("The task has not completed processing.") : applying ? _("The task's edits are being applied.") : _("Train this task's Gaussian splats on the splat node")}>
                        <i className="fa fa-splat fa-fw"></i> {status.has_splats && !waiting ? _("Train Splats Again") : _("Train Splats")}
                    </button>
                    {(status.editable || status.model_editable) && status.can_train && !waiting ?
                        <a className="btn btn-sm btn-primary" href={"/plugins/splatme/edit/" + this.props.taskId + "/" + (status.editable ? "" : "?model=1")}
                           title={status.editable ? _("Edit the splat model and the textured 3D model") : _("Clean up the textured 3D model")}>
                            <i className="fa fa-edit fa-fw"></i> {_("Edit")}
                        </a> : ""}
                    {more.map(m => (
                        <a key={m.icon} className="btn btn-sm btn-secondary hidden-xs" href={m.href} title={m.title}>
                            <i className={"fa fa-fw " + m.icon}></i> {m.label}
                        </a>
                    ))}
                    {more.length ?
                        <div className="btn-group visible-xs-inline-block">
                            <button type="button" className="btn btn-sm btn-secondary dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"
                                    aria-label={_("More")}>
                                <i className="fa fa-ellipsis-h fa-fw"></i> <span className="caret"></span>
                            </button>
                            <ul className="dropdown-menu">
                                {more.map(m => <li key={m.icon}><a href={m.href}><i className={"fa fa-fw " + m.icon}></i> {m.label}</a></li>)}
                            </ul>
                        </div> : ""}
                    {status.state === "failed" ?
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => this.setState({log: true})}>
                            <i className="fa fa-file-alt fa-fw"></i> {_("Show Log")}
                        </button> : ""}
                </div>
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
