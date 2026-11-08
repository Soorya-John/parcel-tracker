import './style.css';
import './mobile.js';

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
let parcels = [], carriers = [], fetchedAt, tab = 'active', query = '', selected = null, health, settings;
const carrierName = id => carriers.find(c => c.id === Number(id))?.name || `Courier ${id || 'not detected'}`;
async function api(path, options = {}) {
  if (!window.parcelDesktop) throw new Error('Open Parcel using the installed Windows or Android app.');
  return window.parcelDesktop.request(path, options);
}
function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div'); node.className = 'toast'; node.role = 'status'; node.textContent = message; document.body.append(node); setTimeout(() => node.remove(), 5500);
}
async function load() {
  try {
    [parcels, { items: carriers, fetchedAt }, health, settings] = await Promise.all([api('/parcels'), api('/carriers'), api('/health'), window.parcelDesktop.settings()]);
    render();
  } catch (e) { toast(e.message);  }
}
function render() {
  const active = parcels.filter(p => !p.delivered), delivered = parcels.filter(p => p.delivered);
  const found = parcels.filter(p => `${p.number} ${p.nickname} ${carrierName(p.carrier)}`.toLowerCase().includes(query.toLowerCase()));
  const visible = query ? found : tab === 'active' ? active : delivered;
  root.innerHTML = `<aside class="sidebar"><a href="./" class="brand" aria-label="Parcel home"><span class="brand-icon">${icon('box')}</span>parcel<span class="brand-dot">.</span></a><div class="workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation"><button class="nav-item ${tab === 'active' ? 'current' : ''}" data-tab="active">${icon('grid')}Saved parcels <span>${active.length}</span></button><button class="nav-item ${tab === 'delivered' ? 'current' : ''}" data-tab="delivered">${icon('archive')}Delivered archive <span>${delivered.length}</span></button></nav><div class="sidebar-bottom"><div class="india-note">${icon('globe')}<div>From anywhere.<br><strong>To your doorstep.</strong></div></div><button class="account" id="account"><span class="avatar">Y</span><span>Settings<small>Stored on this device</small></span><span class="account-arrow">↗</span></button></div></aside>
  <main><header class="topbar"><span>My workspace <span class="slash">/</span> <strong>${tab === 'active' ? 'Saved parcels' : 'Delivered archive'}</strong></span><span class="private-label"><span class="live-dot"></span>LOCAL WORKSPACE</span></header>
  <div class="content"><div class="page-heading"><div><div class="eyebrow">A LITTLE LESS WONDERING</div><h1>${tab === 'active' ? 'Saved parcels' : 'Delivered archive'}<span class="heading-dot">.</span></h1><p>${tab === 'active' ? 'Every journey, in one place. We’ll keep an eye on the way.' : 'Safely arrived. Every scan, kept for whenever you need it.'}</p></div><button class="primary" id="add">${icon('plus')} Add parcel</button></div>
  ${!settings?.configured ? `<div class="demo-banner"><span>${icon('globe')} <strong>Make this your parcel space.</strong> Add your 17TRACK API key in Settings to receive live courier scans.</span><button id="connect">Set up tracking ${icon('arrow')}</button></div>` : ''}
  <div class="desktop-actions"><button class="primary" id="refresh">${icon('clock')} Refresh tracking</button><span>${settings?.lastSync ? `Last checked ${date(settings.lastSync)}` : 'Not checked yet'} - Updates while the app is running${settings?.syncError ? ` - ${esc(settings.syncError)}` : ''}</span></div>
  <section class="stats" aria-label="Parcel summary"><div class="stat"><div><span>On the way</span><strong>${active.length.toString().padStart(2, '0')}</strong><small>Good things are coming</small></div><span class="stat-icon green">${icon('truck')}</span></div><div class="stat"><div><span>Out for delivery</span><strong>${active.filter(p => p.status === 'OutForDelivery').length.toString().padStart(2, '0')}</strong><small>A little closer to home</small></div><span class="stat-icon amber">${icon('pin')}</span></div><div class="stat"><div><span>Delivered</span><strong>${delivered.length.toString().padStart(2, '0')}</strong><small>All journeys, safely saved</small></div><span class="stat-icon lavender">${icon('check')}</span></div></section>
  <section class="parcel-section"><div class="list-toolbar"><div class="tabs" role="group" aria-label="Parcel lists"><button data-tab="active" class="${tab === 'active' ? 'selected' : ''}">Active <span>${active.length}</span></button><button data-tab="delivered" class="${tab === 'delivered' ? 'selected' : ''}">Delivered <span>${delivered.length}</span></button></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search all parcels…" aria-label="Search all parcels" value="${esc(query)}"><kbd>/</kbd></label></div>
  <div class="list-caption"><span>${query ? `${visible.length} result${visible.length === 1 ? '' : 's'} across active & delivered` : tab === 'active' ? 'THE JOURNEYS IN PROGRESS' : 'THE JOURNEYS COMPLETED'}</span><span>All times in IST</span></div>
  <div class="parcel-list">${visible.length ? visible.map(card).join('') : `<div class="empty">${icon('box')}<h2>${query ? 'No parcels found' : tab === 'active' ? 'Your next journey starts here' : 'A place for happy arrivals'}</h2><p>${query ? 'Try a tracking number, courier or nickname.' : tab === 'active' ? 'Add a tracking number and we’ll take it from there.' : 'Delivered parcels will appear here with their full history.'}</p>${!query && tab === 'active' ? '<button class="primary" id="empty-add">Add your first parcel</button>' : ''}</div>`}</div></section>
  <section class="digest-note"><span class="note-icon">${icon('mail')}</span><div><strong>Less refreshing. More living.</strong><p>${settings?.hasResend ? 'Email digests are enabled while this app is running.' : 'Optional email digests can be configured in Settings.'}</p>${health?.lastDigest?.error ? `<p class="warning">Email needs attention: ${esc(health.lastDigest.error)}</p>` : ''}</div><span class="digest-pill">${icon('clock')} 2-hour digest</span></section>
  <footer><span>${icon('globe')} India & beyond <span class="footer-dot">·</span> Tracking powered by 17TRACK</span><span>Scan freshness depends on the courier and 17TRACK.</span></footer></div></main><dialog id="modal"></dialog><dialog id="detail"></dialog>`;
  root.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { tab = el.dataset.tab; query = ''; render(); });
  root.querySelectorAll('[data-id]').forEach(el => el.onclick = () => openParcel(el.dataset.id));
  document.querySelector('#add').onclick = () => parcelDialog();
  document.querySelector('#empty-add')?.addEventListener('click', () => parcelDialog());
  document.querySelector('#connect')?.addEventListener('click', settingsDialog);
  document.querySelector('#account').onclick = settingsDialog;
  document.querySelector('#refresh').onclick = refreshTracking;
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
    const dialog = showDialog('detail', `<div class="dialog-head"><div class="eyebrow">THE WHOLE JOURNEY</div>${closeButton}<h2>${esc(p.nickname || 'Your parcel')}</h2><p>${esc(carrierName(p.carrier))} · ${esc(p.number)}</p><span class="badge ${p.delivered ? 'delivered' : 'transit'}">${esc(label(p.status))}</span></div><div class="detail-body">${p.problem ? `<div class="problem">${esc(p.problem)}</div>` : ''}<div class="detail-meta"><span>${p.delivered ? 'Delivered archive · history retained' : 'Checked automatically while the app is running'}</span><button class="text-button" id="correct">Correct courier / add details</button></div><h3>Scan history <span>IST</span></h3>${p.scans.length ? `<ol class="timeline">${p.scans.map((s, i) => `<li class="${i === 0 ? 'latest' : ''}"><span class="timeline-point">${i === 0 ? icon(p.delivered ? 'check' : 'box') : ''}</span><time>${date(s.time)}</time><h4>${esc(s.description || label(s.status))}</h4><p>${icon('pin')}${esc(s.location || 'Location not supplied')}</p><small>${esc(label(s.status))}</small></li>`).join('')}</ol>` : '<div class="empty compact"><p>Waiting for the courier’s first scan. Your parcel is saved.</p></div>'}<p class="fine-print">Scan freshness depends on the courier and 17TRACK. Unzoned carrier times are labelled separately.</p></div>`);
    dialog.querySelector('#correct').onclick = () => { dialog.close(); parcelDialog(p); };
  } catch (e) { toast(e.message); }
}
function parcelDialog(parcel = null) {
  const dialog = showDialog('modal', `<div class="dialog-head">${closeButton}<div class="eyebrow">${parcel ? 'FINE-TUNE THE DETAILS' : 'MAKE ROOM FOR SOMETHING GOOD'}</div><h2>${parcel ? 'Courier details' : 'Add a parcel'}</h2><p>Saved locally on this device. Live tracking requires a 17TRACK API key.</p></div><form class="form" id="parcel-form"><label>Tracking number<input name="number" required pattern="[A-Za-z0-9-]{5,50}" maxlength="50" placeholder="e.g. EE123456789IN" value="${esc(parcel?.number || '')}" ${parcel ? 'readonly' : ''}></label>${!parcel ? '<label>Nickname <span class="optional">optional</span><input name="nickname" maxlength="100" placeholder="e.g. Something from home"></label>' : ''}<div class="form-row"><label>Courier coverage<select id="coverage"><option value="IN">Indian couriers</option><option value="all">All couriers · international</option></select></label><label>Find a courier<input id="courier-search" type="search" placeholder="Search courier name"></label></div><label>Courier<select name="carrier" id="carrier"></select></label><small class="fine-print" id="catalog-note"></small><details ${parcel?.problem ? 'open' : ''}><summary>Extra tracking information</summary><p class="fine-print">Some couriers require these to retrieve scans. Use the fields requested in the courier message.</p><div class="form-row"><label>Destination postal code<input name="destination_postal_code" maxlength="30"></label><label>Destination country<input name="destination_country" maxlength="2" placeholder="IN"></label></div><div class="form-row"><label>Origin country<input name="origin_country" maxlength="2" placeholder="IN"></label><label>Shipping date<input name="ship_date" placeholder="YYYY/MM/DD"></label></div><label>Phone number (last 4 digits)<input name="phone_number_last_4" maxlength="4"></label><details><summary>Other courier-required fields</summary>${['phone_number', 'shipper', 'consignee', 'cpf_or_cnpj'].map(name => `<label>${esc(name.replaceAll('_', ' '))}<input name="${name}" maxlength="250"></label>`).join('')}<label>Special tracking information (JSON)<textarea name="special_tracking_info" placeholder='{"number_type":"...","parameter":"..."}'></textarea></label></details></details><div class="form-error" role="alert"></div><button class="primary wide" type="submit">${parcel ? 'Save courier details' : 'Save & track parcel'} ${icon('arrow')}</button></form>`);
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
async function refreshTracking() {
  const button = document.querySelector('#refresh'); if (button) { button.disabled = true; button.textContent = 'Checking couriers...'; }
  try { await window.parcelDesktop.sync(); await load(); toast('Tracking check complete.'); }
  catch(e) { await load(); toast(e.message); }
  finally { if (button) button.disabled = false; }
}
async function settingsDialog() {
  try { settings = await window.parcelDesktop.settings(); } catch(e) { toast(e.message); return; }
  const android = settings.platform === 'android';
  const dialog = showDialog('modal', `<div class="dialog-head">${closeButton}<h2>Your settings</h2><p>Local workspace - keys encrypted by ${android ? 'Android' : 'Windows'}</p></div><form class="form" id="settings-form"><p class="fine-print">Get an API key from api.17track.net. API access is separate from the consumer tracking account and may require a paid plan. Keys stay on this device. Tracking refreshes when the app opens and every two hours while running${android ? ' in the foreground' : ' in the tray'}. Fully quitting the app or powering off pauses checks.</p>${settings.settingsError ? `<p class="warning">${esc(settings.settingsError)}</p>` : ''}<label>17TRACK API key ${settings.configured ? '(saved)' : ''}<input type="password" name="TRACK17_KEY" autocomplete="off" placeholder="${settings.configured ? 'Leave blank to keep saved key' : 'Paste your API key'}"></label><details><summary>Optional email digests</summary><label>Resend API key ${settings.hasResend ? '(saved)' : ''}<input type="password" name="RESEND_KEY" autocomplete="off" placeholder="Leave blank to keep saved key"></label><label>Recipient email<input type="email" name="OWNER_EMAIL" value="${esc(settings.OWNER_EMAIL)}"></label><label>Verified sender<input name="EMAIL_FROM" value="${esc(settings.EMAIL_FROM)}" placeholder="Parcel &lt;parcels@your-domain.com&gt;"></label><p class="fine-print">Use a sender verified in your Resend account. Leave the recipient empty to disable email.</p></details>${android ? '' : `<label><span><input type="checkbox" name="launchAtLogin" ${settings.launchAtLogin ? 'checked' : ''}> Start in tray when I sign into Windows</span></label>`}<div class="form-error" role="alert"></div><button class="primary wide" type="submit">Save settings</button><button class="text-button" type="button" id="backup">Export parcel backup</button><button class="text-button" type="button" id="restore">Restore parcel backup</button><p class="fine-print">Backups contain parcel history and email outbox data. API keys are excluded. Keep backups private.</p></form>`);
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.target));
      if (!android) values.launchAtLogin = event.target.elements.launchAtLogin.checked;
      await window.parcelDesktop.saveSettings(values); dialog.close(); await load(); toast('Settings saved. Use Refresh tracking to check your parcels.');
    } catch(e) { dialog.querySelector('.form-error').textContent = e.message; } finally { button.disabled = false; }
  };
  dialog.querySelector('#backup').onclick = async () => { try { if (await window.parcelDesktop.backup()) toast('Backup exported.'); } catch(e) { toast(e.message); } };
  dialog.querySelector('#restore').onclick = async () => { try { if (await window.parcelDesktop.restore()) { dialog.close(); await load(); toast('Backup restored.'); } } catch(e) { toast(e.message); } };
}

document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); document.querySelector('#search')?.focus(); } });
render(); load();
setInterval(() => { if (window.parcelDesktop && !document.hidden && !document.querySelector('dialog[open]')) load(); }, 60000);
