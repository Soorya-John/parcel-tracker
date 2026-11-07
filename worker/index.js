import bundledCatalog from './catalog.json' with { type: 'json' };

const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status });
const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
export const sha = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const net = (env, ...args) => (env.__fetch || fetch)(...args);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const equal = (a, b) => { let difference = a.length ^ b.length; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return difference === 0; };
const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;

async function lock(env, name, seconds = 120) {
  const token = crypto.randomUUID();
  const result = await run(env, 'INSERT INTO locks(name,token,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at WHERE locks.expires_at < ?', name, token, Date.now() + seconds * 1000, Date.now());
  return result.meta.changes ? token : null;
}
const unlock = (env, name, token) => run(env, 'DELETE FROM locks WHERE name=? AND token=?', name, token);

async function hmac(secret, value) {
  if (!secret || secret.length < 32) throw error('Session secret is not configured', 503);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function authenticate(req, env) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  const [expires, signature] = token.split('.');
  if (!signature || !/^\d+$/.test(expires) || Number(expires) <= Date.now() || !equal(await hmac(env.SESSION_SECRET, expires), signature)) throw error('Please sign in again', 401);
}
async function login(req, env) {
  const { password } = await req.json();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const bucket = `${await sha(ip)}:${Math.floor(Date.now() / 900000)}`;
  await run(env, 'INSERT INTO auth_attempts VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1', bucket);
  if ((await first(env, 'SELECT attempts FROM auth_attempts WHERE bucket=?', bucket)).attempts > 10) throw error('Too many attempts. Try again in 15 minutes.', 429);
  if (!env.OWNER_PASSWORD_HASH) throw error('Owner authentication is not configured', 503);
  const [salt, expected] = env.OWNER_PASSWORD_HASH.split(':');
  if (typeof password !== 'string' || password.length > 256 || !salt || !expected) throw error('Invalid password', 401);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
  if (!equal(hash, expected)) throw error('Invalid password', 401);
  const expires = String(Date.now() + 12 * 3600000);
  return json({ token: `${expires}.${await hmac(env.SESSION_SECRET, expires)}`, email: env.OWNER_EMAIL });
}

export async function catalog(env, refresh = false) {
  const saved = await first(env, 'SELECT * FROM catalog WHERE id=1');
  let data = saved ? { items: JSON.parse(saved.body), fetchedAt: saved.refreshed_at } : bundledCatalog;
  if (refresh && (!saved || Date.now() - Date.parse(saved.refreshed_at) > 86400000)) {
    try {
      const response = await net(env, 'https://res.17track.net/asset/carrier/info/apicarrier.all.json', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Catalog unavailable');
      const items = await response.json();
      if (!Array.isArray(items) || items.length < 100 || !items.some(c => c._country_iso === 'IN') || items.some(c => !Number.isInteger(c.key) || !c._name)) throw new Error('Invalid catalog');
      data = { items, fetchedAt: now() };
      await run(env, 'INSERT INTO catalog VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,refreshed_at=excluded.refreshed_at', JSON.stringify(items), data.fetchedAt);
    } catch (e) { console.warn('Catalog refresh failed; retaining last good copy:', e.message); }
  }
  return data;
}

export async function provider(env, endpoint, payload) {
  if (!env.TRACK17_KEY) throw error('17TRACK API key is not configured', 503);
  const response = await net(env, `https://api.17track.net/track/v2.4/${endpoint}`, { method: 'POST', headers: { '17token': env.TRACK17_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw error(`17TRACK temporarily unavailable (HTTP ${response.status})`, 502);
  const result = await response.json();
  if (result.code !== 0) throw error(`17TRACK request failed (${result.code})`, 502);
  return result.data;
}
function accepted(data) {
  if (data.accepted?.length) return data.accepted[0];
  const rejected = data.rejected?.[0];
  if (rejected?.error?.code === -18019901) return { ...rejected, existing: true };
  throw error(rejected?.error?.message || '17TRACK did not accept the parcel. Select a courier or supply the requested details.', 422);
}
async function register(env, parcel) {
  const lease = await lock(env, `register:${parcel.id}`);
  if (!lease) return;
  try {
    const current = await first(env, 'SELECT * FROM parcels WHERE id=?', parcel.id);
    if (current.registration === 'registered') return;
    const result = accepted(await provider(env, 'register', [{ number: current.number, ...(current.carrier ? { carrier: current.carrier } : {}), ...JSON.parse(current.extras), tag: current.id, lang: 'en' }]));
    const carrier = Number(result.carrier || current.carrier);
    if (!carrier) throw error('Courier could not be detected. Select a courier manually.', 422);
    await run(env, 'UPDATE parcels SET carrier=?,registration=\'registered\',problem=NULL,updated_at=? WHERE id=?', carrier, now(), current.id);
  } catch (e) {
    await run(env, 'UPDATE parcels SET registration=\'error\',problem=?,updated_at=? WHERE id=?', e.message, now(), parcel.id);
  } finally { await unlock(env, `register:${parcel.id}`, lease); }
}
const extraFields = ['destination_postal_code', 'destination_country', 'origin_country', 'ship_date', 'phone_number_last_4', 'phone_number', 'shipper', 'consignee', 'cpf_or_cnpj'];
function extras(input = {}) {
  const result = {};
  for (const key of extraFields) if (input[key]) result[key] = String(input[key]).trim().slice(0, 250);
  if (input.special_tracking_info) {
    const value = input.special_tracking_info;
    if (typeof value !== 'object' || !value.number_type || !value.parameter) throw error('Special tracking info needs number_type and parameter.');
    result.special_tracking_info = { number_type: String(value.number_type).slice(0, 100), parameter: String(value.parameter).slice(0, 250) };
  }
  return result;
}
async function saveParcel(req, env) {
  const input = await req.json();
  const number = String(input.number || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{5,50}$/.test(number)) throw error('Enter a tracking number of 5–50 letters, numbers or hyphens.');
  const carrier = Number(input.carrier || 0);
  if (!Number.isInteger(carrier) || carrier < 0) throw error('Invalid courier');
  if (carrier && !(await catalog(env)).items.some(c => c.key === carrier)) throw error('This courier is unsupported by 17TRACK.', 422);
  const lease = await lock(env, `save:${number}`);
  if (!lease) throw error('This number is being saved. Try again shortly to open its existing record.', 409);
  try {
  const existing = carrier ? await first(env, 'SELECT * FROM parcels WHERE number=? AND carrier=?', number, carrier) : await first(env, 'SELECT * FROM parcels WHERE number=? ORDER BY created_at LIMIT 1', number);
  if (existing) return json({ id: existing.id, reused: true });
  const id = crypto.randomUUID();
  const result = await run(env, 'INSERT OR IGNORE INTO parcels(id,number,carrier,nickname,extras,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, number, carrier, String(input.nickname || '').trim().slice(0, 100), JSON.stringify(extras(input.extras)), now(), now());
  if (!result.meta.changes) return json({ id: (await first(env, 'SELECT id FROM parcels WHERE number=? AND carrier=?', number, carrier)).id, reused: true });
  await register(env, { id });
  return json({ id, reused: false }, 201);
  } finally { await unlock(env, `save:${number}`, lease); }
}
async function correctParcel(req, env, id) {
  const parcel = await first(env, 'SELECT * FROM parcels WHERE id=?', id);
  if (!parcel) throw error('Parcel not found', 404);
  const input = await req.json();
  const carrier = Number(input.carrier);
  if (!Number.isInteger(carrier) || !carrier || !(await catalog(env)).items.some(c => c.key === carrier)) throw error('Choose a supported courier', 422);
  const existing = await first(env, 'SELECT id FROM parcels WHERE number=? AND carrier=? AND id<>?', parcel.number, carrier, id);
  if (existing) return json({ id: existing.id, reused: true });
  const lease = await lock(env, `register:${id}`);
  if (!lease) throw error('This parcel is being updated. Try again shortly.', 409);
  try {
    if (parcel.registration === 'registered') {
      if (Object.keys(extras(input.extras)).length) accepted(await provider(env, 'changeinfo', [{ number: parcel.number, carrier: parcel.carrier, items: extras(input.extras) }]));
      if (carrier !== parcel.carrier) accepted(await provider(env, 'changecarrier', [{ number: parcel.number, carrier_old: parcel.carrier, carrier_new: carrier }]));
    }
    await run(env, 'UPDATE parcels SET carrier=?,extras=?,problem=NULL,stopped=0,updated_at=? WHERE id=?', carrier, JSON.stringify({ ...JSON.parse(parcel.extras), ...extras(input.extras) }), now(), id);
  } finally { await unlock(env, `register:${id}`, lease); }
  if (parcel.registration !== 'registered') await register(env, { id });
  return json({ id });
}

function eventTime(event) {
  const value = event.time_utc || event.time_iso;
  // Never interpret an unzoned courier-local time as IST or the server's timezone.
  return value && /(Z|[+-]\d\d:\d\d)$/.test(value) && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : `raw:${[event.time_raw?.date, event.time_raw?.time].filter(Boolean).join(' ') || value || 'Time unavailable'}`;
}
function location(event) {
  if (event.location) return typeof event.location === 'string' ? event.location : JSON.stringify(event.location);
  return [event.address?.city, event.address?.state, event.address?.country].filter(Boolean).join(', ');
}
export async function ingest(env, item) {
  const parcel = await first(env, 'SELECT * FROM parcels WHERE number=? AND (carrier=? OR (carrier=0 AND id=?))', String(item.number).toUpperCase(), Number(item.carrier), item.tag || '');
  if (!parcel || !item.track_info) return;
  const info = item.track_info;
  const timestamp = now();
  const statements = [];
  const providers = info.tracking?.providers || [];
  for (const source of providers) {
    for (const event of source.events || []) {
      const time = eventTime(event), place = location(event), status = event.stage || event.sub_status || 'Update';
      const description = event.description || event.description_translation?.description || '';
      const fingerprint = await sha(JSON.stringify([parcel.id, source.provider?.key || '', time, status, description, place]));
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO scans(parcel_id,fingerprint,time,status,description,location,received_at) VALUES(?,?,?,?,?,?,?)').bind(parcel.id, fingerprint, time, status, description, place, timestamp));
    }
  }
  const status = info.latest_status?.status || parcel.status;
  // Delivery is sticky: a delayed in-transit webhook must not reopen the parcel.
  const delivered = status === 'Delivered';
  if (delivered && !providers.some(p => p.events?.some(e => e.stage === 'Delivered' || String(e.sub_status).startsWith('Delivered')))) {
    const event = info.latest_event || {};
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO scans(parcel_id,fingerprint,time,status,description,location,received_at) VALUES(?,?,?,?,?,?,?)').bind(parcel.id, await sha(`${parcel.id}:delivery`), eventTime(event), 'Delivered', event.description || 'Delivered', location(event), timestamp));
  }
  const times = providers.flatMap(p => (p.events || []).map(eventTime)).filter(t => !t.startsWith('raw:'));
  const statusAt = [eventTime(info.latest_event || {}), ...times].filter(t => !t.startsWith('raw:')).sort().at(-1) || parcel.status_at;
  const tips = providers.map(p => p.provider_tips).filter(Boolean);
  statements.push(env.DB.prepare('UPDATE parcels SET status=CASE WHEN delivered=1 THEN status WHEN ?=1 OR status_at<=? THEN ? ELSE status END, status_at=MAX(status_at,?),delivered=MAX(delivered,?),updated_at=?,problem=? WHERE id=?').bind(delivered ? 1 : 0, statusAt, status, statusAt, delivered ? 1 : 0, timestamp, tips.length ? JSON.stringify(tips).slice(0, 2000) : null, parcel.id));
  // D1 batch is transactional: never acknowledge a partial webhook.
  await env.DB.batch(statements);
}
async function webhook(req, env) {
  if (!env.TRACK17_KEY) throw error('Webhook is not configured', 503);
  const raw = await req.text();
  if (raw.length > 2000000) throw error('Webhook too large', 413);
  const signature = req.headers.get('sign') || '';
  if (!equal(await sha(`${raw}/${env.TRACK17_KEY}`), signature.toLowerCase())) throw error('Invalid webhook signature', 401);
  const body = JSON.parse(raw);
  if (body.event === 'TRACKING_UPDATED') {
    for (const item of body.data.accepted || [body.data]) await ingest(env, item);
  } else if (body.event === 'TRACKING_STOPPED') {
    await run(env, 'UPDATE parcels SET problem=? WHERE number=? AND carrier=? AND delivered=0', '17TRACK stopped updates before delivery. Check the carrier and registration in your 17TRACK account; retrack there if needed.', body.data.number, body.data.carrier);
  }
  return json({ code: 0 });
}

export async function digest(env) {
  const lease = await lock(env, 'digest', 180);
  if (!lease) return;
  try {
    let outbox = await first(env, "SELECT * FROM digests WHERE state='pending'");
    if (!outbox) {
      const scans = await rows(env, 'SELECT s.*,p.number,p.nickname,p.carrier FROM scans s JOIN parcels p ON p.id=s.parcel_id WHERE s.digest_id IS NULL ORDER BY s.id');
      if (!scans.length) return;
      const id = crypto.randomUUID();
      const text = scans.map(s => `${s.nickname || s.number} · ${s.number}\n${s.status} — ${s.description}\n${s.location || 'Location not supplied'} · ${formatIST(s.time)}`).join('\n\n');
      const payload = JSON.stringify({ from: env.EMAIL_FROM, to: [env.OWNER_EMAIL], subject: `Parcel · ${scans.length} new tracking update${scans.length === 1 ? '' : 's'}`, text: `${text}\n\nAll times IST when timezone is supplied. Scan freshness depends on the courier and 17TRACK.` });
      await env.DB.batch([env.DB.prepare('INSERT INTO digests(id,payload,created_at) VALUES(?,?,?)').bind(id, payload, now()), ...scans.map(s => env.DB.prepare('UPDATE scans SET digest_id=? WHERE id=? AND digest_id IS NULL').bind(id, s.id))]);
      outbox = await first(env, 'SELECT * FROM digests WHERE id=?', id);
    }
    // Resend retains keys for 24h. Ambiguous sends must not be blindly retried after that window.
    if (outbox.first_attempt && Date.now() - Date.parse(outbox.first_attempt) >= 23 * 3600000) {
      await run(env, 'UPDATE digests SET error=? WHERE id=?', 'Retry paused: idempotency window nearly expired. Reconcile delivery in Resend before manually resolving this outbox.', outbox.id);
      return;
    }
    if (!env.RESEND_KEY) { await run(env, 'UPDATE digests SET error=? WHERE id=?', 'Resend key is not configured', outbox.id); return; }
    await run(env, 'UPDATE digests SET first_attempt=COALESCE(first_attempt,?) WHERE id=?', now(), outbox.id);
    try {
      const response = await net(env, 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `parcel-digest/${outbox.id}` }, body: outbox.payload, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      const result = await response.json();
      if (!result.id) throw new Error('Resend did not acknowledge an email ID');
      await run(env, "UPDATE digests SET state='sent',sent_at=?,provider_id=?,error=NULL WHERE id=?", now(), result.id, outbox.id);
    } catch (e) { await run(env, 'UPDATE digests SET error=? WHERE id=?', e.message, outbox.id); }
  } finally { await unlock(env, 'digest', lease); }
}
export function formatIST(time) {
  if (time.startsWith('raw:')) return `${time.slice(4)} (courier local time; timezone unavailable)`;
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time)) + ' IST';
}
export async function maintenance(env) {
  await catalog(env, true);
  for (const parcel of await rows(env, "SELECT * FROM parcels WHERE registration <> 'registered' AND delivered=0")) await register(env, parcel);
  const active = await rows(env, "SELECT * FROM parcels WHERE registration='registered' AND delivered=0");
  for (let i = 0; i < active.length; i += 40) {
    try {
      const data = await provider(env, 'gettrackinfo', active.slice(i, i + 40).map(p => ({ number: p.number, carrier: p.carrier })));
      for (const item of data.accepted || []) await ingest(env, item);
    } catch (e) { console.warn('Tracking reconciliation failed:', e.message); }
  }
  for (const parcel of await rows(env, "SELECT * FROM parcels WHERE delivered=1 AND stopped=0 AND registration='registered'")) {
    try { accepted(await provider(env, 'stoptrack', [{ number: parcel.number, carrier: parcel.carrier }])); await run(env, 'UPDATE parcels SET stopped=1 WHERE id=?', parcel.id); }
    catch (e) { console.warn('Stop tracking will retry:', e.message); }
  }
  await run(env, 'DELETE FROM auth_attempts WHERE bucket NOT LIKE ?', `%:${Math.floor(Date.now() / 900000)}`);
}
async function route(req, env) {
  const path = new URL(req.url).pathname;
  if (req.method === 'POST' && path === '/api/webhook') return webhook(req, env);
  if (req.method === 'POST' && path === '/api/login') return login(req, env);
  await authenticate(req, env);
  if (path === '/api/me' && req.method === 'GET') return json({ email: env.OWNER_EMAIL });
  if (path === '/api/carriers' && req.method === 'GET') {
    const data = await catalog(env);
    return json({ fetchedAt: data.fetchedAt, items: data.items.map(c => ({ id: c.key, name: c._name, country: c._country_iso })) });
  }
  if (path === '/api/parcels' && req.method === 'GET') return json(await rows(env, 'SELECT id,number,carrier,nickname,status,delivered,registration,problem,created_at,updated_at FROM parcels ORDER BY delivered, updated_at DESC'));
  if (path === '/api/parcels' && req.method === 'POST') return saveParcel(req, env);
  const match = path.match(/^\/api\/parcels\/([\w-]+)$/);
  if (match && req.method === 'PATCH') return correctParcel(req, env, match[1]);
  if (match && req.method === 'GET') {
    const parcel = await first(env, 'SELECT id,number,carrier,nickname,status,delivered,registration,problem,created_at,updated_at FROM parcels WHERE id=?', match[1]);
    if (!parcel) throw error('Parcel not found', 404);
    return json({ ...parcel, scans: await rows(env, 'SELECT time,status,description,location FROM scans WHERE parcel_id=? ORDER BY CASE WHEN time LIKE \'raw:%\' THEN received_at ELSE time END DESC,id DESC', parcel.id) });
  }
  if (path === '/api/health' && req.method === 'GET') return json({ lastDigest: await first(env, 'SELECT id,state,created_at,sent_at,error FROM digests ORDER BY created_at DESC LIMIT 1') });
  throw error('Not found', 404);
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim());
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (origin && allowed.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '600' });
    let response;
    try {
      if (origin && !allowed.includes(origin)) throw error('Origin is not allowed', 403);
      if (req.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else response = await route(req, env);
    } catch (e) {
      if (!e.status) console.error('Request failed:', e.message);
      response = json({ error: e.status ? e.message : 'Unable to complete the request. Please try again.' }, e.status || 500);
    }
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
    return result;
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => { try { await maintenance(env); } finally { await digest(env); } })());
  }
};
