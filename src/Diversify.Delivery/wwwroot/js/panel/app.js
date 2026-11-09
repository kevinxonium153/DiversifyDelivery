// Panel del master: menú lateral, enrutador y acceso.
import { api, setUnauthorizedHandler } from '../api.js';
import { logoDelivery, polyMorphaCredit } from '../brand.js';
import { esc, icon, formData, attempt } from '../ui.js';
import dashboard from './dashboard.js';
import orders from './orders.js';
import products from './products.js';
import customers from './customers.js';
import drivers from './drivers.js';
import settings from './settings.js';

const PAGES = [dashboard, orders, products, customers, drivers, settings];
const root = document.getElementById('root');
let user = null;
let cleanup = null;
let counts = {};

function renderLogin(message = '') {
  root.innerHTML = `<div class="auth-wrap"><form class="auth-card glass" id="login">
    <div class="brand">${logoDelivery({ height: 50 })}<div class="tagline">Panel de administración</div></div>
    ${message ? `<div class="alert err">${icon('alert')}<div>${esc(message)}</div></div>` : ''}
    <label class="field"><span>Usuario</span><input name="login" autocomplete="username" required></label>
    <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary lg block">Ingresar</button>
    ${polyMorphaCredit()}
  </form></div>`;
  root.querySelector('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = await attempt(() => api.post('/auth/login', formData(e.target)));
    if (!u) return;
    if (u.role !== 'master') {
      await api.post('/auth/logout').catch(() => {});
      renderLogin(u.role === 'repartidor' ? 'Esta cuenta es de repartidor: usa la app de entregas en /repartidor/.' : 'Esta cuenta no tiene acceso al panel.');
      return;
    }
    user = u;
    start();
  });
}

function shell() {
  root.innerHTML = `<div class="layout">
    <aside class="side" id="side">
      <div class="brand">${logoDelivery({ height: 40 })}<div class="store" id="store-name"></div></div>
      <nav id="nav">${PAGES.map((p) => `<a class="nav" href="#/${p.route}" data-route="${p.route}">${icon(p.icon)}<span>${esc(p.title)}</span><span class="count hidden" data-count="${p.route}"></span></a>`).join('')}</nav>
      <div class="foot">
        <div>${icon('user')} ${esc(user.fullName)}</div>
        <a class="btn sm" href="/" target="_blank" rel="noopener">${icon('bag')} Ver tienda</a>
        <button class="btn sm" id="logout">${icon('logout')} Cerrar sesión</button>
        ${polyMorphaCredit()}
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  root.querySelector('#logout').addEventListener('click', async () => {
    await api.post('/auth/logout').catch(() => {});
    user = null;
    renderLogin();
  });
  root.querySelector('#nav').addEventListener('click', () => root.querySelector('#side').classList.remove('open'));
  api.get('/store').then((s) => { root.querySelector('#store-name').textContent = s.storeName; }).catch(() => {});
}

/** Contadores del menú (pedidos nuevos, pagos por revisar). Se refrescan cada 30 s. */
async function refreshCounts() {
  const d = await api.get('/admin/dashboard').catch(() => null);
  if (!d) return;
  counts = { pedidos: d.byStatus.Recibido, clientes: d.pendingRegistrations };
  for (const [route, n] of Object.entries(counts)) {
    const el = root.querySelector(`[data-count="${route}"]`);
    if (el) { el.textContent = n; el.classList.toggle('hidden', !n); }
  }
}

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'tablero';
  const page = PAGES.find((p) => p.route === name) || dashboard;
  root.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === page.route ? 'page' : 'false'));
  const main = root.querySelector('#main');
  main.innerHTML = `<div class="top"><div class="row"><button class="btn icon menu-btn" id="menu" aria-label="Menú">${icon('list')}</button><h1>${esc(page.title)}</h1></div><div class="actions" id="actions"></div></div><div id="page"></div>`;
  main.querySelector('#menu').addEventListener('click', () => root.querySelector('#side').classList.toggle('open'));
  document.title = `${page.title} · Panel Diversify Delivery`;
  const ctx = { user, actions: main.querySelector('#actions'), navigate: (h) => { location.hash = h; }, refreshCounts };
  cleanup = await page.render(main.querySelector('#page'), ctx);
}

let countsTimer;
function start() {
  shell();
  route();
  refreshCounts();
  clearInterval(countsTimer);
  countsTimer = setInterval(refreshCounts, 30000);
}

setUnauthorizedHandler(() => { user = null; renderLogin('Tu sesión terminó. Vuelve a ingresar.'); });
window.addEventListener('hashchange', () => { if (user) route(); });

(async () => {
  user = await api.get('/auth/me').catch(() => null);
  if (user?.role === 'master') start(); else renderLogin();
})();
