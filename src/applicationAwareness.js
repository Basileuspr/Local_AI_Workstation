import { apiUrl } from './api';

export async function awarenessRequest(path) {
  const response = await fetch(apiUrl(`/system/${path}`), { cache: 'no-store', signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Application check failed.');
  return result;
}
export const readEnvironment = () => awarenessRequest('environment?live=true');
export const checkAppUpdates = () => awarenessRequest('updates');
export const checkDependencies = profile => awarenessRequest(`dependencies?profile=${encodeURIComponent(profile)}`);

export async function dependencyAction(action, ...args) {
  const desktop = window.workstationDesktop;
  const methods = { prepare: 'prepareDependencyUpdate', approve: 'approveDependencyUpdate', cancel: 'cancelDependencyUpdate' };
  if (!desktop?.[methods[action]]) throw new Error('Dependency updates require the owning desktop. Fully restart Electron to load this feature.');
  const result = await desktop[methods[action]](...args);
  if (result?.error) throw new Error(result.error);
  return result;
}
