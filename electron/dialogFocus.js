// Keep the OS foreground window unchanged. Restoring webContents focus retains
// the renderer's existing active element/caret instead of selecting another input.
function focusContents(window, contents) {
    if (!window || window.isDestroyed() || !window.isFocused() || !window.isVisible() || window.isMinimized()) return;
    if (!contents || contents.isDestroyed()) return;
    contents.focus();
}

function createFocusedDialog(dialog) {
    const pending = new WeakMap();
    const facade = Object.create(dialog);
    for (const method of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) {
        Object.defineProperty(facade, method, {value: async (...args) => {
            const window = args[0]?.webContents ? args[0] : null;
            const children = window?.contentView?.children || [];
            const view = children.find(item => item.getVisible?.() && item.webContents?.isFocused());
            const target = view?.webContents || window?.webContents;
            const token = {};
            if (window) pending.set(window, token);
            try { return await dialog[method](...args); }
            finally {
                if (window && pending.get(window) === token) {
                    pending.delete(window);
                    if (!window.isDestroyed()) {
                        const current = window.contentView?.children || [];
                        focusContents(window, view && (!current.includes(view) || !view.getVisible()) ? window.webContents : target);
                    }
                }
            }
        }});
    }
    return facade;
}
module.exports = {createFocusedDialog, focusContents};
