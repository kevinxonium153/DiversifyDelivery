// Página de pago de la inscripción con PixelPay.
// Los datos de la tarjeta los recibe SOLO el SDK de PixelPay (window.Services/Models/Requests), que los cifra con
// la llave pública del comercio y los manda directo a PixelPay. A nuestro servidor solo llega el resultado
// (payment_uuid y payment_hash), que el servidor verifica antes de activar la cuenta.
import { api } from './api.js';
import { logoDelivery } from './brand.js';
import { esc, icon, money, usd, toast } from './ui.js';

const root = document.getElementById('root');
const STATES = { 'HN-AT': 'Atlántida', 'HN-CH': 'Choluteca', 'HN-CL': 'Colón', 'HN-CM': 'Comayagua', 'HN-CP': 'Copán', 'HN-CR': 'Cortés',
  'HN-EP': 'El Paraíso', 'HN-FM': 'Francisco Morazán', 'HN-GD': 'Gracias a Dios', 'HN-IN': 'Intibucá', 'HN-IB': 'Islas de la Bahía',
  'HN-LP': 'La Paz', 'HN-LE': 'Lempira', 'HN-OC': 'Ocotepeque', 'HN-OL': 'Olancho', 'HN-SB': 'Santa Bárbara', 'HN-VA': 'Valle', 'HN-YO': 'Yoro' };

const back = '<a class="btn block" href="/#/inscripcion">Volver</a>';

function screen(inner) {
  root.innerHTML = `<div class="pay-card glass"><div class="brand" style="display:grid;justify-items:center;gap:6px">${logoDelivery({ height: 44 })}</div>${inner}</div>`;
}

/** Algoritmo de Luhn: detecta números de tarjeta mal escritos antes de enviarlos. */
function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return num.length >= 13 && sum % 10 === 0;
}

async function newAttempt() {
  try {
    const r = await api.post('/registration/card');
    if (r.checkoutUrl) location.replace(r.checkoutUrl);
    else location.href = '/#/inscripcion';
  } catch (err) { toast(err.message, 'error'); }
}

function showResult(kind, title, text) {
  const icons = { ok: '🎉', review: '⏳', err: '⚠️' };
  screen(`<div style="text-align:center;display:grid;gap:10px"><div style="font-size:52px">${icons[kind]}</div><h1 style="font-size:22px;margin:0">${esc(title)}</h1>
    <p class="muted" style="margin:0">${esc(text)}</p></div>
    ${kind === 'ok' ? '<a class="btn primary lg block" href="/#/">Ir a comprar</a>'
      : kind === 'err' ? '<button class="btn primary lg block" id="retry">Intentar con otra tarjeta</button><a class="btn block" href="/#/inscripcion">Pagar por transferencia</a>'
      : '<a class="btn block" href="/#/">Ver el catálogo</a>'}`);
  root.querySelector('#retry')?.addEventListener('click', newAttempt);
}

async function start() {
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) { screen(`<p>Falta el número de pago.</p>${back}`); return; }
  if (!window.Services || !window.Models || !window.Requests) {
    screen(`<div class="alert err">${icon('alert')}<div>No se pudo cargar el módulo de pago. Recarga la página.</div></div>${back}`);
    return;
  }
  let cfg;
  try { cfg = await api.get(`/registration/card/${id}`); } catch (err) {
    screen(`<div class="alert warn">${icon('info')}<div>${esc(err.message)}</div></div>${back}`);
    return;
  }

  screen(`
    <div style="text-align:center"><h1 style="font-size:22px;margin:0">Pagar inscripción</h1><p class="muted small" style="margin:4px 0 0">${esc(cfg.storeName)} · pago único</p></div>
    ${cfg.sandbox ? `<div class="alert warn small">${icon('alert')}<div><strong>Modo de prueba (sandbox de PixelPay).</strong> No se cobra dinero real.</div></div>` : ''}
    <div class="pay-summary"><span>Inscripción ${usd(cfg.amountUsd)}</span><strong>${cfg.currency === 'USD' ? usd(cfg.amount) : money(cfg.amount)}</strong></div>
    <form class="stack" id="pay" autocomplete="on" novalidate>
      <label class="field"><span>Nombre como aparece en la tarjeta</span><input name="holder" autocomplete="cc-name" required maxlength="60" value="${esc(cfg.customerName || '')}"></label>
      <label class="field"><span>Número de tarjeta</span><input name="number" class="card-number" autocomplete="cc-number" inputmode="numeric" required maxlength="23" placeholder="0000 0000 0000 0000"></label>
      <div class="grid-2" style="grid-template-columns:1fr 1fr">
        <label class="field"><span>Vence (MM/AA)</span><input name="expiry" autocomplete="cc-exp" inputmode="numeric" required maxlength="5" placeholder="MM/AA"></label>
        <label class="field"><span>CVV</span><input name="cvv" autocomplete="cc-csc" inputmode="numeric" required maxlength="4" placeholder="123" type="password"></label>
      </div>
      <details><summary class="small">Dirección de facturación</summary><div class="stack" style="margin-top:10px">
        <label class="field"><span>Dirección</span><input name="address" required maxlength="120" value="Honduras"></label>
        <div class="grid-2" style="grid-template-columns:1fr 1fr">
          <label class="field"><span>Ciudad</span><input name="city" required maxlength="60" value="San Pedro Sula"></label>
          <label class="field"><span>Departamento</span><select name="state">${Object.entries(STATES).map(([k, v]) => `<option value="${k}" ${k === 'HN-CR' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Teléfono</span><input name="phone" required maxlength="20" value="${esc(cfg.customerPhone || '')}"></label>
      </div></details>
      <button class="btn primary lg block" id="submit">${icon('card')} Pagar ${cfg.currency === 'USD' ? usd(cfg.amount) : money(cfg.amount)}</button>
    </form>
    <div class="secure">${icon('shield')}<span>Pago procesado por PixelPay. Los datos de tu tarjeta se cifran en este dispositivo y van directo a PixelPay: ${esc(cfg.storeName)} no los ve ni los guarda.</span></div>
    <a class="small" href="/#/inscripcion" style="text-align:center">Cancelar</a>`);

  const form = root.querySelector('#pay');
  form.number.addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 19);
    e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
  });
  form.expiry.addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });
  form.cvv.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const number = form.number.value.replace(/\D/g, '');
    const [mm, yy] = form.expiry.value.split('/').map(Number);
    if (!form.holder.value.trim()) return toast('Escribe el nombre de la tarjeta.', 'error');
    if (!luhn(number)) return toast('Revisa el número de la tarjeta.', 'error');
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0)) return toast('Revisa el vencimiento (MM/AA).', 'error');
    if (form.cvv.value.length < 3) return toast('Revisa el CVV.', 'error');
    if (!form.address.value.trim() || !form.city.value.trim() || !form.phone.value.trim()) {
      form.querySelector('details').open = true;
      return toast('Completa la dirección de facturación.', 'error');
    }

    const btn = root.querySelector('#submit');
    btn.disabled = true;
    btn.textContent = 'Procesando pago…';

    const { Models, Requests, Services } = window;
    const settings = new Models.Settings();
    if (cfg.sandbox) settings.setupSandbox();
    else { settings.setupEndpoint(cfg.endpoint); settings.setupCredentials(cfg.key, cfg.hash); }
    settings.setupLanguage('es');

    const card = new Models.Card();
    card.number = number;
    card.cvv2 = form.cvv.value;
    card.expire_month = mm;
    card.expire_year = 2000 + yy;
    card.cardholder = form.holder.value.trim();

    const billing = new Models.Billing();
    billing.address = form.address.value.trim();
    billing.country = 'HN';
    billing.state = form.state.value;
    billing.city = form.city.value.trim();
    billing.phone = form.phone.value.trim();

    const order = new Models.Order();
    order.id = cfg.orderId;
    order.currency = cfg.currency;
    order.amount = cfg.amount;
    order.customer_name = card.cardholder;
    order.customer_email = cfg.customerEmail;

    const sale = new Requests.SaleTransaction();
    sale.setOrder(order);
    sale.setCard(card);
    sale.setBilling(billing);

    // Los datos de la tarjeta ya están en el SDK: se borran del formulario.
    form.number.value = ''; form.cvv.value = ''; form.expiry.value = '';

    let response;
    try {
      response = await new Services.Transaction(settings).doSale(sale);
    } catch (err) {
      response = { success: false, message: err?.message };
    }

    const data = response?.data || {};
    if (!response?.success || !data.payment_uuid) {
      const reason = data.response_reason || response?.message || 'El pago no se completó.';
      showResult('err', 'No se pudo cobrar la tarjeta', reason);
      return;
    }

    try {
      const r = await api.post(`/registration/card/${cfg.paymentId}/confirm`, { paymentUuid: data.payment_uuid, paymentHash: data.payment_hash });
      if (r.status === 'Aprobado') showResult('ok', '¡Pago aprobado! Tu cuenta está activa.', 'Ya puedes hacer pedidos.');
      else if (r.status === 'EnRevision') showResult('review', 'Recibimos tu pago', 'Lo estamos confirmando con PixelPay. Te avisamos en cuanto tu cuenta esté activa.');
      else showResult('err', 'El banco rechazó el pago', r.message || 'Intenta con otra tarjeta o paga por transferencia.');
    } catch (err) {
      showResult('review', 'Recibimos tu pago, pero no pudimos confirmarlo', `${err.message} Si se hizo el cargo, el supermercado lo revisará.`);
    }
  });
}

start();
