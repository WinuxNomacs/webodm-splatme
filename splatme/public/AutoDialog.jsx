import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import OptionsFields from './OptionsFields';
import { request } from './api';
import NodeField from './NodeField';
import { formFromOptions, optionsFromForm, settingOptions } from './trainingView';

// A task's automatic training, from Change on SplatMe's Tasks page (TrainSplats.jsx): whether its splats are
// trained when it completes processing, on which splat node, and with which options (each trainer keeps its own).
export default class AutoDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        auto: PropTypes.object.isRequired,     // the status' "auto": enabled, options, node, by_kind
        onSaved: PropTypes.func.isRequired,    // (auto)
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {enabled: !!props.auto.enabled, form: formFromOptions(props.auto.options), ranges: null, showCrop: true,
                      advanced: false, saving: false, error: null, nodeId: props.auto.node || null, nodes: null, switching: false};
    }

    componentDidMount(){
        this._mounted = true;
        this.ask(this.state.nodeId, false);
    }

    // The chosen node's trainer and ranges, to show its options and name a wrong number before saving (without them
    // the server still checks); the form shows the options saved for that node's trainer. Until the node answers,
    // Save waits (it would file the previous trainer's options under this one); a failure goes back to the node before
    ask(nodeId, switched){
        const before = this.state.nodeId;
        this.setState({nodeId, switching: true, error: null});
        request("GET", "task/" + this.props.taskId + "/check" + (nodeId ? "?node=" + encodeURIComponent(nodeId) : "")).then(check => {
            if (!this._mounted || (this.state.nodeId || null) !== (nodeId || null)) return;
            const kind = check.node ? check.node.trainer_kind || "opensplat" : null;
            const changes = {ranges: check.ranges, node: check.node, nodes: check.nodes, showCrop: !!check.boundary, thermal: !!check.thermal,
                             photoSizes: check.photo_sizes, switching: false};
            if (kind) changes.form = formFromOptions(settingOptions(this.props.auto, kind));
            this.setState(changes);
        }).catch(e => {
            if (!this._mounted || (this.state.nodeId || null) !== (nodeId || null)) return;
            this.setState(switched ? {nodeId: before, switching: false, error: e.message} : {switching: false});
        });
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    handleSave = () => {
        if (this.state.saving || this.state.switching) return;  // Enter in a field submits the form too
        const { options, error } = optionsFromForm(this.state.form, this.state.ranges, this.state.node);
        if (error && this.state.enabled){
            this.setState({error: _(error), advanced: true});
            return;
        }
        this.setState({saving: true, error: null});
        const node = {node: this.state.nodeId || "", trainer_kind: this.state.node ? this.state.node.trainer_kind || "opensplat" : ""};
        request("POST", "task/" + this.props.taskId + "/auto", Object.assign({enabled: this.state.enabled}, node, error ? {} : options)).then(auto => {
            if (this._mounted) this.props.onSaved(auto);
        }).catch(e => {
            if (this._mounted) this.setState({saving: false, error: e.message});
        });
    };

    render(){
        const { enabled, form, advanced, saving, error, showCrop, thermal, switching } = this.state;
        const footer = (
            <React.Fragment>
                <button type="button" className="btn btn-default" disabled={saving} onClick={this.props.onClose}>{_("Close")}</button>
                <button type="button" className="btn btn-primary" disabled={saving || switching} onClick={this.handleSave}>
                    <i className={saving || switching ? "fa fa-circle-notch fa-spin fa-fw" : "fa fa-save fa-fw"}></i> {_("Save")}
                </button>
            </React.Fragment>
        );
        return (
            <Dialog title={_("Train Splats When Completed")} onClose={this.props.onClose} busy={saving} footer={footer}>
                <p>{_("When this task completes processing, and each time it is processed again, its splats are trained on the splat node with these options. Nothing else is needed: the model then shows in the task's 3D view.")}</p>
                {error ? <div className="alert alert-danger">{error}</div> : ""}
                <form className="form-horizontal" onSubmit={e => { e.preventDefault(); this.handleSave(); }}>
                    <div className="form-group">
                        <div className="col-sm-8 col-sm-offset-4">
                            <div className="checkbox">
                                <label>
                                    <input type="checkbox" checked={enabled} onChange={e => this.setState({enabled: e.target.checked})} /> {_("Train Splats When Completed")}
                                </label>
                            </div>
                        </div>
                    </div>
                    {enabled ? <NodeField nodes={this.state.nodes} value={this.state.nodeId} onChange={id => this.ask(id, true)} /> : ""}
                    {enabled ?
                        <OptionsFields form={form} advanced={advanced} showCrop={showCrop} thermal={!!thermal} photoSizes={this.state.photoSizes} node={this.state.node}
                                       onChange={(name, value) => this.setState({form: {...form, [name]: value}, error: null})}
                                       onAdvanced={open => this.setState({advanced: open})} /> : ""}
                </form>
            </Dialog>
        );
    }
}
