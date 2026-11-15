import React from 'React';
import PropTypes from 'prop-types';
import NewTaskPanel from 'webodm/components/NewTaskPanel';
import exifr from 'webodm/vendor/exifr';
import { _, interpolate } from 'webodm/classes/gettext';
import SplatMePanel from './SplatMePanel';
import { request, webodm } from './api';
import { Upload } from './newTask';
import { NOT_LISTENING } from './restartText';
import { formFromOptions, optionsFromForm } from './trainingView';

// New Task With Splats on SplatMe's Tasks page (Tasks.jsx): the files the user picked, SplatMe's panel (Train Splats
// When Completed and its options, from the user's New Task With Splats defaults) above WebODM's own New Task panel
// (name, processing node, options, resize, align to, GCP and map previews), then the upload (newTask.js), followed
// here until WebODM commits the task. The task then shows in its project's list.
export default class NewTask extends React.Component {
    static propTypes = {
        project: PropTypes.object,              // {id, name, tasks}; null until the user chooses one
        projects: PropTypes.array.isRequired,   // the projects the user may add a task to
        files: PropTypes.array.isRequired,      // the picked files; none yet when opened from the Dashboard
        onPick: PropTypes.func.isRequired,      // () opens the file picker
        onProject: PropTypes.func.isRequired,   // (projectId)
        onCreated: PropTypes.func.isRequired,   // (taskId)
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {
            phase: "edit",      // "edit", "uploading", "failed"
            attempt: 0,         // WebODM's panel is drawn afresh after a failed creation
            enabled: true, form: formFromOptions(null), advanced: false, formError: null,
            listening: null, error: null, progress: null
        };
    }

    componentDidMount(){
        this._mounted = true;
        window.addEventListener("beforeunload", this.handleLeave);
        request("GET", "automation?ranges=1").then(answer => {
            this.ranges = answer.ranges;
            if (!this._mounted) return;
            this.setState({listening: answer.listening});
            this.change(this.touched ? {} : {form: formFromOptions(answer.options)});
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
        window.removeEventListener("beforeunload", this.handleLeave);
    }

    // Leaving the page stops the upload half way, a partial task left with some of the files
    handleLeave = e => {
        if (this.state.phase !== "uploading") return undefined;
        e.preventDefault();
        e.returnValue = "";
        return "";
    };

    change(values){
        const next = Object.assign({}, this.state, values);
        const { error } = optionsFromForm(next.form, this.ranges);
        this.setState(Object.assign(values, {formError: next.enabled ? error && _(error) : null}));
    }

    // What POST task/<id>/auto is given, or null for a task not trained by itself
    setting(){
        if (!this.state.enabled) return null;
        const { options, error } = optionsFromForm(this.state.form, this.ranges);
        return error ? undefined : Object.assign({enabled: true}, options);
    }

    // Before WebODM's own handler: Review and Start Processing wait for SplatMe's options to be right
    handleClick = e => {
        if (!e.target.closest(".new-task-panel:not(.splatme-panel) button.btn-primary")) return;
        if (this.setting() !== undefined) return;
        this.change({});
        e.preventDefault();
        e.stopPropagation();
        if (this.splatmePanel && this.splatmePanel.scrollIntoView) this.splatmePanel.scrollIntoView({behavior: "smooth", block: "start"});
    };

    getFiles = () => this.props.files;

    // As WebODM's own panel: a name from the first photo's date, and the map preview if it has a position. The
    // place name WebODM looks up online is left out: SplatMe calls no outside service.
    suggestedTaskName = hasGPS => {
        const first = this.props.files.find(f => f.type.indexOf("image") === 0);
        if (!first) return Promise.reject();
        return exifr.parse(first, {ifd0: false, exif: [0x9003], gps: [0x0001, 0x0002, 0x0003, 0x0004], interop: false, ifd1: false}).then(exif => {
            exif = exif || {};
            if (exif.latitude && exif.longitude && hasGPS) hasGPS();
            let date = exif.DateTimeOriginal;
            date = date && date.toLocaleDateString ? date.toLocaleDateString() : new Date(first.lastModified).toLocaleDateString();
            return interpolate(_("Splats - %(date)s"), {date});
        });
    };

    handleSave = taskInfo => {
        this.upload = new Upload({
            projectId: this.props.project.id, files: this.props.files, send: webodm,
            onProgress: progress => { if (this._mounted) this.setState({progress}); }
        });
        this.setState({phase: "uploading", error: null, progress: null});
        this.follow(this.upload.start(taskInfo, this.setting()));
    };

    follow(promise){
        const upload = this.upload;
        promise.then(task => {
            if (upload.canceled) return;
            this.upload = null;
            if (this._mounted) this.props.onCreated(String(task.id));
        }).catch(e => {
            if (upload.canceled || !this._mounted) return;
            // Before the task existed (or once it was removed) the panel is filled again; after, its files are sent again
            if (!upload.task) this.setState(state => ({phase: "edit", attempt: state.attempt + 1, error: _("The task was not created:") + " " + e.message}));
            else this.setState({phase: "failed", error: e.message});
        });
    }

    handleRetry = () => {
        this.setState({phase: "uploading", error: null});
        this.follow(this.upload.retry());
    };

    handleCancel = () => {
        const upload = this.upload;
        if (upload && upload.task && !window.confirm(_("Stop the upload? The task is removed with the files sent so far."))) return;
        this.upload = null;
        if (upload) upload.cancel();
        this.props.onClose();
    };

    renderProgress(){
        const { progress, phase, error } = this.state;
        const share = progress && progress.total ? Math.round(progress.sent * 100 / progress.total) : 0;
        return (
            <div className="splatme-upload">
                {phase === "uploading" ?
                    <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {progress ?
                        interpolate(_("Uploading: %(done)s of %(files)s files sent."), {done: progress.done.toLocaleString("en-US"), files: progress.files.toLocaleString("en-US")}) :
                        _("Creating the task")}</p> : ""}
                <div className="progress">
                    <div className={"progress-bar" + (phase === "failed" ? " progress-bar-danger" : "")} role="progressbar"
                         style={{width: share + "%"}} aria-valuenow={share} aria-valuemin="0" aria-valuemax="100">{share}%</div>
                </div>
                {phase === "failed" ?
                    <div className="alert alert-warning">
                        {error} {_("Try again to send the files that did not go, or cancel to remove the task.")}
                    </div> : ""}
                <div className="text-right">
                    {phase === "failed" ?
                        <button type="button" className="btn btn-primary btn-sm splatme-retry" onClick={this.handleRetry}>
                            <i className="fa fa-redo fa-fw"></i> {_("Try Again")}
                        </button> : ""}
                    {" "}<button type="button" className="btn btn-default btn-sm" onClick={this.handleCancel}>
                        <i className="fa fa-times fa-fw"></i> {_("Cancel")}
                    </button>
                </div>
            </div>
        );
    }

    render(){
        const { project, projects, files } = this.props;
        const { phase, attempt, enabled, form, advanced, formError, listening, error } = this.state;
        return (
            <div className="panel panel-default splatme-new-task-box">
                <div className="panel-heading">
                    <i className="fa fa-splat fa-fw"></i> {project ?
                        interpolate(_("New Task With Splats in %(project)s"), {project: project.name}) : _("New Task With Splats")}
                </div>
                <div className="panel-body">
                    {!project ?
                        <div className="form-inline">
                            <label htmlFor="splatme-new-project">{_("Project")}</label>{" "}
                            <select id="splatme-new-project" className="form-control" value=""
                                    onChange={e => this.props.onProject(e.target.value)}>
                                <option value="">{_("Choose a project")}</option>
                                {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                            </select>{" "}
                            <button type="button" className="btn btn-default btn-sm" onClick={this.props.onClose}>{_("Cancel")}</button>
                        </div> :
                    phase !== "edit" ? this.renderProgress() :
                    !files.length ?
                        <div>
                            <p>{_("Pick the task's photos, and its GCP file and other text files if it has them.")}</p>
                            <button type="button" className="btn btn-primary btn-sm splatme-pick" onClick={this.props.onPick}>
                                <i className="glyphicon glyphicon-upload"></i> {_("Select Images and GCP")}
                            </button>{" "}
                            <button type="button" className="btn btn-default btn-sm" onClick={this.props.onClose}>{_("Cancel")}</button>
                        </div> :
                        <div onClickCapture={this.handleClick}>
                            {error ? <div className="alert alert-warning">{error}</div> : ""}
                            <div ref={el => { this.splatmePanel = el; }}>
                                <SplatMePanel enabled={enabled} form={form} advanced={advanced} error={formError}
                                              warning={enabled && listening === false ? _(NOT_LISTENING) : null}
                                              onEnabled={value => { this.touched = true; this.change({enabled: value}); }}
                                              onChange={(name, value) => { this.touched = true; this.change({form: Object.assign({}, form, {[name]: value})}); }}
                                              onAdvanced={open => this.setState({advanced: open})} />
                            </div>
                            <NewTaskPanel key={attempt}
                                          onSave={this.handleSave}
                                          onCancel={this.props.onClose}
                                          suggestedTaskName={this.suggestedTaskName}
                                          filesCount={files.length}
                                          showResize={true}
                                          showAlign={(project.tasks || []).length > 0}
                                          projectId={project.id}
                                          getFiles={this.getFiles} />
                        </div>}
                </div>
            </div>
        );
    }
}
