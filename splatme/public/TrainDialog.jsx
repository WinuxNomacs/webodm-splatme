import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import { request } from './api';
import { PRESETS, presetOfSteps, optionsFromForm } from './trainingView';

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

    handlePreset = e => {
        const preset = PRESETS.find(p => p.key === e.target.value);
        if (preset) this.setField("steps", String(preset.steps));
        else this.setState({advanced: true}); // Custom: the number is typed under Advanced
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

    numberField(name, label, help, placeholder){
        return (
            <div className="form-group">
                <label className="col-sm-4 control-label">{label}</label>
                <div className="col-sm-8">
                    <input type="number" min="0" className="form-control" value={this.state.form[name]} placeholder={placeholder || ""}
                           onChange={e => this.setField(name, e.target.value)} />
                    <span className="help-block">{help}</span>
                </div>
            </div>
        );
    }

    render(){
        const { check, error, starting, advanced, form } = this.state;
        const blocked = !check || !!check.problem || !!check.node_error;
        const preset = presetOfSteps(form.steps);
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
                    <div className="form-group">
                        <label className="col-sm-4 control-label">{_("Quality")}</label>
                        <div className="col-sm-8">
                            <select className="form-control" value={preset} onChange={this.handlePreset}>
                                {PRESETS.map(p => <option key={p.key} value={p.key}>{_(p.label) + " (" + p.steps.toLocaleString() + " " + _("steps") + ")"}</option>)}
                                <option value="custom">{_("Custom")}</option>
                            </select>
                            <span className="help-block">{_("More steps give a sharper model and take longer.")}</span>
                        </div>
                    </div>
                    <div className="form-group">
                        <div className="col-sm-8 col-sm-offset-4">
                            <a href="javascript:void(0)" className="splatme-advanced" onClick={() => this.setState({advanced: !advanced})}>
                                <i className={"fa fa-fw " + (advanced ? "fa-caret-down" : "fa-caret-right")}></i>{_("Advanced")}
                            </a>
                        </div>
                    </div>
                    {advanced ?
                        <React.Fragment>
                            {this.numberField("steps", _("Steps"), _("How long the trainer works on the model."))}
                            {this.numberField("image_size", _("Image Size"), _("The photos' longer side in pixels as the trainer sees them. 0 keeps the photos as they are, which needs more GPU memory."))}
                            {this.numberField("max_gaussians", _("Max Gaussians"), _("The most points the model may grow to. Lower it when the GPU runs out of memory."), _("The trainer's own limit"))}
                        </React.Fragment> : ""}
                </form>
            </Dialog>
        );
    }
}
