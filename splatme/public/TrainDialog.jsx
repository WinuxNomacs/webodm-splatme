import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import { request } from './api';
import OptionsFields from './OptionsFields';
import { optionsFromForm } from './trainingView';

// The Train Splats dialog: what stands in the way (the task, the splat node), WebODM's own warning about photos
// that all point down, the options, and Start Training.
export default class TrainDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        onStarted: PropTypes.func.isRequired,
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {check: null, error: null, starting: false, advanced: false,
                      form: {steps: "7000", image_size: "1600", max_gaussians: ""}};
    }

    componentDidMount(){
        this._mounted = true;
        request("GET", "task/" + this.props.taskId + "/check").then(check => {
            if (!this._mounted) return;
            const defaults = check.defaults || {};
            this.setState({check, form: {...this.state.form, steps: String(defaults.steps || 7000), image_size: String(defaults.image_size == null ? 1600 : defaults.image_size)}});
        }).catch(e => {
            if (this._mounted) this.setState({check: {}, error: e.message});
        });
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    setField = (name, value) => {
        this.setState({form: {...this.state.form, [name]: value}, error: null});
    };

    handleStart = () => {
        const { options, error } = optionsFromForm(this.state.form, (this.state.check || {}).ranges);
        if (error){
            this.setState({error: _(error), advanced: true});
            return;
        }
        this.setState({starting: true, error: null});
        request("POST", "task/" + this.props.taskId + "/train", options).then(status => {
            if (this._mounted) this.props.onStarted(status);
        }).catch(e => {
            if (this._mounted) this.setState({starting: false, error: e.message});
        });
    };

    render(){
        const { check, error, starting, advanced, form } = this.state;
        const blocked = !check || !!check.problem || !!check.node_error;
        const footer = (
            <React.Fragment>
                <button type="button" className="btn btn-default" onClick={this.props.onClose}>{_("Close")}</button>
                <button type="button" className="btn btn-primary" disabled={blocked || starting} onClick={this.handleStart}>
                    <i className={starting ? "fa fa-circle-notch fa-spin fa-fw" : "fa fa-splat fa-fw"}></i> {_("Start Training")}
                </button>
            </React.Fragment>
        );
        return (
            <Dialog title={_("Train Splats")} onClose={this.props.onClose} footer={footer}>
                {!check ? <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Checking the task and the splat node")}</p> : ""}
                {check && check.problem ? <div className="alert alert-danger"><i className="fa fa-exclamation-triangle"></i> {check.problem}</div> : ""}
                {check && check.node_error ? <div className="alert alert-danger"><i className="fa fa-exclamation-triangle"></i> {check.node_error}</div> : ""}
                {((check || {}).warnings || []).map((warning, i) =>
                    <div key={i} className="alert alert-warning"><i className="fa fa-exclamation-triangle"></i> {warning}</div>)}
                {check && check.has_splats && !blocked ?
                    <div className="alert alert-info">{_("This task already has a splats model. The new one replaces it when the training succeeds.")}</div> : ""}
                {error ? <div className="alert alert-danger">{error}</div> : ""}
                <form className="form-horizontal" onSubmit={e => { e.preventDefault(); this.handleStart(); }}>
                    <OptionsFields form={form} advanced={advanced} onChange={this.setField} onAdvanced={open => this.setState({advanced: open})} />
                </form>
            </Dialog>
        );
    }
}
