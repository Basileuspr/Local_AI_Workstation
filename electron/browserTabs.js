const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {browserUrl}=require('./browserPolicy');
const MAX_TABS=24;
function validSettings(value) {
    return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===1
        && Number.isInteger(value.inactiveMinutes) && value.inactiveMinutes>=0 && value.inactiveMinutes<=60;
}

// The host owns inactivity deadlines, even when the Browser pane is hidden.
// Only the timeout is persisted: page addresses and tab titles stay in memory.
function createBrowserTabs({directory,onSuspend=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    const file=directory && path.join(directory,'browser-tab-settings.json');
    const tabs=new Map();let selected=null,timer=null,settings={inactiveMinutes:2},settingsNotice='';
    if(file && fs.existsSync(file)) {
        try {
            const saved=JSON.parse(fs.readFileSync(file,'utf8'));
            if(!validSettings(saved))throw Error('invalid settings');
            settings={inactiveMinutes:saved.inactiveMinutes};
        } catch {settingsNotice='Saved tab settings could not be read. Inactive tabs will suspend after 2 minutes.';}
    }
    function get(id) {const tab=tabs.get(id);if(!tab)throw Error('Choose an existing browser tab.');return tab;}
    function schedule() {
        if(timer!==null)clearTimer(timer);timer=null;
        if(!settings.inactiveMinutes)return;
        const deadlines=[...tabs.values()].filter(t=>t.id!==selected && !t.suspended && t.inactiveSince!==null)
            .map(t=>t.inactiveSince+settings.inactiveMinutes*60000);
        if(!deadlines.length)return;
        timer=setTimer(sweep,Math.max(0,Math.min(...deadlines)-now()));timer?.unref?.();
    }
    function sweep() {
        timer=null;
        for(const tab of tabs.values()) {
            if(tab.id===selected || tab.suspended || tab.inactiveSince===null || !settings.inactiveMinutes
                || now()-tab.inactiveSince<settings.inactiveMinutes*60000)continue;
            onSuspend(tab);
            tab.suspended=true;
        }
        schedule();
    }
    function select(id) {
        const tab=get(id);
        if(selected!==id) {
            if(tabs.has(selected))tabs.get(selected).inactiveSince=now();
            selected=id;tab.inactiveSince=null;tab.suspended=false;
        }
        schedule();return tab;
    }
    return {
        get,active:()=>tabs.get(selected)||null,
        list:()=>({activeTabId:selected,tabs:[...tabs.values()].map(({id,url,title,suspended})=>({id,url,title,suspended})),
            tabSettings:{...settings},tabSettingsNotice:settingsNotice,maxTabs:MAX_TABS}),
        create(url='about:blank') {
            if(url!=='about:blank' && !browserUrl(url))throw Error('Use a public HTTP or HTTPS address.');
            if(tabs.size>=MAX_TABS)throw Error(`Close a tab before opening more than ${MAX_TABS} tabs.`);
            const tab={id:randomUUID(),url,title:'',suspended:false,inactiveSince:null};tabs.set(tab.id,tab);return select(tab.id);
        },
        select,
        update(id,value) {
            const tab=tabs.get(id);if(!tab)return;
            if(value.url==='about:blank' || browserUrl(value.url))tab.url=value.url;
            if(typeof value.title==='string')tab.title=value.title.slice(0,256);
        },
        close(id) {
            get(id);const ids=[...tabs.keys()],index=ids.indexOf(id);tabs.delete(id);
            if(selected===id){selected=null;const next=ids[index+1]||ids[index-1];if(next)select(next);}
            schedule();return this.active();
        },
        setSettings(value) {
            if(!validSettings(value))throw Error('Choose 1–60 minutes, or 0 to disable tab suspension.');
            const next={inactiveMinutes:value.inactiveMinutes};
            if(file){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.pending',JSON.stringify(next));fs.renameSync(file+'.pending',file);}
            settings=next;settingsNotice='';schedule();return this.list();
        },
        clear(){if(timer!==null)clearTimer(timer);timer=null;tabs.clear();selected=null;},
    };
}
module.exports={createBrowserTabs,MAX_TABS};
