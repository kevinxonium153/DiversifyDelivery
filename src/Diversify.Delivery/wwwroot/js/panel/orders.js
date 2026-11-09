// Tablero de pedidos (kanban): Recibido → Preparando → Listo → En camino. Detalle con ajuste de productos,
// asignación de repartidor y cambio de estado. Se actualiza solo cada 15 s.
import { api } from '../api.js';
import { esc, icon, money, qty, statusBadge, STATUS, ago, fmtDateTime, fmtTime, payLabel, modal, attempt, toast, mapsUrl, telUrl, waUrl } from '../ui.js';

const COLUMNS = ['Recibido', 'Preparando', 'Listo', 'EnCamino'];
const NEXT = {
  Recibido: { to: 'Preparando', label: 'Empezar a armar', kind: 'primary' },
  Preparando: { to: 'Listo', label: 'Marcar listo para salir', kind: 'primary' },
  Listo: { to: 'EnCamino', label: 'Despachar (en camino)', kind: 'primary' },
  EnCamino: { to: 'Entregado', label: 'Marcar entregado', kind: 'success' },
};

function card(o) {
  const minutes = Math.round((Date.now() - new Date(o.createdAt)) / 60000);
  const late = o.status !== 'EnCamino' && minutes > 45;
  return `<article class="ocard" data-id="${o.id}" tabindex="0">
    <div class="head"><span class="num">${esc(o.number)}</span><span class="small ${late ? 'late' : 'muted'}">${ago(o.createdAt)}</span></div>
    <div class="who">${esc(o.deliveryName)}</div>
    <div class="meta"><span>${icon('pin')} ${esc(o.neighborhood || o.city)}</span><span>${icon('bag')} ${o.itemCount}</span><strong>${money(o.total)}</strong></div>
    <div class="meta"><span>${icon('cash')} ${esc(payLabel(o.paymentMethod))}</span>${o.instructions ? `<span title="${esc(o.instructions)}">${icon('chat')} Instrucciones</span>` : ''}</div>
    ${o.driverName ? `<div class="driver">${icon('bike')} ${esc(o.driverName)}</div>` : (o.status === 'Listo' ? `<div class="driver" style="color:var(--warning)">${icon('alert')} Sin repartidor</div>` : '')}
  </article>`;
}

export default {
  route: 'pedidos', title: 'Pedidos', icon: 'receipt',
  async render(el, ctx) {
    let view = 'board';
    let drivers = [];
    ctx.actions.innerHTML = `<div class="chips" style="padding:0"><button class="chip" data-v="board" aria-pressed="true">Tablero</button><button class="chip" data-v="history" aria-pressed="false">Historial</button></div>`;
    ctx.actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      view = b.dataset.v;
      ctx.actions.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      load();
    });

    const load = async () => {
      if (view === 'history') return loadHistory();
      const list = await attempt(() => api.get('/admin/orders', { status: 'activos' }));
      if (!list) return;
      el.innerHTML = `<div class="board">${COLUMNS.map((s) => {
        const items = list.filter((o) => o.status === s).sort((a, b) => a.id - b.id);
        return `<section class="col"><header>${statusBadge(s)}<span class="n">${items.length}</span></header>
          <div class="cards">${items.map(card).join('') || '<div class="empty small" style="padding:20px 6px">Sin pedidos</div>'}</div></section>`;
      }).join('')}</div>`;
    };

    const loadHistory = async () => {
      el.innerHTML = `<div class="toolbar"><div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Número, cliente o teléfono"></div>
        <select id="st"><option value="">Todos</option><option>Entregado</option><option>Cancelado</option></select>
        <input class="input" type="date" id="d" style="width:auto"></div><div id="tbl"></div>`;
      const draw = async () => {
        const list = await attempt(() => api.get('/admin/orders', { search: el.querySelector('#q').value, status: el.querySelector('#st').value, date: el.querySelector('#d').value })) || [];
        el.querySelector('#tbl').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Repartidor</th><th>Pago</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
          ${list.map((o) => `<tr class="ocard-row" data-id="${o.id}" style="cursor:pointer"><td class="mono">${esc(o.number)}</td><td>${fmtDateTime(o.createdAt)}</td><td>${esc(o.deliveryName)}<div class="small muted">${esc(o.deliveryPhone)}</div></td>
            <td>${esc(o.driverName || '—')}</td><td>${esc(o.paymentMethod)}</td><td>${statusBadge(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Sin pedidos con esos filtros.</div>';
      };
      el.querySelectorAll('#q,#st,#d').forEach((i) => i.addEventListener('change', draw));
      el.querySelector('#q').addEventListener('input', () => { clearTimeout(el._t); el._t = setTimeout(draw, 300); });
      draw();
    };

    const open = async (id) => {
      const [o, staff] = await Promise.all([api.get(`/admin/orders/${id}`), api.get('/admin/users', { role: 'repartidor' })]);
      drivers = staff.filter((d) => d.user.status === 'Activo');
      const editable = ['Recibido', 'Preparando'].includes(o.status);
      const closed = ['Entregado', 'Cancelado'].includes(o.status);
      const next = NEXT[o.status];
      const m = modal({
        title: `Pedido ${o.number}`, wide: true,
        body: `<div class="row between" style="margin-bottom:12px">${statusBadge(o.status)}<span class="small muted">${fmtDateTime(o.createdAt)}</span></div>
          <div class="detail-grid">
            <div class="stack">
              <section class="card flat">
                <div class="card-title"><h3>Productos (${o.itemCount})</h3>${editable ? '<span class="small muted">Cantidad a despachar · 0 = no hay</span>' : ''}</div>
                <div class="lines">${o.items.map((i) => `<div class="line ${i.fulfilledQuantity === 0 ? 'out' : ''}" style="grid-template-columns:1fr auto auto">
                  <div><div class="t">${esc(i.name)}</div><div class="small muted mono">${esc(i.code)} · ${qty(i.quantity)} ${esc(i.unit)} × ${money(i.price)}</div>${i.note ? `<div class="small">📝 ${esc(i.note)}</div>` : ''}</div>
                  ${editable ? `<input class="fulfill-qty" type="number" min="0" step="0.5" data-line="${i.id}" value="${i.fulfilledQuantity ?? i.quantity}" aria-label="Cantidad a despachar de ${esc(i.name)}">` : `<span class="small">${i.fulfilledQuantity === 0 ? 'No había' : ''}</span>`}
                  <strong>${money(i.lineTotal)}</strong></div>`).join('')}</div>
                ${editable ? '<button class="btn sm" id="save-items" style="margin-top:10px">Guardar ajustes y recalcular</button>' : ''}
                <div class="totals" style="margin-top:12px"><div><span>Subtotal</span><span>${money(o.subtotal)}</span></div><div><span>Envío</span><span>${o.deliveryFee ? money(o.deliveryFee) : 'Gratis'}</span></div><div class="grand"><span>Total</span><span>${money(o.total)}</span></div></div>
                <p class="small" style="margin:10px 0 0">${icon('cash')} <strong>${esc(payLabel(o.paymentMethod))}</strong>${o.cashGiven ? ` · paga con ${money(o.cashGiven)} → cambio ${money(o.change)}` : ''}${o.paymentReference ? ` · ref. ${esc(o.paymentReference)}` : ''}</p>
                <p class="small" style="margin:4px 0 0">${o.allowSubstitutions ? '✅ Acepta sustituciones' : '⛔ No sustituir: quitar lo que no haya'}</p>
              </section>
            </div>
            <div class="stack">
              <section class="card flat small">
                <h3>${esc(o.deliveryName)}</h3>
                <div class="row"><a class="btn sm" href="${telUrl(o.deliveryPhone)}">${icon('phone')} ${esc(o.deliveryPhone)}</a><a class="btn sm" href="${waUrl(o.deliveryPhone, `Hola ${o.deliveryName}, le escribimos de su pedido ${o.number}.`)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a></div>
                <p style="margin:10px 0 0">${icon('pin')} ${esc(o.addressLine)}, ${esc(o.neighborhood || '')} ${esc(o.city)}${o.reference ? `<br><span class="muted">Ref.: ${esc(o.reference)}</span>` : ''}</p>
                ${o.latitude != null ? `<a class="btn sm" style="margin-top:8px" href="${mapsUrl(o.latitude, o.longitude)}" target="_blank" rel="noopener">${icon('nav')} Ver en el mapa</a>` : '<p class="muted">Sin ubicación GPS.</p>'}
                ${o.instructions ? `<div class="alert warn" style="margin-top:10px">${icon('chat')}<div>${esc(o.instructions)}</div></div>` : ''}
                <p style="margin:10px 0 0">Código de entrega: <strong class="mono">${esc(o.deliveryPin)}</strong> <span class="muted">(lo tiene el cliente)</span></p>
              </section>
              ${!closed ? `<section class="card flat"><h3>Repartidor</h3>
                <div class="row"><select class="input grow" id="driver"><option value="">— Sin asignar —</option>
                  ${drivers.map((d) => `<option value="${d.user.id}" ${d.user.id === o.driverId ? 'selected' : ''}>${esc(d.user.fullName)} ${d.user.onDuty ? '· en turno' : '· fuera de turno'} (${d.activeOrders} activos)</option>`).join('')}</select>
                  <button class="btn sm" id="assign">Asignar</button></div></section>` : ''}
              <section class="card flat"><h3>Historial</h3><ul class="timeline small">${o.events.slice().reverse().map((e) => `<li><div>${esc(e.message)}<div class="muted">${fmtTime(e.at)} · ${esc(e.by)}</div></div></li>`).join('')}</ul></section>
            </div>
          </div>`,
        actions: closed ? [{ label: 'Cerrar' }] : [
          { label: 'Cancelar pedido', kind: 'danger', onClick: () => { cancel(o); } },
          ...(next ? [{ label: next.label, kind: next.kind, onClick: async () => {
            if (next.to === 'EnCamino' && !o.driverId) { toast('Asigna un repartidor antes de despacharlo.', 'error'); return false; }
            if (await attempt(() => api.post(`/admin/orders/${o.id}/status`, { status: next.to }), `Pedido ${o.number}: ${STATUS[next.to]}`)) { load(); ctx.refreshCounts(); }
            return undefined;
          } }] : []),
        ],
      });
      m.el.querySelector('#save-items')?.addEventListener('click', async () => {
        const items = [...m.el.querySelectorAll('[data-line]')].map((i) => ({ id: Number(i.dataset.line), fulfilledQuantity: Number(i.value) }));
        if (await attempt(() => api.put(`/admin/orders/${o.id}/items`, { items }), 'Pedido ajustado.')) { m.close(); open(o.id); load(); }
      });
      m.el.querySelector('#assign')?.addEventListener('click', async () => {
        const v = m.el.querySelector('#driver').value;
        if (await attempt(() => api.post(`/admin/orders/${o.id}/assign`, { driverId: v ? Number(v) : null }), 'Repartidor actualizado.')) { m.close(); open(o.id); load(); }
      });
    };

    const cancel = (o) => {
      modal({
        title: `Cancelar ${o.number}`,
        body: `<label class="field"><span>Motivo (el cliente lo verá)</span><textarea id="reason" required placeholder="Ej.: dirección fuera de cobertura, el cliente no responde…"></textarea></label>`,
        actions: [{ label: 'Volver' }, { label: 'Cancelar pedido', kind: 'danger', onClick: async (close, mel) => {
          const reason = mel.querySelector('#reason').value.trim();
          if (!reason) { toast('Escribe el motivo.', 'error'); return false; }
          if (await attempt(() => api.post(`/admin/orders/${o.id}/cancel`, { reason }), 'Pedido cancelado.')) { load(); ctx.refreshCounts(); return undefined; }
          return false;
        } }],
      });
    };

    el.addEventListener('click', (e) => {
      const c = e.target.closest('.ocard, .ocard-row');
      if (c) open(Number(c.dataset.id));
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.ocard')) open(Number(e.target.dataset.id)); });

    await load();
    const t = setInterval(() => { if (view === 'board' && !document.querySelector('.modal-backdrop')) load(); }, 15000);
    return () => clearInterval(t);
  },
};
