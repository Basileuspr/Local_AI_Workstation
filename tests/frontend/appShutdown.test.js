import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import shutdown from '../../electron/appShutdown';

const { stopBackendProcess, createAppShutdown, applicationMenu } = shutdown;
const child = () => Object.assign(new EventEmitter(), {
  pid: 1234, exitCode: null, signalCode: null,
  stdin: Object.assign(new EventEmitter(), { writable: true, end: vi.fn() }), kill: vi.fn(),
});
afterEach(() => vi.useRealTimers());

describe('owned backend shutdown', () => {
  it('sends a private graceful command, keeps the process reference and waits for close', async () => {
    const process = child(), spawn = vi.fn();
    const stopped = stopBackendProcess(process, {spawn, platform:'win32'});
    expect(stopBackendProcess(process, {spawn, platform:'win32'})).toBe(stopped);
    expect(process.stdin.end).toHaveBeenCalledWith('{"command":"shutdown"}\n');
    let done = false; stopped.then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    expect(process.pid).toBe(1234); expect(spawn).not.toHaveBeenCalled();
    process.emit('close', 0); await stopped;
    expect(done).toBe(true); expect(spawn).not.toHaveBeenCalled();
  });
  it('uses bounded fallback on only the owned PID/tree and still waits for its close', async () => {
    vi.useFakeTimers();
    const process = child(), spawn = vi.fn(() => new EventEmitter());
    const stopped = stopBackendProcess(process, {spawn, platform:'win32', graceMs:20, forceMs:10});
    await vi.advanceTimersByTimeAsync(20);
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid','1234','/f','/t'], {windowsHide:true,stdio:'ignore'});
    process.emit('close', 1); await stopped;
    await vi.advanceTimersByTimeAsync(100);
    expect(spawn).toHaveBeenCalledOnce();
  });
  it('rejects if forced termination cannot be confirmed; a retry remains possible', async () => {
    vi.useFakeTimers();
    const process = child(), spawn = vi.fn(() => new EventEmitter());
    const stopped = stopBackendProcess(process, {spawn, platform:'win32', graceMs:20, forceMs:10});
    const failure = expect(stopped).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(30); await failure;
    const retried = stopBackendProcess(process, {spawn, platform:'win32'});
    process.emit('close', 0); await retried;
  });
  it('does not target missing, exited or unrelated backend processes', async () => {
    const spawn = vi.fn();
    await stopBackendProcess(null, {spawn});
    await stopBackendProcess({pid:undefined}, {spawn});
    await stopBackendProcess({pid:1234,exitCode:0}, {spawn});
    expect(spawn).not.toHaveBeenCalled();
  });
  it('does not kill an exited PID while its remaining stdio is draining', async () => {
    vi.useFakeTimers();
    const process = child(), spawn = vi.fn();
    const stopped = stopBackendProcess(process, {spawn,platform:'win32',graceMs:20});
    process.exitCode = 0;
    await vi.advanceTimersByTimeAsync(20);
    expect(spawn).not.toHaveBeenCalled();
    process.emit('close',0); await stopped;
  });
  it('survives a broken control pipe and falls back to termination', async () => {
    vi.useFakeTimers();
    const process = child(), spawn = vi.fn(() => new EventEmitter());
    const stopped = stopBackendProcess(process, {spawn,platform:'win32',graceMs:20});
    process.stdin.emit('error', Error('EPIPE'));
    await vi.advanceTimersByTimeAsync(20);
    expect(spawn).toHaveBeenCalledOnce();
    process.emit('close', 1); await stopped;
  });
});

describe('application exit paths', () => {
  it('shares pending cleanup across menu, native close and before-quit; restarts once after backend exit', async () => {
    const order = [], app = {relaunch:vi.fn(() => order.push('relaunch')),exit:vi.fn(() => order.push('exit'))};
    let release;
    const cleanup = vi.fn(), stopBackend = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const host = createAppShutdown({app,stopBackend,dispose:[cleanup]});
    const restart = applicationMenu(host.request)[0].submenu[0];
    restart.click();
    const pending = host.request();
    const event = {preventDefault:vi.fn()}; host.closeWindow(event); host.beforeQuit(event);
    await vi.waitFor(() => expect(stopBackend).toHaveBeenCalledOnce());
    expect(cleanup).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(app.relaunch).not.toHaveBeenCalled(); expect(app.exit).not.toHaveBeenCalled();
    release(); await pending;
    expect(order).toEqual(['relaunch','exit']); expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.relaunch).toHaveBeenCalledOnce();
  });
  it('blocks exit/relaunch on an unconfirmed stop and allows a fresh attempt', async () => {
    const app = {relaunch:vi.fn(),exit:vi.fn()}, onFailure = vi.fn();
    const stopBackend = vi.fn().mockRejectedValueOnce(Error('Still running')).mockResolvedValueOnce();
    const host = createAppShutdown({app,stopBackend,onFailure});
    expect(await host.request({restart:true})).toBe(false);
    expect(app.relaunch).not.toHaveBeenCalled(); expect(app.exit).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(await host.request()).toBe(true);
    expect(app.exit).toHaveBeenCalledOnce(); expect(app.relaunch).not.toHaveBeenCalled();
  });
  it('finishes backend cleanup even when an auxiliary disposer fails', async () => {
    const app = {exit:vi.fn()}, stopBackend = vi.fn(), other = vi.fn();
    const host = createAppShutdown({app,stopBackend,dispose:[() => {throw Error('view already closed');},other]});
    await host.request(); expect(stopBackend).toHaveBeenCalledOnce(); expect(other).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledOnce();
  });
});
