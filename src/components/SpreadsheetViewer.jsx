import { useMemo, useRef, useState } from "react";
import { useStore, useDispatch } from "../useStore";
import { parseCSV, csvContext, compareCSVValues } from "../csv";
import { attachWorkspaceContext } from "../workspaceContext";
import "./Tools.css";

export default function SpreadsheetViewer() {
  const state = useStore(), dispatch = useDispatch(), input = useRef(null);
  const [source, setSource] = useState(""), [name, setName] = useState(""), [delimiter, setDelimiter] = useState(",");
  const [data, setData] = useState({ headers: [], rows: [] }), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [sort, setSort] = useState(null), [page, setPage] = useState(0);
  const [selected, setSelected] = useState([]), [columns, setColumns] = useState([]), [busy, setBusy] = useState(false);
  function parse(text, separator) {
    const parsed = parseCSV(text, separator); setData(parsed); setColumns(parsed.headers.map((_, i) => i)); setSelected([]); setPage(0); setSort(null); setError("");
  }
  async function read(file) {
    if (!file) return;
    try { if (file.size > 10 * 1024 * 1024) throw new Error("Choose a CSV under 10 MB."); const text = await file.text(); parse(text, delimiter); setSource(text); setName(file.name); }
    catch (failure) { setError(failure.message); }
  }
  const visible = useMemo(() => {
    const result = data.rows.filter(row => row.values.some(value => value.toLowerCase().includes(query.toLowerCase())));
    if (sort) result.sort((a, b) => compareCSVValues(a.values[sort.column], b.values[sort.column]) * sort.direction);
    return result;
  }, [data, query, sort]);
  async function send(mode) {
    setBusy(true); setError("");
    try {
      const rows = mode === "selected" ? data.rows.filter(row => selected.includes(row.id)) : mode === "filtered" ? visible : data.rows;
      if (!rows.length || !columns.length) throw new Error("Choose at least one row and column.");
      await attachWorkspaceContext(state, dispatch, csvContext(name, data.headers, rows, data.rows.length, columns));
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="tools-workspace" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void read(e.dataTransfer.files[0]); }}>
    <header className="tools-heading"><h1>Spreadsheet Viewer</h1><p>Open or drop a CSV to explore it and ask questions in chat.</p></header>
    <div className="tools-toolbar"><button onClick={() => input.current.click()}>Open CSV</button><input ref={input} type="file" hidden accept=".csv,.tsv,text/csv" onChange={e => { void read(e.target.files[0]); e.target.value = ""; }} />
      <label>Separator <select value={delimiter} onChange={e => { const next=e.target.value; setDelimiter(next); try { parse(source,next); } catch(failure) { setError(failure.message); } }}><option value=",">Comma</option><option value=";">Semicolon</option><option value={"\t"}>Tab</option></select></label>
      <input aria-label="Filter CSV rows" type="search" placeholder="Find rows…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
    </div>
    {error && <p role="alert">{error}</p>}
    <p>{name || "No file open"} · {data.rows.length.toLocaleString()} rows · {visible.length.toLocaleString()} matching · {selected.length} selected</p>
    {!!data.headers.length && <><details><summary>Columns to include in chat ({columns.length})</summary><div className="csv-columns">{data.headers.map((header, i) => <label key={i}><input type="checkbox" checked={columns.includes(i)} onChange={e => setColumns(e.target.checked ? [...columns,i].sort((a,b)=>a-b) : columns.filter(v=>v!==i))} />{header}</label>)}</div></details>
      <div className="tools-toolbar"><button disabled={busy} onClick={() => send("all")}>Use file in chat</button><button disabled={busy} onClick={() => send("filtered")}>Use filtered rows</button><button disabled={busy || !selected.length} onClick={() => send("selected")}>Use selected rows</button><button onClick={() => setSelected([])}>Clear selection</button></div>
      <p className="tools-note">Chat receives at most 14,000 characters of data. Any sampling is stated explicitly. CSV formulas are displayed as text.</p>
      <div className="csv-table"><table><thead><tr><th>Select</th><th>Row</th>{data.headers.map((header,i)=><th key={i}><button onClick={()=>setSort({column:i,direction:sort?.column===i ? -sort.direction : 1})}>{header}{sort?.column===i ? sort.direction===1 ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead><tbody>{visible.slice(page*100,page*100+100).map(row=><tr key={row.id}><td><input aria-label={`Select row ${row.id+1}`} type="checkbox" checked={selected.includes(row.id)} onChange={e=>setSelected(e.target.checked?[...selected,row.id]:selected.filter(id=>id!==row.id))} /></td><td>{row.id+1}</td>{row.values.map((value,i)=><td key={i}>{value}</td>)}</tr>)}</tbody></table></div>
      <div className="tools-toolbar"><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1} of {Math.max(1,Math.ceil(visible.length/100))}</span><button disabled={(page+1)*100>=visible.length} onClick={()=>setPage(page+1)}>Next</button></div>
    </>}
  </section>;
}
