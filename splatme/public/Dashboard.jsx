import React from 'React';
import ReactDOM from 'ReactDOM';
import NewTaskButton from './NewTaskButton';
import EditTaskSplats from './EditTaskSplats';
import './TrainSplats.scss';

// SplatMe's parts of the Dashboard that WebODM gives a plugin no hook for (main.js starts this there): the New
// Task With Splats button after a project's buttons beside Select Images and GCP, and SplatMe's panel above each
// Edit Task panel. Both are put in the page as WebODM draws it; where a place is not found, nothing is put there
// and WebODM's page works as ever (the task's panel, through WebODM's own hook, still sets the training).
export default function start(){
    const parts = [];   // {anchor, container}: anchor is the element of WebODM's the part belongs to
    let pending = false;

    function put(anchor, container, element){
        parts.push({anchor, container});
        ReactDOM.render(element, container);
    }

    function look(){
        pending = false;
        for (let i = parts.length - 1; i >= 0; i--){
            if (parts[i].anchor.isConnected && parts[i].container.isConnected) continue;
            ReactDOM.unmountComponentAtNode(parts[i].container);
            if (parts[i].container.parentNode) parts[i].container.parentNode.removeChild(parts[i].container);
            parts.splice(i, 1);
        }
        const known = anchor => parts.some(p => p.anchor === anchor);

        // The project's buttons, shown to those who may add a task: after WebODM's and other plugins'
        document.querySelectorAll(".project-list-item .project-buttons .asset-download-buttons").forEach(group => {
            if (known(group)) return;
            const slot = document.createElement("span");
            slot.className = "splatme-button-slot";
            group.appendChild(slot);
            put(group, slot, React.createElement(NewTaskButton));
        });

        document.querySelectorAll(".edit-task-panel").forEach(panel => {
            if (known(panel)) return;
            const container = document.createElement("div");
            container.className = "splatme-panel-container";
            panel.parentNode.insertBefore(container, panel);
            put(panel, container, React.createElement(EditTaskSplats, {panel}));
        });
    }

    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(look, 0);
    }).observe(document.body, {childList: true, subtree: true});
    look();
}
