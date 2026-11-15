// SplatMe's choice in its panel above one of WebODM's task panels (SplatMePanel.jsx), until WebODM saves that
// panel. WebODM tells a plugin neither which task a New Task panel creates nor when an Edit Task panel is saved:
// the choice waits here, with the WebODM panel it is for, and is given to the task once WebODM's own request
// for that panel succeeds. The page learns of it from jQuery's notice of that request, which answers with the
// task: POST /api/projects/<id>/tasks/ (New Task) or PATCH /api/projects/<id>/tasks/<task>/ (Edit Task).
// No React and no page here: Jest tests it with a stand-in for jQuery.
const CREATE = /^\/api\/projects\/\d+\/tasks\/$/;
const EDIT = /^\/api\/projects\/\d+\/tasks\/[^/]+\/$/;

function method(settings){
    return String(settings.type || settings.method || "").toUpperCase();
}

function path(settings){
    return String(settings.url).split("?")[0];
}

export function isCreation(settings){
    return method(settings) === "POST" && CREATE.test(path(settings));
}

export function isEdit(settings){
    return method(settings) === "PATCH" && EDIT.test(path(settings));
}

// $: jQuery; isRequest(settings): whether a request is the one that saves a panel; apply(taskId, setting, task):
// gives a choice to the task; every: milliseconds between two looks at whether a panel was closed without saving;
// missed(setting): a panel whose save button was pressed closed and no request was heard (WebODM saves another
// way than SplatMe knows): the choice did not reach the task
export function createPanelSettings($, isRequest, apply, every, missed){
    let waiting = [];   // {panel, setting, taskId, pressed}: panel is WebODM's panel's element; taskId, an Edit Task
                        // panel's; pressed, whether its save button was the last pressed
    let saving = 0;     // WebODM's requests saving a panel that have no answer yet
    let listening = false, timer = null;

    // The choices whose panel has left the page (saved or canceled), which stop waiting
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
            if (isRequest(settings)) saving++;
        });
        $(document).on("ajaxComplete", (e, xhr, settings) => {
            if (!isRequest(settings)) return;
            saving = Math.max(0, saving - 1);
            // WebODM closes the panel once it has sent the request, or once it is answered: a closed panel's
            // choice is this task's
            const closed = takeClosed();
            const task = xhr.responseJSON;
            if (!(xhr.status >= 200 && xhr.status < 300 && task && task.id)) return;
            const entry = closed.find(e => !e.taskId || e.taskId === task.id);
            if (entry) apply(task.id, entry.setting, task);
        });
    }

    return {
        get(panel){
            const entry = waiting.find(e => e.panel === panel);
            return entry ? entry.setting : null;
        },

        // setting: what apply is given for the task, or null for nothing; taskId: the task an Edit Task panel edits
        set(panel, setting, taskId){
            const before = waiting.find(e => e.panel === panel);
            waiting = waiting.filter(e => e.panel !== panel);
            if (!setting) return;
            waiting.push({panel, setting, taskId: taskId || null, pressed: !!(before && before.pressed)});
            listen();
            // A panel closed while nothing is being saved was canceled, and its choice is forgotten; unless its
            // save button was pressed last: then WebODM saved it without a request SplatMe knows
            if (!timer) timer = setInterval(() => {
                if (saving !== 0) return;
                takeClosed().forEach(entry => { if (entry.pressed && missed) missed(entry.setting); });
            }, every || 1000);
        },

        // pressed: whether the panel's save button (Review, Start Processing, Save) was pressed last, or Cancel
        pressed(panel, pressed){
            const entry = waiting.find(e => e.panel === panel);
            if (entry) entry.pressed = pressed;
        }
    };
}
