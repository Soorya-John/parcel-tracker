import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'parcel-electron-'));
const executablePath = process.env.PARCEL_EXE;
const errors = [];
async function launch() {
  const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env: { ...process.env, PARCEL_DATA_DIR: dir } });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: 'Saved parcels.' }).waitFor();
  return { app, page };
}
mkdirSync('test-results', { recursive: true });
let app;
try {
  let session = await launch(); app = session.app; let page = session.page;
  await page.getByRole('heading', { name: 'Your next journey starts here' }).waitFor();
  assert.equal(await page.locator('.parcel-card').count(), 0);
  await page.getByRole('button', { name: 'Refresh tracking' }).click();
  await page.getByRole('status').filter({ hasText: 'Add your 17TRACK API key' }).waitFor();
  await page.getByRole('button', { name: 'Add parcel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tracking number' }).fill('PERSIST12345');
  await page.getByRole('textbox', { name: 'Nickname' }).fill('Persistence check');
  await page.getByRole('button', { name: 'Save & track parcel' }).click();
  await page.locator('#detail[open]').waitFor();
  await page.getByText('17TRACK API key is not configured', { exact: true }).waitFor();
  await page.locator('#detail').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Settings.*Stored on this device/ }).click();
  await page.getByRole('textbox', { name: '17TRACK API key' }).fill('not-a-real-key-encryption-check');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.ok(!readFileSync(join(dir, 'settings.enc')).includes(Buffer.from('not-a-real-key-encryption-check')));
  const backupPath = join(dir, 'backup.json');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, backupPath);
  await page.getByRole('button', { name: /Settings.*Stored on this device/ }).click();
  await page.getByRole('button', { name: 'Export parcel backup' }).click();
  await page.getByRole('status').filter({ hasText: 'Backup exported.' }).waitFor();
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  assert.equal(backup.tables.parcels.length, 1);
  assert.ok(!JSON.stringify(backup).includes('not-a-real-key-encryption-check'));
  await page.getByRole('button', { name: 'Restore parcel backup' }).click();
  await page.getByRole('status').filter({ hasText: 'Backup restored.' }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await page.screenshot({ path: 'test-results/windows-app.png' });
  await app.close(); app = null;
  session = await launch(); app = session.app; page = session.page;
  await page.getByRole('button', { name: /Persistence check/ }).waitFor();
  await page.getByRole('button', { name: /Persistence check/ }).click();
  await page.locator('#detail[open]').waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.deepEqual(errors, []);
  console.log('Electron checks passed: empty first run, saved parcel, restart persistence, encrypted settings, backup/restore, tray close, isolated renderer.');
} finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
