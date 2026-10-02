import {useState} from 'react';
import {localRequest, downloadResult} from '../localFiles';

export default function LocalDatabase({file, run, busy}) {
  const [table, setTable] = useState(file.data.schema[0]?.name || ''), [search, setSearch] = useState('');
  const [sql, setSql] = useState('SELECT 1 AS example'), [result, setResult] = useState(null), [last, setLast] = useState(null), [total, setTotal] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const schema = file.data.schema.find(item => item.name === table);
  async function query(options, offset=0, count=false) {
    await run(async () => {
      const response = await localRequest(`/${file.id}/query`, {...options, offset, limit:100, count});
      if (count) {setTotal(response.row_count); return;}
      setLast(options); setResult(response); setTotal(null); setSelected(new Set());
    });
  }
  return <div className="local-database">
    <div className="local-toolbar"><label>Table or view <select value={table} onChange={e => {setTable(e.target.value); setResult(null); setLast(null);}}>
      {file.data.schema.map(item => <option key={item.name} value={item.name}>{item.name} ({item.type})</option>)}</select></label>
      <label>Filter text <input value={search} onChange={e => setSearch(e.target.value)} maxLength={1000}/></label>
      <button disabled={busy || !table} onClick={() => query({table,search})}>Preview rows</button></div>
    {schema && <details open><summary>Schema · {schema.name}</summary><table><thead><tr><th>Column</th><th>Type</th><th>Primary key</th></tr></thead><tbody>
      {schema.columns.map(column => <tr key={column.name}><td>{column.name}</td><td>{column.type}</td><td>{column.primary_key || '—'}</td></tr>)}</tbody></table><pre>{schema.sql}</pre></details>}
    <label>Read-only SQL<textarea aria-label="Read-only SQL" rows={4} value={sql} onChange={e => setSql(e.target.value)} maxLength={32000}/></label>
    <button disabled={busy} onClick={() => query({sql})}>Run SELECT</button>
    {result && <><div className="local-toolbar"><span>{result.rows.length ? `${result.offset + 1}–${result.offset + result.rows.length}` : '0'} shown{total != null ? ` of ${total.toLocaleString()}` : ' · total not counted'}</span>
      <button disabled={busy || !result.offset} onClick={() => query(last,Math.max(0,result.offset-100))}>Previous</button>
      <button disabled={busy || !result.has_more} onClick={() => query(last,result.offset+100)}>Next</button>
      <button disabled={busy} onClick={() => query(last,0,true)}>Count results (5-second limit)</button>
      {['csv','json'].map(format => <button key={format} onClick={() => downloadResult({...result, rows:selected.size ? result.rows.filter((_,i) => selected.has(i)) : result.rows},format)}>Export {selected.size ? 'selected rows' : 'this page'} {format.toUpperCase()}</button>)}</div>
      <div className="local-table-scroll"><table><thead><tr><th>Select</th>{result.columns.map((name,i) => <th key={i}>{name}</th>)}</tr></thead><tbody>{result.rows.map((row,i) => <tr key={i}>
        <td><input type="checkbox" aria-label={`Select row ${result.offset+i+1}`} checked={selected.has(i)} onChange={() => setSelected(previous => {const next=new Set(previous); next.has(i)?next.delete(i):next.add(i); return next;})}/></td>
        {row.map((value,c) => <td key={c}>{value == null ? <i>NULL</i> : String(value)}</td>)}</tr>)}</tbody></table></div><p>{result.note}</p></>}
  </div>;
}
