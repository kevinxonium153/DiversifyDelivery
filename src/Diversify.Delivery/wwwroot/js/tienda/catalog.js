// Catálogo: portada (ofertas, destacados), categorías, búsqueda y tarjetas de producto.
import { api } from '../api.js';
import { esc, icon, money, qty, attempt } from '../ui.js';
import { state, cartQty, setQty, stepFor, refreshCartPrices } from './state.js';

let categoriesCache = null;

export function productCard(p) {
  const q = cartQty(p.id);
  const off = p.compareAtPrice ? Math.round((1 - p.price / p.compareAtPrice) * 100) : 0;
  return `<article class="product ${p.available ? '' : 'soldout'}" data-id="${p.id}">
    <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc(p.icon || '🛒')}</span>`}
      ${off > 0 ? `<span class="tag">-${off}%</span>` : ''}</div>
    <div class="info">
      <div class="name" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="unit">${unitLabel(p.unit)}</div>
      <div class="price">${money(p.price)}${p.compareAtPrice ? `<span class="before">${money(p.compareAtPrice)}</span>` : ''}</div>
      <div class="actions">${actionHtml(p, q)}</div>
    </div>
  </article>`;
}

const UNITS = { UND: 'Unidad', LB: 'Por libra', KG: 'Por kilo', BOL: 'Bolsa', PAQ: 'Paquete', CTN: 'Cartón', CJA: 'Caja', LT: 'Litro' };
export const unitLabel = (u) => UNITS[u] || u;

function actionHtml(p, q) {
  if (!p.available) return '<button class="btn sm block" disabled>Agotado</button>';
  if (!q) return `<button class="btn sm block primary" data-add>${icon('plus')} Agregar</button>`;
  return `<div class="stepper" role="group" aria-label="Cantidad de ${esc(p.name)}">
    <button data-dec aria-label="Quitar uno">−</button><output>${qty(q)}${p.unit === 'LB' ? ' lb' : ''}</output><button data-inc aria-label="Agregar uno">+</button></div>`;
}

/** Conecta los botones Agregar/+/− de un contenedor con tarjetas. */
export function bindCards(root, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  root.addEventListener('click', (e) => {
    const card = e.target.closest('.product');
    if (!card) return;
    const p = byId.get(Number(card.dataset.id));
    if (!p) return;
    const step = stepFor(p.unit);
    if (e.target.closest('[data-add]')) setQty(p, 1);
    else if (e.target.closest('[data-inc]')) setQty(p, cartQty(p.id) + step);
    else if (e.target.closest('[data-dec]')) setQty(p, cartQty(p.id) - step);
    else return;
    card.querySelector('.actions').innerHTML = actionHtml(p, cartQty(p.id));
  });
}

function heroHtml() {
  const s = state.store;
  const u = state.user;
  let notice = '';
  if (!s.acceptingOrders) notice = `<div class="alert warn" style="margin-bottom:14px">${icon('alert')}<div><strong>La tienda está en pausa.</strong> Puedes ver el catálogo; los pedidos se reactivan pronto.</div></div>`;
  else if (!s.openNow) notice = `<div class="alert warn" style="margin-bottom:14px">${icon('clock')}<div><strong>Fuera de horario.</strong> Recibimos pedidos de ${esc(s.opensAt)} a ${esc(s.closesAt)}.</div></div>`;
  if (u && u.role === 'cliente' && u.status !== 'Activo') {
    notice += u.status === 'EnRevision'
      ? `<div class="alert info" style="margin-bottom:14px">${icon('clock')}<div><strong>Estamos verificando tu pago de inscripción.</strong> Te avisaremos en cuanto se apruebe.</div></div>`
      : `<div class="alert warn" style="margin-bottom:14px">${icon('card')}<div><strong>Activa tu cuenta</strong> pagando la inscripción única de ${money(s.registrationFeeHnl)} (US$${s.registrationFeeUsd}). <a href="#/inscripcion">Pagar ahora</a></div></div>`;
  }
  return `${notice}<section class="hero">
    <h1>Tu súper <em>a domicilio</em>, sin hacer fila.</h1>
    <p>Elige tus productos de ${esc(s.storeName)} y un repartidor te los lleva a la puerta de tu casa.</p>
    <div class="perks">
      <span class="perk">${icon('truck')} Envío ${money(s.deliveryFee)}</span>
      ${s.freeDeliveryFrom > 0 ? `<span class="perk">${icon('star')} Gratis desde ${money(s.freeDeliveryFrom)}</span>` : ''}
      ${s.minimumOrder > 0 ? `<span class="perk">${icon('bag')} Pedido mínimo ${money(s.minimumOrder)}</span>` : ''}
      <span class="perk">${icon('shield')} Pagas al recibir</span>
    </div>
    <div class="art" aria-hidden="true">🛒</div>
  </section>
  ${!u ? `<div class="card flat row between" style="margin-bottom:18px"><div><strong>¿Primera vez?</strong> <span class="muted">Crea tu cuenta con una inscripción única de US$${s.registrationFeeUsd} y pide cuando quieras.</span></div><a class="btn ink" href="#/registro">Crear cuenta</a></div>` : ''}`;
}

export async function renderCatalog(view, ctx, filter = {}) {
  const home = !filter.categoryId && !filter.search && !filter.offers;
  view.innerHTML = `${home ? heroHtml() : ''}
    <nav class="chips" id="cats" aria-label="Categorías"></nav>
    <div id="sections"><div class="empty">Cargando productos…</div></div>`;

  if (!categoriesCache) categoriesCache = await attempt(() => api.get('/catalog/categories')) || [];
  const cats = view.querySelector('#cats');
  cats.innerHTML = `<a class="chip" href="#/" aria-pressed="${home}">🏠 Todo</a>
    <a class="chip" href="#/ofertas" aria-pressed="${!!filter.offers}">🔥 Ofertas</a>
    ${categoriesCache.map((c) => `<a class="chip" href="#/categoria/${c.id}" aria-pressed="${filter.categoryId === c.id}">${esc(c.icon)} ${esc(c.name)}</a>`).join('')}`;
  cats.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const sections = view.querySelector('#sections');
  if (home) {
    const [offers, featured, all] = await Promise.all([
      api.get('/catalog/products', { offers: true, limit: 12 }),
      api.get('/catalog/products', { featured: true, limit: 12 }),
      api.get('/catalog/products', { limit: 200 }),
    ]);
    const products = [...offers.items, ...featured.items, ...all.items];
    refreshCartPrices(products);
    sections.innerHTML = `
      ${offers.items.length ? `<div class="section-title"><h2>🔥 Ofertas de la semana</h2><a href="#/ofertas">Ver todas</a></div>
        <div class="rail">${offers.items.map(productCard).join('')}</div>` : ''}
      ${featured.items.length ? `<div class="section-title"><h2>⭐ Lo más pedido</h2></div>
        <div class="rail">${featured.items.map(productCard).join('')}</div>` : ''}
      ${categoriesCache.map((c) => {
        const items = all.items.filter((p) => p.categoryId === c.id).slice(0, 10);
        return items.length ? `<div class="section-title"><h2>${esc(c.icon)} ${esc(c.name)}</h2><a href="#/categoria/${c.id}">Ver ${c.products}</a></div>
          <div class="rail">${items.map(productCard).join('')}</div>` : '';
      }).join('')}`;
    bindCards(sections, products);
    return;
  }

  const data = await api.get('/catalog/products', { categoryId: filter.categoryId, search: filter.search, offers: filter.offers, limit: 200 });
  refreshCartPrices(data.items);
  const cat = categoriesCache.find((c) => c.id === filter.categoryId);
  const title = filter.search ? `Resultados para “${esc(filter.search)}”` : filter.offers ? '🔥 Ofertas' : `${esc(cat?.icon || '')} ${esc(cat?.name || 'Categoría')}`;
  sections.innerHTML = `<div class="section-title"><h2>${title}</h2><span class="muted small">${data.total} ${data.total === 1 ? 'producto' : 'productos'}</span></div>
    ${data.items.length ? `<div class="product-grid">${data.items.map(productCard).join('')}</div>`
      : `<div class="empty"><div class="big">🔎</div>No encontramos productos. Prueba con otra palabra.</div>`}`;
  bindCards(sections, data.items);
}
