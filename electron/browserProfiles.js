const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {BROWSER_PARTITION} = require('./browserSession');

// Only user-chosen labels and random IDs live here. Chromium owns all secrets.
function createBrowserProfiles(directory) {
    const file = directory && path.join(directory, 'browser-profiles.json');
    let data = {selected:'default', profiles:[{id:'default', name:'Existing browser'}]};
    const clearing = new Set();
    if(file && fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if(!Array.isArray(saved.profiles) || saved.profiles.length > 16 || !saved.profiles.some(p=>p.id==='default')
            || saved.profiles.some(p=>!valid(p.id) || typeof p.name!=='string' || p.name.length>60)
            || new Set(saved.profiles.map(p=>p.id)).size!==saved.profiles.length) throw Error('Browser profile registry needs repair. Existing profiles were preserved.');
        data = {selected:saved.profiles.some(p=>p.id===saved.selected)?saved.selected:'default', profiles:saved.profiles.map(({id,name})=>({id,name}))};
    }
    function valid(id) {return id==='default' || typeof id==='string' && /^[a-f0-9]{32}$/.test(id);}
    function save() {
        if(!file)return;
        fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.pending',JSON.stringify(data));fs.renameSync(file+'.pending',file);
    }
    function get(id) {const p=data.profiles.find(p=>p.id===id);if(!p)throw Error('Select an existing browser profile.');return {...p};}
    function available(id) {get(id);if(clearing.has(id))throw Error('Wait for browser profile data clearing to finish.');return id;}
    function client(initial = data.selected) {
      let selected = available(initial);
      return {
        list:()=>({selected,profiles:data.profiles.map(p=>({...p}))}),
        selected:()=>get(selected),
        partition:id=>{available(id);return id==='default'?BROWSER_PARTITION:`persist:workstation-browser-${id}`;},
        select(id) {available(id);selected=id;data.selected=id;save();return this.list();},
        block(id) {available(id);clearing.add(id);return ()=>clearing.delete(id);},
        // Share the profile catalog and Chromium partitions, with a selection per window.
        fork:id=>client(id ?? selected),
        create(name) {
            if(typeof name!=='string' || !name.trim() || name.length>60 || /[\x00-\x1f]/.test(name))throw Error('Use a profile label of 1–60 characters.');
            if(data.profiles.length>=16)throw Error('The browser supports at most 16 profiles.');
            const p={id:randomUUID().replaceAll('-',''),name:name.trim()};data.profiles.push(p);save();return {...p};
        },
      };
    }
    return client();
}
module.exports={createBrowserProfiles};
