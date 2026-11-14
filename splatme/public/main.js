// On every page. Adds SplatMe's part of a task's expanded panel on the Dashboard: the Train Splats button, and a
// training's progress (TrainSplats.jsx, built by WebODM's webpack). Nothing on a task that failed or was canceled.
PluginsAPI.Dashboard.addTaskActionButton([
    "splatme/build/TrainSplats.js",
    "splatme/build/TrainSplats.css"
], function(args, TrainSplats){
    var task = args.task || {};
    if (!task.id || task.project == null || task.status === 30 || task.status === 50) return null;
    return React.createElement(TrainSplats, {taskId: task.id, projectId: task.project});
});
