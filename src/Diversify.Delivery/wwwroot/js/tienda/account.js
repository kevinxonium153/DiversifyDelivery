// Ingresar, crear cuenta, pagar la inscripción ($5) y Mi cuenta (datos y direcciones).
import { api } from '../api.js';
import { logoDelivery } from '../brand.js';
import { esc, icon, money, usd, formData, attempt, toast, confirmDialog, statusBadge } from '../ui.js';
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

export function renderRegister(view, ctx) {
  const s = state.store;
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:20px">
    <form class="auth-card glass" id="register">
      <div class="brand">${logoDelivery({ height: 48 })}<h1 style="font-size:22px;margin:10px 0 0">Crea tu cuenta</h1>
        <div class="steps-reg"><span class="on"><b>1</b> Tus datos</span> → <span><b>2</b> Inscripción ${usd(s.registrationFeeUsd)}</span> → <span><b>3</b> ¡A comprar!</span></div></div>
      <label class="field"><span>Nombre completo</span><input name="fullName" autocomplete="name" required maxlength="120"></label>
      <label class="field"><span>Correo electrónico</span><input name="email" type="email" autocomplete="email" required maxlength="120"></label>
      <label class="field"><span>Teléfono (WhatsApp)</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="9999-9999" required maxlength="30"></label>
      <label class="field"><span>Contraseña (mínimo 8 caracteres)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="check small"><input type="checkbox" required> <span>Acepto los términos del servicio y entiendo que la inscripción de <strong>${usd(s.registrationFeeUsd)} (${money(s.registrationFeeHnl)})</strong> es un pago único y no reembolsable.</span></label>
      <button class="btn primary lg block">Continuar</button>
      <p class="small muted" style="text-align:center;margin:0">¿Ya tienes cuenta? <a href="#/ingresar">Ingresa</a></p>
    </form></div>`;
  view.querySelector('#register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await attempt(() => api.post('/auth/register', formData(e.target)));
    if (!user) return;
    state.user = user;
    ctx.refreshBar();
    ctx.navigate('#/inscripcion');
  });
}

export async function renderInscription(view, ctx) {
  if (state.user.role !== 'cliente') { ctx.navigate('#/'); return; }
  const info = await attempt(() => api.get('/registration'));
  if (!info) return;
  if (info.status === 'Activo') {
    view.innerHTML = `<div class="auth-wrap" style="min-height:auto"><div class="auth-card glass" style="text-align:center">
      <div style="font-size:56px">🎉</div><h1 style="font-size:22px">¡Tu cuenta está activa!</h1>
      <p class="muted">Ya puedes hacer pedidos.</p><a class="btn primary lg block" href="#/">Ir a comprar</a></div></div>`;
    return;
  }
  const last = info.lastPayment;
  view.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding-top:10px">
    <div class="auth-card glass" style="width:min(520px,100%)">
      <div class="brand"><div class="steps-reg"><span><b>✓</b> Tus datos</span> → <span class="on"><b>2</b> Inscripción</span> → <span><b>3</b> ¡A comprar!</span></div>
        <h1 style="font-size:22px;margin:10px 0 0">Activa tu cuenta</h1>
        <p class="muted" style="margin:0">Inscripción única para comprar en línea y recibir a domicilio.</p>
        <div class="pay-amount">${usd(info.feeUsd)}</div><div class="muted small">${money(info.feeHnl)} al cambio de L ${info.exchangeRate}</div></div>

      ${info.status === 'EnRevision' ? `<div class="alert info">${icon('clock')}<div><strong>Estamos verificando tu transferencia</strong> (ref. ${esc(last?.reference || '')}). Normalmente toma menos de una hora en horario de tienda.</div></div>` : ''}
      ${last?.status === 'Rechazado' ? `<div class="alert err">${icon('alert')}<div><strong>No pudimos confirmar tu pago anterior.</strong> ${esc(last.notes || '')}</div></div>` : ''}

      ${info.status !== 'EnRevision' ? `
      <div class="stack">
        <label class="option"><input type="radio" name="m" value="card" ${info.card.enabled ? 'checked' : 'disabled'}>${icon('card', 'lead')}
          <div class="grow"><div class="t">Tarjeta de crédito o débito</div><div class="small muted">${info.card.enabled ? 'Aprobación inmediata.' : 'Disponible pronto.'}</div></div></label>
        <label class="option"><input type="radio" name="m" value="transfer" ${info.card.enabled ? '' : 'checked'}>${icon('bank', 'lead')}
          <div class="grow"><div class="t">Transferencia o depósito</div><div class="small muted">Se activa cuando confirmamos el pago.</div></div></label>
      </div>
      <div id="pay-box"></div>` : `<button class="btn block" id="refresh">${icon('sync')} Revisar estado</button>`}
      <a class="small" href="#/" style="text-align:center">Seguir viendo el catálogo</a>
    </div></div>`;

  const box = view.querySelector('#pay-box');
  const drawMethod = () => {
    if (!box) return;
    const m = view.querySelector('input[name=m]:checked')?.value;
    box.innerHTML = m === 'card' ? `<div class="fake-gateway stack">
        <div class="row between"><strong>${esc(info.card.name)}</strong><span class="badge st-EnRevision plain">MODO DE PRUEBA</span></div>
        <p class="small muted" style="margin:0">Los datos de la tarjeta se ingresan en la página segura de la pasarela de pago; Diversify Delivery nunca los ve ni los guarda. En este modo de prueba el pago se aprueba sin cobrar.</p>
        <button class="btn primary lg block" id="pay-card">${icon('card')} Pagar ${usd(info.feeUsd)}</button></div>`
      : `<form class="stack" id="pay-transfer">
        <div class="alert info">${icon('bank')}<div><strong>Datos para transferir ${money(info.feeHnl)}:</strong><br>${esc(info.bankInstructions || 'Pide los datos al supermercado.')}</div></div>
        <label class="field"><span>Número de referencia o comprobante</span><input name="reference" required maxlength="80" placeholder="Ej.: 123456789"></label>
        <button class="btn primary lg block">Enviar para verificación</button></form>`;
    box.querySelector('#pay-card')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const r = await attempt(() => api.post('/registration/card'));
      if (r?.redirectUrl) { location.href = r.redirectUrl; return; }
      if (r?.approved) { await loadSession(); ctx.refreshBar(); toast('¡Pago aprobado! Tu cuenta está activa.'); renderInscription(view, ctx); }
      else e.currentTarget.disabled = false;
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
        ${u.status !== 'Activo' ? `<div class="alert warn">${icon('card')}<div>Tu cuenta aún no está activa. <a href="#/inscripcion">Completar inscripción</a></div></div>` : ''}
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
