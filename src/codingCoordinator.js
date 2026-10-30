import { apiUrl } from './api';

export const codingTerminal = status => ['completed', 'needs_review', 'failed', 'paused', 'cancelled', 'interrupted'].includes(status);

// Quotes group arguments; backslashes remain literal Windows path characters.
export function parseCheckCommand(command) {
  const argv = []; let token = '', quote = null, present = false;
  const text = command.trim();
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && [quote, '\\'].includes(text[index + 1])) token += text[++index];
      else if (character === quote) quote = null; else token += character;
      present = true;
    }
    else if (character === '"' || character === "'") { quote = character; present = true; }
    else if (/\s/.test(character)) { if (present) { argv.push(token); token = ''; present = false; } }
    else { token += character; present = true; }
  }
  if (quote) throw Error('Close the quote in the check command.');
  if (present) argv.push(token);
  if (!argv.length || argv.some(arg => !arg)) throw Error('Enter an executable and its arguments.');
  return argv;
}

export function codingChecks(text, optional = false) {
  const commands = text.split(/\r?\n/).filter(line => line.trim());
  if (!commands.length && optional) return [];
  if (!commands.length || commands.length > 12) throw Error('Enter one to twelve custom checks, one per line.');
  return commands.map((command, index) => ({ name: `Check ${index + 1}`, argv: parseCheckCommand(command), timeout_seconds: 120 }));
}

export const displayCommand = argv => (argv || []).map(arg => /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg).join(' ');

export function checkStatus(check) {
  return check.status || (check.running ? 'running' : check.cancelled ? 'cancelled' : check.timed_out ? 'timed_out' : check.passed ? 'passed' : 'failed');
}

export async function codingRequest(path, signal) {
  const response = await fetch(apiUrl(`/coding${path}`), { signal });
  const value = await response.json();
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : 'Could not read coding task state.');
  return value;
}

export async function codingControl(value) {
  if (!window.workstationDesktop?.codingControl) throw Error('Restart the desktop app after installing the coding coordinator.');
  const result = await window.workstationDesktop.codingControl(value);
  if (result.error) throw Error(result.error);
  return result;
}
