const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {parseHTML} = require('linkedom');
const {browserUrl} = require('./browserPolicy');

const MAX_HTML = 10 * 1024 * 1024, MAX_STORE = 24 * 1024 * 1024;
const MAX_BOOKMARKS = 10000, MAX_FOLDERS = 2000, ID = /^[a-f0-9]{32}$/;
const id = () => randomUUID().replaceAll('-', '');
const empty = () => ({version:1, folders:[], bookmarks:[]});
function title(value, fallback='', limit=500) {
    if(typeof value !== 'string') throw Error('Enter a bookmark name.');
    const result=value.trim() || fallback;
    if(!result || result.length>limit || /[\x00-\x1f]/.test(result)) throw Error(`Use a name of 1–${limit} characters.`);
    return result;
}
function savedUrl(value) {
    if(typeof value !== 'string' || value.length>8192 || /[\x00-\x1f]/.test(value)) return null;
    try {
        const url=new URL(value.trim());
        // These imported addresses stay inert. Opening still uses browserUrl.
        if(!['http:','https:','file:','chrome:','chrome-extension:'].includes(url.protocol) || url.username || url.password) return null;
        return url.href;
    } catch {return null;}
}
function validate(data) {
    if(data?.version!==1 || !Array.isArray(data.folders) || !Array.isArray(data.bookmarks)
        || data.folders.length>MAX_FOLDERS || data.bookmarks.length>MAX_BOOKMARKS) throw Error('Invalid bookmark library.');
    const ids=new Set(), folders=new Map();
    for(const row of [...data.folders, ...data.bookmarks]) {
        if(!ID.test(row.id) || ids.has(row.id)) throw Error('Invalid bookmark identity.');
        ids.add(row.id);
    }
    for(const folder of data.folders) {
        title(folder.title,'',160);folders.set(folder.id,folder);
    }
    for(const row of [...data.folders, ...data.bookmarks]) {
        if(row.parentId!==null && !folders.has(row.parentId)) throw Error('Invalid bookmark folder.');
        let parent=row.parentId, depth=0;
        const seen=new Set([row.id]);
        while(parent!==null) {
            if(seen.has(parent) || ++depth>50) throw Error('Invalid bookmark folder nesting.');
            seen.add(parent);parent=folders.get(parent).parentId;
        }
    }
    for(const bookmark of data.bookmarks) {
        title(bookmark.title);
        if(!savedUrl(bookmark.url) || !Number.isFinite(bookmark.addedAt)) throw Error('Invalid saved bookmark.');
    }
    return data;
}

// Parse the export as data in Node. No page, scripts, icons or network loads.
function parseBookmarkHTML(html) {
    if(typeof html!=='string' || Buffer.byteLength(html)>MAX_HTML) throw Error('Choose a bookmark HTML file up to 10 MB.');
    const {document}=parseHTML(html), data=empty(), stack=[];
    let pending=null, skipped=0, anchors=0;
    const attr=(node,name)=>[...node.attributes].find(a=>a.name.toLowerCase()===name)?.value;
    function visit(node,depth=0) {
        if(depth>150) throw Error('Bookmark HTML nesting is too deep.');
        if(node.nodeType!==1 && node!==document) return;
        const tag=node.tagName;
        if(tag==='H3') {
            if(data.folders.length>=MAX_FOLDERS) throw Error('Too many bookmark folders.');
            const folder={id:id(),parentId:stack.at(-1) || null,title:(node.textContent.trim() || 'Unnamed folder').slice(0,160)};
            data.folders.push(folder);pending=folder.id;return;
        }
        if(tag==='A') {
            anchors++;
            const url=savedUrl(attr(node,'href'));
            if(!url){skipped++;return;}
            if(data.bookmarks.length>=MAX_BOOKMARKS) throw Error('Too many bookmarks.');
            const date=Number(attr(node,'add_date'))*1000;
            data.bookmarks.push({id:id(),parentId:stack.at(-1) || null,url,
                title:(node.textContent.trim() || url).replace(/[\x00-\x1f]/g,' ').slice(0,500),
                addedAt:Number.isFinite(date) && date>0 ? date : Date.now()});
            return;
        }
        if(tag==='DL') {stack.push(pending || stack.at(-1) || null);pending=null;}
        for(const child of node.childNodes) visit(child,depth+1);
        if(tag==='DL') {stack.pop();pending=null;}
    }
    visit(document);
    if(!anchors) throw Error('No bookmarks found. Choose a browser bookmark HTML export.');
    return {data:validate(data),skipped};
}

function createBrowserBookmarks(directory) {
    const file=directory && path.join(directory,'browser-bookmarks.json');
    let memory=empty();
    function read() {
        if(!file || !fs.existsSync(file)) return structuredClone(memory);
        try {
            if(fs.statSync(file).size>MAX_STORE) throw Error('Too large');
            return validate(JSON.parse(fs.readFileSync(file,'utf8')));
        } catch {throw Error('The bookmark library needs repair. Its existing file has been preserved.');}
    }
    function write(data) {
        validate(data);
        const serialized=JSON.stringify(data,null,2)+'\n';
        if(Buffer.byteLength(serialized)>MAX_STORE) throw Error('The bookmark library exceeds its 24 MB storage limit.');
        if(file) {
            fs.mkdirSync(directory,{recursive:true});
            const pending=file+'.'+id()+'.pending';
            try {fs.writeFileSync(pending,serialized);fs.renameSync(pending,file);}
            finally {if(fs.existsSync(pending))fs.unlinkSync(pending);}
        }
        memory=structuredClone(data);
    }
    function list() {
        const data=read(), folders=new Map(data.folders.map(f=>[f.id,f]));
        function folderPath(parent) {
            const names=[];
            while(parent!==null){const folder=folders.get(parent);names.unshift(folder.title);parent=folder.parentId;}
            return names.join(' / ');
        }
        return {folders:data.folders.map(f=>({...f,path:folderPath(f.id)})),
            bookmarks:data.bookmarks.map(b=>({...b,folderPath:folderPath(b.parentId),canOpen:!!browserUrl(b.url)}))};
    }
    function parent(data,value) {
        const result=value || null;
        if(result!==null && !data.folders.some(f=>f.id===result)) throw Error('Choose an existing bookmark folder.');
        return result;
    }
    return {
        file,list,
        save(value) {
            const data=read(), parentId=parent(data,value?.parentId), url=savedUrl(value?.url);
            if(!url) throw Error('Enter a valid bookmark address.');
            const name=title(value?.title,url);
            const existing=value?.id ? data.bookmarks.find(b=>b.id===value.id)
                : data.bookmarks.find(b=>b.url===url && b.parentId===parentId);
            if(value?.id && !existing) throw Error('Bookmark no longer exists.');
            if(data.bookmarks.some(b=>b.id!==existing?.id && b.parentId===parentId && b.url===url)) throw Error('That address is already saved in this folder.');
            if(existing) Object.assign(existing,{title:name,url,parentId});
            else {if(data.bookmarks.length>=MAX_BOOKMARKS)throw Error('Bookmark limit reached.');data.bookmarks.push({id:id(),title:name,url,parentId,addedAt:Date.now()});}
            write(data);return list();
        },
        remove(bookmarkId) {
            const data=read(), index=data.bookmarks.findIndex(b=>b.id===bookmarkId);
            if(index<0) throw Error('Bookmark no longer exists.');
            data.bookmarks.splice(index,1);write(data);return list();
        },
        createFolder(value) {
            const data=read(), parentId=parent(data,value?.parentId), name=title(value?.title,'',160);
            if(data.folders.some(f=>f.parentId===parentId && f.title===name)) throw Error('That folder already exists here.');
            if(data.folders.length>=MAX_FOLDERS) throw Error('Bookmark folder limit reached.');
            const folder={id:id(),parentId,title:name};data.folders.push(folder);write(data);
            return {...list(),createdFolderId:folder.id};
        },
        importHTML(filename) {
            if(!/\.html?$/i.test(filename) || fs.statSync(filename).size>MAX_HTML) throw Error('Choose a bookmark HTML file up to 10 MB.');
            const imported=parseBookmarkHTML(fs.readFileSync(filename,'utf8')), data=read(), mapping=new Map([[null,null]]);
            let foldersAdded=0, added=0, duplicates=0;
            for(const folder of imported.data.folders) {
                const parentId=mapping.get(folder.parentId);
                let target=data.folders.find(f=>f.parentId===parentId && f.title===folder.title);
                if(!target){target={...folder,parentId};data.folders.push(target);foldersAdded++;}
                mapping.set(folder.id,target.id);
            }
            for(const bookmark of imported.data.bookmarks) {
                const parentId=mapping.get(bookmark.parentId);
                if(data.bookmarks.some(b=>b.parentId===parentId && b.url===bookmark.url)){duplicates++;continue;}
                data.bookmarks.push({...bookmark,parentId});added++;
            }
            write(data);
            const unavailable=imported.data.bookmarks.filter(b=>!browserUrl(b.url)).length;
            return {...list(),imported:{added,foldersAdded,duplicates,skipped:imported.skipped,unavailable}};
        },
    };
}

function registerBrowserBookmarkIpc({ipcMain,store,trustedDesktop,dialog,getWindow}) {
    for(const action of ['list','save','remove','createFolder','import']) {
        ipcMain.handle(`browser-bookmarks:${action}`,async(event,value)=>{
            if(!trustedDesktop(event)) return {error:'Desktop access required.'};
            try {
                if(action!=='import') return store[action](value);
                // Renderer arguments cannot select arbitrary paths.
                const chosen=await dialog.showOpenDialog(getWindow(event),{title:'Import browser bookmarks',
                    filters:[{name:'Bookmark HTML',extensions:['html','htm']}],properties:['openFile']});
                if(chosen.canceled || !chosen.filePaths?.[0]) return {cancelled:true};
                return store.importHTML(chosen.filePaths[0]);
            } catch(error){return {error:error.message};}
        });
    }
}
module.exports={createBrowserBookmarks,parseBookmarkHTML,registerBrowserBookmarkIpc};
