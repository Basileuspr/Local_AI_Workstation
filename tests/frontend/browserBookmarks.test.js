import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
const {parseBookmarkHTML,createBrowserBookmarks,registerBrowserBookmarkIpc}=createRequire(import.meta.url)('../../electron/browserBookmarks');
const html=`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<DL><p><DT><H3>Bookmarks bar</H3><DL><p>
<DT><H3>Research &amp; tools</H3><DL><p>
<DT><A HREF="https://example.com/a?x=1&amp;y=2" ADD_DATE="1700000000" ICON="https://evil.example/icon">A &amp; B</A>
<DT><A HREF="file:///C:/private/report.html">Local report</A>
</DL><p><DT><A HREF="https://example.com/b">Bar link</A>
</DL><p><DT><H3>Other</H3><DL><p><DT><A HREF="https://example.com/a?x=1&amp;y=2">Same URL in another folder</A></DL><p>
<DT><A HREF="https://example.com/unfiled">Unfiled</A>
<DT><A HREF="javascript:alert(1)">Executable</A>
<script>throw Error('NEVER EXECUTE');</script></DL><p>`;

describe('browser bookmarks',()=>{
  it('reads uppercase Netscape attributes, entities, dates and nested/sibling folders without executing HTML',()=>{
    const {data,skipped}=parseBookmarkHTML(html);
    expect(data.folders.map(f=>f.title)).toEqual(['Bookmarks bar','Research & tools','Other']);
    const [bar,research,other]=data.folders;
    expect(research.parentId).toBe(bar.id);expect(other.parentId).toBeNull();
    expect(data.bookmarks.map(b=>b.parentId)).toEqual([research.id,research.id,bar.id,other.id,null]);
    expect(data.bookmarks[0]).toMatchObject({title:'A & B',url:'https://example.com/a?x=1&y=2',addedAt:1700000000000});
    expect(skipped).toBe(1);expect(JSON.stringify(data)).not.toContain('evil.example');
    expect(()=>parseBookmarkHTML('<h1>No export</h1>')).toThrow(/No bookmarks/);
  });
  it('persists folders and links, merges repeat imports and keeps blocked links for reference',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-bookmark-test-'));
    try {
      const input=path.join(dir,'export.html');fs.writeFileSync(input,html);
      let store=createBrowserBookmarks(dir);
      const first=store.importHTML(input);expect(first.imported).toEqual({added:5,foldersAdded:3,duplicates:0,skipped:1,unavailable:1});
      expect(first.bookmarks[0].folderPath).toBe('Bookmarks bar / Research & tools');
      expect(first.bookmarks.find(b=>b.title==='Local report').canOpen).toBe(false);
      store=createBrowserBookmarks(dir);
      expect(store.list()).toEqual({folders:first.folders,bookmarks:first.bookmarks});
      expect(store.importHTML(input).imported).toEqual({added:0,foldersAdded:0,duplicates:5,skipped:1,unavailable:1});
      expect(fs.readFileSync(input,'utf8')).toBe(html);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('edits and moves bookmarks, prevents duplicates in a folder, and preserves the same URL in different folders',()=>{
    const store=createBrowserBookmarks(),folder=store.createFolder({title:'My links'}).createdFolderId;
    let result=store.save({title:'First',url:'https://example.com/a'});
    const first=result.bookmarks[0];
    store.save({title:'Second',url:first.url,parentId:folder});
    expect(()=>store.save({...first,parentId:folder})).toThrow(/already saved/);
    result=store.save({...first,title:'Renamed',url:'https://example.com/new',parentId:folder});
    expect(result.bookmarks[0]).toMatchObject({id:first.id,title:'Renamed',parentId:folder});
    expect(store.remove(first.id).bookmarks).toHaveLength(1);
    expect(()=>store.save({title:'Bad',url:'javascript:alert(1)'})).toThrow(/valid bookmark/);
    expect(()=>store.save({title:'Bad',url:'https://user:password@example.com'})).toThrow(/valid bookmark/);
    expect(()=>store.createFolder({title:'Bad',parentId:'../arbitrary'})).toThrow(/existing bookmark folder/);
  });
  it('preserves a damaged library and refuses to overwrite it',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-bookmark-corrupt-'));
    try {
      const file=path.join(dir,'browser-bookmarks.json');fs.writeFileSync(file,'INVALID ORIGINAL');
      const store=createBrowserBookmarks(dir);
      expect(()=>store.list()).toThrow(/preserved/);
      expect(()=>store.save({title:'New',url:'https://example.com'})).toThrow(/preserved/);
      expect(fs.readFileSync(file,'utf8')).toBe('INVALID ORIGINAL');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('rejects folder cycles before returning or mutating library data',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'law-bookmark-cycle-'));
    try {
      fs.writeFileSync(path.join(dir,'browser-bookmarks.json'),JSON.stringify({version:1,bookmarks:[],folders:[{id:'a'.repeat(32),parentId:'a'.repeat(32),title:'Cycle'}]}));
      expect(()=>createBrowserBookmarks(dir).list()).toThrow(/preserved/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it('gates IPC access and accepts import paths only from the native picker',async()=>{
    const handlers=new Map(),imports=[],store={list:()=>({bookmarks:[]}),importHTML:file=>{imports.push(file);return {imported:true};}};
    let cancelled=false,picks=0;
    registerBrowserBookmarkIpc({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},store,
      trustedDesktop:event=>event.trusted,dialog:{showOpenDialog:async()=>{picks++;return {canceled:cancelled,filePaths:['chosen.html']};}},getWindow:()=>null});
    for(const handler of handlers.values())expect(await handler({trusted:false},'arbitrary.html')).toEqual({error:'Desktop access required.'});
    expect(picks).toBe(0);
    expect(await handlers.get('browser-bookmarks:import')({trusted:true},'arbitrary.html')).toEqual({imported:true});
    expect(imports).toEqual(['chosen.html']);
    cancelled=true;expect(await handlers.get('browser-bookmarks:import')({trusted:true})).toEqual({cancelled:true});
    expect(imports).toHaveLength(1);
  });
});
