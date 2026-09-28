const {trustedUrl} = require('./security');

function allowAudioPermission(contents, permission, details, mainContents, devUrl = null) {
    if (!contents || contents !== mainContents || !trustedUrl(contents.getURL(), devUrl)) return false;
    const origin = details.requestingUrl || details.securityOrigin;
    if (!origin || !trustedUrl(origin, devUrl) || details.isMainFrame === false) return false;
    if (permission === 'media') {
        if (Array.isArray(details.mediaTypes)) return details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio');
        return details.mediaType === 'audio';
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

module.exports = {allowAudioPermission, installAudioPermissions};
