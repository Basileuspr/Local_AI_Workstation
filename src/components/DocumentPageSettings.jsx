import { useState } from 'react';
import { PAGE_NUMBER_FORMATS, PAGINATION_OPTIONS, pageVariants, storyKey, pageStorySample, pageNumberText } from '../documentPageLayout';

function Alignment({ label, value, onChange }) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
  </select></label>;
}

export function HeaderFooterFields({ fields, setFields }) {
  const [selected, setSelected] = useState('default');
  const patch = value => setFields(previous => ({ ...previous, ...value }));
  const variants = pageVariants(fields), variant = variants.some(([key]) => key === selected) ? selected : 'default';
  return <>
    <div className="de-setting-row"><label><input type="checkbox" checked={fields.differentFirstPage} onChange={event => patch({ differentFirstPage: event.target.checked })}/>Different first page</label>
      <label><input type="checkbox" checked={fields.differentOddEven} onChange={event => patch({ differentOddEven: event.target.checked })}/>Different odd and even pages</label></div>
    <label>Edit page variant<select aria-label="Edit page variant" value={variant} onChange={event => setSelected(event.target.value)}>{variants.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {['header', 'footer'].map(position => {
      const key = storyKey(variant, position), label = position === 'header' ? 'Header' : 'Footer';
      return <fieldset className="de-settings-section" key={position}><legend>{label}</legend>
        <textarea aria-label={`Document ${position}`} rows={2} maxLength={2000} value={fields[key]} onChange={event => patch({ [key]: event.target.value })}/>
        <Alignment label={`${label} alignment`} value={fields[`${key}Alignment`]} onChange={alignment => patch({ [`${key}Alignment`]: alignment })}/>
      </fieldset>;
    })}
    <div className="de-setting-row">{['header', 'footer'].map(position => <label key={position}>{position === 'header' ? 'Header from top' : 'Footer from bottom'}<input aria-label={`${position} distance in inches`} type="number" required min="0" max="3" step="any" value={fields[`${position}Distance`]} onChange={event => patch({ [`${position}Distance`]: event.target.value })}/>in</label>)}</div>
    <p className="de-setting-hint">Plain text, up to 2,000 characters per area. Leave enough top and bottom margin for the text and page numbers. Numbering is configured separately under Page numbers.</p>
  </>;
}

export function PageNumberFields({ fields, setFields }) {
  const patch = value => setFields(previous => ({ ...previous, ...value }));
  return <>
    <label><input type="checkbox" checked={fields.pageNumbers} onChange={event => patch({ pageNumbers: event.target.checked })}/>Add page numbers</label>
    <fieldset className="de-settings-section" disabled={!fields.pageNumbers}><legend>Numbering</legend>
      <div className="de-setting-grid">
        <label>Position<select aria-label="Page number position" value={fields.pageNumberPosition} onChange={event => patch({ pageNumberPosition: event.target.value })}><option value="header">Top of page (header)</option><option value="footer">Bottom of page (footer)</option></select></label>
        <Alignment label="Page number alignment" value={fields.pageNumberAlignment} onChange={alignment => patch({ pageNumberAlignment: alignment })}/>
        <label>Display<select aria-label="Page number display" value={fields.pageNumberStyle} onChange={event => patch({ pageNumberStyle: event.target.value })}><option value="number">Number only</option><option value="page">Page X</option><option value="pageOf">Page X of Y</option></select></label>
        <label>Format<select aria-label="Page number format" value={fields.pageNumberFormat} onChange={event => patch({ pageNumberFormat: event.target.value })}>{PAGE_NUMBER_FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Start at<input aria-label="Start page numbering at" type="number" min="1" max="9999" step="1" required value={fields.pageNumberStart} onChange={event => patch({ pageNumberStart: event.target.value })}/></label>
      </div>
      <label><input type="checkbox" disabled={!fields.differentFirstPage} checked={fields.pageNumberFirstPage} onChange={event => patch({ pageNumberFirstPage: event.target.checked })}/>Show on first page</label>
      {!fields.differentFirstPage && <p className="de-setting-hint">Enable Different first page in Header & Footer to hide numbering on a title page.</p>}
      <div className="de-number-sample" aria-label="Page number field preview" style={{ textAlign: fields.pageNumberAlignment }}>{pageNumberText(fields)}</div>
    </fieldset>
    <p className="de-setting-hint">The DOCX reader calculates page numbers and total pages. The editor shows field placeholders. A title page still counts toward numbering when its number is hidden.</p>
  </>;
}

export function ParagraphPaginationFields({ fields, setFields }) {
  return <><p>Apply to the current paragraph or selected paragraphs.</p>{PAGINATION_OPTIONS.map(([key, label, hint]) =>
    <div className="de-pagination-option" key={key}><label>{label}<select aria-label={label} value={fields[key] === null ? 'inherit' : String(fields[key])} onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value === 'inherit' ? null : event.target.value === 'true' }))}>
      <option value="inherit">Use paragraph style</option><option value="true">On</option><option value="false">Off</option>
    </select></label><p className="de-setting-hint">{hint}</p></div>)}
    <p className="de-setting-hint">These settings control DOCX pagination. The editing surface remains continuous.</p></>;
}

export function PageStorySample({ layout, variant, position }) {
  const sample = pageStorySample(layout, variant, position);
  if (!sample.text && !sample.number) return null;
  return <div className={`de-page-${position}`} aria-label={`${position} sample`}>
    <span className="de-story-label">{position} · sample</span>
    {sample.text && <div style={{ textAlign: sample.alignment }}>{sample.text}</div>}
    {sample.number && <div className="de-page-number" style={{ textAlign: layout.pageNumberAlignment }}>{sample.number}</div>}
  </div>;
}
