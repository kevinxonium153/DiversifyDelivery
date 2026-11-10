// Estado de la tienda: sesión, ajustes y carrito (el carrito se guarda en este navegador).
import { api } from '../api.js';

const CART_KEY = 'dd.cart.v1';
const listeners = new Set();

export const state = {
  user: null,     // null = visitante
  store: null,    // ajustes públicos (envío, mínimo, horario, suscripción, % de puntos)
  cart: loadCart(),
};

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch { /* modo privado */ }
  listeners.forEach((fn) => fn());
}
export function onCartChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Paso para sumar/restar: por libra o kilo se pide de media en media; lo demás por unidad. */
export const stepFor = (unit) => (unit === 'LB' || unit === 'KG' ? 0.5 : 1);

export function cartQty(id) { return state.cart[id]?.qty || 0; }

export function setQty(product, qty) {
  qty = Math.max(0, Math.round(qty * 2) / 2);
  if (qty === 0) delete state.cart[product.id];
  else state.cart[product.id] = { id: product.id, name: product.name, price: product.price, unit: product.unit, icon: product.icon, image: product.image, qty, note: state.cart[product.id]?.note || '' };
  saveCart();
}

export function setNote(id, note) {
  if (state.cart[id]) { state.cart[id].note = note; saveCart(); }
}

export function clearCart() { state.cart = {}; saveCart(); }

export function cartLines() { return Object.values(state.cart); }

export function cartTotals() {
  const lines = cartLines();
  const subtotal = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const s = state.store || {};
  const fee = lines.length === 0 ? 0 : (s.freeDeliveryFrom > 0 && subtotal >= s.freeDeliveryFrom ? 0 : (s.deliveryFee || 0));
  return { count: lines.length, units: lines.reduce((n, l) => n + l.qty, 0), subtotal, fee, total: subtotal + fee,
    missingForMin: Math.max(0, (s.minimumOrder || 0) - subtotal), missingForFree: s.freeDeliveryFrom > 0 ? Math.max(0, s.freeDeliveryFrom - subtotal) : 0 };
}

/** Actualiza precios del carrito con los actuales del catálogo (el servidor cobra siempre el precio vigente). */
export function refreshCartPrices(products) {
  let changed = false;
  for (const p of products) {
    const line = state.cart[p.id];
    if (line && line.price !== p.price) { line.price = p.price; changed = true; }
  }
  if (changed) saveCart();
}

export async function loadSession() {
  try { state.user = await api.get('/auth/me'); } catch { state.user = null; }
  return state.user;
}

export async function loadStore() {
  state.store = await api.get('/store');
  return state.store;
}
