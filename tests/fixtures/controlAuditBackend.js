import './workspaceControlsBackend';
import {saveWorkflows} from '../../src/functionWorkflow.mjs';

// Only this disposable fixture supplies desktop responses. No native IPC runs.
const report = message => {
  let output = document.querySelector('[data-control-audit-log]');
  if (!output) { output = document.createElement('output'); output.dataset.controlAuditLog = ''; output.setAttribute('aria-label','Test action log'); output.style.cssText='position:fixed;bottom:0;right:0;z-index:9999;background:#102034;color:#fff;padding:3px;font:11px monospace'; document.body.append(output); }
  output.textContent = message;
};
Object.assign(window.workstationDesktop, {
  capabilities: async () => ({features:{tab_capture:{available:true,detail:'Test-only capture'}}}),
  captureTab: async tab => {report(`Capturing ${tab}`); await new Promise(resolve => setTimeout(resolve,250)); report(`Captured ${tab}`); return {width:1280,height:720};},
  runAction: async action => {report(`Test action: ${action}`); return {};},
  prepareAppReset: async () => ({ticket:'test-reset',report:{inventory:{},keep_image_manager:true}}),
  prepareBackupImport: async () => ({ticket:'test-import',archive:'Preview.zip',report:{created_at:'2026-10-05',files:0,bytes:0}}),
});
saveWorkflows([{id:'audit-function',name:'Preview function',steps:[{type:'launch',target:'task-manager'}]}]);

const previewFetch = window.fetch;
const sampleImage = {id:'audit-image',relative:'Preview.png',folder_path:'C:\\Preview',folder_id:'audit-folder',width:16,height:16,format:'PNG',bytes:100,date:'2026-10-05',date_source:'file',favorite:false,hidden:false,tags:['Preview']};
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== 'http://127.0.0.1:1') return previewFetch(input,options);
  let value;
  if (url.pathname === '/image-manager/state') value = {folders:[{id:'audit-folder',path:'C:\\Preview',purpose:'source',count:1}],summary:{images:1,bytes:100,favorites:0,hidden:0},functions:[],duplicates:[],receipts:[],plans:[],job:null};
  if (url.pathname === '/image-manager/images') value = {images:[sampleImage],total:1,offset:0,months:[],formats:['PNG'],tags:['Preview']};
  if (url.pathname === '/image-manager/metadata') {report(`Image metadata: ${options.body}`);value={};}
  if (value !== undefined) return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if (/^\/image-manager\/images\/.+\/thumbnail$/.test(url.pathname)) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#387e91"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
  return previewFetch(input,options);
};
