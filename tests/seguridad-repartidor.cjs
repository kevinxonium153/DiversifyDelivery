// Regresiones S01 y S02. Solo en una instancia local desechable con usuarios y pagos demo.
// ALLOW_DEMO_MUTATIONS=1 BASE=http://127.0.0.1:5493 node tests/seguridad-repartidor.cjs
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://localhost:5390';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname), 'Usa una instancia local desechable.');
assert.equal(process.env.ALLOW_DEMO_MUTATIONS, '1', 'Confirma base demo desechable con ALLOW_DEMO_MUTATIONS=1.');
let checks = 0;
function client() {
  let cookie;
  return async (method, path, data, expected = 200) => {
    const r = await fetch(BASE + '/api' + path, { method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await r.text();
    if (Array.isArray(expected)) assert(expected.includes(r.status), `${method} ${path}: ${r.status} ${text}`);
    else assert.equal(r.status, expected, `${method} ${path}: ${text}`);
    checks++;
    const set = r.headers.getSetCookie().find((s) => s.startsWith('diversify.delivery='));
    if (set) cookie = set.split(';')[0];
    const body = text ? JSON.parse(text) : null;
    return Array.isArray(expected) ? { status: r.status, body } : body;
  };
}
(async () => {
  const master = client(), driver = client(), other = client(), customer = client(), anon = client();
  await master('POST', '/auth/login', { login: 'master', password: 'master123' });
  const me = await driver('POST', '/auth/login', { login: 'repartidor', password: 'repartidor123' });
  await other('POST', '/auth/login', { login: 'repartidor2', password: 'repartidor123' });
  await customer('POST', '/auth/register', { fullName: 'Regresión seguridad', email: `seguridad${Date.now()}@demo.hn`, phone: '99999999', password: 'prueba-local-123' }, 201);
  await customer('POST', '/registration/card');
  const settings = await master('GET', '/admin/settings');
  try {
    await master('PUT', '/admin/settings', { ...settings, opensAt: '00:00', closesAt: '00:00', acceptingOrders: true });
    const address = await customer('POST', '/addresses/', { label: 'Prueba', line: 'Dirección ficticia de regresión' }, 201);
    const { items } = await anon('GET', '/catalog/products?limit=200');
    const p = items.find((x) => x.available && x.price > 0);
    assert(p, 'Se necesita un producto demo disponible.');
    const quantity = Math.max(1, Math.ceil(settings.minimumOrder / p.price) + 1);
    const create = () => customer('POST', '/orders/', { addressId: address.id,
      items: [{ productId: p.id, quantity }], paymentMethod: 'Efectivo' }, 201);
    const inspect = (id) => master('GET', `/admin/orders/${id}`);
    async function deniedRelease(id, actor = driver, expected = 400) {
      const before = await inspect(id);
      await actor('POST', `/driver/orders/${id}/release`, undefined, expected);
      const after = await inspect(id);
      assert.deepEqual(after, before, 'Un rechazo no debe cambiar asignación, estado, fecha ni eventos.'); checks++;
    }
    async function read(id, actor = driver, expected = 200) {
      const o = await actor('GET', `/driver/orders/${id}`, undefined, expected);
      if (expected === 200) { assert.equal(o.deliveryPin, null, 'Nunca revelar PIN al repartidor.'); checks++; }
    }
    const o = await create(), id = o.id;
    await read(id, driver, 404); // Recibido sin asignar no es disponible.
    await read(id, anon, 401);
    await read(id, customer, 403);
    await master('POST', `/admin/orders/${id}/assign`, { driverId: me.id });
    await deniedRelease(id); // Ni siquiera Recibido asignado se puede soltar.
    await read(id, other, 404);
    await master('POST', `/admin/orders/${id}/status`, { status: 'Preparando' });
    await driver('POST', `/driver/orders/${id}/release`);
    await read(id); // Preparando sin asignar sigue disponible.
    await driver('POST', `/driver/orders/${id}/take`);
    await master('POST', `/admin/orders/${id}/status`, { status: 'Listo' });
    await driver('POST', `/driver/orders/${id}/release`);
    await read(id); // Listo sin asignar sigue disponible.
    await driver('POST', `/driver/orders/${id}/take`);
    await deniedRelease(id, other, 404);
    await driver('POST', `/driver/orders/${id}/pickup`);
    await deniedRelease(id); // EnCamino no se puede soltar.
    await driver('POST', `/driver/orders/${id}/deliver`, { pin: o.deliveryPin });
    await deniedRelease(id); // Entregado conserva atribución y bitácora.
    await read(id); // El dueño conserva acceso a su historial.
    await read(id, other, 404);
    const history = await driver('GET', '/driver/orders?scope=history');
    assert(history.some((x) => x.id === id), 'La entrega debe permanecer en el historial del repartidor.'); checks++;
    const cancelled = await create();
    await master('POST', `/admin/orders/${cancelled.id}/assign`, { driverId: me.id });
    await master('POST', `/admin/orders/${cancelled.id}/cancel`, { reason: 'Regresión local' });
    await deniedRelease(cancelled.id);
    await read(cancelled.id, other, 404);
    const unassigned = await create();
    await customer('POST', `/orders/${unassigned.id}/cancel`, { reason: 'Regresión local' });
    await read(unassigned.id, driver, 404); // Cancelado sin asignar tampoco es disponible.
    const available = await driver('GET', '/driver/orders?scope=available');
    assert(!available.some((x) => [id, cancelled.id, unassigned.id].includes(x.id)), 'No listar cerrados como disponibles.'); checks++;
    // Dos cookies distintas compiten por el mismo pedido. Comprobar respuestas Y estado persistido.
    const contested = await create();
    await master('POST', `/admin/orders/${contested.id}/status`, { status: 'Preparando' });
    for (let round = 0; round < 12; round++) {
      if (round > 0) await master('POST', `/admin/orders/${contested.id}/status`, { status: round % 2 ? 'Listo' : 'Preparando' });
      const before = await inspect(contested.id);
      const actors = round % 2 ? [other, driver] : [driver, other];
      const outcomes = await Promise.all(actors.map((actor) => actor('POST', `/driver/orders/${contested.id}/take`, undefined, [200, 409])));
      assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409], 'Exactamente un repartidor gana; el otro recibe conflicto.'); checks++;
      const winnerIndex = outcomes.findIndex((r) => r.status === 200);
      const winner = actors[winnerIndex], loser = actors[1 - winnerIndex];
      const saved = await inspect(contested.id);
      assert.equal(saved.driverId, outcomes[winnerIndex].body.driverId, 'La asignación persistida debe coincidir con la confirmación.'); checks++;
      assert.equal(saved.events.length, before.events.length + 1, 'Solo la asignación ganadora añade un evento.'); checks++;
      assert.equal(saved.status, before.status); checks++;
      assert.equal(outcomes[winnerIndex].body.deliveryPin, null); checks++;
      assert.deepEqual(Object.keys(outcomes[1 - winnerIndex].body), ['error'], 'El conflicto no debe devolver datos del pedido.'); checks++;
      await read(contested.id, loser, 404);
      await loser('POST', `/driver/orders/${contested.id}/release`, undefined, 404);
      // Reenviar la misma solicitud del ganador no vuelve a asignar ni duplica eventos.
      await Promise.all([winner('POST', `/driver/orders/${contested.id}/take`), winner('POST', `/driver/orders/${contested.id}/take`)]);
      assert.deepEqual(await inspect(contested.id), saved, 'Los reintentos del dueño son idempotentes.'); checks++;
      await winner('POST', `/driver/orders/${contested.id}/release`);
      assert.equal((await inspect(contested.id)).driverId, null); checks++;
    }
    await master('POST', `/admin/orders/${contested.id}/cancel`, { reason: 'Fin de regresión de concurrencia' });
    const closed = await inspect(contested.id);
    await driver('POST', `/driver/orders/${contested.id}/take`, undefined, 409);
    assert.deepEqual(await inspect(contested.id), closed); checks++;
  } finally {
    await master('PUT', '/admin/settings', settings);
  }
  console.log(`Seguridad de repartidores: ${checks} comprobaciones correctas.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
