import { useCallback, useEffect, useRef, useState } from 'react';
import MobileCompanion from './MobileCompanion';
import './PhoneWorkspace.css';

const tools = {
  kdeconnect: { name: 'KDE Connect', role: 'Messages, notifications & sharing', mark: 'K',
    description: 'Pair Android and Windows for everyday sharing and communication.',
    url: 'https://kdeconnect.kde.org/download.html', link: 'Official downloads' },
  scrcpy: { name: 'scrcpy', role: 'Screen & control', mark: 'S',
    description: 'Mirror and control your Android screen over USB or a configured wireless connection.',
    url: 'https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md', link: 'Windows setup guide' },
};
const sections = [['overview', 'Overview'], ['screen', 'Screen'], ['notifications', 'Notifications'], ['messages', 'Messages'], ['files', 'Files & photos'], ['companion', 'Companion']];
const labels = { found: 'Core files found', incomplete: 'Incomplete folder', missing: 'Not found', unsupported: 'Windows required' };

function ToolCard({ id, result, native, busy, onChoose, onReset }) {
  const tool = tools[id];
  return <article className="phone-tool" data-phone-tool={id}>
    <div className="phone-tool-top"><span className="phone-tool-mark" aria-hidden="true">{tool.mark}</span><span className={`phone-badge phone-${result?.status || 'unchecked'}`}>{labels[result?.status] || 'Not checked'}</span></div>
    <h2>{tool.name}</h2><p className="phone-role">{tool.role}</p><p>{tool.description}</p>
    <div className="phone-location"><span>{result?.selectedDirectory ? 'Selected location' : 'Automatic detection'}</span>
      <code>{result?.directory || (result?.status === 'missing' ? 'Choose a folder if installed elsewhere.' : 'Local installation folder')}</code>
      {result?.status === 'incomplete' && <p>Missing: {result.missing.join(', ')}</p>}
      {result?.warning && <p role="status">{result.warning}</p>}
    </div>
    <div className="phone-actions"><button type="button" disabled={!native || busy} onClick={() => onChoose(id)} aria-label={`Choose folder for ${tool.name}`}>Choose folder</button>
      {result?.selectedDirectory && <button type="button" disabled={!native || busy} onClick={() => onReset(id)} aria-label={`Use automatic detection for ${tool.name}`}>Use automatic detection</button>}
      <a href={tool.url} target="_blank" rel="noreferrer">{tool.link} ↗</a></div>
  </article>;
}

export default function PhoneWorkspace({ active = true }) {
  const [section, setSection] = useState('overview'), [report, setReport] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), mounted = useRef(false);
  const bridge = globalThis.window?.workstationDesktop;
  const available = typeof bridge?.phoneToolsStatus === 'function';
  const native = available && report?.supported !== false;
  const run = useCallback(async (operation, id) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const api = globalThis.window?.workstationDesktop;
      if (typeof api?.[operation] !== 'function') throw Error('Open the Windows desktop app to check installation folders.');
      const value = await api[operation](id);
      if (value?.error) throw Error(value.error);
      if (!value?.canceled && (!value?.tools || typeof value.supported !== 'boolean')) throw Error('Installation detection returned no results. Try Refresh detection.');
      if (mounted.current && !value?.canceled) setReport(value);
    } catch (failure) { if (mounted.current) setError(failure.message || 'Installation detection failed.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (active && available) run('phoneToolsStatus'); }, [active, available, run]);
  const cards = ids => <div className="phone-tools">{ids.map(id => <ToolCard key={id} id={id} result={report?.tools?.[id]} native={native} busy={busy}
    onChoose={id => run('choosePhoneToolFolder', id)} onReset={id => run('resetPhoneToolFolder', id)}/>)}</div>;

  return <section className="phone-workspace" aria-label="Phone workspace">
    <header className="phone-heading"><div><span className="phone-eyebrow">ANDROID + WORKSTATION</span><h1>Phone</h1><p>Your phone tools and Workstation Companion, together.</p></div>
      <button type="button" className="phone-refresh" disabled={!available || busy} onClick={() => run('phoneToolsStatus')}>{busy ? 'Checking folders…' : 'Refresh detection'}</button></header>
    <nav className="phone-sections" aria-label="Phone sections">{sections.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
    {!available && <p className="phone-notice">Installation detection is available in the Windows desktop app. Setup guides and Companion remain available here.</p>}
    {report?.supported === false && <p className="phone-notice">This release checks Windows installations. Companion remains available on supported browsers and platforms.</p>}
    {error && <p className="phone-error" role="alert">{error} {report && 'The last successful results are still shown.'}</p>}
    {report?.warning && <p className="phone-notice" role="status">{report.warning}</p>}
    <div className="phone-detection-note" role="status">{report ? `Last checked ${new Date(report.checkedAt).toLocaleTimeString()} · ` : ''}Installation files only. Phone connection and runtime compatibility have not been checked.</div>
    {section === 'overview' && <>
      {cards(['kdeconnect', 'scrcpy'])}
      <article className="phone-companion-intro"><div><span className="phone-eyebrow">ALREADY PART OF WORKSTATION</span><h2>Workstation Companion</h2><p>Use your phone for chat, image batches, Gallery and character profiles. Keep your existing pairing and connection settings.</p></div><button type="button" onClick={() => setSection('companion')}>Open Companion controls</button></article>
      <div className="phone-next"><h2>Choose what to set up</h2><div>{sections.slice(1, 5).map(([id, label]) => <button key={id} type="button" onClick={() => setSection(id)}>{label}<span aria-hidden="true">→</span></button>)}</div><p>Screen, messaging and sharing controls inside Workstation are planned for later phases. Use the installed tools directly in the meantime.</p></div>
    </>}
    {section === 'screen' && <><div className="phone-section-intro"><h2>Screen & control</h2><p>scrcpy supplies Android mirroring. Starting, stopping and embedding a screen session in Workstation will come in a later phase.</p></div>{cards(['scrcpy'])}<div className="phone-guide"><h3>Prepare a screen session</h3><ol><li>Extract the complete official Windows release into one folder.</li><li>Enable USB debugging on Android, connect a USB cable and accept the debugging prompt on your phone.</li><li>Open scrcpy directly when you are ready to mirror. Follow the official connection guide for wireless setup.</li></ol><a href="https://github.com/Genymobile/scrcpy/blob/master/doc/connection.md" target="_blank" rel="noreferrer">USB & wireless connection guide ↗</a></div></>}
    {['notifications', 'messages', 'files'].includes(section) && <>
      <div className="phone-section-intro"><h2>{sections.find(([id]) => id === section)[1]}</h2>
        <p>{section === 'notifications' ? 'KDE Connect can forward Android notifications to Windows. A notification feed inside Workstation is planned for a later phase.' : section === 'messages' ? 'KDE Connect provides SMS tools for a paired Android phone. A messaging view inside Workstation is planned for a later phase.' : 'KDE Connect shares files between Android and Windows. A transfer queue and photo browser inside Workstation are planned for a later phase.'}</p></div>
      {cards(['kdeconnect'])}<div className="phone-guide"><h3>Continue in KDE Connect</h3><p>Open KDE Connect on Windows and Android on the same network. Pair the devices there, then choose the features you want to enable.</p>
        <p>{section === 'notifications' ? 'Notification access is managed on Android. This workspace does not request, read, or test notifications.' : section === 'messages' ? 'Grant message permissions on Android to use the separate KDE Connect SMS app. Full call audio and RCS are outside this integration.' : 'Use Share in KDE Connect to send selected files. Phone storage browsing on Windows may require a separate SFTP handler; file sharing does not depend on it.'}</p>
        <a href="https://userbase.kde.org/KDEConnect" target="_blank" rel="noreferrer">KDE Connect setup & features ↗</a></div>
    </>}
    <div hidden={section !== 'companion'} className="phone-companion"><MobileCompanion active={active && section === 'companion'}/></div>
  </section>;
}
