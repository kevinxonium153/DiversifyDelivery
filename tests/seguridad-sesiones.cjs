// Regresión S05: inicia y detiene SU app en un puerto libre y una base demo desechable.
// Requiere dotnet build src/Diversify.Delivery, Node 22+ y python3 (para simular vencimiento/migración).
const assert = require('node:assert/strict');
const { csrfFetch } = require('./api-csrf.cjs');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'src', 'Diversify.Delivery');
const dll = path.join(app, 'bin', 'Debug', 'net10.0', 'Diversify.Delivery.dll');
let child, base, logs = '', checks = 0, data;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function req(method, url, body, cookie = '', expected = 200) {
  const r = await csrfFetch(base, '/api' + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body) });
  check(r.status, expected, `${method} ${url}: estado incorrecto`);
  const text = await r.text();
  const set = r.headers.getSetCookie().find((s) => s.startsWith('diversify.delivery='));
  return { body: text ? JSON.parse(text) : null, cookie: set?.split(';')[0] };
}
async function login(user, password) {
  const r = await req('POST', '/auth/login', { login: user, password });
  assert(r.cookie); checks++; return r;
}
async function start() {
  logs = '';
  child = spawn(process.env.DOTNET || 'dotnet', [dll], { cwd: app, env: { ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: base, Storage__DataRoot: data,
    Security__LoginAttemptsPerMinute: '100', Payments__Simulated: 'true',
    PixelPay__Endpoint: '', PixelPay__Key: '', PixelPay__SecretKey: '', Diversify__SyncMinutes: '0',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs = (logs + b).slice(-4000); });
  child.stderr.on('data', (b) => { logs = (logs + b).slice(-4000); });
  let failure; child.on('error', (e) => { failure = e; });
  for (let i = 0; i < 300; i++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw Error('Falló el arranque: ' + logs);
    try { if ((await fetch(base + '/healthz')).ok) return; } catch { /* esperando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('La app no estuvo lista: ' + logs);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await done; clearTimeout(timer);
}
function sql(statement) {
  return execFileSync('python3', ['-c', 'import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);r=c.execute(sys.argv[2]);print(r.fetchone() if r.description else "ok");c.commit()',
    path.join(data, 'data', 'delivery.db'), statement], { encoding: 'utf8' }).trim();
}
(async () => {
  assert(fs.existsSync(dll), 'Compila la app antes de esta prueba.');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  data = fs.mkdtempSync(path.join(root, 'test-results', 'sesiones-'));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise((r) => listener.close(r)); base = `http://127.0.0.1:${port}`;
  try {
    await start();
    const master = (await login('master', 'master123')).cookie;
    const staff = (await req('POST', '/admin/users', { login: 'sesiones-prueba', fullName: 'Sesiones prueba', role: 'repartidor', password: 'clave-prueba-123' }, master, 201)).body;
    const a = (await login('sesiones-prueba', 'clave-prueba-123')).cookie;
    let b = (await login('sesiones-prueba', 'clave-prueba-123')).cookie;
    await req('GET', '/driver/orders', undefined, a); // Calienta la caché del usuario.
    await req('POST', '/auth/logout', undefined, a, 204);
    for (let i = 0; i < 10; i++) await req('GET', '/driver/orders', undefined, a, 401);
    await req('GET', '/auth/me', undefined, a, 204);
    await req('POST', '/auth/logout', undefined, a, 204);
    await req('GET', '/driver/orders', undefined, b); // Otra sesión del mismo usuario sigue válida.
    const beforeProfile = b;
    b = (await req('PUT', '/auth/profile', { fullName: 'Perfil renovado' }, b)).cookie;
    assert(b); checks++;
    await req('GET', '/driver/orders', undefined, beforeProfile, 401);
    await req('GET', '/driver/orders', undefined, b);
    await stop(); await start();
    await req('GET', '/driver/orders', undefined, a, 401);
    await req('GET', '/driver/orders', undefined, b);
    check(sql(`SELECT count(*) FROM UserSessions WHERE UserId=${staff.id}`), '(1,)', 'Solo queda la sesión independiente');
    sql(`UPDATE UserSessions SET ExpiresAt=datetime('now','+1 hour') WHERE UserId=${staff.id}`);
    await req('GET', '/driver/orders', undefined, b);
    check(sql(`SELECT count(*) FROM UserSessions WHERE UserId=${staff.id} AND ExpiresAt>datetime('now','+29 days')`), '(1,)', 'Se renueva la vigencia');
    // Peticiones que ya entraron pueden terminar; ninguna puede recrear la sesión después del logout.
    sql(`UPDATE UserSessions SET ExpiresAt=datetime('now','+1 hour') WHERE UserId=${staff.id}`);
    const inFlight = Array.from({ length: 12 }, () => fetch(base + '/api/driver/orders', { headers: { Cookie: b } }));
    const logout = req('POST', '/auth/logout', undefined, b, 204);
    const responses = await Promise.all(inFlight); await logout;
    for (const r of responses) { assert([200, 401].includes(r.status)); checks++; await r.arrayBuffer(); }
    await req('GET', '/driver/orders', undefined, b, 401);
    check(sql(`SELECT count(*) FROM UserSessions WHERE UserId=${staff.id}`), '(0,)', 'La renovación no resucita sesiones revocadas');
    await stop(); await start();
    await req('GET', '/driver/orders', undefined, b, 401);
    const c = (await login('sesiones-prueba', 'clave-prueba-123')).cookie;
    const d = (await login('sesiones-prueba', 'clave-prueba-123')).cookie;
    const current = (await req('PUT', '/auth/profile', { fullName: 'Perfil renovado', currentPassword: 'clave-prueba-123', newPassword: 'clave-prueba-456' }, c)).cookie;
    await req('GET', '/driver/orders', undefined, c, 401);
    await req('GET', '/driver/orders', undefined, d, 401);
    await req('GET', '/driver/orders', undefined, current);
    await req('PUT', `/admin/users/${staff.id}`, { login: staff.login, fullName: staff.fullName, role: staff.role, status: 'Suspendido' }, master);
    await req('GET', '/driver/orders', undefined, current, 401);
    await req('PUT', `/admin/users/${staff.id}`, { login: staff.login, fullName: staff.fullName, role: staff.role, status: 'Activo' }, master);
    const expired = (await login('sesiones-prueba', 'clave-prueba-456')).cookie;
    sql(`UPDATE UserSessions SET ExpiresAt=datetime('now','-1 minute') WHERE UserId=${staff.id}`);
    await req('GET', '/driver/orders', undefined, expired, 401);
    const e = (await login('sesiones-prueba', 'clave-prueba-456')).cookie;
    check(sql(`SELECT count(*) FROM UserSessions WHERE UserId=${staff.id}`), '(1,)', 'Se limpian filas caducadas al iniciar sesión');
    await stop();
    sql('DROP TABLE UserSessions'); // Simula una base anterior a la actualización, sin tocar usuarios/pedidos.
    await start();
    await req('GET', '/driver/orders', undefined, e, 401);
    const upgraded = await login('sesiones-prueba', 'clave-prueba-456');
    await req('GET', '/driver/orders', undefined, upgraded.cookie);
    check(upgraded.body.id, staff.id, 'La actualización conserva al usuario existente');
    await req('POST', '/auth/logout', undefined, upgraded.cookie, 204);
    await req('GET', '/driver/orders', undefined, upgraded.cookie, 401);
    console.log(`Sesiones revocables: ${checks} comprobaciones correctas, incluidos reinicios y actualización de esquema.`);
  } finally { await stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
