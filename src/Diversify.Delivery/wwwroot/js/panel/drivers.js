// Repartidores y usuarios master.
import { api } from '../api.js';
import { esc, icon, statusBadge, modal, formData, attempt, telUrl } from '../ui.js';

export default {
  route: 'repartidores', title: 'Repartidores y usuarios', icon: 'bike',
  async render(el, ctx) {
    ctx.actions.innerHTML = `<button class="btn primary" id="new">${icon('plus')} Nuevo usuario</button>`;
    let list = [];
    const draw = async () => {
      list = await attempt(() => api.get('/admin/users')) || [];
      el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Vehículo</th><th>Turno</th><th class="num">Activos</th><th class="num">Entregados hoy</th><th>Estado</th><th></th></tr></thead><tbody>
        ${list.map(({ user: u, activeOrders, deliveredToday }) => `<tr data-id="${u.id}"><td><strong>${esc(u.fullName)}</strong>${u.phone ? `<div class="small"><a href="${telUrl(u.phone)}">${esc(u.phone)}</a></div>` : ''}</td>
          <td class="mono">${esc(u.login)}</td><td>${u.role === 'master' ? '<span class="badge st-Listo plain">Master</span>' : '<span class="badge st-EnCamino plain">Repartidor</span>'}</td>
          <td class="small">${esc(u.vehicle || '—')}</td><td>${u.role === 'repartidor' ? (u.onDuty ? '<span class="badge st-Activo">En turno</span>' : '<span class="badge st-Pendiente">Fuera</span>') : ''}</td>
          <td class="num">${u.role === 'repartidor' ? activeOrders : ''}</td><td class="num">${u.role === 'repartidor' ? deliveredToday : ''}</td>
          <td>${statusBadge(u.status)}</td><td class="right"><button class="btn ghost icon sm" data-edit aria-label="Editar">${icon('edit')}</button></td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted">Los repartidores entran en <strong>${location.origin}/repartidor/</strong> desde su celular. Cada uno ve los pedidos listos, con dirección, referencias, instrucciones y botones para abrir Google Maps o Waze.</p>`;
    };
    const edit = (u) => {
      modal({
        title: u ? `Editar: ${u.fullName}` : 'Nuevo usuario',
        body: `<form class="stack" id="uf">
          <div class="grid-2"><label class="field"><span>Nombre *</span><input name="fullName" required value="${esc(u?.fullName || '')}"></label>
            <label class="field"><span>Usuario (para ingresar) *</span><input name="login" required value="${esc(u?.login || '')}" autocapitalize="off"></label></div>
          <div class="grid-2"><label class="field"><span>Rol</span><select name="role"><option value="repartidor" ${u?.role !== 'master' ? 'selected' : ''}>Repartidor</option><option value="master" ${u?.role === 'master' ? 'selected' : ''}>Master (administrador)</option></select></label>
            <label class="field"><span>Teléfono</span><input name="phone" value="${esc(u?.phone || '')}"></label></div>
          <div class="grid-2"><label class="field"><span>Vehículo / placa</span><input name="vehicle" value="${esc(u?.vehicle || '')}" placeholder="Moto Honda · HAA-1234"></label>
            <label class="field"><span>Estado</span><select name="status"><option ${u?.status !== 'Suspendido' ? 'selected' : ''}>Activo</option><option ${u?.status === 'Suspendido' ? 'selected' : ''}>Suspendido</option></select></label></div>
          <label class="field"><span>${u ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</span><input name="password" type="password" minlength="8" ${u ? '' : 'required'} autocomplete="new-password"></label>
        </form>`,
        actions: [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: async (close, mel) => {
          const f = mel.querySelector('#uf');
          if (!f.reportValidity()) return false;
          const r = await attempt(() => u ? api.put(`/admin/users/${u.id}`, formData(f)) : api.post('/admin/users', formData(f)), 'Usuario guardado.');
          if (!r) return false;
          draw();
          return undefined;
        } }],
      });
    };
    ctx.actions.querySelector('#new').addEventListener('click', () => edit(null));
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) edit(list.find((x) => x.user.id === Number(e.target.closest('tr').dataset.id)).user);
    });
    await draw();
  },
};
