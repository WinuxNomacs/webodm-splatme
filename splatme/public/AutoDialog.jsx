import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import OptionsFields from './OptionsFields';
import { request } from './api';
import { formFromOptions, optionsFromForm } from './trainingView';

// A task's automatic training, from Change on SplatMe's Tasks page (TrainSplats.jsx): whether its splats are
// trained when it completes processing, and with which options.
export default class AutoDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        auto: PropTypes.object.isRequired,     // the status' "auto": enabled, options
        onSaved: PropTypes.func.isRequired,    // (auto)
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {enabled: !!props.auto.enabled, form: formFromOptions(props.auto.options), ranges: null, showCrop: true,
                      advanced: false, saving: false, error: null};
    }

    componentDidMount(){
        this._mounted = true;
        // The node's ranges, to name a wrong number before saving; without them the server still checks
        request("GET", "task/" + this.props.taskId + "/check").then(check => {
            if (this._mounted) this.setState({ranges: check.ranges, showCrop: !!check.boundary, thermal: !!check.thermal, photoSizes: check.photo_sizes});
        }).catch(() => {});
    }

    componentWillUnmount(){
        this._mounted = false;
    }

    handleSave = () => {
        const { options, error } = optionsFromForm(this.state.form, this.state.ranges);
        if (error && this.state.enabled){
            this.setState({error: _(error), advanced: true});
            return;
        }
        this.setState({saving: true, error: null});
        request("POST", "task/" + this.props.taskId + "/auto", Object.assign({enabled: this.state.enabled}, error ? {} : options)).then(auto => {
            if (this._mounted) this.props.onSaved(auto);
        }).catch(e => {
            if (this._mounted) this.setState({saving: false, error: e.message});
        });
    };

    render(){
        const { enabled, form, advanced, saving, error, showCrop, thermal } = this.state;
        const footer = (
            <React.Fragment>
                <button type="button" className="btn btn-default" onClick={this.props.onClose}>{_("Close")}</button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={this.handleSave}>
                    <i className={saving ? "fa fa-circle-notch fa-spin fa-fw" : "fa fa-save fa-fw"}></i> {_("Save")}
                </button>
            </React.Fragment>
        );
        return (
            <Dialog title={_("Train Splats When Completed")} onClose={this.props.onClose} footer={footer}>
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
                    {enabled ?
                        <OptionsFields form={form} advanced={advanced} showCrop={showCrop} thermal={!!thermal} photoSizes={this.state.photoSizes}
                                       onChange={(name, value) => this.setState({form: {...form, [name]: value}, error: null})}
                                       onAdvanced={open => this.setState({advanced: open})} /> : ""}
                </form>
            </Dialog>
        );
    }
}
