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

// ========== DOCUMENTS (Bill / Aadhaar) helpers ==========
function _escape(s) { return (s || '').replace(/'/g, "\\'"); }
const ADMIN_MAX_DOC_IMAGES = 3;

// Read a doc's images as a normalized array (handles legacy single-image field)
function getDocImages(item, which) {
    if (!item) return [];
    const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
    const legacy   = which === 'bill' ? 'billImage'  : 'aadhaarImage';
    const arr = Array.isArray(item[arrField]) ? item[arrField].slice() : [];
    if (arr.length === 0 && item[legacy]) arr.push(item[legacy]);
    return arr.filter(Boolean);
}

function _compressImageFileAdmin(file, maxDim = 720, quality = 0.4) {
    return new Promise((resolve, reject) => {
        if (!file) return reject('No file');
        if (!file.type.startsWith('image/')) return reject('Not an image');
        const reader = new FileReader();
        reader.onerror = () => reject('Read error');
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject('Image decode error');
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
                    else                { width  = Math.round(width  * maxDim / height); height = maxDim; }
                }
                const c = document.createElement('canvas');
                c.width = width; c.height = height;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
                ctx.drawImage(img,0,0,width,height);
                try { resolve(c.toDataURL('image/jpeg', quality)); }
                catch(e){ reject(e); }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// Full-screen image viewer
function openImageViewer(dataUrl, label) {
    if (!dataUrl) return;
    const modal = document.getElementById('imgViewerModal');
    const img   = document.getElementById('imgViewerImg');
    const cap   = document.getElementById('imgViewerCaption');
    const dl    = document.getElementById('imgViewerDownload');
    img.src = dataUrl;
    cap.textContent = label || 'Document';
    dl.href = dataUrl;
    dl.download = (label || 'document').replace(/\s+/g,'_') + '.jpg';
    modal.style.display = 'flex';
}
function closeImageViewer() {
    const modal = document.getElementById('imgViewerModal');
    if (modal) modal.style.display = 'none';
    const img = document.getElementById('imgViewerImg');
    if (img) img.src = '';
}

// Ask user: Camera vs Gallery, then open a file input accordingly
function _pickImageSource(useCamera, multiple) {
    return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        if (useCamera) inp.setAttribute('capture', 'environment');
        if (multiple)  inp.multiple = true;
        inp.onchange = () => resolve(inp.files ? Array.from(inp.files) : []);
        // Some browsers need the input in DOM
        inp.style.position = 'fixed'; inp.style.left = '-9999px';
        document.body.appendChild(inp);
        inp.click();
        setTimeout(() => { try { document.body.removeChild(inp); } catch(_){} }, 60000);
    });
}

// Admin upload / add image(s) — appends to array, max ADMIN_MAX_DOC_IMAGES
async function adminUploadDocImage(which) {
    if (!detailOrderId) return;
    // Get current images from cached editData
    const current = getDocImages(editData || {}, which);
    if (current.length >= ADMIN_MAX_DOC_IMAGES) {
        showToast(`Max ${ADMIN_MAX_DOC_IMAGES} images allowed`, 'error');
        return;
    }
    const label = which === 'bill' ? 'Bill' : 'Aadhaar';
    const choice = await Swal.fire({
        title: `Add ${label} Image`,
        text: `${current.length}/${ADMIN_MAX_DOC_IMAGES} used`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: '📷 Camera',
        denyButtonText:    '🖼️ Gallery',
        cancelButtonText:  'Cancel',
        confirmButtonColor: '#4f46e5',
        denyButtonColor:    '#0ea5e9'
    });
    if (choice.isDismissed) return;
    const useCamera = choice.isConfirmed;   // Confirm = Camera, Deny = Gallery
    const files = await _pickImageSource(useCamera, !useCamera);   // gallery = multi
    if (!files.length) return;

    Swal.fire({ title:'Uploading…', allowOutsideClick:false, didOpen:()=>Swal.showLoading() });
    try {
        const room = ADMIN_MAX_DOC_IMAGES - current.length;
        const toDo = files.slice(0, room);
        const compressed = [];
        for (const f of toDo) {
            try { compressed.push(await _compressImageFileAdmin(f)); }
            catch(e) { console.error(e); }
        }
        if (!compressed.length) { Swal.close(); showToast('Failed to process images', 'error'); return; }
        const newArr = current.concat(compressed);
        const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
        const legacyField = which === 'bill' ? 'billImage' : 'aadhaarImage';
        // Store array; keep legacy field mirrored to first image for backward compat
        await db.ref('pickups/' + detailOrderId).update({
            [arrField]: newArr,
            [legacyField]: newArr[0] || null
        });
        Swal.close();
        showToast(`✅ ${compressed.length} image${compressed.length>1?'s':''} saved`, 'success');
        db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const it = snap.val(); if (it) { editData = { ...it, id: detailOrderId }; renderDetailView(it); }
        });
        loadOrders();
    } catch(e) {
        Swal.close();
        showToast('Upload failed', 'error');
        console.error(e);
    }
}

// Delete one image by index (or all if idx is null)
async function adminDeleteDocImage(which, idx) {
    if (!detailOrderId) return;
    const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
    const legacyField = which === 'bill' ? 'billImage' : 'aadhaarImage';
    const label = which === 'bill' ? 'Bill' : 'Aadhaar';
    const current = getDocImages(editData || {}, which);
    if (!current.length) return;

    const isAll = (idx === undefined || idx === null);
    const confirm = await Swal.fire({
        title: isAll ? `Delete ALL ${label} Images?` : `Delete this ${label} image?`,
        text: 'This will permanently remove the image(s) from this order.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Delete',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        let newArr;
        if (isAll) newArr = [];
        else { newArr = current.slice(); newArr.splice(idx, 1); }
        await db.ref('pickups/' + detailOrderId).update({
            [arrField]: newArr.length ? newArr : null,
            [legacyField]: newArr[0] || null
        });
        showToast(`🗑️ Deleted`, 'success');
        db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const it = snap.val(); if (it) { editData = { ...it, id: detailOrderId }; renderDetailView(it); }
        });
        loadOrders();
    } catch(e) {
        showToast('Delete failed', 'error');
        console.error(e);
    }
}

// Save doc number (bill / aadhaar) inline from view mode
async function adminSaveDocNumber(which) {
    if (!detailOrderId) return;
    const field = which === 'bill' ? 'billNumber' : 'aadhaarNumber';
    const label = which === 'bill' ? 'Bill Number' : 'Aadhaar Number';
    const cur = (editData && editData[field]) || '';
    const { value: v, isConfirmed } = await Swal.fire({
        title: 'Edit ' + label,
        input: 'text',
        inputValue: cur,
        inputPlaceholder: label,
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        confirmButtonText: 'Save'
    });
    if (!isConfirmed) return;
    try {
        await db.ref('pickups/' + detailOrderId).update({ [field]: (v || '').trim() });
        showToast('✅ Updated', 'success');
        db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const it = snap.val(); if (it) { editData = { ...it, id: detailOrderId }; renderDetailView(it); }
        });
        loadOrders();
    } catch(e) { showToast('Update failed', 'error'); console.error(e); }
}


// ==========================================
// COMMISSION BRACKETS – based on PURCHASE PRICE only
// ==========================================
const COMMISSION_BRACKETS = [
    { min: 0, max: 10000, type: 'percentage', value: 10 },
    { min: 10001, max: 31000, type: 'percentage', value: 8 },
    { min: 31001, max: Infinity, type: 'fixed', value: 2500 }
];

function calculateCommission(purchasePrice) {
    if (!purchasePrice || purchasePrice <= 0) return 0;
    for (const bracket of COMMISSION_BRACKETS) {
        if (purchasePrice >= bracket.min && purchasePrice <= bracket.max) {
            if (bracket.type === 'percentage') {
                return Math.round((purchasePrice * bracket.value) / 100);
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
let currentSalaryPeriod = null; // will hold { mode, date, month, year } for activity

// IMEI override state (optional, kept for compatibility)
let imeiOverride = {};
let imei2Override = {};

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
// DASHBOARD – hold orders skipped, commission based on purchase price
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
            total++;
            if (item.status === 'on_hold') return;

            const commission = item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
            totalCommission += commission;

            if (item.status === 'pickup') {
                pickupCount++;
                if (item.sold) {
                    soldCount++;
                    const netRevenue = (item.salePrice || 0) - commission;
                    revenue += netRevenue;
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
        // 🔥 FIX: Ek baar mein attendance read karo, har agent ke liye alag se nahi
        const attSnapAll = await db.ref('attendance').once('value');
        const allAttendance = attSnapAll.val() || {};
        for (const [uname, uData] of Object.entries(users)) {
            const role = uData.role || 'agent';
            if (role === 'agent') {
                totalAgents++;
                const att = allAttendance[uname] && allAttendance[uname][today];
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
        // 🔥 FIX: Images exclude karo list view se - bandwidth bachao
        allOrders = Object.entries(data).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
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
                const statusLabel = approved ? 'Approved' : 'Pending';
                const statusClass = approved ? 'approved' : 'reschedule';
                html += `<tr class="order-row border-b border-gray-50"><td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td><td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td><td class="py-3 px-4 text-gray-600 text-sm">${item.reason || '—'}</td><td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${agent}</td><td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-400">${time}</td><td class="py-3 px-4"><span class="badge-status ${statusClass}">${statusLabel}</span></td><td class="py-3 px-4"><div class="flex items-center gap-1.5">${!approved ? `<button onclick="toggleRejectApproval('${item.id}', true)" class="btn-action approve"><i data-lucide="check-circle"></i> Approve</button>` : `<button onclick="toggleRejectApproval('${item.id}', false)" class="btn-action delete"><i data-lucide="x-circle"></i> Reject</button>`}<button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></div></td></tr>`;
            });
            tbody.innerHTML = html;
        }
        lucide.createIcons();
        document.getElementById('rejectedBadge').textContent = items.length;
    } catch (e) { console.error(e); showToast('Error loading rejected', 'error'); }
}
function refreshRejected() { loadRejectedAdmin(); showToast('🔄 Rejected refreshed', 'info'); }

async function toggleRejectApproval(orderId, approve) {
    const action = approve ? 'Approve' : 'Reject';
    const confirm = await Swal.fire({
        title: `${action} Rejection?`,
        text: approve ? 'This will count the reject incentive for the agent.' : 'This will remove the reject incentive from the agent\'s earnings.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: approve ? '#059669' : '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: `Yes, ${action}`,
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;
    try {
        const snap = await db.ref('pickups/' + orderId).once('value');
        const item = snap.val();
        if (!item) { showToast('Order not found', 'error'); return; }
        await db.ref('pickups/' + orderId + '/incentive_approved').set(approve);
        await db.ref('pickups/' + orderId + '/incentive_paid').set(false);
        if (approve) {
            await db.ref('pickups/' + orderId + '/incentive_approved_at').set(Date.now());
        } else {
            await db.ref('pickups/' + orderId + '/incentive_approved_at').remove();
        }
        showToast(`✅ Reject ${action}ed!`, 'success');
        loadRejectedAdmin();
        loadDashboard();
        if (currentPageView === 'salary') loadSalaryData();
    } catch (e) { showToast(`Error ${action}ing reject`, 'error'); console.error(e); }
}

// ==========================================
// INVENTORY – commission based on purchase price
// ==========================================
async function loadInventory() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        // 🔥 FIX: Images exclude
        inventoryList = Object.entries(data).filter(([_, item]) => item.status === 'pickup' && !item.sold).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
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
// SELL MODAL – commission based on purchase price
// ==========================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) { showToast('Order not found', 'error'); return; }
    sellOrderData = order;
    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellPurchasePrice').value = '₹' + (order.value || 0);
    const purchasePrice = order.value || 0;
    const commission = calculateCommission(purchasePrice);
    document.getElementById('sellCommissionDisplay').value = '₹' + commission;
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sellSaleDate').value = today;
    document.getElementById('sellProfitPreview').className = 'profit-preview neutral';
    document.getElementById('sellProfitPreview').textContent = 'Enter sale price to see profit (commission based on purchase price)';
    document.getElementById('sellModal').style.display = 'flex';
    lucide.createIcons();
    document.getElementById('sellSalePrice').oninput = updateProfitPreviewWithCommission;
    updateProfitPreviewWithCommission();
    setTimeout(() => document.getElementById('sellSalePrice').focus(), 300);
}

function updateProfitPreviewWithCommission() {
    const purchase = sellOrderData ? (sellOrderData.value || 0) : 0;
    const sale = parseFloat(document.getElementById('sellSalePrice').value) || 0;
    const commission = calculateCommission(purchase);
    const netProfit = sale - purchase - commission;
    const preview = document.getElementById('sellProfitPreview');
    if (sale > 0) {
        preview.textContent = `Commission: ₹${commission} | Net Profit: ₹${netProfit} (${netProfit >= 0 ? '✅' : '⚠️ Loss'})`;
        preview.className = netProfit >= 0 ? 'profit-preview positive' : 'profit-preview negative';
    } else {
        preview.textContent = 'Enter sale price to see profit (commission based on purchase price)';
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
    const commission = calculateCommission(purchasePrice);
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
                <p><strong>Commission (on Purchase):</strong> ₹${commission}</p>
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
// SALES – commission based on purchase price, hold excluded
// ==========================================
async function loadSales() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        salesList = Object.entries(data)
            .filter(([_, item]) => item.sold === true && item.status !== 'on_hold')
            .map(([id, item]) => {
                const purchase = item.value || 0;
                const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
                const netRevenue = (item.salePrice || 0) - commission;
                const profit = netRevenue - purchase;
                return { id, ...item, commission, profit };
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
        const purchase = item.value || 0;
        const c = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        commission += c;
        revenue += (item.salePrice || 0) - c;
        const p = item.profit !== undefined ? item.profit : (item.salePrice - c - purchase);
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
        const purchase = item.value || 0;
        const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        const profit = item.profit !== undefined ? item.profit : (item.salePrice - commission - purchase);
        const profitNum = profit || 0;
        const profitClass = profitNum >= 0 ? 'profit-green' : 'profit-red';
        const saleDate = item.saleDate || item.timestampIST || '—';
        const agent = item.agent || '—';
        html += `<tr class="order-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td>
            <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
            <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
            <td class="py-3 px-4 text-gray-600">₹${purchase}</td>
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
    const headers = ['Order ID', 'Model', 'IMEI', 'Purchase Price', 'Sale Price', 'Commission (on Purchase)', 'Net Profit', 'Buyer', 'Buyer Contact', 'Sale Date', 'Agent'];
    const rows = filteredSales.map(item => {
        const purchase = item.value || 0;
        const c = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        const p = item.profit !== undefined ? item.profit : (item.salePrice - c - purchase);
        return [
            item.orderId || item.id || '',
            item.phoneModel || '',
            item.imei || '',
            purchase,
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
// VIEW ORDER DETAIL – commission on purchase price
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
        const purchase = item.value || 0;
        const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        if (item.sold && item.profit === undefined) {
            const netRevenue = (item.salePrice || 0) - commission;
            item.profit = netRevenue - purchase;
        }
        item.commission = commission;
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
        const commission = item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
        commissionDisplay = '₹' + commission;
        const netProfit = item.profit !== undefined ? item.profit : (item.salePrice - commission - (item.value || 0));
        profitDisplay = '₹' + (netProfit || 0);
        profitClass = (netProfit || 0) >= 0 ? 'green' : 'red';
    }
    let saleHtml = '';
    if (item.sold) {
        saleHtml = `
            <div class="detail-item"><div class="label">Sale Price</div><div class="value green">₹${item.salePrice || 0}</div></div>
            <div class="detail-item"><div class="label">Commission (on Purchase)</div><div class="value amber">${commissionDisplay}</div></div>
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

    // ===== Documents section (Bill + Aadhaar) — VIEW MODE: no direct upload =====
    const _billImgs = getDocImages(item, 'bill');
    const _aadImgs  = getDocImages(item, 'aadhaar');
    const _billNo   = item.billNumber || '';
    const _aadNo    = item.aadhaarNumber || '';
    const _escape   = (s) => (s || '').replace(/'/g, "\\'");
    const _docCard = (which, label, num, imgs, color) => {
        let gallery;
        if (imgs.length === 0) {
            gallery = `<div class="w-full h-32 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-xs">No image</div>`;
        } else {
            gallery = `<div class="grid grid-cols-3 gap-2">` + imgs.map((img, i) => {
                const kb = Math.round((img.length * 3 / 4) / 1024);
                return `<div class="relative group">
                    <img src="${img}" onclick="openImageViewer('${_escape(img)}','${label} ${i+1}')" class="w-full h-24 object-cover rounded-lg border border-gray-200 cursor-zoom-in hover:opacity-90 transition" alt="${label} ${i+1}">
                    <button onclick="adminDeleteDocImage('${which}',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md hover:bg-red-700" title="Delete">✕</button>
                    <div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center rounded-b-lg">${kb}KB</div>
                </div>`;
            }).join('') + `</div>`;
        }
        return `
        <div class="rounded-xl border border-gray-200 p-3 bg-gradient-to-br from-${color}-50 to-white">
            <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-bold text-${color}-700 uppercase tracking-wide">${label} <span class="text-[10px] text-gray-500 font-normal">(${imgs.length}/${ADMIN_MAX_DOC_IMAGES})</span></p>
                <button onclick="adminSaveDocNumber('${which}')" class="text-[11px] text-indigo-600 font-semibold hover:underline">✏️ Edit No.</button>
            </div>
            <div class="text-sm font-mono font-semibold text-gray-800 mb-2 break-all">${num || '<span class="text-gray-400 font-sans font-normal">— no number —</span>'}</div>
            ${gallery}
        </div>`;
    };
    html += `<div class="mt-5 pt-4 border-t border-gray-100">
        <p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">📄 Documents <span class="text-[10px] font-normal text-gray-400">(add/replace in Edit mode)</span></p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${_docCard('bill', 'Bill', _billNo, _billImgs, 'blue')}
            ${_docCard('aadhaar', 'Aadhaar', _aadNo, _aadImgs, 'indigo')}
        </div>
    </div>`;

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
// EDIT MODE – commission recalculated from purchase price
// ==========================================
function toggleEditMode() {
    if (isEditMode) return;
    isEditMode = true;
    document.getElementById('detailModalTitle').textContent = 'Edit Order';
    const actBar = document.getElementById('detailActions');
    const saveBar = document.getElementById('detailSaveActions');
    if (actBar)  { actBar.style.display  = 'none'; }
    if (saveBar) { saveBar.style.setProperty('display','flex','important'); saveBar.style.zIndex='20'; }
    const content = document.getElementById('detailContent');
    const item = editData;
    let datetimeVal = '';
    if (item.timestamp) { const d = new Date(item.timestamp); if (!isNaN(d)) { const year = d.getFullYear(); const month = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); const hours = String(d.getHours()).padStart(2,'0'); const mins = String(d.getMinutes()).padStart(2,'0'); datetimeVal = `${year}-${month}-${day}T${hours}:${mins}`; } }
    
    // IMEI override (optional) – keep as before
    const imeiVal = item.imei || '';
    const imei2Val = item.imei2 || '';
    const imeiOver = imeiVal.length > 15;
    const imei2Over = imei2Val.length > 15;
    imeiOverride['edit'] = imeiOver;
    imei2Override['edit'] = imei2Over;
    
    let html = `<div class="space-y-4">
        <div><label class="edit-label">Order ID</label><input type="text" id="edit-orderId" value="${item.orderId || item.id || ''}" class="edit-field" readonly style="background:#f1f5f9;cursor:not-allowed;"></div>
        <div><label class="edit-label">Status</label><select id="edit-status" class="status-select">
            <option value="pickup" ${item.status === 'pickup' ? 'selected' : ''}>Pickup</option>
            <option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option>
            <option value="reschedule" ${item.status === 'reschedule' ? 'selected' : ''}>Pending</option>
            <option value="on_hold" ${item.status === 'on_hold' ? 'selected' : ''}>Hold</option>
        </select></div>
        <div><label class="edit-label">Phone Model</label><input type="text" id="edit-model" value="${item.phoneModel || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">IMEI</label><div class="imei-wrap"><input type="text" id="edit-imei" value="${item.imei || ''}" class="edit-field font-mono" maxlength="15" placeholder="15 digits max"><button id="imeiAllowBtn" class="imei-allow-btn ${imeiOver ? 'allowed' : ''}" onclick="toggleImeiLimit('edit-imei', 'imeiAllowBtn')">${imeiOver ? '✅ Unlimited' : 'Add more'}</button></div></div>
        <div><label class="edit-label">IMEI 2</label><div class="imei-wrap"><input type="text" id="edit-imei2" value="${item.imei2 || ''}" class="edit-field font-mono" maxlength="15" placeholder="15 digits max"><button id="imei2AllowBtn" class="imei-allow-btn ${imei2Over ? 'allowed' : ''}" onclick="toggleImeiLimit('edit-imei2', 'imei2AllowBtn')">${imei2Over ? '✅ Unlimited' : 'Add more'}</button></div></div>
        <div><label class="edit-label">Purchase Price (₹)</label><input type="number" id="edit-value" value="${item.value !== undefined && item.value !== null ? item.value : ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Customer Name</label><input type="text" id="edit-customer" value="${item.customerName || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Reason</label><input type="text" id="edit-reason" value="${item.reason || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Date & Time (IST)</label><input type="datetime-local" id="edit-datetime" value="${datetimeVal}" class="edit-field"></div>
        <div class="pt-3 border-t border-gray-100">
            <p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📄 Documents</p>
            <div><label class="edit-label">Bill Number</label><input type="text" id="edit-billNumber" value="${item.billNumber || ''}" class="edit-field" placeholder="Optional"></div>
            <div class="mt-2"><label class="edit-label">Bill Images <span class="text-gray-400 font-normal">(${getDocImages(item,'bill').length}/${ADMIN_MAX_DOC_IMAGES})</span></label>
                <button type="button" onclick="adminUploadDocImage('bill')" class="w-full py-2.5 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 font-semibold text-sm">${getDocImages(item,'bill').length >= ADMIN_MAX_DOC_IMAGES ? '✅ Max reached' : '➕ Add Bill Image (Camera / Gallery)'}</button>
                ${getDocImages(item,'bill').length ? `<div class="mt-2 grid grid-cols-3 gap-2">${getDocImages(item,'bill').map((im,i)=>`<div class="relative"><img src="${im}" onclick="openImageViewer('${_escape(im)}','Bill ${i+1}')" class="w-full h-20 object-cover rounded-lg border cursor-zoom-in"><button type="button" onclick="adminDeleteDocImage('bill',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md">✕</button></div>`).join('')}</div>` : ''}
            </div>
            <div class="mt-3"><label class="edit-label">Aadhaar Number</label><input type="text" id="edit-aadhaarNumber" value="${item.aadhaarNumber || ''}" class="edit-field font-mono" placeholder="Optional" maxlength="14"></div>
            <div class="mt-2"><label class="edit-label">Aadhaar Images <span class="text-gray-400 font-normal">(${getDocImages(item,'aadhaar').length}/${ADMIN_MAX_DOC_IMAGES})</span></label>
                <button type="button" onclick="adminUploadDocImage('aadhaar')" class="w-full py-2.5 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold text-sm">${getDocImages(item,'aadhaar').length >= ADMIN_MAX_DOC_IMAGES ? '✅ Max reached' : '➕ Add Aadhaar Image (Camera / Gallery)'}</button>
                ${getDocImages(item,'aadhaar').length ? `<div class="mt-2 grid grid-cols-3 gap-2">${getDocImages(item,'aadhaar').map((im,i)=>`<div class="relative"><img src="${im}" onclick="openImageViewer('${_escape(im)}','Aadhaar ${i+1}')" class="w-full h-20 object-cover rounded-lg border cursor-zoom-in"><button type="button" onclick="adminDeleteDocImage('aadhaar',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md">✕</button></div>`).join('')}</div>` : ''}
            </div>
        </div>`;
        
    if (item.sold) {
        html += `<div class="border-t pt-3"><p class="font-bold">Sale Details</p>
            <div><label class="edit-label">Sale Price</label><input type="number" id="edit-salePrice" value="${item.salePrice || ''}" class="edit-field" placeholder="Optional"></div>
            <div><label class="edit-label">Commission (on Purchase)</label><input type="number" id="edit-commission" value="${item.commission || ''}" class="edit-field" readonly style="background:#f1f5f9;"></div>
            <div><label class="edit-label">Buyer</label><input type="text" id="edit-buyer" value="${item.buyerName || ''}" class="edit-field" placeholder="Optional"></div>
            <div><label class="edit-label">Buyer Contact</label><input type="text" id="edit-buyerContact" value="${item.buyerContact || ''}" class="edit-field" placeholder="Optional"></div>
            <div><label class="edit-label">Sale Date</label><input type="date" id="edit-saleDate" value="${item.saleDate || ''}" class="edit-field"></div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;
    lucide.createIcons();
}

// IMEI limit toggle function (same as before)
function toggleImeiLimit(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;
    
    const currentMax = input.maxLength;
    if (currentMax === -1 || currentMax === 999) {
        Swal.fire({
            title: 'Limit IMEI to 15 digits?',
            text: 'This will restrict the IMEI field to 15 digits. Current value will be trimmed if needed.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, limit',
            cancelButtonText: 'Cancel'
        }).then((result) => {
            if (result.isConfirmed) {
                input.maxLength = 15;
                btn.textContent = 'Add more';
                btn.classList.remove('allowed');
                if (input.value.length > 15) {
                    input.value = input.value.slice(0, 15);
                }
                showToast('IMEI limited to 15 digits', 'info');
            }
        });
    } else {
        Swal.fire({
            title: 'Allow more than 15 digits?',
            text: 'Are you sure you want to add more than 15 digits to this IMEI?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#059669',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Yes, allow more',
            cancelButtonText: 'Cancel'
        }).then((result) => {
            if (result.isConfirmed) {
                input.maxLength = 999;
                btn.textContent = '✅ Unlimited';
                btn.classList.add('allowed');
                showToast('IMEI limit removed. You can add more digits.', 'success');
            }
        });
    }
}

function setupImeiValidation(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input) return;
    
    input.addEventListener('input', function() {
        if (input.maxLength === 15 && this.value.length > 15) {
            Swal.fire({
                title: 'More than 15 digits?',
                text: 'You have entered more than 15 digits. Allow unlimited digits?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#059669',
                cancelButtonColor: '#64748b',
                confirmButtonText: 'Yes, allow more',
                cancelButtonText: 'No, keep 15'
            }).then((result) => {
                if (result.isConfirmed) {
                    input.maxLength = 999;
                    if (btn) {
                        btn.textContent = '✅ Unlimited';
                        btn.classList.add('allowed');
                    }
                    showToast('IMEI limit removed', 'success');
                } else {
                    this.value = this.value.slice(0, 15);
                    showToast('Kept at 15 digits', 'info');
                }
            });
        }
    });
    
    input.addEventListener('paste', function(e) {
        setTimeout(() => {
            if (input.maxLength === 15 && this.value.length > 15) {
                input.dispatchEvent(new Event('input'));
            }
        }, 50);
    });
}

const originalToggleEdit = toggleEditMode;
toggleEditMode = function() {
    originalToggleEdit.call(this);
    setTimeout(() => {
        setupImeiValidation('edit-imei', 'imeiAllowBtn');
        setupImeiValidation('edit-imei2', 'imei2AllowBtn');
        // ensure Save/Cancel bar is visible & scrolled into view
        const saveBar = document.getElementById('detailSaveActions');
        if (saveBar) {
            saveBar.style.setProperty('display','flex','important');
            try { saveBar.scrollIntoView({behavior:'smooth', block:'end'}); } catch(_){}
        }
    }, 100);
};

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
    const billNumberVal    = (document.getElementById('edit-billNumber')?.value || '').trim();
    const aadhaarNumberVal = (document.getElementById('edit-aadhaarNumber')?.value || '').trim();
    let updated = { orderId, status, phoneModel: model || '', imei: imei || '', imei2: imei2 || '', value: value || 0, customerName: customer || '', reason: reason || '', billNumber: billNumberVal, aadhaarNumber: aadhaarNumberVal, timestamp: editData.timestamp, timestampIST: editData.timestampIST || '' };
    if (datetimeVal) { const d = new Date(datetimeVal); if (!isNaN(d)) { updated.timestamp = d.toISOString(); const istOffset = 5.5 * 60 * 60 * 1000; const istTime = new Date(d.getTime() + istOffset); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const dd = String(istTime.getUTCDate()).padStart(2,'0'); const mmm = months[istTime.getUTCMonth()]; const yyyy = istTime.getUTCFullYear(); let hours = istTime.getUTCHours(); const minutes = String(istTime.getUTCMinutes()).padStart(2,'0'); const seconds = String(istTime.getUTCSeconds()).padStart(2,'0'); const ampm = hours >= 12 ? 'PM' : 'AM'; hours = hours % 12 || 12; const hh = String(hours).padStart(2,'0'); updated.timestampIST = `${dd}-${mmm}-${yyyy}, ${hh}:${minutes}:${seconds} ${ampm} IST`; } } else { updated.timestamp = editData.timestamp; updated.timestampIST = editData.timestampIST; }
    if (editData.sold) {
        const commission = calculateCommission(value);
        updated.sold = true;
        updated.salePrice = salePrice || 0;
        updated.commission = commission;
        updated.buyerName = buyer || '';
        updated.buyerContact = buyerContact || '';
        updated.saleDate = saleDate || '';
        updated.profit = (salePrice - commission) - value;
    }
    if (status === 'on_hold' && editData.status !== 'on_hold') {
        updated.previous_status = editData.status;
        updated.hold_reason = reason || 'Manually held';
    } else if (status !== 'on_hold' && editData.status === 'on_hold') {
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
// DEPOSITS – commission total excludes hold orders, based on purchase price
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

    // *** CHANGED: Stock Value = sum of all pickups (both sold and unsold) ***
    let stockValue = 0;
    const snap = await db.ref('pickups').once('value');
    const data = snap.val() || {};
    Object.values(data).forEach(item => {
        // Include only orders with status 'pickup' (both sold and unsold)
        if (item.status === 'pickup') {
            stockValue += item.value || 0;
        }
    });
    document.getElementById('depositStockValue').textContent = '₹' + stockValue;
    const balance = total - stockValue;
    document.getElementById('depositBalance').textContent = '₹' + balance;

    let totalCommission = 0;
    Object.values(data).forEach(item => {
        if (item.status === 'on_hold') return;
        totalCommission += item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
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
// AGENTS (unchanged from previous)
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
// AGENT ACTIVITY (UPDATED with stats and period support)
// ==========================================
// This function is called from agent management (no period)
function viewAgentActivity(username) {
    // Default period: today
    const today = new Date().toISOString().split('T')[0];
    viewAgentActivityWithPeriod(username, { mode: 'today', date: today });
}

// New function that accepts a period object
function viewAgentActivityWithPeriod(username, period) {
    const modal = document.getElementById('activityModal');
    const content = document.getElementById('activityContent');
    const title = document.getElementById('activityModalTitle');
    title.textContent = `Activity: ${username}`;
    modal.style.display = 'flex';
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span> Loading...</div>`;

    // Determine date filter
    let filterFn;
    let periodLabel = '';
    if (period.mode === 'today') {
        const today = new Date().toISOString().split('T')[0];
        filterFn = (ts) => {
            if (!ts) return false;
            const d = new Date(ts).toISOString().split('T')[0];
            return d === today;
        };
        periodLabel = 'Today';
    } else if (period.mode === 'monthly') {
        const year = period.year;
        const month = period.month;
        const monthStr = String(month).padStart(2, '0');
        filterFn = (ts) => {
            if (!ts) return false;
            const d = new Date(ts);
            return d.getFullYear() === year && (d.getMonth() + 1) === month;
        };
        periodLabel = `${monthStr}-${year}`;
    } else if (period.mode === 'date') {
        const date = period.date;
        filterFn = (ts) => {
            if (!ts) return false;
            const d = new Date(ts).toISOString().split('T')[0];
            return d === date;
        };
        periodLabel = date;
    } else {
        // fallback: all time
        filterFn = () => true;
        periodLabel = 'All Time';
    }

    db.ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        const orders = Object.entries(data)
            .filter(([_, item]) => item.agent === username && filterFn(item.timestamp))
            .map(([id, item]) => ({ id, ...item }));
        orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Compute stats for this agent
        let pickupCount = 0, rejectCount = 0, rescheduleCount = 0, totalOrders = orders.length;
        orders.forEach(item => {
            if (item.status === 'pickup') pickupCount++;
            else if (item.status === 'rejected') rejectCount++;
            else if (item.status === 'reschedule') rescheduleCount++;
        });

        // Compute total for all agents for the same period
        let allPickup = 0, allReject = 0, allReschedule = 0, allTotal = 0;
        Object.values(data).forEach(item => {
            if (filterFn(item.timestamp)) {
                allTotal++;
                if (item.status === 'pickup') allPickup++;
                else if (item.status === 'rejected') allReject++;
                else if (item.status === 'reschedule') allReschedule++;
            }
        });

        let html = `
            <div class="mb-4">
                <p class="text-sm text-gray-500">Period: <strong>${periodLabel}</strong></p>
                <div class="activity-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-green-600" style="font-size:18px;font-weight:700;">${pickupCount}</div><div class="label" style="font-size:10px;color:#94a3b8;">${username} Pickups</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-red-600" style="font-size:18px;font-weight:700;">${rejectCount}</div><div class="label" style="font-size:10px;color:#94a3b8;">${username} Rejects</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-amber-600" style="font-size:18px;font-weight:700;">${rescheduleCount}</div><div class="label" style="font-size:10px;color:#94a3b8;">${username} Pending</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-blue-600" style="font-size:18px;font-weight:700;">${totalOrders}</div><div class="label" style="font-size:10px;color:#94a3b8;">${username} Total</div></div>
                </div>
                <div class="activity-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-green-600" style="font-size:18px;font-weight:700;">${allPickup}</div><div class="label" style="font-size:10px;color:#94a3b8;">All Agents Pickups</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-red-600" style="font-size:18px;font-weight:700;">${allReject}</div><div class="label" style="font-size:10px;color:#94a3b8;">All Agents Rejects</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-amber-600" style="font-size:18px;font-weight:700;">${allReschedule}</div><div class="label" style="font-size:10px;color:#94a3b8;">All Agents Pending</div></div>
                    <div class="stat-box" style="background:#f8fafc;padding:8px 14px;border-radius:8px;border:1px solid #e2e8f0;"><div class="num text-blue-600" style="font-size:18px;font-weight:700;">${allTotal}</div><div class="label" style="font-size:10px;color:#94a3b8;">All Agents Total</div></div>
                </div>
            </div>
        `;

        if (orders.length === 0) {
            html += `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity for this period</p></div>`;
            content.innerHTML = html;
            lucide.createIcons();
            return;
        }

        html += `<div class="space-y-2">`;
        orders.forEach(item => {
            const statusLabel = item.status || 'unknown';
            const statusClass = statusLabel === 'pickup' ? (item.sold ? 'sold' : 'pickup') : statusLabel === 'rejected' ? 'rejected' : statusLabel === 'on_hold' ? 'on_hold' : 'reschedule';
            const displayName = statusLabel === 'pickup' ? (item.sold ? 'Sold' : 'Pickup') : statusLabel === 'rejected' ? 'Rejected' : statusLabel === 'on_hold' ? 'Hold' : 'Pending';
            const time = item.timestampIST || item.timestamp || '';
            const model = item.phoneModel || '—';
            const value = item.value !== undefined ? '₹' + item.value : '—';

            // For rejected orders, show approve/reject buttons with timestamp
            let rejectActions = '';
            if (statusLabel === 'rejected') {
                const approved = item.incentive_approved === true;
                const statusText = approved ? '✅ Approved' : '⏳ Pending';
                const approvalTime = item.incentive_approved_at ? new Date(item.incentive_approved_at).toLocaleString() : '—';
                rejectActions = `
                    <span class="text-xs font-bold ${approved ? 'text-green-600' : 'text-amber-600'}">${statusText}</span>
                    ${!approved ? `<button onclick="toggleRejectApproval('${item.id}', true)" class="btn-action approve text-xs py-0.5 px-2"><i data-lucide="check-circle"></i></button>` : `<button onclick="toggleRejectApproval('${item.id}', false)" class="btn-action delete text-xs py-0.5 px-2"><i data-lucide="x-circle"></i></button>`}
                    ${approved ? `<span class="text-[10px] text-gray-400" title="Approved at ${approvalTime}">⏱️ ${approvalTime}</span>` : ''}
                `;
            }

            html += `<div class="activity-item flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 cursor-pointer" onclick="viewOrder('${item.id}')">
                <div class="flex items-center gap-3">
                    <span class="badge-status ${statusClass}">${displayName}</span>
                    <span class="font-mono font-bold text-gray-700 text-sm">${item.orderId || item.id}</span>
                    <span class="text-xs text-gray-400 hidden sm:inline">${model}</span>
                    <span class="text-xs text-gray-400 hidden md:inline">${value}</span>
                </div>
                <div class="flex items-center gap-2">
                    ${rejectActions}
                    <span class="text-[10px] text-gray-400">${time}</span>
                </div>
            </div>`;
        });
        html += `</div>`;
        content.innerHTML = html;
        lucide.createIcons();
    }).catch(err => {
        content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error</p></div>`;
        showToast('Error', 'error');
    });
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
// SALARY / EARNINGS – with custom date support and global stats
// ==========================================
function setSalaryMode(mode) {
    currentSalaryMode = mode;
    document.getElementById('salaryModeToday').classList.toggle('active', mode === 'today');
    document.getElementById('salaryModeMonthly').classList.toggle('active', mode === 'monthly');
    document.getElementById('salaryModeDate').classList.toggle('active', mode === 'date');
    document.getElementById('salaryMonthWrapper').style.display = mode === 'monthly' ? 'inline-block' : 'none';
    document.getElementById('salaryDateWrapper').style.display = mode === 'date' ? 'inline-block' : 'none';

    const label = document.getElementById('salaryModeLabel');
    if (mode === 'today') {
        label.textContent = "Today's Earnings";
    } else if (mode === 'monthly') {
        const monthVal = document.getElementById('salaryMonth').value || 'current month';
        label.textContent = `Earnings for ${monthVal}`;
    } else if (mode === 'date') {
        const dateVal = document.getElementById('salaryDate').value || 'selected date';
        label.textContent = `Earnings for ${dateVal}`;
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
            document.getElementById('globalPickups').textContent = '0';
            document.getElementById('globalRejects').textContent = '0';
            document.getElementById('globalPending').textContent = '0';
            document.getElementById('globalEarnings').textContent = '₹0';
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        let year, month, monthStr, daysInMonth;
        let dateFilterFn;
        let periodInfo = { mode };

        if (mode === 'today') {
            year = parseInt(today.split('-')[0]);
            month = parseInt(today.split('-')[1]);
            monthStr = String(month).padStart(2, '0');
            daysInMonth = 1;
            dateFilterFn = (ordDate) => ordDate === today;
            periodInfo.date = today;
        } else if (mode === 'monthly') {
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
            periodInfo.year = year;
            periodInfo.month = month;
        } else if (mode === 'date') {
            const dateInput = document.getElementById('salaryDate');
            let dateVal = dateInput.value;
            if (!dateVal) {
                dateVal = today;
                dateInput.value = dateVal;
            }
            const d = new Date(dateVal);
            year = d.getFullYear();
            month = d.getMonth() + 1;
            monthStr = String(month).padStart(2, '0');
            daysInMonth = 1;
            dateFilterFn = (ordDate) => ordDate === dateVal;
            periodInfo.date = dateVal;
        } else {
            // fallback all time
            dateFilterFn = () => true;
            periodInfo.mode = 'all';
        }

        // Store period for activity links
        currentSalaryPeriod = periodInfo;

        const pickupsByAgentDate = {};
        const allRejectedOrders = [];

        // Global counts
        let globalPickup = 0, globalReject = 0, globalPending = 0, globalEarnings = 0;

        for (const [oid, ord] of Object.entries(pickups)) {
            if (!ord.timestamp) continue;
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
            // Global counts
            if (ord.status === 'pickup') globalPickup++;
            else if (ord.status === 'rejected') globalReject++;
            else if (ord.status === 'reschedule') globalPending++;
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

            const loopDays = mode === 'today' || mode === 'date' ? [new Date().getDate()] : Array.from({ length: daysInMonth }, (_, i) => i + 1);
            const datePrefix = mode === 'date' ? periodInfo.date : (mode === 'today' ? today : `${year}-${monthStr}`);
            let agentPickupCount = 0, agentRejectCount = 0, agentPendingCount = 0;
            for (const d of loopDays) {
                const dateStr = (mode === 'today' || mode === 'date') ? (mode === 'date' ? periodInfo.date : today) : `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
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
                        agentPickupCount++;
                    }
                    if (ord.status === 'rejected' && ord.incentive_approved === true) {
                        dayRejectInc += rejectInc;
                        agentRejectCount++;
                    }
                    if (ord.status === 'rejected' && ord.incentive_approved !== true) {
                        pendingRejects.push({ id: ord.orderId || ord.id, ...ord });
                    }
                    if (ord.status === 'reschedule') {
                        agentPendingCount++;
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
            globalEarnings += total;

            let pendingRejectsHtml = '';
            if (uniquePending.length > 0) {
                pendingRejectsHtml = `<div class="mt-2 pt-2 border-t border-gray-200">
                    <p class="text-xs font-bold text-amber-600">⏳ Pending Reject Approvals (${uniquePending.length})</p>
                    <div class="flex flex-wrap gap-1 mt-1">`;
                uniquePending.forEach(pr => {
                    pendingRejectsHtml += `<span class="text-xs bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                        ${pr.orderId || pr.id}
                        <button onclick="toggleRejectApproval('${pr.id}', true)" class="text-green-600 hover:text-green-800 font-bold text-xs">✅</button>
                        <button onclick="toggleRejectApproval('${pr.id}', false)" class="text-red-600 hover:text-red-800 font-bold text-xs">❌</button>
                    </span>`;
                });
                pendingRejectsHtml += `</div></div>`;
            }

            html += `<div class="glass rounded-2xl p-5 shadow-sm border border-gray-100 salary-summary-card">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAgentActivityWithPeriod('${uname}', ${JSON.stringify(currentSalaryPeriod).replace(/"/g, '&quot;')})">${uData.name}</span>
                        <span class="text-sm text-gray-500">(${uname})</span>
                        <button onclick="viewAgentActivityWithPeriod('${uname}', ${JSON.stringify(currentSalaryPeriod).replace(/"/g, '&quot;')})" class="btn-action activity text-xs ml-2"><i data-lucide="activity"></i> Activity</button>
                        <span class="text-xs text-gray-400 ml-2">📦 ${agentPickupCount} | ❌ ${agentRejectCount} | ⏳ ${agentPendingCount}</span>
                    </div>
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

        // Update global stats
        document.getElementById('globalPickups').textContent = globalPickup;
        document.getElementById('globalRejects').textContent = globalReject;
        document.getElementById('globalPending').textContent = globalPending;
        document.getElementById('globalEarnings').textContent = '₹' + Math.round(globalEarnings);

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
                    <button onclick="toggleRejectApproval('${pr.id}', true)" class="btn-action approve text-xs py-0.5 px-2">
                        <i data-lucide="check-circle"></i> Approve
                    </button>
                    <button onclick="toggleRejectApproval('${pr.id}', false)" class="btn-action delete text-xs py-0.5 px-2">
                        <i data-lucide="x-circle"></i> Reject
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
    // 🔥 FIX: Sirf dashboard load karo init pe, baaki jab user jaye
    loadDashboard();
    document.getElementById('attendanceDate').value = new Date().toISOString().split('T')[0];
    const today = new Date();
    document.getElementById('salaryMonth').value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    document.getElementById('salaryDate').value = today.toISOString().split('T')[0];
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
    }, 300000);  // 🔥 FIX: 5 minutes (pehle 60000 tha)
    showToast('👋 Welcome', 'info', 2000);
});

document.getElementById('detailModal').addEventListener('click', function(e) { if (e.target === this) closeDetail(); });
document.getElementById('sellModal').addEventListener('click', function(e) { if (e.target === this) closeSellModal(); });
document.getElementById('activityModal').addEventListener('click', function(e) { if (e.target === this) closeActivityModal(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeDetail(); closeSellModal(); closeActivityModal(); closeSidebar(); } });
setInterval(() => { lucide.createIcons(); }, 5000);
