const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');

const MAX_BYTES = 128 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
const bytesOf = value => {
    if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) throw Error('Model bytes are required.');
    const bytes = value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (!bytes.length || bytes.length > MAX_BYTES) throw Error('Repair supports files up to 128 MB.');
    return bytes;
};

function createMeshRepair({dialog, getWindow, onProgress = () => {}, platform = process.platform,
    tempRoot = os.tmpdir(), startProcess = spawn, timeoutMs = 15 * 60 * 1000,
    script = path.join(__dirname, 'repair3D.ps1')} = {}) {
    let active = null, completed = null, disposed = false;
    function cancel(id) {
        if (active?.id === id) { active.cancelled = true; active.child?.kill(); }
        if (completed?.id === id) completed = null;
        return {cancelled: true};
    }
    function run(request) {
        if (disposed) throw Error('The repair service is closing.');
        if (platform !== 'win32') throw Error('Windows mesh repair requires the Windows desktop app.');
        if (active) throw Error('Another model repair is still stopping or running.');
        if (!validId(request?.id)) throw Error('Invalid repair request.');
        const input = bytesOf(request.bytes);
        if (input.length < 4 || input.readUInt32LE(0) !== 0x04034b50) throw Error('A valid 3MF repair package is required.');
        const job = {id: request.id, cancelled: false, child: null};
        active = job; completed = null;
        job.promise = (async () => {
            let directory;
            try {
                directory = await fs.mkdtemp(path.join(tempRoot, 'law-mesh-repair-'));
                const source = path.join(directory, 'input.3mf'), target = path.join(directory, 'repaired.3mf');
                await fs.writeFile(source, input, {flag: 'wx'});
                if (job.cancelled) return {cancelled: true};
                const summary = await new Promise((resolve, reject) => {
                    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
                    const child = startProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-InputPath', source, '-OutputPath', target],
                        {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
                    job.child = child;
                    let pending = '', stderr = '', result, failure, timedOut = false;
                    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
                    const line = text => {
                        try {
                            const value = JSON.parse(text);
                            if (value.type === 'progress') onProgress({id: job.id, stage: value.stage});
                            else if (value.type === 'complete') result = value;
                            else if (value.type === 'error') failure = value.message;
                        } catch { /* Non-protocol output cannot become a successful repair. */ }
                    };
                    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
                    child.stdout.on('data', chunk => {
                        pending += chunk;
                        if (pending.length > 65536) { failure = 'Unexpected repair worker output.'; child.kill(); return; }
                        const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(line);
                    });
                    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
                    child.once('error', error => { clearTimeout(timer); reject(Error(`Could not start Windows mesh repair: ${error.message}`)); });
                    child.once('close', code => {
                        clearTimeout(timer); if (pending.trim()) line(pending);
                        if (job.cancelled) resolve(null);
                        else if (timedOut) reject(Error('Windows repair exceeded 15 minutes. The original file is unchanged.'));
                        else if (code !== 0 || !result || failure) reject(Error(failure || `Windows mesh repair failed${stderr.trim() ? ': ' + stderr.trim().slice(-1200) : '.'}`));
                        else resolve(result);
                    });
                });
                if (job.cancelled) return {cancelled: true};
                const stat = await fs.stat(target);
                if (!stat.isFile() || stat.size < 4 || stat.size > MAX_BYTES) throw Error('Windows produced an invalid or oversized result.');
                const bytes = await fs.readFile(target);
                if (job.cancelled) return {cancelled: true};
                completed = {id: job.id, bytes};
                return {id: job.id, bytes, summary};
            } finally {
                // Only remove the exact private directory created by this invocation.
                try {
                    if (directory && path.dirname(path.resolve(directory)) === path.resolve(tempRoot) && path.basename(directory).startsWith('law-mesh-repair-')) {
                        const stat = await fs.lstat(directory);
                        if (stat.isDirectory() && !stat.isSymbolicLink()) await fs.rm(directory, {recursive: true, force: true, maxRetries: 3});
                    }
                } finally { if (active === job) active = null; }
            }
        })();
        return job.promise;
    }
    async function save(request) {
        if (completed?.id !== request?.id) throw Error('Repair this model again before saving.');
        const format = request.format;
        if (!['stl', '3mf'].includes(format)) throw Error('Choose STL or 3MF.');
        const bytes = format === '3mf' ? completed.bytes : bytesOf(request.bytes);
        if (format === 'stl' && (bytes.length < 84 || 84 + 50 * bytes.readUInt32LE(80) !== bytes.length)) throw Error('Invalid binary STL export.');
        const name = String(request.name || 'model').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'model';
        const selected = await dialog.showSaveDialog(getWindow?.(), {title: 'Save repaired model as a new file', defaultPath: `${name}-repaired.${format}`,
            filters: [{name: format.toUpperCase() + ' model', extensions: [format]}], properties: ['createDirectory', 'dontAddToRecent']});
        if (selected.canceled || !selected.filePath) return {cancelled: true};
        if (completed?.id !== request.id) return {cancelled: true};
        const target = selected.filePath;
        if (path.extname(target).toLowerCase() !== '.' + format) throw Error(`Choose a .${format} filename.`);
        try { await fs.writeFile(target, bytes, {flag: 'wx'}); }
        catch (error) { if (error.code === 'EEXIST') throw Error('Choose a new filename. Repair never overwrites an existing file.'); throw error; }
        return {saved: true, name: path.basename(target)};
    }
    return {run, cancel, save, release: cancel,
        async dispose() { disposed = true; completed = null; if (active) { cancel(active.id); await active.promise.catch(() => {}); } },
    };
}

function registerMeshRepairIpc({ipcMain, service, trustedDesktop}) {
    for (const action of ['run', 'cancel', 'save', 'release']) ipcMain.handle(`mesh-repair:${action}`, async (event, value) => {
        if (!trustedDesktop(event)) return {error: 'Desktop access required.'};
        try { return await service[action](value); } catch (error) { return {error: error.message}; }
    });
}
module.exports = {createMeshRepair, registerMeshRepairIpc, MAX_BYTES};
