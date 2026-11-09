// Cajón del carrito.
import { esc, icon, money, qty } from '../ui.js';
import { state, cartLines, cartTotals, setQty, stepFor, clearCart, onCartChange } from './state.js';

export function openCart(ctx) {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'Carrito');
  document.body.append(backdrop, drawer);

  const close = () => { off(); backdrop.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);

  const render = () => {
    const lines = cartLines();
    const t = cartTotals();
    const s = state.store;
    drawer.innerHTML = `
      <header><h2>Tu carrito</h2><button class="btn ghost icon sm" data-close aria-label="Cerrar">${icon('x')}</button></header>
      <div class="content">
        ${lines.length === 0 ? `<div class="empty"><div class="big">🛒</div>Tu carrito está vacío.<br><span class="small">Agrega productos desde el catálogo.</span></div>` : `
        ${t.missingForFree > 0 && s.freeDeliveryFrom > 0 ? `<div class="alert info small" style="margin-bottom:10px">${icon('truck')}<div>Te faltan <strong>${money(t.missingForFree)}</strong> para envío gratis.</div></div>` : ''}
        ${t.fee === 0 && lines.length ? `<div class="alert ok small" style="margin-bottom:10px">${icon('check')}<div>¡Tu envío es gratis!</div></div>` : ''}
        <div class="lines">${lines.map((l) => `
          <div class="line" data-id="${l.id}">
            <div class="mini">${l.image ? `<img src="${esc(l.image)}" alt="">` : esc(l.icon || '🛒')}</div>
            <div><div class="t">${esc(l.name)}</div><div class="small muted">${money(l.price)}${l.unit === 'LB' ? ' / lb' : ''}</div>
              <div class="stepper light" style="width:130px;margin-top:6px;min-height:34px"><button data-dec style="height:34px" aria-label="Quitar">−</button><output>${qty(l.qty)}</output><button data-inc style="height:34px" aria-label="Agregar">+</button></div></div>
            <strong>${money(l.price * l.qty)}</strong>
          </div>`).join('')}</div>
        <button class="btn ghost sm" data-clear style="margin-top:8px">Vaciar carrito</button>`}
      </div>
      ${lines.length ? `<footer>
        <div class="totals">
          <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div><span>Envío</span><span>${t.fee ? money(t.fee) : 'Gratis'}</span></div>
          <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        </div>
        ${t.missingForMin > 0 ? `<div class="alert warn small">${icon('info')}<div>El pedido mínimo es ${money(s.minimumOrder)}. Agrega ${money(t.missingForMin)} más.</div></div>` : ''}
        <button class="btn primary lg block" data-checkout ${t.missingForMin > 0 ? 'disabled' : ''}>Continuar con el pedido</button>
      </footer>` : ''}`;
  };

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-clear]')) return clearCart();
    if (e.target.closest('[data-checkout]')) { close(); ctx.navigate('#/checkout'); return; }
    const line = e.target.closest('.line');
    if (!line) return;
    const l = state.cart[line.dataset.id];
    if (!l) return;
    if (e.target.closest('[data-inc]')) setQty(l, l.qty + stepFor(l.unit));
    if (e.target.closest('[data-dec]')) setQty(l, l.qty - stepFor(l.unit));
  });

  const off = onCartChange(render);
  render();
}
