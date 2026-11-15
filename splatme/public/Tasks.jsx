import React from 'React';
import { _ } from 'webodm/classes/gettext';
import TrainSplats from './TrainSplats';
import { request } from './api';
import { panelMode, rowNote, taskStatusText, nextRefresh, resultText } from './trainingView';
import './TrainSplats.scss';

// SplatMe → Tasks (templates/tasks.html): the tasks the user may see, by project, each with its splats and what
// can be done with them. One request for the whole list (api.py's tasks), asked again while a task trains or
// processes. ?task=<id> (the task panel's Open in SplatMe) shows that task's project and marks the task.
export default class Tasks extends React.Component {
    constructor(props){
        super(props);
        const query = new URLSearchParams(window.location.search);
        this.focus = query.get("task");
        this.state = {projects: null, error: null, project: query.get("project") || ""};
    }

    componentDidMount(){
        this._mounted = true;
        this.load();
    }

    componentWillUnmount(){
        this._mounted = false;
        clearTimeout(this.timer);
    }

    load = () => {
        clearTimeout(this.timer);
        request("GET", "tasks").then(data => {
            if (!this._mounted) return;
            const first = this.state.projects === null;
            this.setState({projects: data.projects, error: null}, () => { if (first) this.showFocus(); });
            this.schedule(data.projects);
        }).catch(e => {
            if (!this._mounted) return;
            this.setState({error: e.message});
            // The server may be restarting: ask again while there was something to follow
            if (nextRefresh(this.state.projects)) this.timer = setTimeout(this.load, 15000);
        });
    };

    schedule(projects){
        clearTimeout(this.timer);
        const wait = nextRefresh(projects);
        if (wait) this.timer = setTimeout(this.load, wait);
    }

    // The task asked for in the address: its project is the one shown, and the task is scrolled to
    showFocus(){
        if (!this.focus) return;
        const project = (this.state.projects || []).find(p => p.tasks.some(t => t.id === this.focus));
        if (!project) return;
        this.setState({project: String(project.id)}, () => {
            const row = document.getElementById("splatme-task-" + this.focus);
            if (row && row.scrollIntoView) row.scrollIntoView({block: "center"});
        });
    }

    // A row's action answered with the task's new status
    handleStatus = (taskId, status) => {
        const projects = this.state.projects.map(project => Object.assign({}, project, {
            tasks: project.tasks.map(task => task.id === taskId ? Object.assign({}, task, {splats: status}) : task)
        }));
        this.setState({projects});
        this.schedule(projects);
    };

    handleProject = e => {
        const project = e.target.value;
        this.setState({project});
        const url = new URL(window.location.href);
        url.searchParams.delete("task");
        if (project) url.searchParams.set("project", project);
        else url.searchParams.delete("project");
        window.history.replaceState(null, "", url.pathname + url.search);
    };

    renderTask(project, task){
        const status = task.splats;
        const hidden = panelMode(status) === "hidden";
        const note = rowNote(status);
        const result = hidden ? resultText(status) : "";
        const dashboard = "/dashboard/?project_task_open=" + project.id + "&project_task_expanded=" + task.id;
        const name = task.name || _("Task of") + " " + new Date(task.created_at).toLocaleString();
        return (
            <li key={task.id} id={"splatme-task-" + task.id} className={"list-group-item splatme-row" + (task.id === this.focus ? " theme-border-primary splatme-focus" : "")}>
                <div className="splatme-row-head">
                    <a href={dashboard} className="splatme-task-name"><i className="fa fa-tasks fa-fw"></i> {name}</a>
                    <span className="splatme-task-meta">
                        {_(taskStatusText(task.status))}
                        {task.images_count ? " · " + Number(task.images_count).toLocaleString("en-US") + " " + (task.images_count === 1 ? _("image") : _("images")) : ""}
                    </span>
                </div>
                {hidden ?
                    <div className="splatme-task splatme-idle">
                        {status.has_splats ?
                            <a className="btn btn-sm btn-default" href={"/3d/project/" + project.id + "/task/" + task.id + "/?t=splats"}>
                                <i className="fa fa-cube fa-fw"></i> {_("View in 3D")}
                            </a> : ""}
                        {result ? <span className="splatme-result">{result}</span> : ""}
                        {note ? <span className="text-muted">{_(note)}</span> : ""}
                    </div> :
                    <TrainSplats taskId={task.id} projectId={project.id} status={status}
                                 onStatus={s => this.handleStatus(task.id, s)} onRefresh={this.load} />}
            </li>
        );
    }

    render(){
        const { projects, error, project } = this.state;
        if (projects === null){
            return error ? <div className="alert alert-danger">{error}</div> :
                <div><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading the tasks")}</div>;
        }
        const shown = projects.filter(p => !project || String(p.id) === project);
        return (
            <div className="splatme-tasks">
                <p>{_("Train a completed task's Gaussian splats on the splat node, follow a training, and choose whether a task is trained when it completes processing.")}
                    {" "}<a href="/dashboard/">{_("New Task With Splats")}</a> {_("is beside Select Images and GCP in a project on the Dashboard.")}</p>
                {error ? <div className="alert alert-warning">{error}</div> : ""}
                {projects.length ?
                    <div className="form-inline splatme-filter">
                        <label htmlFor="splatme-project">{_("Project")}</label>{" "}
                        <select id="splatme-project" className="form-control" value={project} onChange={this.handleProject}>
                            <option value="">{_("All Projects")}</option>
                            {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                        </select>
                    </div> :
                    <p className="text-muted">{_("You have no projects yet. Create one on the Dashboard.")}</p>}
                {shown.map(p =>
                    <div key={p.id} className="splatme-project">
                        <h4><i className="fa fa-folder fa-fw"></i> {p.name}</h4>
                        {p.tasks.length ?
                            <ul className="list-group">{p.tasks.map(t => this.renderTask(p, t))}</ul> :
                            <p className="text-muted">{_("No tasks in this project.")}</p>}
                    </div>)}
            </div>
        );
    }
}
