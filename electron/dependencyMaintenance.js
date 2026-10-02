const { randomUUID } = require('node:crypto');

// Plans, wheel paths and hashes stay in main; renderer approves only a ticket.
function createDependencyMaintenance(deps) {
    let busy = false, pending = null;
    async function discard() {
        if (pending) await deps.run({ action: 'discard', plan: pending.plan }).catch(() => {});
        pending = null;
    }
    return {
        async prepare(name, profile) {
            if (busy) return { error: 'Dependency maintenance is already running.' };
            busy = true;
            try {
                await discard();
                const plan = await deps.run({ action: 'prepare', name, profile });
                if (plan.status !== 'approval_required') return plan;
                const ticket = randomUUID(); pending = { ticket, plan };
                const { name: dependency, current, target, scope, risk, expires_at } = plan;
                return { status: plan.status, ticket, name: dependency, current, target, scope, risk, expires_at };
            } catch (error) { return { error: error.message }; }
            finally { busy = false; }
        },
        async cancel(ticket) {
            if (busy || !pending || pending.ticket !== ticket) return { error: 'Proposal unavailable.' };
            busy = true;
            try { await discard(); return { status: 'cancelled' }; }
            finally { busy = false; }
        },
        async apply(ticket, approved) {
            if (busy) return { error: 'Dependency maintenance is already running.' };
            if (approved !== true || !pending || ticket !== pending.ticket) return { error: 'Approve a current inspected proposal first.' };
            if (Date.now() / 1000 > pending.plan.expires_at) { await discard(); return { error: 'Proposal expired. Inspect again.' }; }
            busy = true;
            let locked = false, stopped = false, outcome;
            try {
                if (!deps.ownsBackend()) throw new Error('Update requires the backend owned by this desktop.');
                await deps.lockBackend(); locked = true;
                await deps.stopBackend(); stopped = true;
                outcome = await deps.run({ action: 'apply', plan: pending.plan, approved: true });
            } catch (error) { outcome = { error: error.message }; }
            finally {
                if (stopped) {
                    try { await deps.startBackend(); }
                    catch (error) {
                        deps.onRestartFailure(error.message);
                        outcome = { ...outcome, backend_restart: 'failed', error: `Installation status: ${outcome?.status || 'failed'}. Backend could not restart: ${error.message}` };
                    }
                } else if (locked) await deps.unlockBackend().catch(() => {});
                await discard(); busy = false;
            }
            return outcome;
        },
    };
}
module.exports = { createDependencyMaintenance };
