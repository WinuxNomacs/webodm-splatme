// Requests to the plugin's API (api.py). WebODM checks Django's CSRF token on a plugin's API, so every request
// that changes something sends the session's.
const BASE = "/api/plugins/splatme/";

function csrfToken(){
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
}

function failure(res, data){
    const message = data && (data.error || data.detail || (Array.isArray(data) && data[0]));
    return new Error(message || (res.status === 404 ? "The task is gone, or you may not change it." : "The request failed (" + res.status + ")."));
}

function send(method, path, body){
    const init = {method, credentials: "same-origin", headers: {}};
    if (method !== "GET"){
        init.headers["X-CSRFToken"] = csrfToken();
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body || {});
    }
    return fetch(BASE + path, init);
}

// The answer's JSON; a refusal rejects with the server's reason as the error's message
export function request(method, path, body){
    return send(method, path, body).then(res =>
        res.json().catch(() => null).then(data => {
            if (!res.ok) throw failure(res, data);
            return data;
        }));
}

// The trainer's output from a byte on: {text, offset}, the offset being where to read on
export function readLog(taskId, offset){
    return send("GET", "task/" + taskId + "/log?offset=" + offset).then(res => {
        if (!res.ok) return res.json().catch(() => null).then(data => { throw failure(res, data); });
        return res.text().then(text => ({text, offset: parseInt(res.headers.get("X-Log-Offset"), 10) || offset}));
    });
}
