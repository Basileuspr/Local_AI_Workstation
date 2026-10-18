// Stream owned library images without navigating away from the trusted renderer.
function registerLibraryDownloadIpc({ ipcMain, trustedDesktop, getConnection }) {
    ipcMain.handle('image-library:download', (event, id) => {
        if (!trustedDesktop(event)) return { error: 'Desktop access required.' };
        if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
            return { error: 'Choose a saved library image.' };
        try {
            const { base, token } = getConnection();
            event.sender.downloadURL(`${base}/image-library/images/${id}/content?download=true`, {
                headers: { 'X-LAW-Session': token },
            });
            return { started: true };
        } catch (error) { return { error: error.message }; }
    });
}

module.exports = { registerLibraryDownloadIpc };
