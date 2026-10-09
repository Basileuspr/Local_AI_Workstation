import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {createBrowserProfiles}=require('../../electron/browserProfiles');
const {createWorkflowStore}=require('../../electron/browserWorkflowStore');
const {sourceIdentity}=require('../../electron/browserWorkflows');
const {redactSecrets}=require('../../electron/redactSecrets');

describe('browser account and recovery foundation',()=>{
  it('shares profile additions while keeping each Browser window selection independent',()=>{
    const registry=createBrowserProfiles(),second=registry.fork();
    const account=second.create('Another account');second.select(account.id);
    expect(registry.selected().id).toBe('default');
    expect(registry.list().profiles).toContainEqual(account);
    expect(second.partition(account.id)).toBe(registry.partition(account.id));
    registry.select(account.id);second.select('default');
    expect(registry.selected()).toEqual(account);
    expect(second.selected().id).toBe('default');
  });
  it('blocks opening or selecting a shared profile during clearing and releases other profiles',()=>{
    const registry=createBrowserProfiles(),account=registry.create('Independent'),other=registry.fork(account.id);
    const unblock=registry.block('default');
    expect(()=>registry.fork('default')).toThrow(/clearing/);
    expect(()=>other.select('default')).toThrow(/clearing/);
    expect(()=>registry.partition('default')).toThrow(/clearing/);
    expect(other.partition(account.id)).toContain(account.id);
    unblock();other.select('default');expect(registry.fork().selected().id).toBe('default');
  });
  it('archives released terminal checkpoints so a reel sequence can continue beyond the live history bound',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-history-test-'));
    try {
      const store=createWorkflowStore(dir);let first;
      for(let i=0;i<201;i++){const row=store.create('default');first ||= row.id;store.update(row.id,{status:'completed',media:null});}
      expect(store.history()).toHaveLength(200);
      expect(fs.existsSync(path.join(dir,'archive',first+'.json'))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(dir,'archive',first+'.json'),'utf8')).status).toBe('completed');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('retains the existing partition and restores only explicitly selected random partitions',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-profile-test-'));
    try {
      const registry=createBrowserProfiles(dir);
      expect(registry.partition('default')).toBe('persist:workstation-browser');
      const p=registry.create('Second account');registry.select(p.id);
      const restored=createBrowserProfiles(dir);
      expect(restored.selected()).toEqual(p);
      expect(restored.partition(p.id)).toBe(`persist:workstation-browser-${p.id}`);
      expect(()=>restored.select('../secret')).toThrow();
      expect(()=>restored.create('')).toThrow();
      expect(fs.readFileSync(path.join(dir,'browser-profiles.json'),'utf8')).not.toContain('cookie');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('marks interrupted work for manual review and removes only disposable media',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-checkpoint-test-'));
    try {
      const login=path.join(dir,'chromium-profile');fs.mkdirSync(login);fs.writeFileSync(path.join(login,'login'),'preserve');
      const saved=path.join(dir,'saved-result.json');fs.writeFileSync(saved,'preserve');
      let store=createWorkflowStore(path.join(dir,'workflows'));
      const row=store.create('default'),media=store.allocate(row.id);
      fs.writeFileSync(path.join(media,'video.bin'),'partial');
      store.update(row.id,{stage:'acquiring',password:'NEVER',text:'NEVER',url:'NEVER'});
      store=createWorkflowStore(path.join(dir,'workflows'));
      expect(store.history()[0]).toMatchObject({status:'interrupted',reason:'restart_requires_manual_resume',media:null});
      expect(fs.existsSync(media)).toBe(false);
      const complete=store.create('default');store.update(complete.id,{status:'completed',media:{videoRef:'opaque'}});
      store.allocate(complete.id);store.clear();
      expect(store.history()).toHaveLength(2);
      expect(fs.readFileSync(saved,'utf8')).toBe('preserve');
      expect(fs.readFileSync(path.join(login,'login'),'utf8')).toBe('preserve');
      expect(fs.readFileSync(path.join(dir,'workflows','checkpoints',row.id+'.json'),'utf8')).not.toContain('NEVER');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('keeps signed URL values and common headers out of model-facing identities and logs',()=>{
    const result=sourceIdentity('https://example.com/reel/123?token=SECRET&signature=SECRET#SECRET');
    expect(result).toMatchObject({origin:'https://example.com',path:'/reel/123'});
    expect(JSON.stringify(result)).not.toContain('SECRET');
    for(const input of ['https://example.com/?signature=SECRET&token=SECRET&api_key=SECRET','X-Local-Files: SECRET','Cookie: sessionid=SECRET'])expect(redactSecrets(input)).not.toContain('SECRET');
  });
  it('enforces the cache bound before allocating another capture workspace',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-media-bound-test-'));
    try {
      const store=createWorkflowStore(dir);const first=store.create('default'),folder=store.allocate(first.id);
      const file=fs.openSync(path.join(folder,'video.bin'),'w');fs.ftruncateSync(file,230*1024*1024);fs.closeSync(file);
      const second=store.create('default');expect(()=>store.allocate(second.id)).toThrow(/cache is full/);
      expect(fs.existsSync(folder)).toBe(true);store.clear();expect(fs.existsSync(folder)).toBe(false);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
});
