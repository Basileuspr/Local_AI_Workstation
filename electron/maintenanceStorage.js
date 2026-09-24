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

module.exports = { clearDesktopStorage };
