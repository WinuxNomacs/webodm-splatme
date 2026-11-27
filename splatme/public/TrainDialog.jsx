import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import { request } from './api';
import OptionsFields from './OptionsFields';
import { optionsFromForm, continueFromForm, defaultMoreSteps, growUntilRange, stepsGrow, continueState, trainerView, formFromOptions, startingNode } from './trainingView';
import StagesTable from './StagesTable';
import NodeField from './NodeField';

// The Train Splats dialog: what stands in the way (the task, the splat node), WebODM's own warning about photos
// that all point down, the options, and Start Training. A task whose trained model SplatMe kept can be continued
// instead: Start Over or Continue From Step N, which asks how many more steps and, optionally, Grow Until. With two
// or more splat nodes, Splat Node chooses the one that trains (and so the options and whether it can continue).
export default class TrainDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        onStarted: PropTypes.func.isRequired,
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {check: null, error: null, starting: false, advanced: false, resume: false, more: "", growUntil: "",
                      form: formFromOptions(null), nodeId: null, switching: false};
        this.touched = new Set();  // the form's fields the user changed
    }

    componentDidMount(){
        this._mounted = true;
        this.ask(null).then(check => {
            // A model the default node can't continue, and another node can: the dialog starts on that one
            const better = check && startingNode(check);
            if (better && better !== check.node_id) this.ask(better);
        });
    }

    // The task and a node (null: the default) checked again: the node's trainer, its options and Continue
    ask(nodeId){
        const before = this.state.nodeId;  // a failed switch goes back to it, with the form that is its
        if (this.state.check) this.setState({switching: true, nodeId, error: null});
        return request("GET", "task/" + this.props.taskId + "/check" + (nodeId ? "?node=" + encodeURIComponent(nodeId) : "")).then(check => {
            if (!this._mounted || (nodeId || null) !== (this.state.nodeId || null) && this.state.check) return null;
            const defaults = check.defaults || {};
            const trained = continueState(check).can ? check.trained_steps : 0;
            // The defaults, but not over a field typed in while the check was being answered
            const form = {steps: String(defaults.steps || 30000), image_size: String(defaults.image_size == null ? 1600 : defaults.image_size)};
            for (const name of this.touched) delete form[name];
            this.setState({check, nodeId: check.node_id || nodeId, switching: false, resume: trained > 0,
                           more: trained ? String(defaultMoreSteps(trained, check.ranges)) : "", form: {...this.state.form, ...form}});
            return check;
        }).catch(e => {
            if (!this._mounted || (nodeId || null) !== (this.state.nodeId || null) && this.state.check) return null;
            this.setState({check: this.state.check || {}, nodeId: this.state.check ? before : nodeId, switching: false, error: e.message});
            return null;
        });
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    setField = (name, value) => {
        this.touched.add(name);
        this.setState({form: {...this.state.form, [name]: value}, error: null});
    };

    handleStart = () => {
        // Enter in More Steps submits the form too: not while a start is being answered, nor when it cannot start
        const known = this.state.check;
        if (this.state.starting || this.state.switching || !known || known.problem || known.node_error) return;
        const check = known;
        const { options, error } = this.state.resume ?
            continueFromForm(this.state.more, check.trained_steps, check.ranges, this.state.growUntil) :
            optionsFromForm(this.state.form, check.ranges, check.node);
        if (error){
            this.setState({error: _(error), advanced: !this.state.resume});
            return;
        }
        this.setState({starting: true, error: null});
        if (this.state.nodeId) options.node = this.state.nodeId;
        request("POST", "task/" + this.props.taskId + "/train", options).then(status => {
            if (this._mounted) this.props.onStarted(status);
        }).catch(e => {
            if (this._mounted) this.setState({starting: false, error: e.message});
        });
    };

    render(){
        const { check, error, starting, advanced, form, resume, more, growUntil, switching } = this.state;
        const blocked = !check || !!check.problem || !!check.node_error || switching;
        const cont = continueState(check);
        const trained = cont.can ? check.trained_steps : 0;  // a model that cannot be continued here starts over
        const view = trainerView((check || {}).node);
        const total = trained + (/^\d+$/.test(String(more).trim()) ? parseInt(more, 10) : 0);
        const modelGrowUntil = (check || {}).trained_grow_until;  // the model's Grow Until, when it was set
        const growRange = growUntilRange(trained, total - trained);
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
                {cont.note && !blocked ? <div className="alert alert-info">{_(cont.note)}</div> : ""}
                {error ? <div className="alert alert-danger">{error}</div> : ""}
                <form className="form-horizontal" onSubmit={e => { e.preventDefault(); this.handleStart(); }}>
                    <NodeField nodes={(check || {}).nodes} value={this.state.nodeId || (check || {}).node_id} disabled={starting}
                               onChange={id => this.ask(id)} />
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
                                {!view.opensplat ? "" : stepsGrow(total, trained, String(growUntil).trim() || modelGrowUntil) ?
                                    <StagesTable total={total} from={trained} growUntil={String(growUntil).trim() || modelGrowUntil} /> :
                                    <p className="help-block">{_("The model grows no more in these steps: they refine it. Grow Until makes it grow again.")}</p>}
                                <span className="help-block">
                                    {_("The model then has") + " " + total.toLocaleString() + " " + _("steps.")} {view.opensplat ?
                                        _("The other options stay as the model was trained. Continuing sharpens the model it has; it replaces the task's when the training succeeds.") :
                                        _("The other options stay as the model was trained. Continuing trains the model's gaussians again from the start of the trainer's schedule, so it grows again; it replaces the task's when the training succeeds.")}
                                </span>
                            </div>
                        </div> : ""}
                    {resume && !blocked ? !view.has("densify_until") ? "" :
                        <div className="form-group">
                            <label className="col-sm-4 control-label" htmlFor="splatme-grow-until">{_("Grow Until")}</label>
                            <div className="col-sm-8">
                                <input type="number" min={growRange ? growRange.min : 0} className="form-control splatme-grow-until" id="splatme-grow-until" value={growUntil}
                                       placeholder={modelGrowUntil ? _("The model's:") + " " + modelGrowUntil.toLocaleString() : _("Half the steps, at most 15,000")}
                                       onChange={e => this.setState({growUntil: e.target.value, error: null})} />
                                <span className="help-block">
                                    {_("The step the model stops growing at, for it to grow again:")} {growRange ?
                                        _("from") + " " + growRange.min.toLocaleString() + " " + _("to") + " " + growRange.max.toLocaleString() + "." :
                                        _("it needs 4,000 more steps or more.")}
                                </span>
                            </div>
                        </div> :
                        switching ? <p><i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Checking the splat node")}</p> :
                        resume && trained > 0 ? "" :
                        <OptionsFields form={form} advanced={advanced} showCrop={!!(check || {}).boundary} thermal={!!(check || {}).thermal} photoSizes={(check || {}).photo_sizes} node={(check || {}).node} onChange={this.setField} onAdvanced={open => this.setState({advanced: open})} />}
                </form>
            </Dialog>
        );
    }
}
