// Cliente HTTP para la API de Diversify Delivery. Todas las rutas son relativas a /api.

let onUnauthorized = () => {};
let csrfToken;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function queryString(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request(method, url, body) {
  let res;
  try {
    const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {};
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      // Compartir la primera carga evita crear cookies antiforgery distintas en escrituras paralelas.
      csrfToken ??= fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error('No se pudo preparar la solicitud. Recarga la página.');
        return (await r.json()).requestToken;
      }).catch((e) => { csrfToken = undefined; throw e; });
      headers['X-CSRF-TOKEN'] = await csrfToken;
    }
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  if (res.status === 401 || (url === '/auth/me' && res.status === 204) || res.headers.get('X-CSRF-Error') ||
      (res.ok && /^\/auth\/(login|register|logout|reset|profile)$/.test(url))) csrfToken = undefined;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  if (res.status === 401 && !url.startsWith('/auth/login')) {
    onUnauthorized();
    throw new Error(data?.error || 'Inicia sesión para continuar.');
  }
  if (res.status === 403) throw new Error(data?.error || 'No tienes permiso para realizar esta acción.');
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export const api = {
  get: (url, params) => request('GET', url + queryString(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
