import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';

// A dialog with Bootstrap's markup, as WebODM's own are, drawn on the page's body: the task's panel it is opened
// from may be redrawn or dimmed. Escape and the cross close it.
export default class Dialog extends React.Component {
    static propTypes = {
        title: PropTypes.string.isRequired,
        onClose: PropTypes.func.isRequired,
        footer: PropTypes.node,
        children: PropTypes.node
    };

    componentDidMount(){
        document.addEventListener("keydown", this.handleKey);
    }

    componentWillUnmount(){
        document.removeEventListener("keydown", this.handleKey);
    }

    handleKey = e => {
        if (e.key === "Escape") this.props.onClose();
    };

    render(){
        return ReactDOM.createPortal(
            <div className="splatme-dialog">
                <div className="modal-backdrop fade in"></div>
                <div className="modal fade in" role="dialog" onClick={e => { if (e.target === e.currentTarget) this.props.onClose(); }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <button type="button" className="close" title={_("Close")} onClick={this.props.onClose}><span aria-hidden="true">&times;</span></button>
                                <h4 className="modal-title">{this.props.title}</h4>
                            </div>
                            <div className="modal-body">{this.props.children}</div>
                            <div className="modal-footer">{this.props.footer}</div>
                        </div>
                    </div>
                </div>
            </div>,
            document.body);
    }
}
