import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import worker, { sha } from '../worker/index.js';
export const password = 'test-owner-password-123';
export async function harness() {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: ['DB'], compatibilityDate: '2026-07-01' }));
  const DB = await mf.getD1Database('DB');
  const migration = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  await DB.exec(migration.replace(/^--.*$/gm, '').replace(/\n/g, ' '));
  const calls = [], mail = [], responses = new Map();
  let mailFailure = false, catalogFailure = true;
  const env = {
    DB, ALLOWED_ORIGIN: 'http://127.0.0.1:5173,http://localhost:5173,https://owner.github.io',
    SESSION_SECRET: 'test-session-secret-that-is-at-least-32-chars',
    OWNER_PASSWORD_HASH: `test-salt:${pbkdf2Sync(password, 'test-salt', 100000, 32, 'sha256').toString('hex')}`,
    OWNER_EMAIL: 'owner@example.com', EMAIL_FROM: 'Parcel <parcels@example.com>', TRACK17_KEY: 'fake-provider-key', RESEND_KEY: 'fake-resend-key',
    __fetch: async (url, options = {}) => {
      const endpoint = new URL(url).pathname.split('/').at(-1);
      if (url.includes('api.resend.com')) {
        mail.push({ ...options, payload: JSON.parse(options.body) });
        if (mailFailure) return new Response('failure', { status: 503 });
        return Response.json({ id: 'email-test-id' });
      }
      if (url.includes('res.17track.net')) {
        if (catalogFailure) return new Response('failure', { status: 503 });
        return Response.json(JSON.parse(await readFile(new URL('../worker/catalog.json', import.meta.url), 'utf8')).items);
      }
      const payload = JSON.parse(options.body); calls.push({ endpoint, payload });
      if (responses.has(endpoint)) return Response.json(responses.get(endpoint));
      if (endpoint === 'gettrackinfo') return Response.json({ code: 0, data: { accepted: [] } });
      return Response.json({ code: 0, data: { accepted: payload.map(p => ({ ...p, carrier: p.carrier || p.carrier_new || 100003 })), rejected: [] } });
    }
  };
  async function request(path, { method = 'GET', body, token, origin } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    const response = await worker.fetch(new Request(`https://worker.example/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function signIn() { const result = await request('/login', { method: 'POST', body: { password } }); if (result.status !== 200) throw new Error(JSON.stringify(result)); return result.data.token; }
  async function hook(item, signature = true) {
    const body = JSON.stringify({ event: 'TRACKING_UPDATED', data: item });
    return worker.fetch(new Request('https://worker.example/api/webhook', { method: 'POST', headers: { sign: signature ? await sha(`${body}/${env.TRACK17_KEY}`) : 'wrong' }, body }), env);
  }
  return { mf, env, DB, calls, mail, responses, request, signIn, hook, setMailFailure: value => { mailFailure = value; }, setCatalogFailure: value => { catalogFailure = value; }, close: () => mf.dispose() };
}
export function tracking(number, status = 'InTransit', events, carrier = 100003) {
  events ||= [{ time_utc: '2026-11-08T04:30:00Z', stage: status, description: status === 'Delivered' ? 'Delivered to recipient' : 'Arrived at sorting centre', location: 'Mumbai' }];
  return { number, carrier, track_info: { latest_status: { status }, latest_event: events[0], tracking: { providers: [{ provider: { key: carrier }, events }] } } };
}
