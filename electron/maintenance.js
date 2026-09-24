const { randomUUID } = require("crypto");

// Only the main process holds archive paths/digests and authorizes reset tickets.
function createMaintenance(deps) {
    let pending = null;
    let busy = false;
    let recovery = false;
    let pendingImport = null;
    return {
        async exportInventory() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            try {
                const chosen = await deps.chooseArchive();
                if (chosen.canceled) return { canceled: true };
                const result = await deps.run({ action: "export", destination: chosen.filePath });
                return { archive: result.archive, report: result.report };
            } catch (error) { return { error: error.message }; }
            finally { busy = false; }
        },
        async prepareReset() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            try {
                const report = await deps.run({ action: "inventory" });
                pending = { ticket: randomUUID() };
                return { ticket: pending.ticket, report };
            } catch (error) { return { error: error.message }; }
            finally { busy = false; }
        },
        async importStatus() {
            if (busy) return { busy: true };
            try { return await deps.run({ action: "import-status" }); }
            catch (error) { return { error: error.message }; }
        },
        async prepareImport() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            pendingImport = null;
            try {
                const status = await deps.run({ action: "import-status" });
                if (status.pending) throw new Error("Recover the interrupted import before selecting another backup.");
                const chosen = await deps.chooseImport();
                if (chosen.canceled) return { canceled: true };
                const result = await deps.run({ action: "inspect-backup", archive: chosen.filePaths[0] });
                pendingImport = { ...result, ticket: randomUUID() };
                return { ticket: pendingImport.ticket, archive: result.archive, report: result.report };
            } catch (error) { return { error: error.message }; }
            finally { busy = false; }
        },
        async importBackup({ ticket, confirmation } = {}) {
            if (busy) return { error: "Maintenance is already running." };
            if (!pendingImport || pendingImport.ticket !== ticket || confirmation !== "IMPORT") return { error: "Select and review a backup, then type IMPORT to confirm." };
            busy = true;
            let stopped = false, frozen = false, locked = false, activated = false;
            let recoveryFolder;
            try {
                if (!deps.ownsBackend()) throw new Error("Import needs a backend started by this desktop app. Fully quit and reopen it first.");
                await deps.lockBackend(); locked = true;
                await deps.freezeRenderer(); frozen = true;
                await deps.stopBackend(); stopped = true;
                const previous_storage = await deps.readStorage();
                const result = await deps.run({ action: "import-backup", archive: pendingImport.archive, sha256: pendingImport.sha256, confirmation, previous_storage });
                recoveryFolder = result.recovery;
                await deps.restoreRenderer(result.desktop_storage, `Backup imported. Previous data and settings retained at: ${result.recovery}`);
                await deps.clearCache();
                await deps.run({ action: "finish-import" }); activated = true;
                pendingImport = null;
                await deps.startBackend();
                deps.notifyComplete();
                return { ok: true, recovery: recoveryFolder };
            } catch (error) {
                let message = error.message;
                if (stopped && !activated) {
                    try {
                        const rollback = await deps.run({ action: "rollback-import" });
                        if (rollback.pending) {
                            await deps.restoreRenderer(rollback.desktop_storage, `Import failed; previous data and settings were recovered. ${message}`);
                            await deps.clearCache();
                            await deps.run({ action: "finish-import" });
                        }
                        await deps.startBackend(); stopped = false;
                        // A storage restore unmounts React; reload only then.
                        if (rollback.pending) deps.notifyComplete();
                    } catch (failure) { message += ` Recovery could not finish: ${failure.message} Use Recover previous data on the Dashboard.`; }
                } else if (!stopped && locked) await deps.unlockBackend().catch(() => {});
                if (activated) message = `Backup imported, but the backend could not restart. Previous data is retained at: ${recoveryFolder}. ${message}`;
                deps.notifyFailure(message);
                return { error: message, backendStopped: stopped, recovery: recoveryFolder };
            } finally {
                if (frozen) await deps.thawRenderer().catch(() => {});
                busy = false;
            }
        },
        async recoverImport() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            try {
                if (deps.ownsBackend() || await deps.backendHealthy()) throw new Error("Close the running backend before recovering an interrupted import.");
                const result = await deps.run({ action: "rollback-import" });
                if (!result.pending) return { error: "No interrupted import needs recovery." };
                await deps.restoreRenderer(result.desktop_storage, "The interrupted import was undone. Previous data and settings were recovered.");
                await deps.clearCache();
                await deps.run({ action: "finish-import" });
                await deps.startBackend();
                pendingImport = null;
                deps.notifyComplete();
                return { ok: true };
            } catch (error) {
                deps.notifyFailure(error.message);
                return { error: error.message };
            } finally { busy = false; }
        },
        async exportBackup() {
            if (busy) return { error: "Maintenance is already running." };
            busy = true;
            let stopped = false;
            let frozen = false;
            let locked = false;
            let result;
            try {
                const chosen = await deps.chooseArchive("backup");
                if (chosen.canceled) return { canceled: true };
                if (!deps.ownsBackend()) throw new Error("Backup needs a backend started by this desktop app. Fully quit and reopen it first.");
                await deps.lockBackend();
                locked = true;
                await deps.freezeRenderer();
                frozen = true;
                await deps.stopBackend();
                stopped = true;
                const desktop_storage = await deps.readStorage();
                result = await deps.run({ action: "backup", destination: chosen.filePath, desktop_storage });
            } catch (error) { result = { error: error.message }; }
            finally {
                try {
                    if (stopped) await deps.startBackend();
                    else if (locked) await deps.unlockBackend().catch(() => {});
                } catch (error) {
                    result = { ...result, error: `${result?.error || "Backup saved, but the backend could not restart."} ${error.message}`, backendStopped: true };
                }
                if (frozen) await deps.thawRenderer().catch(() => {});
                busy = false;
            }
            return result;
        },
        async reset({ ticket, confirmation } = {}) {
            if (busy) return { error: "Maintenance is already running." };
            if (!pending || pending.ticket !== ticket || confirmation !== "RESET") return { error: "Review the reset, then type RESET to confirm." };
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
                await deps.run({ action: "reset", confirmation });
                completed = true;
                // Clear rendered content while offline, before releasing the new backend.
                await deps.clearRenderer();
                await deps.clearCache();
                await deps.run({ action: "finish-reset" });
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
