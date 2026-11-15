import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { request } from './api';
import { splatsLine, FAST, SLOW, TASK_QUEUED, TASK_RUNNING } from './trainingView';

// The task panel's line on the Dashboard (Dashboard.jsx puts it under the panel's Task ID): the task's splats in
// a few words and Open in SplatMe, where they are trained. It follows a training or a processing task by itself.
export default class TaskLine extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired
    };

    constructor(props){
        super(props);
        this.state = {status: null};
    }

    componentDidMount(){
        this._mounted = true;
        this.refresh();
    }

    componentWillUnmount(){
        this._mounted = false;
        clearTimeout(this.timer);
    }

    refresh = () => {
        request("GET", "task/" + this.props.taskId + "/status").then(status => {
            if (!this._mounted) return;
            this.setState({status});
            // While the task processes it may start training when it completes
            const processing = [null, TASK_QUEUED, TASK_RUNNING].indexOf(status.task_status) !== -1;
            if (status.active) this.timer = setTimeout(this.refresh, FAST);
            else if (processing) this.timer = setTimeout(this.refresh, SLOW);
        }).catch(() => {});  // the task is gone: WebODM's panel says so
    };

    render(){
        const { status } = this.state;
        const link = "/plugins/splatme/?task=" + encodeURIComponent(this.props.taskId);
        return (
            <span className="splatme-line">
                {status ? _(splatsLine(status)) : <i className="fa fa-circle-notch fa-spin fa-fw"></i>}
                {" · "}<a href={link}><i className="fa fa-splat fa-fw"></i>{_("Open in SplatMe")}</a>
            </span>
        );
    }
}
