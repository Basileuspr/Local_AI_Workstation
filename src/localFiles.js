import { apiUrl } from './api';

export async function localRequest(path, body, method) {
  const response = await fetch(apiUrl('/local-files' + path), { method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Local file operation failed.');
  return result;
}
export const localAsset = (id, asset) => apiUrl(`/local-files/${encodeURIComponent(id)}/asset/${encodeURIComponent(asset)}`);
export function resultCsv(result) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    // Protect CSV consumers from spreadsheet formula execution.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [result.columns, ...result.rows].map(row => row.map(cell).join(',')).join('\r\n');
}
export function downloadResult(result, format) {
  const blob = new Blob([format === 'csv' ? resultCsv(result) : JSON.stringify(result, null, 2)], {type: format === 'csv' ? 'text/csv' : 'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `local-results.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const timeLabel = value => new Date(Math.max(0, Number(value) || 0) * 1000).toISOString().slice(11, 19);
