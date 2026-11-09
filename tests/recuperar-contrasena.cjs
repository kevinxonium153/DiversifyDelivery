// Prueba de "¿Olvidaste tu contraseña?" de punta a punta.
//
// Sin servidor de correo (desarrollo), la app guarda los correos como .eml en src/Diversify.Delivery/data/correos:
// la prueba lee el enlace de ahí, como lo haría el cliente desde su bandeja.
//
//   Security__LoginAttemptsPerMinute=100 dotnet run --project src/Diversify.Delivery --launch-profile http
//   node tests/recuperar-contrasena.cjs
// (el límite de intentos por IP se sube solo para la prueba: hace muchas peticiones seguidas desde la misma IP)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { csrfFetch } = require('./api-csrf.cjs');

const BASE = process.env.BASE || 'http://localhost:5390';
const MAIL = path.join(__dirname, '..', 'src', 'Diversify.Delivery', 'data', 'correos');
const OUT = path.join(__dirname, '..', 'docs', 'capturas');
const SAVE = process.env.CAPTURAS !== '0';
const EMAIL = 'luis@demo.hn';
const OLD = 'cliente123';
const NEW = 'nueva-clave-2026';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-HN' };
const errors = [];

const mails = () => (fs.existsSync(MAIL) ? fs.readdirSync(MAIL).filter((f) => f.endsWith('.eml')) : []);
/** Encabezados + cuerpos del .eml decodificados (.NET guarda las partes en base64). */
function readEml(text) {
  const parts = text.split(/\r?\n--/).map((part) => {
    const m = part.match(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+\/=\r\n]+)/);
    return m ? Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString('utf8') : '';
  });
  return [text, ...parts].join('\n');
}
async function newMail(before) {
  for (let i = 0; i < 40; i++) {
    const f = mails().find((x) => !before.includes(x));
    if (f) return readEml(fs.readFileSync(path.join(MAIL, f), 'utf8'));
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No llegó el correo');
}
const post = (url, body, cookie = '') => csrfFetch(BASE, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

async function page(browser) {
  const p = await (await browser.newContext(PHONE)).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  return p;
}

(async () => {
  const browser = await chromium.launch();

  console.log('1. Correo que no existe: misma respuesta, sin correo');
  let before = mails();
  const unknown = await (await post('/api/auth/forgot', { email: 'nadie@correo.hn' })).json();
  const known = await (await post('/api/auth/forgot', { email: 'otro-que-no-existe@correo.hn' })).json();
  assert.strictEqual(unknown.message, known.message);
  await new Promise((r) => setTimeout(r, 500));
  assert.deepStrictEqual(mails(), before);
  console.log('  ✓ no revela si el correo tiene cuenta');

  console.log('2. Sesión abierta en otro equipo (debe cerrarse al cambiar la contraseña)');
  const login = await post('/api/auth/login', { login: EMAIL, password: OLD });
  const otherCookie = login.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await fetch(BASE + '/api/auth/me', { headers: { Cookie: otherCookie } })).status, 200);

  console.log('3. Pedir el enlace desde la tienda');
  const p = await page(browser);
  await p.goto(`${BASE}/#/ingresar`);
  await p.click('text=¿Olvidaste tu contraseña?');
  await p.fill('#forgot [name=email]', EMAIL);
  before = mails();
  await p.click('#forgot button');
  await p.waitForSelector('text=Revisa tu correo');
  if (SAVE) await p.screenshot({ path: path.join(OUT, '50-recuperar-contrasena.png') });
  const mail = await newMail(before);
  assert.ok(mail.includes(`To: ${EMAIL}`), 'destinatario');
  const link = mail.match(/https?:\/\/[^\s"<]+#\/restablecer\/([A-Za-z0-9_-]{40,})/);
  assert.ok(link, 'el correo trae el enlace');
  console.log(`  ✓ correo recibido con enlace (${link[1].length} caracteres)`);

  console.log('4. Abrir el enlace y crear la contraseña nueva');
  await p.goto(link[0]);
  await p.waitForSelector('#reset');
  await p.fill('[name=password]', NEW);
  await p.fill('[name=confirm]', 'otra-distinta-1');
  await p.click('#reset button');
  await p.waitForSelector('.toast.error');
  await p.fill('[name=confirm]', NEW);
  if (SAVE) await p.screenshot({ path: path.join(OUT, '51-contrasena-nueva.png') });
  await p.click('#reset button');
  await p.waitForSelector('.product');
  const me = await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
  assert.strictEqual(me.login, EMAIL);
  console.log('  ✓ contraseña cambiada y sesión iniciada');

  console.log('5. Contraseñas y sesiones');
  assert.strictEqual((await post('/api/auth/login', { login: EMAIL, password: OLD })).status, 401);
  assert.strictEqual((await post('/api/auth/login', { login: EMAIL, password: NEW })).status, 200);
  assert.strictEqual((await fetch(BASE + '/api/auth/me', { headers: { Cookie: otherCookie } })).status, 204);
  console.log('  ✓ la anterior ya no sirve, la nueva sí, y la sesión del otro equipo se cerró');

  console.log('6. El enlace no sirve dos veces');
  const p2 = await page(browser);
  await p2.goto(link[0]);
  await p2.waitForSelector('text=venció o ya se usó');
  assert.strictEqual((await post('/api/auth/reset', { token: link[1], password: 'otra-clave-123' })).status, 400);
  console.log('  ✓ enlace usado rechazado');

  console.log('7. Un enlace nuevo invalida el anterior, y máximo 3 por hora');
  before = mails();
  await post('/api/auth/forgot', { email: EMAIL });
  const first = (await newMail(before)).match(/#\/restablecer\/([A-Za-z0-9_-]+)/)[1];
  before = mails();
  await post('/api/auth/forgot', { email: EMAIL });
  const second = (await newMail(before)).match(/#\/restablecer\/([A-Za-z0-9_-]+)/)[1];
  assert.strictEqual((await fetch(`${BASE}/api/auth/reset/${first}`)).status, 400);
  assert.strictEqual((await fetch(`${BASE}/api/auth/reset/${second}`)).status, 200);
  before = mails();
  const r4 = await post('/api/auth/forgot', { email: EMAIL }); // 4.ª de la hora (contando la del paso 3)
  assert.strictEqual(r4.status, 200);
  await new Promise((r) => setTimeout(r, 800));
  assert.deepStrictEqual(mails(), before, 'no envía un 4.º correo en la misma hora');
  console.log('  ✓ el anterior quedó inválido y el límite por hora funciona');

  // Deja la contraseña de demostración como estaba.
  await post('/api/auth/reset', { token: second, password: OLD });

  await browser.close();
  if (errors.length) { console.error('Errores en el navegador:\n' + errors.join('\n')); process.exit(1); }
  console.log('Recuperar contraseña: todo correcto.');
})().catch((e) => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
