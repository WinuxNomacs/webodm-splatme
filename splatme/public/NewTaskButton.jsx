import React from 'React';
import { _ } from 'webodm/classes/gettext';

// The New Task With Splats button of a project on the Dashboard, put by Dashboard.jsx after the buttons beside
// WebODM's Select Images and GCP (not through WebODM's addNewTaskButton hook: it keeps only the first plugin's
// answer, and SplatMe's would drop a plugin's that answers after loading its script). It opens SplatMe's Tasks
// page with that project's new task (NewTask.jsx), where SplatMe creates the task and saves its training setting
// itself. WebODM's page does not print the project's id, so the page is given its name and finds it there.
export default class NewTaskButton extends React.Component {
    // The project's name as WebODM prints it: the first text in its .project-name (its tags follow, in their own
    // elements)
    projectName(){
        const item = this.link && this.link.closest(".project-list-item");
        const place = item && item.querySelector(".project-name");
        if (!place) return "";
        return Array.from(place.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
    }

    // Set at the click, so a middle click or a new tab gets it too
    handleClick = () => {
        const name = this.projectName();
        this.link.href = "/plugins/splatme/?new=1" + (name ? "&name=" + encodeURIComponent(name) : "");
    };

    render(){
        return (
            <a href="/plugins/splatme/?new=1" className="btn btn-default btn-sm splatme-new-task"
               ref={el => { this.link = el; }} onClick={this.handleClick} onMouseDown={this.handleClick}
               title={_("Create a task whose Gaussian splats are trained when it completes processing, on SplatMe's Tasks page")}>
                <i className="fa fa-splat fa-fw"></i> <span className="hidden-xs">{_("New Task With Splats")}</span>
            </a>
        );
    }
}
