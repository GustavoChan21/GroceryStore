import { initCloud, signInCloud, signUpCloud, signOutCloud, pushCloudState, queueCloudSave, getCloudStatus, isCloudConfigured } from './database.js?v=2.1.1';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const dateKey = (value = new Date()) => { const d = value instanceof Date ? value : new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const today = () => dateKey(new Date());
const now = () => new Date().toISOString();
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const paymentLabel = (m) => ({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito' }[m] || m);
const toLocalInput = (iso = now()) => {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const fromLocalInput = (value) => value ? new Date(value).toISOString() : now();

const seed = {
  products: [
    { id: 'p1', name: 'Coca-Cola 600 ml', category: 'Bebidas', barcode: '7501055300075', unit: 'botella', price: 20, cost: 13.5, stock: 18, minStock: 6, image: '' },
    { id: 'p2', name: 'Leche Entera 1 L', category: 'Lácteos', barcode: '7501020512359', unit: 'pieza', price: 29, cost: 22, stock: 9, minStock: 4, image: '' },
    { id: 'p3', name: 'Sabritas Original 45 g', category: 'Botanas', barcode: '7501011131060', unit: 'bolsa', price: 18, cost: 12, stock: 4, minStock: 5, image: '' },
    { id: 'p4', name: 'Huevo blanco', category: 'Abarrotes', barcode: '2000000001012', unit: 'pieza', price: 4, cost: 2.7, stock: 36, minStock: 12, image: '' },
    { id: 'p5', name: 'Agua purificada 1 L', category: 'Bebidas', barcode: '7501006550474', unit: 'botella', price: 14, cost: 8.5, stock: 3, minStock: 6, image: '' },
    { id: 'p6', name: 'Pan de caja', category: 'Panadería', barcode: '7501030410317', unit: 'pieza', price: 48, cost: 36, stock: 7, minStock: 3, image: '' }
  ],
  sales: [], entries: [], customers: [], payments: [], cashOpenings: {}
};

let db = JSON.parse(localStorage.getItem('abarrotes_db') || 'null') || structuredClone(seed);
let cart = [];
let productImageData = '';
let salesFilters = { from: today(), to: today(), status: '' };
let cloudBootstrapped = false;

function migrateDb() {
  db.products ||= [];
  db.sales ||= [];
  db.entries ||= [];
  db.customers ||= [];
  db.payments ||= [];
  db.cashOpenings ||= {};
  db.sales = db.sales.map((sale) => ({ ...sale, saleType: sale.saleType || (sale.method === 'credit' ? 'credit' : 'official') }));
  for (const p of db.products) {
    const sold = db.sales.reduce((sum, sale) => sum + sale.items.filter((i) => i.productId === p.id).reduce((a, i) => a + Number(i.qty || 0), 0), 0);
    const entered = db.entries.filter((e) => e.productId === p.id).reduce((sum, e) => sum + Number(e.qty || 0), 0);
    if (!("initialStock" in p)) p.initialStock = p.stock == null ? null : round3(Number(p.stock || 0) + sold - entered);
    if (p.initialStock === '') p.initialStock = null;
    if (p.initialCost == null) p.initialCost = Number(p.cost || 0);
    p.minStock = Number(p.minStock || 0);
    p.barcode ||= '';
  }
  recalculateInventory();
  persistLocal();
}

const persistLocal = () => localStorage.setItem('abarrotes_db', JSON.stringify(db));
const save = () => {
  persistLocal();
  updateCloudUi({ syncing: true });
  queueCloudSave(db, (error, state) => {
    updateCloudUi(state || getCloudStatus());
    if (error) console.warn('Cloud sync error:', error);
  });
};
const showToast = (t) => {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
};
const confirmAction = (message) => window.confirm(message);
const isCreditSale = (s) => s.saleType === 'credit' || s.method === 'credit';
const isOfficialSale = (s) => !isCreditSale(s);
const saleProfit = (s) => s.items.reduce((a, i) => a + (Number(i.price) - Number(i.cost)) * Number(i.qty), 0);

function isStockTracked(product, entries = db.entries) {
  return product.initialStock != null || entries.some((e) => e.productId === product.id);
}

function projectedStocks(entries = db.entries, sales = db.sales) {
  const stocks = {};
  for (const p of db.products) stocks[p.id] = isStockTracked(p, entries) ? Number(p.initialStock ?? 0) : null;
  entries.forEach((e) => { if (stocks[e.productId] != null) stocks[e.productId] += Number(e.qty || 0); });
  sales.forEach((sale) => sale.items.forEach((i) => { if (stocks[i.productId] != null) stocks[i.productId] -= Number(i.qty || 0); }));
  return stocks;
}

function recalculateInventory() {
  const stocks = projectedStocks();
  for (const p of db.products) {
    p.stock = stocks[p.id] == null ? null : round3(stocks[p.id]);
    const entries = db.entries.filter((e) => e.productId === p.id);
    const baseQty = p.initialStock == null ? 0 : Math.max(0, Number(p.initialStock || 0));
    const baseCost = Number(p.initialCost ?? p.cost ?? 0);
    const purchaseQty = entries.reduce((a, e) => a + Number(e.qty || 0), 0);
    const purchaseCost = entries.reduce((a, e) => a + Number(e.qty || 0) * Number(e.cost || 0), 0);
    const denom = baseQty + purchaseQty;
    p.cost = denom > 0 ? ((baseQty * baseCost) + purchaseCost) / denom : baseCost;
  }
}

function stockAfterEntry(entryId) {
  const target = db.entries.find((e) => e.id === entryId);
  if (!target) return null;
  const p = db.products.find((x) => x.id === target.productId);
  if (!p) return target.stockAfter ?? null;
  let stock = Number(p.initialStock ?? 0);
  const events = [
    ...db.entries.filter((e) => e.productId === p.id).map((e) => ({ type: 'entry', date: e.date, id: e.id, qty: Number(e.qty || 0) })),
    ...db.sales.flatMap((sale) => sale.items.filter((i) => i.productId === p.id).map((i) => ({ type: 'sale', date: sale.date, id: sale.id, qty: Number(i.qty || 0) })))
  ].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.type === 'entry' ? -1 : 1));
  for (const event of events) {
    stock += event.type === 'entry' ? event.qty : -event.qty;
    if (event.type === 'entry' && event.id === entryId) return round3(stock);
  }
  return round3(stock);
}

function customerCharges(id, sales = db.sales) {
  return sales.filter((s) => isCreditSale(s) && s.customerId === id).reduce((a, s) => a + Number(s.total || 0), 0);
}
function customerPayments(id, payments = db.payments) {
  return payments.filter((p) => p.customerId === id).reduce((a, p) => a + Number(p.amount || 0), 0);
}
function customerBalance(id) { return Math.max(0, customerCharges(id) - customerPayments(id)); }
function outstandingTotal() { return db.customers.reduce((a, c) => a + customerBalance(c.id), 0); }
function creditIntegrityError(salesCandidate) {
  for (const c of db.customers) {
    const charges = customerCharges(c.id, salesCandidate);
    const paid = customerPayments(c.id);
    if (paid > charges + 0.001) return `No se puede completar: ${c.name} tiene ${money(paid)} en abonos y la deuda resultante sería de ${money(charges)}.`;
  }
  return '';
}
function inventoryIntegrityError() { return ''; }

function setView(v) {
  $$('.view').forEach((x) => x.classList.remove('active'));
  $('#view-' + v).classList.add('active');
  $$('.nav-item').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  const titles = {
    dashboard: ['Resumen', 'Control diario de tu negocio'], products: ['Catálogo de productos', 'Productos, precios y existencias'],
    sales: ['Ventas', 'Historial y registro diario'], entries: ['Entradas de inventario', 'Compras y reposición de mercancía'],
    credit: ['Fiado / Clientes', 'Control de cuentas por cobrar'], cash: ['Caja', 'Fondo, ventas en efectivo y corte']
  };
  $('#pageTitle').textContent = titles[v][0];
  $('#pageSubtitle').textContent = titles[v][1];
  $('#sidebar').classList.remove('open');
  renderAll();
}

$$('.nav-item').forEach((b) => b.onclick = () => setView(b.dataset.view));
$$('[data-go]').forEach((b) => b.onclick = () => setView(b.dataset.go));
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
const open = (id) => $('#' + id).classList.add('open');
const close = (id) => $('#' + id).classList.remove('open');
$$('[data-close]').forEach((b) => b.onclick = () => close(b.dataset.close));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) close(m.id); }));

function renderProducts() {
  const q = $('#productSearch').value.toLowerCase().trim();
  const cat = $('#categoryFilter').value;
  const arr = db.products.filter((p) => (!cat || p.category === cat) && (!q || [p.name, p.category, p.barcode].some((v) => String(v || '').toLowerCase().includes(q))));
  $('#productGrid').innerHTML = arr.length ? arr.map((p) => {
    const tracked = isStockTracked(p);
    const stockClass = !tracked ? 'untracked' : p.stock < 0 ? 'negative' : p.stock <= 0 ? 'out' : p.stock <= p.minStock ? 'low' : 'ok';
    const stockText = !tracked ? 'Stock no registrado' : p.stock < 0 ? `Faltante ${round3(Math.abs(p.stock))}` : `${round3(p.stock)} ${esc(p.unit)}`;
    const badgeText = !tracked ? 'Sin control de stock' : p.stock < 0 ? 'Stock negativo' : p.stock <= 0 ? 'Sin existencia' : p.stock <= p.minStock ? 'Stock bajo' : 'Disponible';
    return `
    <article class="product-card">
      <div class="product-image">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : '<div class="placeholder">🛒</div>'}</div>
      <div class="product-body">
        <div class="product-meta"><span>${esc(p.category)}</span><span>${p.barcode ? esc(p.barcode) : 'Sin código'}</span></div>
        <h4>${esc(p.name)}</h4><div class="price">${money(p.price)}</div>
        <div class="stock-row"><span class="${!tracked ? 'stock-untracked' : p.stock < 0 ? 'stock-negative' : ''}">${stockText}</span><span class="badge ${stockClass}">${badgeText}</span></div>
        <div class="product-actions"><button class="action-btn edit product-edit" data-id="${p.id}">Editar</button><button class="action-btn danger product-delete" data-id="${p.id}">Eliminar</button></div>
      </div>
    </article>`;
  }).join('') : '<div class="empty">No hay productos con estos filtros.</div>';
  $$('.product-edit').forEach((b) => b.onclick = () => openProductEditor(b.dataset.id));
  $$('.product-delete').forEach((b) => b.onclick = () => deleteProduct(b.dataset.id));
}

function renderCategories() {
  const current = $('#categoryFilter').value;
  const cats = [...new Set(db.products.map((p) => p.category))].sort();
  $('#categoryFilter').innerHTML = '<option value="">Todas las categorías</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  if (cats.includes(current)) $('#categoryFilter').value = current;
  $('#categoryList').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
  $('#categoryChips').innerHTML = ['Todos', ...cats].map((c, i) => `<button class="chip ${(!current && i === 0) || current === c ? 'active' : ''}" data-cat="${i === 0 ? '' : esc(c)}">${esc(c)}</button>`).join('');
  $$('.chip').forEach((b) => b.onclick = () => { $$('.chip').forEach((x) => x.classList.remove('active')); b.classList.add('active'); $('#categoryFilter').value = b.dataset.cat; renderProducts(); });
}

function renderDashboard() {
  const ts = db.sales.filter((sale) => dateKey(sale.date) === today());
  const total = ts.reduce((a, sale) => a + sale.total, 0);
  const paid = ts.filter(isOfficialSale).reduce((a, sale) => a + sale.total, 0);
  const credit = ts.filter(isCreditSale).reduce((a, sale) => a + sale.total, 0);
  const profit = ts.reduce((a, sale) => a + saleProfit(sale), 0);
  $('#todaySales').textContent = money(total); $('#todayPaidSales').textContent = money(paid); $('#todayCreditSales').textContent = money(credit);
  $('#todayTickets').textContent = ts.length; $('#todayProfit').textContent = money(profit); $('#receivables').textContent = money(outstandingTotal());
  $('#inventoryValue').textContent = money(db.products.reduce((a, p) => a + Number(p.cost || 0) * Math.max(0, Number(p.stock || 0)), 0));
  const low = db.products.filter((p) => isStockTracked(p) && Number(p.stock) <= Number(p.minStock || 0)); $('#lowStockCount').textContent = low.length;
  $('#recentSales').innerHTML = db.sales.slice(-5).reverse().map((sale) => `<div class="list-row"><div><strong>${esc(sale.id.replace('sale_', '#'))}</strong><small>${new Date(sale.date).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(sale.customerName || 'Venta mostrador')}</small><span class="sale-status ${isCreditSale(sale) ? 'credit' : 'paid'} recent-status">${isCreditSale(sale) ? 'FIADO' : 'OFICIAL / COBRADA'}</span></div><strong>${money(sale.total)}</strong></div>`).join('') || '<div class="empty">Aún no hay ventas.</div>';
  $('#lowStockList').innerHTML = low.slice(0, 6).map((p) => `<div class="list-row"><div><strong>${esc(p.name)}</strong><small>${esc(p.category)}</small></div><span class="badge ${p.stock < 0 ? 'negative' : p.stock <= 0 ? 'out' : 'low'}">${p.stock < 0 ? '−' + round3(Math.abs(p.stock)) : round3(p.stock)} ${esc(p.unit)}</span></div>`).join('') || '<div class="empty">No hay productos con stock bajo registrado.</div>';

  const debtors = db.customers.map((c) => ({ c, balance: customerBalance(c.id), paid: customerPayments(c.id), charged: customerCharges(c.id) })).filter((x) => x.balance > 0.001).sort((a, b) => b.balance - a.balance);
  $('#pendingCreditPanel').classList.toggle('hidden', debtors.length === 0);
  $('#pendingCreditList').innerHTML = debtors.map(({ c, balance, paid }) => `<div class="credit-alert-badge ${paid > 0 ? 'partial' : 'no-payments'}"><span class="fiado-tag">FIADO</span><div><strong>${esc(c.name)}</strong><small>${paid > 0 ? `Abonado ${money(paid)} · saldo pendiente` : 'Sin abonos registrados · pendiente por pagar'}</small></div><span class="credit-amount">${money(balance)}</span></div>`).join('');
}

function filteredSales() {
  return db.sales.filter((sale) => {
    const day = dateKey(sale.date);
    if (salesFilters.from && day < salesFilters.from) return false;
    if (salesFilters.to && day > salesFilters.to) return false;
    if (salesFilters.status === 'official' && !isOfficialSale(sale)) return false;
    if (salesFilters.status === 'credit' && !isCreditSale(sale)) return false;
    return true;
  });
}

function renderDailySalesSummary(sales) {
  const groups = {};
  sales.forEach((sale) => {
    const day = dateKey(sale.date);
    groups[day] ||= { day, total: 0, paid: 0, credit: 0, tickets: 0 };
    groups[day].total += Number(sale.total || 0);
    groups[day].tickets++;
    if (isCreditSale(sale)) groups[day].credit += Number(sale.total || 0); else groups[day].paid += Number(sale.total || 0);
  });
  const rows = Object.values(groups).sort((a, b) => b.day.localeCompare(a.day));
  $('#salesDailySummary').innerHTML = rows.length ? rows.map((r) => `<div class="day-summary-card"><span class="day">${new Date(r.day + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><strong>${money(r.total)}</strong><small>${r.tickets} ticket${r.tickets === 1 ? '' : 's'} · cobrado ${money(r.paid)}<br><span class="credit-part">Fiado ${money(r.credit)}</span></small></div>`).join('') : '<div class="empty">No hay ventas en el periodo seleccionado.</div>';
}

function renderSales() {
  const sales = filteredSales();
  const total = sales.reduce((a, sale) => a + sale.total, 0), credit = sales.filter(isCreditSale).reduce((a, sale) => a + sale.total, 0), paid = sales.filter(isOfficialSale).reduce((a, sale) => a + sale.total, 0);
  $('#salesTotalAll').textContent = money(total); $('#salesPaidAll').textContent = money(paid); $('#salesCreditAll').textContent = money(credit);
  const fromLabel = salesFilters.from ? new Date(salesFilters.from + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Inicio';
  const toLabel = salesFilters.to ? new Date(salesFilters.to + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Hoy';
  $('#salesPeriodLabel').textContent = salesFilters.from === today() && salesFilters.to === today() ? 'Hoy' : `${fromLabel} → ${toLabel}`;
  renderDailySalesSummary(sales);
  $('#salesTable').innerHTML = sales.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((sale) => `<tr class="${isCreditSale(sale) ? 'credit-sale-row' : ''}">
    <td>${esc(sale.id.slice(-8))}</td><td>${new Date(sale.date).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(sale.customerName || 'Mostrador')}</td><td>${sale.items.reduce((a, i) => a + Number(i.qty), 0)} artículos</td>
    <td><span class="sale-status ${isCreditSale(sale) ? 'credit' : 'paid'}">${isCreditSale(sale) ? 'FIADO' : 'OFICIAL / COBRADA'}</span></td><td>${paymentLabel(sale.method)}</td><td><strong>${money(sale.total)}</strong></td><td>${money(saleProfit(sale))}</td>
    <td><div class="row-actions"><button class="action-btn edit sale-edit" data-id="${sale.id}">Editar</button><button class="action-btn danger sale-delete" data-id="${sale.id}">Eliminar</button></div></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No hay ventas registradas en este periodo.</td></tr>';
  $$('.sale-edit').forEach((b) => b.onclick = () => openSaleEditor(b.dataset.id));
  $$('.sale-delete').forEach((b) => b.onclick = () => deleteSale(b.dataset.id));
}

function renderEntries() {
  const total = db.entries.reduce((a, e) => a + e.qty * e.cost, 0), units = db.entries.reduce((a, e) => a + Number(e.qty), 0), margin = db.products.reduce((a, p) => a + (p.price - p.cost) * Math.max(0, p.stock), 0);
  $('#purchaseTotal').textContent = money(total); $('#unitsEntered').textContent = round3(units); $('#potentialMargin').textContent = money(margin);
  $('#entriesTable').innerHTML = db.entries.slice().reverse().map((e) => { const p = db.products.find((p) => p.id === e.productId); return `<tr><td>${new Date(e.date).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(p?.name || e.productName || 'Producto eliminado')}</td><td>${round3(e.qty)}</td><td>${money(e.cost)}</td><td><strong>${money(e.qty * e.cost)}</strong></td><td>${stockAfterEntry(e.id) == null ? '—' : round3(stockAfterEntry(e.id))}</td><td><div class="row-actions"><button class="action-btn edit entry-edit" data-id="${e.id}">Editar</button><button class="action-btn danger entry-delete" data-id="${e.id}">Eliminar</button></div></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No hay entradas registradas.</td></tr>';
  $$('.entry-edit').forEach((b) => b.onclick = () => openEntryEditor(b.dataset.id));
  $$('.entry-delete').forEach((b) => b.onclick = () => deleteEntry(b.dataset.id));
}

function renderCredit() {
  const active = db.customers.filter((c) => customerBalance(c.id) > 0);
  $('#creditOutstanding').textContent = money(outstandingTotal()); $('#debtorsCount').textContent = active.length; $('#paymentsReceived').textContent = money(db.payments.reduce((a, p) => a + p.amount, 0));
  $('#customerAccounts').innerHTML = db.customers.length ? db.customers.map((c) => {
    const balance = customerBalance(c.id);
    return `<div class="customer-card"><div class="customer-head"><div><h4>${esc(c.name)}</h4><p>${esc(c.phone || 'Sin teléfono')}</p></div><div class="customer-balance"><span>${balance > 0 ? 'Saldo' : 'Sin adeudo'}</span><strong>${money(balance)}</strong></div></div><div class="customer-actions">${balance > 0 ? `<button class="btn secondary pay-btn" data-id="${c.id}">Registrar abono</button>` : ''}<button class="action-btn edit customer-edit" data-id="${c.id}">Editar</button><button class="action-btn danger customer-delete" data-id="${c.id}">Eliminar</button></div></div>`;
  }).join('') : '<div class="empty">Aún no hay clientes registrados.</div>';
  $$('.pay-btn').forEach((b) => b.onclick = () => openPayment(b.dataset.id));
  $$('.customer-edit').forEach((b) => b.onclick = () => openCustomerEditor(b.dataset.id));
  $$('.customer-delete').forEach((b) => b.onclick = () => deleteCustomer(b.dataset.id));
  const moves = [
    ...db.sales.filter(isCreditSale).map((s) => ({ id: s.id, date: s.date, text: `Venta a ${s.customerName || 'cliente'}`, amount: s.total, type: 'cargo' })),
    ...db.payments.map((p) => ({ id: p.id, customerId: p.customerId, date: p.date, text: `Abono de ${db.customers.find((c) => c.id === p.customerId)?.name || 'cliente'}`, amount: p.amount, type: 'abono' }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  $('#creditMovements').innerHTML = moves.slice(0, 20).map((m) => `<div class="list-row movement-row"><div><strong>${esc(m.text)}</strong><small>${new Date(m.date).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</small></div><div class="movement-side"><strong>${m.type === 'cargo' ? '+' : '−'} ${money(m.amount)}</strong><div class="row-actions">${m.type === 'cargo' ? `<button class="action-btn edit movement-sale-edit" data-id="${m.id}">Editar venta</button>` : `<button class="action-btn edit payment-edit" data-id="${m.id}" data-customer="${m.customerId}">Editar</button><button class="action-btn danger payment-delete" data-id="${m.id}">Eliminar</button>`}</div></div></div>`).join('') || '<div class="empty">No hay movimientos de crédito.</div>';
  $$('.movement-sale-edit').forEach((b) => b.onclick = () => openSaleEditor(b.dataset.id));
  $$('.payment-edit').forEach((b) => b.onclick = () => openPayment(b.dataset.customer, b.dataset.id));
  $$('.payment-delete').forEach((b) => b.onclick = () => deletePayment(b.dataset.id));
}

function renderCash() {
  const daySales = db.sales.filter((s) => dateKey(s.date) === today()), opening = db.cashOpenings[today()] || 0;
  const cashSales = daySales.filter((s) => isOfficialSale(s) && s.method === 'cash').reduce((a, s) => a + s.total, 0);
  const nonCashSales = daySales.filter((s) => isOfficialSale(s) && (s.method === 'card' || s.method === 'transfer')).reduce((a, s) => a + s.total, 0);
  const creditSales = daySales.filter(isCreditSale).reduce((a, s) => a + s.total, 0);
  const cashPayments = db.payments.filter((p) => dateKey(p.date) === today() && p.method === 'cash').reduce((a, p) => a + p.amount, 0);
  const expected = opening + cashSales + cashPayments;
  $('#openingCash').textContent = money(opening); $('#cashSalesToday').textContent = money(cashSales); $('#cashPaymentsToday').textContent = money(cashPayments); $('#cashExpected').textContent = money(expected);
  $('#formulaOpening').textContent = money(opening); $('#formulaCashSales').textContent = money(cashSales); $('#formulaCashPayments').textContent = money(cashPayments); $('#formulaExpected').textContent = money(expected);
  $('#nonCashSalesToday').textContent = money(nonCashSales); $('#creditSalesTodayCash').textContent = money(creditSales); $('#cashDifference').textContent = '—';
}

function currentEditSale() { return db.sales.find((s) => s.id === $('#saleEditId').value); }
function originalQtyInEditedSale(productId) { const s = currentEditSale(); return s ? s.items.filter((i) => i.productId === productId).reduce((a, i) => a + Number(i.qty), 0) : 0; }
function availableForSale(productId) { const p = db.products.find((x) => x.id === productId); if (!p || !isStockTracked(p)) return null; return Number(p.stock || 0) + originalQtyInEditedSale(productId); }

function renderSaleProducts() {
  const q = $('#saleProductSearch').value.toLowerCase().trim();
  $('#saleProducts').innerHTML = db.products.filter((p) => !q || [p.name, p.barcode].some((v) => String(v || '').toLowerCase().includes(q))).map((p) => {
    const available = availableForSale(p.id);
    const note = available == null ? 'Stock no registrado · venta permitida' : available < 0 ? `Stock ${round3(available)} · faltante detectado` : `Stock disponible ${round3(available)} ${esc(p.unit)}`;
    const cls = available == null ? '' : available <= 0 ? 'stock-negative' : available <= p.minStock ? 'stock-warning' : '';
    const noteCls = available == null ? 'untracked' : available <= 0 ? 'negative' : 'ok';
    return `<div class="sale-product ${cls}" data-id="${p.id}"><strong>${esc(p.name)}</strong><div class="product-meta"><span>${p.barcode ? esc(p.barcode) : 'Sin código'}</span><span>${money(p.price)}</span></div><div class="stock-note ${noteCls}">${note}</div></div>`;
  }).join('');
  $$('.sale-product').forEach((x) => x.onclick = () => addCart(x.dataset.id));
}

function renderCart() {
  $('#cartItems').innerHTML = cart.length ? cart.map((i) => `<div class="cart-row"><div><strong>${esc(i.name)}</strong><small>${money(i.price)} × ${round3(i.qty)}</small></div><div class="cart-controls"><button class="mini-btn" data-act="minus" data-id="${i.id}">−</button><strong>${round3(i.qty)}</strong><button class="mini-btn" data-act="plus" data-id="${i.id}">+</button></div></div>`).join('') : '<div class="empty">Agrega productos al ticket.</div>';
  $('#cartTotal').textContent = money(cart.reduce((a, i) => a + i.price * i.qty, 0));
  $$('.mini-btn').forEach((b) => b.onclick = () => {
    const i = cart.find((x) => x.id === b.dataset.id);
    if (!i) return;
    if (b.dataset.act === 'plus') {
      const available = availableForSale(i.id);
      i.qty++;
      if (available != null && i.qty > available) showToast('Aviso: la venta supera el stock registrado; el inventario quedará en negativo.');
    }
    if (b.dataset.act === 'minus') { i.qty--; if (i.qty <= 0) cart = cart.filter((x) => x.id !== i.id); }
    renderCart();
  });
}
function addCart(id) {
  const p = db.products.find((x) => x.id === id); if (!p) return;
  const i = cart.find((x) => x.id === id), available = availableForSale(id);
  if (i) { i.qty++; if (available != null && i.qty > available) showToast('Aviso: la venta supera el stock registrado; el inventario quedará en negativo.'); }
  else { cart.push({ id: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost }); if (available != null && available < 1) showToast('Aviso: este producto no tiene existencia registrada suficiente.'); }
  renderCart();
}

function renderAll() { recalculateInventory(); renderDashboard(); renderProducts(); renderSales(); renderEntries(); renderCredit(); renderCash(); }

// PRODUCT CRUD
function resetProductForm() {
  $('#productForm').reset(); $('#productEditId').value = ''; productImageData = ''; $('#imageHint').textContent = 'Seleccionar imagen';
  $('#productModalTitle').textContent = 'Nuevo producto'; $('#productModalSubtitle').textContent = 'Código de barras y stock son opcionales'; $('#productSubmitBtn').textContent = 'Guardar producto'; $('#pMinStock').value = ''; 
}
function openProductEditor(id = '') {
  resetProductForm();
  if (id) {
    const p = db.products.find((x) => x.id === id); if (!p) return;
    $('#productEditId').value = id; $('#pName').value = p.name; $('#pCategory').value = p.category; $('#pBarcode').value = p.barcode || ''; $('#pUnit').value = p.unit; $('#pPrice').value = p.price; $('#pCost').value = p.cost; $('#pStock').value = p.initialStock == null ? '' : p.initialStock; $('#pMinStock').value = p.minStock || ''; productImageData = p.image || '';
    $('#imageHint').textContent = p.image ? 'Imagen actual conservada' : 'Seleccionar imagen'; $('#productModalTitle').textContent = 'Editar producto'; $('#productModalSubtitle').textContent = 'Actualiza datos, precio, costo o stock'; $('#productSubmitBtn').textContent = 'Guardar cambios';
  }
  open('productModal');
}
function deleteProduct(id) {
  const p = db.products.find((x) => x.id === id); if (!p) return;
  const refs = db.sales.some((s) => s.items.some((i) => i.productId === id)) || db.entries.some((e) => e.productId === id);
  const msg = refs ? `¿Eliminar ${p.name}? Tiene movimientos históricos. Las ventas/entradas anteriores se conservarán como historial, pero el producto desaparecerá del catálogo.` : `¿Eliminar ${p.name} del catálogo?`;
  if (!confirmAction(msg)) return;
  db.products = db.products.filter((x) => x.id !== id); save(); renderCategories(); renderAll(); showToast('Producto eliminado');
}

$('#productImage').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { productImageData = r.result; $('#imageHint').textContent = 'Imagen lista ✓'; }; r.readAsDataURL(f); };
$('#productForm').onsubmit = (e) => {
  e.preventDefault();
  const id = $('#productEditId').value;
  const barcode = $('#pBarcode').value.trim();
  if (barcode && db.products.some((p) => p.barcode === barcode && p.id !== id)) return showToast('Ese código de barras ya está registrado');
  const stockRaw = $('#pStock').value.trim();
  const baseStock = stockRaw === '' ? null : Number(stockRaw);
  const minStock = $('#pMinStock').value.trim() === '' ? 0 : Number($('#pMinStock').value);
  const cost = Number($('#pCost').value);
  if (id) {
    const p = db.products.find((x) => x.id === id); if (!p) return;
    p.initialStock = baseStock; p.initialCost = cost;
    Object.assign(p, { name: $('#pName').value.trim(), category: $('#pCategory').value.trim(), barcode, unit: $('#pUnit').value, price: Number($('#pPrice').value), minStock, image: productImageData || p.image || '' });
  } else {
    db.products.push({ id: uid('p'), name: $('#pName').value.trim(), category: $('#pCategory').value.trim(), barcode, unit: $('#pUnit').value, price: Number($('#pPrice').value), cost, initialCost: cost, stock: baseStock, initialStock: baseStock, minStock, image: productImageData });
  }
  recalculateInventory(); save(); close('productModal'); resetProductForm(); renderCategories(); renderAll();
  const saved = db.products.find((p) => p.id === id) || db.products.at(-1);
  showToast(saved && isStockTracked(saved) ? `Producto guardado · existencia calculada ${round3(saved.stock)} ${saved.unit}` : 'Producto guardado sin stock inicial');
};

// SALE CRUD
function updateSaleAccountingNotice() {
  const method = $('#paymentMethod').value, credit = method === 'credit', notice = $('#saleAccountingNotice');
  $('#customerFields').classList.toggle('hidden', !credit); notice.className = 'sale-accounting-notice ' + (credit ? 'credit' : 'paid');
  notice.innerHTML = credit ? '<strong>Venta a crédito / fiado</strong><span>Descontará inventario y aumentará cuentas por cobrar, pero NO aumentará caja hasta registrar un abono.</span>' : '<strong>Venta oficial / cobrada</strong><span>Quedará como cobrada. Solo las ventas en efectivo aumentan el dinero físico esperado en caja.</span>';
}
function openSaleEditor(id = '') {
  cart = []; $('#saleEditId').value = id; $('#saleProductSearch').value = ''; $('#creditCustomer').value = ''; $('#creditPhone').value = '';
  if (id) {
    const s = db.sales.find((x) => x.id === id); if (!s) return;
    cart = s.items.map((i) => ({ id: i.productId, name: i.name, qty: Number(i.qty), price: Number(i.price), cost: Number(i.cost) }));
    $('#paymentMethod').value = s.method; $('#saleDate').value = toLocalInput(s.date); $('#creditCustomer').value = s.customerName || ''; $('#creditPhone').value = db.customers.find((c) => c.id === s.customerId)?.phone || '';
    $('#saleModalTitle').textContent = 'Editar venta'; $('#saleModalSubtitle').textContent = `Modifica el ticket ${s.id.slice(-8)} sin perder consistencia de inventario`; $('#completeSaleBtn').textContent = 'Guardar cambios';
  } else {
    $('#paymentMethod').value = 'cash'; $('#saleDate').value = toLocalInput(); $('#saleModalTitle').textContent = 'Registrar venta'; $('#saleModalSubtitle').textContent = 'Agrega productos al ticket y selecciona cómo se pagará'; $('#completeSaleBtn').textContent = 'Finalizar venta';
  }
  updateSaleAccountingNotice(); renderSaleProducts(); renderCart(); open('saleModal');
}
function deleteSale(id) {
  const s = db.sales.find((x) => x.id === id); if (!s) return;
  if (!confirmAction(`¿Eliminar la venta ${s.id.slice(-8)} por ${money(s.total)}? El inventario se devolverá automáticamente.`)) return;
  const candidate = db.sales.filter((x) => x.id !== id);
  const creditError = creditIntegrityError(candidate); if (creditError) return showToast(creditError);
  db.sales = candidate; recalculateInventory(); save(); renderAll(); showToast('Venta eliminada e inventario restaurado');
}
$('#paymentMethod').onchange = updateSaleAccountingNotice;
$('#completeSaleBtn').onclick = () => {
  if (!cart.length) return showToast('Agrega al menos un producto');
  const editId = $('#saleEditId').value, original = db.sales.find((s) => s.id === editId), method = $('#paymentMethod').value;
  for (const i of cart) if (i.qty > availableForSale(i.id) + 0.001) return showToast(`Stock insuficiente de ${i.name}`);
  let customerId = null, customerName = '';
  if (method === 'credit') {
    customerName = $('#creditCustomer').value.trim(); if (!customerName) return showToast('Escribe el nombre del cliente');
    let c = db.customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase());
    if (!c) c = { id: uid('cust'), name: customerName, phone: $('#creditPhone').value.trim(), _new: true };
    customerId = c.id; customerName = c.name;
    var pendingCustomer = c;
  }
  const items = cart.map((i) => { const p = db.products.find((x) => x.id === i.id); return { productId: i.id, name: p?.name || i.name, qty: Number(i.qty), price: Number(i.price), cost: Number(i.cost) }; });
  const total = items.reduce((a, i) => a + i.price * i.qty, 0);
  const sale = { id: editId || uid('sale'), date: fromLocalInput($('#saleDate').value), items, total, method, saleType: method === 'credit' ? 'credit' : 'official', customerId, customerName };
  const candidate = editId ? db.sales.map((s) => s.id === editId ? sale : s) : [...db.sales, sale];
  const creditError = creditIntegrityError(candidate); if (creditError) return showToast(creditError);
  if (typeof pendingCustomer !== 'undefined') {
    const existing = db.customers.find((c) => c.id === pendingCustomer.id);
    if (!existing) db.customers.push({ id: pendingCustomer.id, name: pendingCustomer.name, phone: pendingCustomer.phone || '' });
    else if ($('#creditPhone').value.trim() && !existing.phone) existing.phone = $('#creditPhone').value.trim();
  }
  db.sales = candidate; recalculateInventory(); save(); close('saleModal'); cart = []; $('#saleEditId').value = ''; renderAll(); showToast(editId ? 'Venta actualizada y saldos recalculados' : method === 'credit' ? 'Venta fiada registrada · no se sumó a caja' : 'Venta oficial registrada correctamente');
};

// ENTRY CRUD
function populateEntryProducts(selected = '') {
  $('#entryProduct').innerHTML = '<option value="">Selecciona…</option>' + db.products.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${isStockTracked(p) ? 'stock ' + round3(p.stock) : 'stock no registrado'}</option>`).join('');
}
function openEntryEditor(id = '') {
  $('#entryForm').reset(); $('#entryEditId').value = id; $('#entryDate').value = toLocalInput(); populateEntryProducts();
  $('#entryModalTitle').textContent = 'Nueva entrada'; $('#entryModalSubtitle').textContent = 'Repón inventario y registra tu costo real'; $('#entrySubmitBtn').textContent = 'Registrar entrada'; $('#entryInfo').textContent = 'Selecciona un producto.';
  if (id) {
    const e = db.entries.find((x) => x.id === id); if (!e) return;
    const p = db.products.find((x) => x.id === e.productId); if (!p) return showToast('El producto de esta entrada fue eliminado. Puedes eliminar el movimiento, pero no editarlo.');
    populateEntryProducts(e.productId); $('#entryDate').value = toLocalInput(e.date); $('#entryQty').value = e.qty; $('#entryCost').value = e.cost; $('#entryInfo').textContent = `${isStockTracked(p) ? 'Stock actual: ' + round3(p.stock) + ' ' + p.unit : 'Stock aún no registrado'} · Costo promedio: ${money(p.cost)}`;
    $('#entryModalTitle').textContent = 'Editar entrada'; $('#entryModalSubtitle').textContent = 'Cambiar una entrada recalculará existencias automáticamente'; $('#entrySubmitBtn').textContent = 'Guardar cambios';
  }
  open('entryModal');
}
function deleteEntry(id) {
  const e = db.entries.find((x) => x.id === id); if (!e) return;
  if (!confirmAction(`¿Eliminar esta entrada de ${round3(e.qty)} unidades por ${money(e.qty * e.cost)}?`)) return;
  const candidate = db.entries.filter((x) => x.id !== id);
  db.entries = candidate; recalculateInventory(); save(); renderAll(); showToast('Entrada eliminada y stock recalculado');
}
$('#entryProduct').onchange = () => { const p = db.products.find((p) => p.id === $('#entryProduct').value); if (p) { $('#entryCost').value = Number(p.cost).toFixed(2); $('#entryInfo').textContent = `${isStockTracked(p) ? 'Stock actual: ' + round3(p.stock) + ' ' + p.unit : 'Stock aún no registrado'} · Costo promedio: ${money(p.cost)}`; } };
$('#entryForm').onsubmit = (e) => {
  e.preventDefault(); const id = $('#entryEditId').value, p = db.products.find((p) => p.id === $('#entryProduct').value), qty = Number($('#entryQty').value), cost = Number($('#entryCost').value); if (!p) return;
  const entry = { id: id || uid('entry'), date: fromLocalInput($('#entryDate').value), productId: p.id, productName: p.name, qty, cost };
  const candidate = id ? db.entries.map((x) => x.id === id ? entry : x) : [...db.entries, entry];
  db.entries = candidate; recalculateInventory(); save(); close('entryModal'); renderAll(); showToast(id ? 'Entrada actualizada y stock recalculado' : 'Entrada registrada');
};

// CUSTOMER CRUD
function openCustomerEditor(id = '') {
  $('#customerForm').reset(); $('#customerEditId').value = id; $('#customerModalTitle').textContent = id ? 'Editar cliente' : 'Nuevo cliente'; $('#customerSubmitBtn').textContent = id ? 'Guardar cambios' : 'Guardar cliente';
  if (id) { const c = db.customers.find((x) => x.id === id); if (!c) return; $('#customerName').value = c.name; $('#customerPhone').value = c.phone || ''; }
  open('customerModal');
}
function deleteCustomer(id) {
  const c = db.customers.find((x) => x.id === id); if (!c) return;
  if (db.sales.some((s) => s.customerId === id) || db.payments.some((p) => p.customerId === id)) return showToast('No se puede eliminar: el cliente tiene movimientos históricos. Puedes editar sus datos.');
  if (!confirmAction(`¿Eliminar a ${c.name}?`)) return; db.customers = db.customers.filter((x) => x.id !== id); save(); renderCredit(); showToast('Cliente eliminado');
}
$('#customerForm').onsubmit = (e) => {
  e.preventDefault(); const id = $('#customerEditId').value, name = $('#customerName').value.trim(), phone = $('#customerPhone').value.trim();
  if (db.customers.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== id)) return showToast('Ya existe un cliente con ese nombre');
  if (id) { const c = db.customers.find((x) => x.id === id); c.name = name; c.phone = phone; db.sales.filter((s) => s.customerId === id).forEach((s) => s.customerName = name); }
  else db.customers.push({ id: uid('cust'), name, phone });
  save(); close('customerModal'); renderAll(); showToast(id ? 'Cliente actualizado' : 'Cliente guardado');
};

// PAYMENT CRUD
function openPayment(customerId, paymentId = '') {
  const c = db.customers.find((c) => c.id === customerId); if (!c) return;
  const payment = db.payments.find((p) => p.id === paymentId); const otherPaid = db.payments.filter((p) => p.customerId === customerId && p.id !== paymentId).reduce((a, p) => a + p.amount, 0); const max = Math.max(0, customerCharges(customerId) - otherPaid);
  $('#paymentForm').reset(); $('#paymentCustomerId').value = customerId; $('#paymentEditId').value = paymentId; $('#paymentCustomerName').textContent = `${c.name} · Máximo disponible ${money(max)}`; $('#paymentAmount').max = max;
  $('#paymentModalTitle').textContent = paymentId ? 'Editar abono' : 'Registrar abono'; $('#paymentSubmitBtn').textContent = paymentId ? 'Guardar cambios' : 'Registrar abono';
  if (payment) { $('#paymentAmount').value = payment.amount; $('#paymentPayMethod').value = payment.method; }
  open('paymentModal');
}
function deletePayment(id) {
  const p = db.payments.find((x) => x.id === id); if (!p) return;
  if (!confirmAction(`¿Eliminar el abono de ${money(p.amount)}? El saldo pendiente aumentará nuevamente.`)) return;
  db.payments = db.payments.filter((x) => x.id !== id); save(); renderAll(); showToast('Abono eliminado');
}
$('#paymentForm').onsubmit = (e) => {
  e.preventDefault(); const customerId = $('#paymentCustomerId').value, id = $('#paymentEditId').value, amount = Number($('#paymentAmount').value); const otherPaid = db.payments.filter((p) => p.customerId === customerId && p.id !== id).reduce((a, p) => a + p.amount, 0); const max = customerCharges(customerId) - otherPaid;
  if (amount > max + 0.001) return showToast('El abono supera el saldo disponible');
  const payment = { id: id || uid('pay'), customerId, date: id ? db.payments.find((p) => p.id === id)?.date || now() : now(), amount, method: $('#paymentPayMethod').value };
  db.payments = id ? db.payments.map((p) => p.id === id ? payment : p) : [...db.payments, payment]; save(); close('paymentModal'); renderAll(); showToast(id ? 'Abono actualizado' : 'Abono registrado');
};

// CASH CRUD-LIKE CONFIGURATION
$('#cashForm').onsubmit = (e) => { e.preventDefault(); db.cashOpenings[today()] = Number($('#cashOpeningInput').value); save(); close('cashModal'); renderCash(); showToast('Fondo inicial guardado'); };
$('#clearCashBtn').onclick = () => { if (!db.cashOpenings[today()]) return showToast('No hay fondo inicial configurado'); if (!confirmAction('¿Eliminar el fondo inicial de hoy?')) return; delete db.cashOpenings[today()]; save(); renderCash(); showToast('Fondo inicial eliminado'); };
$('#calculateCashBtn').onclick = () => { const counted = Number($('#countedCash').value), opening = Number(db.cashOpenings[today()] || 0), cashSales = db.sales.filter((s) => dateKey(s.date) === today() && isOfficialSale(s) && s.method === 'cash').reduce((a, s) => a + s.total, 0), cashPayments = db.payments.filter((p) => dateKey(p.date) === today() && p.method === 'cash').reduce((a, p) => a + p.amount, 0), expected = opening + cashSales + cashPayments, diff = counted - expected; $('#cashDifference').textContent = money(diff); $('#cashCutResult').textContent = diff === 0 ? 'Caja cuadrada exactamente.' : diff > 0 ? `Sobrante de ${money(diff)}.` : `Faltante de ${money(Math.abs(diff))}.`; };


// HISTORICAL SALES FILTERS
function syncSalesFilterInputs() {
  $('#salesDateFrom').value = salesFilters.from || '';
  $('#salesDateTo').value = salesFilters.to || '';
  $('#salesStatusFilter').value = salesFilters.status || '';
}
$('#salesDateFrom').onchange = () => { salesFilters.from = $('#salesDateFrom').value; renderSales(); };
$('#salesDateTo').onchange = () => { salesFilters.to = $('#salesDateTo').value; renderSales(); };
$('#salesStatusFilter').onchange = () => { salesFilters.status = $('#salesStatusFilter').value; renderSales(); };
$('#salesTodayBtn').onclick = () => { salesFilters = { from: today(), to: today(), status: $('#salesStatusFilter').value || '' }; syncSalesFilterInputs(); renderSales(); };
$('#salesAllBtn').onclick = () => { salesFilters = { from: '', to: '', status: $('#salesStatusFilter').value || '' }; syncSalesFilterInputs(); renderSales(); };

// SUPABASE / CLOUD DATABASE
function updateCloudUi(state = getCloudStatus()) {
  if (!$('#dbStatusBtn')) return;
  const btn = $('#dbStatusBtn'), text = $('#dbStatusText'), box = $('#cloudStatusBox');
  btn.className = 'db-status ' + (state.syncing ? 'syncing' : state.mode === 'cloud' ? 'cloud' : state.mode === 'ready' || state.mode === 'configured' ? 'ready' : state.mode === 'error' ? 'error' : 'local');
  if (state.syncing) text.textContent = 'Sincronizando…';
  else if (state.mode === 'cloud') text.textContent = 'Nube activa';
  else if (state.mode === 'ready' || state.mode === 'configured') text.textContent = 'Supabase listo';
  else if (state.mode === 'error') text.textContent = 'Error de nube';
  else text.textContent = 'Modo local';
  if (!box) return;
  if (!isCloudConfigured()) {
    box.className = 'cloud-status-box warn';
    box.innerHTML = '<strong>Supabase aún no está configurado</strong>Edita <code>config.js</code> con SUPABASE_URL y SUPABASE_ANON_KEY. Mientras tanto todo continúa funcionando en este navegador.';
    $('#cloudLoginForm').classList.add('hidden');
  } else if (state.mode === 'cloud' && state.user) {
    box.className = 'cloud-status-box ok';
    box.innerHTML = `<strong>Nube conectada</strong>${esc(state.user.email || 'Usuario autenticado')} · histórico protegido por tu sesión${state.lastSync ? ' · última sincronización ' + new Date(state.lastSync).toLocaleString('es-MX') : ''}`;
    $('#cloudLoginForm').classList.remove('hidden');
    $('#cloudLogoutBtn').classList.remove('hidden');
    $('#cloudSignupBtn').classList.add('hidden');
    $('#cloudLoginBtn').classList.add('hidden');
  } else if (state.mode === 'error') {
    box.className = 'cloud-status-box error';
    box.innerHTML = `<strong>Error de conexión</strong>${esc(state.error || 'No fue posible sincronizar')}`;
    $('#cloudLoginForm').classList.remove('hidden');
  } else {
    box.className = 'cloud-status-box';
    box.className = 'cloud-status-box ready';
    box.innerHTML = '<strong>Supabase conectado</strong>La base de datos responde correctamente. Crea una cuenta o inicia sesión para activar la sincronización protegida entre dispositivos.';
    $('#cloudLoginForm').classList.remove('hidden');
    $('#cloudLogoutBtn').classList.add('hidden');
    $('#cloudSignupBtn').classList.remove('hidden');
    $('#cloudLoginBtn').classList.remove('hidden');
  }
}

async function applyRemoteState(remote) {
  if (!remote || typeof remote !== 'object') return false;
  db = remote; migrateDb(); renderCategories(); renderAll(); return true;
}

async function bootstrapCloud() {
  updateCloudUi({ mode: isCloudConfigured() ? 'ready' : 'local' });
  const state = await initCloud();
  if (state.data) await applyRemoteState(state.data);
  else if (state.mode === 'cloud') await pushCloudState(db);
  updateCloudUi(state); cloudBootstrapped = true;
}

$('#dbStatusBtn').onclick = () => { updateCloudUi(); open('dbModal'); };
$('#cloudLoginForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('#cloudEmail').value.trim(), password = $('#cloudPassword').value;
  if (!email || !password) return showToast('Ingresa correo y contraseña');
  try {
    updateCloudUi({ ...getCloudStatus(), syncing: true });
    const result = await signInCloud(email, password);
    if (result.data) await applyRemoteState(result.data); else await pushCloudState(db);
    updateCloudUi(getCloudStatus()); close('dbModal'); showToast('Base de datos conectada y sincronizada');
  } catch (error) { updateCloudUi({ mode: 'error', error: error.message }); showToast(error.message); }
};
$('#cloudSignupBtn').onclick = async () => {
  const email = $('#cloudEmail').value.trim(), password = $('#cloudPassword').value;
  if (!email || !password) return showToast('Ingresa correo y contraseña');
  try {
    const result = await signUpCloud(email, password);
    if (result.session) { await pushCloudState(db); updateCloudUi(getCloudStatus()); close('dbModal'); showToast('Cuenta creada y nube conectada'); }
    else showToast('Cuenta creada. Revisa tu correo para confirmar y después inicia sesión.');
  } catch (error) { updateCloudUi({ mode: 'error', error: error.message }); showToast(error.message); }
};
$('#cloudLogoutBtn').onclick = async () => { await signOutCloud(); updateCloudUi(getCloudStatus()); showToast('Sesión de nube cerrada · los datos locales permanecen'); };

// UI triggers
$('#productSearch').oninput = renderProducts; $('#categoryFilter').onchange = renderProducts; $('#saleProductSearch').oninput = renderSaleProducts;
$('#addProductBtn').onclick = () => openProductEditor(); $('#quickSaleBtn').onclick = $('#newSaleBtn').onclick = () => openSaleEditor(); $('#newEntryBtn').onclick = () => openEntryEditor(); $('#newCustomerBtn').onclick = () => openCustomerEditor();
$('#setCashBtn').onclick = () => { $('#cashOpeningInput').value = db.cashOpenings[today()] ?? ''; open('cashModal'); };
$('#exportBtn').onclick = () => { const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `respaldo-tienda-${today()}.json`; a.click(); URL.revokeObjectURL(a.href); };

$('#sidebarDate').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
syncSalesFilterInputs(); migrateDb(); renderCategories(); renderAll(); updateCloudUi(); bootstrapCloud();
