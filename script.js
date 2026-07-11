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
// COMMISSION BRACKETS
// ==========================================
const COMMISSION_BRACKETS = [
    { min: 0, max: 10000, type: 'percentage', value: 10 },
    { min: 10001, max: 31000, type: 'fixed', value: 1500 },
    { min: 31001, max: Infinity, type: 'fixed', value: 2500 }
];

function calculateCommission(salePrice) {
    if (!salePrice || salePrice <= 0) return 0;
    for (const bracket of COMMISSION_BRACKETS) {
        if (salePrice >= bracket.min && salePrice <= bracket.max) {
            if (bracket.type === 'percentage') {
                return Math.round((salePrice * bracket.value) / 100);
            } else {
                return bracket.value;
            }
        }
    }
    return 0;
}

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

// Deposit state
let allDeposits = [];
let filteredDeposits = [];
let depositCurrentPage = 1;
const depositPageSize = 15;

// Salary mode
let currentSalaryMode = 'today';

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
// SIDEBAR & NAV
// ==========================================
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open'); }

function navigate(page) {
    currentPageView = page;
    document.querySelectorAll('.sidebar-link').forEach(el => { el.classList.toggle('active', el.dataset.page === page); });
    document.querySelectorAll('.page-content').forEach(el => { el.style.display = 'none'; });
    const target = document.getElementById('page-' + page);
    if (target) { target.style.display = 'block'; target.classList.remove('fade-in'); void target.offsetWidth; target.classList.add('fade-in'); }
    closeSidebar();
    if (page === 'dashboard') loadDashboard();
    else if (page === 'orders') { loadOrders(); loadAgentsForFilter(); }
    else if (page === 'pending') loadPendingAdmin();
    else if (page === 'rejected') loadRejectedAdmin();
    else if (page === 'inventory') loadInventory();
    else if (page === 'sales') loadSales();
    else if (page === 'deposits') { loadDeposits(); }
    else if (page === 'attendance') loadAttendance();
    else if (page === 'salary') {
        setSalaryMode(currentSalaryMode || 'today');
        loadSalaryData();
    }
    else if (page === 'agents') loadAgents();
}

// ==========================================
// DASHBOARD – hold orders are completely skipped
// ==========================================
async function loadDashboard() {
    try {
        const [pickupSnap, pendingSnap, usersSnap, depositSnap] = await Promise.all([
            db.ref('pickups').once('value'),
            db.ref('pending').once('value'),
            db.ref('users').once('value'),
            db.ref('deposits').once('value')
        ]);

        const pickups = pickupSnap.val() || {};
        const pending = pendingSnap.val() || {};
        const users = usersSnap.val() || {};
        const deposits = depositSnap.val() || {};

        let total = 0, pickupCount = 0, rejectedCount = 0, rescheduleCount = 0;
        let soldCount = 0, unsoldCount = 0, revenue = 0, profit = 0, totalCommission = 0;
        let totalStockValue = 0;

        Object.values(pickups).forEach(item => {
            total++; // total orders includes hold
            // Hold orders are completely excluded from all financial/inventory stats
            if (item.status === 'on_hold') return; // skip hold entirely

            if (item.status === 'pickup') {
                pickupCount++;
                if (item.sold) {
                    soldCount++;
                    const commission = item.commission || calculateCommission(item.salePrice || 0);
                    const netRevenue = (item.salePrice || 0) - commission;
                    revenue += netRevenue;
                    totalCommission += commission;
                    const itemProfit = item.profit !== undefined ? item.profit : (netRevenue - (item.value || 0));
                    profit += itemProfit;
                } else {
                    unsoldCount++;
                    totalStockValue += (item.value || 0);
                }
            } else if (item.status === 'rejected') {
                rejectedCount++;
            } else if (item.status === 'reschedule') {
                rescheduleCount++;
            }
        });

        const pendingCount = Object.keys(pending).length;
        let totalAgents = 0;
        let presentToday = 0;
        const today = new Date().toISOString().split('T')[0];
        for (const [uname, uData] of Object.entries(users)) {
            const role = uData.role || 'agent';
            if (role === 'agent') {
                totalAgents++;
                const attSnap = await db.ref('attendance/' + uname + '/' + today).once('value');
                const att = attSnap.val();
                if (att && att.status === 'present') presentToday++;
            }
        }

        let depositTotalAmount = 0;
        Object.values(deposits).forEach(d => {
            depositTotalAmount += d.amount || 0;
        });

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statPickup').textContent = pickupCount;
        document.getElementById('statRejected').textContent = rejectedCount;
        document.getElementById('statPending').textContent = pendingCount;
        document.getElementById('statInventory').textContent = unsoldCount;
        document.getElementById('statSold').textContent = soldCount;
        document.getElementById('statRevenue').textContent = '₹' + Math.round(revenue);
        document.getElementById('statProfit').textContent = '₹' + Math.round(profit);
        document.getElementById('statStockValue').textContent = '₹' + totalStockValue;
        document.getElementById('statAgents').textContent = totalAgents;
        document.getElementById('statPresentToday').textContent = presentToday;
        document.getElementById('statCommission').textContent = '₹' + Math.round(totalCommission);

        document.getElementById('orderCountBadge').textContent = total;
        document.getElementById('pendingBadge').textContent = pendingCount;
        document.getElementById('rejectedBadge').textContent = rejectedCount;
        document.getElementById('inventoryBadge').textContent = unsoldCount;
        document.getElementById('salesBadge').textContent = soldCount;
        document.getElementById('agentsBadge').textContent = totalAgents;
        document.getElementById('attendanceBadge').textContent = presentToday + '/' + totalAgents;
        document.getElementById('depositsBadge').textContent = Object.keys(deposits).length;

        const recent = Object.entries(pickups).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0)).slice(0, 10);
        const container = document.getElementById('recentList');
        if (recent.length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity yet</p></div>`;
        } else {
            let html = '';
            recent.forEach(([id, item]) => {
                const statusLabel = item.status || 'unknown';
                let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') : statusLabel === 'rejected' ? 'rejected' : statusLabel === 'on_hold' ? 'on_hold' : 'reschedule';
                let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : statusLabel === 'rejected' ? 'Rejected' : statusLabel === 'on_hold' ? 'Hold' : 'Pending';
                const time = item.timestampIST || item.timestamp || '';
                const model = item.phoneModel || '—';
                const agentName = item.agent || '—';
                html += `<div class="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition cursor-pointer" onclick="viewOrder('${id}')"><div class="flex items-center gap-3 min-w-0"><span class="badge-status ${statusClass}">${displayName}</span><span class="font-mono font-bold text-gray-700 text-sm truncate">${id}</span><span class="text-xs text-gray-400 hidden sm:inline">${model}</span><span class="text-xs text-gray-400 hidden md:inline">(${agentName})</span></div><span class="text-[10px] text-gray-400 flex-shrink-0">${time}</span></div>`;
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
        allOrders = Object.entries(data).map(([id, item]) => ({ id, ...item }));
        allOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyOrderFilter(currentOrderFilter);
    } catch (e) {
        console.error('Orders error:', e);
        showToast('Error loading orders', 'error');
    }
}

function applyOrderFilter(filter) {
    currentOrderFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(el => { el.classList.toggle('active', el.dataset.filter === filter); });
    let filtered = [...allOrders];
    if (filter !== 'all') { filtered = filtered.filter(item => item.status === filter); }
    const searchVal = document.getElementById('orderSearch').value.trim().toUpperCase();
    if (searchVal) { filtered = filtered.filter(item => (item.orderId || '').toUpperCase().includes(searchVal)); }
    const dateFrom = document.getElementById('orderDateFrom').value;
    const dateTo = document.getElementById('orderDateTo').value;
    if (dateFrom) { filtered = filtered.filter(item => { if (!item.timestamp) return false; const d = new Date(item.timestamp); return d.toISOString().split('T')[0] >= dateFrom; }); }
    if (dateTo) { filtered = filtered.filter(item => { if (!item.timestamp) return false; const d = new Date(item.timestamp); return d.toISOString().split('T')[0] <= dateTo; }); }
    const agentFilter = document.getElementById('orderAgentFilter').value;
    if (agentFilter !== 'all') { filtered = filtered.filter(item => (item.agent || '') === agentFilter); }
    filteredOrders = filtered;
    currentPage = 1;
    renderOrdersTable();
}

function applyOrderAgentFilter() { applyOrderFilter(currentOrderFilter); }
function clearOrderAgentFilter() { document.getElementById('orderAgentFilter').value = 'all'; applyOrderFilter(currentOrderFilter); }
async function loadAgentsForFilter() {
    try {
        const snap = await db.ref('users').once('value');
        const data = snap.val() || {};
        const select = document.getElementById('orderAgentFilter');
        const currentVal = select.value;
        select.innerHTML = '<option value="all">All Agents</option>';
        Object.keys(data).forEach(username => { const option = document.createElement('option'); option.value = username; option.textContent = username; select.appendChild(option); });
        if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) { select.value = currentVal; }
    } catch (e) { console.error(e); }
}
function applyOrderDateFilter() { applyOrderFilter(currentOrderFilter); }
function clearOrderDateFilter() { document.getElementById('orderDateFrom').value = ''; document.getElementById('orderDateTo').value = ''; applyOrderFilter(currentOrderFilter); showToast('Date filters cleared', 'info'); }
function setOrderFilter(filter) { applyOrderFilter(filter); }
function applyOrderSearch() { applyOrderFilter(currentOrderFilter); }
function clearOrderSearch() { document.getElementById('orderSearch').value = ''; applyOrderFilter(currentOrderFilter); }

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
    if (pageItems.length === 0) { tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No orders match</p></div></td></tr>`; lucide.createIcons(); return; }
    let html = '';
    pageItems.forEach((item, idx) => {
        const num = start + idx + 1;
        const statusLabel = item.status || 'unknown';
        let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') : statusLabel === 'rejected' ? 'rejected' : statusLabel === 'on_hold' ? 'on_hold' : 'reschedule';
        let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : statusLabel === 'rejected' ? 'Rejected' : statusLabel === 'on_hold' ? 'Hold' : 'Pending';
        // Show previous status if on hold
        if (statusLabel === 'on_hold' && item.previous_status) {
            const prevDisplay = item.previous_status === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : item.previous_status;
            displayName = `Hold (was ${prevDisplay})`;
        }
        const model = item.phoneModel || '—';
        const imei = item.imei || '—';
        const value = item.value !== undefined && item.value !== null ? '₹' + item.value : '—';
        const customer = item.customerName || '—';
        const agent = item.agent || '—';
        html += `<tr class="order-row border-b border-gray-50"><td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td><td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td><td class="py-3 px-4"><span class="badge-status ${statusClass}">${displayName}</span></td><td class="py-3 px-4 hidden sm:table-cell text-gray-600 text-sm">${model}</td><td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${imei}</td><td class="py-3 px-4 hidden lg:table-cell font-bold text-gray-700">${value}</td><td class="py-3 px-4 hidden xl:table-cell text-gray-600 text-sm">${customer}</td><td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${agent}</td><td class="py-3 px-4"><div class="flex items-center gap-1.5"><button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button>${!item.sold && item.status === 'pickup' ? `<button onclick="openSellModalFromOrders('${item.id}')" class="btn-action sell"><i data-lucide="badge-dollar-sign"></i></button>` : ''}<button onclick="deleteOrder('${item.id}')" class="btn-action delete"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}
function openSellModalFromOrders(orderId) { const order = inventoryList.find(item => item.id === orderId); if (order) openSellModal(orderId); else showToast('Order not in inventory', 'error'); }
function prevOrderPage() { if (currentPage > 1) { currentPage--; renderOrdersTable(); } }
function nextOrderPage() { const totalPages = Math.ceil(filteredOrders.length / pageSize); if (currentPage < totalPages) { currentPage++; renderOrdersTable(); } }
function refreshOrders() { loadOrders(); loadAgentsForFilter(); showToast('🔄 Orders refreshed', 'info'); }

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
        if (items.length === 0) { container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No pending orders</p></div>`; } else {
            let html = '';
            items.forEach(item => {
                const isOnWay = item.reason && item.reason.toLowerCase().includes('on the way');
                const time = item.timestampIST || item.timestamp || '';
                const agent = item.agent || '—';
                html += `<div class="pending-item glass rounded-xl p-4 shadow-sm border border-gray-100"><div class="flex items-start justify-between"><div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap"><span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>${isOnWay ? '<span class="badge-onway">🚗 On the way</span>' : '<span class="badge-pending">⏳ Pending</span>'}<span class="text-xs text-gray-400">(Agent: ${agent})</span></div><p class="text-xs text-gray-500 mt-1"><i data-lucide="message-circle" class="w-3 h-3 inline"></i> ${item.reason || '—'}</p><p class="text-xs text-gray-400 mt-0.5"><i data-lucide="clock" class="w-3 h-3 inline"></i> ${time}</p></div><div class="flex items-center gap-1.5 flex-shrink-0 ml-3"><button onclick="deletePending('${item.id}')" class="btn-action delete"><i data-lucide="trash-2"></i></button></div></div></div>`;
            });
            container.innerHTML = html;
        }
        lucide.createIcons();
        document.getElementById('pendingBadge').textContent = items.length;
    } catch (e) { console.error(e); showToast('Error loading pending', 'error'); }
}
function refreshPending() { loadPendingAdmin(); showToast('🔄 Pending refreshed', 'info'); }
async function deletePending(orderId) {
    const result = await Swal.fire({ title: 'Remove from Pending?', text: 'Remove from pending list?', icon: 'question', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Remove', cancelButtonText: 'Cancel' });
    if (!result.isConfirmed) return;
    try { await db.ref('pending/' + orderId).remove(); showToast('🗑️ Removed from pending', 'success'); loadPendingAdmin(); loadDashboard(); } catch (e) { showToast('Error removing pending', 'error'); console.error(e); }
}

// ==========================================
// REJECTED ADMIN
// ==========================================
async function loadRejectedAdmin() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        const items = Object.entries(data).filter(([_, item]) => item.status === 'rejected').map(([id, item]) => ({ id, ...item }));
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const tbody = document.getElementById('rejectedTableBody');
        if (items.length === 0) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No rejected orders</p></div></td></tr>`; } else {
            let html = '';
            items.forEach((item, idx) => {
                const time = item.timestampIST || item.timestamp || '';
                const agent = item.agent || '—';
                const approved = item.incentive_approved === true;
                html += `<tr class="order-row border-b border-gray-50"><td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td><td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td><td class="py-3 px-4 text-gray-600 text-sm">${item.reason || '—'}</td><td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${agent}</td><td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-400">${time}</td><td class="py-3 px-4">${approved ? '<span class="badge-status approved">Approved</span>' : '<span class="badge-status reschedule">Pending</span>'}</td><td class="py-3 px-4"><div class="flex items-center gap-1.5">${!approved ? `<button onclick="approveReject('${item.id}')" class="btn-action approve"><i data-lucide="check-circle"></i> Approve</button>` : ''}<button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></div></td></tr>`;
            });
            tbody.innerHTML = html;
        }
        lucide.createIcons();
        document.getElementById('rejectedBadge').textContent = items.length;
    } catch (e) { console.error(e); showToast('Error loading rejected', 'error'); }
}
function refreshRejected() { loadRejectedAdmin(); showToast('🔄 Rejected refreshed', 'info'); }

async function approveReject(orderId) {
    const confirm = await Swal.fire({ title: 'Approve Rejection?', text: 'This will count the reject incentive for the agent.', icon: 'question', showCancelButton: true, confirmButtonColor: '#059669', cancelButtonColor: '#64748b', confirmButtonText: 'Yes, approve', cancelButtonText: 'Cancel' });
    if (!confirm.isConfirmed) return;
    try {
        const snap = await db.ref('pickups/' + orderId).once('value');
        const item = snap.val();
        if (!item) { showToast('Order not found', 'error'); return; }
        await db.ref('pickups/' + orderId + '/incentive_approved').set(true);
        await db.ref('pickups/' + orderId + '/incentive_paid').set(false);
        showToast('✅ Reject approved! Incentive will be counted.', 'success');
        loadRejectedAdmin();
        loadDashboard();
        if (currentPageView === 'salary') loadSalaryData();
    } catch (e) { showToast('Error approving reject', 'error'); console.error(e); }
}

// ==========================================
// INVENTORY (with Commission column) – hold orders excluded
// ==========================================
async function loadInventory() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        inventoryList = Object.entries(data).filter(([_, item]) => item.status === 'pickup' && !item.sold).map(([id, item]) => ({ id, ...item }));
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
    if (searchVal) { filtered = filtered.filter(item => (item.orderId || '').toLowerCase().includes(searchVal) || (item.phoneModel || '').toLowerCase().includes(searchVal)); }
    filteredInventory = filtered;
    renderInventoryTable();
    document.getElementById('inventoryCount').textContent = filteredInventory.length + ' units';
}

function clearInventorySearch() { document.getElementById('inventorySearch').value = ''; applyInventorySearch(); }

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (filteredInventory.length === 0) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory available</p></div></td></tr>`; lucide.createIcons(); return; }
    let html = '';
    filteredInventory.forEach((item, idx) => {
        const commission = calculateCommission(item.value || 0);
        html += `<tr class="order-row border-b border-gray-50"><td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td><td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td><td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td><td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td><td class="py-3 px-4 font-bold text-gray-700">₹${item.value || 0}</td><td class="py-3 px-4"><span class="commission-col">₹${commission}</span></td><td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td><td class="py-3 px-4"><button onclick="openSellModal('${item.id}')" class="btn-action sell"><i data-lucide="badge-dollar-sign"></i> Sell</button><button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></td></tr>`;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function refreshInventory() { loadInventory(); showToast('🔄 Inventory refreshed', 'info'); }

// ==========================================
// SELL MODAL (with Commission)
// ==========================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) { showToast('Order not found', 'error'); return; }
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
    document.getElementById('sellProfitPreview').textContent = 'Enter sale price to see profit (commission deducted)';
    document.getElementById('sellModal').style.display = 'flex';
    lucide.createIcons();
    document.getElementById('sellSalePrice').oninput = updateProfitPreviewWithCommission;
    updateProfitPreviewWithCommission();
    setTimeout(() => document.getElementById('sellSalePrice').focus(), 300);
}

function updateProfitPreviewWithCommission() {
    const purchase = sellOrderData ? (sellOrderData.value || 0) : 0;
    const sale = parseFloat(document.getElementById('sellSalePrice').value) || 0;
    const commission = calculateCommission(sale);
    const netProfit = sale - purchase - commission;
    const preview = document.getElementById('sellProfitPreview');
    if (sale > 0) {
        preview.textContent = `Commission: ₹${commission} | Net Profit: ₹${netProfit} (${netProfit >= 0 ? '✅' : '⚠️ Loss'})`;
        preview.className = netProfit >= 0 ? 'profit-preview positive' : 'profit-preview negative';
    } else {
        preview.textContent = 'Enter sale price to see profit (commission deducted)';
        preview.className = 'profit-preview neutral';
    }
}

function closeSellModal() { document.getElementById('sellModal').style.display = 'none'; sellOrderData = null; }

async function confirmSell() {
    if (!sellOrderData) return;

    const salePrice = parseFloat(document.getElementById('sellSalePrice').value);
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value;

    if (!salePrice || salePrice <= 0) { showToast('Valid sale price required', 'error'); return; }
    if (!buyerName) { showToast('Buyer name required', 'error'); return; }

    const purchasePrice = sellOrderData.value || 0;
    const commission = calculateCommission(salePrice);
    const netRevenue = salePrice - commission;
    const profit = netRevenue - purchasePrice;

    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div class="text-left">
                <p><strong>Order:</strong> ${sellOrderData.orderId}</p>
                <p><strong>Model:</strong> ${sellOrderData.phoneModel}</p>
                <p><strong>Purchase:</strong> ₹${purchasePrice}</p>
                <p><strong>Sale Price:</strong> ₹${salePrice}</p>
                <p><strong>Commission:</strong> ₹${commission} (${COMMISSION_BRACKETS.find(b => salePrice >= b.min && salePrice <= b.max)?.type === 'percentage' ? '10%' : 'Fixed'})</p>
                <p><strong>Net Revenue:</strong> ₹${netRevenue}</p>
                <p><strong>Net Profit:</strong> <span class="${profit >= 0 ? 'text-green-600' : 'text-red-600'} font-bold">₹${profit}</span></p>
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
            commission: commission,
            profit: profit,
            buyerName: buyerName,
            buyerContact: buyerContact || '',
            saleDate: saleDate,
            saleTimestamp: new Date().toISOString()
        };
        await db.ref('pickups/' + sellOrderData.id).update(updates);
        showToast(`✅ Sold! Net Profit: ₹${profit} (Commission: ₹${commission})`, 'success');

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
// SALES (with Commission) – exclude hold orders
// ==========================================
async function loadSales() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        salesList = Object.entries(data)
            .filter(([_, item]) => item.sold === true && item.status !== 'on_hold') // exclude hold
            .map(([id, item]) => {
                if (item.profit === undefined && item.salePrice !== undefined && item.value !== undefined) {
                    const commission = item.commission || calculateCommission(item.salePrice || 0);
                    item.profit = (item.salePrice - commission) - item.value;
                    item.commission = commission;
                }
                if (item.commission === undefined && item.salePrice) {
                    item.commission = calculateCommission(item.salePrice);
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
    if (search) { filtered = filtered.filter(item => (item.orderId || '').toLowerCase().includes(search) || (item.buyerName || '').toLowerCase().includes(search)); }
    if (dateFrom) { filtered = filtered.filter(item => (item.saleDate || '') >= dateFrom); }
    if (dateTo) { filtered = filtered.filter(item => (item.saleDate || '') <= dateTo); }
    filteredSales = filtered;
    renderSalesTable();
    updateSalesSummary();
}
function clearSalesFilters() { document.getElementById('salesSearch').value = ''; document.getElementById('salesDateFrom').value = ''; document.getElementById('salesDateTo').value = ''; applySalesFilters(); }

function updateSalesSummary() {
    const total = filteredSales.length;
    let revenue = 0, profit = 0, commission = 0;
    filteredSales.forEach(item => {
        const c = item.commission || calculateCommission(item.salePrice || 0);
        commission += c;
        revenue += (item.salePrice || 0) - c;
        const p = item.profit !== undefined ? item.profit : (item.salePrice - c - item.value);
        profit += p || 0;
    });
    document.getElementById('salesTotalCount').textContent = total;
    document.getElementById('salesTotalRevenue').textContent = '₹' + Math.round(revenue);
    document.getElementById('salesTotalProfit').textContent = '₹' + Math.round(profit);
    document.getElementById('salesAvgProfit').textContent = total > 0 ? '₹' + Math.round(profit / total) : '₹0';
}

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    if (filteredSales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No sales found</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    filteredSales.forEach((item, idx) => {
        const profit = item.profit !== undefined ? item.profit : (item.salePrice - (item.commission || calculateCommission(item.salePrice || 0)) - item.value);
        const profitNum = profit || 0;
        const profitClass = profitNum >= 0 ? 'profit-green' : 'profit-red';
        const saleDate = item.saleDate || item.timestampIST || '—';
        const agent = item.agent || '—';
        const commission = item.commission !== undefined ? item.commission : calculateCommission(item.salePrice || 0);
        html += `<tr class="order-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td>
            <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
            <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
            <td class="py-3 px-4 text-gray-600">₹${item.value || 0}</td>
            <td class="py-3 px-4 font-bold text-gray-800">₹${item.salePrice || 0}</td>
            <td class="py-3 px-4"><span class="commission-badge">₹${commission}</span></td>
            <td class="py-3 px-4 font-bold ${profitClass}">₹${profitNum}</td>
            <td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.buyerName || '—'}</td>
            <td class="py-3 px-4 text-xs text-gray-500">${saleDate} (${agent})</td>
            <td class="py-3 px-4"><button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></td>
        </tr>`;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}
function refreshSales() { loadSales(); showToast('🔄 Sales refreshed', 'info'); }

function exportSalesCSV() {
    if (filteredSales.length === 0) { showToast('No data', 'error'); return; }
    const headers = ['Order ID', 'Model', 'IMEI', 'Purchase Price', 'Sale Price', 'Commission', 'Net Profit', 'Buyer', 'Buyer Contact', 'Sale Date', 'Agent'];
    const rows = filteredSales.map(item => {
        const c = item.commission || calculateCommission(item.salePrice || 0);
        const p = item.profit !== undefined ? item.profit : (item.salePrice - c - item.value);
        return [
            item.orderId || item.id || '',
            item.phoneModel || '',
            item.imei || '',
            item.value || 0,
            item.salePrice || 0,
            c,
            p || 0,
            item.buyerName || '',
            item.buyerContact || '',
            item.saleDate || '',
            item.agent || ''
        ];
    });
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => { csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `sales_report_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); showToast('📥 Sales CSV exported', 'success');
}

// ==========================================
// VIEW ORDER DETAIL + HOLD / UNHOLD
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
    document.getElementById('detailHoldBtn').style.display = 'inline-flex';
    document.getElementById('detailHoldBtn').onclick = holdOrderFromDetail;
    document.getElementById('detailUnholdBtn').style.display = 'none';

    db.ref('pickups/' + orderId).once('value').then(snap => {
        const item = snap.val();
        if (!item) { content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`; return; }
        if (item.sold && item.profit === undefined && item.salePrice !== undefined && item.value !== undefined) {
            const commission = item.commission || calculateCommission(item.salePrice || 0);
            item.profit = (item.salePrice - commission) - item.value;
            item.commission = commission;
        }
        editData = { ...item, id: orderId };
        renderDetailView(item);
        if (item.status === 'on_hold') {
            document.getElementById('detailHoldBtn').style.display = 'none';
            document.getElementById('detailUnholdBtn').style.display = 'inline-flex';
            document.getElementById('detailUnholdBtn').onclick = unholdOrderFromDetail;
        } else {
            document.getElementById('detailHoldBtn').style.display = 'inline-flex';
            document.getElementById('detailUnholdBtn').style.display = 'none';
        }
    }).catch(err => { content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading</p></div>`; showToast('Error loading order', 'error'); });
}

function renderDetailView(item) {
    const content = document.getElementById('detailContent');
    const statusLabel = item.status || 'unknown';
    let statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') : statusLabel === 'rejected' ? 'rejected' : statusLabel === 'on_hold' ? 'on_hold' : 'reschedule';
    let displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : statusLabel === 'rejected' ? 'Rejected' : statusLabel === 'on_hold' ? 'Hold' : 'Pending';
    if (statusLabel === 'on_hold' && item.previous_status) {
        const prevDisplay = item.previous_status === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : item.previous_status;
        displayName = `Hold (was ${prevDisplay})`;
    }
    let profitDisplay = '—', profitClass = '';
    let commissionDisplay = '—';
    if (item.sold) {
        const commission = item.commission !== undefined ? item.commission : calculateCommission(item.salePrice || 0);
        commissionDisplay = '₹' + commission;
        const netProfit = item.profit !== undefined ? item.profit : (item.salePrice - commission - item.value);
        profitDisplay = '₹' + (netProfit || 0);
        profitClass = (netProfit || 0) >= 0 ? 'green' : 'red';
    }
    let saleHtml = '';
    if (item.sold) {
        saleHtml = `
            <div class="detail-item"><div class="label">Sale Price</div><div class="value green">₹${item.salePrice || 0}</div></div>
            <div class="detail-item"><div class="label">Commission</div><div class="value amber">${commissionDisplay}</div></div>
            <div class="detail-item"><div class="label">Net Profit</div><div class="value ${profitClass}">${profitDisplay}</div></div>
            <div class="detail-item"><div class="label">Buyer</div><div class="value">${item.buyerName || '—'}</div></div>
            <div class="detail-item"><div class="label">Buyer Contact</div><div class="value">${item.buyerContact || '—'}</div></div>
            <div class="detail-item"><div class="label">Sale Date</div><div class="value">${item.saleDate || '—'}</div></div>
        `;
    }
    let holdHtml = '';
    if (item.status === 'on_hold') {
        holdHtml = `<div class="detail-item"><div class="label">Hold Reason</div><div class="value text-red-600">${item.hold_reason || '—'}</div></div>
                     <div class="detail-item"><div class="label">Previous Status</div><div class="value">${item.previous_status || '—'}</div></div>`;
    }
    let html = `<div class="flex items-center gap-3 mb-4"><span class="badge-status ${statusClass} text-sm px-4 py-1.5">${displayName}</span><span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>${item.agent ? `<span class="text-xs text-gray-400">(Agent: ${item.agent})</span>` : ''}</div><div class="detail-grid"><div class="detail-item"><div class="label">Phone Model</div><div class="value" id="dv-model">${item.phoneModel || '—'}</div></div><div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs" id="dv-imei">${item.imei || '—'}</div></div>${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs" id="dv-imei2">${item.imei2}</div></div>` : ''}<div class="detail-item"><div class="label">Purchase Price</div><div class="value font-bold" id="dv-value">${item.value !== undefined && item.value !== null ? '₹' + item.value : '—'}</div></div><div class="detail-item"><div class="label">Customer Name</div><div class="value" id="dv-customer">${item.customerName || '—'}</div></div><div class="detail-item"><div class="label">Reason</div><div class="value" id="dv-reason">${item.reason || '—'}</div></div><div class="detail-item"><div class="label">Status</div><div class="value" id="dv-status">${displayName}</div></div><div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs" id="dv-time">${item.timestampIST || item.timestamp || '—'}</div></div>${holdHtml}${saleHtml}</div>`;
    content.innerHTML = html;
    lucide.createIcons();
    editData = { ...item };
}

// ==========================================
// HOLD ORDER (store previous status)
// ==========================================
async function holdOrderFromDetail() {
    if (!detailOrderId) return;
    const { value: reason, isConfirmed } = await Swal.fire({
        title: 'Hold Order',
        text: 'Enter reason for holding this order:',
        input: 'text',
        inputPlaceholder: 'Reason...',
        showCancelButton: true,
        confirmButtonColor: '#3730a3',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Hold',
        cancelButtonText: 'Cancel'
    });
    if (!isConfirmed || !reason) return;
    try {
        const snap = await db.ref('pickups/' + detailOrderId).once('value');
        const order = snap.val();
        if (!order) { showToast('Order not found', 'error'); return; }
        const previousStatus = order.status || 'pickup';
        await db.ref('pickups/' + detailOrderId).update({
            status: 'on_hold',
            hold_reason: reason,
            previous_status: previousStatus
        });
        showToast('⏸️ Order put on hold', 'success');
        closeDetail();
        loadOrders(); loadPendingAdmin(); loadDashboard(); loadInventory(); loadSales();
    } catch (e) { showToast('Error holding order', 'error'); console.error(e); }
}

// ==========================================
// UNHOLD ORDER (revert to previous status)
// ==========================================
async function unholdOrderFromDetail() {
    if (!detailOrderId) return;
    const confirm = await Swal.fire({
        title: 'Unhold Order?',
        text: 'This will set the order status back to its previous state and the agent will be eligible for incentives.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Unhold',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        const snap = await db.ref('pickups/' + detailOrderId).once('value');
        const order = snap.val();
        if (!order) { showToast('Order not found', 'error'); return; }
        const previousStatus = order.previous_status || 'pickup';
        await db.ref('pickups/' + detailOrderId).update({
            status: previousStatus,
            hold_reason: null,
            previous_status: null
        });
        showToast(`▶️ Order unheld. Reverted to ${previousStatus}`, 'success');
        closeDetail();
        loadOrders(); loadPendingAdmin(); loadDashboard(); loadInventory(); loadSales();
    } catch (e) { showToast('Error unholding order', 'error'); console.error(e); }
}

// ==========================================
// EDIT MODE
// ==========================================
function toggleEditMode() {
    if (isEditMode) return;
    isEditMode = true;
    document.getElementById('detailModalTitle').textContent = 'Edit Order';
    document.getElementById('detailActions').style.display = 'none';
    document.getElementById('detailSaveActions').style.display = 'flex';
    const content = document.getElementById('detailContent');
    const item = editData;
    let datetimeVal = '';
    if (item.timestamp) { const d = new Date(item.timestamp); if (!isNaN(d)) { const year = d.getFullYear(); const month = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); const hours = String(d.getHours()).padStart(2,'0'); const mins = String(d.getMinutes()).padStart(2,'0'); datetimeVal = `${year}-${month}-${day}T${hours}:${mins}`; } }
    let html = `<div class="space-y-4"><div><label class="edit-label">Order ID</label><input type="text" id="edit-orderId" value="${item.orderId || item.id || ''}" class="edit-field" readonly style="background:#f1f5f9;cursor:not-allowed;"></div><div><label class="edit-label">Status</label><select id="edit-status" class="status-select"><option value="pickup" ${item.status === 'pickup' ? 'selected' : ''}>Pickup</option><option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="reschedule" ${item.status === 'reschedule' ? 'selected' : ''}>Pending</option><option value="on_hold" ${item.status === 'on_hold' ? 'selected' : ''}>Hold</option></select></div><div><label class="edit-label">Phone Model</label><input type="text" id="edit-model" value="${item.phoneModel || ''}" class="edit-field"></div><div><label class="edit-label">IMEI</label><input type="text" id="edit-imei" value="${item.imei || ''}" class="edit-field font-mono"></div><div><label class="edit-label">IMEI 2</label><input type="text" id="edit-imei2" value="${item.imei2 || ''}" class="edit-field font-mono"></div><div><label class="edit-label">Purchase Price (₹)</label><input type="number" id="edit-value" value="${item.value !== undefined && item.value !== null ? item.value : ''}" class="edit-field"></div><div><label class="edit-label">Customer Name</label><input type="text" id="edit-customer" value="${item.customerName || ''}" class="edit-field"></div><div><label class="edit-label">Reason</label><input type="text" id="edit-reason" value="${item.reason || ''}" class="edit-field"></div><div><label class="edit-label">Date & Time (IST)</label><input type="datetime-local" id="edit-datetime" value="${datetimeVal}" class="edit-field"></div>${item.sold ? `<div class="border-t pt-3"><p class="font-bold">Sale Details</p><div><label class="edit-label">Sale Price</label><input type="number" id="edit-salePrice" value="${item.salePrice || ''}" class="edit-field"></div><div><label class="edit-label">Commission</label><input type="number" id="edit-commission" value="${item.commission || ''}" class="edit-field" readonly style="background:#f1f5f9;"></div><div><label class="edit-label">Buyer</label><input type="text" id="edit-buyer" value="${item.buyerName || ''}" class="edit-field"></div><div><label class="edit-label">Buyer Contact</label><input type="text" id="edit-buyerContact" value="${item.buyerContact || ''}" class="edit-field"></div><div><label class="edit-label">Sale Date</label><input type="date" id="edit-saleDate" value="${item.saleDate || ''}" class="edit-field"></div></div>` : ''}</div>`;
    content.innerHTML = html;
    lucide.createIcons();
}
function cancelEdit() {
    isEditMode = false;
    if (detailOrderId) { db.ref('pickups/' + detailOrderId).once('value').then(snap => { const item = snap.val(); if (item) { renderDetailView(item); document.getElementById('detailActions').style.display = 'flex'; document.getElementById('detailSaveActions').style.display = 'none'; document.getElementById('detailModalTitle').textContent = 'Order Details'; document.getElementById('detailEditBtn').textContent = '✏️ Edit'; document.getElementById('detailEditBtn').onclick = toggleEditMode; editData = { ...item, id: detailOrderId }; } }); }
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
    if (!orderId) { showToast('Order ID required', 'error'); return; }
    let updated = { orderId, status, phoneModel: model, imei, imei2: imei2 || undefined, value, customerName: customer || 'N/A', reason: reason || '', timestamp: editData.timestamp, timestampIST: editData.timestampIST || '' };
    if (datetimeVal) { const d = new Date(datetimeVal); if (!isNaN(d)) { updated.timestamp = d.toISOString(); const istOffset = 5.5 * 60 * 60 * 1000; const istTime = new Date(d.getTime() + istOffset); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const dd = String(istTime.getUTCDate()).padStart(2,'0'); const mmm = months[istTime.getUTCMonth()]; const yyyy = istTime.getUTCFullYear(); let hours = istTime.getUTCHours(); const minutes = String(istTime.getUTCMinutes()).padStart(2,'0'); const seconds = String(istTime.getUTCSeconds()).padStart(2,'0'); const ampm = hours >= 12 ? 'PM' : 'AM'; hours = hours % 12 || 12; const hh = String(hours).padStart(2,'0'); updated.timestampIST = `${dd}-${mmm}-${yyyy}, ${hh}:${minutes}:${seconds} ${ampm} IST`; } } else { updated.timestamp = editData.timestamp; updated.timestampIST = editData.timestampIST; }
    if (editData.sold) {
        const commission = calculateCommission(salePrice);
        updated.sold = true;
        updated.salePrice = salePrice;
        updated.commission = commission;
        updated.buyerName = buyer;
        updated.buyerContact = buyerContact;
        updated.saleDate = saleDate;
        updated.profit = (salePrice - commission) - value;
    }
    // If status is changed to on_hold, store previous status
    if (status === 'on_hold' && editData.status !== 'on_hold') {
        updated.previous_status = editData.status;
        updated.hold_reason = reason || 'Manually held';
    } else if (status !== 'on_hold' && editData.status === 'on_hold') {
        // If unholding via edit, remove hold fields
        updated.previous_status = null;
        updated.hold_reason = null;
    }
    const confirm = await Swal.fire({ title: 'Save Changes?', icon: 'question', showCancelButton: true, confirmButtonColor: '#4f46e5', cancelButtonColor: '#64748b', confirmButtonText: 'Yes', cancelButtonText: 'Cancel' });
    if (!confirm.isConfirmed) return;
    try { await db.ref('pickups/' + detailOrderId).update(updated); showToast('✅ Updated', 'success'); loadOrders(); loadDashboard(); loadPendingAdmin(); loadRejectedAdmin(); loadInventory(); loadSales(); isEditMode = false; await db.ref('pickups/' + detailOrderId).once('value').then(snap => { const item = snap.val(); if (item) { renderDetailView(item); document.getElementById('detailActions').style.display = 'flex'; document.getElementById('detailSaveActions').style.display = 'none'; document.getElementById('detailModalTitle').textContent = 'Order Details'; document.getElementById('detailEditBtn').textContent = '✏️ Edit'; document.getElementById('detailEditBtn').onclick = toggleEditMode; editData = { ...item, id: detailOrderId }; } }); } catch (e) { console.error(e); showToast('Error updating', 'error'); }
}

// ==========================================
// DELETE ORDER
// ==========================================
async function deleteOrder(orderId) {
    const result = await Swal.fire({ title: 'Delete Order?', text: 'Cannot be undone.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Yes, delete', cancelButtonText: 'Cancel' });
    if (!result.isConfirmed) return;
    try { await db.ref('pickups/' + orderId).remove(); await db.ref('pending/' + orderId).remove(); showToast('🗑️ Deleted', 'success'); loadDashboard(); loadOrders(); loadPendingAdmin(); loadRejectedAdmin(); loadInventory(); loadSales(); closeDetail(); } catch (e) { showToast('Error deleting', 'error'); console.error(e); }
}
function deleteOrderFromDetail() { if (detailOrderId) deleteOrder(detailOrderId); }
function closeDetail() { document.getElementById('detailModal').style.display = 'none'; detailOrderId = null; isEditMode = false; document.getElementById('detailActions').style.display = 'flex'; document.getElementById('detailSaveActions').style.display = 'none'; }

// ==========================================
// EXPORT CSV
// ==========================================
function exportCSV() {
    if (allOrders.length === 0) { showToast('No data', 'error'); return; }
    const headers = ['Order ID','Status','Model','IMEI','IMEI2','Value','Customer','Reason','Time (IST)','Agent'];
    const rows = allOrders.map(item => [item.orderId || item.id || '', item.status || '', item.phoneModel || '', item.imei || '', item.imei2 || '', item.value !== undefined ? item.value : '', item.customerName || '', item.reason || '', item.timestampIST || item.timestamp || '', item.agent || '']);
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => { csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `flipkart_orders_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); showToast('📥 Exported', 'success');
}

// ==========================================
// DEPOSITS – commission total excludes hold orders
// ==========================================
async function loadDeposits() {
    try {
        const snap = await db.ref('deposits').once('value');
        const data = snap.val() || {};
        allDeposits = Object.entries(data).map(([id, item]) => ({ id, ...item }));
        allDeposits.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyDepositFilters();
        updateDepositStats();
    } catch (e) {
        console.error('Load deposits error:', e);
        showToast('Error loading deposits', 'error');
    }
}

function applyDepositFilters() {
    let filtered = [...allDeposits];
    const dateFrom = document.getElementById('depositDateFrom').value;
    const dateTo = document.getElementById('depositDateTo').value;
    if (dateFrom) {
        filtered = filtered.filter(item => {
            if (!item.date) return false;
            return item.date >= dateFrom;
        });
    }
    if (dateTo) {
        filtered = filtered.filter(item => {
            if (!item.date) return false;
            return item.date <= dateTo;
        });
    }
    filteredDeposits = filtered;
    depositCurrentPage = 1;
    renderDepositsTable();
}

function applyDepositDateFilter() {
    applyDepositFilters();
}

function clearDepositDateFilter() {
    document.getElementById('depositDateFrom').value = '';
    document.getElementById('depositDateTo').value = '';
    applyDepositFilters();
    showToast('Date filters cleared', 'info');
}

async function updateDepositStats() {
    let total = 0;
    allDeposits.forEach(d => { total += d.amount || 0; });
    document.getElementById('depositTotal').textContent = '₹' + total;
    document.getElementById('depositCount').textContent = allDeposits.length;
    document.getElementById('depositCountDisplay').textContent = allDeposits.length + ' entries';
    document.getElementById('depositsBadge').textContent = allDeposits.length;

    // Calculate stock value from inventory (already excludes hold)
    let stockValue = 0;
    const snap = await db.ref('pickups').once('value');
    const data = snap.val() || {};
    Object.values(data).forEach(item => {
        if (item.status === 'pickup' && !item.sold) {
            stockValue += item.value || 0;
        }
    });
    document.getElementById('depositStockValue').textContent = '₹' + stockValue;
    const balance = total - stockValue;
    document.getElementById('depositBalance').textContent = '₹' + balance;

    // Calculate total commission – exclude hold orders
    let totalCommission = 0;
    Object.values(data).forEach(item => {
        if (item.sold && item.status !== 'on_hold') {
            totalCommission += item.commission || calculateCommission(item.salePrice || 0);
        }
    });
    document.getElementById('depositCommission').textContent = '₹' + totalCommission;
}

function renderDepositsTable() {
    const tbody = document.getElementById('depositsTableBody');
    const total = filteredDeposits.length;
    const totalPages = Math.ceil(total / depositPageSize) || 1;
    if (depositCurrentPage > totalPages) depositCurrentPage = totalPages;
    const start = (depositCurrentPage - 1) * depositPageSize;
    const end = Math.min(start + depositPageSize, total);
    const pageItems = filteredDeposits.slice(start, end);

    document.getElementById('depositCountDisplay').textContent = total + ' entries';
    document.getElementById('depositPageInfo').textContent = `${depositCurrentPage} / ${totalPages}`;
    document.getElementById('prevDepositPageBtn').disabled = depositCurrentPage <= 1;
    document.getElementById('nextDepositPageBtn').disabled = depositCurrentPage >= totalPages;

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No deposits found</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    pageItems.forEach((item, idx) => {
        const num = start + idx + 1;
        const amount = item.amount || 0;
        const description = item.description || '—';
        const date = item.date || '—';
        const addedOn = item.timestamp ? new Date(item.timestamp).toLocaleString() : '—';

        html += `<tr class="order-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td>
            <td class="py-3 px-4 font-bold text-green-600">₹${amount}</td>
            <td class="py-3 px-4 text-gray-600 text-sm">${description}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-500">${date}</td>
            <td class="py-3 px-4 hidden md:table-cell text-xs text-gray-400">${addedOn}</td>
            <td class="py-3 px-4">
                <button onclick="deleteDeposit('${item.id}')" class="btn-action delete" title="Delete"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function prevDepositPage() {
    if (depositCurrentPage > 1) { depositCurrentPage--; renderDepositsTable(); }
}
function nextDepositPage() {
    const totalPages = Math.ceil(filteredDeposits.length / depositPageSize);
    if (depositCurrentPage < totalPages) { depositCurrentPage++; renderDepositsTable(); }
}

function submitDeposit(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('depositAmount').value);
    const date = document.getElementById('depositDate').value || new Date().toISOString().split('T')[0];
    const description = document.getElementById('depositDescription').value.trim();

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    const depositData = {
        amount,
        date,
        description: description || '',
        timestamp: Date.now()
    };

    Swal.fire({
        title: 'Add Deposit?',
        text: `Amount: ₹${amount} | Date: ${date}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Add',
        cancelButtonText: 'Cancel'
    }).then(async (result) => {
        if (!result.isConfirmed) return;
        try {
            const newRef = db.ref('deposits').push();
            await newRef.set(depositData);
            showToast('✅ Deposit added successfully!', 'success');
            document.getElementById('depositAmount').value = '';
            document.getElementById('depositDescription').value = '';
            document.getElementById('depositDate').value = new Date().toISOString().split('T')[0];
            loadDeposits();
            loadDashboard();
        } catch (e) {
            console.error('Add deposit error:', e);
            showToast('Error adding deposit', 'error');
        }
    });
}

async function deleteDeposit(depositId) {
    const confirm = await Swal.fire({
        title: 'Delete Deposit?',
        text: 'This action cannot be undone.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        await db.ref('deposits/' + depositId).remove();
        showToast('🗑️ Deposit deleted', 'success');
        loadDeposits();
        loadDashboard();
    } catch (e) {
        showToast('Error deleting deposit', 'error');
        console.error(e);
    }
}

function exportDepositsCSV() {
    if (filteredDeposits.length === 0) {
        showToast('No deposits to export', 'error');
        return;
    }
    const headers = ['Amount', 'Description', 'Date', 'Added On'];
    const rows = filteredDeposits.map(item => {
        return [
            item.amount || 0,
            item.description || '—',
            item.date || '—',
            item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'
        ];
    });
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `deposits_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast('📥 Deposits CSV exported', 'success');
}

function refreshDeposits() {
    loadDeposits();
    showToast('🔄 Deposits refreshed', 'info');
}

// ==========================================
// AGENTS (with Role & Promotion)
// ==========================================
async function loadAgents() {
    try {
        const snap = await db.ref('users').once('value');
        const data = snap.val() || {};
        agentsList = Object.entries(data).map(([username, item]) => {
            if (!item.role) item.role = 'agent';
            return { username, ...item };
        });
        agentsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        renderAgentsTable();
        document.getElementById('agentsBadge').textContent = agentsList.filter(u => u.role === 'agent').length;
        loadAgentsForFilter();
    } catch (e) { console.error(e); showToast('Error loading agents', 'error'); }
}

function renderAgentsTable() {
    const tbody = document.getElementById('agentsTableBody');
    if (agentsList.length === 0) { tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No users</p></div></td></tr>`; lucide.createIcons(); return; }
    let html = '';
    agentsList.forEach((item, idx) => {
        const pw = item.password || '****';
        const showPw = passwordVisible[item.username] || false;
        const pwDisplay = showPw ? pw : '••••••••';
        const salary = item.role === 'agent' ? (item.salary || 0) : '—';
        const pickupInc = item.role === 'agent' ? (item.pickup_incentive || 0) : '—';
        const rejectInc = item.role === 'agent' ? (item.reject_incentive || 0) : '—';
        const roleDisplay = item.role === 'admin' ? '<span class="admin-tag">Admin</span>' : 'Agent';
        const isAgent = item.role === 'agent';
        const promoteBtn = isAgent ? `<button onclick="promoteToAdmin('${item.username}')" class="btn-action promote" title="Promote to Admin"><i data-lucide="user-cog"></i> Promote</button>` : '';
        html += `<tr class="user-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td>
            <td class="py-3 px-4 font-medium text-gray-800">${item.name || '—'}</td>
            <td class="py-3 px-4 font-mono text-sm text-gray-700">${item.username}</td>
            <td class="py-3 px-4 hidden sm:table-cell">${roleDisplay}</td>
            <td class="py-3 px-4 hidden sm:table-cell font-bold">${typeof salary === 'number' ? '₹'+salary : salary}</td>
            <td class="py-3 px-4 hidden md:table-cell">${typeof pickupInc === 'number' ? '₹'+pickupInc : pickupInc}</td>
            <td class="py-3 px-4 hidden lg:table-cell">${typeof rejectInc === 'number' ? '₹'+rejectInc : rejectInc}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-gray-600">${item.mobile || '—'}</td>
            <td class="py-3 px-4 font-mono"><span class="pw-hidden">${pwDisplay}</span><button onclick="togglePassword('${item.username}')" class="btn-action show ml-1"><i data-lucide="${showPw ? 'eye-off' : 'eye'}"></i></button></td>
            <td class="py-3 px-4">
                <div class="promote-btn-wrap">
                    ${promoteBtn}
                    <button onclick="viewAgentActivity('${item.username}')" class="btn-action activity"><i data-lucide="activity"></i></button>
                    <button onclick="showChangePasswordModal('${item.username}')" class="btn-action edit"><i data-lucide="key"></i></button>
                    <button onclick="forceLogout('${item.username}')" class="btn-action logout"><i data-lucide="log-out"></i></button>
                    <button onclick="deleteAgent('${item.username}')" class="btn-action delete"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;
    document.getElementById('agentsCount').textContent = agentsList.length + ' users';
    lucide.createIcons();
}

// ==========================================
// PROMOTE TO ADMIN
// ==========================================
async function promoteToAdmin(username) {
    const confirm = await Swal.fire({
        title: `Promote "${username}" to Admin?`,
        text: 'This will remove salary/incentive fields and the user will be treated as an admin (no attendance, no salary).',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#5b21b6',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Promote',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        await db.ref('users/' + username).update({
            role: 'admin',
            salary: null,
            pickup_incentive: null,
            reject_incentive: null
        });
        showToast(`✅ ${username} is now an admin`, 'success');
        loadAgents();
        loadDashboard();
    } catch (e) {
        showToast('Error promoting user', 'error');
        console.error(e);
    }
}

async function forceLogout(username) {
    const result = await Swal.fire({ title: `Force Logout "${username}"?`, text: 'Immediately log out the user.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Yes', cancelButtonText: 'Cancel' });
    if (!result.isConfirmed) return;
    try { await db.ref('users/' + username + '/forceLogout').set(true); showToast('✅ Force logout sent', 'success'); } catch (e) { showToast('Error', 'error'); console.error(e); }
}

function togglePassword(username) { passwordVisible[username] = !passwordVisible[username]; renderAgentsTable(); }

async function deleteAgent(username) {
    const result = await Swal.fire({ title: 'Delete User?', text: `Delete "${username}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Yes', cancelButtonText: 'Cancel' });
    if (!result.isConfirmed) return;
    try { await db.ref('users/' + username).remove(); showToast('✅ Deleted', 'success'); loadAgents(); } catch (e) { showToast('Error', 'error'); console.error(e); }
}

function registerAgent(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const aadhar = document.getElementById('regAadhar').value.trim();
    const alternate = document.getElementById('regAlternate').value.trim();
    const role = document.querySelector('input[name="regRole"]:checked').value;
    const salary = parseFloat(document.getElementById('regSalary').value.trim()) || 0;
    const pickupIncentive = parseFloat(document.getElementById('regPickupIncentive').value.trim()) || 0;
    const rejectIncentive = parseFloat(document.getElementById('regRejectIncentive').value.trim()) || 0;
    const errorEl = document.getElementById('agentError');
    const successEl = document.getElementById('agentSuccess');
    errorEl.style.display = 'none'; successEl.style.display = 'none';

    if (!name || !username || !password || !mobile) {
        errorEl.textContent = 'Please fill Name, Username, Password, and Mobile.';
        errorEl.style.display = 'block'; return;
    }
    if (username.length < 3 || password.length < 4 || mobile.length < 10) {
        errorEl.textContent = 'Username (3+), Password (4+), Mobile (10 digits).';
        errorEl.style.display = 'block'; return;
    }
    if (role === 'agent' && (!salary || !pickupIncentive || !rejectIncentive)) {
        errorEl.textContent = 'For Agent, Salary, Pickup Incentive and Reject Incentive are required.';
        errorEl.style.display = 'block'; return;
    }

    const userData = {
        name, username, password, aadhar: aadhar || '', mobile, alternate: alternate || '',
        role: role,
        createdAt: Date.now()
    };
    if (role === 'agent') {
        userData.salary = salary;
        userData.pickup_incentive = pickupIncentive;
        userData.reject_incentive = rejectIncentive;
    }

    db.ref('users/' + username).once('value').then(snap => {
        if (snap.exists()) { errorEl.textContent = 'Username taken.'; errorEl.style.display = 'block'; return; }
        return db.ref('users/' + username).set(userData);
    }).then(() => {
        successEl.textContent = '✅ User registered!';
        successEl.style.display = 'block';
        document.getElementById('regName').value = '';
        document.getElementById('regUsername').value = '';
        document.getElementById('regPassword').value = '';
        document.getElementById('regMobile').value = '';
        document.getElementById('regAadhar').value = '';
        document.getElementById('regAlternate').value = '';
        document.getElementById('regSalary').value = '';
        document.getElementById('regPickupIncentive').value = '';
        document.getElementById('regRejectIncentive').value = '';
        loadAgents();
        setTimeout(() => { successEl.style.display = 'none'; }, 5000);
    }).catch(err => { console.error(err); errorEl.textContent = 'Something went wrong.'; errorEl.style.display = 'block'; });
}

function toggleAdminFields() {
    const role = document.querySelector('input[name="regRole"]:checked').value;
    const agentFields = document.getElementById('agentFields');
    if (role === 'admin') {
        agentFields.style.display = 'none';
        document.getElementById('regSalary').removeAttribute('required');
        document.getElementById('regPickupIncentive').removeAttribute('required');
        document.getElementById('regRejectIncentive').removeAttribute('required');
    } else {
        agentFields.style.display = 'grid';
        document.getElementById('regSalary').setAttribute('required', '');
        document.getElementById('regPickupIncentive').setAttribute('required', '');
        document.getElementById('regRejectIncentive').setAttribute('required', '');
    }
}

function showChangePasswordModal(username) {
    Swal.fire({ title: `Change Password for "${username}"`, html: `<input type="password" id="newPassword" class="swal2-input" placeholder="New password" minlength="4"><input type="password" id="confirmPassword" class="swal2-input" placeholder="Confirm" minlength="4">`, showCancelButton: true, confirmButtonText: 'Update', cancelButtonText: 'Cancel', confirmButtonColor: '#4f46e5', preConfirm: () => { const newPw = document.getElementById('newPassword').value; const confirmPw = document.getElementById('confirmPassword').value; if (!newPw || newPw.length < 4) { Swal.showValidationMessage('Min 4 chars'); return false; } if (newPw !== confirmPw) { Swal.showValidationMessage('No match'); return false; } return newPw; } }).then(async (result) => { if (result.isConfirmed) { try { await db.ref('users/' + username + '/password').set(result.value); showToast('✅ Password updated', 'success'); loadAgents(); } catch (e) { showToast('Error', 'error'); console.error(e); } } });
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
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span> Loading...</div>`;
    db.ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        const orders = Object.entries(data).filter(([_, item]) => item.agent === username).map(([id, item]) => ({ id, ...item }));
        orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (orders.length === 0) { content.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity</p></div>`; lucide.createIcons(); return; }
        let html = `<div class="space-y-2">`;
        orders.forEach(item => {
            const statusLabel = item.status || 'unknown';
            const statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') : statusLabel === 'rejected' ? 'rejected' : statusLabel === 'on_hold' ? 'on_hold' : 'reschedule';
            const displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : statusLabel === 'rejected' ? 'Rejected' : statusLabel === 'on_hold' ? 'Hold' : 'Pending';
            const time = item.timestampIST || item.timestamp || '';
            const model = item.phoneModel || '—';
            const value = item.value !== undefined ? '₹' + item.value : '—';
            html += `<div class="activity-item flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 cursor-pointer" onclick="viewOrder('${item.id}')"><div class="flex items-center gap-3"><span class="badge-status ${statusClass}">${displayName}</span><span class="font-mono font-bold text-gray-700 text-sm">${item.orderId || item.id}</span><span class="text-xs text-gray-400 hidden sm:inline">${model}</span><span class="text-xs text-gray-400 hidden md:inline">${value}</span></div><div class="flex items-center gap-2"><span class="text-[10px] text-gray-400">${time}</span><span class="text-xs text-gray-500 italic">${item.reason || '—'}</span></div></div>`;
        });
        html += `</div>`;
        content.innerHTML = html;
        lucide.createIcons();
    }).catch(err => { content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error</p></div>`; showToast('Error', 'error'); });
}
function closeActivityModal() { document.getElementById('activityModal').style.display = 'none'; }

// ==========================================
// ATTENDANCE SYSTEM (skip admins)
// ==========================================
async function generateOTPs() {
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val() || {};
    const today = new Date().toISOString().split('T')[0];
    const agents = Object.keys(users).filter(uname => {
        const u = users[uname];
        const role = u.role || 'agent';
        return role === 'agent';
    });
    if (agents.length === 0) { showToast('No agents to generate OTP for', 'error'); return; }
    const confirm = await Swal.fire({ title: 'Generate OTPs?', text: `Generate OTP for ${agents.length} agents for ${today}?`, icon: 'question', showCancelButton: true, confirmButtonColor: '#059669', cancelButtonColor: '#64748b', confirmButtonText: 'Generate', cancelButtonText: 'Cancel' });
    if (!confirm.isConfirmed) return;
    try {
        const updates = {};
        for (const uname of agents) {
            const otp = String(Math.floor(100000 + Math.random() * 900000));
            updates[`daily_otp/${today}/${uname}`] = { otp, generated_at: Date.now() };
        }
        await db.ref().update(updates);
        showToast(`✅ OTPs generated for ${agents.length} agents`, 'success');
        loadAttendance();
    } catch (e) { showToast('Error generating OTPs', 'error'); console.error(e); }
}

async function loadAttendance() {
    const dateInput = document.getElementById('attendanceDate');
    if (!dateInput.value) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }
    const date = dateInput.value;
    const container = document.getElementById('attendanceList');
    container.innerHTML = `<div class="text-center py-4"><span class="spinner-sm"></span></div>`;
    try {
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val() || {};
        const agents = Object.fromEntries(Object.entries(users).filter(([_, u]) => (u.role || 'agent') === 'agent'));
        if (Object.keys(agents).length === 0) { container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No agents registered</p></div>`; return; }
        let html = `<div class="space-y-3"><div class="text-sm font-bold text-gray-600 mb-2">📅 ${date}</div>`;
        for (const [uname, uData] of Object.entries(agents)) {
            const attSnap = await db.ref('attendance/' + uname + '/' + date).once('value');
            const att = attSnap.val() || {};
            const otpSnap = await db.ref('daily_otp/' + date + '/' + uname).once('value');
            const otpData = otpSnap.val() || {};
            const isBlocked = att.blocked === true || uData.is_blocked === true;
            const status = att.status || 'Not Marked';
            let statusHtml = `<span class="text-gray-400">Not Marked</span>`;
            if (status === 'present') statusHtml = `<span class="attendance-present">✅ Present</span>`;
            else if (status === 'absent' && isBlocked) statusHtml = `<span class="attendance-blocked">🚫 Blocked</span>`;
            else if (status === 'absent') statusHtml = `<span class="attendance-absent">❌ Absent (Not Blocked)</span>`;
            const otp = otpData.otp || '—';
            html += `<div class="attendance-card glass rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <div><span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAttendanceHistory('${uname}')">${uData.name}</span> <span class="text-xs text-gray-500">(${uname})</span><br><span class="text-xs">OTP: <strong class="otp-display text-sm">${otp}</strong></span></div>
                <div class="text-sm">${statusHtml}</div>
                <div class="flex items-center gap-2 flex-wrap">
                    ${att.status === 'absent' && isBlocked ? `<button onclick="unblockAgent('${uname}','${date}')" class="btn-action unblock"><i data-lucide="unlock"></i> Unblock</button>` : ''}
                    ${att.status === 'absent' && !isBlocked ? `<button onclick="blockAgent('${uname}','${date}')" class="btn-action delete"><i data-lucide="lock"></i> Block</button>` : ''}
                    ${!att.status || att.status === 'Not Marked' ? `<button onclick="markPresentManually('${uname}','${date}')" class="btn-action approve"><i data-lucide="check"></i> Mark Present</button>` : ''}
                </div>
            </div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
        lucide.createIcons();
    } catch (e) { console.error(e); container.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm text-red-500">Error loading</p></div>`; showToast('Error loading attendance', 'error'); }
}

async function viewAttendanceHistory(username) {
    const monthInput = document.getElementById('salaryMonth');
    let monthVal = monthInput ? monthInput.value : '';
    if (!monthVal) {
        const today = new Date();
        monthVal = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    }
    const [year, month] = monthVal.split('-').map(Number);
    const monthStr = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();

    try {
        const userSnap = await db.ref('users/' + username).once('value');
        const userData = userSnap.val();
        if (!userData) { showToast('User not found', 'error'); return; }

        const attSnap = await db.ref('attendance/' + username).once('value');
        const allAtt = attSnap.val() || {};

        let rows = '';
        let presentCount = 0, absentCount = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
            const att = allAtt[dateStr] || {};
            const status = att.status || 'Not Marked';
            let statusDisplay = status;
            let statusClass = 'text-gray-400';
            if (status === 'present') {
                statusDisplay = '✅ Present';
                statusClass = 'text-green-600';
                presentCount++;
            } else if (status === 'absent') {
                statusDisplay = '❌ Absent';
                statusClass = 'text-red-600';
                absentCount++;
            } else {
                statusDisplay = '—';
            }
            const markedBy = att.marked_by || '—';
            const markedDisplay = markedBy === 'admin' ? 'Admin' : (markedBy === 'otp' ? 'OTP' : '—');
            rows += `<tr class="border-b border-gray-100">
                <td class="py-2 px-3 text-sm">${dateStr}</td>
                <td class="py-2 px-3 text-sm ${statusClass}">${statusDisplay}</td>
                <td class="py-2 px-3 text-sm text-gray-500">${markedDisplay}</td>
            </tr>`;
        }

        const total = daysInMonth;
        const presentPercent = total > 0 ? Math.round((presentCount / total) * 100) : 0;

        const html = `
            <div class="text-left">
                <p class="font-bold text-lg">${userData.name} (${username})</p>
                <p class="text-sm text-gray-500 mb-2">Attendance for ${monthVal}</p>
                <div class="flex gap-4 mb-3 text-sm">
                    <span>✅ Present: <strong>${presentCount}</strong></span>
                    <span>❌ Absent: <strong>${absentCount}</strong></span>
                    <span>📊 ${presentPercent}%</span>
                </div>
                <div class="max-h-[400px] overflow-y-auto border rounded-lg">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 sticky top-0">
                            <tr>
                                <th class="py-2 px-3 text-left font-bold text-gray-500">Date</th>
                                <th class="py-2 px-3 text-left font-bold text-gray-500">Status</th>
                                <th class="py-2 px-3 text-left font-bold text-gray-500">Marked By</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;

        await Swal.fire({
            title: 'Attendance History',
            html: html,
            icon: 'info',
            confirmButtonColor: '#4f46e5',
            confirmButtonText: 'Close',
            width: 600,
        });
    } catch (e) {
        console.error(e);
        showToast('Error loading history', 'error');
    }
}

async function markPresentManually(username, date) {
    const confirm = await Swal.fire({ title: `Mark ${username} Present?`, text: `Mark attendance for ${username} on ${date}?`, icon: 'question', showCancelButton: true, confirmButtonColor: '#059669', cancelButtonColor: '#64748b', confirmButtonText: 'Yes', cancelButtonText: 'Cancel' });
    if (!confirm.isConfirmed) return;
    try {
        await db.ref('attendance/' + username + '/' + date).set({
            status: 'present',
            timestamp: Date.now(),
            blocked: false,
            salary_counted: true,
            marked_by: 'admin'
        });
        showToast('✅ Marked present (by admin)', 'success');
        loadAttendance();
        loadDashboard();
    } catch (e) { showToast('Error', 'error'); console.error(e); }
}

async function unblockAgent(username, date) {
    const result = await Swal.fire({
        title: `Unblock ${username}?`,
        text: 'Do you want to count salary for this day? If NO, the day salary will be deducted.',
        icon: 'question',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Yes, Count Salary',
        denyButtonText: 'No, Don\'t Count',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#059669',
        denyButtonColor: '#dc2626'
    });
    if (result.isDismissed) return;
    const countSalary = result.isConfirmed;
    try {
        await db.ref('users/' + username + '/is_blocked').set(false);
        await db.ref('attendance/' + username + '/' + date).update({
            blocked: false,
            salary_counted: countSalary,
            marked_by: 'admin'
        });
        if (!countSalary) {
            showToast(`✅ Unblocked. Salary counted: No`, 'success');
        } else {
            showToast(`✅ Unblocked. Salary will be counted.`, 'success');
        }
        loadAttendance();
        loadDashboard();
    } catch (e) { showToast('Error unblocking', 'error'); console.error(e); }
}

async function blockAgent(username, date) {
    const confirm = await Swal.fire({ title: 'Block Agent?', text: `Block ${username} for ${date}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Block', cancelButtonText: 'Cancel' });
    if (!confirm.isConfirmed) return;
    try {
        await db.ref('users/' + username + '/is_blocked').set(true);
        await db.ref('attendance/' + username + '/' + date).update({
            status: 'absent',
            blocked: true,
            reason: 'Manually blocked by admin',
            marked_by: 'admin'
        });
        showToast('🔒 Agent blocked', 'success');
        loadAttendance();
        loadDashboard();
    } catch (e) { showToast('Error blocking', 'error'); console.error(e); }
}

// ==========================================
// SALARY / EARNINGS – hold orders skipped
// ==========================================
function setSalaryMode(mode) {
    currentSalaryMode = mode;
    document.getElementById('salaryModeToday').classList.toggle('active', mode === 'today');
    document.getElementById('salaryModeMonthly').classList.toggle('active', mode === 'monthly');
    document.getElementById('salaryMonthWrapper').style.display = mode === 'monthly' ? 'inline-block' : 'none';
    const label = document.getElementById('salaryModeLabel');
    if (mode === 'today') {
        label.textContent = "Today's Earnings";
    } else {
        const monthVal = document.getElementById('salaryMonth').value || 'current month';
        label.textContent = `Earnings for ${monthVal}`;
    }
    loadSalaryData();
}

async function loadSalaryData() {
    const mode = currentSalaryMode || 'today';
    const container = document.getElementById('salaryContainer');
    container.innerHTML = `<div class="text-center py-4"><span class="spinner-sm"></span> Calculating...</div>`;

    try {
        const [usersSnap, pickupsSnap, attendanceSnap] = await Promise.all([
            db.ref('users').once('value'),
            db.ref('pickups').once('value'),
            db.ref('attendance').once('value')
        ]);

        const users = usersSnap.val() || {};
        const agents = Object.fromEntries(Object.entries(users).filter(([_, u]) => (u.role || 'agent') === 'agent'));
        const pickups = pickupsSnap.val() || {};
        const allAttendance = attendanceSnap.val() || {};

        if (Object.keys(agents).length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No agents</p></div>`;
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        let year, month, monthStr, daysInMonth;
        let dateFilterFn;

        if (mode === 'today') {
            year = parseInt(today.split('-')[0]);
            month = parseInt(today.split('-')[1]);
            monthStr = String(month).padStart(2, '0');
            daysInMonth = 1;
            dateFilterFn = (ordDate) => ordDate === today;
        } else {
            const monthInput = document.getElementById('salaryMonth');
            if (!monthInput.value) {
                const d = new Date();
                monthInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            }
            const [y, m] = monthInput.value.split('-').map(Number);
            year = y;
            month = m;
            monthStr = String(month).padStart(2, '0');
            daysInMonth = new Date(year, month, 0).getDate();
            dateFilterFn = (ordDate) => ordDate.startsWith(`${year}-${monthStr}`);
        }

        const pickupsByAgentDate = {};
        const allRejectedOrders = [];

        for (const [oid, ord] of Object.entries(pickups)) {
            if (!ord.timestamp) continue;
            // Skip hold orders entirely
            if (ord.status === 'on_hold') continue;

            const ordDate = new Date(ord.timestamp).toISOString().split('T')[0];
            if (!dateFilterFn(ordDate)) continue;
            const agent = ord.agent || 'unknown';
            if (!agents[agent]) continue;
            const key = agent + '|' + ordDate;
            if (!pickupsByAgentDate[key]) pickupsByAgentDate[key] = [];
            pickupsByAgentDate[key].push(ord);
            if (ord.status === 'rejected' && !ord.incentive_approved) {
                allRejectedOrders.push({ id: oid, ...ord });
            }
        }

        let html = '';
        let grandTotal = 0;

        for (const [uname, uData] of Object.entries(agents)) {
            const salary = uData.salary || 0;
            const pickupInc = uData.pickup_incentive || 0;
            const rejectInc = uData.reject_incentive || 0;
            const perDaySalary = salary / 30;

            let totalBaseSalary = 0;
            let totalPickupIncentive = 0;
            let totalRejectIncentive = 0;
            let detailsHtml = '';
            let pendingRejects = [];

            const userAttendance = allAttendance[uname] || {};

            const loopDays = mode === 'today' ? [new Date().getDate()] : Array.from({ length: daysInMonth }, (_, i) => i + 1);
            for (const d of loopDays) {
                const dateStr = mode === 'today' ? today : `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
                const att = userAttendance[dateStr] || {};
                const isPresent = att.status === 'present';
                const salaryCounted = att.salary_counted !== false;

                let daySalary = 0;
                if (isPresent && salaryCounted) daySalary = perDaySalary;
                else daySalary = 0;
                totalBaseSalary += daySalary;

                const key = uname + '|' + dateStr;
                const dayPickups = pickupsByAgentDate[key] || [];

                let dayPickupInc = 0, dayRejectInc = 0;
                for (const ord of dayPickups) {
                    if (ord.status === 'pickup') {
                        dayPickupInc += pickupInc;
                    }
                    if (ord.status === 'rejected' && ord.incentive_approved === true) {
                        dayRejectInc += rejectInc;
                    }
                    if (ord.status === 'rejected' && ord.incentive_approved !== true) {
                        pendingRejects.push({ id: ord.orderId || ord.id, ...ord });
                    }
                }
                totalPickupIncentive += dayPickupInc;
                totalRejectIncentive += dayRejectInc;

                if (isPresent || att.status === 'absent') {
                    const statusIcon = isPresent ? '✅' : (att.blocked ? '🔒' : '❌');
                    detailsHtml += `<span class="text-xs mx-0.5" title="${dateStr}">${statusIcon}</span>`;
                }
            }

            const uniquePending = [];
            const seen = new Set();
            for (const pr of pendingRejects) {
                if (!seen.has(pr.id)) {
                    seen.add(pr.id);
                    uniquePending.push(pr);
                }
            }

            const total = totalBaseSalary + totalPickupIncentive + totalRejectIncentive;
            grandTotal += total;

            let pendingRejectsHtml = '';
            if (uniquePending.length > 0) {
                pendingRejectsHtml = `<div class="mt-2 pt-2 border-t border-gray-200">
                    <p class="text-xs font-bold text-amber-600">⏳ Pending Reject Approvals (${uniquePending.length})</p>
                    <div class="flex flex-wrap gap-1 mt-1">`;
                uniquePending.forEach(pr => {
                    pendingRejectsHtml += `<span class="text-xs bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                        ${pr.orderId || pr.id}
                        <button onclick="approveRejectFromSalary('${pr.id}')" class="text-green-600 hover:text-green-800 font-bold text-xs">✅</button>
                    </span>`;
                });
                pendingRejectsHtml += `</div></div>`;
            }

            html += `<div class="glass rounded-2xl p-5 shadow-sm border border-gray-100 salary-summary-card">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div><span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAttendanceHistory('${uname}')">${uData.name}</span> <span class="text-sm text-gray-500">(${uname})</span></div>
                    <div class="text-sm font-bold text-indigo-600">₹${Math.round(total)}</div>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-sm">
                    <div class="bg-gray-50 p-2 rounded"><span class="text-gray-500">Base Salary</span><br><span class="font-bold">₹${Math.round(totalBaseSalary)}</span></div>
                    <div class="bg-green-50 p-2 rounded"><span class="text-gray-500">Pickup Inc.</span><br><span class="font-bold text-green-700">₹${Math.round(totalPickupIncentive)}</span></div>
                    <div class="bg-amber-50 p-2 rounded"><span class="text-gray-500">Reject Inc.</span><br><span class="font-bold text-amber-700">₹${Math.round(totalRejectIncentive)}</span></div>
                </div>
                <div class="mt-2 text-xs text-gray-400">Attendance: ${detailsHtml}</div>
                ${pendingRejectsHtml}
            </div>`;
        }

        const uniqueAllPending = [];
        const seenAll = new Set();
        for (const pr of allRejectedOrders) {
            if (!seenAll.has(pr.id)) {
                seenAll.add(pr.id);
                uniqueAllPending.push(pr);
            }
        }

        if (uniqueAllPending.length > 0) {
            html += `<div class="glass rounded-2xl p-5 shadow-sm border border-amber-200 bg-amber-50">
                <h4 class="font-bold text-amber-700 mb-2">📋 All Pending Reject Approvals (${uniqueAllPending.length})</h4>
                <div class="flex flex-wrap gap-2">`;
            uniqueAllPending.forEach(pr => {
                html += `<span class="text-sm bg-white px-3 py-1 rounded shadow flex items-center gap-2">
                    <span class="font-mono">${pr.orderId || pr.id}</span>
                    <span class="text-xs text-gray-500">(${pr.agent || '—'})</span>
                    <button onclick="approveRejectFromSalary('${pr.id}')" class="btn-action approve text-xs py-0.5 px-2">
                        <i data-lucide="check-circle"></i> Approve
                    </button>
                </span>`;
            });
            html += `</div></div>`;
        }

        html += `<div class="text-right font-bold text-xl mt-4">Grand Total: ₹${Math.round(grandTotal)}</div>`;
        container.innerHTML = html;
        lucide.createIcons();

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm text-red-500">Error calculating salary</p></div>`;
        showToast('Error calculating salary', 'error');
    }
}

async function approveRejectFromSalary(orderId) {
    const confirm = await Swal.fire({
        title: 'Approve Rejection?',
        text: 'This will count the reject incentive for the agent.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, approve',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        const snap = await db.ref('pickups/' + orderId).once('value');
        const item = snap.val();
        if (!item) { showToast('Order not found', 'error'); return; }
        await db.ref('pickups/' + orderId + '/incentive_approved').set(true);
        await db.ref('pickups/' + orderId + '/incentive_paid').set(false);
        showToast('✅ Reject approved! Incentive will be counted.', 'success');
        loadRejectedAdmin();
        loadDashboard();
        loadSalaryData();
    } catch (e) {
        showToast('Error approving reject', 'error');
        console.error(e);
    }
}

async function recalculateAllSalary() {
    showToast('🔄 Recalculating...', 'info');
    await loadSalaryData();
}

// ==========================================
// REFRESH ALL
// ==========================================
function refreshAll() {
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing...', 'info');
    Promise.all([loadDashboard(), loadOrders(), loadPendingAdmin(), loadRejectedAdmin(), loadInventory(), loadSales(), loadDeposits(), loadAgents()]).then(() => { isRefreshing = false; showToast('✅ Refreshed', 'success'); }).catch(() => { isRefreshing = false; showToast('⚠️ Error', 'error'); });
}

// ==========================================
// LIVE CLOCK
// ==========================================
function updateClock() { const now = new Date(); document.getElementById('liveTime').textContent = now.toTimeString().slice(0,8); }
setInterval(updateClock, 1000); updateClock();

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    loadDashboard(); loadOrders(); loadPendingAdmin(); loadRejectedAdmin(); loadInventory(); loadSales(); loadDeposits(); loadAgents();
    document.getElementById('attendanceDate').value = new Date().toISOString().split('T')[0];
    const today = new Date();
    document.getElementById('salaryMonth').value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    document.getElementById('depositDate').value = today.toISOString().split('T')[0];
    document.querySelector('input[name="regRole"][value="agent"]').checked = true;
    toggleAdminFields();
    setSalaryMode('today');

    setInterval(() => {
        if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'orders') { loadOrders(); loadAgentsForFilter(); }
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
        else if (currentPageView === 'inventory') loadInventory();
        else if (currentPageView === 'sales') loadSales();
        else if (currentPageView === 'deposits') loadDeposits();
        else if (currentPageView === 'attendance') loadAttendance();
        else if (currentPageView === 'salary') loadSalaryData();
        else if (currentPageView === 'agents') loadAgents();
    }, 60000);
    showToast('👋 Welcome', 'info', 2000);
});

document.getElementById('detailModal').addEventListener('click', function(e) { if (e.target === this) closeDetail(); });
document.getElementById('sellModal').addEventListener('click', function(e) { if (e.target === this) closeSellModal(); });
document.getElementById('activityModal').addEventListener('click', function(e) { if (e.target === this) closeActivityModal(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeDetail(); closeSellModal(); closeActivityModal(); closeSidebar(); } });
setInterval(() => { lucide.createIcons(); }, 5000);