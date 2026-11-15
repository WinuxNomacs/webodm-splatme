import React from 'React';
import { _ } from 'webodm/classes/gettext';
import TrainSplats from './TrainSplats';
import NewTask from './NewTask';
import { request } from './api';
import { ACCEPT, projectByName } from './newTask';
import { panelMode, rowNote, taskStatusText, nextRefresh, runningPercent, resultText, TASK_FAILED } from './trainingView';
import './TrainSplats.scss';

// SplatMe → Tasks (templates/tasks.html): the tasks the user may see, by project, each with its splats and what
// can be done with them: only the tasks SplatMe can train (api.py's tasks leaves out the others, and projects
// with none). One request for the whole list, asked again while a task trains or processes. ?task=<id> (the task panel's Open in SplatMe) shows that task's project and marks the task.
// New Task With Splats (NewTask.jsx) is in each project's heading; ?new=1 (the Dashboard's button) opens it for
// ?project=<id>, or for the project ?name= names when only one has that name.
export default class Tasks extends React.Component {
    constructor(props){
        super(props);
        const query = new URLSearchParams(window.location.search);
        this.focus = query.get("task");
        this.opening = query.get("new") ? {project: query.get("project"), name: query.get("name")} : null;
        this.newTasks = 0;
        this.state = {projects: null, addable: [], error: null, project: query.get("project") || "", newTask: null};
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
            const first = this.state.projects === null || this.focusNext;
            this.focusNext = false;
            this.setState({projects: data.projects, addable: data.addable || [], error: null}, () => {
                if (first) this.showFocus();
                if (this.opening) this.openFromAddress();
            });
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

    // The Dashboard's New Task With Splats: the box opens with no files (a browser opens its file picker only on a
    // click on this page)
    openFromAddress(){
        const { project, name } = this.opening;
        this.opening = null;
        const addable = this.state.addable.map(p => Object.assign({can_train: true}, p));
        const chosen = addable.find(p => String(p.id) === project) || (name ? projectByName(addable, name) : null);
        this.setState({newTask: {projectId: chosen ? String(chosen.id) : null, files: [], key: ++this.newTasks}});
    }

    // The file picker for a project's new task (the hidden input, clicked inside the user's click)
    pick(projectId){
        this.pickFor = projectId;
        if (this.fileInput) this.fileInput.click();
    }

    handlePicked = e => {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        if (!files.length) return;
        this.setState({newTask: {projectId: this.pickFor, files, key: ++this.newTasks}}, () => {
            const box = document.querySelector(".splatme-new-task-box");
            if (box && box.scrollIntoView) box.scrollIntoView({block: "start"});
        });
    };

    closeNewTask = () => {
        this.setState({newTask: null});
        const url = new URL(window.location.href);
        if (!url.searchParams.has("new")) return;
        url.searchParams.delete("new");
        url.searchParams.delete("name");
        window.history.replaceState(null, "", url.pathname + url.search);
    };

    // New Task With Splats above the projects: for the user's only project at once, or with a project choice
    newTaskAnyProject = () => {
        const { addable } = this.state;
        if (addable.length === 1) this.pick(String(addable[0].id));
        else this.setState({newTask: {projectId: null, files: [], key: ++this.newTasks}});
    };

    // WebODM committed the new task: it shows in its project, marked
    handleCreated = taskId => {
        this.closeNewTask();
        this.focus = taskId;
        this.focusNext = true;
        this.load();
    };

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
        const percent = runningPercent(task);
        return (
            <li key={task.id} id={"splatme-task-" + task.id} className={"list-group-item splatme-row" + (task.id === this.focus ? " theme-border-primary splatme-focus" : "")}>
                <div className="splatme-row-head">
                    <a href={dashboard} className="splatme-task-name"><i className="fa fa-tasks fa-fw"></i> {name}</a>
                    <span className="splatme-task-meta">
                        {_(taskStatusText(task.status))}{percent === null ? "" : ", " + percent + "%"}
                        {task.images_count ? " · " + Number(task.images_count).toLocaleString("en-US") + " " + (task.images_count === 1 ? _("image") : _("images")) : ""}
                    </span>
                </div>
                {task.status === TASK_FAILED && task.last_error ? <div className="text-danger splatme-task-error">{task.last_error}</div> : ""}
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
        const { projects, error, project, newTask } = this.state;
        if (projects === null){
            return error ? <div className="alert alert-danger">{error}</div> :
                <div><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Loading the tasks")}</div>;
        }
        const { addable } = this.state;
        // A project asked for in the address that has nothing to list shows them all
        const known = projects.some(p => String(p.id) === project) ? project : "";
        const shown = projects.filter(p => !known || String(p.id) === known);
        return (
            <div className="splatme-tasks">
                <p>{_("Create a task whose Gaussian splats are trained when it completes processing, train a completed task's splats on the splat node, follow a training, and choose whether a task is trained when it completes.")}</p>
                <input type="file" multiple accept={ACCEPT} className="hidden" ref={el => { this.fileInput = el; }} onChange={this.handlePicked} />
                {error ? <div className="alert alert-warning">{error}</div> : ""}
                {newTask ?
                    <NewTask key={newTask.key} files={newTask.files} projects={addable}
                             project={addable.find(p => String(p.id) === newTask.projectId) || null}
                             onPick={() => this.pick(newTask.projectId)}
                             onProject={id => this.setState({newTask: Object.assign({}, newTask, {projectId: id})})}
                             onCreated={this.handleCreated} onClose={this.closeNewTask} /> : ""}
                <div className="splatme-filter">
                    {projects.length ?
                        <div className="form-inline">
                            <label htmlFor="splatme-project">{_("Project")}</label>{" "}
                            <select id="splatme-project" className="form-control" value={known} onChange={this.handleProject}>
                                <option value="">{_("All Projects")}</option>
                                {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                            </select>
                        </div> : <span></span>}
                    {addable.length ?
                        <button type="button" className="btn btn-primary btn-sm splatme-new-task-any" disabled={!!newTask}
                                onClick={this.newTaskAnyProject}
                                title={_("Create a task whose Gaussian splats are trained when it completes processing")}>
                            <i className="fa fa-splat fa-fw"></i> {_("New Task With Splats")}
                        </button> : ""}
                </div>
                {!projects.length ?
                    <p className="text-muted splatme-none">{_("No task here can be trained by SplatMe yet: it trains tasks whose photos are JPEG.")}
                        {" "}{addable.length ? _("Create one with New Task With Splats.") : _("Create a project on the Dashboard first.")}</p> : ""}
                {shown.map(p =>
                    <div key={p.id} className="splatme-project">
                        <h4 className="splatme-project-head">
                            <span><i className="fa fa-folder fa-fw"></i> {p.name}</span>
                            {p.can_train ?
                                <button type="button" className="btn btn-default btn-sm splatme-new-task" disabled={!!newTask && newTask.projectId === String(p.id)}
                                        onClick={() => this.pick(String(p.id))}
                                        title={_("Create a task whose Gaussian splats are trained when it completes processing")}>
                                    <i className="fa fa-splat fa-fw"></i> <span className="hidden-xs">{_("New Task With Splats")}</span>
                                </button> : ""}
                        </h4>
                        {p.tasks.length ?
                            <ul className="list-group">{p.tasks.map(t => this.renderTask(p, t))}</ul> :
                            <p className="text-muted">{_("No tasks in this project.")}</p>}
                    </div>)}
            </div>
        );
    }
}
