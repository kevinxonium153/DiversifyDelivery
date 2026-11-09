// PixelPay simulado para pruebas locales (sin dependencias): Hosted Payment, como lo documenta PixelPay
// (integrations/hosted-payment y secure-signature).
//
//   POST /api/v2/transaction/hosted/other   crea el cobro (form-urlencoded, json=true) → { success, url }
//                                           Exige _key y _client_signature = HMAC SHA3-512("key|order_id|app_url", secreto).
//   GET  /checkout/<id>                     página de pago (botones "Pago seguro" y "Cancelar y regresar")
//   POST /checkout/<id>/pagar               según el modo: regresa a _complete?paymentHash=… y avisa a _callback
//
// Modos (POST /__modo { modo }):
//   aprobar          regresa al cliente a _complete y avisa a _callback (lo normal)
//   rechazar         el banco rechaza: se queda en PixelPay (como el checkout real)
//   solo-aviso       el cliente cierra la ventana: solo llega el aviso a _callback
//   monto-distinto   aviso con un monto distinto al cobrado (para probar la revisión)
// Consultas: GET /__ordenes (lo que recibió), GET /__avisos (respuesta de nuestro servidor a cada aviso).
//
// Uso: node tests/pixelpay-simulado.cjs [puerto]   (por defecto 5399)
const http = require('http');
const crypto = require('crypto');

const KEY = process.env.PIXELPAY_KEY || 'prueba-key';
const SECRET = process.env.PIXELPAY_SECRET || 'prueba-secreto';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const firma = (orderId, appUrl) => crypto.createHmac('sha3-512', SECRET).update([KEY, orderId, appUrl].join('|')).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function start(port = 5399) {
  const APP_URL = `http://localhost:${port}`; // el "endpoint" que la app tiene configurado
  let modo = 'aprobar';
  const ordenes = [];
  const avisos = [];

  async function avisar(o, monto) {
    if (!o.f._callback) return;
    const body = {
      ref: o.id, uuid: `P-${crypto.randomUUID()}`, status: 'paid', description: `Payment of Order #${o.f._order_id}`,
      currency: o.f._currency, tax_amount: 0, amount: monto, customer_name: `${o.f._first_name} ${o.f._last_name}`,
      customer_email: o.f._email, order: o.f._order_id, payment_hash: md5(`${o.f._order_id}|${KEY}|${SECRET}`),
      payment_url: `${APP_URL}/checkout/${o.id}`,
    };
    try {
      const r = await fetch(o.f._callback, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      avisos.push({ order: o.f._order_id, status: r.status, body: await r.text() });
    } catch (e) { avisos.push({ order: o.f._order_id, status: 0, body: e.message }); }
  }

  const pagina = (titulo, contenido) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#1f2937}
    .caja{border:1px solid #d1d5db;border-radius:14px;padding:20px}.monto{font-size:28px;font-weight:800}
    button,a.btn{display:block;width:100%;box-sizing:border-box;padding:14px;margin-top:12px;border-radius:10px;font-size:16px;text-align:center}
    button{background:#2563eb;color:#fff;border:0}a.btn{border:1px solid #d1d5db;color:#1f2937;text-decoration:none}</style></head>
    <body><p><strong>PixelPay (simulado)</strong></p><div class="caja">${contenido}</div></body></html>`;

  const server = http.createServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const html = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const url = req.url.split('?')[0];
      if (url === '/__modo') { modo = JSON.parse(raw).modo; return json(200, { modo }); }
      if (url === '/__ordenes') return json(200, ordenes.map((o) => o.f));
      if (url === '/__avisos') return json(200, avisos);

      if (req.method === 'POST' && url === '/api/v2/transaction/hosted/other') {
        const f = Object.fromEntries(new URLSearchParams(raw));
        if (f.json !== 'true') return html(400, 'Solo modo JSON en el simulado.');
        if (f._key !== KEY) return json(401, { success: false, message: 'Llave del comercio inválida.' });
        const esperada = firma(f._order_id || '', APP_URL);
        if (f._client_signature !== esperada || req.headers['x-client-signature'] !== esperada)
          return json(401, { success: false, message: 'Firma de seguridad inválida.' });
        const errors = {};
        for (const k of ['_cancel', '_complete', '_order_id', '_amount', '_email']) if (!f[k]) errors[k] = [`El campo ${k} es obligatorio.`];
        if ((f._first_name || '').length < 3) errors._first_name = ['El campo first name debe tener al menos 3 caracteres.'];
        if ((f._last_name || '').length < 2) errors._last_name = ['El campo last name debe tener al menos 2 caracteres.'];
        if (!/^\d+\.\d{2}$/.test(f._amount || '')) errors._amount = ['El campo amount debe ser un número.'];
        if (ordenes.some((o) => o.f._order_id === f._order_id)) errors._order_id = ['La orden ya existe.'];
        if (Object.keys(errors).length) return json(422, { success: false, errors });
        const o = { id: crypto.randomBytes(6).toString('hex'), f, pagada: false };
        ordenes.push(o);
        return json(200, { success: true, url: `${APP_URL}/checkout/${o.id}` });
      }

      const m = url.match(/^\/checkout\/([a-f0-9]+)(\/pagar)?$/);
      const o = m && ordenes.find((x) => x.id === m[1]);
      if (m && !o) return html(404, pagina('No encontrado', '<p>Cobro no encontrado.</p>'));
      if (o && req.method === 'GET' && !m[2]) {
        return html(200, pagina('Pago seguro', `<p>${esc(o.f._first_name)} ${esc(o.f._last_name)}</p>
          <div class="monto">${esc(o.f._currency)} ${esc(o.f._amount)}</div><p>Orden ${esc(o.f._order_id)}</p>
          <form method="post" action="/checkout/${o.id}/pagar"><button id="pagar">Pago seguro</button></form>
          <a class="btn" id="cancelar" href="${esc(o.f._cancel)}">Cancelar orden y regresar</a>`));
      }
      if (o && req.method === 'POST' && m[2]) {
        if (modo === 'rechazar') {
          return html(200, pagina('Transacción rechazada', `<p><strong>Transacción rechazada</strong>: fondos insuficientes.</p>
            <a class="btn" id="reintentar" href="/checkout/${o.id}">Intentar con otra tarjeta</a>
            <a class="btn" id="cancelar" href="${esc(o.f._cancel)}">Cancelar orden y regresar</a>`));
        }
        o.pagada = true;
        const monto = Number(o.f._amount) + (modo === 'monto-distinto' ? -10 : 0);
        await avisar(o, monto);
        if (modo === 'aprobar') {
          const sep = o.f._complete.includes('?') ? '&' : '?';
          res.writeHead(302, { Location: `${o.f._complete}${sep}paymentHash=${md5(`${o.f._order_id}|${KEY}|${SECRET}`)}` });
          return res.end();
        }
        return html(200, pagina('Pago realizado', '<p><strong>Pago realizado.</strong> Puedes cerrar esta ventana.</p>'));
      }
      json(404, { success: false, message: 'Ruta no encontrada.' });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { start, KEY, SECRET, md5 };
if (require.main === module) start(Number(process.argv[2]) || 5399).then(() => console.log('PixelPay simulado escuchando'));
