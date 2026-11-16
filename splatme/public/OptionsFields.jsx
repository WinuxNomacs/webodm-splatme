import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { PRESETS, presetOfSteps, stepsNote, STEPS_HINT, THERMAL_PALETTES } from './trainingView';
import StagesTable from './StagesTable';
import ImageSizeTable from './ImageSizeTable';

// A training's options as form rows: the Quality choice, and under Advanced the numbers. Used by the Train Splats
// and Change dialogs and by SplatMe's panel above WebODM's New Task panel; the form's values are the parent's.
export default class OptionsFields extends React.Component {
    static propTypes = {
        form: PropTypes.object.isRequired,
        advanced: PropTypes.bool.isRequired,
        onChange: PropTypes.func.isRequired,   // (name, value)
        onAdvanced: PropTypes.func.isRequired, // (open)
        showCrop: PropTypes.bool,              // false for a task known to have no boundary
        thermal: PropTypes.bool,               // a thermal task: Thermal Colours, and no Ignore Sky
        photoSizes: PropTypes.array            // the task's photo sizes, [[width, height]], when known: the Image Size table
    };

    handlePreset = e => {
        const preset = PRESETS.find(p => p.key === e.target.value);
        if (preset) this.props.onChange("steps", String(preset.steps));
        else this.props.onAdvanced(true); // Custom: the number is typed under Advanced
    };

    numberField(name, label, help, placeholder, more){
        return (
            <div className="form-group">
                <label className="col-sm-4 control-label">{label}</label>
                <div className="col-sm-8">
                    <input type="number" min="0" className="form-control" value={this.props.form[name]} placeholder={placeholder || ""}
                           onChange={e => this.props.onChange(name, e.target.value)} />
                    {more || ""}
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
                        <span className="help-block">{preset ? _(preset.hint) : _(stepsNote(form.steps) || "More steps give a sharper model and take longer.")}</span>
                    </div>
                </div>
                {this.props.thermal ?
                    <div className="form-group">
                        <label className="col-sm-4 control-label">{_("Thermal Colours")}</label>
                        <div className="col-sm-8">
                            <select className="form-control splatme-palette" value={form.palette} onChange={e => this.props.onChange("palette", e.target.value)}>
                                {THERMAL_PALETTES.map(p => <option key={p.key} value={p.key}>{_(p.label)}</option>)}
                            </select>
                            <span className="help-block">{_("The colours the temperatures are drawn in, which the model shows. They run from the task's coldest to its hottest, the same in every photo.")}</span>
                        </div>
                    </div> :
                <div className="form-group">
                    <div className="col-sm-8 col-sm-offset-4">
                        <div className="checkbox"><label>
                            <input type="checkbox" className="splatme-ignore-sky" checked={!!form.ignore_sky}
                                   onChange={e => this.props.onChange("ignore_sky", e.target.checked)} /> {_("Ignore Sky")}
                        </label></div>
                        <span className="help-block">{_("For photos that show the sky: the training leaves it out, so it does not become haze around the model. Finding it takes a few minutes more.")}</span>
                    </div>
                </div>}
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
                        {this.numberField("steps", _("Steps"), _(STEPS_HINT), "", <StagesTable total={form.steps} />)}
                        {this.numberField("image_size", _("Image Size"), _("The photos' longer side in pixels as the trainer sees them. Larger photos are scaled down whole, so each keeps its full view: nothing is cropped, only fine detail is lost. GPU memory depends on it most: lower it when the GPU runs out of memory. 0 keeps the photos as they are."), "", <ImageSizeTable photoSizes={this.props.photoSizes} imageSize={form.image_size} />)}
                        {this.numberField("max_gaussians", _("Max Gaussians"), _("The most points the model may grow to, a limit for very large scenes. When the GPU runs out of memory, lower Image Size first."), _("The trainer's own limit"))}
                    </React.Fragment> : ""}
            </React.Fragment>
        );
    }
}
