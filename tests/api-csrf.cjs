// Cliente HTTP de pruebas: obtiene el token real y conserva su cookie; no omite la validación del servidor.
const sessions = new Map();
async function csrfFetch(base, url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetch(base + url, options);
  const headers = new Headers(options.headers);
  const cookie = headers.get('Cookie') || '';
  const key = base + '\0' + cookie;
  if (!sessions.has(key)) {
    const pending = fetch(base + '/api/auth/csrf', { headers: { Cookie: cookie } }).then(async (r) => {
      if (!r.ok) throw new Error(`No se obtuvo token CSRF: ${r.status}`);
      const antiforgeryCookie = r.headers.getSetCookie().find((s) => s.startsWith('diversify.csrf='))?.split(';')[0];
      if (!antiforgeryCookie) throw new Error('Falta cookie antiforgery en el cliente de prueba.');
      return { token: (await r.json()).requestToken, cookie: antiforgeryCookie };
    }).catch((e) => { sessions.delete(key); throw e; });
    sessions.set(key, pending);
  }
  const csrf = await sessions.get(key);
  headers.set('Cookie', [cookie, csrf.cookie].filter(Boolean).join('; '));
  headers.set('X-CSRF-TOKEN', csrf.token);
  const response = await fetch(base + url, { ...options, headers });
  if (response.status === 401 || response.headers.get('X-CSRF-Error') ||
      (response.ok && /^\/api\/auth\/(login|register|logout|reset|profile)$/.test(url))) sessions.delete(key);
  return response;
}
module.exports = { csrfFetch };
