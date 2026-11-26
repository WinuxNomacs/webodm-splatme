import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { nodeLabel } from './trainingView';

let instances = 0;

// The Splat Node choice in the Train Splats and Change dialogs and SplatMe's panel: shown only when two or more
// splat nodes are set up (plan 25). The node chosen is the trainer: the options below are its.
export default class NodeField extends React.Component {
    static propTypes = {
        nodes: PropTypes.array,                 // [{id, name, trainer_kind}], the default first
        value: PropTypes.string,                // the chosen node's id
        onChange: PropTypes.func.isRequired,    // (id)
        disabled: PropTypes.bool
    };

    constructor(props){
        super(props);
        this.id = "splatme-node-" + (++instances);
    }

    render(){
        const nodes = this.props.nodes || [];
        if (nodes.length < 2) return null;
        return (
            <div className="form-group">
                <label className="col-sm-4 control-label" htmlFor={this.id}>{_("Splat Node")}</label>
                <div className="col-sm-8">
                    <select className="form-control splatme-node" id={this.id} value={this.props.value || nodes[0].id}
                            disabled={!!this.props.disabled} onChange={e => this.props.onChange(e.target.value)}>
                        {nodes.map(n => <option key={n.id} value={n.id}>{nodeLabel(n)}</option>)}
                    </select>
                    <span className="help-block">{_("The splat node that trains the splats, and with it the trainer: the options below are its.")}</span>
                </div>
            </div>
        );
    }
}
