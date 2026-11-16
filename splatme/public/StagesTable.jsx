import React from 'React';
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { stagesCells } from './trainingView';

// Under Steps: the share of the steps the trainer spends in each stage, in four columns of fixed width so the form
// keeps its size as the number changes
export default function StagesTable({ total, from }){
    const cells = stagesCells(total, from);
    return (
        <table className="table table-bordered table-condensed splatme-stages" style={{tableLayout: "fixed", width: "100%", marginTop: 5, marginBottom: 5}}>
            <caption style={{paddingTop: 0}}>{_("Of these steps:")}</caption>
            <thead>
                <tr>{cells.map(c => <th key={c.label} style={{textAlign: "center"}}>{_(c.label)}</th>)}</tr>
            </thead>
            <tbody>
                <tr>{cells.map(c => <td key={c.label} style={{textAlign: "center"}}>
                    {c.value}{c.rounds ? <React.Fragment><br /><small>{c.rounds === "–" ? c.rounds : _(c.rounds)}</small></React.Fragment> : ""}
                </td>)}</tr>
            </tbody>
        </table>
    );
}

StagesTable.propTypes = {
    total: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    from: PropTypes.number   // the steps a continued model already has
};
