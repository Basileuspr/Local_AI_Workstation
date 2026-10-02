const labels = { added: 'Added', removed: 'Removed', edited: 'Edited', completed: 'Completed', reopened: 'Reopened' };

function SavedList({ items }) {
  return items.length ? <ol className="checklist-history-snapshot">{items.map((item, index) =>
    <li key={index}><span aria-label={item.checked ? 'Completed' : 'Incomplete'}>{item.checked ? '☑' : '☐'}</span> {item.text || '(empty item)'}</li>)}</ol> : <p>Empty list.</p>;
}

export default function ChatChecklistHistory({ history = [] }) {
  if (!history.length) return null;
  return <details className="checklist-history" aria-label="List history">
    <summary>List history ({history.length})</summary>

    <ol className="checklist-history-entries">{[...history].reverse().map(entry => {
      const counts = entry.changes.reduce((result, change) => ({ ...result, [change.kind]: (result[change.kind] || 0) + 1 }), {});
      return <li key={entry.id}><details>
        <summary><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time> · {Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(', ')}</summary>
        <ul className="checklist-history-changes">{entry.changes.map((change, index) => <li key={index}>
          <strong>{labels[change.kind]}:</strong> {change.kind === 'edited' ? <>{change.before.text || '(empty item)'} → {change.after.text || '(empty item)'}</> : (change.after || change.before).text || '(empty item)'}
        </li>)}</ul>
        <details><summary>List before this change</summary><SavedList items={entry.before}/></details>
        <details><summary>List after this change</summary><SavedList items={entry.after}/></details>
      </details></li>;
    })}</ol>
  </details>;
}
