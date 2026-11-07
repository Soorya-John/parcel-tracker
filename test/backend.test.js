import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, tracking } from './harness.mjs';
import { digest, maintenance, catalog } from '../worker/index.js';

test('private D1 records survive a fresh login; duplicate numbers reuse registration; delivered records remain searchable', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/parcels')).status, 401);
    assert.equal((await h.request('/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
    const token = await h.signIn();
    assert.equal((await h.request('/parcels', { token, origin: 'https://evil.example' })).status, 403);
    assert.equal((await h.request('/parcels', { token, origin: 'https://owner.github.io' })).headers.get('Access-Control-Allow-Origin'), 'https://owner.github.io');
    const saved = await h.request('/parcels', { token, method: 'POST', body: { number: 'TEST123456', carrier: 100003, nickname: 'Desk upgrade' } });
    assert.equal(saved.status, 201);
    const duplicate = await h.request('/parcels', { token, method: 'POST', body: { number: 'test123456', carrier: 100003 } });
    assert.equal(duplicate.data.id, saved.data.id); assert.equal(duplicate.data.reused, true);
    assert.equal(h.calls.filter(c => c.endpoint === 'register').length, 1);
    await h.hook(tracking('TEST123456', 'Delivered'));
    const freshToken = await h.signIn();
    const list = await h.request('/parcels', { token: freshToken });
    assert.equal(list.data.length, 1); assert.equal(list.data[0].nickname, 'Desk upgrade'); assert.equal(list.data[0].delivered, 1);
    const opened = await h.request(`/parcels/${saved.data.id}`, { token: freshToken });
    assert.equal(opened.data.scans[0].status, 'Delivered');
    assert.ok(JSON.stringify(list.data).includes('TEST123456'));
  } finally { await h.close(); }
});

test('signed duplicate webhooks store each scan once; location changes produce updates; empty digests send nothing', async () => {
  const h = await harness();
  try {
    const token = await h.signIn();
    const saved = await h.request('/parcels', { token, method: 'POST', body: { number: 'TEST234567', carrier: 100003 } });
    const item = tracking('TEST234567');
    assert.equal((await h.hook(item, false)).status, 401);
    assert.equal((await h.hook(item)).status, 200); await h.hook(item);
    assert.equal((await h.request(`/parcels/${saved.data.id}`, { token })).data.scans.length, 1);
    await digest(h.env); assert.equal(h.mail.length, 1); assert.match(h.mail[0].payload.text, /Mumbai/); assert.match(h.mail[0].payload.text, /IST/);
    await digest(h.env); assert.equal(h.mail.length, 1);
    item.track_info.tracking.providers[0].events[0].location = 'Bengaluru';
    await h.hook(item); await digest(h.env);
    assert.equal(h.mail.length, 2); assert.match(h.mail[1].payload.text, /Bengaluru/);
  } finally { await h.close(); }
});

test('failed email retries use immutable payload and key; new scans go to next digest; final alert survives delivery and stop retries', async () => {
  const h = await harness();
  try {
    const token = await h.signIn();
    await h.request('/parcels', { token, method: 'POST', body: { number: 'TEST345678', carrier: 100003 } });
    await h.hook(tracking('TEST345678'));
    h.setMailFailure(true); await digest(h.env);
    assert.equal((await h.DB.prepare('SELECT state FROM digests').first()).state, 'pending');
    await h.hook(tracking('TEST345678', 'Delivered', [{ time_utc: '2026-11-09T05:00:00Z', stage: 'Delivered', description: 'Delivered to recipient', location: 'Kochi' }]));
    h.setMailFailure(false); await digest(h.env);
    assert.equal(h.mail[0].body, h.mail[1].body); assert.equal(h.mail[0].headers['Idempotency-Key'], h.mail[1].headers['Idempotency-Key']);
    h.responses.set('stoptrack', { code: 0, data: { rejected: [{ error: { message: 'Temporary failure' } }] } });
    await maintenance(h.env); assert.equal((await h.DB.prepare('SELECT stopped FROM parcels').first()).stopped, 0);
    h.responses.delete('stoptrack'); await maintenance(h.env);
    assert.equal((await h.DB.prepare('SELECT stopped FROM parcels').first()).stopped, 1);
    await digest(h.env); assert.equal(h.mail.length, 3); assert.match(h.mail[2].payload.text, /Delivered to recipient/);
    await h.hook(tracking('TEST345678')); await digest(h.env); assert.equal(h.mail.length, 3);
    assert.equal((await h.DB.prepare('SELECT status FROM parcels').first()).status, 'Delivered');
    assert.ok(!h.calls.some(c => c.endpoint === 'gettrackinfo' && c.payload.some(p => p.number === 'TEST345678')));
  } finally { await h.close(); }
});

test('catalog contains all official Indian couriers; invalid refresh retains last good copy; unsupported and extra-info errors are actionable', async () => {
  const h = await harness();
  try {
    const initial = await catalog(h.env, true); assert.ok(initial.items.filter(c => c._country_iso === 'IN').length >= 90);
    h.setCatalogFailure(false); const good = await catalog(h.env, true);
    await h.DB.prepare("UPDATE catalog SET refreshed_at='2000-01-01T00:00:00Z'").run();
    h.setCatalogFailure(true); const fallback = await catalog(h.env, true); assert.deepEqual(fallback.items, good.items);
    const token = await h.signIn();
    assert.equal((await h.request('/parcels', { token, method: 'POST', body: { number: 'TEST456789', carrier: 999999999 } })).status, 422);
    h.responses.set('register', { code: 0, data: { accepted: [], rejected: [{ error: { code: -18010019, message: 'Destination postal code is required' } }] } });
    const result = await h.request('/parcels', { token, method: 'POST', body: { number: 'TEST456789', carrier: 100003 } });
    const parcel = await h.request(`/parcels/${result.data.id}`, { token }); assert.match(parcel.data.problem, /postal code/);
    h.responses.delete('register');
    await h.request(`/parcels/${result.data.id}`, { token, method: 'PATCH', body: { carrier: 100003, extras: { destination_postal_code: '682001', special_tracking_info: { number_type: 'reference', parameter: '123' } } } });
    const last = h.calls.filter(c => c.endpoint === 'register').at(-1).payload[0]; assert.equal(last.destination_postal_code, '682001'); assert.equal(last.special_tracking_info.parameter, '123');
  } finally { await h.close(); }
});

test('auto-detection reuses resolved record; manual correction reuses provider registration; stopped-before-delivery is visible', async () => {
  const h = await harness();
  try {
    const token = await h.signIn();
    const saved = await h.request('/parcels', { token, method: 'POST', body: { number: 'AUTO123456' } });
    const duplicate = await h.request('/parcels', { token, method: 'POST', body: { number: 'AUTO123456', carrier: 100003 } });
    assert.equal(saved.data.id, duplicate.data.id);
    const changed = await h.request(`/parcels/${saved.data.id}`, { token, method: 'PATCH', body: { carrier: 3011 } }); assert.equal(changed.status, 200);
    assert.equal(h.calls.filter(c => c.endpoint === 'register').length, 1); assert.equal(h.calls.filter(c => c.endpoint === 'changecarrier').length, 1);
    const { sha } = await import('../worker/index.js');
    const worker = (await import('../worker/index.js')).default;
    const body = JSON.stringify({ event: 'TRACKING_STOPPED', data: { number: 'AUTO123456', carrier: 3011 } });
    await worker.fetch(new Request('https://worker.example/api/webhook', { method: 'POST', headers: { sign: await sha(`${body}/${h.env.TRACK17_KEY}`) }, body }), h.env);
    assert.match((await h.request(`/parcels/${saved.data.id}`, { token })).data.problem, /stopped updates/);
  } finally { await h.close(); }
});

test('ambiguous email is held before idempotency expiry; concurrent digest runs cannot duplicate sends', async () => {
  const h = await harness();
  try {
    const token = await h.signIn(); await h.request('/parcels', { token, method: 'POST', body: { number: 'HOLD123456', carrier: 100003 } });
    await h.hook(tracking('HOLD123456')); h.setMailFailure(true);
    await Promise.all([digest(h.env), digest(h.env)]); assert.equal(h.mail.length, 1);
    await h.DB.prepare("UPDATE digests SET first_attempt='2000-01-01T00:00:00Z'").run();
    h.setMailFailure(false); await digest(h.env); assert.equal(h.mail.length, 1);
    assert.match((await h.DB.prepare('SELECT error FROM digests').first()).error, /Reconcile/);
  } finally { await h.close(); }
});
