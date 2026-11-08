import { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { LocalDatabase } from './database.js';
import { DesktopService } from './service.js';

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.PARCEL_DATA_DIR) app.setPath('userData', process.env.PARCEL_DATA_DIR);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window, tray, quitting = false, service, timer;
const fields = ['TRACK17_KEY', 'RESEND_KEY', 'OWNER_EMAIL', 'EMAIL_FROM'];
app.whenReady().then(async () => {
if (locked) {
  app.setAppUserModelId('com.parceltracker.desktop');
  const secretsPath = join(app.getPath('userData'), 'settings.enc');
  let settings = {};
  let settingsError = null;
  try { if (existsSync(secretsPath)) settings = JSON.parse(safeStorage.decryptString(readFileSync(secretsPath))); }
  catch { settingsError = 'Windows could not decrypt saved settings. Enter your API keys again.'; }
  const DB = new LocalDatabase(join(app.getPath('userData'), 'parcels.sqlite'));
  service = new DesktopService(DB, settings);
  const validSender = event => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender');
  };
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => { validSender(event); return fn(...args); });
  handle('parcel:request', (path, options) => service.request(path, options));
  handle('parcel:settings', () => ({ configured: !!settings.TRACK17_KEY, hasResend: !!settings.RESEND_KEY, OWNER_EMAIL: settings.OWNER_EMAIL || '', EMAIL_FROM: settings.EMAIL_FROM || '', launchAtLogin: !!settings.launchAtLogin, settingsError, ...service.status, platform: 'windows' }));
  handle('parcel:save-settings', input => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable. Settings were not saved.');
    const next = { ...settings };
    for (const field of fields) if (typeof input[field] === 'string') {
      if (input[field].length > 1000) throw new Error('Setting is too long');
      if (!field.endsWith('_KEY') || input[field].trim()) next[field] = input[field].trim();
    }
    if (typeof input.launchAtLogin === 'boolean') next.launchAtLogin = input.launchAtLogin;
    writeFileSync(secretsPath + '.tmp', safeStorage.encryptString(JSON.stringify(next)));
    renameSync(secretsPath + '.tmp', secretsPath);
    settings = next; settingsError = null; service.configure(next);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!next.launchAtLogin, args: ['--hidden'] });
    return { saved: true };
  });
  handle('parcel:sync', () => service.sync());
  handle('parcel:backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: `parcel-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Parcel backup', extensions: ['json'] }] });
    if (canceled) return false;
    const data = { format: 'parcel-backup-v1', tables: {} };
    for (const table of ['parcels', 'scans', 'catalog', 'digests']) data.tables[table] = DB.prepare(`SELECT * FROM ${table}`).all().results;
    writeFileSync(filePath, JSON.stringify(data, null, 2)); return true;
  });
  handle('parcel:restore', async () => {
    if (service.pending) throw new Error('Wait for tracking refresh to finish before restoring.');
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { filters: [{ name: 'Parcel backup', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled) return false;
    const data = JSON.parse(readFileSync(filePaths[0], 'utf8'));
    if (data.format !== 'parcel-backup-v1' || !data.tables) throw new Error('Invalid Parcel backup');
    const statements = [];
    for (const table of ['scans', 'parcels', 'catalog', 'digests']) statements.push(DB.prepare(`DELETE FROM ${table}`));
    for (const table of ['parcels', 'scans', 'catalog', 'digests']) {
      const columns = DB.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!Array.isArray(data.tables[table])) throw new Error('Incomplete backup');
      for (const row of data.tables[table]) {
        if (Object.keys(row).some(key => !columns.includes(key))) throw new Error('Invalid backup columns');
        const keys = Object.keys(row);
        statements.push(DB.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(k => row[k])));
      }
    }
    const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0, message: 'Replace all local parcels and history with this backup?', detail: 'Export a backup first if you want to keep current records. API settings remain unchanged.' });
    if (answer.response !== 1) return false;
    DB.batch(statements); return true;
  });
  function show() { window.show(); window.focus(); }
  window = new BrowserWindow({ width: 1260, height: 850, minWidth: 720, minHeight: 560, show: false, title: 'Parcel', backgroundColor: '#f8faf4', webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'"] } }));
  await window.loadFile(join(here, '../dist/index.html'));
  if (!process.argv.includes('--hidden')) show();
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 62; pixels[i + 1] = 101; pixels[i + 2] = 75; pixels[i + 3] = 255; }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
  tray.setToolTip('Parcel — tracking runs while in tray');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Parcel', click: show }, { label: 'Refresh tracking', click: () => service.sync().catch(() => {}) }, { type: 'separator' }, { label: 'Quit Parcel', click: () => app.quit() }]));
  tray.on('double-click', show);
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  app.on('second-instance', show);
  timer = setInterval(() => service.sync().catch(() => {}), 2 * 3600000);
  if (settings.TRACK17_KEY) service.sync().catch(() => {});
  app.on('before-quit', () => { quitting = true; clearInterval(timer); });
  app.on('will-quit', () => DB.close());
}
}).catch(error => { console.error(error); dialog.showErrorBox('Parcel could not start', error.message); app.quit(); });
