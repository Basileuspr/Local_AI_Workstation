import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorkstationTime from "../../src/components/WorkstationTime";
import { clampTimerPosition, durationFields, durationFromFields, formatCountdown, loadTimer, MAX_TIMER_DURATION,
  normalizeTimer, pauseTimer, remainingTime, resetTimer, saveTimer, startTimer, timerDefaults, TIMER_STORAGE_KEY } from "../../src/workstationTimer";
import { avoidFloatingTool } from "../../src/floatingToolBounds";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("persistent countdown", () => {
  it("uses the saved deadline after delayed ticks, tab changes, sleep, and reload", () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const started = startTimer(timerDefaults(), 1000, 60000);
    saveTimer({ ...started, display: "hidden" }, storage);
    const restored = loadTimer(storage);
    expect(remainingTime(restored, 41000)).toBe(20000);
    expect(remainingTime(restored, 90000)).toBe(0);
    expect(restored.status).toBe("running");
    expect(restored.display).toBe("hidden");
    expect(JSON.parse(values.get(TIMER_STORAGE_KEY)).deadline).toBe(61000);
  });
  it("minimizes and closes without pausing or resetting", () => {
    const timer = startTimer(timerDefaults(), 1000, 10000);
    for (const display of ["compact", "hidden", "panel"]) {
      const restored = normalizeTimer({ ...timer, display });
      expect(remainingTime(restored, 6000)).toBe(5000);
      expect(restored.deadline).toBe(11000);
    }
  });
  it("pauses at the actual time and resumes only the remainder", () => {
    const paused = pauseTimer(startTimer(timerDefaults(), 1000, 10000), 4800);
    expect(paused.status).toBe("paused");
    expect(remainingTime(paused, 90000)).toBe(6200);
    const resumed = startTimer(paused, 90000);
    expect(resumed.deadline).toBe(96200);
    expect(remainingTime(resumed, 95000)).toBe(1200);
    expect(pauseTimer(resumed, 97000).status).toBe("finished");
  });
  it("reset cancels the deadline while preserving duration, placement, and sound preference", () => {
    const timer = { ...startTimer(timerDefaults(), 1000, 45000), display: "compact", sound: false, position: { x: 10, y: 20 } };
    expect(resetTimer(timer)).toEqual({ ...timer, deadline: null, status: "idle", remainingMs: 45000 });
  });
  it("rejects damaged saved values and remains usable when storage is blocked", () => {
    expect(normalizeTimer({ status: "running", deadline: "tomorrow", durationMs: Infinity })).toMatchObject({ status: "paused", deadline: null, durationMs: 300000 });
    expect(normalizeTimer({ durationMs: 9e10, remainingMs: -1, status: "paused", position: { x: NaN, y: 4 } }))
      .toMatchObject({ durationMs: MAX_TIMER_DURATION, remainingMs: 0, status: "finished", position: null });
    expect(loadTimer({ getItem: () => "bad JSON" })).toEqual(timerDefaults());
    const blocked = { getItem() { throw Error("Denied"); }, setItem() { throw Error("Denied"); } };
    expect(loadTimer(blocked)).toEqual(timerDefaults());
    expect(() => saveTimer(timerDefaults(), blocked)).not.toThrow();
  });
  it("validates duration fields including the 24-hour boundary", () => {
    expect(durationFromFields({ hours: "", minutes: "1", seconds: "5" })).toBe(65000);
    expect(durationFromFields({ hours: "24", minutes: "0", seconds: "0" })).toBe(MAX_TIMER_DURATION);
    for (const fields of [{ hours: 24, minutes: 0, seconds: 1 }, { hours: 0, minutes: 60, seconds: 0 },
      { hours: 0, minutes: 0, seconds: 0 }, { hours: -1, minutes: 0, seconds: 1 }, { hours: 0, minutes: .5, seconds: 1 }]) {
      expect(durationFromFields(fields)).toBeNull();
    }
    expect(durationFields(3661000)).toEqual({ hours: "1", minutes: "1", seconds: "1" });
  });
  it("rounds display upward without losing the last second", () => {
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(3661000)).toBe("01:01:01");
  });
  it("shows the system clock and an accessible way to reopen a hidden running timer", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T19:00:00Z"));
    const timer = startTimer(timerDefaults(), Date.now(), 60000);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(timer) });
    const markup = renderToStaticMarkup(<WorkstationTime />);
    expect(markup).toContain('dateTime="2026-10-02T19:00:00.000Z"');
    expect(markup).toContain('aria-label="Open timer"');
    expect(markup).toContain('Timer 01:00');
    expect(markup).not.toContain('aria-label="Floating timer"');
  });
  it("exposes the timer controls when restored open and announces completion", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ ...timerDefaults(), display: "panel", status: "finished", remainingMs: 0 }) });
    const markup = renderToStaticMarkup(<WorkstationTime />);
    expect(markup).toContain('aria-label="Minimize timer"');
    expect(markup).toContain('aria-label="Close timer panel"');
    expect(markup).toContain('role="alert">Timer finished.');
    expect(markup).toContain('>Restart</button>');
  });
});

describe("floating timer placement", () => {
  it("keeps the timer reachable after the window shrinks", () => {
    expect(clampTimerPosition({ x: 1100, y: 700 }, 300, 280, 390, 600)).toEqual({ x: 82, y: 312 });
    expect(clampTimerPosition({ x: -50, y: -50 }, 300, 280, 390, 600)).toEqual({ x: 8, y: 8 });
  });
  it("leaves the largest free native page area and restores it when the timer closes", () => {
    const page = { x: 100, y: 100, width: 900, height: 600 };
    const overlay = { x: 720, y: 440, width: 250, height: 220 };
    expect(avoidFloatingTool(page, overlay)).toEqual({ ...page, width: 612 });
    expect(avoidFloatingTool(page, null)).toEqual(page);
    expect(avoidFloatingTool(page, { x: 1010, y: 110, width: 100, height: 100 })).toEqual(page);
    const above = avoidFloatingTool(page, { x: 120, y: 500, width: 850, height: 180 });
    expect(above).toEqual({ ...page, height: 392 });
  });
});
