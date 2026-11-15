// The setting of a task that does not exist yet (NewTaskButton.jsx). WebODM tells a plugin neither which task
// is created nor when: the setting waits here, with the New Task panel it is for, and is given to the task
// WebODM creates when that panel is saved. The page learns of that task from
// jQuery's notice of WebODM's own request (POST /api/projects/<id>/tasks/), which answers with the task.
// No React and no page here: Jest tests it with a stand-in for jQuery.
const CREATE = /^\/api\/projects\/\d+\/tasks\/$/;

function isCreation(settings){
    return String(settings.type || settings.method || "").toUpperCase() === "POST" &&
           CREATE.test(String(settings.url).split("?")[0]);
}

// $: jQuery; apply(taskId, setting): gives a setting to a created task; every: milliseconds between two looks
// at whether a panel was closed without creating a task
export function createNewTaskSettings($, apply, every){
    let waiting = [];   // {panel, setting}: panel is the New Task panel's element
    let creating = 0;   // WebODM's requests creating a task that have no answer yet
    let listening = false, timer = null;

    // The settings whose panel has left the page (saved or canceled), which stop waiting
    function takeClosed(){
        const closed = waiting.filter(entry => !entry.panel.isConnected);
        waiting = waiting.filter(entry => entry.panel.isConnected);
        if (!waiting.length && timer){
            clearInterval(timer);
            timer = null;
        }
        return closed;
    }

    function listen(){
        if (listening) return;
        listening = true;
        $(document).on("ajaxSend", (e, xhr, settings) => {
            if (isCreation(settings)) creating++;
        });
        $(document).on("ajaxComplete", (e, xhr, settings) => {
            if (!isCreation(settings)) return;
            creating = Math.max(0, creating - 1);
            // WebODM closes the panel as it sends the request: the setting of a closed panel is this task's
            const closed = takeClosed();
            const task = xhr.responseJSON;
            if (closed.length && xhr.status >= 200 && xhr.status < 300 && task && task.id) apply(task.id, closed[0].setting);
        });
    }

    return {
        get(panel){
            const entry = waiting.find(e => e.panel === panel);
            return entry ? entry.setting : null;
        },

        // setting: what apply is given for the task, or null for none
        set(panel, setting){
            waiting = waiting.filter(e => e.panel !== panel);
            if (!setting) return;
            waiting.push({panel, setting});
            listen();
            // A panel closed while no task is being created was canceled: its setting is forgotten
            if (!timer) timer = setInterval(() => { if (creating === 0) takeClosed(); }, every || 1000);
        }
    };
}
