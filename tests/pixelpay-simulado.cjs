// PixelPay simulado para pruebas locales (sin dependencias). Responde las mismas rutas que usa el SDK oficial
// @pixelpay/sdk-core en una venta sin 3-D Secure:
//   GET  /api/v2/merchant/public_key   llave pública del comercio (32 bytes en base64)
//   POST /api/v2/transaction/sale      venta: aprueba (200) o rechaza (402) según el modo
//   POST /api/v2/transaction/status    estado de una transacción
// Rutas de control para las pruebas: POST /__modo { modo: "aprobar" | "rechazar" | "sin-estado" }, GET /__ventas.
//
// No descifra la tarjeta (no tiene la llave privada real); comprueba que llegue CIFRADA ("caja|nonce"), que es lo
// que garantiza el SDK. Uso: node tests/pixelpay-simulado.cjs [puerto]   (por defecto 5399)
const http = require('http');
const crypto = require('crypto');

const KEY = process.env.PIXELPAY_KEY || 'prueba-key';
const SECRET = process.env.PIXELPAY_SECRET || 'prueba-secreto';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function start(port = 5399) {
  let modo = 'aprobar';
  const ventas = [];
  const publicKey = crypto.randomBytes(32).toString('base64');

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = req.url.split('?')[0];
      if (url === '/__modo') { modo = body.modo; return send(200, { modo }); }
      if (url === '/__ventas') return send(200, ventas);

      const auth = req.headers['x-auth-key'] === KEY && req.headers['x-auth-hash'] === md5(SECRET);
      if (!auth) return send(401, { success: false, message: 'Credenciales inválidas.' });

      if (url === '/api/v2/merchant/public_key') return send(200, { success: true, data: { public_key: publicKey } });

      if (url === '/api/v2/transaction/sale') {
        const cifrada = ['card_number', 'card_cvv', 'card_expire'].every((k) => typeof body[k] === 'string' && body[k].includes('|') && !/^\d+$/.test(body[k]));
        if (!cifrada || !req.headers['x-auth-secure']) return send(422, { success: false, message: 'Los datos de la tarjeta deben venir cifrados.' });
        const uuid = crypto.randomUUID();
        const aprobada = modo !== 'rechazar';
        const venta = { uuid, order_id: body.order_id, amount: Number(body.order_amount), currency: body.order_currency, aprobada, body };
        ventas.push(venta);
        const data = { payment_uuid: uuid, payment_hash: md5(`${body.order_id}|${KEY}|${SECRET}`), response_approved: aprobada,
          transaction_amount: body.order_amount, transaction_approved_amount: aprobada ? body.order_amount : '0',
          response_reason: aprobada ? 'Aprobada' : 'Fondos insuficientes', transaction_auth: aprobada ? String(100000 + ventas.length) : null };
        return aprobada ? send(200, { success: true, message: 'Transacción completada exitosamente.', data })
          : send(402, { success: false, message: 'Transacción rechazada: fondos insuficientes.', data });
      }

      if (url === '/api/v2/transaction/status') {
        const v = ventas.find((x) => x.uuid === body.payment_uuid);
        if (!v) return send(404, { success: false, message: 'Transacción no encontrada.' });
        if (modo === 'sin-estado') return send(200, { success: true, message: 'Consulta realizada.', data: { payment_uuid: v.uuid } });
        return send(200, { success: true, message: 'Consulta realizada.', data: { payment_uuid: v.uuid, response_approved: v.aprobada,
          transaction_approved_amount: v.aprobada ? String(v.amount) : '0', transaction_amount: String(v.amount) } });
      }
      send(404, { success: false, message: 'Ruta no encontrada.' });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { start, KEY, SECRET };
if (require.main === module) start(Number(process.argv[2]) || 5399).then(() => console.log('PixelPay simulado escuchando'));
