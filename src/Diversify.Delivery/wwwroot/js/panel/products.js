// Productos y precios: alta, edición con foto, cambio rápido de precio en la tabla, ajuste por porcentaje
// y categorías.
import { api } from '../api.js';
import { esc, icon, money, modal, formData, attempt, toast, prepareImage, fmtDateTime, debounce } from '../ui.js';

const UNITS = ['UND', 'LB', 'KG', 'BOL', 'PAQ', 'CTN', 'CJA', 'LT'];

export default {
  route: 'productos', title: 'Productos y precios', icon: 'tag',
  async render(el) {
    let categories = await api.get('/admin/categories');
    let list = [];
    const filters = { search: '', categoryId: '', active: '' };

    el.innerHTML = `<div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Nombre, código o código de barras"></div>
        <select id="cat" aria-label="Categoría"></select>
        <select id="act" aria-label="Estado"><option value="">Todos</option><option value="true">Visibles</option><option value="false">Ocultos</option></select>
        <span class="grow"></span>
        <button class="btn" id="cats">${icon('grid')} Categorías</button>
        <button class="btn" id="bulk">${icon('percent')} Ajustar %</button>
        <button class="btn primary" id="new">${icon('plus')} Nuevo producto</button>
      </div>
      <p class="small muted" style="margin:-4px 0 12px">Cambia el precio directo en la tabla y presiona Enter. Los productos que vienen de Diversify POS quedan con precio fijo al cambiarlos aquí.</p>
      <div id="tbl"><div class="empty">Cargando…</div></div>`;

    const fillCats = () => {
      el.querySelector('#cat').innerHTML = `<option value="">Todas las categorías</option>${categories.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}`;
      el.querySelector('#cat').value = filters.categoryId;
    };
    fillCats();

    const iconFor = (p) => p.icon || categories.find((c) => c.id === p.categoryId)?.icon || '🛒';

    const draw = async () => {
      list = await attempt(() => api.get('/admin/products', filters)) || [];
      el.querySelector('#tbl').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr>
          <th></th><th>Producto</th><th>Categoría</th><th class="num">Precio (L)</th><th class="num">Antes</th><th class="num">Exist.</th><th>Estado</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr data-id="${p.id}">
          <td><div class="thumb-sm">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(iconFor(p))}</div></td>
          <td><strong>${esc(p.name)}</strong> ${p.featured ? '⭐' : ''}<div class="small muted mono">${esc(p.code)} · ${esc(p.unit)}${p.taxRate ? ` · ISV ${p.taxRate}%` : ''}
            ${p.source === 'Diversify' ? ` · <span class="badge st-Listo plain" title="Sincronizado con Diversify POS">Diversify${p.priceLocked ? ' · precio fijo' : ''}</span>` : ''}</div></td>
          <td>${esc(p.category || '—')}</td>
          <td class="num"><input class="price-input" type="number" step="0.5" min="0.5" value="${p.price.toFixed(2)}" data-price aria-label="Precio de ${esc(p.name)}"></td>
          <td class="num small muted">${p.compareAtPrice ? money(p.compareAtPrice) : ''}</td>
          <td class="num small">${p.stock ?? '—'}</td>
          <td>${p.active ? '<span class="badge st-Activo">Visible</span>' : '<span class="badge st-Pendiente">Oculto</span>'}</td>
          <td class="right"><button class="btn ghost icon sm" data-edit aria-label="Editar">${icon('edit')}</button></td></tr>`).join('')}
        </tbody></table></div><p class="small muted">${list.length} productos</p>` : '<div class="empty"><div class="big">🏷️</div>No hay productos con esos filtros.</div>';
    };

    const savePrice = async (input) => {
      const id = Number(input.closest('tr').dataset.id);
      const p = list.find((x) => x.id === id);
      const price = Number(input.value);
      if (!price || price === p.price) return;
      const r = await attempt(() => api.put(`/admin/products/${id}/price`, { price, compareAtPrice: p.compareAtPrice }));
      if (r) { Object.assign(p, r); input.value = r.price.toFixed(2); toast(`${p.name}: ${money(r.price)}`); } else input.value = p.price.toFixed(2);
    };

    el.querySelector('#tbl').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-price]')) { e.preventDefault(); e.target.blur(); } });
    el.querySelector('#tbl').addEventListener('change', (e) => { if (e.target.matches('[data-price]')) savePrice(e.target); });
    el.querySelector('#tbl').addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) edit(list.find((x) => x.id === Number(e.target.closest('tr').dataset.id)));
    });
    el.querySelector('#q').addEventListener('input', debounce((e) => { filters.search = e.target.value; draw(); }, 300));
    el.querySelector('#cat').addEventListener('change', (e) => { filters.categoryId = e.target.value; draw(); });
    el.querySelector('#act').addEventListener('change', (e) => { filters.active = e.target.value; draw(); });
    el.querySelector('#new').addEventListener('click', () => edit(null));
    el.querySelector('#bulk').addEventListener('click', bulk);
    el.querySelector('#cats').addEventListener('click', manageCategories);

    function edit(p) {
      let image = p?.image ? 'keep' : null;
      let imageData = null;
      modal({
        title: p ? `Editar: ${p.name}` : 'Nuevo producto', wide: true,
        body: `<form class="stack" id="pf">
          <div class="img-drop"><div class="thumb-lg" id="thumb">${p?.image ? `<img src="${esc(p.image)}" alt="">` : esc(p ? iconFor(p) : '🛒')}</div>
            <div class="stack" style="gap:8px"><label class="btn sm">${icon('image')} Subir foto<input type="file" accept="image/*" id="file" class="sr-only"></label>
              <button type="button" class="btn ghost sm" id="rmimg">Quitar foto</button><span class="small muted">JPG o PNG. Se reduce sola a 800 px.</span></div></div>
          <div class="grid-2">
            <label class="field"><span>Nombre *</span><input name="name" required maxlength="160" value="${esc(p?.name || '')}"></label>
            <label class="field"><span>Categoría</span><select name="categoryId"><option value="">— Sin categoría —</option>${categories.map((c) => `<option value="${c.id}" ${c.id === p?.categoryId ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
          </div>
          <div class="grid-3">
            <label class="field"><span>Precio (L, con ISV) *</span><input name="price" type="number" step="0.01" min="0.01" required value="${p?.price ?? ''}"></label>
            <label class="field"><span>Precio anterior (oferta)</span><input name="compareAtPrice" type="number" step="0.01" min="0" value="${p?.compareAtPrice ?? ''}" placeholder="Opcional"></label>
            <label class="field"><span>ISV</span><select name="taxRate">${[0, 15, 18].map((t) => `<option value="${t}" ${t === (p?.taxRate ?? 0) ? 'selected' : ''}>${t === 0 ? 'Exento (0 %)' : `${t} %`}</option>`).join('')}</select></label>
          </div>
          <div class="grid-3">
            <label class="field"><span>Unidad</span><select name="unit">${UNITS.map((u) => `<option ${u === (p?.unit || 'UND') ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
            <label class="field"><span>Código</span><input name="code" maxlength="40" value="${esc(p?.code || '')}" placeholder="Automático"></label>
            <label class="field"><span>Código de barras</span><input name="barcode" maxlength="40" value="${esc(p?.barcode || '')}"></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Descripción</span><textarea name="description" maxlength="600">${esc(p?.description || '')}</textarea></label>
            <label class="field"><span>Emoji (si no hay foto)</span><input name="icon" maxlength="16" value="${esc(p?.icon || '')}" placeholder="🥑"></label>
          </div>
          <div class="row"><label class="check"><input type="checkbox" name="active" ${p?.active !== false ? 'checked' : ''}> Visible en la tienda</label>
            <label class="check"><input type="checkbox" name="featured" ${p?.featured ? 'checked' : ''}> Destacado en la portada</label></div>
          ${p ? '<details><summary class="small">Historial de precios</summary><div id="hist" class="small" style="margin-top:8px">Cargando…</div></details>' : ''}
        </form>`,
        actions: [{ label: 'Cancelar' }, { label: p ? 'Guardar cambios' : 'Crear producto', kind: 'primary', onClick: async (close, mel) => {
          const f = mel.querySelector('#pf');
          if (!f.reportValidity()) return false;
          const d = formData(f);
          const body = { ...d, categoryId: d.categoryId ? Number(d.categoryId) : null, taxRate: Number(d.taxRate),
            imageData, updateImage: image !== 'keep' };
          const r = await attempt(() => p ? api.put(`/admin/products/${p.id}`, body) : api.post('/admin/products', body), p ? 'Producto guardado.' : 'Producto creado.');
          if (!r) return false;
          draw();
          return undefined;
        } }],
        onOpen: (mel) => {
          mel.querySelector('#file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            imageData = await attempt(() => prepareImage(file));
            if (imageData) { image = 'new'; mel.querySelector('#thumb').innerHTML = `<img src="${imageData}" alt="">`; }
          });
          mel.querySelector('#rmimg').addEventListener('click', () => { image = null; imageData = null; mel.querySelector('#thumb').textContent = p ? iconFor(p) : '🛒'; });
          if (p) api.get(`/admin/products/${p.id}/price-history`).then((h) => {
            mel.querySelector('#hist').innerHTML = h.length ? h.map((x) => `<div>${fmtDateTime(x.changedAt)} · ${money(x.oldPrice)} → <strong>${money(x.newPrice)}</strong> · ${esc(x.changedBy)}</div>`).join('') : 'Sin cambios registrados.';
          });
        },
      });
    }

    function bulk() {
      modal({
        title: 'Ajustar precios por porcentaje',
        body: `<form class="stack" id="bf">
          <label class="field"><span>Productos</span><select name="categoryId"><option value="">Toda la tienda (visibles)</option>${categories.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Porcentaje (+ sube, − baja)</span><input name="percent" type="number" step="0.5" required placeholder="Ej.: 5 o -10"></label>
          <label class="check"><input type="checkbox" name="roundToHalf" checked> Redondear a L 0.50</label>
          <div class="alert warn small">${icon('alert')}<div>Se guarda en el historial de precios de cada producto.</div></div></form>`,
        actions: [{ label: 'Cancelar' }, { label: 'Aplicar', kind: 'primary', onClick: async (close, mel) => {
          const f = mel.querySelector('#bf');
          if (!f.reportValidity()) return false;
          const d = formData(f);
          const r = await attempt(() => api.post('/admin/products/bulk-price', { ...d, categoryId: d.categoryId ? Number(d.categoryId) : null }));
          if (!r) return false;
          toast(`${r.updated} precios actualizados.`);
          draw();
          return undefined;
        } }],
      });
    }

    function manageCategories() {
      const body = () => `<div class="table-wrap"><table class="table"><thead><tr><th>Emoji</th><th>Nombre</th><th class="num">Orden</th><th class="num">Productos</th><th>Visible</th><th></th></tr></thead><tbody>
        ${categories.map((c) => `<tr data-id="${c.id}"><td><input class="price-input" style="width:60px;text-align:center" name="icon" value="${esc(c.icon)}"></td>
          <td><input class="input" name="name" value="${esc(c.name)}"></td><td class="num"><input class="price-input" style="width:70px" type="number" name="sortOrder" value="${c.sortOrder}"></td>
          <td class="num">${c.products}</td><td><input type="checkbox" name="active" ${c.active ? 'checked' : ''}></td>
          <td><button class="btn sm" data-save>Guardar</button></td></tr>`).join('')}
        <tr data-id="new"><td><input class="price-input" style="width:60px;text-align:center" name="icon" placeholder="🛒"></td><td><input class="input" name="name" placeholder="Nueva categoría"></td>
          <td class="num"><input class="price-input" style="width:70px" type="number" name="sortOrder" value="${categories.length}"></td><td></td><td><input type="checkbox" name="active" checked></td>
          <td><button class="btn sm primary" data-save>Agregar</button></td></tr></tbody></table></div>`;
      const m = modal({ title: 'Categorías', wide: true, body: body() });
      m.el.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-save]')) return;
        const tr = e.target.closest('tr');
        const v = (n) => tr.querySelector(`[name=${n}]`);
        const data = { name: v('name').value.trim(), icon: v('icon').value.trim() || '🛒', sortOrder: Number(v('sortOrder').value) || 0, active: v('active').checked };
        if (!data.name) return toast('Escribe el nombre.', 'error');
        const r = await attempt(() => tr.dataset.id === 'new' ? api.post('/admin/categories', data) : api.put(`/admin/categories/${tr.dataset.id}`, data), 'Categoría guardada.');
        if (r) { categories = await api.get('/admin/categories'); m.el.querySelector('.body').innerHTML = body(); fillCats(); }
      });
    }

    await draw();
  },
};
