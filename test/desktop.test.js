import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase } from '../desktop/database.js';
import { DesktopService } from '../desktop/service.js';

test('desktop SQLite persists real tracking and delivery across restarts; provider failures surface', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parcel-test-'));
  let DB = new LocalDatabase(join(dir, 'parcels.sqlite'));
  try {
    let delivered = false, fail = false;
    const calls = [];
    const settings = { TRACK17_KEY: 'test-key', __fetch: async (url, options) => {
      if (url.includes('res.17track.net')) return new Response('', { status: 503 });
      const endpoint = url.split('/').at(-1), payload = JSON.parse(options.body); calls.push(endpoint);
      if (fail) return new Response('', { status: 503 });
      if (endpoint === 'gettrackinfo') return Response.json({ code: 0, data: { accepted: payload.map(p => ({ ...p, track_info: { latest_status: { status: delivered ? 'Delivered' : 'InTransit' }, tracking: { providers: [{ provider: { key: p.carrier }, events: [{ time_utc: '2026-11-08T04:30:00Z', stage: delivered ? 'Delivered' : 'InTransit', description: delivered ? 'Delivered to recipient' : 'Sorted at hub', location: 'Mumbai' }] }] } } })) } });
      return Response.json({ code: 0, data: { accepted: payload.map(p => ({ ...p, carrier: p.carrier || 100003 })) } });
    } };
    let app = new DesktopService(DB, settings);
    assert.deepEqual(await app.request('/parcels'), []);
    const saved = await app.request('/parcels', { method: 'POST', body: JSON.stringify({ number: 'TEST12345', nickname: 'My parcel', carrier: 100003 }) });
    assert.equal(calls.filter(c => c === 'register').length, 1);
    assert.equal((await app.request('/parcels', { method: 'POST', body: JSON.stringify({ number: 'TEST12345', carrier: 100003 }) })).reused, true);
    await app.sync();
    assert.equal((await app.request(`/parcels/${saved.id}`)).scans[0].location, 'Mumbai');
    DB.close(); DB = new LocalDatabase(join(dir, 'parcels.sqlite')); app = new DesktopService(DB, settings);
    assert.equal((await app.request('/parcels'))[0].nickname, 'My parcel');
    fail = true; await assert.rejects(app.sync(), /503/); assert.match(app.status.syncError, /503/);
    fail = false; delivered = true; await app.sync();
    assert.equal((await app.request('/parcels'))[0].delivered, 1);
    assert.equal((await app.request(`/parcels/${saved.id}`)).scans.length, 2);
    assert.ok(calls.includes('stoptrack'));
    assert.throws(() => DB.batch([DB.prepare("UPDATE parcels SET nickname='bad'"), DB.prepare('INSERT INTO parcels(id) VALUES(?)').bind('invalid') ]));
    assert.equal((await app.request('/parcels'))[0].nickname, 'My parcel');
    await assert.rejects(app.request('/login'), /Unsupported/);
  } finally { DB.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unconfigured desktop fails clearly instead of simulating updates', async () => {
  const DB = new LocalDatabase(':memory:');
  try { await assert.rejects(new DesktopService(DB).sync(), /17TRACK API key/); }
  finally { DB.close(); }
});
