import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { appearanceThemes } from '../../src/appearance';
import { CLOCK_APPEARANCE_KEY, clockAppearanceVariables, clockTimeOptions, defaultClockAppearance,
  loadClockAppearance, normalizeClockAppearance, saveClockAppearance } from '../../src/clockAppearance';
import ClockStyleDialog, { ClockFace } from '../../src/components/ClockStyleDialog';
import WorkstationTime from '../../src/components/WorkstationTime';
import { saveTimer, startTimer, timerDefaults, TIMER_STORAGE_KEY } from '../../src/workstationTimer';

afterEach(() => vi.unstubAllGlobals());

describe('clock appearance', () => {
  it.each([null, [], 'broken', { theme: '__proto__', style: 'unknown', font: 'url(https://example.invalid)', size: 200,
    textColor: 'red;position:fixed', backgroundColor: '#fff', format: 'unknown' }])('defaults unsafe or obsolete settings: %j', value => {
    expect(normalizeClockAppearance(value)).toEqual(defaultClockAppearance);
  });
  it('saves style choices without touching an active timer', () => {
    const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    saveTimer(startTimer(timerDefaults(), 1000, 90000), storage);
    const timer = values.get(TIMER_STORAGE_KEY);
    const appearance = { ...defaultClockAppearance, style: 'glow', theme: 'plum', font: 'consolas', size: 20, bold: true,
      customColors: true, textColor: '#ABCDEF', backgroundColor: '#010203', format: '24', seconds: false, date: true };
    saveClockAppearance(appearance, storage);
    expect(loadClockAppearance(storage)).toEqual({ ...appearance, textColor: '#abcdef' });
    expect(values.get(TIMER_STORAGE_KEY)).toBe(timer);
    saveClockAppearance(defaultClockAppearance, storage);
    expect(JSON.parse(values.get(CLOCK_APPEARANCE_KEY))).toEqual(defaultClockAppearance);
    expect(values.get(TIMER_STORAGE_KEY)).toBe(timer);
  });
  it('recovers from damaged JSON or unavailable storage', () => {
    expect(loadClockAppearance({ getItem: () => '{bad' })).toEqual(defaultClockAppearance);
    const storage = { getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); } };
    expect(loadClockAppearance(storage)).toEqual(defaultClockAppearance);
    expect(() => saveClockAppearance(defaultClockAppearance, storage)).not.toThrow();
  });
  it('follows app colors by default and supports independent presets and custom colors', () => {
    expect(clockAppearanceVariables(defaultClockAppearance)).toMatchObject({ '--clock-text': 'var(--text-dim)',
      '--clock-background': 'transparent', '--clock-font': 'var(--font-body)' });
    const paper = clockAppearanceVariables({ theme: 'paper', font: 'georgia', style: 'badge', size: 24, bold: true });
    expect(paper).toMatchObject({ '--clock-text': appearanceThemes.paper.colors.accent,
      '--clock-background': appearanceThemes.paper.colors['bg-card'], '--clock-size': '24px', '--clock-weight': 700 });
    expect(paper['--clock-font']).toContain('Georgia');
    expect(clockAppearanceVariables({ theme: 'paper', customColors: true, textColor: '#ff9900', backgroundColor: '#000000' }))
      .toMatchObject({ '--clock-text': '#ff9900', '--clock-background': '#000000' });
  });
  it('uses 00 at midnight in 24-hour mode and lets the locale choose the system format', () => {
    const midnight = new Date(2026, 9, 3, 0, 5, 6);
    expect(midnight.toLocaleTimeString('en-US', clockTimeOptions({ format: '24', seconds: false }))).toBe('00:05');
    expect(midnight.toLocaleTimeString('en-US', clockTimeOptions({ format: '12' }))).toBe('12:05:06 AM');
    expect(clockTimeOptions(defaultClockAppearance)).not.toHaveProperty('hourCycle');
    expect(clockTimeOptions({ seconds: false })).not.toHaveProperty('second');
  });
  it('exposes direct keyboard access to clock styling and restores saved choices', () => {
    vi.stubGlobal('localStorage', { getItem: key => key === CLOCK_APPEARANCE_KEY
      ? JSON.stringify({ font: 'consolas', theme: 'forest', style: 'terminal', size: 18, date: true }) : null });
    const markup = renderToStaticMarkup(<WorkstationTime />);
    expect(markup).toContain('aria-label="Customize clock"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('workstation-clock styled-clock clock-terminal');
    expect(markup).toContain('--clock-size:18px');
    expect(markup).toContain('clock-date-value');
    expect(markup).toContain('aria-label="Open timer"');
    const dialog = renderToStaticMarkup(<ClockStyleDialog appearance={defaultClockAppearance} time={new Date()} onChange={() => {}} onClose={() => {}} />);
    for (const label of ['Clock preview', 'Clock font', 'Clock theme', 'Use custom colors', 'Show seconds', 'Reset clock style']) expect(dialog).toContain(label);
    expect(renderToStaticMarkup(<ClockFace appearance={defaultClockAppearance} time={new Date()} />)).not.toContain('clock-date-value');
  });
});
