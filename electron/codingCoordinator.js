// Only a native-selected project can become a coding target. No generic HTTP bridge.
const { randomUUID } = require('crypto');

function createCodingCoordinator({ choose, request }) {
    const projects = new Map();
    let choosing = false;
    return {
        async choose() {
            if (choosing) return { canceled: true };
            choosing = true;
            try {
                const result = await choose();
                if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
                const id = randomUUID(), root = result.filePaths[0];
                projects.set(id, root);
                return { id, root };
            } finally { choosing = false; }
        },
        async control(value) {
            if (!value || typeof value !== 'object') throw Error('Invalid coding request.');
            if (value.action === 'start') {
                const root = projects.get(value.projectId);
                if (!root) throw Error('Choose the project folder in this desktop session.');
                const { goal, model, checks, context_tokens, max_rounds, trusted_checks } = value;
                return request('/runs', { root, goal, model, checks, context_tokens, max_rounds, trusted_checks });
            }
            if (!['pause', 'cancel', 'resume'].includes(value.action) || !/^[a-f0-9]{32}$/.test(value.id || ''))
                throw Error('Unknown coding action.');
            return request(`/runs/${value.id}/${value.action}`, {});
        },
    };
}
module.exports = { createCodingCoordinator };
