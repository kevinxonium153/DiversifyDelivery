// Clientes e inscripciones ($5): aprobar o rechazar transferencias, suspender o reactivar cuentas.
import { api } from '../api.js';
import { esc, icon, money, usd, statusBadge, fmtDateTime, modal, attempt, confirmDialog, waUrl, debounce } from '../ui.js';

export default {
  route: 'clientes', title: 'Clientes e inscripciones', icon: 'users',
  async render(el, ctx) {
    el.innerHTML = `<section class="card" id="pending" style="margin-bottom:16px"></section>
      <div class="toolbar"><div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Nombre, correo o teléfono"></div>
        <select id="st"><option value="">Todos</option><option value="Activo">Activos</option><option value="EnRevision">En revisión</option><option value="PendientePago">Pendientes de pago</option><option value="Suspendido">Suspendidos</option></select></div>
      <div id="tbl"></div>`;

    const drawPending = async () => {
      const list = await attempt(() => api.get('/admin/registrations', { status: 'EnRevision' })) || [];
      el.querySelector('#pending').innerHTML = `<div class="card-title"><h2>${icon('bank')} Transferencias por verificar</h2><span class="badge ${list.length ? 'st-EnRevision' : 'st-Activo'}">${list.length}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Referencia</th><th class="num">Monto</th><th>Enviado</th><th></th></tr></thead><tbody>
          ${list.map((p) => `<tr data-id="${p.id}"><td><strong>${esc(p.customer)}</strong><div class="small muted">${esc(p.email || '')} · ${esc(p.phone || '')}</div></td>
            <td class="mono">${esc(p.reference)}</td><td class="num">${money(p.amountHnl)}<div class="small muted">${usd(p.amountUsd)}</div></td><td>${fmtDateTime(p.createdAt)}</td>
            <td class="right"><div class="row" style="justify-content:flex-end"><button class="btn sm danger" data-reject>Rechazar</button><button class="btn sm success" data-approve>${icon('check')} Aprobar</button></div></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted" style="margin:0">No hay transferencias pendientes. Los pagos con tarjeta se aprueban solos.</p>'}`;
    };

    const draw = async () => {
      const list = await attempt(() => api.get('/admin/customers', { search: el.querySelector('#q').value, status: el.querySelector('#st').value })) || [];
      el.querySelector('#tbl').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Registro</th><th>Estado</th><th class="num">Pedidos</th><th class="num">Compras</th><th></th></tr></thead><tbody>
        ${list.map(({ user: u, orders, spent }) => `<tr data-user="${u.id}" data-status="${u.status}"><td><strong>${esc(u.fullName)}</strong><div class="small muted">${esc(u.email || u.login)}</div></td>
          <td>${u.phone ? `<a href="${waUrl(u.phone)}" target="_blank" rel="noopener">${esc(u.phone)}</a>` : '—'}</td><td>${fmtDateTime(u.createdAt)}</td><td>${statusBadge(u.status)}</td>
          <td class="num">${orders}</td><td class="num">${money(spent)}</td>
          <td class="right">${u.status === 'Suspendido' ? '<button class="btn sm" data-toggle>Reactivar</button>' : u.status === 'Activo' ? '<button class="btn sm ghost" data-toggle>Suspender</button>' : ''}</td></tr>`).join('')}
        </tbody></table></div><p class="small muted">${list.length} clientes</p>` : '<div class="empty">Sin clientes con esos filtros.</div>';
    };

    el.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      if (e.target.closest('[data-approve]')) {
        if (await attempt(() => api.post(`/admin/registrations/${row.dataset.id}/approve`, {}), 'Inscripción aprobada. La cuenta ya puede pedir.')) { drawPending(); draw(); ctx.refreshCounts(); }
      }
      if (e.target.closest('[data-reject]')) {
        modal({
          title: 'Rechazar transferencia',
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
