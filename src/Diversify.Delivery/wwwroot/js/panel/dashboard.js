// Tablero: pedidos y ventas del día, estados y últimos 7 días.
import { api } from '../api.js';
import { esc, icon, money, STATUS, fmtDate, attempt } from '../ui.js';

export default {
  route: 'tablero', title: 'Tablero', icon: 'chart',
  async render(el, ctx) {
    const load = async () => {
      const d = await attempt(() => api.get('/admin/dashboard'));
      if (!d) return;
      const max = Math.max(1, ...d.last7.map((x) => x.orders));
      el.innerHTML = `
        <div class="kpis">
          <div class="kpi glass"><div class="label">${icon('receipt')} Pedidos de hoy</div><div class="value">${d.ordersToday}</div><div class="hint">${money(d.pipelineToday)} en pedidos</div></div>
          <div class="kpi glass"><div class="label">${icon('cash')} Ventas entregadas hoy</div><div class="value">${money(d.salesToday)}</div><div class="hint">Ticket promedio ${money(d.avgTicket)}</div></div>
          <div class="kpi glass"><div class="label">${icon('clock')} Tiempo de entrega</div><div class="value">${d.avgDeliveryMinutes} min</div><div class="hint">Promedio 7 días (pedido → entregado)</div></div>
          <div class="kpi glass"><div class="label">${icon('bike')} Repartidores en turno</div><div class="value">${d.driversOnDuty}</div><div class="hint">${d.activeCustomers} clientes activos</div></div>
        </div>
        ${d.pendingRegistrations ? `<a class="alert warn" href="#/clientes" style="margin-top:14px;text-decoration:none">${icon('card')}<div><strong>${d.pendingRegistrations} ${d.pendingRegistrations === 1 ? 'pago de inscripción' : 'pagos de inscripción'} por revisar.</strong> Revisa la transferencia y activa la cuenta.</div></a>` : ''}
        <div class="grid-2" style="margin-top:16px">
          <section class="card">
            <div class="card-title"><h2>Pedidos por estado</h2><a class="btn sm" href="#/pedidos">Abrir tablero</a></div>
            <div class="status-row">${Object.entries(d.byStatus).map(([s, n]) => `<a class="s st-${s}" href="#/pedidos" style="text-decoration:none"><span class="small">${esc(STATUS[s])}</span><b>${n}</b></a>`).join('')}</div>
            <p class="small muted" style="margin:10px 0 0">Entregados y cancelados: solo los de hoy.</p>
          </section>
          <section class="card">
            <div class="card-title"><h2>Últimos 7 días</h2><span class="small muted">pedidos</span></div>
            <div class="bars">${d.last7.map((x) => `<div class="b" title="${x.orders} pedidos · ${money(x.sales)} entregado"><strong>${x.orders}</strong><i style="height:${Math.round((x.orders / max) * 120)}px"></i>${esc(fmtDate(x.date))}</div>`).join('')}</div>
          </section>
        </div>`;
    };
    await load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  },
};
