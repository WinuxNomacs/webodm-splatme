import React from 'React';
import ReactDOM from 'ReactDOM';
import { _ } from 'webodm/classes/gettext';
import NewTaskButton from './NewTaskButton';
import TaskLine from './TaskLine';
import './TrainSplats.scss';

// SplatMe's parts of the Dashboard (main.js starts this there), put in the page as WebODM draws it rather than
// through WebODM's hooks, which keep only the first plugin's answer: the New Task With Splats button (a link to
// SplatMe's Tasks page) after a project's buttons beside Select Images and GCP, and a line under a task panel's Task ID with the task's splats
// and Open in SplatMe. Where a place is not found, nothing is put there and WebODM's page works as ever.
export default function start(){
    const parts = [];   // {anchor, container, element}: anchor is the element of WebODM's the part belongs to;
                        // element, what SplatMe added when it is more than the container
    let pending = false;

    function put(anchor, container, element){
        parts.push({anchor, container});
        ReactDOM.render(element, container);
    }

    function look(){
        pending = false;
        for (let i = parts.length - 1; i >= 0; i--){
            if (parts[i].anchor.isConnected && parts[i].container.isConnected) continue;
            const element = parts[i].element || parts[i].container;  // what SplatMe added, around the container
            ReactDOM.unmountComponentAtNode(parts[i].container);
            if (element.parentNode) element.parentNode.removeChild(element);
            parts.splice(i, 1);
        }
        const known = anchor => parts.some(p => p.anchor === anchor);

        // SplatMe's button stays last in its group (keeping the group's rounded ends): another plugin's button can be
        // added after it
        document.querySelectorAll(".splatme-button-slot").forEach(slot => {
            if (slot.nextElementSibling && slot.parentNode) slot.parentNode.appendChild(slot);
        });

        // The project's buttons, shown to those who may add a task: after WebODM's and other plugins'
        document.querySelectorAll(".project-list-item .project-buttons .asset-download-buttons").forEach(group => {
            if (known(group)) return;
            const slot = document.createElement("span");
            slot.className = "splatme-button-slot";
            group.appendChild(slot);
            put(group, slot, React.createElement(NewTaskButton));
        });

        // The expanded panel's Task ID, as WebODM prints it: its row, followed by SplatMe's
        document.querySelectorAll(".expanded-panel .info-table .task-id-link").forEach(link => {
            const row = link.closest("tr");
            const taskId = (link.textContent || "").trim().split(/\s+/)[0];
            if (!row || !taskId || known(row)) return;
            const line = document.createElement("tr");
            line.className = "splatme-line-row";
            const label = document.createElement("td");
            const strong = document.createElement("strong");
            strong.textContent = _("Splats:");
            label.appendChild(strong);
            const cell = document.createElement("td");
            line.appendChild(label);
            line.appendChild(cell);
            row.parentNode.insertBefore(line, row.nextSibling);
            parts.push({anchor: row, container: cell, element: line});
            ReactDOM.render(React.createElement(TaskLine, {taskId}), cell);
        });
    }

    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        setTimeout(look, 0);
    }).observe(document.body, {childList: true, subtree: true});
    look();
}
