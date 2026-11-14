// On every page. Adds SplatMe's part of a task's expanded panel on the Dashboard: the Train Splats button, and a
// training's progress (TrainSplats.jsx, built by WebODM's webpack). Nothing on a task that failed or was canceled.
(function(){
    // The component is loaded once the button is on the page, not as a dependency of addTaskActionButton: WebODM
    // stops listening after the first plugin's answer (ApiFactory.js), and an answer that waits for a script
    // arrives after another plugin's and is dropped.
    function TrainSplats(props){
        React.Component.call(this, props);
        this.state = {component: null};
    }
    TrainSplats.prototype = Object.create(React.Component.prototype);
    TrainSplats.prototype.constructor = TrainSplats;
    TrainSplats.prototype.componentDidMount = function(){
        var self = this;
        PluginsAPI.SystemJS.import("splatme/build/TrainSplats.css");
        PluginsAPI.SystemJS.import("splatme/build/TrainSplats.js").then(function(m){
            if (!self.unmounted) self.setState({component: m["default"] || m});
        });
    };
    TrainSplats.prototype.componentWillUnmount = function(){ this.unmounted = true; };
    TrainSplats.prototype.render = function(){
        return this.state.component ? React.createElement(this.state.component, this.props) : null;
    };

    PluginsAPI.Dashboard.addTaskActionButton(function(args){
        var task = args.task || {};
        if (!task.id || task.project == null || task.status === 30 || task.status === 50) return null;
        return React.createElement(TrainSplats, {taskId: task.id, projectId: task.project});
    });
})();
