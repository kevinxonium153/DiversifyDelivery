// App del repartidor: pedidos disponibles, mis entregas (con instrucciones, ubicación y navegación) e historial.
// Se actualiza cada 15 s y avisa con vibración cuando aparece un pedido disponible nuevo.
import { api, setUnauthorizedHandler } from '../api.js';
import { logoDelivery, isotipo, polyMorphaCredit } from '../brand.js';
import { esc, icon, money, qty, statusBadge, ago, fmtDateTime, payLabel, formData, attempt, toast, modal, confirmDialog,
  mapsUrl, wazeUrl, telUrl, waUrl, distanceKm } from '../ui.js';

const root = document.getElementById('root');
let user = null;
let tab = 'mine';
let timer = null;
let here = null;          // ubicación del repartidor (para mostrar distancia)
let knownAvailable = null;

function renderLogin(message = '') {
  root.innerHTML = `<div class="auth-wrap"><form class="auth-card glass" id="login">
    <div class="brand">${logoDelivery({ height: 50 })}<div class="tagline">${icon('bike')} App de repartidores</div></div>
    ${message ? `<div class="alert err">${icon('alert')}<div>${esc(message)}</div></div>` : ''}
    <label class="field"><span>Usuario</span><input name="login" autocomplete="username" autocapitalize="off" required></label>
    <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary lg block">Ingresar</button>
    <p class="small muted" style="text-align:center;margin:0">¿Olvidaste tu contraseña? Pídele al administrador del supermercado que te asigne una nueva.</p>
    ${polyMorphaCredit()}
  </form></div>`;
  root.querySelector('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = await attempt(() => api.post('/auth/login', formData(e.target)));
    if (!u) return;
    if (u.role !== 'repartidor') {
      await api.post('/auth/logout').catch(() => {});
      return renderLogin('Esta cuenta no es de repartidor.');
    }
    user = u;
    start();
  });
}

function shell() {
  root.innerHTML = `
    <header class="d-top glass">
      <div class="row" style="gap:10px">${isotipo({ size: 34 })}<div class="who">${esc(user.fullName)}<small>${esc(user.vehicle || 'Repartidor')}</small></div></div>
      <div class="row" style="gap:6px"><button class="duty" id="duty" aria-pressed="${user.onDuty}"><i></i><span>${user.onDuty ? 'En turno' : 'Fuera de turno'}</span></button>
        <button class="btn ghost icon sm" id="logout" aria-label="Cerrar sesión">${icon('logout')}</button></div>
    </header>
    <main class="d-main" id="main"></main>
    <nav class="d-tabs glass">
      <a href="#available" data-tab="available">${icon('bag')}Disponibles<span class="n hidden" id="n-available"></span></a>
      <a href="#mine" data-tab="mine">${icon('truck')}Mis entregas<span class="n hidden" id="n-mine"></span></a>
      <a href="#history" data-tab="history">${icon('clock')}Historial</a>
    </nav>`;
  root.querySelector('#duty').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const r = await attempt(() => api.post('/driver/duty', { onDuty: btn.getAttribute('aria-pressed') !== 'true' }));
    if (!r) return;
    user.onDuty = r.onDuty;
    btn.setAttribute('aria-pressed', r.onDuty);
    btn.querySelector('span').textContent = r.onDuty ? 'En turno' : 'Fuera de turno';
    toast(r.onDuty ? 'Estás en turno: verás los pedidos disponibles.' : 'Saliste de turno.');
  });
  root.querySelector('#logout').addEventListener('click', async () => {
    if (!await confirmDialog('Cerrar sesión', '¿Salir de la app de repartidor?')) return;
    await api.post('/auth/logout').catch(() => {});
    user = null; clearInterval(timer); renderLogin();
  });
}

function jobCard(o, scope) {
  const d = here && o.latitude != null ? distanceKm(here, { lat: o.latitude, lng: o.longitude }) : null;
  const cash = o.paymentMethod === 'Efectivo';
  return `<article class="card job" data-id="${o.id}">
    <div class="head"><span class="num">${esc(o.number)}</span>${statusBadge(o.status)}</div>
    <div class="addr">${icon('pin')}<div><strong>${esc(o.addressLine)}</strong><br>${esc(o.neighborhood || '')} · ${esc(o.city)}
      ${o.reference ? `<div class="ref">Ref.: ${esc(o.reference)}</div>` : ''}
      ${d != null ? `<div class="dist">${d.toFixed(1)} km de ti</div>` : ''}</div></div>
    ${o.instructions ? `<div class="note"><b>Instrucciones:</b> ${esc(o.instructions)}</div>` : ''}
    <div class="money"><div><div class="small muted">${cash ? 'Cobrar en efectivo' : esc(payLabel(o.paymentMethod))}</div>
      ${cash && o.change ? `<div class="small">Paga con ${money(o.cashGiven)} · <strong>lleva ${money(o.change)} de cambio</strong></div>` : ''}</div><strong>${money(o.total)}</strong></div>
    ${scope === 'history' ? `<div class="small muted">${o.deliveredAt ? `Entregado ${fmtDateTime(o.deliveredAt)}` : esc(o.cancelReason || '')}</div>` : actions(o, scope)}
  </article>`;
}

function actions(o, scope) {
  if (scope === 'available') {
    return `<div class="small muted">${o.itemCount} productos · ${o.status === 'Listo' ? 'listo para recoger' : 'se está armando'} · ${ago(o.createdAt)}</div>
      <button class="btn primary lg block" data-take>${icon('check')} Tomar pedido</button>`;
  }
  const nav = o.latitude != null
    ? `<a class="btn" href="${mapsUrl(o.latitude, o.longitude)}" target="_blank" rel="noopener">${icon('nav')} Google Maps</a>
       <a class="btn" href="${wazeUrl(o.latitude, o.longitude)}" target="_blank" rel="noopener">${icon('nav')} Waze</a>`
    : `<div class="full alert warn small">${icon('alert')}<div>El cliente no marcó ubicación GPS. Guíate por la dirección y las referencias, o llámale.</div></div>`;
  return `<div class="btns">
      <a class="btn" href="${telUrl(o.deliveryPhone)}">${icon('phone')} Llamar</a>
      <a class="btn" href="${waUrl(o.deliveryPhone, `Hola ${o.deliveryName}, soy ${user.fullName}, su repartidor de ${o.number}.`)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>
      ${nav}
      <button class="btn full" data-items>${icon('list')} Ver productos (${o.itemCount})</button>
      ${o.status === 'Listo' ? `<button class="btn primary lg full" data-pickup>${icon('truck')} Recogí el pedido · voy en camino</button>`
        : o.status === 'EnCamino' ? `<button class="btn success lg full" data-deliver>${icon('check')} Entregar (código del cliente)</button>`
        : `<div class="full small muted" style="text-align:center">${icon('clock')} Se está armando. Te avisamos cuando esté listo.</div>`}
      ${o.status !== 'EnCamino' ? '<button class="btn ghost sm full" data-release>Soltar pedido</button>' : ''}
    </div>
    <div class="small muted">${esc(o.deliveryName)} · ${esc(o.deliveryPhone)}</div>`;
}

async function load(silent = false) {
  const main = root.querySelector('#main');
  if (!main) return;
  const [list, available, mine] = await Promise.all([
    api.get('/driver/orders', { scope: tab }).catch((e) => { if (!silent) toast(e.message, 'error'); return null; }),
    tab === 'available' ? null : api.get('/driver/orders', { scope: 'available' }).catch(() => null),
    tab === 'mine' ? null : api.get('/driver/orders', { scope: 'mine' }).catch(() => null),
  ]);
  if (!list) return;
  const availableList = tab === 'available' ? list : available || [];
  const mineList = tab === 'mine' ? list : mine || [];
  badge('available', availableList.length);
  badge('mine', mineList.length);
  // Aviso de pedidos nuevos disponibles (vibración en el celular).
  const ids = new Set(availableList.map((o) => o.id));
  if (knownAvailable && user.onDuty && [...ids].some((id) => !knownAvailable.has(id))) {
    toast('¡Hay un pedido nuevo disponible!');
    navigator.vibrate?.([200, 100, 200]);
  }
  knownAvailable = ids;

  root.querySelectorAll('.d-tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  const titles = { available: 'Pedidos disponibles', mine: 'Mis entregas', history: 'Últimos 30 días' };
  const empty = { available: user.onDuty ? 'No hay pedidos disponibles ahora. Esta pantalla se actualiza sola.' : 'Ponte en turno para tomar pedidos.',
    mine: 'No tienes entregas asignadas. Revisa “Disponibles”.', history: 'Aún no tienes entregas.' };
  main.innerHTML = `<div class="row between"><h2 style="margin:0">${titles[tab]}</h2><span class="small muted">${list.length}</span></div>
    ${list.length ? list.map((o) => jobCard(o, tab)).join('') : `<div class="empty"><div class="big">${tab === 'history' ? '🗂️' : '🛵'}</div>${empty[tab]}</div>`}`;
}

function badge(name, n) {
  const el = root.querySelector(`#n-${name}`);
  if (el) { el.textContent = n; el.classList.toggle('hidden', !n); }
}

async function onClick(e) {
  const card = e.target.closest('.job');
  if (!card) return;
  const id = Number(card.dataset.id);
  if (e.target.closest('[data-take]')) {
    if (await attempt(() => api.post(`/driver/orders/${id}/take`), 'Pedido tomado. Está en “Mis entregas”.')) { tab = 'mine'; location.hash = 'mine'; load(); }
  } else if (e.target.closest('[data-release]')) {
    if (await confirmDialog('Soltar pedido', 'Otro repartidor podrá tomarlo.', { okLabel: 'Soltar', kind: 'danger' })
      && await attempt(() => api.post(`/driver/orders/${id}/release`), 'Pedido liberado.')) load();
  } else if (e.target.closest('[data-pickup]')) {
    if (await attempt(() => api.post(`/driver/orders/${id}/pickup`), '¡En camino! El cliente ya fue avisado.')) load();
  } else if (e.target.closest('[data-items]')) {
    const o = await attempt(() => api.get(`/driver/orders/${id}`));
    if (o) modal({
      title: `Productos de ${o.number}`,
      body: `<p class="small muted" style="margin-top:0">Revísalos al recoger el pedido.</p><div class="checklist">${o.items.filter((i) => i.fulfilledQuantity !== 0).map((i) => `<label><input type="checkbox"><span class="grow">${esc(i.name)}</span><strong>${qty(i.fulfilledQuantity ?? i.quantity)} ${esc(i.unit)}</strong></label>`).join('')}</div>
        ${o.items.some((i) => i.fulfilledQuantity === 0) ? `<p class="small muted">No van (no había): ${o.items.filter((i) => i.fulfilledQuantity === 0).map((i) => esc(i.name)).join(', ')}</p>` : ''}`,
      actions: [{ label: 'Listo', kind: 'primary' }],
    });
  } else if (e.target.closest('[data-deliver]')) {
    modal({
      title: 'Confirmar entrega',
      body: `<p style="margin-top:0">Pídele al cliente el <strong>código de entrega de 4 dígitos</strong> que ve en su pedido.</p>
        <input class="pin-input" id="pin" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••" aria-label="Código de entrega">`,
      actions: [{ label: 'Cancelar' }, { label: 'Confirmar entrega', kind: 'success', onClick: async (close, mel) => {
        const pin = mel.querySelector('#pin').value.trim();
        if (pin.length !== 4) { toast('El código tiene 4 dígitos.', 'error'); return false; }
        if (await attempt(() => api.post(`/driver/orders/${id}/deliver`, { pin }), '¡Entregado! Buen trabajo.')) { load(); return undefined; }
        return false;
      } }],
    });
  }
}

function locate() {
  navigator.geolocation?.getCurrentPosition((p) => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; load(true); }, () => {}, { maximumAge: 60000, timeout: 10000 });
}

function start() {
  shell();
  tab = ['available', 'mine', 'history'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'mine';
  root.querySelector('#main').addEventListener('click', onClick);
  load();
  locate();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.querySelector('.modal-backdrop')) load(true); }, 15000);
}

window.addEventListener('hashchange', () => {
  if (!user) return;
  const t = location.hash.slice(1);
  if (['available', 'mine', 'history'].includes(t)) { tab = t; load(); }
});
setUnauthorizedHandler(() => { user = null; clearInterval(timer); renderLogin('Tu sesión terminó. Vuelve a ingresar.'); });

(async () => {
  user = await api.get('/auth/me').catch(() => null);
  if (user?.role === 'repartidor') start(); else renderLogin();
})();
