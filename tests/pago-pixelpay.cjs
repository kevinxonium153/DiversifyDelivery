// Prueba del pago de la inscripción con PixelPay (Hosted Payment) contra PixelPay simulado.
//
//   1. Pago aprobado: PixelPay devuelve al cliente con paymentHash y la cuenta queda Activa. La orden va firmada
//      (el simulado rechaza una firma inválida) y por el monto que fija el servidor.
//   2. El cliente cancela en PixelPay: no se activa y puede reintentar.
//   3. El banco rechaza: se queda en PixelPay; al regresar y reintentar, otra orden se aprueba.
//   4. El cliente cierra la ventana después de pagar: el aviso de PixelPay (_callback) activa la cuenta.
//   5. Aviso con un monto distinto: queda "En revisión" y aparece en el panel del master.
//   6. paymentHash o aviso falsos no activan la cuenta.
//
// La app debe correr con PixelPay apuntando al simulado:
//   PixelPay__Endpoint=http://localhost:5399 PixelPay__Key=prueba-key PixelPay__SecretKey=prueba-secreto \
//     dotnet run --project src/Diversify.Delivery --launch-profile http
//   node tests/pago-pixelpay.cjs
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const simulado = require('./pixelpay-simulado.cjs');

const BASE = process.env.BASE || 'http://localhost:5390';
const SIM = 'http://localhost:5399';
const OUT = path.join(__dirname, '..', 'docs', 'capturas');
const SAVE = process.env.CAPTURAS !== '0';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const errors = [];
const modo = (m) => fetch(`${SIM}/__modo`, { method: 'POST', body: JSON.stringify({ modo: m }) });
const ordenes = async () => (await fetch(`${SIM}/__ordenes`)).json();
const avisos = async () => (await fetch(`${SIM}/__avisos`)).json();
const estado = (page) => page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()).then((u) => u.status));

async function esperarEstado(page, esperado) {
  for (let i = 0; i < 40; i++) {
    if (await estado(page) === esperado) return;
    await page.waitForTimeout(250);
  }
  assert.strictEqual(await estado(page), esperado);
}

async function cliente(browser, nombre) {
  const ctx = await browser.newContext({ ...PHONE, locale: 'es-HN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${nombre}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (4\d\d)/.test(m.text())) errors.push(`${nombre}: ${m.text()}`); });
  await page.goto(`${BASE}/#/registro`);
  await page.fill('[name=fullName]', nombre);
  await page.fill('[name=email]', `${nombre.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}${Date.now()}@correo.hn`);
  await page.fill('[name=phone]', '9988-7766');
  await page.fill('[name=password]', 'clave-segura-1');
  await page.check('#register input[type=checkbox]');
  await page.click('#register button');
  await page.waitForSelector('.pay-amount, .toast.error');
  const fallo = await page.$('.toast.error');
  if (fallo) throw new Error(`Registro de ${nombre}: ${await fallo.textContent()}`);
  await page.waitForSelector('#pay-card');
  return page;
}

// Toca "Pagar con PixelPay" y espera la página de PixelPay.
async function irAPixelPay(page) {
  await page.click('#pay-card');
  await page.waitForURL(`${SIM}/checkout/**`);
  return (await ordenes()).at(-1);
}

(async () => {
  const server = await simulado.start(5399);
  const browser = await chromium.launch();

  console.log('1. Pago aprobado');
  await modo('aprobar');
  const a = await cliente(browser, 'Daniela Paz');
  if (SAVE) await a.screenshot({ path: path.join(OUT, '40-pago-pixelpay.png') });
  const info = await a.evaluate(() => fetch('/api/registration').then((r) => r.json()));
  const orden = await irAPixelPay(a);
  assert.ok(orden._order_id.startsWith('INS-'), 'order_id propio');
  assert.strictEqual(orden._amount, info.feeHnl.toFixed(2), 'monto fijado por el servidor (en lempiras)');
  assert.strictEqual(orden._currency, 'HNL');
  assert.ok(orden._complete.startsWith(`${BASE}/api/pixelpay/registro/`) && orden._callback === `${BASE}/api/pixelpay/aviso`);
  assert.deepStrictEqual([orden._first_name, orden._last_name], ['Daniela', 'Paz']);
  await a.click('#pagar');
  await a.waitForSelector('text=¡Pago aprobado!');
  assert.ok(a.url().endsWith('#/inscripcion/ok'));
  if (SAVE) await a.screenshot({ path: path.join(OUT, '41-pago-aprobado.png') });
  assert.strictEqual(await estado(a), 'Activo');
  const aviso1 = (await avisos()).at(-1);
  assert.strictEqual(aviso1.status, 200, `el aviso de PixelPay se acepta (${aviso1.body})`);
  console.log('  ✓ orden firmada con SHA3-512, monto del servidor, cuenta activa y aviso aceptado');

  console.log('2. El cliente cancela en PixelPay');
  const c = await cliente(browser, 'Mario Reyes');
  await irAPixelPay(c);
  await c.click('#cancelar');
  await c.waitForSelector('text=No se hizo ningún cobro');
  if (SAVE) await c.screenshot({ path: path.join(OUT, '42-pago-cancelado.png') });
  assert.strictEqual(await estado(c), 'PendientePago');
  console.log('  ✓ no se activa y puede reintentar');

  console.log('3. Rechazado por el banco y reintento');
  await modo('rechazar');
  const ord1 = await irAPixelPay(c);
  await c.click('#pagar');
  await c.waitForSelector('text=Transacción rechazada');
  await c.click('#cancelar');
  await c.waitForSelector('#pay-card');
  assert.strictEqual(await estado(c), 'PendientePago');
  await modo('aprobar');
  const ord2 = await irAPixelPay(c);
  assert.notStrictEqual(ord1._order_id, ord2._order_id, 'cada intento lleva otra orden');
  await c.click('#pagar');
  await c.waitForSelector('text=¡Pago aprobado!');
  assert.strictEqual(await estado(c), 'Activo');
  console.log('  ✓ rechazado no activa; el reintento con otra orden se aprueba');

  console.log('4. El cliente cierra la ventana después de pagar');
  await modo('solo-aviso');
  const v = await cliente(browser, 'Lucía Cruz');
  await irAPixelPay(v);
  await v.click('#pagar');
  await v.waitForSelector('text=Puedes cerrar esta ventana');
  await v.goto(`${BASE}/#/inscripcion`);
  await esperarEstado(v, 'Activo');
  console.log('  ✓ el aviso de PixelPay activa la cuenta');

  console.log('5. Aviso con un monto distinto');
  await modo('monto-distinto');
  const d = await cliente(browser, 'Carlos Mejía');
  await irAPixelPay(d);
  await d.click('#pagar');
  await d.waitForSelector('text=Puedes cerrar esta ventana');
  await d.goto(`${BASE}/#/inscripcion`);
  await esperarEstado(d, 'EnRevision');
  console.log('  ✓ queda en revisión');

  console.log('6. paymentHash y aviso falsos');
  await modo('aprobar');
  const f = await cliente(browser, 'Pedro Falso');
  const of = await irAPixelPay(f);
  await f.goto(`${of._complete}?paymentHash=0123456789abcdef0123456789abcdef`);
  await f.waitForSelector('text=No pudimos confirmar el pago con PixelPay');
  assert.ok(f.url().endsWith('#/inscripcion/error'));
  const falso = (body) => f.evaluate((b) => fetch('/api/pixelpay/aviso', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b) }).then((r) => r.status), body);
  assert.strictEqual(await falso({ order: of._order_id, status: 'paid', amount: Number(of._amount), currency: 'HNL', payment_hash: 'f'.repeat(32) }), 400);
  assert.strictEqual(await falso({ order: 'INS-no-existe', status: 'paid', payment_hash: 'f'.repeat(32) }), 404);
  assert.strictEqual(await estado(f), 'PendientePago');
  console.log('  ✓ no activan la cuenta');

  console.log('7. El master ve el pago en revisión');
  const m = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await m.goto(`${BASE}/panel/#/clientes`);
  await m.fill('[name=login]', 'master');
  await m.fill('[name=password]', 'master123');
  await m.click('#login button');
  await m.waitForSelector('#pending table');
  const pendientes = await m.textContent('#pending');
  assert.ok(pendientes.includes('Carlos Mejía') && pendientes.includes('se esperaba'), 'aparece con el motivo');
  if (SAVE) await m.screenshot({ path: path.join(OUT, '43-panel-pago-en-revision.png') });
  console.log('  ✓ aparece en "Pagos por verificar" con el motivo');

  // Sin SDK en el navegador: la CSP estricta aplica a todo el sitio.
  for (const ruta of ['/', '/panel/', '/api/catalog/products']) {
    const csp = (await fetch(`${BASE}${ruta}`)).headers.get('content-security-policy');
    assert.ok(csp.includes("connect-src 'self';") && !csp.includes(SIM), `CSP estricta en ${ruta}`);
  }
  console.log('  ✓ CSP estricta en todo el sitio');

  await browser.close();
  server.close();
  if (errors.length) { console.error('Errores en el navegador:\n' + errors.join('\n')); process.exit(1); }
  console.log('Pago con PixelPay: todo correcto.');
})().catch((e) => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
