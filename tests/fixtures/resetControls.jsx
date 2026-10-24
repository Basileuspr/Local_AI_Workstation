import React from 'react';
import {createRoot} from 'react-dom/client';
import DashboardReset from '../../src/components/DashboardReset';
import MobileCompanion from '../../mobile-companion/desktop/MobileCompanion';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';
import '../../src/components/Dashboard.css';

const sections = [
  ['chats', 'Chats', 'Saved conversations. Related backups and phone jobs are separate sections.'],
  ['memory', 'Durable memory', 'Remembered facts and database sidecars.'],
  ['media', 'App media and documents', 'Images, including Hidden and Locked, and documents.'],
  ['mobile', 'Phone access and job history', 'Paired phones, invitations and phone jobs.'],
  ['desktop', 'Desktop settings and browser storage', 'Preferences, buttons and desktop browser storage.'],
  ['other', 'Other app data', 'Other managed records. Independent catalogs remain.'],
].map(([id,label,description]) => ({id,label,description,files:12,bytes:1200}));
window.fixture = {calls: [], discovery: []};
window.workstationDesktop = {
  exportAppBackup: async () => ({canceled:true}),
  exportResetInventory: async () => ({canceled:true}),
  prepareBackupImport: async () => ({canceled:true}),
  backupImportStatus: async () => ({pending:false}),
  prepareAppReset: async () => ({ticket:'fixture-ticket',report:{inventory:{},reset_sections:sections,...(window.fixture.recovery ? {reset_pending:true,reset_options:window.fixture.recovery} : {})}}),
  resetAppData: async (...args) => {window.fixture.calls.push(args);return {error:'Fixture captured the request; no files were deleted.',backendStopped:Boolean(window.fixture.failStopped)};},
};
window.fetch = async (url,options={}) => {
  if (String(url).endsWith('/mobile/discover-connection')) {
    window.fixture.discovery.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({connections:[{origin:'https://desktop.example.ts.net:443',address:'127.0.0.1',port:8766}]})};
  }
  if (String(url).endsWith('/mobile')) return {ok:true,json:async()=>({running:false,build_ready:true,devices:[],client_update:{}})};
  throw Error('Unexpected fixture request');
};
createRoot(document.getElementById('root')).render(<main className="dashboard"><h1>App data and reconnect</h1><DashboardReset/><MobileCompanion/></main>);
