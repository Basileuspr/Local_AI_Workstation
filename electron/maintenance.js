const { randomUUID } = require("crypto");

// Only the main process holds archive paths/digests and authorizes reset tickets.
function createMaintenance(deps) {
    let pending = null;
    let busy = false;
    let recovery = false;
    return {
        async exportInventory() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            try {
                const chosen = await deps.chooseArchive();
                if (chosen.canceled) return { canceled: true };
                const result = await deps.run({ action: "export", destination: chosen.filePath });
                pending = { ...result, ticket: randomUUID() };
                return { ticket: pending.ticket, archive: result.archive, report: result.report };
            } catch (error) { return { error: error.message }; }
            finally { busy = false; }
        },
        async reset({ ticket, confirmation } = {}) {
            if (busy) return { error: "Maintenance is already running." };
            if (!pending || pending.ticket !== ticket || confirmation !== "RESET") return { error: "Save an inventory ZIP, then type RESET to confirm." };
            busy = true;
            let stopped = false;
            let completed = false;
            try {
                await deps.checkRenderer();
                if (!deps.ownsBackend()) {
                    const previous = await deps.run({ action: "recovery" });
                    if (await deps.backendHealthy() || (!recovery && !previous.pending)) throw new Error("Reset needs a backend started by this desktop app. Close the separately running backend, then fully quit and reopen the desktop app.");
                    stopped = true;
                }
                if (!stopped) {
                    await deps.lockBackend();
                    await deps.stopBackend();
                    stopped = true;
                }
                // Reverify the saved ZIP in the offline worker immediately before deletion.
                await deps.run({ action: "reset", archive: pending.archive, sha256: pending.sha256, confirmation });
                completed = true;
                // Clear rendered content while offline, before releasing the new backend.
                await deps.clearRenderer();
                await deps.clearCache();
                await deps.startBackend();
                pending = null;
                recovery = false;
                deps.notifyComplete();
                return { ok: true };
            } catch (error) {
                recovery = stopped;
                if (!stopped) await deps.unlockBackend().catch(() => {});
                deps.notifyFailure(error.message);
                return { error: error.message, backendStopped: stopped, dataCleared: completed };
            } finally { busy = false; }
        },
    };
}

module.exports = { createMaintenance };
