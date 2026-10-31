import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createReverseEngineerInstallations } = createRequire(import.meta.url)('../../electron/reverseEngineerInstallations');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'law-re-installations-')); roots.push(directory);
  const launcher = path.join(directory, 'Ghidra.lnk'), runtime = path.join(directory, 'java.exe');
  const id = '12345678-1234-1234-1234-123456789abc';
  fs.writeFileSync(launcher, 'fixture'); fs.writeFileSync(runtime, 'fixture');
  const write = (file, data) => fs.writeFileSync(path.join(directory, file), JSON.stringify(data));
  const receipt = { schema_version: 1, tools: { ghidra: { id, version: '12.2', checkFiles: [runtime] } } };
  write('reverse-engineer-installations.json', receipt);
  write('program-launchers.json', [{ id, name: 'Ghidra', path: launcher }]);
  return { directory, runtime, launcher, id, receipt, write, read: createReverseEngineerInstallations({ directory }) };
}
describe('local Reverse Engineer installations', () => {
  it('reports registered existing installations without exposing file paths', () => {
    const f = fixture(), result = f.read();
    expect(result.tools.ghidra).toMatchObject({ id: f.id, version: '12.2', available: true });
    expect(JSON.stringify(result)).not.toContain(f.directory);
    expect(result.tools.ghidra).not.toHaveProperty('checkFiles');
  });
  it('rechecks required files and registry on every read without mutating the receipt', () => {
    const f = fixture(), before = fs.readFileSync(path.join(f.directory, 'reverse-engineer-installations.json'), 'utf8');
    fs.unlinkSync(f.runtime); expect(f.read().tools.ghidra.available).toBe(false);
    fs.writeFileSync(f.runtime, 'restored'); expect(f.read().tools.ghidra.available).toBe(true);
    f.write('program-launchers.json', []); expect(f.read().tools.ghidra.available).toBe(false);
    expect(fs.readFileSync(path.join(f.directory, 'reverse-engineer-installations.json'), 'utf8')).toBe(before);
  });
  it('treats a missing receipt as no installations and malformed metadata as a recoverable error', () => {
    const f = fixture();
    fs.unlinkSync(path.join(f.directory, 'reverse-engineer-installations.json'));
    expect(f.read()).toEqual({ tools: {} });
    for (const receipt of [{}, { ...f.receipt, schema_version: 2 }, { schema_version: 1, tools: { unknown: f.receipt.tools.ghidra } },
      { schema_version: 1, tools: { ghidra: { ...f.receipt.tools.ghidra, checkFiles: ['relative.exe'] } } }]) {
      f.write('reverse-engineer-installations.json', receipt);
      expect(f.read()).toMatchObject({ tools: {}, error: expect.stringContaining('could not be read') });
    }
    f.write('reverse-engineer-installations.json', f.receipt);
    fs.writeFileSync(path.join(f.directory, 'program-launchers.json'), '{broken');
    expect(f.read().error).toBeTruthy();
  });
});
