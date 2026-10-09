const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const MAX_MEDIA = 256 * 1024 * 1024, MAX_CACHE = 512 * 1024 * 1024, MAX_RECORDS = 200;
const ID = /^[a-f0-9]{32}$/;

// Checkpoints contain only unsigned page identity and an opaque account hash;
// no DOM, signed URLs, form values, cookies, or request headers.
// Media is disposable; checkpoints and future saved analyses are independent.
function createWorkflowStore(root) {
    const records=new Map();
    const checkpointDir=root && path.join(root,'checkpoints'), mediaDir=root && path.join(root,'media');
    const archiveDir=root && path.join(root,'archive');
    function directory(id) {
        if(!ID.test(id) || !mediaDir)throw Error('Workflow storage unavailable.');
        const target=path.join(mediaDir,id);
        if(fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())throw Error('Workflow storage cannot use linked directories.');
        return target;
    }
    function remove(id) {
        if(!mediaDir)return;
        const target=directory(id);
        // Generated ID, exact child, and no traversal or symlink following.
        fs.rmSync(target,{recursive:true,force:true});
    }
    function write(record) {
        if(!root)return;
        fs.mkdirSync(checkpointDir,{recursive:true});
        const file=path.join(checkpointDir,record.id+'.json');
        fs.writeFileSync(file+'.pending',JSON.stringify(record));fs.renameSync(file+'.pending',file);
    }
    function update(id, changes) {
        const row=records.get(id);if(!row)throw Error('Workflow not found.');
        // Hard allowlist, even when a caller passes a whole tool response.
        for(const key of ['status','stage','reason','media','source','accountBound'])if(key in changes)row[key]=changes[key];
        if('accountRef' in changes && (changes.accountRef===null || typeof changes.accountRef==='string' && /^[a-f0-9]{64}$/.test(changes.accountRef)))row.accountRef=changes.accountRef;
        row.updatedAt=Date.now();write(row);return structuredClone(row);
    }
    if(root) {
        for(const dir of [root,checkpointDir,mediaDir,archiveDir]) {
            if(fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink())throw Error('Workflow storage cannot use linked directories.');
            fs.mkdirSync(dir,{recursive:true});
        }
        for(const file of fs.readdirSync(checkpointDir).filter(f=>/^[a-f0-9]{32}\.json$/.test(f)).slice(-MAX_RECORDS)) {
            const row=JSON.parse(fs.readFileSync(path.join(checkpointDir,file),'utf8'));
            if(!ID.test(row.id) || !(row.profileId==='default' || ID.test(row.profileId)) || row.id+'.json'!==file)continue;
            records.set(row.id,row);
            if(!['completed','cancelled','failed','interrupted'].includes(row.status)) {
                remove(row.id);update(row.id,{status:'interrupted',stage:'review',reason:'restart_requires_manual_resume',media:null});
            }
        }
        // Orphaned partial work and expired media cannot survive an interrupted run.
        for(const id of fs.readdirSync(mediaDir).filter(id=>ID.test(id))) {
            const row=records.get(id);
            if(!row || row.status!=='completed' || Date.now()-row.updatedAt>24*60*60*1000) {
                remove(id);if(row)update(id,{media:null});
            }
        }
    }
    return {
        root:mediaDir, directory, remove, update,
        get:id=>{const row=records.get(id);return row?structuredClone(row):null;},
        history:()=>[...records.values()].reverse().map(r=>structuredClone(r)),
        create(profileId) {
            if(records.size>=MAX_RECORDS && root) {
                const old=[...records.values()].find(r=>['completed','cancelled','failed'].includes(r.status) && !r.media);
                if(old) {
                    fs.renameSync(path.join(checkpointDir,old.id+'.json'),path.join(archiveDir,old.id+'.json'));
                    records.delete(old.id);
                }
            }
            if(records.size>=MAX_RECORDS)throw Error('Workflow checkpoint limit reached. Archive results before starting more workflows.');
            const row={id:randomUUID().replaceAll('-',''),profileId,status:'running',stage:'ready',reason:null,createdAt:Date.now(),updatedAt:Date.now(),media:null};
            records.set(row.id,row);write(row);return structuredClone(row);
        },
        allocate(id) {
            let bytes=0;
            if(mediaDir)for(const entry of fs.readdirSync(mediaDir).filter(x=>ID.test(x))) {
                for(const f of fs.readdirSync(directory(entry))) {
                    const p=path.join(directory(entry),f);if(fs.lstatSync(p).isFile())bytes+=fs.statSync(p).size;
                }
            }
            // Reserve a maximal video, 16 bounded VTT tracks and complete
            // ten-minute AAC output. Small completed captures may coexist.
            if(bytes+MAX_MEDIA+33*1024*1024>MAX_CACHE)throw Error('Workflow media cache is full. Clear workflow media before capturing another video.');
            const dir=directory(id);fs.mkdirSync(dir,{recursive:true});return dir;
        },
        clear() {
            if(mediaDir)for(const id of fs.readdirSync(mediaDir).filter(id=>ID.test(id)))remove(id);
            for(const row of records.values())if(row.media)update(row.id,{media:null});
            return {cleared:true};
        },
    };
}
module.exports={createWorkflowStore,MAX_MEDIA,MAX_CACHE};
