// ==========================================
// FIREBASE CONFIG
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyDGJWdgj2GBL-44gXZ9W0mWnOfsczwPXdw",
    authDomain: "mobile-shop-9ea44.firebaseapp.com",
    databaseURL: "https://mobile-shop-9ea44-default-rtdb.firebaseio.com",
    projectId: "mobile-shop-9ea44",
    storageBucket: "mobile-shop-9ea44.firebasestorage.app",
    messagingSenderId: "902893829958",
    appId: "1:902893829958:web:f2f429ad9290c56f4d6f47",
    measurementId: "G-V4JQT7Z8T9"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================
// STATE
// ==========================================
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const pageSize = 15;
let currentOrderFilter = 'all';
let currentPageView = 'dashboard';
let detailOrderId = null;
let isRefreshing = false;
let isEditMode = false;
let editData = {};

let inventoryList = [];
let salesList = [];
let filteredInventory = [];
let filteredSales = [];
let sellOrderData = null;

let agentsList = [];
let passwordVisible = {};

// ==========================================
// DOM REFS
// ==========================================
const toastEl = document.getElementById('toast');

// ==========================================
// TOAST
// ==========================================
function showToast(msg, type = 'info', duration = 3000) {
    toastEl.textContent = msg;
    toastEl.className = 'toast-fixed ' + type;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ==========================================
// SIDEBAR
// ==========================================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

// ==========================================
// NAVIGATION
// ==========================================
function navigate(page) {
    currentPageView = page;
    document.querySelectorAll('.sidebar-link').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });
    document.querySelectorAll('.page-content').forEach(el => {
        el.style.display = 'none';
    });
    const target = document.getElementById('page-' + page);
    if (target) {
        target.style.display = 'block';
        target.classList.remove('fade-in');
        void target.offsetWidth;
        target.classList.add('fade-in');
    }
    closeSidebar();

    if (page === 'dashboard') loadDashboard();
    else if (page === 'orders') { loadOrders(); loadAgentsForFilter(); }
    else if (page === 'pending') loadPendingAdmin();
    else if (page === 'rejected') loadRejectedAdmin();
    else if (page === 'inventory') loadInventory();
    else if (page === 'sales') loadSales();
    else if (page === 'agents') loadAgents();
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
    try {
        const [pickupSnap, pendingSnap] = await Promise.all([
            db.ref('pickups').once('value'),
            db.ref('pending').once('value')
        ]);

        const pickups = pickupSnap.val() || {};
        const pending = pendingSnap.val() || {};

        let total = 0, pickupCount = 0, rejectedCount = 0, rescheduleCount = 0;
        let soldCount = 0, unsoldCount = 0, revenue = 0, profit = 0;
        let totalStockValue = 0;

        Object.values(pickups).forEach(item => {
            total++;
            if (item.status === 'pickup') {
                pickupCount++;
                if (item.sold) {
                    soldCount++;
                    revenue += item.salePrice || 0;
                    const itemProfit = item.profit !== undefined
                        ? item.profit
                        : ((item.salePrice || 0) - (item.value || 0));
                    profit += itemProfit;
                } else {
                    unsoldCount++;
                    totalStockValue += (item.value || 0);
                }
            } else if (item.status === 'rejected') rejectedCount++;
            else if (item.status === 'reschedule') rescheduleCount++;
        });

        const pendingCount = Object.keys(pending).length;

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statPickup').textContent = pickupCount;
        document.getElementById('statRejected').textContent = rejectedCount;
        document.getElementById('statPending').textContent = pendingCount;
        document.getElementById('statInventory').textContent = unsoldCount;
        document.getElementById('statSold').textContent = soldCount;
        document.getElementById('statRevenue').textContent = '₹' + revenue;
        document.getElementById('statProfit').textContent = '₹' + profit;
        document.getElementById('statStockValue').textContent = '₹' + totalStockValue;

        document.getElementById('orderCountBadge').textContent = total;
        document.getElementById('pendingBadge').textContent = pendingCount;
        document.getElementById('rejectedBadge').textContent = rejectedCount;
        document.getElementById('inventoryBadge').textContent = unsoldCount;
        document.getElementById('salesBadge').textContent = soldCount;

        const recent = Object.entries(pickups)
            .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
            .slice(0, 10);

        const container = document.getElementById('recentList');
        if (recent.length === 0) {
            container.innerHTML =
                `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity yet</p></div>`;
        } else {
            let html = '';
            recent.forEach(([id, item]) => {
                const statusLabel = item.status || 'unknown';
                let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') :
                    statusLabel === 'rejected' ? 'rejected' : 'reschedule';
                let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') :
                    statusLabel === 'rejected' ? 'Rejected' : 'Pending';
                const time = item.timestampIST || item.timestamp || '';
                const model = item.phoneModel || '—';
                const agentName = item.agent || '—';
                html += `
                    <div class="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition cursor-pointer" onclick="viewOrder('${id}')">
                        <div class="flex items-center gap-3 min-w-0">
                            <span class="badge-status ${statusClass}">${displayName}</span>
                            <span class="font-mono font-bold text-gray-700 text-sm truncate">${id}</span>
                            <span class="text-xs text-gray-400 hidden sm:inline">${model}</span>
                            <span class="text-xs text-gray-400 hidden md:inline">(${agentName})</span>
                        </div>
                        <span class="text-[10px] text-gray-400 flex-shrink-0">${time}</span>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
        lucide.createIcons();

    } catch (e) {
        console.error('Dashboard error:', e);
        showToast('Error loading dashboard', 'error');
    }
}

// ==========================================
// ORDERS
// ==========================================
async function loadOrders() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        allOrders = Object.entries(data).map(([id, item]) => ({
            id,
            ...item
        }));
        allOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyOrderFilter(currentOrderFilter);
    } catch (e) {
        console.error('Orders error:', e);
        showToast('Error loading orders', 'error');
    }
}

function applyOrderFilter(filter) {
    currentOrderFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.filter === filter);
    });
    let filtered = [...allOrders];
    if (filter !== 'all') {
        filtered = filtered.filter(item => item.status === filter);
    }
    const searchVal = document.getElementById('orderSearch').value.trim().toUpperCase();
    if (searchVal) {
        filtered = filtered.filter(item => (item.orderId || '').toUpperCase().includes(searchVal));
    }
    const dateFrom = document.getElementById('orderDateFrom').value;
    const dateTo = document.getElementById('orderDateTo').value;
    if (dateFrom) {
        filtered = filtered.filter(item => {
            if (!item.timestamp) return false;
            const d = new Date(item.timestamp);
            const dateStr = d.toISOString().split('T')[0];
            return dateStr >= dateFrom;
        });
    }
    if (dateTo) {
        filtered = filtered.filter(item => {
            if (!item.timestamp) return false;
            const d = new Date(item.timestamp);
            const dateStr = d.toISOString().split('T')[0];
            return dateStr <= dateTo;
        });
    }
    const agentFilter = document.getElementById('orderAgentFilter').value;
    if (agentFilter !== 'all') {
        filtered = filtered.filter(item => (item.agent || '') === agentFilter);
    }
    filteredOrders = filtered;
    currentPage = 1;
    renderOrdersTable();
}

function applyOrderAgentFilter() {
    applyOrderFilter(currentOrderFilter);
}

function clearOrderAgentFilter() {
    document.getElementById('orderAgentFilter').value = 'all';
    applyOrderFilter(currentOrderFilter);
}

async function loadAgentsForFilter() {
    try {
        const snap = await db.ref('users').once('value');
        const data = snap.val() || {};
        const select = document.getElementById('orderAgentFilter');
        const currentVal = select.value;
        select.innerHTML = '<option value="all">All Agents</option>';
        Object.keys(data).forEach(username => {
            const option = document.createElement('option');
            option.value = username;
            option.textContent = username;
            select.appendChild(option);
        });
        if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
            select.value = currentVal;
        }
    } catch (e) {
        console.error('Load agents for filter error:', e);
    }
}

function applyOrderDateFilter() {
    applyOrderFilter(currentOrderFilter);
}

function clearOrderDateFilter() {
    document.getElementById('orderDateFrom').value = '';
    document.getElementById('orderDateTo').value = '';
    applyOrderFilter(currentOrderFilter);
    showToast('Date filters cleared', 'info');
}

function setOrderFilter(filter) {
    applyOrderFilter(filter);
}

function applyOrderSearch() {
    applyOrderFilter(currentOrderFilter);
}

function clearOrderSearch() {
    document.getElementById('orderSearch').value = '';
    applyOrderFilter(currentOrderFilter);
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    const total = filteredOrders.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = filteredOrders.slice(start, end);

    document.getElementById('orderCountDisplay').textContent = total + ' orders';
    document.getElementById('orderPageInfo').textContent = `${currentPage} / ${totalPages}`;
    document.getElementById('prevOrderPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextOrderPageBtn').disabled = currentPage >= totalPages;

    if (pageItems.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="9"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No orders match</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    pageItems.forEach((item, idx) => {
        const num = start + idx + 1;
        const statusLabel = item.status || 'unknown';
        let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') :
            statusLabel === 'rejected' ? 'rejected' : 'reschedule';
        let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') :
            statusLabel === 'rejected' ? 'Rejected' : 'Pending';
        const model = item.phoneModel || '—';
        const imei = item.imei || '—';
        const value = item.value !== undefined && item.value !== null ? '₹' + item.value : '—';
        const customer = item.customerName || '—';
        const agent = item.agent || '—';

        html += `
            <tr class="order-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                <td class="py-3 px-4"><span class="badge-status ${statusClass}">${displayName}</span></td>
                <td class="py-3 px-4 hidden sm:table-cell text-gray-600 text-sm">${model}</td>
                <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${imei}</td>
                <td class="py-3 px-4 hidden lg:table-cell font-bold text-gray-700">${value}</td>
                <td class="py-3 px-4 hidden xl:table-cell text-gray-600 text-sm">${customer}</td>
                <td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${agent}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-1.5">
                        <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View Details">
                            <i data-lucide="eye"></i>
                        </button>
                        ${!item.sold && item.status === 'pickup' ? `<button onclick="openSellModalFromOrders('${item.id}')" class="btn-action sell" title="Sell"><i data-lucide="badge-dollar-sign"></i></button>` : ''}
                        <button onclick="deleteOrder('${item.id}')" class="btn-action delete" title="Delete">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function openSellModalFromOrders(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (order) {
        openSellModal(orderId);
    } else {
        showToast('Order not in inventory', 'error');
    }
}

function prevOrderPage() {
    if (currentPage > 1) { currentPage--;
        renderOrdersTable(); }
}

function nextOrderPage() {
    const totalPages = Math.ceil(filteredOrders.length / pageSize);
    if (currentPage < totalPages) { currentPage++;
        renderOrdersTable(); }
}

function refreshOrders() {
    loadOrders();
    loadAgentsForFilter();
    showToast('🔄 Orders refreshed', 'info');
}

// ==========================================
// PENDING ADMIN
// ==========================================
async function loadPendingAdmin() {
    try {
        const snap = await db.ref('pending').once('value');
        const data = snap.val() || {};
        const items = Object.entries(data).map(([id, item]) => ({ id, ...item }));
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const container = document.getElementById('pendingListAdmin');
        if (items.length === 0) {
            container.innerHTML =
                `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No pending orders</p><p class="text-xs text-gray-400">Orders will appear here when rescheduled</p></div>`;
        } else {
            let html = '';
            items.forEach(item => {
                const isOnWay = item.reason && item.reason.toLowerCase().includes('on the way');
                const time = item.timestampIST || item.timestamp || '';
                const agent = item.agent || '—';
                html += `
                    <div class="pending-item glass rounded-xl p-4 shadow-sm border border-gray-100">
                        <div class="flex items-start justify-between">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
                                    ${isOnWay ? '<span class="badge-onway">🚗 On the way</span>' : '<span class="badge-pending">⏳ Pending</span>'}
                                    <span class="text-xs text-gray-400">(Agent: ${agent})</span>
                                </div>
                                <p class="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                    <i data-lucide="message-circle" class="w-3 h-3"></i>
                                    ${item.reason || '—'}
                                </p>
                                <p class="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                                    <i data-lucide="clock" class="w-3 h-3"></i>
                                    ${time}
                                </p>
                            </div>
                            <div class="flex items-center gap-1.5 flex-shrink-0 ml-3">
                                <button onclick="deletePending('${item.id}')" class="btn-action delete" title="Remove from pending">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
        lucide.createIcons();
        document.getElementById('pendingBadge').textContent = items.length;

    } catch (e) {
        console.error('Pending admin error:', e);
        showToast('Error loading pending', 'error');
    }
}

function refreshPending() {
    loadPendingAdmin();
    showToast('🔄 Pending refreshed', 'info');
}

async function deletePending(orderId) {
    const result = await Swal.fire({
        title: 'Remove from Pending?',
        text: 'This will remove the order from the pending list.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Remove',
        cancelButtonText: 'Cancel'
    });
    if (!result.isConfirmed) return;
    try {
        await db.ref('pending/' + orderId).remove();
        showToast('🗑️ Removed from pending', 'success');
        loadPendingAdmin();
        loadDashboard();
    } catch (e) {
        showToast('Error removing pending', 'error');
        console.error(e);
    }
}

// ==========================================
// REJECTED ADMIN
// ==========================================
async function loadRejectedAdmin() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        const items = Object.entries(data)
            .filter(([_, item]) => item.status === 'rejected')
            .map(([id, item]) => ({ id, ...item }));
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const tbody = document.getElementById('rejectedTableBody');
        if (items.length === 0) {
            tbody.innerHTML =
                `<tr><td colspan="5"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No rejected orders</p></div></td></tr>`;
        } else {
            let html = '';
            items.forEach((item, idx) => {
                const time = item.timestampIST || item.timestamp || '';
                const agent = item.agent || '—';
                html += `
                    <tr class="order-row border-b border-gray-50">
                        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                        <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                        <td class="py-3 px-4 text-gray-600 text-sm">${item.reason || '—'}</td>
                        <td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-400">${time} (${agent})</td>
                        <td class="py-3 px-4">
                            <div class="flex items-center gap-1.5">
                                <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View Details">
                                    <i data-lucide="eye"></i>
                                </button>
                                <button onclick="deleteOrder('${item.id}')" class="btn-action delete" title="Delete">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }
        lucide.createIcons();
        document.getElementById('rejectedBadge').textContent = items.length;

    } catch (e) {
        console.error('Rejected admin error:', e);
        showToast('Error loading rejected', 'error');
    }
}

function refreshRejected() {
    loadRejectedAdmin();
    showToast('🔄 Rejected refreshed', 'info');
}

// ==========================================
// INVENTORY
// ==========================================
async function loadInventory() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        inventoryList = Object.entries(data)
            .filter(([_, item]) => item.status === 'pickup' && !item.sold)
            .map(([id, item]) => ({ id, ...item }));
        inventoryList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyInventorySearch();
    } catch (e) {
        console.error('Inventory error:', e);
        showToast('Error loading inventory', 'error');
    }
}

function applyInventorySearch() {
    const searchVal = document.getElementById('inventorySearch').value.trim().toLowerCase();
    let filtered = inventoryList;
    if (searchVal) {
        filtered = filtered.filter(item =>
            (item.orderId || '').toLowerCase().includes(searchVal) ||
            (item.phoneModel || '').toLowerCase().includes(searchVal)
        );
    }
    filteredInventory = filtered;
    renderInventoryTable();
    document.getElementById('inventoryCount').textContent = filteredInventory.length + ' units';
}

function clearInventorySearch() {
    document.getElementById('inventorySearch').value = '';
    applyInventorySearch();
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (filteredInventory.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="7"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory available</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    filteredInventory.forEach((item, idx) => {
        const agent = item.agent || '—';
        html += `
            <tr class="order-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
                <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
                <td class="py-3 px-4 font-bold text-gray-700">₹${item.value || 0}</td>
                <td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td>
                <td class="py-3 px-4">
                    <button onclick="openSellModal('${item.id}')" class="btn-action sell">
                        <i data-lucide="badge-dollar-sign"></i> Sell
                    </button>
                    <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View">
                        <i data-lucide="eye"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function refreshInventory() {
    loadInventory();
    showToast('🔄 Inventory refreshed', 'info');
}

// ==========================================
// SELL MODAL
// ==========================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) {
        showToast('Order not found in inventory', 'error');
        return;
    }
    sellOrderData = order;
    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellPurchasePrice').value = '₹' + (order.value || 0);
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sellSaleDate').value = today;
    document.getElementById('sellProfitPreview').className = 'profit-preview neutral';
    document.getElementById('sellProfitPreview').textContent = 'Enter sale price to see profit';
    document.getElementById('sellModal').style.display = 'flex';
    lucide.createIcons();

    document.getElementById('sellSalePrice').oninput = updateProfitPreview;
    updateProfitPreview();
    setTimeout(() => document.getElementById('sellSalePrice').focus(), 300);
}

function updateProfitPreview() {
    const purchase = sellOrderData ? (sellOrderData.value || 0) : 0;
    const sale = parseFloat(document.getElementById('sellSalePrice').value) || 0;
    const profit = sale - purchase;
    const preview = document.getElementById('sellProfitPreview');
    if (sale > 0) {
        preview.textContent = `Profit: ₹${profit} (${profit >= 0 ? '✅' : '⚠️ Loss'})`;
        preview.className = profit >= 0 ? 'profit-preview positive' : 'profit-preview negative';
    } else {
        preview.textContent = 'Enter sale price to see profit';
        preview.className = 'profit-preview neutral';
    }
}

function closeSellModal() {
    document.getElementById('sellModal').style.display = 'none';
    sellOrderData = null;
}

async function confirmSell() {
    if (!sellOrderData) return;

    const salePrice = parseFloat(document.getElementById('sellSalePrice').value);
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value;

    if (!salePrice || salePrice <= 0) {
        showToast('Please enter a valid sale price', 'error');
        return;
    }
    if (!buyerName) {
        showToast('Please enter buyer name', 'error');
        return;
    }

    const purchasePrice = sellOrderData.value || 0;
    const profit = salePrice - purchasePrice;

    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div class="text-left space-y-1 text-sm">
                <p><strong>Order:</strong> ${sellOrderData.orderId}</p>
                <p><strong>Model:</strong> ${sellOrderData.phoneModel}</p>
                <p><strong>Purchase:</strong> ₹${purchasePrice}</p>
                <p><strong>Sale Price:</strong> ₹${salePrice}</p>
                <p><strong>Profit:</strong> <span class="${profit >= 0 ? 'text-green-600' : 'text-red-600'} font-bold">₹${profit}</span></p>
                <p><strong>Buyer:</strong> ${buyerName}</p>
                <p><strong>Sale Date:</strong> ${saleDate}</p>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Confirm Sale',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    try {
        const updates = {
            sold: true,
            salePrice: salePrice,
            profit: profit,
            buyerName: buyerName,
            buyerContact: buyerContact || '',
            saleDate: saleDate,
            saleTimestamp: new Date().toISOString()
        };
        await db.ref('pickups/' + sellOrderData.id).update(updates);
        showToast(`✅ Sold! Profit: ₹${profit}`, 'success');

        closeSellModal();
        await loadInventory();
        await loadSales();
        loadDashboard();
        document.getElementById('inventoryBadge').textContent = inventoryList.length;
        document.getElementById('salesBadge').textContent = salesList.length;
        if (currentPageView === 'sales') applySalesFilters();

    } catch (e) {
        console.error('Sale error:', e);
        showToast('Error saving sale', 'error');
    }
}

// ==========================================
// SALES
// ==========================================
async function loadSales() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        salesList = Object.entries(data)
            .filter(([_, item]) => item.sold === true)
            .map(([id, item]) => {
                if (item.profit === undefined && item.salePrice !== undefined && item.value !== undefined) {
                    item.profit = item.salePrice - item.value;
                }
                return { id, ...item };
            });
        salesList.sort((a, b) => (b.saleTimestamp || b.timestamp || 0) - (a.saleTimestamp || a.timestamp || 0));
        applySalesFilters();
        document.getElementById('salesBadge').textContent = salesList.length;
    } catch (e) {
        console.error('Sales error:', e);
        showToast('Error loading sales', 'error');
    }
}

function applySalesFilters() {
    const search = document.getElementById('salesSearch').value.trim().toLowerCase();
    const dateFrom = document.getElementById('salesDateFrom').value;
    const dateTo = document.getElementById('salesDateTo').value;

    let filtered = salesList;
    if (search) {
        filtered = filtered.filter(item =>
            (item.orderId || '').toLowerCase().includes(search) ||
            (item.buyerName || '').toLowerCase().includes(search)
        );
    }
    if (dateFrom) {
        filtered = filtered.filter(item => (item.saleDate || '') >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(item => (item.saleDate || '') <= dateTo);
    }
    filteredSales = filtered;
    renderSalesTable();
    updateSalesSummary();
}

function clearSalesFilters() {
    document.getElementById('salesSearch').value = '';
    document.getElementById('salesDateFrom').value = '';
    document.getElementById('salesDateTo').value = '';
    applySalesFilters();
}

function updateSalesSummary() {
    const total = filteredSales.length;
    let revenue = 0, profit = 0;
    filteredSales.forEach(item => {
        revenue += item.salePrice || 0;
        const p = item.profit !== undefined ? item.profit : (item.salePrice - item.value);
        profit += p || 0;
    });
    document.getElementById('salesTotalCount').textContent = total;
    document.getElementById('salesTotalRevenue').textContent = '₹' + revenue;
    document.getElementById('salesTotalProfit').textContent = '₹' + profit;
    document.getElementById('salesAvgProfit').textContent = total > 0 ? '₹' + Math.round(profit / total) : '₹0';
}

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    if (filteredSales.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="10"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No sales found</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    filteredSales.forEach((item, idx) => {
        const profit = item.profit !== undefined ? item.profit : (item.salePrice - item.value);
        const profitNum = profit || 0;
        const profitClass = profitNum >= 0 ? 'profit-green' : 'profit-red';
        const saleDate = item.saleDate || item.timestampIST || '—';
        const agent = item.agent || '—';
        html += `
            <tr class="order-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
                <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
                <td class="py-3 px-4 text-gray-600">₹${item.value || 0}</td>
                <td class="py-3 px-4 font-bold text-gray-800">₹${item.salePrice || 0}</td>
                <td class="py-3 px-4 font-bold ${profitClass}">₹${profitNum}</td>
                <td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.buyerName || '—'}</td>
                <td class="py-3 px-4 text-xs text-gray-500">${saleDate} (${agent})</td>
                <td class="py-3 px-4">
                    <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View Details">
                        <i data-lucide="eye"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function refreshSales() {
    loadSales();
    showToast('🔄 Sales refreshed', 'info');
}

function exportSalesCSV() {
    if (filteredSales.length === 0) {
        showToast('No sales data to export', 'error');
        return;
    }
    const headers = ['Order ID', 'Model', 'IMEI', 'Purchase Price', 'Sale Price', 'Profit', 'Buyer', 'Buyer Contact',
        'Sale Date', 'Agent'
    ];
    const rows = filteredSales.map(item => {
        const profit = item.profit !== undefined ? item.profit : (item.salePrice - item.value);
        return [
            item.orderId || item.id || '',
            item.phoneModel || '',
            item.imei || '',
            item.value || 0,
            item.salePrice || 0,
            profit || 0,
            item.buyerName || '',
            item.buyerContact || '',
            item.saleDate || '',
            item.agent || ''
        ];
    });
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_report_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast('📥 Sales CSV exported', 'success');
}

// ==========================================
// VIEW ORDER DETAIL
// ==========================================
function viewOrder(orderId) {
    detailOrderId = orderId;
    isEditMode = false;
    document.getElementById('detailModalTitle').textContent = 'Order Details';
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    modal.style.display = 'flex';
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span><p class="text-sm text-gray-400 mt-2">Loading...</p></div>`;

    document.getElementById('detailActions').style.display = 'flex';
    document.getElementById('detailSaveActions').style.display = 'none';
    document.getElementById('detailEditBtn').textContent = '✏️ Edit';
    document.getElementById('detailEditBtn').onclick = toggleEditMode;

    db.ref('pickups/' + orderId).once('value').then(snap => {
        const item = snap.val();
        if (!item) {
            content.innerHTML =
                `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`;
            return;
        }
        if (item.sold && item.profit === undefined && item.salePrice !== undefined && item.value !== undefined) {
            item.profit = item.salePrice - item.value;
        }
        editData = { ...item, id: orderId };
        renderDetailView(item);
    }).catch(err => {
        content.innerHTML =
            `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading details</p></div>`;
        showToast('Error loading order details', 'error');
    });
}

function renderDetailView(item) {
    const content = document.getElementById('detailContent');
    const statusLabel = item.status || 'unknown';
    let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') :
        statusLabel === 'rejected' ? 'rejected' : 'reschedule';
    let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup Completed') :
        statusLabel === 'rejected' ? 'Rejected' : 'Pending';

    let profitDisplay = '—';
    let profitClass = '';
    if (item.sold) {
        const profit = item.profit !== undefined ? item.profit : (item.salePrice - item.value);
        profitDisplay = '₹' + (profit || 0);
        profitClass = (profit || 0) >= 0 ? 'green' : 'red';
    }

    let saleHtml = '';
    if (item.sold) {
        saleHtml = `
            <div class="detail-item"><div class="label">Sale Price</div><div class="value green">₹${item.salePrice || 0}</div></div>
            <div class="detail-item"><div class="label">Profit</div><div class="value ${profitClass}">${profitDisplay}</div></div>
            <div class="detail-item"><div class="label">Buyer</div><div class="value">${item.buyerName || '—'}</div></div>
            <div class="detail-item"><div class="label">Buyer Contact</div><div class="value">${item.buyerContact || '—'}</div></div>
            <div class="detail-item"><div class="label">Sale Date</div><div class="value">${item.saleDate || '—'}</div></div>
        `;
    }

    let html = `
        <div class="flex items-center gap-3 mb-4">
            <span class="badge-status ${statusClass} text-sm px-4 py-1.5">${displayName}</span>
            <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
            ${item.agent ? `<span class="text-xs text-gray-400">(Agent: ${item.agent})</span>` : ''}
        </div>
        <div class="detail-grid">
            <div class="detail-item"><div class="label">Phone Model</div><div class="value" id="dv-model">${item.phoneModel || '—'}</div></div>
            <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs" id="dv-imei">${item.imei || '—'}</div></div>
            ${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs" id="dv-imei2">${item.imei2}</div></div>` : ''}
            <div class="detail-item"><div class="label">Purchase Price</div><div class="value font-bold" id="dv-value">${item.value !== undefined && item.value !== null ? '₹' + item.value : '—'}</div></div>
            <div class="detail-item"><div class="label">Customer Name</div><div class="value" id="dv-customer">${item.customerName || '—'}</div></div>
            <div class="detail-item"><div class="label">Reason</div><div class="value" id="dv-reason">${item.reason || '—'}</div></div>
            <div class="detail-item"><div class="label">Status</div><div class="value" id="dv-status">${displayName}</div></div>
            <div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs" id="dv-time">${item.timestampIST || item.timestamp || '—'}</div></div>
            ${saleHtml}
        </div>
    `;
    content.innerHTML = html;
    lucide.createIcons();
    editData = { ...item };
}

// ==========================================
// EDIT MODE
// ==========================================
function editOrderDirect(orderId) {
    viewOrder(orderId);
    setTimeout(() => toggleEditMode(), 300);
}

function toggleEditMode() {
    if (isEditMode) return;
    isEditMode = true;
    document.getElementById('detailModalTitle').textContent = 'Edit Order';
    document.getElementById('detailActions').style.display = 'none';
    document.getElementById('detailSaveActions').style.display = 'flex';

    const content = document.getElementById('detailContent');
    const item = editData;

    let datetimeVal = '';
    if (item.timestamp) {
        const d = new Date(item.timestamp);
        if (!isNaN(d)) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            datetimeVal = `${year}-${month}-${day}T${hours}:${mins}`;
        }
    }

    let html = `
        <div class="space-y-4">
            <div>
                <label class="edit-label">Order ID</label>
                <input type="text" id="edit-orderId" value="${item.orderId || item.id || ''}" class="edit-field" readonly style="background:#f1f5f9;cursor:not-allowed;">
            </div>
            <div>
                <label class="edit-label">Status</label>
                <select id="edit-status" class="status-select">
                    <option value="pickup" ${item.status === 'pickup' ? 'selected' : ''}>Pickup Completed</option>
                    <option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    <option value="reschedule" ${item.status === 'reschedule' ? 'selected' : ''}>Pending / Reschedule</option>
                </select>
            </div>
            <div>
                <label class="edit-label">Phone Model</label>
                <input type="text" id="edit-model" value="${item.phoneModel || ''}" class="edit-field">
            </div>
            <div>
                <label class="edit-label">IMEI</label>
                <input type="text" id="edit-imei" value="${item.imei || ''}" class="edit-field font-mono">
            </div>
            <div>
                <label class="edit-label">IMEI 2 (optional)</label>
                <input type="text" id="edit-imei2" value="${item.imei2 || ''}" class="edit-field font-mono">
            </div>
            <div>
                <label class="edit-label">Purchase Price (₹)</label>
                <input type="number" id="edit-value" value="${item.value !== undefined && item.value !== null ? item.value : ''}" class="edit-field">
            </div>
            <div>
                <label class="edit-label">Customer Name</label>
                <input type="text" id="edit-customer" value="${item.customerName || ''}" class="edit-field">
            </div>
            <div>
                <label class="edit-label">Reason</label>
                <input type="text" id="edit-reason" value="${item.reason || ''}" class="edit-field">
            </div>
            <div>
                <label class="edit-label">Date & Time (IST)</label>
                <input type="datetime-local" id="edit-datetime" value="${datetimeVal}" class="edit-field">
            </div>
            ${item.sold ? `
                <div class="border-t border-gray-200 pt-3">
                    <p class="text-sm font-bold text-gray-700">Sale Details</p>
                    <div class="mt-2">
                        <label class="edit-label">Sale Price (₹)</label>
                        <input type="number" id="edit-salePrice" value="${item.salePrice || ''}" class="edit-field">
                    </div>
                    <div class="mt-2">
                        <label class="edit-label">Buyer Name</label>
                        <input type="text" id="edit-buyer" value="${item.buyerName || ''}" class="edit-field">
                    </div>
                    <div class="mt-2">
                        <label class="edit-label">Buyer Contact</label>
                        <input type="text" id="edit-buyerContact" value="${item.buyerContact || ''}" class="edit-field">
                    </div>
                    <div class="mt-2">
                        <label class="edit-label">Sale Date</label>
                        <input type="date" id="edit-saleDate" value="${item.saleDate || ''}" class="edit-field">
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    content.innerHTML = html;
    lucide.createIcons();
}

function cancelEdit() {
    isEditMode = false;
    if (detailOrderId) {
        db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const item = snap.val();
            if (item) {
                renderDetailView(item);
                document.getElementById('detailActions').style.display = 'flex';
                document.getElementById('detailSaveActions').style.display = 'none';
                document.getElementById('detailModalTitle').textContent = 'Order Details';
                document.getElementById('detailEditBtn').textContent = '✏️ Edit';
                document.getElementById('detailEditBtn').onclick = toggleEditMode;
                editData = { ...item, id: detailOrderId };
            }
        });
    }
}

async function saveEdit() {
    const orderId = document.getElementById('edit-orderId').value.trim();
    const status = document.getElementById('edit-status').value;
    const model = document.getElementById('edit-model').value.trim();
    const imei = document.getElementById('edit-imei').value.trim();
    const imei2 = document.getElementById('edit-imei2').value.trim();
    const value = parseFloat(document.getElementById('edit-value').value) || 0;
    const customer = document.getElementById('edit-customer').value.trim();
    const reason = document.getElementById('edit-reason').value.trim();
    const datetimeVal = document.getElementById('edit-datetime').value;

    const salePrice = parseFloat(document.getElementById('edit-salePrice')?.value) || 0;
    const buyer = document.getElementById('edit-buyer')?.value.trim() || '';
    const buyerContact = document.getElementById('edit-buyerContact')?.value.trim() || '';
    const saleDate = document.getElementById('edit-saleDate')?.value || '';

    if (!orderId) {
        showToast('Order ID is required', 'error');
        return;
    }

    let updated = {
        orderId,
        status,
        phoneModel: model,
        imei,
        imei2: imei2 || undefined,
        value,
        customerName: customer || 'N/A',
        reason: reason || '',
        timestamp: editData.timestamp,
        timestampIST: editData.timestampIST || '',
    };

    if (datetimeVal) {
        const d = new Date(datetimeVal);
        if (!isNaN(d)) {
            updated.timestamp = d.toISOString();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istTime = new Date(d.getTime() + istOffset);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dd = String(istTime.getUTCDate()).padStart(2, '0');
            const mmm = months[istTime.getUTCMonth()];
            const yyyy = istTime.getUTCFullYear();
            let hours = istTime.getUTCHours();
            const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
            const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const hh = String(hours).padStart(2, '0');
            updated.timestampIST = `${dd}-${mmm}-${yyyy}, ${hh}:${minutes}:${seconds} ${ampm} IST`;
        }
    } else {
        updated.timestamp = editData.timestamp;
        updated.timestampIST = editData.timestampIST;
    }

    if (editData.sold) {
        updated.sold = true;
        updated.salePrice = salePrice;
        updated.buyerName = buyer;
        updated.buyerContact = buyerContact;
        updated.saleDate = saleDate;
        updated.profit = salePrice - value;
    }

    const confirm = await Swal.fire({
        title: 'Save Changes?',
        text: 'Are you sure you want to update this order?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, save',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    try {
        await db.ref('pickups/' + detailOrderId).update(updated);
        showToast('✅ Order updated successfully', 'success');

        if (currentPageView === 'orders') loadOrders();
        else if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
        else if (currentPageView === 'inventory') loadInventory();
        else if (currentPageView === 'sales') loadSales();

        isEditMode = false;
        await db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const item = snap.val();
            if (item) {
                renderDetailView(item);
                document.getElementById('detailActions').style.display = 'flex';
                document.getElementById('detailSaveActions').style.display = 'none';
                document.getElementById('detailModalTitle').textContent = 'Order Details';
                document.getElementById('detailEditBtn').textContent = '✏️ Edit';
                document.getElementById('detailEditBtn').onclick = toggleEditMode;
                editData = { ...item, id: detailOrderId };
            }
        });
    } catch (e) {
        console.error('Update error:', e);
        showToast('Error updating order', 'error');
    }
}

// ==========================================
// DELETE ORDER — with global refresh
// ==========================================
async function deleteOrder(orderId) {
    const result = await Swal.fire({
        title: 'Delete Order?',
        text: 'This action cannot be undone. Are you sure?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, delete',
        cancelButtonText: 'Cancel'
    });
    if (!result.isConfirmed) return;

    try {
        await db.ref('pickups/' + orderId).remove();
        await db.ref('pending/' + orderId).remove();
        showToast('🗑️ Order deleted successfully', 'success');

        await loadDashboard();
        await loadOrders();
        await loadPendingAdmin();
        await loadRejectedAdmin();
        await loadInventory();
        await loadSales();
        if (currentPageView === 'agents') loadAgents();

        closeDetail();

    } catch (e) {
        showToast('Error deleting order', 'error');
        console.error(e);
    }
}

function deleteOrderFromDetail() {
    if (detailOrderId) {
        deleteOrder(detailOrderId);
    }
}

function closeDetail() {
    document.getElementById('detailModal').style.display = 'none';
    detailOrderId = null;
    isEditMode = false;
    document.getElementById('detailActions').style.display = 'flex';
    document.getElementById('detailSaveActions').style.display = 'none';
}

// ==========================================
// EXPORT CSV (All Orders)
// ==========================================
function exportCSV() {
    if (allOrders.length === 0) {
        showToast('No data to export', 'error');
        return;
    }
    const headers = ['Order ID', 'Status', 'Model', 'IMEI', 'IMEI2', 'Value', 'Customer', 'Reason', 'Time (IST)', 'Agent'];
    const rows = allOrders.map(item => [
        item.orderId || item.id || '',
        item.status || '',
        item.phoneModel || '',
        item.imei || '',
        item.imei2 || '',
        item.value !== undefined ? item.value : '',
        item.customerName || '',
        item.reason || '',
        item.timestampIST || item.timestamp || '',
        item.agent || ''
    ]);
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `flipkart_orders_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast('📥 Orders CSV exported', 'success');
}

// ==========================================
// AGENTS
// ==========================================
async function loadAgents() {
    try {
        const snap = await db.ref('users').once('value');
        const data = snap.val() || {};
        agentsList = Object.entries(data).map(([username, item]) => ({
            username,
            ...item
        }));
        agentsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        renderAgentsTable();
        document.getElementById('agentsBadge').textContent = agentsList.length;
        loadAgentsForFilter();
    } catch (e) {
        console.error('Load agents error:', e);
        showToast('Error loading agents', 'error');
    }
}

function renderAgentsTable() {
    const tbody = document.getElementById('agentsTableBody');
    if (agentsList.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="8"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No agents registered</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    agentsList.forEach((item, idx) => {
        const pw = item.password || '****';
        const showPw = passwordVisible[item.username] || false;
        const pwDisplay = showPw ? pw : '••••••••';
        html += `
            <tr class="user-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4 font-medium text-gray-800">${item.name || '—'}</td>
                <td class="py-3 px-4 font-mono text-sm text-gray-700">${item.username}</td>
                <td class="py-3 px-4 hidden sm:table-cell text-gray-600">${item.mobile || '—'}</td>
                <td class="py-3 px-4 hidden md:table-cell text-gray-600">${item.aadhar || '—'}</td>
                <td class="py-3 px-4 hidden lg:table-cell text-gray-600">${item.alternate || '—'}</td>
                <td class="py-3 px-4 font-mono">
                    <span class="pw-hidden">${pwDisplay}</span>
                    <button onclick="togglePassword('${item.username}')" class="btn-action show ml-1" title="Show/Hide Password">
                        <i data-lucide="${showPw ? 'eye-off' : 'eye'}"></i>
                    </button>
                </td>
                <td class="py-3 px-4">
                    <button onclick="viewAgentActivity('${item.username}')" class="btn-action activity" title="View Activity">
                        <i data-lucide="activity"></i>
                    </button>
                    <button onclick="showChangePasswordModal('${item.username}')" class="btn-action edit" title="Change Password">
                        <i data-lucide="key"></i>
                    </button>
                    <button onclick="deleteAgent('${item.username}')" class="btn-action delete" title="Delete Agent">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    document.getElementById('agentsCount').textContent = agentsList.length + ' agents';
    lucide.createIcons();
}

function togglePassword(username) {
    passwordVisible[username] = !passwordVisible[username];
    renderAgentsTable();
}

async function deleteAgent(username) {
    const result = await Swal.fire({
        title: 'Delete Agent?',
        text: `Are you sure you want to delete agent "${username}"? This cannot be undone.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, delete',
        cancelButtonText: 'Cancel'
    });
    if (!result.isConfirmed) return;

    try {
        await db.ref('users/' + username).remove();
        showToast('✅ Agent deleted', 'success');
        loadAgents();
    } catch (e) {
        console.error('Delete agent error:', e);
        showToast('Error deleting agent', 'error');
    }
}

function registerAgent(e) {
    e.preventDefault();

    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const aadhar = document.getElementById('regAadhar').value.trim();
    const alternate = document.getElementById('regAlternate').value.trim();

    const errorEl = document.getElementById('agentError');
    const successEl = document.getElementById('agentSuccess');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    if (!name || !username || !password || !mobile) {
        errorEl.textContent = 'Please fill all required fields (Name, Username, Password, Mobile).';
        errorEl.style.display = 'block';
        return;
    }
    if (username.length < 3) {
        errorEl.textContent = 'Username must be at least 3 characters.';
        errorEl.style.display = 'block';
        return;
    }
    if (password.length < 4) {
        errorEl.textContent = 'Password must be at least 4 characters.';
        errorEl.style.display = 'block';
        return;
    }
    if (mobile.length < 10) {
        errorEl.textContent = 'Please enter a valid 10-digit mobile number.';
        errorEl.style.display = 'block';
        return;
    }

    db.ref('users/' + username).once('value')
        .then(snap => {
            if (snap.exists()) {
                errorEl.textContent = 'Username already taken. Please choose another.';
                errorEl.style.display = 'block';
                return;
            }
            return db.ref('users/' + username).set({
                name,
                username,
                password,
                aadhar: aadhar || '',
                mobile,
                alternate: alternate || '',
                createdAt: Date.now()
            });
        })
        .then(() => {
            successEl.textContent = '✅ Agent registered successfully!';
            successEl.style.display = 'block';
            document.getElementById('regName').value = '';
            document.getElementById('regUsername').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regMobile').value = '';
            document.getElementById('regAadhar').value = '';
            document.getElementById('regAlternate').value = '';
            loadAgents();
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 5000);
        })
        .catch(err => {
            console.error('Registration error:', err);
            errorEl.textContent = 'Something went wrong. Please try again.';
            errorEl.style.display = 'block';
        });
}

function showChangePasswordModal(username) {
    Swal.fire({
        title: `Change Password for "${username}"`,
        html: `
            <input type="password" id="newPassword" class="swal2-input" placeholder="New password" minlength="4">
            <input type="password" id="confirmPassword" class="swal2-input" placeholder="Confirm new password" minlength="4">
        `,
        showCancelButton: true,
        confirmButtonText: 'Update Password',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#64748b',
        preConfirm: () => {
            const newPw = document.getElementById('newPassword').value;
            const confirmPw = document.getElementById('confirmPassword').value;
            if (!newPw || newPw.length < 4) {
                Swal.showValidationMessage('Password must be at least 4 characters');
                return false;
            }
            if (newPw !== confirmPw) {
                Swal.showValidationMessage('Passwords do not match');
                return false;
            }
            return newPw;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await db.ref('users/' + username + '/password').set(result.value);
                showToast('✅ Password updated successfully', 'success');
                loadAgents();
            } catch (e) {
                showToast('Error updating password', 'error');
                console.error(e);
            }
        }
    });
}

// ==========================================
// AGENT ACTIVITY
// ==========================================
function viewAgentActivity(username) {
    const modal = document.getElementById('activityModal');
    const content = document.getElementById('activityContent');
    const title = document.getElementById('activityModalTitle');
    title.textContent = `Activity: ${username}`;
    modal.style.display = 'flex';
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span><p class="text-sm text-gray-400 mt-2">Loading...</p></div>`;

    db.ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        const orders = Object.entries(data)
            .filter(([_, item]) => item.agent === username)
            .map(([id, item]) => ({ id, ...item }));
        orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (orders.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox"></i>
                    <p class="text-sm font-medium">No activity found for this agent.</p>
                    <p class="text-xs text-gray-400">No orders processed yet.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        let html = `<div class="space-y-2">`;
        orders.forEach(item => {
            const statusLabel = item.status || 'unknown';
            const statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') :
                statusLabel === 'rejected' ? 'rejected' : 'reschedule';
            const displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') :
                statusLabel === 'rejected' ? 'Rejected' : 'Pending';
            const time = item.timestampIST || item.timestamp || '';
            const model = item.phoneModel || '—';
            const value = item.value !== undefined ? '₹' + item.value : '—';
            const reason = item.reason || '—';
            html += `
                <div class="activity-item flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 cursor-pointer" onclick="viewOrder('${item.id}')">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="badge-status ${statusClass}">${displayName}</span>
                        <span class="font-mono font-bold text-gray-700 text-sm truncate">${item.orderId || item.id}</span>
                        <span class="text-xs text-gray-400 hidden sm:inline">${model}</span>
                        <span class="text-xs text-gray-400 hidden md:inline">${value}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] text-gray-400">${time}</span>
                        <span class="text-xs text-gray-500 italic">${reason}</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        content.innerHTML = html;
        lucide.createIcons();
    }).catch(err => {
        content.innerHTML =
            `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading activity</p></div>`;
        showToast('Error loading activity', 'error');
    });
}

function closeActivityModal() {
    document.getElementById('activityModal').style.display = 'none';
}

// ==========================================
// REFRESH ALL
// ==========================================
function refreshAll() {
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing all data...', 'info');

    Promise.all([
        loadDashboard(),
        loadOrders(),
        loadPendingAdmin(),
        loadRejectedAdmin(),
        loadInventory(),
        loadSales(),
        loadAgents()
    ]).then(() => {
        isRefreshing = false;
        showToast('✅ All data refreshed', 'success');
    }).catch(() => {
        isRefreshing = false;
        showToast('⚠️ Refresh incomplete', 'error');
    });
}

// ==========================================
// LIVE CLOCK
// ==========================================
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('liveTime').textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    loadDashboard();
    loadOrders();
    loadPendingAdmin();
    loadRejectedAdmin();
    loadInventory();
    loadSales();
    loadAgents();

    setInterval(() => {
        if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'orders') { loadOrders(); loadAgentsForFilter(); }
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
        else if (currentPageView === 'inventory') loadInventory();
        else if (currentPageView === 'sales') loadSales();
        else if (currentPageView === 'agents') loadAgents();
    }, 60000);

    console.log('✅ Admin panel ready');
    showToast('👋 Welcome to Admin Panel', 'info', 2000);
});

// Click outside modal to close
document.getElementById('detailModal').addEventListener('click', function(e) {
    if (e.target === this) closeDetail();
});
document.getElementById('sellModal').addEventListener('click', function(e) {
    if (e.target === this) closeSellModal();
});
document.getElementById('activityModal').addEventListener('click', function(e) {
    if (e.target === this) closeActivityModal();
});

// ESC key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeDetail();
        closeSellModal();
        closeActivityModal();
        closeSidebar();
    }
});

// Lucide icons refresh
setInterval(() => {
    lucide.createIcons();
}, 5000);