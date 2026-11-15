import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { PRESETS, presetOfSteps } from './trainingView';

// A training's options as form rows: the Quality choice, and under Advanced the numbers. Used by the Train Splats
// and Change dialogs and by SplatMe's panel above WebODM's New Task panel; the form's values are the parent's.
export default class OptionsFields extends React.Component {
    static propTypes = {
        form: PropTypes.object.isRequired,
        advanced: PropTypes.bool.isRequired,
        onChange: PropTypes.func.isRequired,   // (name, value)
        onAdvanced: PropTypes.func.isRequired, // (open)
        showCrop: PropTypes.bool               // false for a task known to have no boundary
    };

    handlePreset = e => {
        const preset = PRESETS.find(p => p.key === e.target.value);
        if (preset) this.props.onChange("steps", String(preset.steps));
        else this.props.onAdvanced(true); // Custom: the number is typed under Advanced
    };

    numberField(name, label, help, placeholder){
        return (
            <div className="form-group">
                <label className="col-sm-4 control-label">{label}</label>
                <div className="col-sm-8">
                    <input type="number" min="0" className="form-control" value={this.props.form[name]} placeholder={placeholder || ""}
                           onChange={e => this.props.onChange(name, e.target.value)} />
                    <span className="help-block">{help}</span>
                </div>
            </div>
        );
    }

    render(){
        const { form, advanced } = this.props;
        const key = presetOfSteps(form.steps);
        const preset = PRESETS.find(p => p.key === key);
        return (
            <React.Fragment>
                <div className="form-group">
                    <label className="col-sm-4 control-label">{_("Quality")}</label>
                    <div className="col-sm-8">
                        <select className="form-control" value={key} onChange={this.handlePreset}>
                            {PRESETS.map(p => <option key={p.key} value={p.key}>{_(p.label) + " (" + p.steps.toLocaleString() + " " + _("steps") + ")"}</option>)}
                            <option value="custom">{_("Custom")}</option>
                        </select>
                        <span className="help-block">{preset ? _(preset.hint) : _("More steps give a sharper model and take longer.")}</span>
                    </div>
                </div>
                <div className="form-group">
                    <div className="col-sm-8 col-sm-offset-4">
                        <div className="checkbox"><label>
                            <input type="checkbox" className="splatme-ignore-sky" checked={!!form.ignore_sky}
                                   onChange={e => this.props.onChange("ignore_sky", e.target.checked)} /> {_("Ignore Sky")}
                        </label></div>
                        <span className="help-block">{_("For photos that show the sky: the training leaves it out, so it does not become haze around the model. Finding it takes a few minutes more.")}</span>
                    </div>
                </div>
                {this.props.showCrop === false ? "" :
                    <div className="form-group">
                        <div className="col-sm-8 col-sm-offset-4">
                            <div className="checkbox"><label>
                                <input type="checkbox" className="splatme-crop" checked={form.crop !== false}
                                       onChange={e => this.props.onChange("crop", e.target.checked)} /> {_("Crop To Boundary")}
                            </label></div>
                            <span className="help-block">{_("For a task processed with a boundary (a GeoJSON file): the splats outside it are left out, as they are of the point cloud and the mesh.")}</span>
                        </div>
                    </div>}
                <div className="form-group">
                    <div className="col-sm-8 col-sm-offset-4">
                        <a href="javascript:void(0)" className="splatme-advanced" onClick={() => this.props.onAdvanced(!advanced)}>
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
            </React.Fragment>
        );
    }
}
