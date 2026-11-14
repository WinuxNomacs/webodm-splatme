import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import Dialog from './Dialog';
import { readLog } from './api';

// The trainer's output, read on every few seconds while the training runs
export default class LogDialog extends React.Component {
    static propTypes = {
        taskId: PropTypes.string.isRequired,
        active: PropTypes.bool,
        onClose: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {text: "", error: null, loaded: false};
        this.offset = 0;
    }

    componentDidMount(){
        this._mounted = true;
        this.read();
    }

    componentWillUnmount(){
        this._mounted = false;
        clearTimeout(this.timer);
    }

    read = () => {
        readLog(this.props.taskId, this.offset).then(({text, offset}) => {
            if (!this._mounted) return;
            this.offset = offset;
            const atEnd = !this.pre || this.pre.scrollTop + this.pre.clientHeight >= this.pre.scrollHeight - 20;
            this.setState({text: this.state.text + text, error: null, loaded: true}, () => {
                if (atEnd && this.pre) this.pre.scrollTop = this.pre.scrollHeight;
            });
        }).catch(e => {
            if (this._mounted) this.setState({error: e.message, loaded: true});
        }).then(() => {
            if (this._mounted && this.props.active) this.timer = setTimeout(this.read, 3000);
        });
    };

    render(){
        const { text, error, loaded } = this.state;
        return (
            <Dialog title={_("Training Log")} onClose={this.props.onClose}
                    footer={<button type="button" className="btn btn-default" onClick={this.props.onClose}>{_("Close")}</button>}>
                {error ? <div className="alert alert-warning">{error}</div> : ""}
                {loaded && !text && !error ?
                    <p>{this.props.active ? _("The trainer has not written anything yet.") : _("The splat node no longer has this training's log.")}</p> : ""}
                {text ? <pre className="splatme-log" ref={el => { this.pre = el; }}>{text}</pre> : ""}
            </Dialog>
        );
    }
}
