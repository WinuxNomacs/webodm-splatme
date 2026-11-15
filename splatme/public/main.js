// On every page. Adds SplatMe's parts of the Dashboard, both built by WebODM's webpack: in a task's expanded
// panel the Train Splats button and a training's progress (TrainSplats.jsx; nothing on a task that failed or was
// canceled), beside a project's Select Images and GCP the New Task With Splats button and SplatMe's panel above
// the New Task panel it opens (NewTaskButton.jsx), and SplatMe's panel above a task's Edit Task panel
// (EditTaskSplats.jsx, on the Dashboard only).
(function(){
    // A component is loaded once its place is on the page, not as a dependency of the hook: WebODM stops
    // listening after the first plugin's answer (ApiFactory.js), and an answer that waits for a script arrives
    // after another plugin's and is dropped.
    function lazy(name){
        function Lazy(props){
            React.Component.call(this, props);
            this.state = {component: null};
        }
        Lazy.prototype = Object.create(React.Component.prototype);
        Lazy.prototype.constructor = Lazy;
        Lazy.prototype.componentDidMount = function(){
            var self = this;
            PluginsAPI.SystemJS.import("splatme/build/" + name + ".css");
            PluginsAPI.SystemJS.import("splatme/build/" + name + ".js").then(function(m){
                if (!self.unmounted) self.setState({component: m["default"] || m});
            });
        };
        Lazy.prototype.componentWillUnmount = function(){ this.unmounted = true; };
        Lazy.prototype.render = function(){
            return this.state.component ? React.createElement(this.state.component, this.props) : null;
        };
        return Lazy;
    }
    var TrainSplats = lazy("TrainSplats"), NewTaskButton = lazy("NewTaskButton");

    PluginsAPI.Dashboard.addTaskActionButton(function(args){
        var task = args.task || {};
        if (!task.id || task.project == null || task.status === 30 || task.status === 50) return null;
        return React.createElement(TrainSplats, {taskId: task.id, projectId: task.project});
    });

    PluginsAPI.Dashboard.addNewTaskButton(function(args){
        return React.createElement(NewTaskButton, {projectId: args.projectId});
    });

    // WebODM gives a plugin no hook in the Edit Task panel: the page is watched for it
    if (/^\/dashboard\//.test(window.location.pathname)){
        PluginsAPI.SystemJS.import("splatme/build/EditTaskSplats.css");
        PluginsAPI.SystemJS.import("splatme/build/EditTaskSplats.js").then(function(m){ (m["default"] || m)(); });
    }
})();
