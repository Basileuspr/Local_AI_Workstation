const path = require('node:path');
const { execFile } = require('node:child_process');

function automateWindows(request, { execute = execFile, signal, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.reject(Error('Window automation requires Windows.'));
  if (signal?.aborted) return Promise.reject(Error('Function stopped.'));
  if (!['windows', 'controls', 'set', 'invoke', 'capture', 'launch', 'pick-pointer', 'pointer-paste', 'pointer-click'].includes(request?.action)) return Promise.reject(Error('Unknown automation action.'));
  // Data travels as base64 JSON to a fixed script, never as PowerShell source.
  const data = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => execute(executable,
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'functionAutomation.ps1'), '-RequestBase64', data],
    // Allow an in-flight paste to restore the clipboard before Stop finishes.
    { windowsHide: true, timeout: 20000, maxBuffer: 24 * 1024 * 1024, signal: request.action === 'pointer-paste' ? undefined : signal }, (error, stdout) => {
      if (signal?.aborted) return reject(Error('Function stopped.'));
      if (error) return reject(Error('Windows automation timed out or failed. Check that the application is open and accessible.'));
      try { const result = JSON.parse(stdout.trim()); if (result.error) throw Error(result.error); resolve(result); }
      catch (failure) { reject(failure); }
    }));
}
module.exports = { automateWindows };
