export const sharedHelp = [
  ['Workspace controls', [
    ['Information (i)', 'Explains individual controls for the active workspace. The pinned pane has its own guide.'],
    ['Workspace options / Pin', 'Opens the workspace actions and lets you pin a supported workspace beside chat.'],
    ['Navigation groups', 'Drag a group divider to resize its list. Arrow keys adjust a focused divider; Enter or double-click restores the default. Sizes are remembered locally.'],
    ['Tab order', 'Drag rows or use arrows to reorder navigation. The chosen order persists after restart.'],
    ['Refresh', 'Reloads the interface. Save unsaved drafts first; desktop-service changes require a full quit and reopen.'],
  ]],
  ['Appearance', [
    ['Theme / contrast', 'Changes interface colors and text/border contrast immediately. Image, video and document content retain their own appearance.'],
    ['Font / size', 'Uses locally installed fonts with a fallback. Document and website previews keep their own formatting. Preferences are saved on this device.'],
    ['Windows compatibility rendering', 'Paints interface text on CPU while retaining available GPU support for video and 3D. It does not change AI model GPU settings.'],
    ['Software rendering', 'Also disables interface GPU acceleration if rendering artifacts persist. Apply/reopen uses the requested desktop rendering mode.'],
  ]],
  ['Clock and timer', [
    ['Clock / Timer', 'Shows the computer’s local time. Open Timer, set a duration and Start.'],
    ['Move timer', 'Drag its grip or focus the grip and use arrow keys. Double-click resets its position.'],
    ['Minimize / Close / Escape', 'Hides or compacts the timer while keeping the countdown running. Open Timer again to bring it back.'],
    ['Pause / Resume / Reset', 'Pauses, continues or cancels the countdown. The saved end time survives tab changes, refreshes and sleep; an expired timer shows Finished.'],
    ['Sound when finished', 'Plays a short chime while the app is running. It cannot sound while the app is closed or the computer is asleep.'],
  ]],
];

export const previewHelp = ['Image previews', [
  ['Thumbnail / original', 'Lists use small previews; opening or editing loads the original. File-list previews load as they come into view.'],
  ['Reload thumbnails', 'Use Workspace options or the picker/file-list control after a preview failure. Access checks retry after connection problems; locked images remain protected.'],
]];
