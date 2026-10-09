// References only. Spotify streams are never inputs to the note converter.
let pending = null;
export function normalizePianoSpotifyLink(value = '') {
  if (typeof value !== 'string') throw Error('Paste a Spotify track link.');
  const text = value.trim();
  if (!text) return '';
  let match = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(text);
  if (!match) {
    let url;
    try { url = new URL(text); } catch { throw Error('Use an https://open.spotify.com/track/… link or spotify:track:… URI.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password)
      throw Error('Use an official Spotify track link.');
    match = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
  }
  if (!match) throw Error('Choose a Spotify track link, rather than a playlist or album.');
  return `https://open.spotify.com/track/${match[1]}`;
}
export function requestPianoSpotifyReference(value) {
  const url = normalizePianoSpotifyLink(value);
  if (!url) throw Error('Add a Spotify track link first.');
  pending = { url }; return pending;
}
export function takePianoSpotifyReference() { const value = pending; pending = null; return value; }
