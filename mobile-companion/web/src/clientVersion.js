export const clientVersion = typeof __LAW_MOBILE_VERSION__ === 'string' ? __LAW_MOBILE_VERSION__ : '';

export async function applyClientUpdate(version, {worker = globalThis.navigator?.serviceWorker,
  navigate = url => globalThis.location.replace(url)} = {}) {
  if (!/^[a-f0-9]{24}$/.test(version)) throw new Error('This phone update is unavailable. Reconnect and try again.');
  // The query bypasses older service workers without clearing pairing cookies.
  // Navigation happens only after the user chooses to apply the update.
  if (worker) {
    let timer;
    await Promise.race([
      worker.register('/sw.js', {updateViaCache: 'none'}).then(registration => registration.update()).catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, 4000); }),
    ]).finally(() => clearTimeout(timer));
  }
  navigate(`/?client-update=${version}`);
}
