import { Capacitor, registerPlugin } from '@capacitor/core';
import worker, { maintenance, digest } from '../worker/index.js';
import schema from '../migrations/0001_initial.sql?raw';

if (Capacitor.getPlatform() === 'android') {
  const native = registerPlugin('ParcelStore');
  let environment, pending, restoring = false;
  const status = { lastSync: null, syncError: null };
  const ready = (async () => {
    await native.initialize({ schema });
    const config = await native.readSettings();
    const DB = {
      prepare(sql) {
        let args = [];
        const statement = {
          descriptor: () => ({ sql, args }),
          bind(...values) { args = values; return statement; },
          async first() { return (await native.query({ sql, args })).results[0] || null; },
          all: () => native.query({ sql, args }),
          run: () => native.execute({ sql, args })
        };
        return statement;
      },
      batch: statements => native.batch({ statements: statements.map(s => s.descriptor()) })
    };
    environment = {
      DB, DESKTOP: true, ...config,
      SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      async __fetch(url, options = {}) {
        const result = await native.http({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null });
        return new Response(result.body, { status: result.status, headers: result.headers });
      }
    };
  })();
  async function sync() {
    await ready;
    if (restoring) throw new Error('Finish restoring your backup before refreshing tracking.');
    if (pending) return pending;
    pending = (async () => {
      if (!environment.TRACK17_KEY) throw new Error('Add your 17TRACK API key in Settings to check live tracking.');
      await maintenance(environment);
      if (environment.RESEND_KEY && environment.OWNER_EMAIL && environment.EMAIL_FROM) await digest(environment);
      status.lastSync = new Date().toISOString(); status.syncError = null;
      return status;
    })().catch(error => { status.syncError = error.message; throw error; }).finally(() => { pending = null; });
    return pending;
  }
  window.parcelDesktop = {
    async request(path, options = {}) {
      await ready;
      if (!/^\/(parcels(?:\/[\w-]+)?|carriers|health)$/.test(path) || !['GET', 'POST', 'PATCH'].includes(options.method || 'GET')) throw new Error('Unsupported request');
      const expires = String(Date.now() + 60000);
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(environment.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(expires)))].map(n => n.toString(16).padStart(2, '0')).join('');
      const response = await worker.fetch(new Request(`https://desktop.local/api${path}`, { method: options.method || 'GET', body: options.body, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${expires}.${signature}` } }), environment);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    },
    async settings() {
      await ready;
      return { configured: !!environment.TRACK17_KEY, hasResend: !!environment.RESEND_KEY, OWNER_EMAIL: environment.OWNER_EMAIL || '', EMAIL_FROM: environment.EMAIL_FROM || '', ...status, platform: 'android' };
    },
    async saveSettings(input) {
      await ready;
      const next = {};
      for (const field of ['TRACK17_KEY', 'RESEND_KEY', 'OWNER_EMAIL', 'EMAIL_FROM']) {
        if (typeof input[field] === 'string') {
          if (input[field].length > 1000) throw new Error('Setting is too long');
          if (!field.endsWith('_KEY') || input[field].trim()) next[field] = input[field].trim();
        }
      }
      const saved = await native.saveSettings({ settings: next });
      Object.assign(environment, saved);
      return { saved: true };
    },
    sync,
    async backup() { await ready; return (await native.backup()).saved; },
    async restore() {
      await ready;
      if (pending) throw new Error('Wait for tracking refresh to finish before restoring.');
      restoring = true;
      try { return (await native.restore()).restored; } finally { restoring = false; }
    }
  };
  let lastAutomatic = 0;
  const automatic = async () => {
    await ready;
    if (environment.TRACK17_KEY && Date.now() - lastAutomatic > 15 * 60000) { lastAutomatic = Date.now(); sync().catch(() => {}); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) automatic(); });
  setInterval(() => { if (!document.hidden) automatic(); }, 2 * 3600000);
  automatic();
}
