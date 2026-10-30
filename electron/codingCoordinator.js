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
            if (['start', 'inspect', 'save-profile', 'approve-checks', 'revoke-checks'].includes(value.action)) {
                const root = projects.get(value.projectId);
                if (!root) throw Error('Choose the project folder in this desktop session.');
                const { goal, model, checks, selected_checks, verification_mode, context_tokens, max_rounds, trusted_checks, name } = value;
                if (value.action === 'inspect') return request('/projects/inspect', { root });
                if (value.action === 'revoke-checks') return request('/projects/revoke', { root });
                if (value.action === 'approve-checks') return request('/projects/approve', { root, checks, selected_checks, expected_fingerprints: value.expected_fingerprints });
                if (value.action === 'save-profile') return request('/projects/profile', { root, name, checks, selected_checks, verification_mode });
                return request('/runs', { root, goal, model, checks, selected_checks, verification_mode, context_tokens, max_rounds, trusted_checks });
            }
            if (value.action === 'verification-approval' && /^[a-f0-9]{32}$/.test(value.id || '') && /^[a-f0-9]{32}$/.test(value.request_id || ''))
                return request(`/runs/${value.id}/verification-approval`, { request_id: value.request_id, approved: value.approved, remember: !!value.remember });
            if (!['pause', 'cancel', 'resume'].includes(value.action) || !/^[a-f0-9]{32}$/.test(value.id || ''))
                throw Error('Unknown coding action.');
            return request(`/runs/${value.id}/${value.action}`, {});
        },
    };
}
module.exports = { createCodingCoordinator };
