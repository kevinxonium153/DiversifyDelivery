// S04: API y navegador real contra SU instancia demo, nunca contra producción.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { csrfFetch } = require('./api-csrf.cjs');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'src', 'Diversify.Delivery');
let checks = 0, child, browser, attacker;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
(async () => {
  const listener = net.createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const base = `http://127.0.0.1:${listener.address().port}`; await new Promise((r) => listener.close(r));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const data = fs.mkdtempSync(path.join(root, 'test-results', 'csrf-'));
  let logs = '';
  child = spawn(process.env.DOTNET || 'dotnet', [path.join(app, 'bin/Debug/net10.0/Diversify.Delivery.dll')], { cwd: app,
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: base, Storage__DataRoot: data,
      Security__LoginAttemptsPerMinute: '100', Payments__Simulated: 'true', PixelPay__Key: '', PixelPay__SecretKey: '', Diversify__SyncMinutes: '0' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs = (logs + b).slice(-4000); });
  child.stderr.on('data', (b) => { logs = (logs + b).slice(-4000); });
  let spawnError; child.on('error', (e) => { spawnError = e; });
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw Error('Falló el arranque: ' + logs);
    try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch { /* esperando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, 'La app no estuvo lista.');
  async function api(method, url, body, cookie = '', expected = 200) {
    const r = await csrfFetch(base, '/api' + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    check(r.status, expected, `${method} ${url}`);
    return { body: await r.json(), cookie: r.headers.getSetCookie().find((s) => s.startsWith('diversify.delivery='))?.split(';')[0] };
  }
  const badLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'master', password: 'master123' }) });
  check(badLogin.status, 403, 'Incluso el login anónimo exige CSRF');
  check(badLogin.headers.getSetCookie().some((s) => s.startsWith('diversify.delivery=')), false, 'No debe iniciar sesión');
  const master = (await api('POST', '/auth/login', { login: 'master', password: 'master123' })).cookie;
  const settings = (await api('GET', '/admin/settings', undefined, master)).body;
  await api('PUT', '/admin/settings', { ...settings, opensAt: '00:00', closesAt: '00:00', acceptingOrders: true }, master);
  const customer = (await api('POST', '/auth/register', { fullName: 'Prueba CSRF', email: `csrf${Date.now()}@demo.hn`, phone: '99999999', password: 'csrf-prueba-123' }, '', 201)).cookie;
  await api('POST', '/registration/card', undefined, customer);
  const address = (await api('POST', '/addresses/', { line: 'Dirección ficticia' }, customer, 201)).body;
  const product = (await api('GET', '/catalog/products')).body.items.find((p) => p.available && p.price > 0);
  const order = (await api('POST', '/orders/', { addressId: address.id, items: [{ productId: product.id, quantity: Math.ceil(settings.minimumOrder / product.price) + 1 }], paymentMethod: 'Efectivo' }, customer, 201)).body;
  await api('POST', `/admin/orders/${order.id}/status`, { status: 'Preparando' }, master);
  const snapshot = (await api('GET', `/admin/orders/${order.id}`, undefined, master)).body;
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(base + '/repartidor/');
  await page.fill('[name=login]', 'repartidor'); await page.fill('[name=password]', 'repartidor123'); await page.click('#login button');
  await page.waitForSelector('.d-tabs');
  const tokenResponse = await context.request.get(base + '/api/auth/csrf');
  check(tokenResponse.status(), 200);
  check(tokenResponse.headers()['cache-control'].includes('no-store'), true);
  const token = (await tokenResponse.json()).requestToken;
  const cookies = await context.cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const authOnly = cookies.filter((c) => c.name === 'diversify.delivery').map((c) => `${c.name}=${c.value}`).join('; ');
  const take = `/driver/orders/${order.id}/take`;
  async function rejected(url, headers = {}, method = 'POST', body) {
    const r = await fetch(base + '/api' + url, { method, headers: { Cookie: cookie, ...headers }, body });
    check(r.status, 403, 'Escritura falsificada rechazada'); check(r.headers.get('X-CSRF-Error'), '1');
  }
  await rejected(take); // POST sin cuerpo ni token.
  await rejected(take, { 'X-CSRF-TOKEN': 'falso' });
  await rejected(take, { Cookie: authOnly, 'X-CSRF-TOKEN': token }); // Sin cookie antiforgery.
  const foreignToken = await fetch(base + '/api/auth/csrf');
  const foreignCookie = foreignToken.headers.getSetCookie()[0].split(';')[0];
  await rejected(take, { Cookie: authOnly + '; ' + foreignCookie, 'X-CSRF-TOKEN': (await foreignToken.json()).requestToken });
  await rejected(take, { 'X-CSRF-TOKEN': token, Origin: 'null' });
  await rejected(take, { 'X-CSRF-TOKEN': token, Origin: 'https://otro.example' });
  await rejected(take, { 'X-CSRF-TOKEN': token, 'Sec-Fetch-Site': 'same-site' });
  await rejected(take, { 'X-CSRF-TOKEN': token, 'Sec-Fetch-Site': 'cross-site' });
  await rejected('/auth/logout');
  await rejected('/auth/profile', { 'Content-Type': 'application/json' }, 'PUT', JSON.stringify({ fullName: 'No cambiar' }));
  await rejected(`/addresses/${address.id}`, { Cookie: customer }, 'DELETE');
  check((await api('GET', '/addresses/', undefined, customer)).body.some((a) => a.id === address.id), true);
  // La excepción está limitada al aviso de PixelPay. Un aviso sin firma NO debe aprobar pagos.
  const notification = await fetch(base + '/api/pixelpay/aviso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: 'inexistente', status: 'paid' }) });
  check(notification.status, 404); check(notification.headers.get('X-CSRF-Error'), null);
  check((await fetch(base + '/api/auth/csrf', { headers: { Origin: 'https://otro.example' } })).status, 403);
  attacker = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Origen atacante de prueba</title>'); }).listen(0, '127.0.0.1');
  await once(attacker, 'listening');
  const attackOrigin = `http://127.0.0.1:${attacker.address().port}`;
  await rejected(take, { 'X-CSRF-TOKEN': token, Origin: attackOrigin }); // Mismo sitio, otro puerto, incluso con token válido.
  check(Boolean(authOnly), true, 'La víctima tiene cookie de sesión');
  check((await context.request.get(base + '/api/auth/me')).status(), 200);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
  const attackIds = new Set(), sentCookies = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url === base + '/api' + take && e.request.method === 'POST') attackIds.add(e.requestId);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const headers = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), v]));
    sentCookies.set(e.requestId, headers.cookie?.includes('diversify.delivery=') === true);
  });
  await page.goto(attackOrigin);
  await page.evaluate(async ({ base, take }) => { try { await fetch(base + '/api' + take, { method: 'POST', credentials: 'include' }); } catch { /* CORS impide leer la respuesta, no es la defensa comprobada. */ } }, { base, take });
  check([...attackIds].some((id) => sentCookies.get(id)), true, 'El navegador realmente envió la cookie de la víctima');
  await cdp.detach();
  check((await api('GET', `/admin/orders/${order.id}`, undefined, master)).body, snapshot, 'Ni asignación, fecha ni eventos cambiaron');
  await page.goto(base + '/repartidor/'); await page.waitForSelector('.d-tabs');
  // El módulo legítimo carga su token y puede tomar y soltar el pedido.
  const taken = await page.evaluate(async (id) => (await import('/js/api.js')).api.post(`/driver/orders/${id}/take`), order.id);
  check(taken.driverId != null, true); check(taken.deliveryPin, null);
  const released = await page.evaluate(async (id) => (await import('/js/api.js')).api.post(`/driver/orders/${id}/release`), order.id);
  check(released.driverId, null);
  // Una petición sin cuerpo es válida con token y el Origin exacto.
  const validBodyless = await fetch(base + '/api' + take, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-TOKEN': token, Origin: base } });
  check(validBodyless.status, 200);
  await page.evaluate(async () => (await import('/js/api.js')).api.post('/auth/logout'));
  check((await context.request.get(base + '/api/auth/me')).status(), 204);
  const loggedInAgain = await page.evaluate(async () => (await import('/js/api.js')).api.post('/auth/login', { login: 'repartidor', password: 'repartidor123' }));
  check(loggedInAgain.id, taken.driverId, 'Tras logout el módulo obtiene un token anónimo nuevo sin recargar');
  let attempts = 0;
  await page.route('**/api/driver/duty', async (route) => {
    attempts++;
    await route.fulfill({ status: 403, headers: { 'Content-Type': 'application/json', 'X-CSRF-Error': '1' }, body: JSON.stringify({ error: 'CSRF de prueba' }) });
  });
  const failed = await page.evaluate(async () => { try { await (await import('/js/api.js')).api.post('/driver/duty', { onDuty: true }); return false; } catch { return true; } });
  check(failed, true); check(attempts, 1, 'No reintentar automáticamente una escritura rechazada');
  await page.unroute('**/api/driver/duty');
  const duty = await page.evaluate(async () => (await import('/js/api.js')).api.post('/driver/duty', { onDuty: true }));
  check(duty.onDuty, true, 'El siguiente intento legítimo obtiene un token válido');
  check(pageErrors, [], 'Sin errores de JavaScript en el flujo legítimo');
  console.log(`Protección CSRF: ${checks} comprobaciones correctas; ataque de otro origen con cookie sin cambios persistidos.`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (attacker) await new Promise((r) => attacker.close(r));
  if (child && child.exitCode === null) {
    const done = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await done; clearTimeout(timer);
  }
});
