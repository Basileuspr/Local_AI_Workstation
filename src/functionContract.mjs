export const launchTargets = [
  { id: 'codex', name: 'Codex' }, { id: 'task-manager', name: 'Task Manager' },
  { id: 'phone-link', name: 'Windows Phone Link' }, { id: 'settings', name: 'Settings' },
  { id: 'settings-system', name: 'Settings → System / Display' }, { id: 'settings-sound', name: 'Settings → Sound' },
];
export const stepTypes = [
  ['launch', 'Open application / Settings'], ['window-wait', 'Wait for window'],
  ['window-capture', 'Screenshot window'], ['control-set', 'Fill text field'],
  ['control-invoke', 'Press selected button'], ['folder-audit', 'Inspect / audit folder'],
  ['pointer-paste', 'Paste at pointed text field'], ['pointer-click', 'Click pointed button'],
  ['text', 'Prepare request / text'], ['output-copy', 'Copy result to clipboard'], ['output-save', 'Save result in folder'],
];
const bounded = (value, limit) => typeof value === 'string' && value.length <= limit;
const ref = value => bounded(value, 36) && /^[a-f0-9-]{36}$/.test(value);
export function validateWorkflow(value) {
  if (!value || !bounded(value.id, 100) || !value.id || !bounded(value.name, 80) || !value.name.trim()
    || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 30) throw Error('Name the function and add 1–30 steps.');
  for (const step of value.steps) {
    if (!step || !stepTypes.some(([type]) => type === step.type)) throw Error('Unknown function step.');
    if (step.type === 'launch' && !launchTargets.some(target => target.id === step.target) && !(/^program:/.test(step.target) && ref(step.target.slice(8)))) throw Error('Choose an application.');
    if (step.type.startsWith('window-') || step.type.startsWith('control-') || step.type.startsWith('pointer-')) {
      if (!step.window || !bounded(step.window.process, 100) || !/^[\w .-]+$/.test(step.window.process)
        || !bounded(step.window.title, 512)) throw Error('Choose a window for each window/control step.');
    }
    if (step.type.startsWith('pointer-')) {
      const point = step.point;
      if (!point || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(point[key]))
        || point.width < 1 || point.height < 1 || point.width * point.height > 16000000
        || point.x < 0 || point.y < 0 || point.x >= point.width || point.y >= point.height) throw Error('Point at the field or button first.');
    }
    if (step.type.startsWith('control-')) {
      const control = step.control;
      if (!control || !bounded(control.name, 512) || !bounded(control.automationId, 512)
        || !(control.name || control.automationId) || !bounded(control.controlType, 80)) throw Error('Choose a named accessible control.');
    }
    if (step.type === 'text' || step.type === 'control-set' || step.type === 'pointer-paste') {
      if (!bounded(step.text, 32000) || !step.text.trim()) throw Error('Enter text for the request.');
    }
    if (step.type === 'folder-audit' || step.type === 'output-save') {
      if (!ref(step.folderId)) throw Error('Choose a folder using Browse.');
    }
    if (step.type === 'folder-audit' && (!Number.isInteger(step.depth) || step.depth < 0 || step.depth > 8)) throw Error('Audit depth must be 0–8.');
  }
  return value;
}
export function expandFunctionText(text, report) {
  return text.replaceAll('{{report}}', () => report || '');
}
export function defaultStep(type) {
  return { type, ...(type === 'launch' ? { target: 'task-manager' } : {}),
    ...(type === 'folder-audit' ? { depth: 3 } : {}),
    ...(type === 'text' || type === 'control-set' || type === 'pointer-paste' ? { text: 'Please inspect this application and report findings. Make no changes.\n\n{{report}}' } : {}) };
}
