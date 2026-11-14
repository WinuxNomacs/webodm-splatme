// On every page. Adds SplatMe's parts of the Dashboard, both built by WebODM's webpack: in a task's expanded
// panel the Train Splats button and a training's progress (TrainSplats.jsx; nothing on a task that failed or was
// canceled), and in the Edit Task Options dialog the task's automatic training (OptionsButton.jsx).
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
    var TrainSplats = lazy("TrainSplats"), OptionsButton = lazy("OptionsButton");

    PluginsAPI.Dashboard.addTaskActionButton(function(args){
        var task = args.task || {};
        if (!task.id || task.project == null || task.status === 30 || task.status === 50) return null;
        return React.createElement(TrainSplats, {taskId: task.id, projectId: task.project});
    });

    // WebODM draws a plugin's control only below one of the dialog's own options: the point cloud's quality,
    // which every node has, or else the first option there is
    PluginsAPI.Dashboard.presetDialogOptionsReady(function(args){
        var options = args.options || {};
        var below = options["pc-quality"] ? "pc-quality" : Object.keys(options)[0];
        if (!below) return null;
        var controls = {};
        controls[below] = React.createElement(OptionsButton, {taskId: args.task && args.task.id ? String(args.task.id) : null});
        return {controls: controls};
    });
})();
