// Mis pedidos y detalle con seguimiento en vivo (se actualiza cada 20 s).
import { api } from '../api.js';
import { esc, icon, money, qty, statusBadge, steps, fmtDateTime, fmtTime, ago, payLabel, attempt, confirmDialog, telUrl, waUrl } from '../ui.js';

export async function renderOrders(view) {
  view.innerHTML = `<div class="page-head"><h1>Mis pedidos</h1></div><div id="list" class="stack"><div class="empty">Cargando…</div></div>`;
  const list = await attempt(() => api.get('/orders')) || [];
  const box = view.querySelector('#list');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="big">🧾</div>Aún no tienes pedidos. <a href="#/">Empieza a comprar</a></div>`;
    return;
  }
  box.innerHTML = list.map((o) => `<a class="card order-card" href="#/pedido/${o.id}" style="text-decoration:none;color:inherit">
    <div class="row between"><strong>${esc(o.number)}</strong>${statusBadge(o.status)}</div>
    ${o.status !== 'Entregado' ? steps(o.status) : ''}
    <div class="row between small"><span class="muted">${fmtDateTime(o.createdAt)} · ${o.itemCount} productos</span><strong>${money(o.total)}</strong></div>
  </a>`).join('');
}

export async function renderOrder(view, ctx, id) {
  let timer;
  const load = async () => {
    const o = await attempt(() => api.get(`/orders/${id}`));
    if (!o) { view.innerHTML = '<div class="empty">No encontramos ese pedido.</div>'; return; }
    const open = !['Entregado', 'Cancelado'].includes(o.status);
    view.innerHTML = `
      <div class="page-head"><a class="btn ghost icon" href="#/pedidos" aria-label="Volver">←</a><h1>Pedido ${esc(o.number)}</h1>${statusBadge(o.status)}</div>
      <div class="two-col">
        <div class="stack">
          <section class="card">
            ${steps(o.status)}
            <p style="margin:10px 0 0">${esc(o.events.at(-1)?.message || '')} <span class="muted small">${ago(o.updatedAt)}</span></p>
          </section>
          ${open ? `<section class="card row between">
            <div><div class="small muted">Código de entrega</div><div class="pin" aria-label="Código ${esc(o.deliveryPin)}">${esc(o.deliveryPin)}</div></div>
            <p class="small muted grow" style="max-width:320px">Díctale este código al repartidor <strong>solo cuando tengas tu pedido en la mano</strong>. Así confirmamos que te llegó a ti.</p>
          </section>` : ''}
          ${o.driverName && open ? `<section class="card row between">
            <div class="row">${icon('bike')}<div><strong>${esc(o.driverName)}</strong><div class="small muted">${esc(o.driverVehicle || 'Repartidor')}</div></div></div>
            ${o.driverPhone ? `<div class="row"><a class="btn sm" href="${telUrl(o.driverPhone)}">${icon('phone')} Llamar</a>
              <a class="btn sm" href="${waUrl(o.driverPhone, `Hola, soy ${o.deliveryName} (pedido ${o.number}).`)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a></div>` : ''}
          </section>` : ''}
          <section class="card">
            <div class="card-title"><h2>Productos</h2><span class="muted small">${o.itemCount}</span></div>
            <div class="lines">${o.items.map((i) => `<div class="line ${i.fulfilledQuantity === 0 ? 'out' : ''}">
              <div class="mini">${esc(i.icon || '🛒')}</div>
              <div><div class="t">${esc(i.name)}</div><div class="small muted">${qty(i.quantity)} × ${money(i.price)}
                ${i.fulfilledQuantity === 0 ? ' · <strong style="color:var(--danger)">No disponible</strong>' : i.fulfilledQuantity != null ? ` · se despachan ${qty(i.fulfilledQuantity)}` : ''}</div></div>
              <strong>${money(i.lineTotal)}</strong></div>`).join('')}</div>
          </section>
        </div>
        <aside class="stack">
          <section class="card">
            <div class="totals">
              <div><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
              <div><span>Envío</span><span>${o.deliveryFee ? money(o.deliveryFee) : 'Gratis'}</span></div>
              <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
            </div>
            <p class="small" style="margin:10px 0 0">${icon('cash')} ${esc(payLabel(o.paymentMethod))}${o.cashGiven ? ` · pagas con ${money(o.cashGiven)} (cambio ${money(o.change)})` : ''}</p>
          </section>
          <section class="card small">
            <div class="row" style="align-items:flex-start">${icon('pin')}<div><strong>${esc(o.addressLine)}</strong><br>${esc(o.neighborhood || '')} ${esc(o.city)}
              ${o.reference ? `<br><span class="muted">Ref.: ${esc(o.reference)}</span>` : ''}</div></div>
            ${o.instructions ? `<p style="margin:10px 0 0"><strong>Instrucciones:</strong> ${esc(o.instructions)}</p>` : ''}
          </section>
          <section class="card">
            <h3>Historial</h3>
            <ul class="timeline">${o.events.slice().reverse().map((e) => `<li><div>${esc(e.message)}<div class="small muted">${fmtTime(e.at)} · ${esc(e.by)}</div></div></li>`).join('')}</ul>
          </section>
          ${o.status === 'Recibido' ? '<button class="btn danger block" id="cancel">Cancelar pedido</button>' : ''}
        </aside>
      </div>`;
    view.querySelector('#cancel')?.addEventListener('click', async () => {
      if (!await confirmDialog('Cancelar pedido', '¿Seguro que quieres cancelar este pedido?', { okLabel: 'Sí, cancelar', kind: 'danger' })) return;
      if (await attempt(() => api.post(`/orders/${id}/cancel`, { reason: 'Cancelado por el cliente.' }), 'Pedido cancelado.')) load();
    });
    clearTimeout(timer);
    if (open) timer = setTimeout(load, 20000);
  };
  await load();
  return () => clearTimeout(timer);
}
