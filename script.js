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
    else if (page === 'orders') loadOrders();
    else if (page === 'pending') loadPendingAdmin();
    else if (page === 'rejected') loadRejectedAdmin();
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

        let total = 0,
            pickupCount = 0,
            rejectedCount = 0,
            rescheduleCount = 0;

        Object.values(pickups).forEach(item => {
            total++;
            if (item.status === 'pickup') pickupCount++;
            else if (item.status === 'rejected') rejectedCount++;
            else if (item.status === 'reschedule') rescheduleCount++;
        });

        const pendingCount = Object.keys(pending).length;

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statPickup').textContent = pickupCount;
        document.getElementById('statRejected').textContent = rejectedCount;
        document.getElementById('statPending').textContent = pendingCount;

        document.getElementById('orderCountBadge').textContent = total;
        document.getElementById('pendingBadge').textContent = pendingCount;
        document.getElementById('rejectedBadge').textContent = rejectedCount;

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
                const statusClass = statusLabel === 'pickup' ? 'pickup' :
                    statusLabel === 'rejected' ? 'rejected' : 'reschedule';
                const displayName = statusLabel === 'pickup' ? 'Pickup' :
                    statusLabel === 'rejected' ? 'Rejected' : 'Pending';
                const time = item.timestampIST || item.timestamp || '';
                const model = item.phoneModel || '—';
                html += `
                    <div class="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition cursor-pointer" onclick="viewOrder('${id}')">
                        <div class="flex items-center gap-3 min-w-0">
                            <span class="badge-status ${statusClass}">${displayName}</span>
                            <span class="font-mono font-bold text-gray-700 text-sm truncate">${id}</span>
                            <span class="text-xs text-gray-400 hidden sm:inline">${model}</span>
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
// ORDERS (with pagination)
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
    filteredOrders = filtered;
    currentPage = 1;
    renderOrdersTable();
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
            `<tr><td colspan="8"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No orders match</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    pageItems.forEach((item, idx) => {
        const num = start + idx + 1;
        const statusLabel = item.status || 'unknown';
        const statusClass = statusLabel === 'pickup' ? 'pickup' :
            statusLabel === 'rejected' ? 'rejected' : 'reschedule';
        const displayName = statusLabel === 'pickup' ? 'Pickup' :
            statusLabel === 'rejected' ? 'Rejected' : 'Pending';
        const model = item.phoneModel || '—';
        const imei = item.imei || '—';
        const value = item.value !== undefined && item.value !== null ? '₹' + item.value : '—';
        const customer = item.customerName || '—';

        html += `
            <tr class="order-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                <td class="py-3 px-4"><span class="badge-status ${statusClass}">${displayName}</span></td>
                <td class="py-3 px-4 hidden sm:table-cell text-gray-600 text-sm">${model}</td>
                <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${imei}</td>
                <td class="py-3 px-4 hidden lg:table-cell font-bold text-gray-700">${value}</td>
                <td class="py-3 px-4 hidden xl:table-cell text-gray-600 text-sm">${customer}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-1.5">
                        <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View Details">
                            <i data-lucide="eye"></i>
                        </button>
                        <button onclick="editOrderDirect('${item.id}')" class="btn-action edit" title="Edit">
                            <i data-lucide="pencil"></i>
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
    lucide.createIcons();
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
                html += `
                    <div class="pending-item glass rounded-xl p-4 shadow-sm border border-gray-100">
                        <div class="flex items-start justify-between">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
                                    ${isOnWay ? '<span class="badge-onway">🚗 On the way</span>' : '<span class="badge-pending">⏳ Pending</span>'}
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
                html += `
                    <tr class="order-row border-b border-gray-50">
                        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                        <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                        <td class="py-3 px-4 text-gray-600 text-sm">${item.reason || '—'}</td>
                        <td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-400">${time}</td>
                        <td class="py-3 px-4">
                            <div class="flex items-center gap-1.5">
                                <button onclick="viewOrder('${item.id}')" class="btn-action view" title="View Details">
                                    <i data-lucide="eye"></i>
                                </button>
                                <button onclick="editOrderDirect('${item.id}')" class="btn-action edit" title="Edit">
                                    <i data-lucide="pencil"></i>
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

    // Show actions
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
        // Store data for edit
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
    const statusClass = statusLabel === 'pickup' ? 'pickup' :
        statusLabel === 'rejected' ? 'rejected' : 'reschedule';
    const displayName = statusLabel === 'pickup' ? 'Pickup Completed' :
        statusLabel === 'rejected' ? 'Rejected' : 'Pending';

    let html = `
        <div class="flex items-center gap-3 mb-4">
            <span class="badge-status ${statusClass} text-sm px-4 py-1.5">${displayName}</span>
            <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
        </div>
        <div class="detail-grid">
            <div class="detail-item"><div class="label">Phone Model</div><div class="value" id="dv-model">${item.phoneModel || '—'}</div></div>
            <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs" id="dv-imei">${item.imei || '—'}</div></div>
            ${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs" id="dv-imei2">${item.imei2}</div></div>` : ''}
            <div class="detail-item"><div class="label">Agreed Value</div><div class="value font-bold" id="dv-value">${item.value !== undefined && item.value !== null ? '₹' + item.value : '—'}</div></div>
            <div class="detail-item"><div class="label">Customer Name</div><div class="value" id="dv-customer">${item.customerName || '—'}</div></div>
            <div class="detail-item"><div class="label">Reason</div><div class="value" id="dv-reason">${item.reason || '—'}</div></div>
            <div class="detail-item"><div class="label">Status</div><div class="value" id="dv-status">${displayName}</div></div>
            <div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs" id="dv-time">${item.timestampIST || item.timestamp || '—'}</div></div>
        </div>
    `;
    content.innerHTML = html;
    lucide.createIcons();
    // Store current item for cancel
    editData = { ...item };
}

// ==========================================
// EDIT MODE
// ==========================================
function editOrderDirect(orderId) {
    // Open detail and immediately switch to edit
    viewOrder(orderId);
    setTimeout(() => toggleEditMode(), 300);
}

function toggleEditMode() {
    if (isEditMode) {
        // If already in edit, do nothing (or cancel)
        return;
    }
    isEditMode = true;
    document.getElementById('detailModalTitle').textContent = 'Edit Order';
    document.getElementById('detailActions').style.display = 'none';
    document.getElementById('detailSaveActions').style.display = 'flex';

    // Build editable form
    const content = document.getElementById('detailContent');
    const item = editData;

    // Convert timestamp to datetime-local value
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
                <label class="edit-label">Agreed Value (₹)</label>
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
        </div>
    `;
    content.innerHTML = html;
    lucide.createIcons();
}

function cancelEdit() {
    isEditMode = false;
    // Re-render view
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
    // Gather data from form
    const orderId = document.getElementById('edit-orderId').value.trim();
    const status = document.getElementById('edit-status').value;
    const model = document.getElementById('edit-model').value.trim();
    const imei = document.getElementById('edit-imei').value.trim();
    const imei2 = document.getElementById('edit-imei2').value.trim();
    const value = parseFloat(document.getElementById('edit-value').value) || 0;
    const customer = document.getElementById('edit-customer').value.trim();
    const reason = document.getElementById('edit-reason').value.trim();
    const datetimeVal = document.getElementById('edit-datetime').value;

    // Validate
    if (!orderId) {
        showToast('Order ID is required', 'error');
        return;
    }

    // Build updated data
    const updated = {
        orderId,
        status,
        phoneModel: model,
        imei,
        imei2: imei2 || undefined,
        value: value,
        customerName: customer || 'N/A',
        reason: reason || '',
        // Keep original timestampIST if datetime not changed, else update
        timestamp: editData.timestamp, // keep old ISO by default
        timestampIST: editData.timestampIST || '',
    };

    // Update timestamp if datetime changed
    if (datetimeVal) {
        const d = new Date(datetimeVal);
        if (!isNaN(d)) {
            updated.timestamp = d.toISOString();
            // Format IST
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
        // If no datetime provided, keep old
        updated.timestamp = editData.timestamp;
        updated.timestampIST = editData.timestampIST;
    }

    // Confirm with user
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
        // Refresh views
        if (currentPageView === 'orders') loadOrders();
        else if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
        // Re-render detail view
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
// DELETE ORDER
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
        // Also remove from pending if exists
        await db.ref('pending/' + orderId).remove();
        showToast('🗑️ Order deleted successfully', 'success');
        if (currentPageView === 'orders') loadOrders();
        else if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
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

// ==========================================
// DELETE PENDING (admin)
// ==========================================
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
// EXPORT CSV
// ==========================================
function exportCSV() {
    if (allOrders.length === 0) {
        showToast('No data to export', 'error');
        return;
    }

    const headers = ['Order ID', 'Status', 'Model', 'IMEI', 'IMEI2', 'Value', 'Customer', 'Reason', 'Time (IST)'];
    const rows = allOrders.map(item => [
        item.orderId || item.id || '',
        item.status || '',
        item.phoneModel || '',
        item.imei || '',
        item.imei2 || '',
        item.value !== undefined ? item.value : '',
        item.customerName || '',
        item.reason || '',
        item.timestampIST || item.timestamp || ''
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
    showToast('📥 CSV exported successfully', 'success');
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
        loadRejectedAdmin()
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
// CLOSE MODAL
// ==========================================
function closeDetail() {
    document.getElementById('detailModal').style.display = 'none';
    detailOrderId = null;
    isEditMode = false;
    document.getElementById('detailActions').style.display = 'flex';
    document.getElementById('detailSaveActions').style.display = 'none';
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    loadDashboard();
    loadOrders();
    loadPendingAdmin();
    loadRejectedAdmin();

    setInterval(() => {
        if (currentPageView === 'dashboard') loadDashboard();
        else if (currentPageView === 'orders') loadOrders();
        else if (currentPageView === 'pending') loadPendingAdmin();
        else if (currentPageView === 'rejected') loadRejectedAdmin();
    }, 60000);

    console.log('✅ Admin panel ready with edit capabilities');
    showToast('👋 Welcome to Admin Panel', 'info', 2000);
});

// Click outside modal to close
document.getElementById('detailModal').addEventListener('click', function(e) {
    if (e.target === this) closeDetail();
});

// ESC key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeDetail();
        closeSidebar();
    }
});

// Lucide icons refresh
setInterval(() => {
    lucide.createIcons();
}, 5000);