import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BreakRoom from '../../src/components/BreakRoom';
import { apiUrl } from '../../src/api';
import '../../src/styles.css';

let failNext = false;
const network = window.fetch.bind(window);
window.fetch = (url, options) => {
  if (failNext && String(url).includes('/visual-review/help/answer')) {
    failNext = false;
    return Promise.reject(new Error('Simulated save failure. Your answer has not been saved.'));
  }
  return network(url, options);
};
function Preview() {
  const [active, setActive] = useState(true), [saved, setSaved] = useState(null);
  useEffect(() => {
    function key(event) {
      if (event.key === 'F8') { event.preventDefault(); setActive(value => !value); }
      if (event.key === 'F9') { event.preventDefault(); failNext = true; }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return <main style={{ maxWidth: 1000, margin: 'auto', padding: 20 }}>
    <p>Synthetic UI preview. F8 switches workspace; F9 simulates one failed save. Face detection is not run.</p>
    <div hidden={!active}><BreakRoom active={active} /></div>
    {!active && <p>Other workspace. Press F8 to return to Break Room.</p>}
    <button onClick={async () => setSaved(await (await network(apiUrl('/fixture/saved'))).json())}>Show saved REVIEW groups</button>
    {saved && <pre aria-label="Saved review groups">{JSON.stringify(saved, null, 2)}</pre>}
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Preview /></React.StrictMode>);
