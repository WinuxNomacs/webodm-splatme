// On every page. On the Dashboard starts SplatMe's parts of it (Dashboard.jsx, built by WebODM's webpack): the New
// Task With Splats button with SplatMe's panel above the New Task panel, and a task panel's line with its splats
// and Open in SplatMe. Splats are trained on SplatMe's Tasks page, not through WebODM's task panel hook, whose
// first answer drops the other plugins' buttons. In the side menu's Administration, SplatMe's admin page.
(function(){
    // Not through WebODM's hooks (addNewTaskButton, addTaskActionButton): they keep only the first plugin's answer,
    // and an immediate one from SplatMe would drop another plugin's button that answers after loading its script
    if (/^\/dashboard\//.test(window.location.pathname)){
        PluginsAPI.SystemJS.import("splatme/build/Dashboard.css");
        PluginsAPI.SystemJS.import("splatme/build/Dashboard.js").then(function(m){ (m["default"] || m)(); });
    }

    // Administration has no plugin hook: SplatMe's item goes at the end of its list, found by its Plugins link.
    // WebODM draws Administration only for staff accounts, so no one else gets the item.
    function addAdminItem(){
        var plugins = document.querySelector('#side-menu a[href="/admin/app/plugin/"]');
        var list = plugins && plugins.closest("ul");
        if (!list || list.querySelector('a[href="/plugins/splatme/admin/"]')) return;
        var item = document.createElement("li");
        var link = document.createElement("a");
        var icon = document.createElement("i");
        link.href = "/plugins/splatme/admin/";
        icon.className = "fa fa-splat fa-fw";
        link.appendChild(icon);
        link.appendChild(document.createTextNode(" SplatMe"));
        item.appendChild(link);
        list.appendChild(item);
    }
    // Plugins' scripts load in the page's head, before the side menu
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addAdminItem);
    else addAdminItem();
})();
