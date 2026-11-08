import worker, { maintenance, digest } from '../worker/index.js';
import { createHmac, randomBytes } from 'node:crypto';

export class DesktopService {
  constructor(DB, settings = {}) {
    this.env = { DB, SESSION_SECRET: randomBytes(32).toString('hex'), ...settings, DESKTOP: true };
    this.status = { lastSync: null, syncError: null };
  }
  configure(settings) { Object.assign(this.env, settings); }
  async request(path, options = {}) {
    if (!/^\/(parcels(?:\/[\w-]+)?|carriers|health)$/.test(path) || !['GET', 'POST', 'PATCH'].includes(options.method || 'GET')) throw new Error('Unsupported request');
    const expires = String(Date.now() + 60000);
    const signature = createHmac('sha256', this.env.SESSION_SECRET).update(expires).digest('hex');
    const response = await worker.fetch(new Request(`https://desktop.local/api${path}`, {
      method: options.method || 'GET', body: options.body,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${expires}.${signature}` }
    }), this.env);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  sync() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      if (!this.env.TRACK17_KEY) throw new Error('Add your 17TRACK API key in Settings to check live tracking.');
      await maintenance(this.env);
      if (this.env.RESEND_KEY && this.env.OWNER_EMAIL && this.env.EMAIL_FROM) await digest(this.env);
      this.status.lastSync = new Date().toISOString();
      this.status.syncError = null;
      return this.status;
    })().catch(e => { this.status.syncError = e.message; throw e; }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
