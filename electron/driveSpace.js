const { randomUUID } = require("crypto");

function createDriveSpace({ startWorker }) {
    const jobs = new Map();
    let active = null;
    const snapshot = job => ({ id: job.id, root: job.root, status: job.status, report: job.report, error: job.error });
    function stop(job) {
        if (!job || job.status !== "running") return;
        job.status = "canceled";
        if (job.report) job.report = { ...job.report, finished: false, canceled: true };
        job.child?.kill();
        // Keep the slot until the process closes, so scans cannot accumulate.
    }
    return {
        start(root) {
            if (typeof root !== "string" || !/^[a-z]:[\\/]$/i.test(root)) return { error: "Choose a local drive root, such as C:\\." };
            if (active) return { error: `A scan of ${active.root} is still running or stopping. Finish or cancel it first.` };
            const job = { id: randomUUID(), root: `${root[0].toUpperCase()}:\\`, status: "running", report: null, error: null };
            jobs.set(job.id, job);
            if (jobs.size > 16) jobs.delete(jobs.keys().next().value);
            active = job;
            let buffer = "";
            function fail(message) {
                if (job.status !== "running") return;
                job.status = "error"; job.error = message;
                job.child?.kill();
            }
            try {
                const child = startWorker(job.root);
                job.child = child;
                child.stdout.setEncoding("utf8");
                child.stdout.on("data", chunk => {
                    if (job.status !== "running") return;
                    buffer += chunk;
                    if (buffer.length > 16 * 1024 * 1024) return fail("Folder scan returned too much data.");
                    let newline;
                    while ((newline = buffer.indexOf("\n")) !== -1) {
                        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                        try {
                            const event = JSON.parse(line);
                            if (event.type === "error") { fail(event.error || "Folder scan failed."); break; }
                            if (event.report && ["progress", "complete"].includes(event.type)) job.report = event.report;
                            if (event.type === "complete") job.status = "complete";
                        } catch { fail("Folder scan returned an invalid result."); break; }
                    }
                });
                child.on("error", () => { fail("Could not start the folder scan worker."); if (active === job) active = null; });
                child.on("close", () => {
                    if (job.status === "running") { job.status = "error"; job.error = "Folder scan ended before it completed."; }
                    if (active === job) active = null;
                });
            } catch {
                job.status = "error"; job.error = "Could not start the folder scan worker."; active = null;
            }
            return snapshot(job);
        },
        status(id) { return jobs.has(id) ? snapshot(jobs.get(id)) : { error: "Folder scan was not found. Start a new scan." }; },
        cancel(id) { const job = jobs.get(id); stop(job); return job ? snapshot(job) : { error: "Folder scan was not found." }; },
        dispose() { stop(active); },
    };
}

module.exports = { createDriveSpace };
