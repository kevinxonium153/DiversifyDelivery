// Ingresar, crear cuenta (con código de invitación), suscripción mensual ($5) y Mi cuenta (datos y direcciones).
import { api } from '../api.js';
import { logoDelivery } from '../brand.js';
import { esc, icon, money, usd, formData, attempt, toast, confirmDialog, statusBadge, fmtDay } from '../ui.js';
import { state, loadSession } from './state.js';
import { addressModal } from './checkout.js';

function afterLogin(ctx) {
  const next = sessionStorage.getItem('dd.after-login');
  sessionStorage.removeItem('dd.after-login');
  const u = state.user;
  if (u.role === 'master') { location.href = '/panel/'; return; }
  if (u.role === 'repartidor') { location.href = '/repartidor/'; return; }
  if (u.status !== 'Activo') { ctx.navigate('#/inscripcion'); return; }
  ctx.navigate(next || '#/');
}

export function renderLogin(view, ctx) {
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px">
    <form class="auth-card glass" id="login">
      <div class="brand">${logoDelivery({ height: 48 })}<h1 style="font-size:22px;margin:10px 0 0">Ingresa a tu cuenta</h1></div>
      <label class="field"><span>Correo o usuario</span><input name="login" autocomplete="username" required></label>
      <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary lg block">Ingresar</button>
      <a class="small" href="#/recuperar" style="text-align:center">¿Olvidaste tu contraseña?</a>
      <p class="small muted" style="text-align:center;margin:0">¿No tienes cuenta? <a href="#/registro">Crea una aquí</a></p>
    </form></div>`;
  view.querySelector('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await attempt(() => api.post('/auth/login', formData(e.target)));
    if (!user) return;
    state.user = user;
    ctx.refreshBar();
    afterLogin(ctx);
  });
}

export function renderRegister(view, ctx, ref) {
  const s = state.store;
  // El código del enlace de invitación se recuerda aunque la persona navegue antes de registrarse.
  try { if (ref) sessionStorage.setItem('dd.ref', ref.toUpperCase()); } catch { /* modo privado */ }
  let code = ref || '';
  try { code = code || sessionStorage.getItem('dd.ref') || ''; } catch { /* modo privado */ }
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px">
    <form class="auth-card glass" id="register">
      <div class="brand">${logoDelivery({ height: 48 })}<h1 style="font-size:22px;margin:10px 0 0">Crea tu cuenta</h1>
        <div class="steps-reg"><span class="on"><b>1</b> Tus datos</span> → <span><b>2</b> Suscripción ${usd(s.registrationFeeUsd)}/mes</span> → <span><b>3</b> ¡A comprar!</span></div></div>
      ${code ? `<div class="alert ok small">${icon('gift')}<div>Te invitaron con el código <strong>${esc(code.toUpperCase())}</strong>.</div></div>` : ''}
      <label class="field"><span>Nombre completo</span><input name="fullName" autocomplete="name" required maxlength="120"></label>
      <label class="field"><span>Correo electrónico</span><input name="email" type="email" autocomplete="email" required maxlength="120"></label>
      <label class="field"><span>Teléfono (WhatsApp)</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="9999-9999" required maxlength="30"></label>
      <label class="field"><span>Contraseña (mínimo 8 caracteres)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Código de invitación (opcional)</span><input name="referralCode" maxlength="12" autocapitalize="characters" value="${esc(code.toUpperCase())}" placeholder="Si alguien te invitó"></label>
      <label class="check small"><input type="checkbox" required> <span>Acepto los términos del servicio y la <strong>suscripción mensual de ${usd(s.registrationFeeUsd)} (${money(s.registrationFeeHnl)})</strong>. Se paga cada mes con tarjeta o transferencia; si no la renuevas, solo dejas de poder pedir.</span></label>
      <button class="btn primary lg block">Continuar</button>
      <p class="small muted" style="text-align:center;margin:0">¿Ya tienes cuenta? <a href="#/ingresar">Ingresa</a></p>
    </form></div>`;
  view.querySelector('#register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await attempt(() => api.post('/auth/register', formData(e.target)));
    if (!user) return;
    try { sessionStorage.removeItem('dd.ref'); } catch { /* modo privado */ }
    state.user = user;
    ctx.refreshBar();
    ctx.navigate('#/inscripcion');
  });
}

// Suscripción mensual: primer pago, renovación (vencida) o pago por adelantado (activa).
// result: lo que pasó en el checkout de PixelPay (#/inscripcion/ok | cancelado | error).
export async function renderInscription(view, ctx, result) {
  if (state.user.role !== 'cliente') { ctx.navigate('#/'); return; }
  const info = await attempt(() => api.get('/registration'));
  if (!info) return;
  if (state.user.status !== info.status || state.user.subscriptionEndsAt !== info.subscriptionEndsAt) { await loadSession(); ctx.refreshBar(); }
  const active = info.status === 'Activo';
  const reviewing = info.status === 'EnRevision';
  const first = !info.subscriptionEndsAt;
  const last = info.lastPayment;
  const days = info.subscriptionEndsAt ? Math.ceil((new Date(info.subscriptionEndsAt) - Date.now()) / 86400000) : 0;
  const price = `${usd(info.feeUsd)} al mes`;

  const methods = `<div class="stack">
      <label class="option"><input type="radio" name="m" value="card" ${info.card.enabled ? 'checked' : 'disabled'}>${icon('card', 'lead')}
        <div class="grow"><div class="t">Tarjeta de crédito o débito</div><div class="small muted">${info.card.enabled ? 'Aprobación inmediata con PixelPay.' : 'Disponible pronto.'}</div></div></label>
      <label class="option"><input type="radio" name="m" value="transfer" ${info.card.enabled ? '' : 'checked'}>${icon('bank', 'lead')}
        <div class="grow"><div class="t">Transferencia o depósito</div><div class="small muted">${active ? 'Se suma un mes cuando confirmamos el pago.' : 'Se activa cuando confirmamos el pago.'}</div></div></label>
    </div><div id="pay-box"></div>`;

  const head = active
    ? `<div style="font-size:52px">${result === 'ok' ? '🎉' : '✅'}</div>
       <h1 style="font-size:22px;margin:6px 0 0">${result === 'ok' ? '¡Pago aprobado!' : 'Tu suscripción está activa'}</h1>
       <p style="margin:6px 0 0">Pagada hasta el <strong>${fmtDay(info.subscriptionEndsAt)}</strong>${days > 0 ? ` <span class="muted">(${days} ${days === 1 ? 'día' : 'días'})</span>` : ''}.</p>`
    : `${first ? '<div class="steps-reg"><span><b>✓</b> Tus datos</span> → <span class="on"><b>2</b> Suscripción</span> → <span><b>3</b> ¡A comprar!</span></div>' : ''}
       <h1 style="font-size:22px;margin:10px 0 0">${first ? 'Activa tu cuenta' : 'Renueva tu suscripción'}</h1>
       <p class="muted" style="margin:0">Suscripción mensual para comprar en línea y recibir a domicilio. Además ganas puntos con cada compra.</p>
       <div class="pay-amount">${usd(info.feeUsd)}<span class="small muted" style="font-size:16px;font-weight:600"> / mes</span></div>
       <div class="muted small">${money(info.feeHnl)} al cambio de L ${info.exchangeRate}</div>`;

  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:10px">
    <div class="auth-card glass" style="width:min(520px,100%)">
      <div class="brand" ${active ? 'style="text-align:center"' : ''}>${head}</div>

      ${!active && !first && !reviewing ? `<div class="alert warn">${icon('clock')}<div><strong>Tu suscripción venció el ${fmtDay(info.subscriptionEndsAt)}.</strong> Renuévala para seguir pidiendo. Tus puntos se conservan.</div></div>` : ''}
      ${reviewing ? `<div class="alert info">${icon('clock')}<div><strong>Estamos verificando tu pago</strong>${last?.reference ? ` (ref. ${esc(last.reference)})` : ''}. Normalmente toma menos de una hora en horario de tienda.</div></div>` : ''}
      ${result === 'cancelado' && !reviewing ? `<div class="alert info">${icon('info')}<div><strong>No se hizo ningún cobro.</strong> Cancelaste el pago en PixelPay; puedes intentarlo de nuevo cuando quieras.</div></div>` : ''}
      ${result === 'error' && !reviewing ? `<div class="alert err">${icon('alert')}<div><strong>No pudimos confirmar el pago con PixelPay.</strong> Si se hizo el cargo a tu tarjeta, escríbenos y lo revisamos; si no, intenta de nuevo.</div></div>` : ''}
      ${last?.status === 'Rechazado' && !active ? `<div class="alert err">${icon('alert')}<div><strong>No pudimos confirmar tu pago anterior.</strong> ${esc(last.notes || '')}</div></div>` : ''}

      ${active ? `<a class="btn primary lg block" href="#/">Ir a comprar</a>
        ${info.canPayAhead ? `<details class="pay-ahead"><summary>Pagar el siguiente mes por adelantado (${price})</summary>${methods}</details>`
          : '<p class="small muted" style="text-align:center;margin:0">Ya tienes pagado el mes siguiente.</p>'}`
        : reviewing ? `<button class="btn block" id="refresh">${icon('sync')} Revisar estado</button>` : methods}
      <a class="small" href="${active ? '#/puntos' : '#/'}" style="text-align:center">${active ? 'Ver mis puntos' : 'Seguir viendo el catálogo'}</a>
    </div></div>`;

  const box = view.querySelector('#pay-box');
  const drawMethod = () => {
    if (!box) return;
    const m = view.querySelector('input[name=m]:checked')?.value;
    box.innerHTML = m === 'card' ? (info.card.provider === 'pixelpay' ? `<div class="fake-gateway stack">
        <div class="row between"><strong>${esc(info.card.name)}</strong>${icon('shield')}</div>
        <p class="small muted" style="margin:0">Te llevamos a la página segura de PixelPay para pagar con Visa o Mastercard. Escribes tu tarjeta allá: nosotros no la vemos ni la guardamos. Al terminar vuelves aquí.</p>
        <button class="btn primary lg block" id="pay-card">${icon('card')} Pagar ${info.card.currency === 'USD' ? usd(info.feeUsd) : money(info.feeHnl)} con PixelPay</button></div>`
      : `<div class="fake-gateway stack">
        <div class="row between"><strong>${esc(info.card.name)}</strong><span class="badge st-EnRevision plain">MODO DE PRUEBA</span></div>
        <p class="small muted" style="margin:0">Pasarela simulada de desarrollo: el pago se aprueba sin cobrar. En el servidor real se usa PixelPay.</p>
        <button class="btn primary lg block" id="pay-card">${icon('card')} Pagar ${usd(info.feeUsd)}</button></div>`)
      : `<form class="stack" id="pay-transfer">
        <div class="alert info">${icon('bank')}<div><strong>Datos para transferir ${money(info.feeHnl)}:</strong><br>${esc(info.bankInstructions || 'Pide los datos al supermercado.')}</div></div>
        <label class="field"><span>Número de referencia o comprobante</span><input name="reference" required maxlength="80" placeholder="Ej.: 123456789"></label>
        <button class="btn primary lg block">Enviar para verificación</button></form>`;
    box.querySelector('#pay-card')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; // después del await, e.currentTarget ya es null
      btn.disabled = true;
      const r = await attempt(() => api.post('/registration/card'));
      if (r?.checkoutUrl) { location.href = r.checkoutUrl; return; }
      if (r?.approved) {
        await loadSession(); ctx.refreshBar();
        toast(`¡Pago aprobado! Suscripción pagada hasta el ${fmtDay(r.subscriptionEndsAt)}.`);
        renderInscription(view, ctx);
      } else btn.disabled = false;
    });
    box.querySelector('#pay-transfer')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await attempt(() => api.post('/registration/transfer', formData(e.target)), 'Recibimos tu referencia. Te avisaremos al confirmarla.')) {
        await loadSession(); renderInscription(view, ctx);
      }
    });
  };
  view.querySelectorAll('input[name=m]').forEach((r) => r.addEventListener('change', drawMethod));
  drawMethod();
  view.querySelector('#refresh')?.addEventListener('click', async () => { await loadSession(); ctx.refreshBar(); renderInscription(view, ctx); });
}

export async function renderAccount(view, ctx) {
  const u = state.user;
  const addresses = u.role === 'cliente' ? await api.get('/addresses') : [];
  view.innerHTML = `
    <div class="page-head"><h1>Mi cuenta</h1>${statusBadge(u.status)}</div>
    <div class="two-col">
      <div class="stack">
        ${u.role === 'cliente' ? (u.status === 'Activo'
          ? `<a class="card row between" href="#/inscripcion" style="text-decoration:none;color:inherit"><span>${icon('card')} Suscripción activa hasta el <strong>${fmtDay(u.subscriptionEndsAt)}</strong></span><span class="small">Pagar por adelantado →</span></a>`
          : `<div class="alert warn">${icon('card')}<div>${u.subscriptionEndsAt ? `Tu suscripción venció el ${fmtDay(u.subscriptionEndsAt)}.` : 'Tu cuenta aún no está activa.'} <a href="#/inscripcion">${u.subscriptionEndsAt ? 'Renovar' : 'Pagar la suscripción'}</a></div></div>`) : ''}
        ${u.role === 'cliente' ? `<a class="card row between" href="#/puntos" style="text-decoration:none;color:inherit"><span>${icon('star')} <strong>Mis puntos</strong> e invitar amigos</span><span class="small">Ver →</span></a>` : ''}
        <section class="card">
          <div class="card-title"><h2>${icon('pin')} Mis direcciones</h2><button class="btn sm" id="add">${icon('plus')} Agregar</button></div>
          <div class="stack" id="addrs">${addresses.length ? addresses.map((a) => `<div class="option" style="cursor:default">
            ${icon('pin', 'lead')}<div class="grow"><div class="t">${esc(a.label)} ${a.isDefault ? '<span class="badge st-Activo">Principal</span>' : ''} ${a.latitude != null ? '<span class="badge st-Entregado">GPS</span>' : ''}</div>
              <div class="small">${esc(a.line)}${a.neighborhood ? `, ${esc(a.neighborhood)}` : ''}, ${esc(a.city)}</div>
              ${a.reference ? `<div class="small muted">Ref.: ${esc(a.reference)}</div>` : ''}</div>
            <button class="btn ghost icon sm" data-edit="${a.id}" aria-label="Editar">${icon('edit')}</button>
            <button class="btn ghost icon sm" data-del="${a.id}" aria-label="Eliminar">${icon('x')}</button></div>`).join('') : '<p class="muted">Aún no tienes direcciones.</p>'}</div>
        </section>
      </div>
      <form class="card stack" id="profile">
        <h2>Mis datos</h2>
        <label class="field"><span>Nombre</span><input name="fullName" value="${esc(u.fullName)}" required></label>
        <label class="field"><span>Correo</span><input value="${esc(u.email || u.login)}" disabled></label>
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(u.phone || '')}"></label>
        <details><summary class="small">Cambiar contraseña</summary><div class="stack" style="margin-top:10px">
          <label class="field"><span>Contraseña actual</span><input name="currentPassword" type="password" autocomplete="current-password"></label>
          <label class="field"><span>Contraseña nueva</span><input name="newPassword" type="password" minlength="8" autocomplete="new-password"></label></div></details>
        <button class="btn primary">Guardar</button>
        <button type="button" class="btn ghost" id="logout">${icon('logout')} Cerrar sesión</button>
      </form>
    </div>`;
  view.querySelector('#add').addEventListener('click', async () => { if (await addressModal()) renderAccount(view, ctx); });
  view.querySelector('#addrs').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit && await addressModal(addresses.find((a) => a.id === Number(edit.dataset.edit)))) renderAccount(view, ctx);
    if (del && await confirmDialog('Eliminar dirección', '¿Eliminar esta dirección?', { okLabel: 'Eliminar', kind: 'danger' })) {
      if (await attempt(() => api.del(`/addresses/${del.dataset.del}`))) renderAccount(view, ctx);
    }
  });
  view.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await attempt(() => api.put('/auth/profile', formData(e.target)), 'Datos guardados.');
    if (user) { state.user = user; ctx.refreshBar(); }
  });
  view.querySelector('#logout').addEventListener('click', async () => {
    await api.post('/auth/logout').catch(() => {});
    state.user = null;
    ctx.refreshBar();
    ctx.navigate('#/');
  });
}

export function renderForgot(view) {
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px">
    <form class="auth-card glass" id="forgot">
      <div class="brand">${logoDelivery({ height: 48 })}<h1 style="font-size:22px;margin:10px 0 0">¿Olvidaste tu contraseña?</h1>
        <p class="muted small" style="margin:0">Escribe el correo con el que te registraste y te enviamos un enlace para crear una nueva.</p></div>
      <label class="field"><span>Correo electrónico</span><input name="email" type="email" autocomplete="email" required maxlength="120"></label>
      <button class="btn primary lg block">Enviar enlace</button>
      <a class="small" href="#/ingresar" style="text-align:center">Volver a ingresar</a>
    </form></div>`;
  view.querySelector('#forgot').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const r = await attempt(() => api.post('/auth/forgot', formData(e.target)));
    btn.disabled = false;
    if (!r) return;
    e.target.innerHTML = `<div class="brand">${logoDelivery({ height: 48 })}</div>
      <div style="text-align:center;display:grid;gap:10px"><div style="font-size:48px">📧</div><h1 style="font-size:22px;margin:0">Revisa tu correo</h1>
      <p class="muted" style="margin:0">${esc(r.message)}</p><p class="small muted" style="margin:0">El enlace vence en 1 hora.</p></div>
      <a class="btn block" href="#/ingresar">Volver a ingresar</a>`;
  });
}

export async function renderReset(view, ctx, token) {
  let info;
  try { info = await api.get(`/auth/reset/${encodeURIComponent(token)}`); } catch (err) {
    view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px"><div class="auth-card glass">
      <div class="brand">${logoDelivery({ height: 48 })}</div>
      <div class="alert warn">${icon('clock')}<div>${esc(err.message)}</div></div>
      <a class="btn primary lg block" href="#/recuperar">Pedir un enlace nuevo</a></div></div>`;
    return;
  }
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px">
    <form class="auth-card glass" id="reset">
      <div class="brand">${logoDelivery({ height: 48 })}<h1 style="font-size:22px;margin:10px 0 0">Hola ${esc(info.name)}, crea tu contraseña nueva</h1></div>
      <label class="field"><span>Contraseña nueva (mínimo 8 caracteres)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Repite la contraseña</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn primary lg block">Guardar e ingresar</button>
      <p class="small muted" style="text-align:center;margin:0">Por seguridad, se cerrará tu sesión en los otros equipos.</p>
    </form></div>`;
  view.querySelector('#reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (f.password !== f.confirm) { toast('Las contraseñas no coinciden.', 'error'); return; }
    const user = await attempt(() => api.post('/auth/reset', { token, password: f.password }), 'Contraseña cambiada. ¡Bienvenido de nuevo!');
    if (!user) return;
    state.user = user;
    ctx.refreshBar();
    afterLogin(ctx);
  });
}
