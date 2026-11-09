// Prueba del pago de la inscripción con PixelPay, usando el SDK oficial en el navegador contra PixelPay simulado.
//
//   1. Pago aprobado: la cuenta queda Activa. Ninguna petición a nuestro servidor lleva el número de tarjeta, y a
//      PixelPay llega cifrado.
//   2. Pago rechazado por el banco: la cuenta sigue pendiente y se ofrece intentar con otra tarjeta.
//   3. PixelPay no confirma el estado: el pago queda "En revisión" y aparece en el panel del master.
//   4. Un payment_hash falso no activa la cuenta.
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
const TARJETA = '4111111111111111';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const errors = [];
const modo = (m) => fetch(`${SIM}/__modo`, { method: 'POST', body: JSON.stringify({ modo: m }) });

async function cliente(browser, nombre) {
  const ctx = await browser.newContext({ ...PHONE, locale: 'es-HN' });
  const page = await ctx.newPage();
  const propias = [];
  page.on('request', (r) => { if (r.url().startsWith(BASE)) propias.push(`${r.url()} ${r.postData() || ''}`); });
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
  await page.click('#pay-card');
  await page.waitForSelector('#pay');
  return { page, propias };
}

async function pagar(page) {
  await page.fill('[name=number]', TARJETA);
  await page.fill('[name=expiry]', '1230');
  await page.fill('[name=cvv]', '123');
}

(async () => {
  const server = await simulado.start(5399);
  const browser = await chromium.launch();

  console.log('1. Pago aprobado');
  await modo('aprobar');
  const a = await cliente(browser, 'Daniela Paz');
  await pagar(a.page);
  if (SAVE) await a.page.screenshot({ path: path.join(OUT, '40-pago-pixelpay.png') });
  await a.page.click('#submit');
  await a.page.waitForSelector('text=¡Pago aprobado!');
  if (SAVE) await a.page.screenshot({ path: path.join(OUT, '41-pago-aprobado.png') });
  const ventas = await (await fetch(`${SIM}/__ventas`)).json();
  const venta = ventas.at(-1);
  assert.ok(venta.body.card_number.includes('|') && !venta.body.card_number.includes(TARJETA), 'La tarjeta debe llegar cifrada a PixelPay');
  assert.ok(venta.order_id.startsWith('INS-'), 'order_id propio');
  assert.ok(!a.propias.some((r) => r.includes(TARJETA) || r.includes('4111 1111')), 'Ninguna petición a nuestro servidor lleva la tarjeta');
  const me = await a.page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
  assert.strictEqual(me.status, 'Activo');
  console.log(`  ✓ cuenta activa, tarjeta cifrada, ${a.propias.length} peticiones propias sin datos de tarjeta`);

  console.log('2. Pago rechazado');
  await modo('rechazar');
  const r = await cliente(browser, 'Mario Reyes');
  await pagar(r.page);
  await r.page.click('#submit');
  await r.page.waitForSelector('text=No se pudo cobrar la tarjeta');
  if (SAVE) await r.page.screenshot({ path: path.join(OUT, '42-pago-rechazado.png') });
  assert.strictEqual((await r.page.evaluate(() => fetch('/api/auth/me').then((x) => x.json()))).status, 'PendientePago');
  // Reintento: nuevo número de orden
  await modo('aprobar');
  await r.page.click('#retry');
  await r.page.waitForSelector('#pay');
  await pagar(r.page);
  await r.page.click('#submit');
  await r.page.waitForSelector('text=¡Pago aprobado!');
  const v2 = (await (await fetch(`${SIM}/__ventas`)).json()).slice(-2);
  assert.notStrictEqual(v2[0].order_id, v2[1].order_id, 'Cada intento lleva otro order_id');
  console.log('  ✓ rechazado no activa; el reintento con otra orden se aprueba');

  console.log('3. PixelPay no confirma el estado');
  await modo('sin-estado');
  const s = await cliente(browser, 'Lucía Cruz');
  await pagar(s.page);
  await s.page.click('#submit');
  await s.page.waitForSelector('text=Recibimos tu pago');
  assert.strictEqual((await s.page.evaluate(() => fetch('/api/auth/me').then((x) => x.json()))).status, 'EnRevision');
  console.log('  ✓ queda en revisión');

  console.log('4. payment_hash falso');
  await modo('aprobar');
  const f = await cliente(browser, 'Pedro Falso');
  const id = new URL(f.page.url()).searchParams.get('id');
  const res = await f.page.evaluate((pid) => fetch(`/api/registration/card/${pid}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentUuid: 'inventado', paymentHash: '0123456789abcdef0123456789abcdef' }) }).then(async (x) => ({ status: x.status, body: await x.json() })), id);
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await f.page.evaluate(() => fetch('/api/auth/me').then((x) => x.json()))).status, 'PendientePago');
  console.log(`  ✓ rechazado: ${res.body.error}`);

  console.log('5. El master ve el pago en revisión');
  const m = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await m.goto(`${BASE}/panel/#/clientes`);
  await m.fill('[name=login]', 'master');
  await m.fill('[name=password]', 'master123');
  await m.click('#login button');
  await m.waitForSelector('#pending table');
  assert.ok((await m.textContent('#pending')).includes('Lucía Cruz'));
  assert.ok((await m.textContent('#pending')).includes('PixelPay'));
  if (SAVE) await m.screenshot({ path: path.join(OUT, '43-panel-pago-en-revision.png') });
  console.log('  ✓ aparece en "Pagos por verificar"');

  // La CSP de /pago permite PixelPay; el resto del sitio sigue estricto.
  const cspPago = (await fetch(`${BASE}/pago/`)).headers.get('content-security-policy');
  const cspTienda = (await fetch(`${BASE}/`)).headers.get('content-security-policy');
  assert.ok(cspPago.includes(SIM) && !cspTienda.includes(SIM) && cspTienda.includes("connect-src 'self';"));
  console.log('  ✓ CSP: PixelPay permitido solo en /pago');

  await browser.close();
  server.close();
  if (errors.length) { console.error('Errores en el navegador:\n' + errors.join('\n')); process.exit(1); }
  console.log('Pago con PixelPay: todo correcto.');
})().catch((e) => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
