import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import { request } from './api';
import OptionsFields from './OptionsFields';
import { optionsFromForm, continueFromForm, defaultMoreSteps, DEFAULT_PALETTE } from './trainingView';
import StagesTable from './StagesTable';

// The Train Splats dialog: what stands in the way (the task, the splat node), WebODM's own warning about photos
// that all point down, the options, and Start Training. A task whose trained model SplatMe kept can be continued
// instead: Start Over or Continue From Step N, which asks only how many more steps.
export default class TrainDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        onStarted: PropTypes.func.isRequired,
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {check: null, error: null, starting: false, advanced: false, resume: false, more: "",
                      form: {steps: "30000", image_size: "1600", max_gaussians: "", ignore_sky: false, crop: true, palette: DEFAULT_PALETTE}};
    }

    componentDidMount(){
        this._mounted = true;
        request("GET", "task/" + this.props.taskId + "/check").then(check => {
            if (!this._mounted) return;
            const defaults = check.defaults || {};
            const trained = check.trained_steps || 0;
            this.setState({check, resume: trained > 0, more: trained ? String(defaultMoreSteps(trained, check.ranges)) : "", form: {...this.state.form, steps: String(defaults.steps || 30000), image_size: String(defaults.image_size == null ? 1600 : defaults.image_size)}});
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
        // Enter in More Steps submits the form too: not while a start is being answered, nor when it cannot start
        const known = this.state.check;
        if (this.state.starting || !known || known.problem || known.node_error) return;
        const check = known;
        const { options, error } = this.state.resume ?
            continueFromForm(this.state.more, check.trained_steps, check.ranges) :
            optionsFromForm(this.state.form, check.ranges);
        if (error){
            this.setState({error: _(error), advanced: !this.state.resume});
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
        const { check, error, starting, advanced, form, resume, more } = this.state;
        const blocked = !check || !!check.problem || !!check.node_error;
        const trained = (check || {}).trained_steps || 0;
        const total = trained + (/^\d+$/.test(String(more).trim()) ? parseInt(more, 10) : 0);
        const footer = (
            <React.Fragment>
                <button type="button" className="btn btn-default" disabled={starting} onClick={this.props.onClose}>{_("Close")}</button>
                <button type="button" className="btn btn-primary" disabled={blocked || starting} onClick={this.handleStart}>
                    <i className={starting ? "fa fa-circle-notch fa-spin fa-fw" : "fa fa-splat fa-fw"}></i> {_("Start Training")}
                </button>
            </React.Fragment>
        );
        return (
            <Dialog title={_("Train Splats")} onClose={this.props.onClose} busy={starting} footer={footer}>
                {!check ? <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Checking the task and the splat node")}</p> : ""}
                {check && check.problem ? <div className="alert alert-danger"><i className="fa fa-exclamation-triangle"></i> {check.problem}</div> : ""}
                {check && check.node_error ? <div className="alert alert-danger"><i className="fa fa-exclamation-triangle"></i> {check.node_error}</div> : ""}
                {((check || {}).warnings || []).map((warning, i) =>
                    <div key={i} className="alert alert-warning"><i className="fa fa-exclamation-triangle"></i> {warning}</div>)}
                {check && check.has_splats && !blocked && !resume ?
                    <div className="alert alert-info">{_("This task already has a splat model. The new one replaces it when the training succeeds.")}</div> : ""}
                {error ? <div className="alert alert-danger">{error}</div> : ""}
                <form className="form-horizontal" onSubmit={e => { e.preventDefault(); this.handleStart(); }}>
                    {trained > 0 && !blocked ?
                        <div className="form-group">
                            <div className="col-sm-8 col-sm-offset-4 splatme-resume">
                                <div className="radio"><label>
                                    <input type="radio" name="splatme-resume" checked={!resume} onChange={() => this.setState({resume: false, error: null})} /> {_("Start Over")}
                                </label></div>
                                <div className="radio"><label>
                                    <input type="radio" name="splatme-resume" checked={resume} onChange={() => this.setState({resume: true, error: null})} /> {_("Continue From Step") + " " + trained.toLocaleString()}
                                </label></div>
                            </div>
                        </div> : ""}
                    {resume && !blocked ?
                        <div className="form-group">
                            <label className="col-sm-4 control-label" htmlFor="splatme-more-steps">{_("More Steps")}</label>
                            <div className="col-sm-8">
                                <input type="number" min="1" className="form-control splatme-more-steps" id="splatme-more-steps" value={more}
                                       onChange={e => this.setState({more: e.target.value, error: null})} />
                                <StagesTable total={total} from={trained} />
                                <span className="help-block">
                                    {_("The model then has") + " " + total.toLocaleString() + " " + _("steps.")} {_("The other options stay as the model was trained. Continuing sharpens the model it has; it replaces the task's when the training succeeds.")}
                                </span>
                            </div>
                        </div> :
                        <OptionsFields form={form} advanced={advanced} showCrop={!!(check || {}).boundary} thermal={!!(check || {}).thermal} photoSizes={(check || {}).photo_sizes} onChange={this.setField} onAdvanced={open => this.setState({advanced: open})} />}
                </form>
            </Dialog>
        );
    }
}
