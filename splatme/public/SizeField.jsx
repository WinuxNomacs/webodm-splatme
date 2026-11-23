import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { wholeSize } from './editShapes';

const MENU_ITEM = 27;  // px: a suggestion's height in the menu
const MENU_PADDING = 12;  // px: the menu's padding and border

// A size typed in, or picked from the suggested ones in the menu beside it (Fill Holes' edges, Remove Floating
// Pieces' triangles). A typed size is taken on Enter or when the field is left; one out of range is not taken, and
// leaving the field puts back the size the edit has.
export default class SizeField extends React.Component {
    static propTypes = {
        value: PropTypes.number.isRequired,
        sizes: PropTypes.array.isRequired,  // [[size, label], ...], the suggestions
        max: PropTypes.number.isRequired,
        unit: PropTypes.string.isRequired,  // "edges"
        bound: PropTypes.string.isRequired,  // "up to": how a suggestion's size reads in the menu
        label: PropTypes.string.isRequired,  // the field's name for screen readers
        disabled: PropTypes.bool,
        onChange: PropTypes.func.isRequired
    };

    state = {text: String(this.props.value), open: false, up: false};

    componentDidUpdate(prev){
        // A size changed elsewhere (Undo, a suggestion) shows, unless it is being typed
        if (prev.value !== this.props.value && document.activeElement !== this.input) this.setState({text: String(this.props.value)});
    }

    componentWillUnmount(){
        document.removeEventListener("mousedown", this.outside);
    }

    take = () => {
        const size = wholeSize(this.state.text, this.props.max);
        if (size === null) this.setState({text: String(this.props.value)});
        else {
            this.setState({text: String(size)});
            if (size !== this.props.value) this.props.onChange(size);
        }
    };

    pick(size){
        this.setOpen(false);
        this.setState({text: String(size)});
        if (size !== this.props.value) this.props.onChange(size);
    }

    setOpen(open){
        // Upward when the panel it is in has more room above it than below, and too little below for the menu
        let up = false;
        const panel = open && this.box && this.box.closest(".splatme-editor-panel");
        if (panel){
            const field = this.box.getBoundingClientRect(), room = panel.getBoundingClientRect();
            const below = room.bottom - field.bottom, above = field.top - room.top;
            up = below < MENU_ITEM * this.props.sizes.length + MENU_PADDING && above > below;
        }
        this.setState({open, up});
        if (open) document.addEventListener("mousedown", this.outside);
        else document.removeEventListener("mousedown", this.outside);
    }

    outside = e => {
        if (this.box && !this.box.contains(e.target)) this.setOpen(false);
    };

    keyDown = e => {
        if (e.key === "Enter"){
            e.preventDefault();
            this.take();
        } else if (e.key === "Escape"){
            this.setState({text: String(this.props.value)});
            this.setOpen(false);
        }
    };

    render(){
        const { sizes, max, unit, bound, label, disabled } = this.props;
        const { text, open } = this.state;
        const valid = wholeSize(text, max) !== null;
        const range = _("A whole number from 1 to") + " " + max.toLocaleString("en-US");
        return (
            <div className={"input-group input-group-sm splatme-size-field" + (valid ? "" : " has-error") + (open ? " open" : "") + (this.state.up ? " dropup" : "")} ref={el => { this.box = el; }}>
                <input type="number" className="form-control" min="1" max={max} step="1" value={text} disabled={disabled}
                       aria-label={label} title={valid ? label : range} ref={el => { this.input = el; }}
                       onChange={e => this.setState({text: e.target.value})} onBlur={this.take} onKeyDown={this.keyDown} />
                <span className="input-group-addon">{_(unit)}</span>
                <div className="input-group-btn">
                    <button type="button" className="btn btn-default dropdown-toggle" disabled={disabled} aria-haspopup="true"
                            aria-expanded={open} title={_("Suggested sizes")} onClick={() => this.setOpen(!open)}>
                        <span className="caret"></span>
                    </button>
                </div>
                {/* Under the whole field, from its left (the panel would cut it off past its edge) */}
                <ul className="dropdown-menu">
                    {sizes.map(([size, name]) => (
                        <li key={size}>
                            <a href="javascript:void(0)" onClick={() => this.pick(size)}>
                                <i className={"fa fa-fw" + (size === this.props.value ? " fa-check" : "")}></i> {_(name)} ({_(bound)} {size.toLocaleString("en-US")} {_(unit)})</a>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
}
