"use strict";
const {trustedUrl} = require('./security');
const grants = new WeakMap();
const failures = new WeakMap();
function grantPlayback(contents, {source = 'system'} = {}) {
    if (!['system', 'spotify'].includes(source)) throw Error('Choose Windows playback or the embedded Spotify player.');
    grants.set(contents, {expires: Date.now() + 15000, requested: false, source}); failures.delete(contents);
}
function revokePlayback(contents) { grants.delete(contents); }
function playbackGranted(contents) { return (grants.get(contents)?.expires || 0) > Date.now(); }
function playbackRequested(contents) { return playbackGranted(contents) && grants.get(contents)?.requested === true; }
function playbackCaptureStatus(contents) {
    return {supported: process.platform === 'win32', error: failures.get(contents) || ''};
}
function installPlaybackCapture(contents, desktopCapturer, devUrl = null, {getSpotifyFrame = () => null} = {}) {
    contents.session.setDisplayMediaRequestHandler(async (request, callback) => {
        const grant = grants.get(contents);
        const allowed = process.platform === 'win32' && playbackGranted(contents) && !grant.requested && request.userGesture &&
            request.frame && request.frame === contents.mainFrame && trustedUrl(request.frame.url, devUrl) && request.audioRequested;
        if (!allowed) {
            if (!grant?.requested) {
                failures.set(contents, 'Playback capture needs a fresh Start click in the Windows desktop app.');
                revokePlayback(contents);
            }
            return callback({});
        }
        // Accept one display request, but retain the permission lease until the
        // renderer receives its stream and cancels it. Chromium performs another
        // media permission check AFTER this callback; revoking here denies audio.
        grant.requested = true;
        try {
            if (grant.source === 'spotify') {
                const frame = getSpotifyFrame();
                if (!frame) {
                    failures.set(contents, 'Open the embedded Spotify player and press Play before recording that source.');
                    revokePlayback(contents); return callback({});
                }
                // The host chooses the owned Spotify view; renderers cannot pass
                // arbitrary frame IDs or gain permissions in that remote view.
                return callback({video: request.frame, audio: frame, enableLocalEcho: true});
            }
            const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: 0, height: 0}});
            if (contents.isDestroyed() || !playbackGranted(contents) || grants.get(contents) !== grant || request.frame !== contents.mainFrame || !trustedUrl(request.frame.url, devUrl)) return callback({});
            if (!sources.length) {
                failures.set(contents, 'Windows could not provide a capture source. Keep the desktop unlocked and retry.');
                revokePlayback(contents); return callback({});
            }
            callback({video: sources[0], audio: 'loopback'});
        } catch {
            failures.set(contents, 'Windows could not open playback capture. Keep the desktop unlocked and retry.');
            revokePlayback(contents); callback({});
        }
    });
}
module.exports = {grantPlayback, revokePlayback, playbackGranted, playbackRequested, playbackCaptureStatus, installPlaybackCapture};
