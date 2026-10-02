const {trustedUrl} = require('./security');
const cameraGrants = new WeakMap();
function grantTextureCamera(contents) { cameraGrants.set(contents, Date.now() + 30000); }
function revokeTextureCamera(contents) { cameraGrants.delete(contents); }

function allowAudioPermission(contents, permission, details, mainContents, devUrl = null) {
    if (!contents || contents !== mainContents || !trustedUrl(contents.getURL(), devUrl)) return false;
    const origin = details.requestingUrl || details.securityOrigin;
    if (!origin || !trustedUrl(origin, devUrl) || details.isMainFrame === false) return false;
    if (permission === 'media') {
        const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [details.mediaType];
        if (types.length > 0 && types.every(type => type === 'audio')) return true;
        return types.length > 0 && types.every(type => type === 'video') && (cameraGrants.get(contents) || 0) > Date.now();
    }
    return permission === 'clipboard-sanitized-write' || permission === 'clipboard-read';
}

function installAudioPermissions(contents, devUrl = null) {
    contents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
        callback(allowAudioPermission(requester, permission, details, contents, devUrl));
    });
    contents.session.setPermissionCheckHandler((requester, permission, origin, details) => {
        return allowAudioPermission(requester, permission, {...details, securityOrigin:origin}, contents, devUrl);
    });
}

module.exports = {allowAudioPermission, installAudioPermissions, grantTextureCamera, revokeTextureCamera};
