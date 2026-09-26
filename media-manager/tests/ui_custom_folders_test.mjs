// Full selection -> review -> custom-folder move workflow, using generated temporary clips.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn('python', ['-m', 'tests.ui_fixture_server'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let browser;
try {
  const fixture = await new Promise((resolve, reject) => {
    createInterface({ input: server.stdout }).once('line', line => resolve(JSON.parse(line)));
    server.once('exit', code => reject(new Error(`Fixture exited: ${code}`)));
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Add custom folder', exact: true }).click();
  await page.getByLabel('Folder name').fill('Favorites');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#mo-custom-dialog').open);
  await page.getByLabel('Source folder', { exact: true }).fill(fixture.source);
  await page.getByLabel('Destination folder', { exact: true }).fill(fixture.destination);
  await page.getByRole('button', { name: 'Scan & preview' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mo-media-card').length === 3);
  await page.locator('[data-select-media]').first().check();
  await page.locator('[data-year="2020"]').click();
  assert.match(await page.locator('#mo-selection-count').innerText(), /1 selected.*1 hidden/);
  await page.getByRole('button', { name: 'Select matching clips', exact: true }).click();
  assert.match(await page.locator('#mo-selection-count').innerText(), /2 selected.*1 hidden/);
  const before = await page.evaluate(() => {
    const ui = document.querySelector('media-organizer');
    return ui.data.records.map(row => ({ id: row.RecordId, path: row.CurrentPath, selected: ui.selected.has(row.RecordId) }));
  });
  await page.locator('#mo-sort-custom').click();
  await page.getByRole('button', { name: 'Preview selected move', exact: true }).click();
  await page.getByRole('heading', { name: 'Review 2 selected moves' }).waitFor();
  assert.equal(await page.locator('.mo-custom-preview-item').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Move selected clips', exact: true }).isEnabled(), false);
  for (const row of before) await access(row.path); // Preview has moved nothing.
  await mkdir('test-work/ui-qa', { recursive: true });
  await page.screenshot({ path: 'test-work/ui-qa/custom-folder-preview.png' });
  await page.getByLabel('Type MOVE to confirm', { exact: true }).fill('MOVE');
  await page.getByRole('button', { name: 'Move selected clips', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#mo-library-title').textContent.startsWith('Favorites') && document.querySelectorAll('.mo-media-card').length === 2);
  assert.equal(await page.locator('#mo-selection-count').innerText(), '0 selected');
  for (const row of before) {
    if (row.selected) await assert.rejects(access(row.path)); else await access(row.path);
  }
  for (const image of await page.locator('#mo-results img').all()) {
    await image.scrollIntoViewIfNeeded(); await image.evaluate(img => img.decode());
  }
  await page.screenshot({ path: 'test-work/ui-qa/custom-folder-library.png', fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.mo-media-card').length === 2);
  assert.match(await page.locator('#mo-library-title').innerText(), /Favorites/);
  await page.locator('[data-select-media]').first().check();
  await page.locator('#mo-sort-custom').click();
  await page.getByRole('button', { name: 'Add another folder' }).click();
  await page.getByLabel('Folder name').fill('Travel');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'Preview selected move', exact: true }).click();
  await page.getByRole('heading', { name: 'Review 1 selected moves' }).waitFor();
  assert.match(await page.locator('.mo-custom-preview-item').innerText(), /Favorites/i);
  await page.getByLabel('Type MOVE to confirm', { exact: true }).fill('MOVE');
  await page.getByRole('button', { name: 'Move selected clips', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#mo-library-title').textContent.startsWith('Travel') && document.querySelectorAll('.mo-media-card').length === 1);
  await page.locator('[data-custom-filter=""]').click();
  assert.equal(await page.locator('.mo-media-card').count(), 3);
  await page.getByRole('button', { name: 'Select matching clips', exact: true }).click();
  assert.equal(await page.locator('#mo-selection-count').innerText(), '3 selected');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  assert.equal(await page.locator('#mo-selection-count').innerText(), '0 selected');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-work/ui-qa/custom-folder-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Custom folder browser checks passed: saved folders, selection across filters, read-only preview, confirmation, selected-only moves, real thumbnails at custom paths, refresh persistence, second custom move, folder navigation, select/clear matching clips, mobile layout.');
} finally {
  await browser?.close();
  const closed = new Promise(resolve => server.once('exit', resolve));
  server.stdin.end('stop\n'); await closed;
}
