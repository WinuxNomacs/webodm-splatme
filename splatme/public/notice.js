// A message SplatMe must not leave in the browser's console only (a task's training setting that was not saved,
// a part of WebODM's page SplatMe could not find): a dismissible alert at the bottom of the page, as Bootstrap
// draws them. Plain DOM, so it shows whatever React does.
let box = null;

export function showNotice(text){
    if (!box || !box.isConnected){
        box = document.createElement("div");
        box.className = "splatme-notices";
        document.body.appendChild(box);
    }
    const alert = document.createElement("div");
    alert.className = "alert alert-warning alert-dismissible";
    alert.setAttribute("role", "alert");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = "<span aria-hidden=\"true\">&times;</span>";
    close.addEventListener("click", () => alert.parentNode && alert.parentNode.removeChild(alert));
    const icon = document.createElement("i");
    icon.className = "fa fa-splat fa-fw";
    alert.appendChild(close);
    alert.appendChild(icon);
    alert.appendChild(document.createTextNode(" SplatMe: " + text));
    box.appendChild(alert);
    console.warn("SplatMe: " + text);
}
