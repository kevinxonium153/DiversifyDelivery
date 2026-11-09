// Confirmar pedido: dirección (con ubicación GPS), instrucciones y forma de pago.
import { api } from '../api.js';
import { esc, icon, money, qty, modal, formData, attempt, toast, payLabel } from '../ui.js';
import { state, cartLines, cartTotals, clearCart } from './state.js';

/** Formulario de dirección con botón "Usar mi ubicación actual". Devuelve la dirección guardada. */
export function addressModal(existing = null) {
  return new Promise((resolve) => {
    let coords = existing?.latitude != null ? { lat: existing.latitude, lng: existing.longitude } : null;
    const gpsText = () => coords
      ? `<span class="gps-state ok">${icon('check')} Ubicación marcada (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})${coords.acc ? ` · precisión ${Math.round(coords.acc)} m` : ''}</span>`
      : '<span class="gps-state muted">Sin ubicación. Con ella el repartidor llega directo con Google Maps o Waze.</span>';
    let saved = null;
    modal({
      title: existing ? 'Editar dirección' : 'Nueva dirección de entrega',
      body: `<form class="stack" id="addr-form">
        <div class="card flat" style="padding:14px;display:grid;gap:8px;background:var(--surface-2)">
          <button type="button" class="btn ink" id="gps">${icon('gps')} Usar mi ubicación actual</button>
          <div id="gps-state">${gpsText()}</div>
          <span class="small muted">Hazlo estando en el lugar de entrega. Tu ubicación solo se comparte con el repartidor de tu pedido.</span>
        </div>
        <div class="grid-2">
          <label class="field"><span>Nombre</span><input name="label" value="${esc(existing?.label || 'Casa')}" placeholder="Casa, Trabajo…" maxlength="40"></label>
          <label class="field"><span>Ciudad</span><input name="city" value="${esc(existing?.city || 'San Pedro Sula')}" maxlength="60"></label>
        </div>
        <label class="field"><span>Colonia o barrio</span><input name="neighborhood" value="${esc(existing?.neighborhood || '')}" placeholder="Col. Los Andes" maxlength="100"></label>
        <label class="field"><span>Dirección</span><input name="line" required value="${esc(existing?.line || '')}" placeholder="Calle, bloque, número de casa" maxlength="200"></label>
        <label class="field"><span>Puntos de referencia</span><textarea name="reference" maxlength="300" placeholder="Portón negro frente a la pulpería, casa de dos pisos…">${esc(existing?.reference || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="isDefault" ${existing?.isDefault ? 'checked' : ''}> Usar como dirección principal</label>
      </form>`,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar dirección', kind: 'primary', onClick: async (close, el) => {
            const form = el.querySelector('#addr-form');
            if (!form.reportValidity()) return false;
            const body = { ...formData(form), latitude: coords?.lat ?? null, longitude: coords?.lng ?? null };
            saved = await attempt(() => existing ? api.put(`/addresses/${existing.id}`, body) : api.post('/addresses', body));
            return saved ? undefined : false;
          },
        },
      ],
      onOpen: (el) => {
        el.querySelector('#gps').addEventListener('click', (e) => {
          if (!navigator.geolocation) return toast('Tu navegador no permite obtener la ubicación.', 'error');
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.innerHTML = `${icon('gps')} Buscando ubicación…`;
          navigator.geolocation.getCurrentPosition((pos) => {
            coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
            el.querySelector('#gps-state').innerHTML = gpsText();
            btn.disabled = false;
            btn.innerHTML = `${icon('gps')} Volver a marcar`;
          }, (err) => {
            btn.disabled = false;
            btn.innerHTML = `${icon('gps')} Usar mi ubicación actual`;
            toast(err.code === 1 ? 'Permite el acceso a la ubicación en tu navegador.' : 'No se pudo obtener la ubicación. Inténtalo al aire libre.', 'error');
          }, { enableHighAccuracy: true, timeout: 15000 });
        });
      },
      onClose: () => resolve(saved),
    });
  });
}

export async function renderCheckout(view, ctx) {
  const u = state.user;
  if (u.role !== 'cliente') { view.innerHTML = '<div class="empty">Esta cuenta no es de cliente.</div>'; return; }
  if (u.status !== 'Activo') { ctx.navigate('#/inscripcion'); return; }
  const lines = cartLines();
  if (!lines.length) { view.innerHTML = `<div class="empty"><div class="big">🛒</div>Tu carrito está vacío. <a href="#/">Ir al catálogo</a></div>`; return; }

  let addresses = await api.get('/addresses');
  const s = state.store;

  const draw = () => {
    const t = cartTotals();
    view.innerHTML = `
      <div class="page-head"><a class="btn ghost icon" href="#/" aria-label="Volver">←</a><h1>Confirmar pedido</h1></div>
      ${!s.openNow ? `<div class="alert warn" style="margin-bottom:14px">${icon('clock')}<div>La tienda recibe pedidos de ${esc(s.opensAt)} a ${esc(s.closesAt)}.</div></div>` : ''}
      <form class="two-col" id="checkout">
        <div class="stack">
          <section class="card">
            <div class="card-title"><h2>${icon('pin')} ¿Dónde lo entregamos?</h2><button type="button" class="btn sm" id="new-addr">${icon('plus')} Nueva</button></div>
            <div class="stack">
              ${addresses.length ? addresses.map((a, i) => `<label class="option">
                <input type="radio" name="addressId" value="${a.id}" ${(a.isDefault || i === 0) ? 'checked' : ''} required>
                <div class="grow"><div class="t">${esc(a.label)} ${a.latitude != null ? `<span class="badge st-Entregado">GPS</span>` : `<span class="badge st-Pendiente">sin GPS</span>`}</div>
                  <div class="small">${esc(a.line)}${a.neighborhood ? `, ${esc(a.neighborhood)}` : ''}, ${esc(a.city)}</div>
                  ${a.reference ? `<div class="small muted">Ref.: ${esc(a.reference)}</div>` : ''}</div>
              </label>`).join('') : '<div class="alert info">' + icon('info') + '<div>Agrega una dirección de entrega para continuar.</div></div>'}
            </div>
          </section>

          <section class="card">
            <div class="card-title"><h2>${icon('chat')} Instrucciones</h2></div>
            <div class="stack">
              <label class="field"><span>Para el repartidor y quien arma tu pedido (opcional)</span>
                <textarea name="instructions" maxlength="500" placeholder="Ej.: tocar el timbre, dejar con el guardia, el pollo sin piel, plátanos verdes…"></textarea></label>
              <label class="check"><input type="checkbox" name="allowSubstitutions" checked>
                <span>Si algo se agotó, <strong>sustituir por un producto parecido</strong> (si no, se quita del pedido y no se cobra).</span></label>
            </div>
          </section>

          <section class="card">
            <div class="card-title"><h2>${icon('cash')} ¿Cómo vas a pagar?</h2></div>
            <div class="stack">
              <label class="option"><input type="radio" name="paymentMethod" value="Efectivo" checked>${icon('cash', 'lead')}
                <div class="grow"><div class="t">Efectivo al recibir</div>
                  <label class="field" style="margin-top:8px"><span>¿Con cuánto pagas? (para llevarte cambio)</span><input name="cashGiven" type="number" min="0" step="1" inputmode="numeric" placeholder="${Math.ceil(t.total / 100) * 100}"></label></div></label>
              <label class="option"><input type="radio" name="paymentMethod" value="Tarjeta">${icon('card', 'lead')}
                <div class="grow"><div class="t">${payLabel('Tarjeta')}</div><div class="small muted">El repartidor lleva terminal (POS).</div></div></label>
              <label class="option"><input type="radio" name="paymentMethod" value="Transferencia">${icon('bank', 'lead')}
                <div class="grow"><div class="t">Transferencia</div><div class="small muted">${esc(s.bankInstructions || 'Te enviaremos los datos de la cuenta.')}</div>
                  <label class="field" style="margin-top:8px"><span>Número de referencia (si ya transferiste)</span><input name="paymentReference" maxlength="80"></label></div></label>
            </div>
          </section>
        </div>

        <aside class="card sticky">
          <div class="card-title"><h2>Resumen</h2><span class="muted small">${t.count} productos</span></div>
          <div class="lines" style="max-height:300px;overflow:auto">${lines.map((l) => `<div class="line">
            <div class="mini">${l.image ? `<img src="${esc(l.image)}" alt="">` : esc(l.icon || '🛒')}</div>
            <div><div class="t">${esc(l.name)}</div><div class="small muted">${qty(l.qty)} × ${money(l.price)}</div></div>
            <strong>${money(l.price * l.qty)}</strong></div>`).join('')}</div>
          <div class="totals" style="margin-top:12px">
            <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
            <div><span>Envío</span><span>${t.fee ? money(t.fee) : 'Gratis'}</span></div>
            <div class="grand"><span>Total a pagar</span><span>${money(t.total)}</span></div>
          </div>
          <p class="small muted">Los productos por libra se pesan al armar el pedido; el total final puede variar un poco.</p>
          <button class="btn primary lg block" type="submit" ${!addresses.length || t.missingForMin > 0 ? 'disabled' : ''}>${icon('check')} Hacer pedido</button>
        </aside>
      </form>`;

    view.querySelector('#new-addr').addEventListener('click', async () => {
      const a = await addressModal();
      if (a) { addresses = await api.get('/addresses'); draw(); }
    });
    view.querySelector('#checkout').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      const order = await attempt(() => api.post('/orders', {
        addressId: Number(f.addressId),
        items: cartLines().map((l) => ({ productId: l.id, quantity: l.qty, note: l.note || null })),
        instructions: f.instructions, allowSubstitutions: f.allowSubstitutions, paymentMethod: f.paymentMethod,
        cashGiven: f.paymentMethod === 'Efectivo' ? f.cashGiven : null,
        paymentReference: f.paymentMethod === 'Transferencia' ? f.paymentReference : null,
      }));
      btn.disabled = false;
      if (!order) return;
      clearCart();
      toast(`¡Pedido ${order.number} recibido!`);
      ctx.navigate(`#/pedido/${order.id}`);
    });
  };
  draw();
}
