// Ajustes de la tienda (envío, mínimo, horario, suscripción, puntos, cuenta bancaria) y conexión con Diversify POS.
import { api } from '../api.js';
import { esc, icon, money, formData, attempt, fmtDateTime, toast } from '../ui.js';

export default {
  route: 'ajustes', title: 'Ajustes', icon: 'settings',
  async render(el) {
    const [s, dv] = await Promise.all([api.get('/admin/settings'), api.get('/admin/diversify')]);
    el.innerHTML = `<div class="grid-2" style="align-items:start">
      <form class="card stack" id="sf">
        <h2>Tienda</h2>
        <label class="check"><input type="checkbox" name="acceptingOrders" ${s.acceptingOrders ? 'checked' : ''}> <span><strong>Recibiendo pedidos</strong><br><span class="small muted">Desmárcalo para pausar la tienda (inventario, feriado, mucha demanda).</span></span></label>
        <label class="field"><span>Nombre del supermercado</span><input name="storeName" required value="${esc(s.storeName)}"></label>
        <div class="grid-2"><label class="field"><span>Teléfono</span><input name="storePhone" value="${esc(s.storePhone || '')}"></label>
          <label class="field"><span>Dirección</span><input name="storeAddress" value="${esc(s.storeAddress || '')}"></label></div>
        <div class="grid-2"><label class="field"><span>Abre (pedidos desde)</span><input name="opensAt" type="time" value="${esc(s.opensAt)}"></label>
          <label class="field"><span>Cierra (pedidos hasta)</span><input name="closesAt" type="time" value="${esc(s.closesAt)}"></label></div>
        <p class="small muted" style="margin:-4px 0 0">Misma hora de apertura y cierre = 24 horas.</p>
        <h3>Envío</h3>
        <div class="grid-3"><label class="field"><span>Costo de envío (L)</span><input name="deliveryFee" type="number" step="0.01" min="0" value="${s.deliveryFee}"></label>
          <label class="field"><span>Pedido mínimo (L)</span><input name="minimumOrder" type="number" step="0.01" min="0" value="${s.minimumOrder}"></label>
          <label class="field"><span>Envío gratis desde (L)</span><input name="freeDeliveryFrom" type="number" step="0.01" min="0" value="${s.freeDeliveryFrom}"></label></div>
        <h3>Suscripción de clientes</h3>
        <div class="grid-2"><label class="field"><span>Suscripción mensual (US$)</span><input name="registrationFeeUsd" type="number" step="0.01" min="0" value="${s.registrationFeeUsd}"></label>
          <label class="field"><span>Tipo de cambio (L por US$)</span><input name="exchangeRate" type="number" step="0.0001" min="0.01" value="${s.exchangeRate}"></label></div>
        <p class="small muted" style="margin:-4px 0 0">Se cobran ${money(s.registrationFeeUsd * s.exchangeRate)} al mes al cambio actual.</p>
        <h3>Puntos (1 punto = L 1)</h3>
        <div class="grid-2"><label class="field"><span>Puntos por compra (% del total)</span><input name="pointsPercent" type="number" step="0.1" min="0" max="20" value="${s.pointsPercent}"></label>
          <label class="field"><span>Puntos por invitado (% de sus compras)</span><input name="referralPercent" type="number" step="0.1" min="0" max="20" value="${s.referralPercent}"></label></div>
        <p class="small muted" style="margin:-4px 0 0">Se acreditan cuando el pedido se entrega. El segundo porcentaje lo gana quien invitó al cliente, en cada compra de ese cliente.</p>
        <label class="field"><span>Datos para transferencias (banco, cuenta, titular)</span><textarea name="bankInstructions">${esc(s.bankInstructions || '')}</textarea></label>
        <input type="hidden" name="storeLatitude" value="${s.storeLatitude ?? ''}"><input type="hidden" name="storeLongitude" value="${s.storeLongitude ?? ''}">
        <label class="check"><input type="checkbox" name="syncPrices" ${s.syncPrices ? 'checked' : ''}> <span>La sincronización con Diversify POS también actualiza precios<br><span class="small muted">Los que cambies a mano aquí no se tocan.</span></span></label>
        <button class="btn primary">Guardar ajustes</button>
      </form>

      <section class="card stack">
        <div class="card-title"><h2>${icon('sync')} Diversify POS</h2>${dv.configured ? '<span class="badge st-Activo">Conectado</span>' : '<span class="badge st-Pendiente">Sin configurar</span>'}</div>
        <p class="small muted" style="margin:0">Copia del sistema del supermercado los productos, precios, existencias y fotos. Diversify POS no se modifica: Delivery entra con un usuario de solo consulta (rol bodega).</p>
        ${dv.configured ? `<div class="small"><div>Servidor: <strong class="mono">${esc(dv.baseUrl)}</strong></div><div>Empresa: <strong>${esc(dv.company || 'principal')}</strong></div>
            <div>Automática: <strong>${dv.syncMinutes ? `cada ${dv.syncMinutes} min` : 'apagada (solo manual)'}</strong></div><div>Productos vinculados: <strong>${dv.linkedProducts}</strong></div></div>
          <button class="btn ink" id="sync">${icon('sync')} Sincronizar ahora</button>`
        : `<div class="alert info small">${icon('info')}<div>Configúralo en el servidor, en <span class="mono">/etc/diversify-delivery/delivery.env</span>:<br>
            <span class="mono">Diversify__BaseUrl=https://pos.diversify.hn<br>Diversify__Company=codigo<br>Diversify__Username=delivery<br>Diversify__Password=…<br>Diversify__SyncMinutes=15</span></div></div>`}
        <div class="small" id="last">${s.lastSyncAt ? `Última sincronización: ${fmtDateTime(s.lastSyncAt)}<br><span class="muted">${esc(s.lastSyncResult || '')}</span>` : 'Aún no se ha sincronizado.'}</div>
      </section>
    </div>`;

    el.querySelector('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      await attempt(() => api.put('/admin/settings', d), 'Ajustes guardados.');
    });
    el.querySelector('#sync')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const r = await attempt(() => api.post('/admin/diversify/sync'));
      e.currentTarget.disabled = false;
      if (r) { toast(r.message); el.querySelector('#last').innerHTML = `Última sincronización: ahora<br><span class="muted">${esc(r.message)}</span>`; }
    });
  },
};
