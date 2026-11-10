// Prueba de puntos, referidos y suscripción mensual (por la API, con CSRF y sesiones reales).
//
//   1. Registro con código de invitación (en minúsculas también); un código que no existe se rechaza.
//   2. Suscripción: el primer pago da un mes; se puede pagar SOLO el mes siguiente por adelantado.
//      Una transferencia de renovación no bloquea a un cliente activo; al aprobarla se suma un mes.
//   3. Pedido entregado por el master: el cliente gana 2 % del total y quien lo invitó otro 2 %.
//   4. Pedido entregado por el repartidor (con código): mismos puntos y sin duplicar.
//   5. Pedidos no entregados no dan puntos.
//   6. Suscripción vencida: la cuenta pasa a pendiente de pago, no puede pedir y conserva sus puntos.
//
// La app debe correr con datos demo y pasarela simulada (lo normal en desarrollo), sobre una base nueva:
//   Security__LoginAttemptsPerMinute=100 dotnet run --project src/Diversify.Delivery --launch-profile http
//   node tests/puntos-suscripcion.cjs
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:5390';
const DB = process.env.DB || path.join(__dirname, '..', 'src', 'Diversify.Delivery', 'data', 'delivery.db');

/** Cliente HTTP con sus propias cookies y token CSRF (como un navegador). */
class Client {
  constructor() { this.jar = new Map(); this.csrf = null; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      const [k, v] = [kv.slice(0, i), kv.slice(i + 1)];
      if (v) this.jar.set(k, v); else this.jar.delete(k);
    }
  }
  async token() {
    if (!this.csrf) {
      const r = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: this.cookie() } });
      this.store(r);
      this.csrf = (await r.json()).requestToken;
    }
    return this.csrf;
  }
  async req(method, url, body) {
    const token = method === 'GET' ? null : await this.token(); // antes de armar las cookies: trae la del token
    const headers = { Cookie: this.cookie() };
    if (token) { headers['X-CSRF-TOKEN'] = token; headers['Content-Type'] = 'application/json'; }
    const r = await fetch(`${BASE}/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(r);
    if (/^\/auth\/(login|register|logout)/.test(url)) this.csrf = null; // el token va ligado a la sesión
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* sin JSON */ }
    return { status: r.status, data };
  }
  get(url) { return this.req('GET', url); }
  post(url, body = {}) { return this.req('POST', url, body); }
  async ok(method, url, body) {
    const r = await this.req(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const stamp = Date.now();

async function login(user, password) {
  const c = new Client();
  await c.ok('POST', '/auth/login', { login: user, password });
  return c;
}

async function register(name, referralCode) {
  const c = new Client();
  const email = `${name.toLowerCase()}${stamp}@correo.hn`;
  const r = await c.post('/auth/register', { fullName: `${name} Prueba`, email, phone: '9988-7766', password: 'clave-segura-1', referralCode });
  return { c, r };
}

async function placeOrder(c) {
  const addr = await c.ok('POST', '/addresses', { label: 'Casa', line: 'Calle 1, casa 2', neighborhood: 'Col. Centro', city: 'San Pedro Sula' });
  const { items } = await c.ok('GET', '/catalog/products?limit=200');
  const p = items.find((x) => x.available && x.unit === 'UND' && x.price >= 20);
  const qty = Math.ceil(260 / p.price);
  return c.ok('POST', '/orders', { addressId: addr.id, items: [{ productId: p.id, quantity: qty }], allowSubstitutions: true, paymentMethod: 'Efectivo' });
}

const points = async (c) => (await c.ok('GET', '/points'));

(async () => {
  const master = await login('master', 'master123');
  const driver = await login('repartidor', 'repartidor123');
  const driverId = (await master.ok('GET', '/admin/users?role=repartidor')).find((x) => x.user.login === 'repartidor').user.id;

  console.log('1. Registro con código de invitación');
  const { c: ana } = await register('Andrea');
  const anaCode = (await ana.ok('GET', '/auth/me')).referralCode;
  assert.match(anaCode, /^[A-Z0-9]{6}$/);
  const bad = await register('Falso', 'NOEXISTE');
  assert.strictEqual(bad.r.status, 400);
  assert.match(bad.r.data.error, /código de invitación no existe/);
  const { c: beto, r: betoReg } = await register('Beto', anaCode.toLowerCase());
  assert.strictEqual(betoReg.status, 201, JSON.stringify(betoReg.data));
  assert.strictEqual(betoReg.data.status, 'PendientePago');
  console.log(`  ✓ Beto quedó invitado por Andrea (${anaCode}); un código inexistente se rechaza`);

  console.log('2. Suscripción mensual');
  const noSub = await beto.post('/orders', { addressId: 0, items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Efectivo' });
  assert.match(noSub.data.error, /suscripción mensual/);
  const pay1 = await ana.ok('POST', '/registration/card');
  assert.ok(pay1.approved && pay1.status === 'Activo');
  assert.ok(Math.abs(days(new Date(), pay1.subscriptionEndsAt) - 30) <= 1.5, `un mes: ${pay1.subscriptionEndsAt}`);
  const b1 = await beto.ok('POST', '/registration/card');
  const b2 = await beto.ok('POST', '/registration/card');
  assert.ok(Math.abs(days(b1.subscriptionEndsAt, b2.subscriptionEndsAt) - 30) <= 1.5, 'el pago por adelantado suma un mes al vencimiento');
  const b3 = await beto.post('/registration/card');
  assert.strictEqual(b3.status, 400);
  assert.match(b3.data.error, /Ya pagaste el mes siguiente/);
  // Transferencia de renovación de un cliente activo: sigue activo mientras se revisa.
  await ana.ok('POST', '/registration/transfer', { reference: `REN-${stamp}` });
  assert.strictEqual((await ana.ok('GET', '/auth/me')).status, 'Activo');
  const pend = (await master.ok('GET', '/admin/registrations?status=EnRevision')).find((x) => x.reference === `REN-${stamp}`);
  await master.ok('POST', `/admin/registrations/${pend.id}/approve`, {});
  const anaEnds = (await ana.ok('GET', '/auth/me')).subscriptionEndsAt;
  assert.ok(Math.abs(days(pay1.subscriptionEndsAt, anaEnds) - 30) <= 1.5, 'la transferencia aprobada suma otro mes');
  console.log('  ✓ primer mes, un mes por adelantado (no dos), renovación por transferencia sin bloquear al cliente');

  console.log('3. Pedido entregado por el master');
  const o1 = await placeOrder(beto);
  assert.strictEqual((await points(beto)).balance, 0, 'sin puntos antes de entregar');
  for (const status of ['Preparando', 'Listo']) await master.ok('POST', `/admin/orders/${o1.id}/status`, { status });
  await master.ok('POST', `/admin/orders/${o1.id}/assign`, { driverId });
  for (const status of ['EnCamino', 'Entregado']) await master.ok('POST', `/admin/orders/${o1.id}/status`, { status });
  const expected1 = round2(o1.total * 0.02);
  let pb = await points(beto);
  let pa = await points(ana);
  assert.strictEqual(pb.balance, expected1, `Beto: 2 % de ${o1.total}`);
  assert.strictEqual(pa.balance, expected1, `Andrea: 2 % de la compra de su invitado`);
  assert.strictEqual(pa.referrals, 1);
  assert.strictEqual(pa.fromReferrals, expected1);
  assert.strictEqual(pa.entries[0].kind, 'Referido');
  console.log(`  ✓ total L ${o1.total}: Beto +${expected1} y Andrea +${expected1} por su invitado`);

  console.log('4. Pedido entregado por el repartidor');
  const o2 = await placeOrder(beto);
  for (const status of ['Preparando', 'Listo']) await master.ok('POST', `/admin/orders/${o2.id}/status`, { status });
  await driver.ok('POST', `/driver/orders/${o2.id}/take`);
  await driver.ok('POST', `/driver/orders/${o2.id}/pickup`);
  const pin = (await beto.ok('GET', `/orders/${o2.id}`)).deliveryPin;
  await driver.ok('POST', `/driver/orders/${o2.id}/deliver`, { pin });
  const expected2 = round2(expected1 + round2(o2.total * 0.02));
  pb = await points(beto);
  pa = await points(ana);
  assert.strictEqual(pb.balance, expected2);
  assert.strictEqual(pa.balance, expected2);
  assert.strictEqual(pb.entries.filter((e) => e.kind === 'Compra').length, 2, 'un movimiento por pedido');
  console.log(`  ✓ Beto y Andrea tienen ${expected2} puntos cada uno (L ${expected2})`);

  console.log('5. Pedido cancelado: sin puntos');
  const o3 = await placeOrder(beto);
  await beto.ok('POST', `/orders/${o3.id}/cancel`, { reason: 'Prueba' });
  assert.strictEqual((await points(beto)).balance, expected2);
  console.log('  ✓ no suma');

  console.log('6. Suscripción vencida');
  const betoId = (await beto.ok('GET', '/auth/me')).id;
  execFileSync('python3', ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute("UPDATE Users SET SubscriptionEndsAt='2020-01-01 00:00:00' WHERE Id=?", (int(sys.argv[2]),)); c.commit()`, DB, String(betoId)]);
  const expired = await beto.post('/orders', { addressId: 0, items: [{ productId: 1, quantity: 1 }], paymentMethod: 'Efectivo' });
  assert.strictEqual(expired.status, 400);
  assert.match(expired.data.error, /venció/);
  const reg = await beto.ok('GET', '/registration');
  assert.strictEqual(reg.status, 'PendientePago');
  assert.strictEqual((await points(beto)).balance, expected2, 'los puntos se conservan');
  const renew = await beto.ok('POST', '/registration/card');
  assert.ok(renew.status === 'Activo' && Math.abs(days(new Date(), renew.subscriptionEndsAt) - 30) <= 1.5, 'renovar da un mes desde hoy');
  console.log('  ✓ no puede pedir, conserva los puntos y al renovar vuelve a tener un mes');

  console.log('Puntos y suscripción: todo correcto.');
})().catch((e) => { console.error(e); process.exit(1); });
