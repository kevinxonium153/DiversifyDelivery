// Utilidades de interfaz compartidas por la tienda, el panel y la app del repartidor.

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const moneyFmt = new Intl.NumberFormat('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('es-HN', { maximumFractionDigits: 2 });
export const money = (n) => `L ${moneyFmt.format(Number(n) || 0)}`;
export const usd = (n) => `$${moneyFmt.format(Number(n) || 0)}`;
export const qty = (n) => qtyFmt.format(Number(n) || 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('es-HN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('es-HN', { hour: 'numeric', minute: '2-digit' }) : '';
// Fechas sin hora (YYYY-MM-DD) se leen como hora local, no UTC (si no, en Honduras saldría el día anterior).
export const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' }) : '';

/** "hace 5 min", "hace 2 h"… para tarjetas de pedidos. */
export function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return fmtDate(iso);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const STATUS = {
  Recibido: 'Recibido', Preparando: 'Preparando', Listo: 'Listo', EnCamino: 'En camino', Entregado: 'Entregado', Cancelado: 'Cancelado',
  PendientePago: 'Pendiente de pago', EnRevision: 'En revisión', Activo: 'Activo', Suspendido: 'Suspendido',
  Pendiente: 'Pendiente', Aprobado: 'Aprobado', Rechazado: 'Rechazado',
};
export const statusBadge = (s) => `<span class="badge st-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
export const FLOW = ['Recibido', 'Preparando', 'Listo', 'EnCamino', 'Entregado'];

/** Barra de progreso del pedido (5 pasos). */
export function steps(status) {
  if (status === 'Cancelado') return `<div class="alert err">${icon('x')}<div>Pedido cancelado.</div></div>`;
  const at = FLOW.indexOf(status);
  return `<div class="steps">${FLOW.map((s, i) => `<div class="step ${i < at ? 'done' : ''} ${i === at ? 'now done' : ''}"><i></i>${esc(STATUS[s])}</div>`).join('')}</div>`;
}

const PAY = { Efectivo: 'Efectivo', Transferencia: 'Transferencia', Tarjeta: 'Tarjeta (POS al recibir)' };
export const payLabel = (m) => PAY[m] || m;

/** Enlaces de navegación para el repartidor. */
export const mapsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const wazeUrl = (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
export const telUrl = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
/** WhatsApp: números de Honduras de 8 dígitos se completan con 504. */
export function waUrl(phone, text = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 8) digits = `504${digits}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Distancia en km entre dos puntos (fórmula del haversine). */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Avisos ----------
export function toast(message, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, type === 'error' ? 6000 : 3200);
}

/** Ejecuta una acción async mostrando el error como aviso. Devuelve el resultado o undefined. */
export async function attempt(fn, successMessage) {
  try {
    const result = await fn();
    if (successMessage) toast(successMessage);
    return result;
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  }
}

/**
 * Modal. `body` es HTML. `actions`: [{ label, kind, onClick(close, el) }].
 * Si onClick devuelve false (o una promesa que resuelve en false) el modal no se cierra.
 */
export function modal({ title, body, actions = [], wide = false, onOpen, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="btn ghost icon sm" data-close aria-label="Cerrar">${icon('x')}</button></header>
    <div class="body">${body}</div>
    ${actions.length ? `<footer>${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-action="${i}">${a.label}</button>`).join('')}</footer>` : ''}
  </div>`;
  const el = backdrop.querySelector('.modal');
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', async (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) return close();
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = actions[Number(btn.dataset.action)];
    btn.disabled = true;
    try {
      const keep = await action.onClick?.(close, el);
      if (keep !== false) close();
    } finally { btn.disabled = false; }
  });
  document.body.append(backdrop);
  onOpen?.(el, close);
  el.querySelector('input, select, textarea')?.focus();
  return { el, close };
}

export function confirmDialog(title, message, { okLabel = 'Confirmar', kind = 'primary' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title, body: `<p>${esc(message)}</p>`,
      actions: [
        { label: 'Cancelar', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, kind, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** Lee un formulario como objeto. Campos number → número; checkbox → booleano; vacíos → null. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

/** Reduce una foto a máximo 800 px en JPEG (≤ 400 KB) para subirla como data URL. */
export function prepareImage(file, max = 800) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen.'));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      let q = 0.85, data = canvas.toDataURL('image/jpeg', q);
      while (data.length > 540000 && q > 0.4) { q -= 0.1; data = canvas.toDataURL('image/jpeg', q); }
      resolve(data);
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Íconos (24×24, trazo) ----------
const ICONS = {
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z"/>',
  nav: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  bank: '<path d="M3 10h18L12 4 3 10ZM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h6l3.5 8M12 9 10 5H7.5M15 9l-3 8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M5 3v5h5M19 21v-5h-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>',
};
export function icon(name, extra = '') {
  return `<svg class="ico ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
