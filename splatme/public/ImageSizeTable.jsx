import React from 'React'; // eslint-disable-line no-unused-vars -- the JSX below needs it in scope
import PropTypes from 'prop-types';
import { _ } from 'webodm/classes/gettext';
import { imageSizeRows } from './trainingView';

// Under Image Size: the task's photos as they are and as the trainer sees them at the Image Size entered, with the
// change of their longer side and of their pixels, one row per camera; columns of fixed width, so the form keeps
// its size as the number changes
const COLUMNS = [
    {key: "source", label: "Photos", tip: "The size of the task's photos, in pixels."},
    {key: "trained", label: "Trained At", tip: "Their size as the trainer sees them at this Image Size: the longer side brought down to it, the other in proportion. Photos are never enlarged."},
    {key: "side", label: "Side", tip: "How much the longer side changes."},
    {key: "pixels", label: "Pixels", tip: "How much the number of pixels in each photo changes: the training's time and GPU memory follow it, and so does the finest detail the model can learn."}
];

export default function ImageSizeTable({ photoSizes, imageSize }){
    const rows = imageSizeRows(photoSizes, imageSize);
    if (!rows.length) return null;
    return (
        <table className="table table-bordered table-condensed splatme-image-size" style={{tableLayout: "fixed", width: "100%", marginTop: 5, marginBottom: 5}}>
            <colgroup><col style={{width: "32%"}} /><col style={{width: "32%"}} /><col style={{width: "18%"}} /><col style={{width: "18%"}} /></colgroup>
            <thead>
                <tr>{COLUMNS.map(c => <th key={c.key} style={{textAlign: "center"}}><abbr title={_(c.tip)}>{_(c.label)}</abbr></th>)}</tr>
            </thead>
            <tbody>
                {rows.map((row, i) => <tr key={i}>{COLUMNS.map(c => <td key={c.key} style={{textAlign: "center"}}>{row[c.key]}</td>)}</tr>)}
            </tbody>
        </table>
    );
}

ImageSizeTable.propTypes = {
    photoSizes: PropTypes.array,   // [[width, height]], one per camera
    imageSize: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
};
