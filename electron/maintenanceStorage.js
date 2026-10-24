async function clearDesktopStorage(contents, restored = null, notice = "App data and personal settings were cleared.") {
    if (restored !== null && (typeof restored !== "object" || Array.isArray(restored) || Object.values(restored).some(value => typeof value !== "string"))) {
        throw new Error("Backup desktop preferences are invalid.");
    }
    // Unmount first so React cannot persist personal state after cleanup.
    await contents.executeJavaScript(`(() => {
        window.dispatchEvent(new Event('app-data-reset'));
        localStorage.clear();
        sessionStorage.clear();
    })()`);
    // Include legacy file:// preferences, preventing personal buttons from
    // migrating back into a sanitized profile after restart.
    await contents.session.clearStorageData();
    await contents.executeJavaScript(`(() => {
        const restored = JSON.parse(${JSON.stringify(JSON.stringify(restored))});
        if (restored) for (const [key, value] of Object.entries(restored)) localStorage.setItem(key, value);
        localStorage.setItem('law-app-origin-migrated-v1', '1');
        localStorage.setItem('app-reset-notice', ${JSON.stringify(notice)});
    })()`);
}

const SECTION_KEYS = {
    chats: ['local-ai-workstation-chat-pins-v1', 'local-ai-workstation-chat-models-v1', 'local-ai-workstation-navigation-v1'],
    knowledge: ['knowledge-vault-selected-v1'],
    media: ['local-ai-workstation-canvas-v1', 'image-library-revision', 'image-vault-locked', 'law-paint-view', 'law-last-iterative-scene-v1'],
    workflows: ['law-workflow-mode-v1', 'workflows-deleted'],
    training: ['law-character-parts-dataset', 'law-selected-character-v1'],
};

async function resetDesktopStorage(contents, options) {
    const all = !options || options.sections.includes('desktop');
    const notice = `${options ? 'Selected app data was sanitized.' : 'App data and personal settings were reset.'} Image Manager and Media Manager catalogs were retained.${options?.sections.includes('mobile') ? options.keep_mobile_setup ? ' Phone setup was kept; start Mobile companion and create a new invitation.' : ' Phone setup and access were cleared; use Find Tailscale address or enter your HTTPS address to pair again.' : ''}`;
    if (all) return clearDesktopStorage(contents, {}, notice);
    const keys = options.sections.flatMap(section => SECTION_KEYS[section] || []);
    // Preserve unrelated persistent preferences. Unmount before pruning so
    // cleanup effects cannot write a deleted conversation back into the UI.
    await contents.executeJavaScript(`(() => {
        window.dispatchEvent(new Event('app-data-reset'));
        const keys = ${JSON.stringify(keys)};
        for (const key of Object.keys(localStorage)) {
            if (keys.includes(key) || (${options.sections.includes('media')} && key.startsWith('image-rotation:'))) localStorage.removeItem(key);
        }
        sessionStorage.clear();
        localStorage.setItem('law-app-origin-migrated-v1', '1');
        localStorage.setItem('app-reset-notice', ${JSON.stringify(notice)});
    })()`);
}

module.exports = { clearDesktopStorage, resetDesktopStorage };
