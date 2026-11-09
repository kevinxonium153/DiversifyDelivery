// Recorrido completo de Diversify Delivery con Playwright + capturas para docs/capturas.
//
//   1. Cliente nuevo: se registra, paga la inscripción (pasarela de prueba), arma el carrito,
//      agrega su dirección con GPS y hace el pedido.
//   2. Master: ve el tablero, ajusta el pedido, lo marca listo y revisa productos, clientes y ajustes.
//   3. Repartidor: toma el pedido, va en camino y lo entrega con el código del cliente.
//
// Requiere la app corriendo en desarrollo con datos demo y base nueva:
//   rm -rf src/Diversify.Delivery/data && dotnet run --project src/Diversify.Delivery --launch-profile http
//   node tests/e2e-capturas.cjs            (BASE=http://localhost:5390 por defecto)
//   CAPTURAS=0 node tests/e2e-capturas.cjs (solo prueba, sin guardar imágenes)
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const BASE = process.env.BASE || 'http://localhost:5390';
const OUT = path.join(__dirname, '..', 'docs', 'capturas');
const SAVE = process.env.CAPTURAS !== '0';
const GEO = { latitude: 15.5139, longitude: -88.0133 }; // San Pedro Sula
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

const errors = [];
async function newPage(browser, opts) {
  const ctx = await browser.newContext({ ...opts, locale: 'es-HN', timezoneId: 'America/Tegucigalpa',
    geolocation: GEO, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`${page.url()}: ${m.text()}`); });
  return page;
}
async function shot(page, name, full = false) {
  await page.waitForTimeout(350);
  if (SAVE) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log(`  ✓ ${name}`);
}

(async () => {
  const browser = await chromium.launch();
  const email = `prueba${Date.now()}@correo.hn`;

  // ---------- 1. Cliente ----------
  console.log('Cliente');
  const c = await newPage(browser, PHONE);
  await c.goto(BASE + '/');
  await c.waitForSelector('.product');
  await shot(c, '01-tienda-inicio-celular');

  await c.click('text=Crear cuenta');
  await c.fill('[name=fullName]', 'Karla Rivera');
  await c.fill('[name=email]', email);
  await c.fill('[name=phone]', '9876-1234');
  await c.fill('[name=password]', 'clave-segura-1');
  await c.check('#register input[type=checkbox]');
  await shot(c, '02-registro-celular');
  await c.click('#register button');
  await c.waitForSelector('.pay-amount');
  await shot(c, '03-inscripcion-5-dolares');
  await c.click('#pay-card');
  await c.waitForSelector('text=¡Tu cuenta está activa!');

  await c.goto(BASE + '/#/');
  await c.waitForSelector('.product [data-add]');
  // Agregar productos de distintas categorías
  for (const name of ['Pechuga de pollo', 'Leche entera Sula 1 L', 'Frijol rojo 2 lb', 'Aguacate hass', 'Banano maduro', 'Huevos blancos (cartón 30)']) {
    await c.locator('.product', { hasText: name }).first().locator('[data-add]').click();
  }
  await c.locator('.product', { hasText: 'Pechuga de pollo' }).first().locator('[data-inc]').click();
  await shot(c, '04-catalogo-con-carrito');
  await c.click('#open-cart');
  await c.waitForSelector('.drawer .line');
  await shot(c, '05-carrito');
  await c.click('[data-checkout]');

  await c.waitForSelector('#new-addr');
  await c.click('#new-addr');
  await c.click('#gps');
  await c.waitForSelector('.gps-state.ok');
  await c.fill('[name=neighborhood]', 'Col. Jardines del Valle');
  await c.fill('[name=line]', '3 calle, 5 avenida, casa 12');
  await c.fill('[name=reference]', 'Casa blanca con portón café, frente a la iglesia');
  await shot(c, '06-direccion-con-gps');
  await c.click('.modal footer .btn.primary');
  await c.waitForSelector('input[name=addressId]');
  await c.fill('[name=instructions]', 'Tocar el timbre. Los bananos que no estén muy maduros, por favor.');
  await c.fill('[name=cashGiven]', '1000');
  await shot(c, '07-confirmar-pedido', true);
  await c.click('#checkout [type=submit]');
  await c.waitForSelector('.pin');
  const orderUrl = c.url();
  const pin = (await c.textContent('.pin')).trim();
  assert.match(pin, /^\d{4}$/);
  await shot(c, '08-seguimiento-pedido');
  const orderId = Number(orderUrl.split('/').pop());
  console.log(`  pedido ${orderId}, código ${pin}`);

  // ---------- 2. Master ----------
  console.log('Master');
  const m = await newPage(browser, DESK);
  await m.goto(BASE + '/panel/');
  await m.fill('[name=login]', 'master');
  await m.fill('[name=password]', 'master123');
  await m.click('#login button');
  await m.waitForSelector('.kpi');
  await shot(m, '10-panel-tablero');
  await m.click('a[data-route=pedidos]');
  await m.waitForSelector('.board .ocard');
  await shot(m, '11-panel-pedidos-kanban');
  await m.click(`.ocard[data-id="${orderId}"]`);
  await m.waitForSelector('.modal .fulfill-qty');
  await shot(m, '12-panel-detalle-pedido');
  // Empezar a armar → marcar listo
  await m.click('.modal footer .btn.primary');
  await m.waitForTimeout(500);
  await m.click(`.ocard[data-id="${orderId}"]`);
  await m.waitForSelector('.modal footer .btn.primary');
  await m.click('.modal footer .btn.primary');
  await m.waitForTimeout(500);
  await m.click('a[data-route=productos]');
  await m.waitForSelector('.price-input');
  await m.waitForSelector('.toast', { state: 'detached', timeout: 8000 }).catch(() => {});
  await shot(m, '13-panel-productos-precios');
  await m.click('#new');
  await m.waitForSelector('#pf');
  await shot(m, '14-panel-nuevo-producto');
  await m.click('.modal [data-close]');
  await m.click('a[data-route=clientes]');
  await m.waitForSelector('#pending table, #pending p');
  await shot(m, '15-panel-clientes-inscripciones');
  await m.click('a[data-route=repartidores]');
  await m.waitForSelector('table');
  await shot(m, '16-panel-repartidores');
  await m.click('a[data-route=ajustes]');
  await m.waitForSelector('#sf');
  await shot(m, '17-panel-ajustes', true);

  // ---------- 3. Repartidor ----------
  console.log('Repartidor');
  const d = await newPage(browser, PHONE);
  await d.goto(BASE + '/repartidor/');
  await d.fill('[name=login]', 'repartidor');
  await d.fill('[name=password]', 'repartidor123');
  await d.click('#login button');
  await d.waitForSelector('.d-tabs');
  await d.click('a[data-tab=available]');
  await d.waitForSelector(`.job[data-id="${orderId}"]`);
  await shot(d, '20-repartidor-disponibles');
  await d.click(`.job[data-id="${orderId}"] [data-take]`);
  await d.waitForSelector(`.job[data-id="${orderId}"] [data-pickup]`);
  await shot(d, '21-repartidor-mi-entrega', true);
  await d.click(`.job[data-id="${orderId}"] [data-pickup]`);
  await d.waitForSelector(`.job[data-id="${orderId}"] [data-deliver]`);
  await d.click(`.job[data-id="${orderId}"] [data-deliver]`);
  await d.fill('#pin', '0000');
  await d.click('.modal footer .btn.success');
  await d.waitForSelector('.toast.error');
  await d.fill('#pin', pin);
  await shot(d, '22-repartidor-codigo-entrega');
  await d.click('.modal footer .btn.success');
  await d.waitForSelector(`.job[data-id="${orderId}"]`, { state: 'detached' });

  // El cliente ve su pedido entregado
  await c.goto(orderUrl);
  await c.waitForSelector('.badge.st-Entregado');
  await shot(c, '09-pedido-entregado');

  // Modo oscuro (tienda en escritorio)
  const dark = await newPage(browser, { ...DESK, colorScheme: 'dark' });
  await dark.goto(BASE + '/');
  await dark.waitForSelector('.product');
  await shot(dark, '30-tienda-escritorio-oscuro');
  const light = await newPage(browser, DESK);
  await light.goto(BASE + '/');
  await light.waitForSelector('.product');
  await shot(light, '31-tienda-escritorio');

  await browser.close();
  if (errors.length) {
    console.error('Errores en el navegador:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Recorrido completo sin errores.');
})().catch((e) => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
