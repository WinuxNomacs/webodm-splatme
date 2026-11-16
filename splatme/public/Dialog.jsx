import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';

let dialogs = 0;  // for each dialog's own title id

// A dialog with Bootstrap's markup, as WebODM's own are, drawn on the page's body: the task's panel it is opened
// from may be redrawn or dimmed. Escape, the cross and a click beside it close it, unless it is busy (its request
// is being answered, whose answer would otherwise be lost). The keyboard's focus moves into it, stays there, and
// goes back where it was when it closes.
export default class Dialog extends React.Component {
    static propTypes = {
        title: PropTypes.string.isRequired,
        onClose: PropTypes.func.isRequired,
        busy: PropTypes.bool,
        footer: PropTypes.node,
        children: PropTypes.node
    };

    constructor(props){
        super(props);
        this.titleId = "splatme-dialog-title-" + (++dialogs);
    }

    componentDidMount(){
        // Before the page's own handlers: Escape closes this dialog, not the one it was opened from
        document.addEventListener("keydown", this.handleKey, true);
        this.opener = document.activeElement;
        if (this.modal) this.modal.focus();
    }

    componentWillUnmount(){
        document.removeEventListener("keydown", this.handleKey, true);
        if (this.opener && this.opener.isConnected && this.opener.focus) this.opener.focus();
    }

    close = () => {
        if (!this.props.busy) this.props.onClose();
    };

    handleKey = e => {
        if (e.key === "Escape"){
            e.stopPropagation();
            this.close();
        }else if (e.key === "Tab" && this.modal){
            // Tab goes round the dialog's own fields and buttons, not to the page behind it
            const focusable = Array.from(this.modal.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"))
                .filter(el => !el.disabled && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            const inside = this.modal.contains(document.activeElement);
            if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === this.modal)){
                e.preventDefault();
                last.focus();
            }else if (!e.shiftKey && (!inside || document.activeElement === last)){
                e.preventDefault();
                first.focus();
            }
        }
    };

    render(){
        return ReactDOM.createPortal(
            <div className="splatme-dialog">
                <div className="modal-backdrop fade in"></div>
                <div className="modal fade in" role="dialog" aria-modal="true" aria-labelledby={this.titleId} tabIndex="-1"
                     ref={el => { this.modal = el; }} onClick={e => { if (e.target === e.currentTarget) this.close(); }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <button type="button" className="close" title={_("Close")} aria-label={_("Close")} disabled={!!this.props.busy} onClick={this.close}><span aria-hidden="true">&times;</span></button>
                                <h4 className="modal-title" id={this.titleId}>{this.props.title}</h4>
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
