import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import OptionsFields from './OptionsFields';

// SplatMe's panel above WebODM's New Task or Edit Task panel (NewTaskButton.jsx, EditTaskSplats.jsx), drawn as
// those are: whether the task's splats are trained when it completes, and with which options. The values are
// the parent's.
export default class SplatMePanel extends React.Component {
    static propTypes = {
        enabled: PropTypes.bool.isRequired,
        form: PropTypes.object.isRequired,      // trainingView.formFromOptions
        advanced: PropTypes.bool.isRequired,
        error: PropTypes.string,
        showCrop: PropTypes.bool,               // false for a task known to have no boundary
        onEnabled: PropTypes.func.isRequired,   // (enabled)
        onChange: PropTypes.func.isRequired,    // (name, value)
        onAdvanced: PropTypes.func.isRequired   // (open)
    };

    render(){
        const { enabled, form, advanced, error } = this.props;
        return (
            <div className="new-task-panel theme-background-highlight form-horizontal splatme-panel">
                <p><b><i className="fa fa-splat fa-fw"></i> SplatMe</b> &mdash; {_("When this task completes processing, and each time it is processed again, its Gaussian splats are trained on the splat node. The model then shows in the task's 3D view.")}</p>
                {error ? <div className="alert alert-warning splatme-panel-error">{error}</div> : ""}
                <div className="checkbox">
                    <label>
                        <input type="checkbox" className="splatme-panel-enabled" checked={enabled} onChange={e => this.props.onEnabled(e.target.checked)} />
                        {" "}{_("Train Splats When Completed")}
                    </label>
                </div>
                {enabled ?
                    <OptionsFields form={form} advanced={advanced} showCrop={this.props.showCrop}
                                   onChange={this.props.onChange} onAdvanced={this.props.onAdvanced} /> : ""}
            </div>
        );
    }
}
