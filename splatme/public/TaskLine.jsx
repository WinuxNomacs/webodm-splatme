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
        this.state = {status: null, listed: true, unlisted: null, error: null};
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
            this.setState(first ? {status, listed: status.listed !== false, unlisted: status.unlisted, error: null} : {status, error: null});
            // While the task processes it may start training when it completes
            const processing = [null, TASK_QUEUED, TASK_RUNNING].indexOf(status.task_status) !== -1;
            if (status.active || Date.now() < (this.settleUntil || 0)) this.timer = setTimeout(this.refresh, FAST);
            else if (processing) this.timer = setTimeout(this.refresh, SLOW);
        }).catch(e => {
            if (!this._mounted) return;
            // Said in place of the line until an answer comes. Gone or refused (a session that ended): not asked
            // again; otherwise WebODM may be restarting
            this.setState({error: e.status === 403 ? _("Sign in again to see this task's splats.") : e.message});
            if (e.status !== 404 && e.status !== 403) this.timer = setTimeout(this.refresh, SLOW);
        });
    };

    render(){
        const { status, error } = this.state;
        const waiting = error ? <span className="text-muted">{error}</span> : <i className="fa fa-circle-notch fa-spin fa-fw"></i>;
        const link = "/plugins/splatme/?task=" + encodeURIComponent(this.props.taskId);
        return (
            <span className="splatme-line">
                {status ? _(splatsLine(status)) : waiting}
                {this.state.listed ?
                    <React.Fragment>{" · "}<a href={link}><i className="fa fa-splat fa-fw"></i>{_("Open in SplatMe")}</a></React.Fragment> :
                    <span className="text-muted">{" · "}{this.state.unlisted || _("SplatMe trains tasks whose photos are JPEG (or DJI Thermal Analyzer's TIFFs).")}</span>}
            </span>
        );
    }
}
