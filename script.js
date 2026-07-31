// ================================================================
// SECTION 1: FIREBASE CONFIG & INITIALIZATION
// ================================================================
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
const storage = firebase.storage();

// ================================================================
// SECTION 2: GLOBAL HELPERS
// ================================================================
const formatINR = (num) => {
    if (num === undefined || num === null || isNaN(num)) return '₹0';
    return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(num));
};

function _escape(s) { return (s || '').replace(/'/g, "\\'"); }

// ================================================================
// SECTION 3: DOCUMENT (Bill / Aadhaar) HELPERS - FIREBASE STORAGE
// ================================================================
const ADMIN_MAX_DOC_IMAGES = 3;
// 🔥 RAM / STORAGE / NETWORK helpers (admin)
const ADMIN_RAM_OPTIONS = ['1GB','2GB','3GB','4GB','6GB','8GB','12GB','16GB','18GB','24GB'];
const ADMIN_STORAGE_OPTIONS = ['8GB','16GB','32GB','64GB','128GB','256GB','512GB','1TB','2TB'];
const ADMIN_NETWORK_OPTIONS = ['2G','3G','4G','5G'];

function getRam(item) {
    if (!item) return '';
    if (item.ram) return item.ram;
    const rs = item.ramStorage || '';
    return rs.includes('/') ? rs.split('/')[0].trim() : '';
}

function getStorage(item) {
    if (!item) return '';
    if (item.storage) return item.storage;
    const rs = item.ramStorage || '';
    return rs.includes('/') ? rs.split('/')[1].trim() : '';
}

function getRamStorageText(item) {
    const r = getRam(item), st = getStorage(item);
    if (r && st) return r + ' / ' + st;
    return r || st || (item && item.ramStorage) || '';
}

function buildOptionList(options, current) {
    return ['<option value="">— Empty —</option>']
        .concat(options.map(o => `<option value="${o}" ${current === o ? 'selected' : ''}>${o}</option>`))
        .concat(current && !options.includes(current) ? [`<option value="${current}" selected>${current}</option>`] : [])
        .join('');
}

function getDocImages(item, which) {
    if (!item) return [];
    const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
    const legacy   = which === 'bill' ? 'billImage'  : 'aadhaarImage';
    const arr = Array.isArray(item[arrField]) ? item[arrField].slice() : [];
    if (arr.length === 0 && item[legacy]) arr.push(item[legacy]);
    return arr.filter(Boolean);
}

function _compressImageFileAdmin(file, maxDimension, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                // 🔥 FIX: White background for transparent PNGs
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function closeImageViewer() {
    try {
        document.getElementById('imgViewerModal').style.display = 'none';
        document.body.style.overflow = '';
    } catch (e) {}
}

async function _uploadImageToStorageAdmin(file, orderId, docType, index) {
    if (!file) throw new Error('No file');
    if (!orderId) throw new Error('Order ID required');
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${orderId}_${docType}_${index}.${fileExt}`;
    const storageRef = storage.ref(`pickup_docs/${orderId}/${docType}/${fileName}`);
    // 🔥 FIX: 800px, 0.55 quality - much smaller files
    const compressedDataUrl = await _compressImageFileAdmin(file, 800, 0.55);
    const blob = await (await fetch(compressedDataUrl)).blob();
    const snapshot = await storageRef.put(blob, { contentType: 'image/jpeg' });
    const downloadURL = await snapshot.ref.getDownloadURL();
    return downloadURL;
}

async function _deleteImageFromStorageAdmin(url) {
    if (!url) return;
    try {
        const ref = storage.refFromURL(url);
        await ref.delete();
    } catch (e) {
        console.warn('Could not delete image from storage:', e);
    }
}

async function adminUploadDocImage(which) {
    if (!detailOrderId) {
        showToast('No order selected', 'error');
        return;
    }
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
    const useCamera = choice.isConfirmed;
    const files = await _pickImageSource(useCamera, !useCamera);
    if (!files.length) return;
    Swal.fire({ title:'Uploading…', allowOutsideClick:false, didOpen:()=>Swal.showLoading() });
    try {
        const room = ADMIN_MAX_DOC_IMAGES - current.length;
        const toDo = files.slice(0, room);
        const uploadPromises = [];
        for (let i = 0; i < toDo.length; i++) {
            const f = toDo[i];
            const idx = current.length + i;
            uploadPromises.push(
                _uploadImageToStorageAdmin(f, detailOrderId, which, idx)
            );
        }
        const urls = await Promise.all(uploadPromises);
        if (!urls.length) { Swal.close(); showToast('Upload failed', 'error'); return; }
        const newArr = current.concat(urls);
        const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
        const legacyField = which === 'bill' ? 'billImage' : 'aadhaarImage';
        await db.ref('pickups/' + detailOrderId).update({
            [arrField]: newArr,
            [legacyField]: newArr[0] || null
        });
        Swal.close();
        showToast(`✅ ${urls.length} image${urls.length>1?'s':''} uploaded`, 'success');
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
        text: 'This will permanently remove the image(s) from Storage and this order.',
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
        let urlsToDelete = [];
        if (isAll) {
            urlsToDelete = current.slice();
            newArr = [];
        } else {
            urlsToDelete = [current[idx]];
            newArr = current.slice();
            newArr.splice(idx, 1);
        }
        for (const url of urlsToDelete) {
            await _deleteImageFromStorageAdmin(url);
        }
        await db.ref('pickups/' + detailOrderId).update({
            [arrField]: newArr.length ? newArr : null,
            [legacyField]: newArr[0] || null
        });
        showToast(`🗑️ Deleted ${urlsToDelete.length} image(s)`, 'success');
        db.ref('pickups/' + detailOrderId).once('value').then(snap => {
            const it = snap.val(); if (it) { editData = { ...it, id: detailOrderId }; renderDetailView(it); }
        });
        loadOrders();
    } catch(e) {
        showToast('Delete failed', 'error');
        console.error(e);
    }
}

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

function _pickImageSource(useCamera, useGallery) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        if (useCamera) {
            input.capture = 'environment';
        }
        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            resolve(files);
        };
        input.click();
    });
}

// ================================================================
// SECTION 4: COMMISSION BRACKETS
// ================================================================
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

// ================================================================
// SECTION 5: STATE VARIABLES
// ================================================================
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

let allDeposits = [];
let filteredDeposits = [];
let depositCurrentPage = 1;
const depositPageSize = 15;

let currentSalaryMode = 'today';
let currentSalaryPeriod = null;

let imeiOverride = {};
let imei2Override = {};

let overheadPerPhone = 0;

// ================================================================
// SECTION 6: TOAST
// ================================================================
const toastEl = document.getElementById('toast');

function showToast(msg, type = 'info', duration = 3000) {
    toastEl.textContent = msg;
    toastEl.className = 'toast-fixed ' + type;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ================================================================
// SECTION 7: SIDEBAR & NAVIGATION
// ================================================================
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

// ================================================================
// SECTION 8: DASHBOARD
// ================================================================
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
        const attSnapAll = await db.ref('attendance').once('value');
        const allAttendance = attSnapAll.val() || {};
        
        for (const [uname, uData] of Object.entries(users)) {
            const role = uData.role || 'agent';
            if (role === 'agent' && uData.is_active !== false) {
                totalAgents++;
                const att = allAttendance[uname] && allAttendance[uname][today];
                if (att && att.status === 'present') presentToday++;
            }
        }

        let depositTotalAmount = 0;
        Object.values(deposits).forEach(d => {
            depositTotalAmount += d.amount || 0;
        });

        // FIX (overhead): the dashboard only knows deposits, NOT agent salaries.
        // It used to overwrite the global `overheadPerPhone`, wiping out the
        // salary-inclusive value computed in loadSales() (which counts ALL
        // agents, including ones who left). Keep it local so the Sales page
        // overhead / Final Net Profit stay correct.
        const totalOverhead = depositTotalAmount;
        const dashOverheadPerPhone = soldCount > 0 ? totalOverhead / soldCount : 0;
        const finalNetProfit = profit - (dashOverheadPerPhone * soldCount);

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statPickup').textContent = pickupCount;
        document.getElementById('statRejected').textContent = rejectedCount;
        document.getElementById('statPending').textContent = pendingCount;
        document.getElementById('statInventory').textContent = unsoldCount;
        document.getElementById('statSold').textContent = soldCount;
        document.getElementById('statRevenue').textContent = formatINR(revenue);
        document.getElementById('statProfit').textContent = formatINR(profit);
        document.getElementById('statFinalProfit').textContent = formatINR(finalNetProfit);
        document.getElementById('statStockValue').textContent = formatINR(totalStockValue);
        document.getElementById('statAgents').textContent = totalAgents;
        document.getElementById('statPresentToday').textContent = presentToday;
        document.getElementById('statCommission').textContent = formatINR(totalCommission);

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

// ================================================================
// SECTION 9: ORDERS
// ================================================================
async function loadOrders() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        allOrders = Object.entries(data).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
        allOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyOrderFilter(currentOrderFilter);
        setupLiveSearch('orderSearch', 'orderSearchDropdown', allOrders, ['orderId', 'phoneModel', 'imei', 'customerName', 'agent', 'color']);
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

    const query = document.getElementById('orderSearch').value.trim();
    if (query) {
        const fuse = new Fuse(filtered, {
            keys: ['orderId', 'phoneModel', 'imei', 'customerName', 'agent', 'color'],
            threshold: 0.3,
            includeScore: true,
            ignoreLocation: true
        });
        const results = fuse.search(query);
        filtered = results.map(r => r.item);
    }

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
        const value = item.value !== undefined && item.value !== null ? formatINR(item.value) : '—';
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

// ================================================================
// SECTION 10: PENDING ADMIN
// ================================================================
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

// ================================================================
// SECTION 11: REJECTED ADMIN
// ================================================================
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

// ================================================================
// SECTION 12: INVENTORY
// ================================================================
async function loadInventory() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        inventoryList = Object.entries(data).filter(([_, item]) => item.status === 'pickup' && !item.sold).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
        inventoryList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyInventorySearch();
        setupLiveSearch('inventorySearch', 'inventorySearchDropdown', inventoryList, ['orderId', 'phoneModel', 'imei', 'customerName', 'color']);
    } catch (e) {
        console.error('Inventory error:', e);
        showToast('Error loading inventory', 'error');
    }
}

function applyInventorySearch() {
    const query = document.getElementById('inventorySearch').value.trim();
    let filtered = inventoryList;
    if (query) {
        const fuse = new Fuse(filtered, {
            keys: ['orderId', 'phoneModel', 'imei', 'customerName', 'color'],
            threshold: 0.3,
            includeScore: true,
            ignoreLocation: true
        });
        const results = fuse.search(query);
        filtered = results.map(r => r.item);
    }
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
        html += `<tr class="order-row border-b border-gray-50"><td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td><td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td><td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td><td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td><td class="py-3 px-4 font-bold text-gray-700">${formatINR(item.value || 0)}</td><td class="py-3 px-4"><span class="commission-col">${formatINR(commission)}</span></td><td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td><td class="py-3 px-4"><button onclick="openSellModal('${item.id}')" class="btn-action sell"><i data-lucide="badge-dollar-sign"></i> Sell</button><button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></td></tr>`;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

function refreshInventory() { loadInventory(); showToast('🔄 Inventory refreshed', 'info'); }

// ================================================================
// SECTION 13: SALES (Overhead includes ALL agents - FIXED)
// ================================================================
async function loadSales() {
    try {
        const [pickupSnap, usersSnap, attendanceSnap] = await Promise.all([
            db.ref('pickups').once('value'),
            db.ref('users').once('value'),
            db.ref('attendance').once('value')
        ]);
        const data = pickupSnap.val() || {};
        const users = usersSnap.val() || {};
        const allAttendance = attendanceSnap.val() || {};

        let totalOverhead = 0;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // ---- Base salary: INCLUDE ALL AGENTS (active + left) ----
        for (const [uname, uData] of Object.entries(users)) {
            const role = uData.role || 'agent';
            if (role !== 'agent') continue;
            // NO is_active filter – all agents' past salaries count

            const monthlySalary = uData.salary || 0;
            const perDaySalary = monthlySalary / 30;

            let joinDate = null;
            if (uData.joinDate) {
                joinDate = new Date(uData.joinDate + 'T00:00:00');
            } else if (uData.createdAt) {
                joinDate = new Date(uData.createdAt);
            }
            if (!joinDate) joinDate = new Date(today);

            let agentBaseSalary = 0;
            let currentDate = new Date(joinDate);
            while (currentDate <= today) {
                const dateStr = currentDate.toISOString().split('T')[0];
                const att = (allAttendance[uname] && allAttendance[uname][dateStr]) || {};
                const isPresent = att.status === 'present';
                const salaryCounted = att.salary_counted !== false;

                if (isPresent && salaryCounted) {
                    agentBaseSalary += perDaySalary;
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            totalOverhead += agentBaseSalary;
        }

        // ---- Incentives: INCLUDE ALL AGENTS ----
        let totalPickupIncentives = 0;
        let totalRejectIncentives = 0;

        Object.values(data).forEach(item => {
            if (item.status === 'on_hold') return;
            const agent = item.agent;
            if (!agent) return;
            const uData = users[agent];
            if (!uData || (uData.role || 'agent') !== 'agent') return;
            // NO is_active filter

            if (item.status === 'pickup') {
                totalPickupIncentives += (uData.pickup_incentive || 0);
            } else if (item.status === 'rejected' && item.incentive_approved === true) {
                totalRejectIncentives += (uData.reject_incentive || 0);
            }
        });

        totalOverhead += totalPickupIncentives + totalRejectIncentives;

        let totalSold = 0;
        Object.values(data).forEach(item => {
            if (item.status === 'pickup' && item.sold) {
                totalSold++;
            }
        });

        overheadPerPhone = totalSold > 0 ? totalOverhead / totalSold : 0;

        salesList = Object.entries(data)
            .filter(([_, item]) => item.sold === true && item.status !== 'on_hold')
            .map(([id, item]) => {
                const purchase = item.value || 0;
                const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
                const grossProfit = (item.salePrice || 0) - purchase - commission;
                const finalNetProfit = grossProfit - overheadPerPhone;
                return { id, ...item, commission, grossProfit, finalNetProfit };
            });
        salesList.sort((a, b) => (b.saleTimestamp || b.timestamp || 0) - (a.saleTimestamp || a.timestamp || 0));
        applySalesFilters();
        document.getElementById('salesBadge').textContent = salesList.length;
        setupLiveSearch('salesSearch', 'salesSearchDropdown', salesList, ['orderId', 'phoneModel', 'buyerName', 'agent', 'color']);
    } catch (e) {
        console.error('Sales error:', e);
        showToast('Error loading sales', 'error');
    }
}

function applySalesFilters() {
    const query = document.getElementById('salesSearch').value.trim();
    const dateFrom = document.getElementById('salesDateFrom').value;
    const dateTo = document.getElementById('salesDateTo').value;
    let filtered = salesList;
    if (query) {
        const fuse = new Fuse(filtered, {
            keys: ['orderId', 'phoneModel', 'buyerName', 'agent', 'color'],
            threshold: 0.3,
            includeScore: true,
            ignoreLocation: true
        });
        const results = fuse.search(query);
        filtered = results.map(r => r.item);
    }
    if (dateFrom) { filtered = filtered.filter(item => (item.saleDate || '') >= dateFrom); }
    if (dateTo) { filtered = filtered.filter(item => (item.saleDate || '') <= dateTo); }
    filteredSales = filtered;
    renderSalesTable();
    updateSalesSummary();
}
function clearSalesFilters() { document.getElementById('salesSearch').value = ''; document.getElementById('salesDateFrom').value = ''; document.getElementById('salesDateTo').value = ''; applySalesFilters(); }

function updateSalesSummary() {
    const total = filteredSales.length;
    let revenue = 0, grossProfitTotal = 0, finalProfitTotal = 0;
    filteredSales.forEach(item => {
        const purchase = item.value || 0;
        const c = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        revenue += (item.salePrice || 0) - c;
        const gp = item.grossProfit !== undefined ? item.grossProfit : (item.salePrice - c - purchase);
        grossProfitTotal += gp || 0;
        const fp = item.finalNetProfit !== undefined ? item.finalNetProfit : (gp - overheadPerPhone);
        finalProfitTotal += fp || 0;
    });
    document.getElementById('salesTotalCount').textContent = total;
    document.getElementById('salesTotalRevenue').textContent = formatINR(revenue);
    document.getElementById('salesTotalGrossProfit').textContent = formatINR(grossProfitTotal);
    document.getElementById('salesTotalFinalProfit').textContent = formatINR(finalProfitTotal);
    document.getElementById('salesAvgProfit').textContent = total > 0 ? formatINR(grossProfitTotal / total) : '₹0';
    document.getElementById('salesOverheadPerPhone').textContent = formatINR(overheadPerPhone);
}

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    if (filteredSales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No sales found</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    filteredSales.forEach((item, idx) => {
        const purchase = item.value || 0;
        const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        const grossProfit = item.grossProfit !== undefined ? item.grossProfit : (item.salePrice - commission - purchase);
        const finalProfit = item.finalNetProfit !== undefined ? item.finalNetProfit : (grossProfit - overheadPerPhone);
        const profitClass = finalProfit >= 0 ? 'profit-green' : 'profit-red';
        const saleDate = item.saleDate || item.timestampIST || '—';
        const agent = item.agent || '—';
        html += `<tr class="order-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td>
            <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
            <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
            <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
            <td class="py-3 px-4 text-gray-600">${formatINR(purchase)}</td>
            <td class="py-3 px-4 font-bold text-gray-800">${formatINR(item.salePrice || 0)}</td>
            <td class="py-3 px-4"><span class="commission-badge">${formatINR(commission)}</span></td>
            <td class="py-3 px-4 font-bold text-indigo-600">${formatINR(grossProfit)}</td>
            <td class="py-3 px-4 text-amber-600 font-semibold">${formatINR(overheadPerPhone)}</td>
            <td class="py-3 px-4 font-bold ${profitClass}">${formatINR(finalProfit)}</td>
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
    const headers = ['Order ID', 'Model', 'IMEI', 'Purchase Price', 'Sale Price', 'Commission', 'Gross Profit', 'Overhead/Phone', 'Final Net Profit', 'Buyer', 'Buyer Contact', 'Sale Date', 'Agent'];
    const rows = filteredSales.map(item => {
        const purchase = item.value || 0;
        const c = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        const gp = item.grossProfit !== undefined ? item.grossProfit : (item.salePrice - c - purchase);
        const fp = item.finalNetProfit !== undefined ? item.finalNetProfit : (gp - overheadPerPhone);
        return [
            item.orderId || item.id || '',
            item.phoneModel || '',
            item.imei || '',
            purchase,
            item.salePrice || 0,
            c,
            gp,
            overheadPerPhone,
            fp,
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

// ================================================================
// SECTION 14: SELL MODAL
// ================================================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) { showToast('Order not found', 'error'); return; }
    sellOrderData = order;
    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellPurchasePrice').value = formatINR(order.value || 0);
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sellSaleDate').value = today;
    document.getElementById('sellProfitPreview').className = 'profit-preview neutral';
    document.getElementById('sellProfitPreview').textContent = 'Enter sale price to see profit (commission based on purchase price)';
    document.getElementById('sellModal').style.display = 'flex';
    lucide.createIcons();
    document.getElementById('sellSalePrice').oninput = updateSellProfitPreview;
    updateSellProfitPreview();
    setTimeout(() => document.getElementById('sellSalePrice').focus(), 300);
}

function updateSellProfitPreview() {
    const purchase = sellOrderData ? (sellOrderData.value || 0) : 0;
    const sale = parseFloat(document.getElementById('sellSalePrice').value) || 0;
    const commission = calculateCommission(purchase);
    const grossProfit = sale - purchase - commission;
    const finalProfit = grossProfit - overheadPerPhone;
    const preview = document.getElementById('sellProfitPreview');
    const breakdown = document.getElementById('sellProfitBreakdown');
    if (sale > 0) {
        document.getElementById('sellGrossProfit').textContent = formatINR(grossProfit);
        document.getElementById('sellOverhead').textContent = formatINR(overheadPerPhone);
        document.getElementById('sellFinalProfit').textContent = formatINR(finalProfit);
        preview.textContent = `Commission: ${formatINR(commission)} | Gross: ${formatINR(grossProfit)} | Final: ${formatINR(finalProfit)}`;
        preview.className = finalProfit >= 0 ? 'profit-preview positive' : 'profit-preview negative';
        breakdown.style.display = 'block';
    } else {
        preview.textContent = 'Enter sale price to see profit breakdown';
        preview.className = 'profit-preview neutral';
        breakdown.style.display = 'none';
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
    const grossProfit = salePrice - purchasePrice - commission;
    const finalProfit = grossProfit - overheadPerPhone;

    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div class="text-left">
                <p><strong>Order:</strong> ${sellOrderData.orderId}</p>
                <p><strong>Model:</strong> ${sellOrderData.phoneModel}</p>
                <p><strong>Purchase:</strong> ${formatINR(purchasePrice)}</p>
                <p><strong>Sale Price:</strong> ${formatINR(salePrice)}</p>
                <p><strong>Commission (on Purchase):</strong> ${formatINR(commission)}</p>
                <p><strong>Gross Profit:</strong> ${formatINR(grossProfit)}</p>
                <p><strong>Overhead/Phone:</strong> ${formatINR(overheadPerPhone)}</p>
                <p><strong>Final Net Profit:</strong> <span class="${finalProfit >= 0 ? 'text-green-600' : 'text-red-600'} font-bold">${formatINR(finalProfit)}</span></p>
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
            grossProfit: grossProfit,
            finalNetProfit: finalProfit,
            buyerName: buyerName,
            buyerContact: buyerContact || '',
            saleDate: saleDate,
            saleTimestamp: new Date().toISOString()
        };
        await db.ref('pickups/' + sellOrderData.id).update(updates);
        showToast(`✅ Sold! Final Net Profit: ${formatINR(finalProfit)}`, 'success');

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

// ================================================================
// SECTION 15: VIEW ORDER DETAIL (FIXED with try-catch)
// ================================================================
function viewOrder(orderId) {
    console.log('viewOrder called with:', orderId);
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
        if (!item) {
            content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found in database</p></div>`;
            showToast('Order not found', 'error');
            return;
        }
        try {
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
        } catch (e) {
            console.error('Error rendering detail view:', e);
            content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error rendering order: ${e.message}</p></div>`;
            showToast('Error rendering order', 'error');
        }
    }).catch(err => {
        console.error('Firebase read error:', err);
        content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading: ${err.message}</p></div>`;
        showToast('Error loading order', 'error');
    });
}

function renderDetailView(item) {
    try {
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
        let grossProfitDisplay = '—', finalProfitDisplay = '—';
        // FIX (Sales View button): finalProfit / finalProfitClass must live in the
        // OUTER scope. Earlier they were declared with `const` inside this if-block
        // but used later inside saleHtml -> "finalProfit is not defined"
        // ReferenceError, which only triggered for sold items (Sales page).
        let finalProfit = 0, finalProfitClass = '';
        if (item.sold) {
            const commission = item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
            commissionDisplay = formatINR(commission);
            const grossProfit = item.profit !== undefined ? item.profit : ((item.salePrice || 0) - commission - (item.value || 0));
            finalProfit = grossProfit - overheadPerPhone;
            finalProfitClass = finalProfit >= 0 ? 'green' : 'red';
            profitDisplay = formatINR(grossProfit);
            profitClass = grossProfit >= 0 ? 'green' : 'red';
            grossProfitDisplay = formatINR(grossProfit);
            finalProfitDisplay = formatINR(finalProfit);
        }
        let saleHtml = '';
        if (item.sold) {
            saleHtml = `
                <div class="detail-item"><div class="label">Sale Price</div><div class="value green">${formatINR(item.salePrice || 0)}</div></div>
                <div class="detail-item"><div class="label">Commission (on Purchase)</div><div class="value amber">${commissionDisplay}</div></div>
                <div class="detail-item"><div class="label">Gross Profit</div><div class="value ${profitClass}">${grossProfitDisplay}</div></div>
                <div class="detail-item"><div class="label">Overhead / Phone</div><div class="value">${formatINR(overheadPerPhone)}</div></div>
                <div class="detail-item"><div class="label">Final Net Profit</div><div class="value ${finalProfitClass}">${finalProfitDisplay}</div></div>
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
        let html = `<div class="flex items-center gap-3 mb-4"><span class="badge-status ${statusClass} text-sm px-4 py-1.5">${displayName}</span><span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>${item.agent ? `<span class="text-xs text-gray-400">(Agent: ${item.agent})</span>` : ''}</div><div class="detail-grid"><div class="detail-item"><div class="label">Phone Model</div><div class="value" id="dv-model">${item.phoneModel || '—'}</div></div><div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs" id="dv-imei">${item.imei || '—'}</div></div>${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs" id="dv-imei2">${item.imei2}</div></div>` : ''}<div class="detail-item"><div class="label">Purchase Price</div><div class="value font-bold" id="dv-value">${item.value !== undefined && item.value !== null ? formatINR(item.value) : '—'}</div></div><div class="detail-item"><div class="label">Customer Name</div><div class="value" id="dv-customer">${item.customerName || '—'}</div></div><div class="detail-item"><div class="label">RAM / Storage</div><div class="value" id="dv-ramStorage">${getRamStorageText(item) || '—'}</div></div><div class="detail-item"><div class="label">Network</div><div class="value" id="dv-network">${item.networkType || '—'}</div></div><div class="detail-item"><div class="label">Reason</div><div class="value" id="dv-reason">${item.reason || '—'}</div></div><div class="detail-item"><div class="label">Status</div><div class="value" id="dv-status">${displayName}</div></div><div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs" id="dv-time">${item.timestampIST || item.timestamp || '—'}</div></div>${holdHtml}${saleHtml}</div>`;

        // Documents section
        const _billImgs = getDocImages(item, 'bill');
        const _aadImgs  = getDocImages(item, 'aadhaar');
        const _billNo   = item.billNumber || '';
        const _aadNo    = item.aadhaarNumber || '';
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
    } catch (e) {
        console.error('Error in renderDetailView:', e);
        document.getElementById('detailContent').innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Render error: ${e.message}</p></div>`;
        showToast('Error rendering details', 'error');
    }
}

// ================================================================
// SECTION 16: HOLD / UNHOLD
// ================================================================
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

// ================================================================
// SECTION 17: EDIT MODE (unchanged)
// ================================================================
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
        <div class="grid grid-cols-2 gap-2">
            <div><label class="edit-label">RAM <span class="text-gray-400 font-normal">(can be empty)</span></label><select id="edit-ram" class="edit-field">${buildOptionList(ADMIN_RAM_OPTIONS, getRam(item))}</select></div>
            <div><label class="edit-label">Storage <span class="text-gray-400 font-normal">(can be empty)</span></label><select id="edit-storage" class="edit-field">${buildOptionList(ADMIN_STORAGE_OPTIONS, getStorage(item))}</select></div>
        </div>
        <div><label class="edit-label">Network <span class="text-gray-400 font-normal">(can be empty)</span></label><select id="edit-network" class="edit-field">${buildOptionList(ADMIN_NETWORK_OPTIONS, item.networkType || '')}</select></div>
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
            <div><label class="edit-label">Gross Profit</label><input type="number" id="edit-grossProfit" value="${item.profit || ''}" class="edit-field" readonly style="background:#f1f5f9;"></div>
            <div><label class="edit-label">Final Net Profit</label><input type="number" id="edit-finalProfit" value="${(item.profit || 0) - overheadPerPhone}" class="edit-field" readonly style="background:#f1f5f9;"></div>
            <div><label class="edit-label">Buyer</label><input type="text" id="edit-buyer" value="${item.buyerName || ''}" class="edit-field" placeholder="Optional"></div>
            <div><label class="edit-label">Buyer Contact</label><input type="text" id="edit-buyerContact" value="${item.buyerContact || ''}" class="edit-field" placeholder="Optional"></div>
            <div><label class="edit-label">Sale Date</label><input type="date" id="edit-saleDate" value="${item.saleDate || ''}" class="edit-field"></div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;
    lucide.createIcons();
}

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

// ================================================================
// SECTION 18: SAVE EDIT (unchanged)
// ================================================================
async function saveEdit() {
    if (!detailOrderId) {
        showToast('No order selected', 'error');
        return;
    }

    const orderId = document.getElementById('edit-orderId').value.trim();
    const status = document.getElementById('edit-status').value;
    const model = document.getElementById('edit-model').value.trim();
    const imei = document.getElementById('edit-imei').value.trim();
    const imei2 = document.getElementById('edit-imei2').value.trim();
    const value = parseFloat(document.getElementById('edit-value').value) || 0;
    const customer = document.getElementById('edit-customer').value.trim();
    const reason = document.getElementById('edit-reason').value.trim();
    const ramVal = document.getElementById('edit-ram')?.value || '';
    const storageVal = document.getElementById('edit-storage')?.value || '';
    const networkVal = document.getElementById('edit-network')?.value || '';
    const datetimeVal = document.getElementById('edit-datetime').value;
    const salePrice = parseFloat(document.getElementById('edit-salePrice')?.value) || 0;
    const buyer = document.getElementById('edit-buyer')?.value.trim() || '';
    const buyerContact = document.getElementById('edit-buyerContact')?.value.trim() || '';
    const saleDate = document.getElementById('edit-saleDate')?.value || '';
    if (!orderId) { showToast('Order ID required', 'error'); return; }
    const billNumberVal    = (document.getElementById('edit-billNumber')?.value || '').trim();
    const aadhaarNumberVal = (document.getElementById('edit-aadhaarNumber')?.value || '').trim();

    let updated = {
        orderId,
        status,
        phoneModel: model || '',
        imei: imei || '',
        imei2: imei2 || '',
        value: value || 0,
        customerName: customer || '',
        reason: reason || '',
        ram: ramVal,
        storage: storageVal,
        ramStorage: (ramVal && storageVal) ? (ramVal + '/' + storageVal) : (ramVal || storageVal || ''),
        networkType: networkVal,
        billNumber: billNumberVal,
        aadhaarNumber: aadhaarNumberVal,
        timestamp: editData.timestamp,
        timestampIST: editData.timestampIST || ''
    };

    if (datetimeVal) {
        const d = new Date(datetimeVal);
        if (!isNaN(d)) {
            updated.timestamp = d.toISOString();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istTime = new Date(d.getTime() + istOffset);
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const dd = String(istTime.getUTCDate()).padStart(2,'0');
            const mmm = months[istTime.getUTCMonth()];
            const yyyy = istTime.getUTCFullYear();
            let hours = istTime.getUTCHours();
            const minutes = String(istTime.getUTCMinutes()).padStart(2,'0');
            const seconds = String(istTime.getUTCSeconds()).padStart(2,'0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const hh = String(hours).padStart(2,'0');
            updated.timestampIST = `${dd}-${mmm}-${yyyy}, ${hh}:${minutes}:${seconds} ${ampm} IST`;
        }
    }

    if (editData.sold) {
        const commission = calculateCommission(value);
        const grossProfit = salePrice - commission - value;
        const finalProfit = grossProfit - overheadPerPhone;
        updated.sold = true;
        updated.salePrice = salePrice || 0;
        updated.commission = commission;
        updated.buyerName = buyer || '';
        updated.buyerContact = buyerContact || '';
        updated.saleDate = saleDate || '';
        updated.profit = grossProfit;
        updated.grossProfit = grossProfit;
        updated.finalNetProfit = finalProfit;
    }

    if (status === 'on_hold' && editData.status !== 'on_hold') {
        updated.previous_status = editData.status;
        updated.hold_reason = reason || 'Manually held';
    } else if (status !== 'on_hold' && editData.status === 'on_hold') {
        updated.previous_status = null;
        updated.hold_reason = null;
    }

    const confirm = await Swal.fire({
        title: 'Save Changes?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes',
        cancelButtonText: 'Cancel',
        customClass: {
            popup: 'swal2-popup-custom'
        }
    });
    if (!confirm.isConfirmed) return;

    try {
        await db.ref('pickups/' + detailOrderId).update(updated);
        showToast('✅ Updated', 'success');
        loadOrders(); loadDashboard(); loadPendingAdmin(); loadRejectedAdmin(); loadInventory(); loadSales();
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
        console.error(e);
        showToast('Error updating', 'error');
    }
}

// ================================================================
// SECTION 19: DELETE ORDER
// ================================================================
async function deleteOrder(orderId) {
    const result = await Swal.fire({ title: 'Delete Order?', text: 'Cannot be undone.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b', confirmButtonText: 'Yes, delete', cancelButtonText: 'Cancel' });
    if (!result.isConfirmed) return;
    try { await db.ref('pickups/' + orderId).remove(); await db.ref('pending/' + orderId).remove(); showToast('🗑️ Deleted', 'success'); loadDashboard(); loadOrders(); loadPendingAdmin(); loadRejectedAdmin(); loadInventory(); loadSales(); closeDetail(); } catch (e) { showToast('Error deleting', 'error'); console.error(e); }
}
function deleteOrderFromDetail() { if (detailOrderId) deleteOrder(detailOrderId); }
function closeDetail() { document.getElementById('detailModal').style.display = 'none'; detailOrderId = null; isEditMode = false; document.getElementById('detailActions').style.display = 'flex'; document.getElementById('detailSaveActions').style.display = 'none'; }

// ================================================================
// SECTION 20: EXPORT CSV
// ================================================================
function exportCSV() {
    if (allOrders.length === 0) { showToast('No data', 'error'); return; }
    const headers = ['Order ID','Status','Model','RAM/Storage','Network','IMEI','IMEI2','Value','Customer','Reason','Time (IST)','Agent'];
    const rows = allOrders.map(item => [item.orderId || item.id || '', item.status || '', item.phoneModel || '', getRamStorageText(item) || '', item.networkType || '', item.imei || '', item.imei2 || '', item.value !== undefined ? item.value : '', item.customerName || '', item.reason || '', item.timestampIST || item.timestamp || '', item.agent || '']);
    let csv = '\uFEFF' + headers.join(',') + '\n';
    rows.forEach(row => { csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `flipkart_orders_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); showToast('📥 Exported', 'success');
}

// ================================================================
// SECTION 21: DEPOSITS
// ================================================================
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
    document.getElementById('depositTotal').textContent = formatINR(total);
    document.getElementById('depositCount').textContent = allDeposits.length;
    document.getElementById('depositCountDisplay').textContent = allDeposits.length + ' entries';
    document.getElementById('depositsBadge').textContent = allDeposits.length;

    let stockValue = 0;
    const snap = await db.ref('pickups').once('value');
    const data = snap.val() || {};
    Object.values(data).forEach(item => {
        if (item.status === 'pickup') {
            stockValue += item.value || 0;
        }
    });
    document.getElementById('depositStockValue').textContent = formatINR(stockValue);
    const balance = total - stockValue;
    document.getElementById('depositBalance').textContent = formatINR(balance);

    let totalCommission = 0;
    Object.values(data).forEach(item => {
        if (item.status === 'on_hold') return;
        totalCommission += item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
    });
    document.getElementById('depositCommission').textContent = formatINR(totalCommission);
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
            <td class="py-3 px-4 font-bold text-green-600">${formatINR(amount)}</td>
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
        text: `Amount: ${formatINR(amount)} | Date: ${date}`,
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

// ================================================================
// SECTION 22: AGENTS (UPDATED: is_active support + Leave/Reactivate)
// ================================================================
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
        document.getElementById('agentsBadge').textContent = agentsList.filter(u => u.role === 'agent' && u.is_active !== false).length;
        loadAgentsForFilter();
    } catch (e) { console.error(e); showToast('Error loading agents', 'error'); }
}

function renderAgentsTable() {
    const tbody = document.getElementById('agentsTableBody');
    if (agentsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No users</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }
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
        
        const isActive = item.is_active !== false;
        const statusBadge = isActive 
            ? '<span class="badge-status pickup" style="font-size:10px;">✅ Active</span>' 
            : '<span class="badge-status rejected" style="font-size:10px;">🚫 Left</span>';
        
        const leaveBtn = isActive
            ? `<button onclick="leaveAgent('${item.username}')" class="btn-action delete" title="Mark as Left"><i data-lucide="user-x"></i></button>`
            : `<button onclick="reactivateAgent('${item.username}')" class="btn-action approve" title="Reactivate"><i data-lucide="user-check"></i></button>`;
        
        const promoteBtn = isAgent ? `<button onclick="promoteToAdmin('${item.username}')" class="btn-action promote" title="Promote to Admin"><i data-lucide="user-cog"></i></button>` : '';
        
        html += `<tr class="user-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx+1}</td>
            <td class="py-3 px-4 font-medium text-gray-800">${item.name || '—'}</td>
            <td class="py-3 px-4 font-mono text-sm text-gray-700">${item.username}</td>
            <td class="py-3 px-4 hidden sm:table-cell">${roleDisplay}</td>
            <td class="py-3 px-4 hidden sm:table-cell">${statusBadge}</td>
            <td class="py-3 px-4 hidden sm:table-cell font-bold">${typeof salary === 'number' ? formatINR(salary) : salary}</td>
            <td class="py-3 px-4 hidden md:table-cell">${typeof pickupInc === 'number' ? formatINR(pickupInc) : pickupInc}</td>
            <td class="py-3 px-4 hidden lg:table-cell">${typeof rejectInc === 'number' ? formatINR(rejectInc) : rejectInc}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-gray-600">${item.mobile || '—'}</td>
            <td class="py-3 px-4 font-mono"><span class="pw-hidden">${pwDisplay}</span><button onclick="togglePassword('${item.username}')" class="btn-action show ml-1"><i data-lucide="${showPw ? 'eye-off' : 'eye'}"></i></button></td>
            <td class="py-3 px-4">
                <div class="promote-btn-wrap">
                    ${leaveBtn}
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

async function leaveAgent(username) {
    const { value: reason, isConfirmed } = await Swal.fire({
        title: `Agent "${username}" ko leave karna?`,
        text: 'Is agent ne job chhod di hai. Account permanently block ho jayega. Wapas login nahi kar payega.',
        input: 'text',
        inputPlaceholder: 'Reason (optional)',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Leave',
        cancelButtonText: 'Cancel'
    });
    if (!isConfirmed) return;

    try {
        const today = new Date().toISOString().split('T')[0];
        await db.ref('users/' + username).update({
            is_active: false,
            left_date: today,
            left_reason: reason || 'Left the job'
        });
        showToast(`✅ ${username} marked as left.`, 'success');
        loadAgents();
        loadDashboard();
        loadAttendance();
        loadSalaryData();
        await db.ref('users/' + username + '/forceLogout').set(true);
        setTimeout(() => {
            db.ref('users/' + username + '/forceLogout').remove().catch(() => {});
        }, 3000);
    } catch (e) {
        showToast('Error', 'error');
        console.error(e);
    }
}

async function reactivateAgent(username) {
    const confirm = await Swal.fire({
        title: `Reactivate "${username}"?`,
        text: 'Agent ka account dobara active ho jayega. Wapas login kar sakta hai aur attendance/salary mein include hoga.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Reactivate',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    try {
        await db.ref('users/' + username).update({
            is_active: true,
            left_date: null,
            left_reason: null
        });
        showToast(`✅ ${username} reactivated.`, 'success');
        loadAgents();
        loadDashboard();
        loadAttendance();
        loadSalaryData();
    } catch (e) {
        showToast('Error', 'error');
        console.error(e);
    }
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
            reject_incentive: null,
            is_active: true
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
        createdAt: Date.now(),
        joinDate: new Date().toISOString().split('T')[0],
        is_active: true
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

// ================================================================
// SECTION 23: AGENT ACTIVITY
// ================================================================
function viewAgentActivity(username) {
    const today = new Date().toISOString().split('T')[0];
    viewAgentActivityWithPeriod(username, { mode: 'today', date: today });
}

function viewAgentActivityWithPeriod(username, period) {
    const modal = document.getElementById('activityModal');
    const content = document.getElementById('activityContent');
    const title = document.getElementById('activityModalTitle');
    title.textContent = `Activity: ${username}`;
    modal.style.display = 'flex';
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span> Loading...</div>`;

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
        filterFn = () => true;
        periodLabel = 'All Time';
    }

    db.ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        const orders = Object.entries(data)
            .filter(([_, item]) => item.agent === username && filterFn(item.timestamp))
            .map(([id, item]) => ({ id, ...item }));
        orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        let pickupCount = 0, rejectCount = 0, rescheduleCount = 0, totalOrders = orders.length;
        orders.forEach(item => {
            if (item.status === 'pickup') pickupCount++;
            else if (item.status === 'rejected') rejectCount++;
            else if (item.status === 'reschedule') rescheduleCount++;
        });

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
            const value = item.value !== undefined ? formatINR(item.value) : '—';

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

// ================================================================
// SECTION 24: ATTENDANCE (active agents only)
// ================================================================
async function generateOTPs() {
    const usersSnap = await db.ref('users').once('value');
    const users = usersSnap.val() || {};
    const today = new Date().toISOString().split('T')[0];
    const agents = Object.keys(users).filter(uname => {
        const u = users[uname];
        const role = u.role || 'agent';
        return role === 'agent' && u.is_active !== false;
    });
    if (agents.length === 0) { showToast('No active agents to generate OTP for', 'error'); return; }
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
        const agents = Object.fromEntries(
            Object.entries(users).filter(([_, u]) => 
                (u.role || 'agent') === 'agent' && u.is_active !== false
            )
        );
        if (Object.keys(agents).length === 0) { container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No active agents</p></div>`; return; }
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

// ================================================================
// SECTION 25: SALARY / EARNINGS (active agents only for current view)
// ================================================================
function setSalaryMode(mode) {
    currentSalaryMode = mode;
    document.getElementById('salaryModeToday').classList.toggle('active', mode === 'today');
    document.getElementById('salaryModeSinceJoin').classList.toggle('active', mode === 'since_join');
    document.getElementById('salaryModeDate').classList.toggle('active', mode === 'date');
    document.getElementById('salaryDateWrapper').style.display = mode === 'date' ? 'inline-block' : 'none';

    const label = document.getElementById('salaryModeLabel');
    if (mode === 'today') {
        label.textContent = "Today's Earnings";
    } else if (mode === 'since_join') {
        label.textContent = "Earnings from Joining Date to Today";
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
        const agents = Object.fromEntries(
            Object.entries(users).filter(([_, u]) => 
                (u.role || 'agent') === 'agent' && u.is_active !== false
            )
        );
        const pickups = pickupsSnap.val() || {};
        const allAttendance = attendanceSnap.val() || {};

        if (Object.keys(agents).length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No active agents</p></div>`;
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
        } else if (mode === 'since_join') {
            periodInfo.mode = 'since_join';
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
            dateFilterFn = () => true;
            periodInfo.mode = 'all';
        }

        currentSalaryPeriod = periodInfo;

        const pickupsByAgentDate = {};
        const allRejectedOrders = [];

        let globalPickup = 0, globalReject = 0, globalPending = 0, globalEarnings = 0;

        const rejectDateFilter = (ordDate) => {
            if (mode === 'today') return ordDate === today;
            if (mode === 'date') return ordDate === periodInfo.date;
            return true;
        };

        for (const [oid, ord] of Object.entries(pickups)) {
            if (!ord.timestamp) continue;
            if (ord.status === 'on_hold') continue;
            const agent = ord.agent || 'unknown';
            if (!agents[agent]) continue;
            const ordDate = new Date(ord.timestamp).toISOString().split('T')[0];
            
            if (mode === 'today' || mode === 'date') {
                if (!dateFilterFn(ordDate)) continue;
            }
            
            const key = agent + '|' + ordDate;
            if (!pickupsByAgentDate[key]) pickupsByAgentDate[key] = [];
            pickupsByAgentDate[key].push(ord);
            
            if (ord.status === 'rejected' && !ord.incentive_approved && rejectDateFilter(ordDate)) {
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

            const joinDateStr = uData.joinDate || null;
            let joinDateObj = joinDateStr ? new Date(joinDateStr + 'T00:00:00') : null;

            let startDate, endDate;
            if (mode === 'since_join') {
                if (joinDateObj) {
                    startDate = new Date(joinDateObj);
                    endDate = new Date(today + 'T00:00:00');
                } else {
                    startDate = new Date('2020-01-01');
                    endDate = new Date(today + 'T00:00:00');
                }
            } else if (mode === 'today' || mode === 'date') {
                startDate = new Date((mode === 'date' ? periodInfo.date : today) + 'T00:00:00');
                endDate = new Date(startDate);
            } else {
                startDate = new Date(today + 'T00:00:00');
                endDate = new Date(today + 'T00:00:00');
            }

            let totalBaseSalary = 0;
            let totalPickupIncentive = 0;
            let totalRejectIncentive = 0;
            let detailsHtml = '';
            let pendingRejects = [];
            const userAttendance = allAttendance[uname] || {};
            let agentPickupCount = 0, agentRejectCount = 0, agentPendingCount = 0;

            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                const dateStr = currentDate.toISOString().split('T')[0];

                if (joinDateObj && currentDate < joinDateObj) {
                    currentDate.setDate(currentDate.getDate() + 1);
                    continue;
                }

                const att = userAttendance[dateStr] || {};
                const isPresent = att.status === 'present';
                const salaryCounted = att.salary_counted !== false;

                if (isPresent && salaryCounted) {
                    totalBaseSalary += perDaySalary;
                }

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

                currentDate.setDate(currentDate.getDate() + 1);
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
            globalPickup += agentPickupCount;
            globalReject += agentRejectCount;
            globalPending += agentPendingCount;

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

            const joinDateDisplay = joinDateObj ? joinDateObj.toISOString().split('T')[0] : '—';

            html += `<div class="glass rounded-2xl p-5 shadow-sm border border-gray-100 salary-summary-card">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAgentActivityWithPeriod('${uname}', ${JSON.stringify(currentSalaryPeriod).replace(/"/g, '&quot;')})">${uData.name}</span>
                        <span class="text-sm text-gray-500">(${uname})</span>
                        <span class="text-xs text-gray-400 ml-2">Joined: ${joinDateDisplay}</span>
                        <button onclick="viewAgentActivityWithPeriod('${uname}', ${JSON.stringify(currentSalaryPeriod).replace(/"/g, '&quot;')})" class="btn-action activity text-xs ml-2"><i data-lucide="activity"></i> Activity</button>
                        <span class="text-xs text-gray-400 ml-2">📦 ${agentPickupCount} | ❌ ${agentRejectCount} | ⏳ ${agentPendingCount}</span>
                    </div>
                    <div class="text-sm font-bold text-indigo-600">${formatINR(total)}</div>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-sm">
                    <div class="bg-gray-50 p-2 rounded"><span class="text-gray-500">Base Salary</span><br><span class="font-bold">${formatINR(totalBaseSalary)}</span></div>
                    <div class="bg-green-50 p-2 rounded"><span class="text-gray-500">Pickup Inc.</span><br><span class="font-bold text-green-700">${formatINR(totalPickupIncentive)}</span></div>
                    <div class="bg-amber-50 p-2 rounded"><span class="text-gray-500">Reject Inc.</span><br><span class="font-bold text-amber-700">${formatINR(totalRejectIncentive)}</span></div>
                </div>
                <div class="mt-2 text-xs text-gray-400">Attendance: ${detailsHtml}</div>
                ${pendingRejectsHtml}
            </div>`;
        }

        document.getElementById('globalPickups').textContent = globalPickup;
        document.getElementById('globalRejects').textContent = globalReject;
        document.getElementById('globalPending').textContent = globalPending;
        document.getElementById('globalEarnings').textContent = formatINR(globalEarnings);

        const filteredAllPending = [];
        const seenAll = new Set();
        for (const pr of allRejectedOrders) {
            if (!seenAll.has(pr.id)) {
                seenAll.add(pr.id);
                filteredAllPending.push(pr);
            }
        }

        if (filteredAllPending.length > 0) {
            html += `<div class="glass rounded-2xl p-5 shadow-sm border border-amber-200 bg-amber-50">
                <h4 class="font-bold text-amber-700 mb-2">📋 Pending Reject Approvals (${filteredAllPending.length})</h4>
                <div class="flex flex-wrap gap-2">`;
            filteredAllPending.forEach(pr => {
                const ordDate = pr.timestamp ? new Date(pr.timestamp).toISOString().split('T')[0] : '—';
                html += `<span class="text-sm bg-white px-3 py-1 rounded shadow flex items-center gap-2">
                    <span class="font-mono">${pr.orderId || pr.id}</span>
                    <span class="text-xs text-gray-500">(${pr.agent || '—'})</span>
                    <span class="text-xs text-gray-400">${ordDate}</span>
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

        html += `<div class="text-right font-bold text-xl mt-4">Grand Total: ${formatINR(grandTotal)}</div>`;
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

// ================================================================
// SECTION 26: GLOBAL SEARCH (Smart Search with Fuse.js)
// ================================================================
async function openGlobalSearch() {
    const modal = document.getElementById('globalSearchModal');
    const input = document.getElementById('globalSearchModalInput');
    const results = document.getElementById('globalSearchModalResults');
    modal.classList.add('open');
    input.value = '';
    results.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">Type to start searching</p></div>`;
    setTimeout(() => input.focus(), 300);

    if (allOrders.length === 0) {
        try {
            const pickupSnap = await db.ref('pickups').once('value');
            const data = pickupSnap.val() || {};
            allOrders = Object.entries(data).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
            allOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } catch (e) {
            console.error('Error fetching orders for global search:', e);
        }
    }

    if (inventoryList.length === 0) {
        try {
            const pickupSnap = await db.ref('pickups').once('value');
            const data = pickupSnap.val() || {};
            inventoryList = Object.entries(data).filter(([_, item]) => item.status === 'pickup' && !item.sold).map(([id, item]) => ({ id, ...item, billImages: undefined, billImage: undefined, aadhaarImages: undefined, aadhaarImage: undefined }));
            inventoryList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } catch (e) {
            console.error('Error fetching inventory for global search:', e);
        }
    }

    if (salesList.length === 0) {
        try {
            const pickupSnap = await db.ref('pickups').once('value');
            const data = pickupSnap.val() || {};
            salesList = Object.entries(data).filter(([_, item]) => item.sold === true && item.status !== 'on_hold').map(([id, item]) => ({ id, ...item }));
            salesList.sort((a, b) => (b.saleTimestamp || b.timestamp || 0) - (a.saleTimestamp || a.timestamp || 0));
        } catch (e) {
            console.error('Error fetching sales for global search:', e);
        }
    }

    if (agentsList.length === 0) {
        try {
            const usersSnap = await db.ref('users').once('value');
            const data = usersSnap.val() || {};
            agentsList = Object.entries(data).map(([username, item]) => {
                if (!item.role) item.role = 'agent';
                return { username, ...item };
            });
        } catch (e) {
            console.error('Error fetching agents for global search:', e);
        }
    }

    input.oninput = function() {
        const query = this.value.trim();
        if (!query) {
            results.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">Type to start searching</p></div>`;
            return;
        }

        const allData = [];

        allOrders.forEach(item => {
            allData.push({ ...item, _category: 'Orders', _type: 'order' });
        });

        inventoryList.forEach(item => {
            allData.push({ ...item, _category: 'Inventory', _type: 'inventory' });
        });

        salesList.forEach(item => {
            allData.push({ ...item, _category: 'Sales', _type: 'sale' });
        });

        agentsList.forEach(item => {
            allData.push({
                name: item.name,
                username: item.username,
                mobile: item.mobile,
                _category: 'Agents',
                _type: 'agent',
                id: item.username
            });
        });

        const fuse = new Fuse(allData, {
            keys: [
                'orderId', 'phoneModel', 'imei', 'customerName',
                'buyerName', 'agent', 'name', 'username', 'mobile', 'color', 'value'
            ],
            threshold: 0.3,
            includeScore: true,
            ignoreLocation: true,
            shouldSort: true,
            minMatchCharLength: 2
        });

        const resultItems = fuse.search(query);
        if (resultItems.length === 0) {
            results.innerHTML = `<div class="empty-state"><i data-lucide="search"></i><p class="text-sm font-medium">No results found</p></div>`;
            return;
        }

        const groups = {};
        resultItems.forEach(r => {
            const cat = r.item._category || 'Other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(r);
        });

        let html = '';
        for (const [cat, items] of Object.entries(groups)) {
            const catId = `cat-${cat.replace(/\s+/g, '-')}`;
            html += `<div class="category-group"><div class="category-title">${cat} <span class="count-badge">${items.length}</span></div>`;
            html += `<div id="${catId}-items">`;
            items.slice(0, 10).forEach(r => {
                const item = r.item;
                let label = '';
                let desc = '';
                let badge = '';
                let onClick = '';
                let locateFn = '';

                if (item._type === 'order' || item._type === 'inventory' || item._type === 'sale') {
                    const orderId = item.id || item.orderId;
                    label = item.orderId || item.id;
                    desc = item.phoneModel || '';
                    const status = item.status || '';
                    let statusClass = '';
                    let statusDisplay = status;
                    if (status === 'pickup') {
                        if (item.sold) { statusClass = 'sold'; statusDisplay = 'Sold'; }
                        else { statusClass = 'pickup'; statusDisplay = 'Pickup'; }
                    } else if (status === 'rejected') { statusClass = 'rejected'; statusDisplay = 'Rejected'; }
                    else if (status === 'reschedule') { statusClass = 'reschedule'; statusDisplay = 'Pending'; }
                    else if (status === 'on_hold') { statusClass = 'on_hold'; statusDisplay = 'Hold'; }
                    badge = statusDisplay ? `<span class="badge-status ${statusClass}">${statusDisplay}</span>` : '';
                    onClick = `onclick="viewOrder('${orderId}')"`;
                    locateFn = `onclick="locateItem({id:'${orderId}', type:'${item._type}'})"`;
                } else if (item._type === 'agent') {
                    label = item.name || item.username;
                    desc = item.username + (item.mobile ? ' | ' + item.mobile : '');
                    badge = `<span class="badge-status admin">Agent</span>`;
                    onClick = `onclick="viewAgentActivity('${item.username}')"`;
                    locateFn = `onclick="locateItem({username:'${item.username}', type:'agent'})"`;
                }

                html += `<div class="result-item" ${onClick}>
                    <div><span class="text-mono">${label}</span><span class="text-desc">${desc}</span></div>
                    <div class="action-buttons">
                        ${badge}
                        <button class="locate-btn" title="Locate" ${locateFn}>
                            <i data-lucide="map-pin" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>`;
            });
            html += `</div>`;

            if (items.length > 10) {
                html += `<div id="${catId}-hidden" style="display:none;">`;
                items.slice(10).forEach(r => {
                    const item = r.item;
                    let label = '';
                    let desc = '';
                    let badge = '';
                    let onClick = '';
                    let locateFn = '';

                    if (item._type === 'order' || item._type === 'inventory' || item._type === 'sale') {
                        const orderId = item.id || item.orderId;
                        label = item.orderId || item.id;
                        desc = item.phoneModel || '';
                        const status = item.status || '';
                        let statusClass = '';
                        let statusDisplay = status;
                        if (status === 'pickup') {
                            if (item.sold) { statusClass = 'sold'; statusDisplay = 'Sold'; }
                            else { statusClass = 'pickup'; statusDisplay = 'Pickup'; }
                        } else if (status === 'rejected') { statusClass = 'rejected'; statusDisplay = 'Rejected'; }
                        else if (status === 'reschedule') { statusClass = 'reschedule'; statusDisplay = 'Pending'; }
                        else if (status === 'on_hold') { statusClass = 'on_hold'; statusDisplay = 'Hold'; }
                        badge = statusDisplay ? `<span class="badge-status ${statusClass}">${statusDisplay}</span>` : '';
                        onClick = `onclick="viewOrder('${orderId}')"`;
                        locateFn = `onclick="locateItem({id:'${orderId}', type:'${item._type}'})"`;
                    } else if (item._type === 'agent') {
                        label = item.name || item.username;
                        desc = item.username + (item.mobile ? ' | ' + item.mobile : '');
                        badge = `<span class="badge-status admin">Agent</span>`;
                        onClick = `onclick="viewAgentActivity('${item.username}')"`;
                        locateFn = `onclick="locateItem({username:'${item.username}', type:'agent'})"`;
                    }

                    html += `<div class="result-item" ${onClick}>
                        <div><span class="text-mono">${label}</span><span class="text-desc">${desc}</span></div>
                        <div class="action-buttons">
                            ${badge}
                            <button class="locate-btn" title="Locate" ${locateFn}>
                                <i data-lucide="map-pin" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>`;
                });
                html += `</div>`;
                html += `<button class="show-more-btn" onclick="toggleShowMore('${catId}', ${items.length})">+${items.length - 10} more</button>`;
            }
            html += `</div>`;
        }
        results.innerHTML = html;
        lucide.createIcons();
    };
}

function closeGlobalSearch() {
    document.getElementById('globalSearchModal').classList.remove('open');
    document.getElementById('globalSearchModalInput').value = '';
}

function toggleShowMore(catId, totalItems) {
    const hiddenDiv = document.getElementById(catId + '-hidden');
    const btn = event.target;
    if (hiddenDiv.style.display === 'none') {
        hiddenDiv.style.display = 'block';
        btn.textContent = `Show less (${totalItems - 10} hidden)`;
    } else {
        hiddenDiv.style.display = 'none';
        btn.textContent = `+${totalItems - 10} more`;
    }
}

// ================================================================
// SECTION 27: LOCATE
// ================================================================
function locateItem(item) {
    if (item.type === 'order' || item.type === 'inventory' || item.type === 'sale') {
        let page = 'orders';
        if (item.type === 'inventory') page = 'inventory';
        else if (item.type === 'sale') page = 'sales';
        navigate(page);
        setTimeout(() => {
            let searchInput = null;
            if (page === 'orders') searchInput = document.getElementById('orderSearch');
            else if (page === 'inventory') searchInput = document.getElementById('inventorySearch');
            else if (page === 'sales') searchInput = document.getElementById('salesSearch');
            if (searchInput) {
                searchInput.value = item.id;
                if (page === 'orders') applyOrderSearch();
                else if (page === 'inventory') applyInventorySearch();
                else if (page === 'sales') applySalesFilters();
                showToast(`📍 Located in ${page}`, 'success');
            }
        }, 400);
    } else if (item.type === 'agent') {
        navigate('agents');
        showToast(`📍 Agent ${item.username} found in Agents page`, 'success');
    }
}

// ================================================================
// SECTION 28: LIVE SEARCH DROPDOWN
// ================================================================
function setupLiveSearch(inputId, dropdownId, dataSource, fields) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    let fuse = new Fuse(dataSource, {
        keys: fields,
        threshold: 0.3,
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 2
    });

    function updateFuse() {
        fuse = new Fuse(dataSource, {
            keys: fields,
            threshold: 0.3,
            includeScore: true,
            ignoreLocation: true,
            minMatchCharLength: 2
        });
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    const handleInput = debounce(function() {
        const query = this.value.trim();
        if (!query) {
            dropdown.classList.remove('open');
            dropdown.innerHTML = '';
            return;
        }

        updateFuse();
        const results = fuse.search(query);
        if (results.length === 0) {
            dropdown.innerHTML = `<div class="empty-dropdown">No matches found</div>`;
            dropdown.classList.add('open');
            return;
        }

        let html = '';
        const maxResults = 10;
        results.slice(0, maxResults).forEach((r, idx) => {
            const item = r.item;
            let primary = '';
            let secondary = '';
            let extra = [];
            let clickAction = '';
            let id = item.id || '';

            if (item.orderId) {
                primary = item.orderId;
                secondary = item.phoneModel || item.customerName || '';
                if (item.phoneModel) extra.push(item.phoneModel);
                if (item.imei) extra.push('IMEI: '+item.imei);
                if (item.customerName) extra.push('Cust: '+item.customerName);
                if (item.buyerName) extra.push('Buyer: '+item.buyerName);
                if (item.agent) extra.push('Agent: '+item.agent);
                if (id) clickAction = `onclick="viewOrder('${id}')"`;
            } else if (item.name) {
                primary = item.name;
                secondary = item.username || '';
                if (item.mobile) extra.push('📱 '+item.mobile);
                if (item.username) clickAction = `onclick="viewAgentActivity('${item.username}')"`;
            } else {
                primary = item.id || 'Item';
                if (id) clickAction = `onclick="viewOrder('${id}')"`;
            }
            const extraStr = extra.join(' · ');
            html += `<div class="dropdown-item" data-id="${id}" ${clickAction}>
                <div>
                    <div class="item-primary">${primary}</div>
                    <div class="item-secondary">${extraStr}</div>
                </div>
                ${item.value !== undefined ? `<span class="item-badge">${formatINR(item.value)}</span>` : ''}
            </div>`;
        });
        if (results.length > maxResults) {
            html += `<div class="dropdown-item" style="color:#94a3b8; font-size:0.8rem; text-align:center;">+${results.length - maxResults} more</div>`;
        }
        dropdown.innerHTML = html;
        dropdown.classList.add('open');

        dropdown.querySelectorAll('.dropdown-item[data-id]').forEach(el => {
            if (!el.hasAttribute('onclick')) {
                el.addEventListener('click', function(e) {
                    const id = this.dataset.id;
                    if (id) {
                        const item = dataSource.find(d => d.id === id || d.username === id);
                        if (item && item.username && !item.orderId) {
                            viewAgentActivity(item.username);
                        } else if (item && item.id) {
                            viewOrder(item.id);
                        }
                    }
                });
            }
        });
    }, 250);

    input.addEventListener('input', handleInput);
    input.addEventListener('focus', function() {
        if (this.value.trim()) {
            handleInput.call(this);
        }
    });

    document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target) && e.target !== input) {
            dropdown.classList.remove('open');
        }
    });

    return { updateFuse };
}

// ================================================================
// SECTION 29: REFRESH ALL
// ================================================================
function refreshAll() {
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing...', 'info');
    Promise.all([loadDashboard(), loadOrders(), loadPendingAdmin(), loadRejectedAdmin(), loadInventory(), loadSales(), loadDeposits(), loadAgents()]).then(() => { isRefreshing = false; showToast('✅ Refreshed', 'success'); }).catch(() => { isRefreshing = false; showToast('⚠️ Error', 'error'); });
}

// ================================================================
// SECTION 30: LIVE CLOCK
// ================================================================
function updateClock() { const now = new Date(); document.getElementById('liveTime').textContent = now.toTimeString().slice(0,8); }
setInterval(updateClock, 1000); updateClock();

// ================================================================
// SECTION 31: INITIALIZATION
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
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
    }, 300000);
    showToast('👋 Welcome', 'info', 2000);
});

// ================================================================
// SECTION 32: EVENT LISTENERS FOR MODALS & KEYBOARD
// ================================================================
document.getElementById('detailModal').addEventListener('click', function(e) { if (e.target === this) closeDetail(); });
document.getElementById('sellModal').addEventListener('click', function(e) { if (e.target === this) closeSellModal(); });
document.getElementById('activityModal').addEventListener('click', function(e) { if (e.target === this) closeActivityModal(); });
document.getElementById('imgViewerModal').addEventListener('click', function(e) { if (e.target === this) closeImageViewer(); });

document.getElementById('globalSearchModal').addEventListener('click', function(e) {
    if (e.target === this) closeGlobalSearch();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeDetail();
        closeSellModal();
        closeActivityModal();
        closeSidebar();
        closeGlobalSearch();
        closeImageViewer();
    }
});

setInterval(() => { lucide.createIcons(); }, 5000);