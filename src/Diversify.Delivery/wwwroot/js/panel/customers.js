// Clientes y suscripciones ($5 al mes): aprobar o rechazar pagos, ver vencimiento, puntos e invitados; suspender o reactivar.
import { api } from '../api.js';
import { esc, icon, money, usd, statusBadge, fmtDateTime, fmtDate, modal, attempt, confirmDialog, waUrl, debounce } from '../ui.js';

export default {
  route: 'clientes', title: 'Clientes y suscripciones', icon: 'users',
  async render(el, ctx) {
    el.innerHTML = `<section class="card" id="pending" style="margin-bottom:16px"></section>
      <div class="toolbar"><div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Nombre, correo o teléfono"></div>
        <select id="st"><option value="">Todos</option><option value="Activo">Activos</option><option value="EnRevision">En revisión</option><option value="PendientePago">Pendientes de pago</option><option value="Suspendido">Suspendidos</option></select></div>
      <div id="tbl"></div>`;

    const drawPending = async () => {
      const list = await attempt(() => api.get('/admin/registrations', { status: 'EnRevision' })) || [];
      el.querySelector('#pending').innerHTML = `<div class="card-title"><h2>${icon('bank')} Pagos por verificar</h2><span class="badge ${list.length ? 'st-EnRevision' : 'st-Activo'}">${list.length}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Forma de pago</th><th class="num">Monto</th><th>Enviado</th><th></th></tr></thead><tbody>
          ${list.map((p) => `<tr data-id="${p.id}"><td><strong>${esc(p.customer)}</strong><div class="small muted">${esc(p.email || '')} · ${esc(p.phone || '')}</div></td>
            <td>${p.method === 'Tarjeta' ? `<strong>Tarjeta · PixelPay</strong><div class="small muted mono">${esc(p.gatewayId || '')}</div><div class="small">${esc(p.notes || '')}</div><div class="small">Confírmalo en el portal de PixelPay antes de aprobar.</div>`
              : `<strong>Transferencia</strong><div class="mono">${esc(p.reference)}</div>`}</td><td class="num">${money(p.amountHnl)}<div class="small muted">${usd(p.amountUsd)}</div></td><td>${fmtDateTime(p.createdAt)}</td>
            <td class="right"><div class="row" style="justify-content:flex-end"><button class="btn sm danger" data-reject>Rechazar</button><button class="btn sm success" data-approve>${icon('check')} Aprobar</button></div></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted" style="margin:0">No hay pagos por verificar. Los pagos con tarjeta que PixelPay confirma se aprueban solos.</p>'}`;
    };

    const draw = async () => {
      const list = await attempt(() => api.get('/admin/customers', { search: el.querySelector('#q').value, status: el.querySelector('#st').value })) || [];
      el.querySelector('#tbl').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Registro</th><th>Estado</th><th>Suscripción hasta</th><th class="num">Pedidos</th><th class="num">Compras</th><th class="num">Puntos</th><th class="num">Invitados</th><th></th></tr></thead><tbody>
        ${list.map(({ user: u, orders, spent, points, referrals }) => `<tr data-user="${u.id}" data-status="${u.status}"><td><strong>${esc(u.fullName)}</strong><div class="small muted">${esc(u.email || u.login)}</div></td>
          <td>${u.phone ? `<a href="${waUrl(u.phone)}" target="_blank" rel="noopener">${esc(u.phone)}</a>` : '—'}</td><td>${fmtDateTime(u.createdAt)}</td><td>${statusBadge(u.status)}</td>
          <td class="small">${u.subscriptionEndsAt ? `${fmtDate(u.subscriptionEndsAt)}${new Date(u.subscriptionEndsAt) < new Date() ? ' <span class="muted">(vencida)</span>' : ''}` : '—'}</td>
          <td class="num">${orders}</td><td class="num">${money(spent)}</td><td class="num">${Number(points).toFixed(2)}</td><td class="num">${referrals}<div class="small muted mono">${esc(u.referralCode || '')}</div></td>
          <td class="right">${u.status === 'Suspendido' ? '<button class="btn sm" data-toggle>Reactivar</button>' : u.status === 'Activo' ? '<button class="btn sm ghost" data-toggle>Suspender</button>' : ''}</td></tr>`).join('')}
        </tbody></table></div><p class="small muted">${list.length} clientes</p>` : '<div class="empty">Sin clientes con esos filtros.</div>';
    };

    el.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      if (e.target.closest('[data-approve]')) {
        if (await attempt(() => api.post(`/admin/registrations/${row.dataset.id}/approve`, {}), 'Pago aprobado: se sumó un mes a la suscripción.')) { drawPending(); draw(); ctx.refreshCounts(); }
      }
      if (e.target.closest('[data-reject]')) {
        modal({
          title: 'Rechazar pago',
          body: '<label class="field"><span>Motivo (el cliente lo verá)</span><textarea id="n">No encontramos la transferencia con esa referencia.</textarea></label>',
          actions: [{ label: 'Volver' }, { label: 'Rechazar', kind: 'danger', onClick: async (close, mel) => {
            if (await attempt(() => api.post(`/admin/registrations/${row.dataset.id}/reject`, { notes: mel.querySelector('#n').value }), 'Pago rechazado.')) { drawPending(); draw(); ctx.refreshCounts(); return undefined; }
            return false;
          } }],
        });
      }
      if (e.target.closest('[data-toggle]')) {
        const suspend = row.dataset.status === 'Activo';
        if (!await confirmDialog(suspend ? 'Suspender cliente' : 'Reactivar cliente', suspend ? 'No podrá iniciar sesión ni hacer pedidos.' : 'Podrá volver a pedir.', { kind: suspend ? 'danger' : 'primary' })) return;
        if (await attempt(() => api.post(`/admin/customers/${row.dataset.user}/status`, { status: suspend ? 'Suspendido' : 'Activo' }), 'Cliente actualizado.')) draw();
      }
    });
    el.querySelector('#q').addEventListener('input', debounce(draw, 300));
    el.querySelector('#st').addEventListener('change', draw);
    await Promise.all([drawPending(), draw()]);
  },
};
