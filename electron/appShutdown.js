const pendingStops = new WeakMap();

/** Wait for this launch's child to exit; never kill by image name or API port. */
function stopBackendProcess(child, { spawn, platform = process.platform, log, graceMs = 20000, forceMs = 10000 }) {
    if (!child?.pid || child.exitCode != null || child.signalCode != null) return Promise.resolve();
    if (pendingStops.has(child)) return pendingStops.get(child);
    const stopped = new Promise((resolve, reject) => {
        let timer, done = false;
        const finish = error => {
            if (done) return;
            done = true; clearTimeout(timer); child.removeListener('close', closed);
            if (error) reject(error); else resolve();
        };
        const closed = () => finish();
        child.once('close', closed);
        timer = setTimeout(() => {
            log?.warn('Backend did not finish graceful shutdown; stopping its owned process tree.');
            timer = setTimeout(() => finish(new Error('The owned backend did not stop. Exit/restart was cancelled; try again.')), forceMs);
            // Exit can precede close while stdio drains. Its PID may already have
            // been reused; never send taskkill after observing process exit.
            if (child.exitCode != null || child.signalCode != null) return;
            try {
                if (platform === 'win32') {
                    const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' });
                    killer.once('error', error => log?.warn('Backend stop failed:', error.message));
                } else child.kill('SIGKILL');
            } catch (error) { log?.warn('Backend stop failed:', error.message); }
        }, graceMs);
        log?.info('Requesting graceful backend shutdown');
        try {
            if (child.stdin?.writable) {
                child.stdin.once('error', error => log?.warn('Backend control pipe closed:', error.message));
                child.stdin.end('{"command":"shutdown"}\n');
            } else if (platform !== 'win32') child.kill('SIGINT');
        } catch (error) { log?.warn('Could not request backend shutdown:', error.message); }
    });
    pendingStops.set(child, stopped);
    stopped.finally(() => pendingStops.delete(child)).catch(() => {});
    return stopped;
}

/** All user exit paths share one cleanup, one backend wait and at most one relaunch. */
function createAppShutdown({ app, stopBackend, dispose = [], onBegin, onFailure, log, canShutdown }) {
    let pending = null;
    function request({ restart = false, args } = {}) {
        if (pending) return pending;
        pending = Promise.resolve().then(async () => {
            if (canShutdown && !await canShutdown()) { pending = null; return false; }
            onBegin?.();
            const results = await Promise.allSettled(dispose.map(cleanup => Promise.resolve().then(cleanup)));
            results.forEach(result => { if (result.status === 'rejected') log?.warn('Desktop cleanup failed:', result.reason?.message); });
            await stopBackend();
            // Schedule only after the old backend has stopped, so locks and ports
            // cannot be inherited by a competing launch.
            if (restart) app.relaunch(args ? { args } : undefined);
            // Cleanup is complete. Exit also closes renderers whose beforeunload
            // handlers would otherwise veto a user-requested application exit.
            app.exit(0);
            return true;
        }).catch(error => {
            pending = null;
            log?.error('Application shutdown failed:', error.message);
            onFailure?.(error);
            return false;
        });
        return pending;
    }
    function beforeQuit(event) { event.preventDefault(); void request(); }
    function closeWindow(event) { event.preventDefault(); void request(); }
    return { request, beforeQuit, closeWindow };
}

function applicationMenu(request) {
    return [
        { label: 'File', submenu: [
            { label: 'Exit && Restart', click: () => { void request({ restart: true }); } },
            { type: 'separator' },
            { label: 'Exit', accelerator: 'Alt+F4', click: () => { void request(); } },
        ] },
        { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ];
}

module.exports = { stopBackendProcess, createAppShutdown, applicationMenu };
