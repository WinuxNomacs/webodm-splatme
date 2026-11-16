import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { request } from './api';
import { splatsLine, justCompleted, FAST, SLOW, SETTLE, TASK_QUEUED, TASK_RUNNING } from './trainingView';

// The task panel's line on the Dashboard (Dashboard.jsx puts it under the panel's Task ID): the task's splats in
// a few words and Open in SplatMe, where they are trained (for a task SplatMe lists there). It follows a training
// or a processing task by itself, and a task set to train for a while after it completes, until its training shows.
export default class TaskLine extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired
    };

    constructor(props){
        super(props);
        this.state = {status: null, listed: true};
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
        // The first request also asks whether SplatMe lists the task (its folder is read for that)
        const first = this.state.status === null;
        request("GET", "task/" + this.props.taskId + "/status" + (first ? "?listed=1" : "")).then(status => {
            if (!this._mounted) return;
            if (justCompleted(this.state.status, status)) this.settleUntil = Date.now() + SETTLE;
            this.setState(first ? {status, listed: status.listed !== false} : {status});
            // While the task processes it may start training when it completes
            const processing = [null, TASK_QUEUED, TASK_RUNNING].indexOf(status.task_status) !== -1;
            if (status.active || Date.now() < (this.settleUntil || 0)) this.timer = setTimeout(this.refresh, FAST);
            else if (processing) this.timer = setTimeout(this.refresh, SLOW);
        }).catch(e => {
            // The task is gone (WebODM's panel says so); otherwise WebODM may be restarting: asked again
            if (this._mounted && e.status !== 404 && e.status !== 403) this.timer = setTimeout(this.refresh, SLOW);
        });
    };

    render(){
        const { status } = this.state;
        const link = "/plugins/splatme/?task=" + encodeURIComponent(this.props.taskId);
        return (
            <span className="splatme-line">
                {status ? _(splatsLine(status)) : <i className="fa fa-circle-notch fa-spin fa-fw"></i>}
                {this.state.listed ?
                    <React.Fragment>{" · "}<a href={link}><i className="fa fa-splat fa-fw"></i>{_("Open in SplatMe")}</a></React.Fragment> :
                    <span className="text-muted">{" · "}{_("SplatMe trains tasks whose photos are JPEG (or DJI Thermal Analyzer's TIFFs)")}</span>}
            </span>
        );
    }
}
