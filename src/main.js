import './style.css';
import { demoRequest } from './demo.js';

const root = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icons = {
 box: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8M7 5.8l9 5"/>',
 grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
 arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 6 6 12 0 18-6-6-6-12 0-18Z"/>',
 truck: '<path d="M3 6h11v11H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.box}</svg>`;
const labels = { NotFound: 'Awaiting first scan', InfoReceived: 'Label created', InTransit: 'In transit', Expired: 'Tracking expired', AvailableForPickup: 'Ready for pickup', OutForDelivery: 'Out for delivery', DeliveryFailure: 'Delivery attempted', Delivered: 'Delivered', Exception: 'Needs attention' };
const label = value => labels[value] || String(value || 'Update').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const date = value => !value || value.startsWith('raw:') ? esc(value?.slice(4) || 'Time unavailable') + ' · courier timezone unavailable' : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) + ' IST';
let token = sessionStorage.getItem('parcel-session');
let demo = !token, parcels = [], carriers = [], fetchedAt, tab = 'active', query = '', selected = null, loading = false, health;
const carrierName = id => carriers.find(c => c.id === Number(id))?.name || `Courier ${id || 'not detected'}`;
const apiBase = () => (localStorage.getItem('parcel-api') || import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
async function api(path, options = {}) {
  if (demo) return demoRequest(path, options);
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) { sessionStorage.removeItem('parcel-session'); token = null; }
    throw new Error(result.error || 'Request failed');
  }
  return result;
}
function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div'); node.className = 'toast'; node.role = 'status'; node.textContent = message; document.body.append(node); setTimeout(() => node.remove(), 5500);
}
async function load() {
  try {
    [parcels, { items: carriers, fetchedAt }, health] = await Promise.all([api('/parcels'), api('/carriers'), api('/health')]);
    render();
  } catch (e) { toast(e.message); if (!token && !demo) loginDialog(); }
}
function render() {
  const active = parcels.filter(p => !p.delivered), delivered = parcels.filter(p => p.delivered);
  const found = parcels.filter(p => `${p.number} ${p.nickname} ${carrierName(p.carrier)}`.toLowerCase().includes(query.toLowerCase()));
  const visible = query ? found : tab === 'active' ? active : delivered;
  root.innerHTML = `<aside class="sidebar"><a href="./" class="brand" aria-label="Parcel home"><span class="brand-icon">${icon('box')}</span>parcel<span class="brand-dot">.</span></a><div class="workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation"><button class="nav-item ${tab === 'active' ? 'current' : ''}" data-tab="active">${icon('grid')}Saved parcels <span>${active.length}</span></button><button class="nav-item ${tab === 'delivered' ? 'current' : ''}" data-tab="delivered">${icon('archive')}Delivered archive <span>${delivered.length}</span></button></nav><div class="sidebar-bottom"><div class="india-note">${icon('globe')}<div>From anywhere.<br><strong>To your doorstep.</strong></div></div><button class="account" id="account"><span class="avatar">${demo ? 'D' : 'Y'}</span><span>${demo ? 'Demo workspace' : 'Personal workspace'}<small>${demo ? 'Explore with sample parcels' : 'Private · Single owner'}</small></span><span class="account-arrow">↗</span></button></div></aside>
  <main><header class="topbar"><span>My workspace <span class="slash">/</span> <strong>${tab === 'active' ? 'Saved parcels' : 'Delivered archive'}</strong></span><span class="private-label"><span class="live-dot"></span>${demo ? 'DEMO MODE' : 'PRIVATE WORKSPACE'}</span></header>
  <div class="content"><div class="page-heading"><div><div class="eyebrow">A LITTLE LESS WONDERING</div><h1>${tab === 'active' ? 'Saved parcels' : 'Delivered archive'}<span class="heading-dot">.</span></h1><p>${tab === 'active' ? 'Every journey, in one place. We’ll keep an eye on the way.' : 'Safely arrived. Every scan, kept for whenever you need it.'}</p></div><button class="primary" id="add">${icon('plus')} Add parcel</button></div>
  ${demo ? `<div class="demo-banner"><span>${icon('globe')} <strong>A preview of your parcel space.</strong> These are fictional parcels; demo changes stay in this browser.</span><button id="connect">Connect your account ${icon('arrow')}</button></div>` : ''}
  <section class="stats" aria-label="Parcel summary"><div class="stat"><div><span>On the way</span><strong>${active.length.toString().padStart(2, '0')}</strong><small>Good things are coming</small></div><span class="stat-icon green">${icon('truck')}</span></div><div class="stat"><div><span>Out for delivery</span><strong>${active.filter(p => p.status === 'OutForDelivery').length.toString().padStart(2, '0')}</strong><small>A little closer to home</small></div><span class="stat-icon amber">${icon('pin')}</span></div><div class="stat"><div><span>Delivered</span><strong>${delivered.length.toString().padStart(2, '0')}</strong><small>All journeys, safely saved</small></div><span class="stat-icon lavender">${icon('check')}</span></div></section>
  <section class="parcel-section"><div class="list-toolbar"><div class="tabs" role="group" aria-label="Parcel lists"><button data-tab="active" class="${tab === 'active' ? 'selected' : ''}">Active <span>${active.length}</span></button><button data-tab="delivered" class="${tab === 'delivered' ? 'selected' : ''}">Delivered <span>${delivered.length}</span></button></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search all parcels…" aria-label="Search all parcels" value="${esc(query)}"><kbd>/</kbd></label></div>
  <div class="list-caption"><span>${query ? `${visible.length} result${visible.length === 1 ? '' : 's'} across active & delivered` : tab === 'active' ? 'THE JOURNEYS IN PROGRESS' : 'THE JOURNEYS COMPLETED'}</span><span>All times in IST</span></div>
  <div class="parcel-list">${visible.length ? visible.map(card).join('') : `<div class="empty">${icon('box')}<h2>${query ? 'No parcels found' : tab === 'active' ? 'Your next journey starts here' : 'A place for happy arrivals'}</h2><p>${query ? 'Try a tracking number, courier or nickname.' : tab === 'active' ? 'Add a tracking number and we’ll take it from there.' : 'Delivered parcels will appear here with their full history.'}</p>${!query && tab === 'active' ? '<button class="primary" id="empty-add">Add your first parcel</button>' : ''}</div>`}</div></section>
  <section class="digest-note"><span class="note-icon">${icon('mail')}</span><div><strong>Less refreshing. More living.</strong><p>${demo ? 'In a connected workspace, new scans arrive in one email every two hours.' : 'New scans arrive together in one email every two hours. No updates? No email.'}</p>${health?.lastDigest?.error ? `<p class="warning">Email needs attention: ${esc(health.lastDigest.error)}</p>` : ''}</div><span class="digest-pill">${icon('clock')} 2-hour digest</span></section>
  <footer><span>${icon('globe')} India & beyond <span class="footer-dot">·</span> Tracking powered by 17TRACK</span><span>Scan freshness depends on the courier and 17TRACK.</span></footer></div></main><dialog id="modal"></dialog><dialog id="detail"></dialog>`;
  root.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { tab = el.dataset.tab; query = ''; render(); });
  root.querySelectorAll('[data-id]').forEach(el => el.onclick = () => openParcel(el.dataset.id));
  document.querySelector('#add').onclick = () => parcelDialog();
  document.querySelector('#empty-add')?.addEventListener('click', () => parcelDialog());
  document.querySelector('#connect')?.addEventListener('click', loginDialog);
  document.querySelector('#account').onclick = () => demo ? loginDialog() : accountDialog();
  document.querySelector('#search').oninput = event => { const pos = event.target.selectionStart; query = event.target.value; render(); const input = document.querySelector('#search'); input.focus(); input.setSelectionRange(pos, pos); };
}
function card(parcel) {
  const name = carrierName(parcel.carrier), badge = parcel.delivered ? 'delivered' : parcel.status === 'OutForDelivery' ? 'delivery' : 'transit';
  const latest = parcel.scans?.[0];
  return `<button class="parcel-card" data-id="${esc(parcel.id)}"><span class="courier-mark ${badge}">${icon(parcel.delivered ? 'check' : 'box')}</span><span class="parcel-info"><strong>${esc(parcel.nickname || 'Untitled parcel')}</strong><span>${esc(name)} <span class="number-dot">·</span> <span class="tracking-number">${esc(parcel.number)}</span></span></span><span class="parcel-status"><span class="badge ${badge}"><i></i>${esc(parcel.registration === 'error' ? 'Needs information' : label(parcel.status))}</span><small>${esc(parcel.problem ? 'Check courier details' : latest?.location || 'Open for scan history')}</small></span><span class="card-arrow">${icon('arrow')}</span></button>`;
}
function showDialog(id, html) {
  const dialog = document.querySelector(`#${id}`); dialog.innerHTML = html; dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(el => el.onclick = () => dialog.close());
  dialog.onclick = event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } };
  return dialog;
}
const closeButton = `<button class="close" aria-label="Close" data-close>${icon('close')}</button>`;
async function openParcel(id) {
  selected = id;
  try {
    const p = await api(`/parcels/${encodeURIComponent(id)}`);
    const dialog = showDialog('detail', `<div class="dialog-head"><div class="eyebrow">THE WHOLE JOURNEY</div>${closeButton}<h2>${esc(p.nickname || 'Your parcel')}</h2><p>${esc(carrierName(p.carrier))} · ${esc(p.number)}</p><span class="badge ${p.delivered ? 'delivered' : 'transit'}">${esc(label(p.status))}</span></div><div class="detail-body">${p.problem ? `<div class="problem">${esc(p.problem)}</div>` : ''}<div class="detail-meta"><span>${p.delivered ? 'Delivered archive · history retained' : 'Automatically updated while you’re away'}</span><button class="text-button" id="correct">Correct courier / add details</button></div><h3>Scan history <span>IST</span></h3>${p.scans.length ? `<ol class="timeline">${p.scans.map((s, i) => `<li class="${i === 0 ? 'latest' : ''}"><span class="timeline-point">${i === 0 ? icon(p.delivered ? 'check' : 'box') : ''}</span><time>${date(s.time)}</time><h4>${esc(s.description || label(s.status))}</h4><p>${icon('pin')}${esc(s.location || 'Location not supplied')}</p><small>${esc(label(s.status))}</small></li>`).join('')}</ol>` : '<div class="empty compact"><p>Waiting for the courier’s first scan. Your parcel is saved.</p></div>'}<p class="fine-print">Scan freshness depends on the courier and 17TRACK. Unzoned carrier times are labelled separately.</p></div>`);
    dialog.querySelector('#correct').onclick = () => { dialog.close(); parcelDialog(p); };
  } catch (e) { toast(e.message); }
}
function parcelDialog(parcel = null) {
  const dialog = showDialog('modal', `<div class="dialog-head">${closeButton}<div class="eyebrow">${parcel ? 'FINE-TUNE THE DETAILS' : 'MAKE ROOM FOR SOMETHING GOOD'}</div><h2>${parcel ? 'Courier details' : 'Add a parcel'}</h2><p>${demo ? 'Demo only. Use a fictional tracking number.' : 'Saved to your private account, on every device.'}</p></div><form class="form" id="parcel-form"><label>Tracking number<input name="number" required pattern="[A-Za-z0-9-]{5,50}" maxlength="50" placeholder="e.g. EE123456789IN" value="${esc(parcel?.number || '')}" ${parcel ? 'readonly' : ''}></label>${!parcel ? '<label>Nickname <span class="optional">optional</span><input name="nickname" maxlength="100" placeholder="e.g. Something from home"></label>' : ''}<div class="form-row"><label>Courier coverage<select id="coverage"><option value="IN">Indian couriers</option><option value="all">All couriers · international</option></select></label><label>Find a courier<input id="courier-search" type="search" placeholder="Search courier name"></label></div><label>Courier<select name="carrier" id="carrier"></select></label><small class="fine-print" id="catalog-note"></small><details ${parcel?.problem ? 'open' : ''}><summary>Extra tracking information</summary><p class="fine-print">Some couriers require these to retrieve scans. Use the fields requested in the courier message.</p><div class="form-row"><label>Destination postal code<input name="destination_postal_code" maxlength="30"></label><label>Destination country<input name="destination_country" maxlength="2" placeholder="IN"></label></div><div class="form-row"><label>Origin country<input name="origin_country" maxlength="2" placeholder="IN"></label><label>Shipping date<input name="ship_date" placeholder="YYYY/MM/DD"></label></div><label>Phone number (last 4 digits)<input name="phone_number_last_4" maxlength="4"></label><details><summary>Other courier-required fields</summary>${['phone_number', 'shipper', 'consignee', 'cpf_or_cnpj'].map(name => `<label>${esc(name.replaceAll('_', ' '))}<input name="${name}" maxlength="250"></label>`).join('')}<label>Special tracking information (JSON)<textarea name="special_tracking_info" placeholder='{"number_type":"...","parameter":"..."}'></textarea></label></details></details><div class="form-error" role="alert"></div><button class="primary wide" type="submit">${parcel ? 'Save courier details' : 'Save & track parcel'} ${icon('arrow')}</button></form>`);
  const coverage = dialog.querySelector('#coverage'), search = dialog.querySelector('#courier-search'), select = dialog.querySelector('#carrier');
  if (parcel && carriers.find(c => c.id === parcel.carrier)?.country !== 'IN') coverage.value = 'all';
  function options() {
    const previous = select.value || String(parcel?.carrier || 0);
    const items = carriers.filter(c => (coverage.value === 'all' || c.country === 'IN') && c.name.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = `${!parcel ? '<option value="0">Auto-detect courier</option>' : ''}${items.map(c => `<option value="${c.id}">${esc(c.name)}${coverage.value === 'all' && c.country ? ` · ${esc(c.country)}` : ''}</option>`).join('')}`;
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
    dialog.querySelector('#catalog-note').textContent = `${items.length} supported couriers shown · Official 17TRACK catalog, ${new Date(fetchedAt).toLocaleDateString('en-IN')}. Missing courier? Try All couriers; unlisted couriers are unsupported.`;
  }
  options(); coverage.onchange = options; search.oninput = options;
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('[type=submit]'), message = form.querySelector('.form-error'); button.disabled = true; message.textContent = '';
    try {
      const fields = Object.fromEntries(new FormData(form)), extra = { ...fields }; delete extra.number; delete extra.carrier; delete extra.nickname;
      if (extra.special_tracking_info) extra.special_tracking_info = JSON.parse(extra.special_tracking_info);
      const result = await api(parcel ? `/parcels/${parcel.id}` : '/parcels', { method: parcel ? 'PATCH' : 'POST', body: JSON.stringify({ number: fields.number, nickname: fields.nickname, carrier: Number(fields.carrier), extras: extra }) });
      dialog.close(); await load(); await openParcel(result.id); toast(result.reused ? 'Already saved — opened the existing parcel.' : 'Parcel saved. You can come back any time.');
    } catch (e) { message.textContent = e.message; } finally { button.disabled = false; }
  };
}
function loginDialog() {
  const dialog = showDialog('modal', `<div class="dialog-head">${closeButton}<div class="eyebrow">YOUR PRIVATE PARCEL SPACE</div><h2>Welcome home.</h2><p>Sign in to your single-owner account.</p></div><form class="form" id="login-form"><label>Owner password<input name="password" type="password" autocomplete="current-password" required></label><details><summary>Backend connection</summary><label>Worker API URL<input name="backend" type="text" placeholder="https://parcel-tracker-api.example.workers.dev/api" value="${esc(apiBase())}"></label><p class="fine-print">Connect your deployed Worker, or use /api for the local Vite proxy. Provider keys belong on the Worker.</p></details><div class="form-error" role="alert"></div><button class="primary wide">Sign in ${icon('arrow')}</button></form>`);
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'), data = new FormData(form); button.disabled = true;
    try {
      const backend = String(data.get('backend')).replace(/\/$/, '');
      if (backend !== '/api') { const u = new URL(backend); if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('Use HTTPS for your backend.'); }
      const response = await fetch(`${backend}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: data.get('password') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to sign in');
      token = result.token; sessionStorage.setItem('parcel-session', token); localStorage.setItem('parcel-api', backend); demo = false; dialog.close(); selected = null; await load(); toast('Signed in. Your saved parcels are ready.');
    } catch (e) { form.querySelector('.form-error').textContent = e.message; } finally { button.disabled = false; }
  };
}
function accountDialog() {
  const dialog = showDialog('modal', `<div class="dialog-head">${closeButton}<h2>Your workspace</h2><p>Parcels live in your private account. Sign in on another device to find them here.</p></div><div class="form"><p class="fine-print">Sessions expire after 12 hours. Signing out removes this browser’s token; saved parcels remain in D1.</p><button class="primary wide" id="sign-out">Sign out</button></div>`);
  dialog.querySelector('#sign-out').onclick = () => { sessionStorage.removeItem('parcel-session'); token = null; demo = true; dialog.close(); load(); };
}
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); document.querySelector('#search')?.focus(); } });
render(); load();
setInterval(() => { if (!demo && token && !document.hidden && !document.querySelector('dialog[open]')) load(); }, 60000);
