// Confirmation buttons against disposable clips; no live media or app data.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn('python', ['-m', 'tests.ui_fixture_server', '--duplicates'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let browser;
try {
  const fixture = await new Promise((resolve, reject) => {
    createInterface({ input: server.stdout }).once('line', line => resolve(JSON.parse(line)));
    server.once('exit', code => reject(Error(`Fixture exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.url);
  await page.getByLabel('Source folder', { exact: true }).fill(fixture.source);
  await page.getByLabel('Destination folder', { exact: true }).fill(fixture.destination);
  await page.getByRole('button', { name: 'Scan & preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mo-media-card').length === 3);
  const records = await page.evaluate(() => document.querySelector('media-organizer').pendingRecords());
  assert(records.length >= 3);
  const before = await Promise.all(records.map(async row => ({ row, bytes: await readFile(row.CurrentPath) })));
  await page.getByRole('button', { name: 'Review move', exact: true }).click();
  assert.equal(await page.locator('#mo-confirm input').count(), 0);
  const move = page.locator('#mo-execute'); assert(await move.isEnabled());
  await page.locator('#mo-confirm [data-cancel]').click();
  for (const item of before) assert.deepEqual(await readFile(item.row.CurrentPath), item.bytes);
  await page.getByRole('button', { name: 'Review move', exact: true }).click();
  await move.click();
  await page.waitForFunction(() => document.querySelectorAll('.mo-success').length === 3);
  const moved = await page.evaluate(() => document.querySelector('media-organizer').data.records.filter(row => row.Moved));
  assert.equal(moved.length, records.length);
  for (const row of moved) {
    const original = before.find(item => item.row.RecordId === row.RecordId);
    assert.deepEqual(await readFile(row.CurrentPath), original.bytes);
    await assert.rejects(access(original.row.CurrentPath));
  }
  await page.locator(`[data-select-media="${moved[0].RecordId}"]`).check();
  await page.evaluate(() => document.querySelector('media-organizer').openBulkDelete('delete'));
  assert.equal(await page.locator('#mo-bulk-delete-word').count(), 0);
  assert(await page.locator('#mo-bulk-delete-submit').isEnabled());
  await page.locator('#mo-bulk-delete-cancel').click();
  await access(moved[0].CurrentPath);
  await page.evaluate(() => document.querySelector('media-organizer').openBulkDelete('delete'));
  await page.locator('#mo-bulk-delete-submit').click();
  await page.waitForFunction(id => document.querySelector('media-organizer').data.records.find(row => row.RecordId === id).Trashed, moved[0].RecordId);
  await assert.rejects(access(moved[0].CurrentPath));
  assert.deepEqual(errors, []);
  console.log('Confirmation buttons passed: review/Cancel retain files; global move verifies bytes; bulk delete works without typing.');
} finally {
  await browser?.close();
  const closed = new Promise(resolve => server.once('exit', resolve));
  server.stdin.end('stop\n'); await closed;
}
