const path = require('node:path');
const fs = require('node:fs/promises');
const {grantTextureCamera, revokeTextureCamera} = require('./audioPermissions');
const MAX_BYTES = 128 * 1024 * 1024;

function editorExport(request) {
    if (!request || !['law3d', 'stl'].includes(request.format)) throw Error('Choose a project or STL export.');
    if (!(request.bytes instanceof Uint8Array) || !request.bytes.byteLength || request.bytes.byteLength > MAX_BYTES) throw Error('3D exports must contain 1 byte to 128 MB.');
    const stem = String(request.name || 'model').split(/[\\/]/).pop().replace(/\.(law3d|stl)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,160) || 'model';
    return {name: `${stem}.${request.format}`, format: request.format, bytes: Buffer.from(request.bytes)};
}
function registerModelEditorIpc({ipcMain, dialog, getWindow, trustedDesktop}) {
    let saving = false, requestingCamera = false;
    const cameraTickets = new WeakMap();
    ipcMain.handle('model-editor:save', async (event, request) => {
        if (!trustedDesktop(event)) return {error:'Desktop access required.'};
        if (saving) return {error:'Finish the current 3D save first.'};
        saving = true;
        try {
            const output = editorExport(request);
            const choice = await dialog.showSaveDialog(getWindow(), {title:output.format === 'law3d' ? 'Save editable 3D project' : 'Export STL in millimeters', defaultPath:output.name,
                filters:[{name:output.format === 'law3d' ? '3D Viewer & Editor project' : 'STL model', extensions:[output.format]}]});
            if (choice.canceled || !choice.filePath) return {canceled:true};
            if (path.extname(choice.filePath).toLowerCase() !== `.${output.format}`) return {error:`Use the .${output.format} extension for this export.`};
            try { await fs.writeFile(choice.filePath, output.bytes, {flag:'wx'}); }
            catch(error) { if(error.code === 'EEXIST') throw Error('Choose a new filename. 3D exports never overwrite an existing file.');throw error; }
            return {saved:true, name:path.basename(choice.filePath)};
        } catch (error) { return {error:error.message}; }
        finally { saving = false; }
    });
    ipcMain.handle('model-editor:camera-start', async event => {
        if (!trustedDesktop(event)) return {error:'Desktop access required.'};
        if (requestingCamera) return {error:'A camera request is already open.'};
        requestingCamera = true;
        const ticket = (cameraTickets.get(event.sender) || 0) + 1;cameraTickets.set(event.sender, ticket);
        try {
            const result = await dialog.showMessageBox(getWindow(), {type:'question',title:'3D texture camera',message:'Allow the camera for this texture capture?',detail:'The preview and captured texture stay on this computer. Audio is not recorded. Capture, Cancel, or leaving Paint stops the camera.',buttons:['Cancel','Allow camera'],defaultId:0,cancelId:0,noLink:true});
            if (result.response !== 1 || !trustedDesktop(event) || cameraTickets.get(event.sender) !== ticket) return {allowed:false};
            grantTextureCamera(event.sender);return {allowed:true};
        } catch (error) { return {error:error.message}; }
        finally { requestingCamera = false; }
    });
    ipcMain.handle('model-editor:camera-stop', event => {if(trustedDesktop(event)){cameraTickets.set(event.sender,(cameraTickets.get(event.sender)||0)+1);revokeTextureCamera(event.sender);}return {stopped:true};});
}
module.exports = {editorExport, registerModelEditorIpc};
