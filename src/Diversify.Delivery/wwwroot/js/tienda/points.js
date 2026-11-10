// Mis puntos: saldo (1 punto = L 1), cómo se ganan, código para invitar y movimientos.
import { api } from '../api.js';
import { esc, icon, money, attempt, toast, fmtDateTime, waUrl } from '../ui.js';
import { state } from './state.js';

const pts = (n) => new Intl.NumberFormat('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

export async function renderPoints(view, ctx) {
  if (state.user.role !== 'cliente') { ctx.navigate('#/'); return; }
  view.innerHTML = '<div class="empty">Cargando tus puntos…</div>';
  const p = await attempt(() => api.get('/points'));
  if (!p) { view.innerHTML = '<div class="empty">No pudimos cargar tus puntos. Intenta de nuevo.</div>'; return; }
  const invite = `¡Hola! Te invito a comprar el súper a domicilio en ${state.store.storeName}. Regístrate con mi código ${p.referralCode}: ${p.referralLink}`;
  view.innerHTML = `
    <div class="page-head"><h1>Mis puntos</h1></div>
    <div class="two-col">
      <div class="stack">
        <section class="card points-hero">
          <div class="small muted">Puntos acumulados</div>
          <div class="points-balance" id="balance">${pts(p.balance)}</div>
          <div class="points-value">Equivalen a <strong>${money(p.valueHnl)}</strong> · cada punto vale L 1</div>
        </section>

        <section class="card">
          <div class="card-title"><h2>${icon('gift')} Invita y gana</h2></div>
          <p style="margin:0 0 10px">Comparte tu código. Por <strong>cada compra</strong> de las personas que invites ganas el
            <strong>${esc(p.referralPercent)} %</strong> en puntos.</p>
          <div class="referral-code" aria-label="Tu código de invitación">${esc(p.referralCode)}</div>
          <div class="row" style="flex-wrap:wrap;margin-top:12px">
            <button class="btn" id="copy">${icon('copy')} Copiar enlace</button>
            <a class="btn primary" href="${waUrl('', invite)}" target="_blank" rel="noopener">${icon('chat')} Compartir por WhatsApp</a>
          </div>
          <div class="row between small" style="margin-top:14px">
            <span class="muted">Personas que invitaste</span><strong>${p.referrals}</strong></div>
          <div class="row between small"><span class="muted">Puntos ganados por tus invitados</span><strong>${pts(p.fromReferrals)}</strong></div>
        </section>
      </div>

      <aside class="stack">
        <section class="card small">
          <h3 style="margin-top:0">Cómo ganar puntos</h3>
          <ul class="points-how">
            <li>${icon('bag')}<span><strong>${esc(p.pointsPercent)} %</strong> del total de cada pedido, cuando se entrega.</span></li>
            <li>${icon('users')}<span><strong>${esc(p.referralPercent)} %</strong> de cada pedido entregado de quien se registre con tu código.</span></li>
          </ul>
          <p class="muted" style="margin:8px 0 0">Los pedidos cancelados no dan puntos. Si algo no había, se calcula con lo que realmente se entregó.</p>
        </section>
        <section class="card">
          <h3 style="margin-top:0">Movimientos</h3>
          ${p.entries.length ? `<ul class="points-list">${p.entries.map((e) => `<li>
              <div><div>${esc(e.description)}</div><div class="small muted">${fmtDateTime(e.createdAt)} · ${e.kind === 'Referido' ? 'Invitado' : e.kind === 'Compra' ? 'Compra' : 'Ajuste'}</div></div>
              <strong class="${e.points >= 0 ? 'plus' : 'minus'}">${e.points >= 0 ? '+' : ''}${pts(e.points)}</strong></li>`).join('')}</ul>`
            : '<p class="muted" style="margin:0">Aún no tienes puntos. Haz tu primer pedido o invita a alguien.</p>'}
        </section>
      </aside>
    </div>`;
  view.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p.referralLink); toast('Enlace copiado. ¡Compártelo!'); }
    catch { toast(`Tu enlace: ${p.referralLink}`); }
  });
}
