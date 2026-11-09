// Tienda en línea: encabezado, enrutador por hash y barra del carrito.
import { api, setUnauthorizedHandler } from '../api.js';
import { logoDelivery, polyMorphaCredit } from '../brand.js';
import { esc, icon, money } from '../ui.js';
import { state, loadSession, loadStore, cartTotals, onCartChange } from './state.js';
import { renderCatalog } from './catalog.js';
import { openCart } from './cart.js';
import { renderCheckout } from './checkout.js';
import { renderOrders, renderOrder } from './orders.js';
import { renderLogin, renderRegister, renderInscription, renderAccount } from './account.js';

const view = document.getElementById('view');
let cleanup = null;

export function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

const ctx = { navigate, refreshBar: () => renderBar(), view };

const routes = [
  [/^#?\/?$/, () => renderCatalog(view, ctx)],
  [/^#\/categoria\/(\d+)$/, (m) => renderCatalog(view, ctx, { categoryId: Number(m[1]) })],
  [/^#\/buscar\/(.+)$/, (m) => renderCatalog(view, ctx, { search: decodeURIComponent(m[1]) })],
  [/^#\/ofertas$/, () => renderCatalog(view, ctx, { offers: true })],
  [/^#\/ingresar$/, () => renderLogin(view, ctx)],
  [/^#\/registro$/, () => renderRegister(view, ctx)],
  [/^#\/inscripcion$/, () => needUser() && renderInscription(view, ctx)],
  [/^#\/cuenta$/, () => needUser() && renderAccount(view, ctx)],
  [/^#\/checkout$/, () => needUser() && renderCheckout(view, ctx)],
  [/^#\/pedidos$/, () => needUser() && renderOrders(view, ctx)],
  [/^#\/pedido\/(\d+)$/, (m) => needUser() && renderOrder(view, ctx, Number(m[1]))],
];

function needUser() {
  if (state.user) return true;
  sessionStorage.setItem('dd.after-login', location.hash);
  navigate('#/ingresar');
  return false;
}

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      cleanup = await fn(m);
      window.scrollTo({ top: 0 });
      renderCartBar();
      return;
    }
  }
  navigate('#/');
}

function renderBar() {
  const bar = document.getElementById('bar');
  const u = state.user;
  const { count } = cartTotals();
  const current = decodeURIComponent((location.hash.match(/^#\/buscar\/(.+)$/) || [])[1] || '');
  bar.innerHTML = `
    <a class="brand-link" href="#/" aria-label="Inicio">${logoDelivery({ height: 38 })}</a>
    <form class="search" role="search" id="search-form">
      ${icon('search')}<input class="input" name="q" type="search" placeholder="Buscar productos: leche, arroz, pollo…" value="${esc(current)}" aria-label="Buscar productos">
    </form>
    <div class="tools">
      ${u ? `<a class="btn ghost" href="#/pedidos">${icon('receipt')}<span class="label">Mis pedidos</span></a>
             <a class="btn ghost" href="#/cuenta" title="${esc(u.fullName)}">${icon('user')}<span class="label">${esc(u.fullName.split(' ')[0])}</span></a>`
          : `<a class="btn ghost" href="#/ingresar">${icon('user')}<span class="label">Ingresar</span></a>`}
      <button class="btn ink cart-btn" id="cart-btn" aria-label="Carrito">${icon('cart')}<span class="label">Carrito</span>${count ? `<span class="count">${count}</span>` : ''}</button>
    </div>`;
  bar.querySelector('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    navigate(q ? `#/buscar/${encodeURIComponent(q)}` : '#/');
  });
  bar.querySelector('#cart-btn').addEventListener('click', () => openCart(ctx));
}

function renderCartBar() {
  const el = document.getElementById('cartbar');
  const t = cartTotals();
  const hide = !t.count || /^#\/(checkout|pedido|ingresar|registro|inscripcion)/.test(location.hash);
  el.innerHTML = hide ? '' : `<div class="cartbar"><button class="btn primary" id="open-cart">
    <span class="row">${icon('cart')} Ver carrito · ${t.count} ${t.count === 1 ? 'producto' : 'productos'}</span><strong>${money(t.subtotal)}</strong></button></div>`;
  el.querySelector('#open-cart')?.addEventListener('click', () => openCart(ctx));
}

function renderFooter() {
  const s = state.store;
  document.getElementById('footer').innerHTML = `
    <div><strong>${esc(s.storeName)}</strong>${s.storeAddress ? ` · ${esc(s.storeAddress)}` : ''}${s.storePhone ? ` · Tel. ${esc(s.storePhone)}` : ''}<br>
      Horario de pedidos: ${s.opensAt === s.closesAt ? '24 horas' : `${esc(s.opensAt)} a ${esc(s.closesAt)}`}</div>
    ${polyMorphaCredit()}`;
}

setUnauthorizedHandler(() => {
  state.user = null;
  renderBar();
});

onCartChange(() => { renderBar(); renderCartBar(); });
window.addEventListener('hashchange', () => { renderBar(); route(); });

(async () => {
  try {
    await Promise.all([loadStore(), loadSession()]);
  } catch (err) {
    view.innerHTML = `<div class="empty"><div class="big">📡</div>No pudimos conectar con la tienda. ${esc(err.message)}</div>`;
    return;
  }
  document.title = `${state.store.storeName} · Diversify Delivery`;
  renderBar();
  renderFooter();
  route();
})();

export { api };
