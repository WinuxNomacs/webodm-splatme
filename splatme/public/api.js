// Requests to the plugin's API (api.py), and to WebODM's own for a new task (taskUpload.js). WebODM checks Django's
// CSRF token, so every request that changes something sends the session's.
const BASE = "/api/plugins/splatme/";

function csrfToken(){
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
}

function failure(res, data){
    // SplatMe's {error}, Django REST framework's {detail}, [reason] or {field: [reason]}
    const fields = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).map(k => [].concat(data[k])[0]) : [];
    const message = data && (data.error || data.detail || (Array.isArray(data) && data[0]) || fields.find(f => typeof f === "string"));
    return new Error(message || (res.status === 404 ? "The task is gone, or you may not change it." : "The request failed (" + res.status + ")."));
}

function sendTo(url, method, body){
    const init = {method, credentials: "same-origin", headers: {}};
    if (method !== "GET"){
        init.headers["X-CSRFToken"] = csrfToken();
        // A form (files) sets its own type, with its boundary
        if (typeof FormData !== "undefined" && body instanceof FormData) init.body = body;
        else {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body || {});
        }
    }
    // A server that never answered (the network off, WebODM restarting) rejects with no status, in words
    return fetch(url, init).catch(() => {
        throw new Error("WebODM did not answer. Check the connection, then try again.");
    });
}

function send(method, path, body){
    return sendTo(BASE + path, method, body);
}

function answer(res){
    return res.json().catch(() => null).then(data => {
        if (!res.ok){
            const error = failure(res, data);
            error.status = res.status;
            throw error;
        }
        return data;
    });
}

// The answer's JSON; a refusal rejects with the server's reason as the error's message and its status, a server
// that never answered with no status
export function request(method, path, body){
    return send(method, path, body).then(answer);
}

// Where the browser downloads the task's model with its saved edits, as a .ply (a link: the server names the file)
export function downloadUrl(taskId){
    return BASE + "task/" + encodeURIComponent(taskId) + "/download";
}

// The same for a URL of WebODM's own API (/api/projects/...), or SplatMe's given whole
export function webodm(method, url, body){
    return sendTo(url, method, body).then(answer);
}

// The trainer's output from a byte on: {text, offset}, the offset being where to read on
export function readLog(taskId, offset){
    return send("GET", "task/" + taskId + "/log?offset=" + offset).then(res => {
        if (!res.ok) return res.json().catch(() => null).then(data => { throw failure(res, data); });
        return res.text().then(text => ({text, offset: parseInt(res.headers.get("X-Log-Offset"), 10) || offset}));
    });
}
