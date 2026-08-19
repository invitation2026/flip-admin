// File: script.js
// Admin Panel - Full Updated Script with Half Day Attendance Feature

// ================================================================
// FIREBASE CONFIG
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
// HELPERS
// ================================================================
const $ = (id) => document.getElementById(id);

const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};

const setHTML = (id, value) => {
  const el = $(id);
  if (el) el.innerHTML = value;
};

const setVal = (id, value) => {
  const el = $(id);
  if (el) el.value = value;
};

const getVal = (id) => {
  const el = $(id);
  return el ? el.value : '';
};

const formatINR = (num) => {
  if (num === undefined || num === null || isNaN(num)) return '₹0';
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(num));
};

function getLocalYMD(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

function debounce(fn, delay = 250) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

function isAfter12Local(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return false;

  // 12:00:00 ke baad wala time half day trigger karega
  return d.getHours() > 12 || (d.getHours() === 12 && (d.getMinutes() > 0 || d.getSeconds() > 0));
}

function formatAttTime(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getStatusClass(item) {
  const status = item.status || 'unknown';
  if (status === 'pickup') return item.sold ? 'sold' : 'pickup';
  if (status === 'rejected') return 'rejected';
  if (status === 'on_hold') return 'on_hold';
  return 'reschedule';
}

function getStatusDisplay(item) {
  const status = item.status || 'unknown';

  if (status === 'pickup') return item.sold ? 'Sold' : 'Pickup';
  if (status === 'rejected') return 'Rejected';

  if (status === 'on_hold') {
    if (item.previous_status) {
      const prev = item.previous_status === 'pickup'
        ? (item.sold ? 'Sold' : 'Pickup')
        : item.previous_status;
      return `Hold (was ${prev})`;
    }
    return 'Hold';
  }

  return 'Pending';
}

// ================================================================
// CACHE
// ================================================================
let cacheVersion = 0;
const CACHE_TTL = 60000;

const cache = {
  pickups: null,
  pending: null,
  users: null,
  deposits: null,
  attendance: null
};

const cacheTime = {
  pickups: 0,
  pending: 0,
  users: 0,
  deposits: 0,
  attendance: 0
};

function invalidate(...nodes) {
  nodes.forEach((n) => {
    cache[n] = null;
    cacheTime[n] = 0;
  });
  cacheVersion++;
}

async function getData(node, force = false) {
  const isFresh = cache[node] && (Date.now() - cacheTime[node] < CACHE_TTL);

  if (!force && isFresh) return cache[node];

  const snap = await db.ref(node).once('value');
  cache[node] = snap.val() || {};
  cacheTime[node] = Date.now();
  return cache[node];
}

// ================================================================
// DOC / IMAGE HELPERS
// ================================================================
const ADMIN_MAX_DOC_IMAGES = 3;
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
  const r = getRam(item);
  const st = getStorage(item);
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
  const legacy = which === 'bill' ? 'billImage' : 'aadhaarImage';

  const arr = Array.isArray(item[arrField]) ? item[arrField].slice() : [];
  if (!arr.length && item[legacy]) arr.push(item[legacy]);

  return arr.filter(Boolean);
}

function _compressImageFileAdmin(file, maxDimension = 800, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      const img = new Image();

      img.onload = function () {
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
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function _uploadImageToStorageAdmin(file, orderId, docType, index) {
  if (!file) throw new Error('No file');
  if (!orderId) throw new Error('Order ID required');

  const fileExt = file.name.split('.').pop() || 'jpg';
  const fileName = `${orderId}_${docType}_${index}.${fileExt}`;
  const storageRef = storage.ref(`pickup_docs/${orderId}/${docType}/${fileName}`);

  const compressedDataUrl = await _compressImageFileAdmin(file, 800, 0.55);
  const blob = await (await fetch(compressedDataUrl)).blob();
  const snapshot = await storageRef.put(blob, { contentType: 'image/jpeg' });

  return snapshot.ref.getDownloadURL();
}

async function _deleteImageFromStorageAdmin(url) {
  if (!url) return;

  try {
    const ref = storage.refFromURL(url);
    await ref.delete();
  } catch (e) {
    console.warn('Could not delete image:', e);
  }
}

function _pickImageSource(useCamera) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    if (useCamera) input.capture = 'environment';

    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

function openImageViewer(src, title) {
  try {
    const modal = $('imgViewerModal');
    if (!modal) return;

    let img = $('imgViewerImage');
    let caption = $('imgViewerCaption');

    if (!img) {
      modal.innerHTML = `
        <div style="position:relative; max-width:90vw; max-height:90vh; background:#000; border-radius:12px; padding:10px;">
          <button onclick="closeImageViewer()" style="position:absolute; top:10px; right:10px; z-index:20; background:#dc2626; color:white; border:none; border-radius:8px; padding:8px 12px;">Close</button>
          <img id="imgViewerImage" src="${src}" style="max-width:100%; max-height:85vh; display:block; margin:0 auto;" alt="Document">
          <div id="imgViewerCaption" style="color:white; text-align:center; margin-top:8px;">${title || ''}</div>
        </div>
      `;
    } else {
      img.src = src;
      if (caption) caption.textContent = title || '';
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  } catch (e) {
    console.error(e);
  }
}

function closeImageViewer() {
  try {
    const modal = $('imgViewerModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  } catch (e) {}
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
    denyButtonText: '🖼️ Gallery',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#4f46e5',
    denyButtonColor: '#0ea5e9'
  });

  if (choice.isDismissed) return;

  const files = await _pickImageSource(choice.isConfirmed);
  if (!files.length) return;

  Swal.fire({ title: 'Uploading…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const room = ADMIN_MAX_DOC_IMAGES - current.length;
    const toDo = files.slice(0, room);
    const uploadPromises = [];

    for (let i = 0; i < toDo.length; i++) {
      const idx = current.length + i;
      uploadPromises.push(_uploadImageToStorageAdmin(toDo[i], detailOrderId, which, idx));
    }

    const urls = await Promise.all(uploadPromises);

    if (!urls.length) {
      Swal.close();
      showToast('Upload failed', 'error');
      return;
    }

    const newArr = current.concat(urls);
    const arrField = which === 'bill' ? 'billImages' : 'aadhaarImages';
    const legacyField = which === 'bill' ? 'billImage' : 'aadhaarImage';

    await db.ref('pickups/' + detailOrderId).update({
      [arrField]: newArr,
      [legacyField]: newArr[0] || null
    });

    invalidate('pickups');
    Swal.close();
    showToast(`✅ ${urls.length} image${urls.length > 1 ? 's' : ''} uploaded`, 'success');

    const snap = await db.ref('pickups/' + detailOrderId).once('value');
    const it = snap.val();

    if (it) {
      editData = { ...it, id: detailOrderId };
      renderDetailView(it);
    }

    loadOrders(true);
  } catch (e) {
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

  const isAll = idx === undefined || idx === null;

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

    invalidate('pickups');
    showToast(`🗑️ Deleted ${urlsToDelete.length} image(s)`, 'success');

    const snap = await db.ref('pickups/' + detailOrderId).once('value');
    const it = snap.val();

    if (it) {
      editData = { ...it, id: detailOrderId };
      renderDetailView(it);
    }

    loadOrders(true);
  } catch (e) {
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

    invalidate('pickups');
    showToast('✅ Updated', 'success');

    const snap = await db.ref('pickups/' + detailOrderId).once('value');
    const it = snap.val();

    if (it) {
      editData = { ...it, id: detailOrderId };
      renderDetailView(it);
    }

    loadOrders(true);
  } catch (e) {
    showToast('Update failed', 'error');
    console.error(e);
  }
}

// ================================================================
// COMMISSION
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
      }
      return bracket.value;
    }
  }

  return 0;
}

// ================================================================
// STATE
// ================================================================
let allOrders = [];
let filteredOrders = [];
let ordersById = new Map();

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

let overheadPerPhone = 0;
let overheadCache = { version: -1, value: 0 };

// ================================================================
// TOAST
// ================================================================
const toastEl = $('toast');

function showToast(msg, type = 'info', duration = 3000) {
  if (!toastEl) return;

  toastEl.textContent = msg;
  toastEl.className = 'toast-fixed ' + type;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');

  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ================================================================
// SIDEBAR / NAV
// ================================================================
function toggleSidebar() {
  $('sidebar')?.classList.toggle('open');
  $('sidebarOverlay')?.classList.toggle('open');
}

function closeSidebar() {
  $('sidebar')?.classList.remove('open');
  $('sidebarOverlay')?.classList.remove('open');
}

function navigate(page) {
  currentPageView = page;

  document.querySelectorAll('.sidebar-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  document.querySelectorAll('.page-content').forEach(el => {
    el.style.display = 'none';
  });

  const target = $('page-' + page);

  if (target) {
    target.style.display = 'block';
    target.classList.remove('fade-in');
    void target.offsetWidth;
    target.classList.add('fade-in');
  }

  closeSidebar();
  refreshCurrentPage(false);
}

function refreshCurrentPage(force = false) {
  if (currentPageView === 'dashboard') loadDashboard(force);
  else if (currentPageView === 'orders') { loadOrders(force); loadAgentsForFilter(force); }
  else if (currentPageView === 'pending') loadPendingAdmin(force);
  else if (currentPageView === 'rejected') loadRejectedAdmin(force);
  else if (currentPageView === 'inventory') loadInventory(force);
  else if (currentPageView === 'sales') loadSales(force);
  else if (currentPageView === 'deposits') loadDeposits(force);
  else if (currentPageView === 'attendance') loadAttendance(force);
  else if (currentPageView === 'salary') loadSalaryData(force);
  else if (currentPageView === 'agents') loadAgents(force);
}

// ================================================================
// DASHBOARD
// ================================================================
async function loadDashboard(force = false) {
  try {
    const [pickups, pending, users, deposits, attendance] = await Promise.all([
      getData('pickups', force),
      getData('pending', force),
      getData('users', force),
      getData('deposits', force),
      getData('attendance', force)
    ]);

    let total = 0;
    let pickupCount = 0;
    let rejectedCount = 0;
    let rescheduleCount = 0;
    let soldCount = 0;
    let unsoldCount = 0;
    let revenue = 0;
    let profit = 0;
    let totalCommission = 0;
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
          totalStockValue += item.value || 0;
        }
      } else if (item.status === 'rejected') {
        rejectedCount++;
      } else if (item.status === 'reschedule') {
        rescheduleCount++;
      }
    });

    const pendingCount = Object.keys(pending).length;
    const today = getLocalYMD();

    let totalAgents = 0;
    let presentToday = 0;

    for (const [uname, uData] of Object.entries(users)) {
      const role = uData.role || 'agent';
      if (role === 'agent' && uData.is_active !== false) {
        totalAgents++;

        const att = attendance[uname] && attendance[uname][today];
        if (att && att.status === 'present') presentToday++;
      }
    }

    let depositTotalAmount = 0;
    Object.values(deposits).forEach(d => {
      depositTotalAmount += d.amount || 0;
    });

    const totalOverhead = depositTotalAmount;
    const dashOverheadPerPhone = soldCount > 0 ? totalOverhead / soldCount : 0;
    const finalNetProfit = profit - (dashOverheadPerPhone * soldCount);

    setText('statTotal', total);
    setText('statPickup', pickupCount);
    setText('statRejected', rejectedCount);
    setText('statPending', pendingCount);
    setText('statInventory', unsoldCount);
    setText('statSold', soldCount);
    setText('statRevenue', formatINR(revenue));
    setText('statProfit', formatINR(profit));
    setText('statFinalProfit', formatINR(finalNetProfit));
    setText('statStockValue', formatINR(totalStockValue));
    setText('statAgents', totalAgents);
    setText('statPresentToday', presentToday);
    setText('statCommission', formatINR(totalCommission));

    setText('orderCountBadge', total);
    setText('pendingBadge', pendingCount);
    setText('rejectedBadge', rejectedCount);
    setText('inventoryBadge', unsoldCount);
    setText('salesBadge', soldCount);
    setText('agentsBadge', totalAgents);
    setText('attendanceBadge', presentToday + '/' + totalAgents);
    setText('depositsBadge', Object.keys(deposits).length);

    const recent = Object.entries(pickups)
      .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
      .slice(0, 10);

    const container = $('recentList');

    if (!recent.length) {
      setHTML('recentList', `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity yet</p></div>`);
    } else {
      let html = '';

      recent.forEach(([id, item]) => {
        html += `
          <div class="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 transition cursor-pointer" onclick="viewOrder('${id}')">
            <div class="flex items-center gap-3 min-w-0">
              <span class="badge-status ${getStatusClass(item)}">${getStatusDisplay(item)}</span>
              <span class="font-mono font-bold text-gray-700 text-sm truncate">${id}</span>
              <span class="text-xs text-gray-400 hidden sm:inline">${item.phoneModel || '—'}</span>
              <span class="text-xs text-gray-400 hidden md:inline">(${item.agent || '—'})</span>
            </div>
            <span class="text-[10px] text-gray-400 flex-shrink-0">${item.timestampIST || item.timestamp || ''}</span>
          </div>
        `;
      });

      setHTML('recentList', html);
    }

    refreshIcons();
  } catch (e) {
    console.error('Dashboard error:', e);
    showToast('Error loading dashboard', 'error');
  }
}

// ================================================================
// ORDERS
// ================================================================
async function loadOrders(force = false) {
  try {
    const data = await getData('pickups', force);

    allOrders = Object.entries(data).map(([id, item]) => ({
      id,
      ...item,
      billImages: undefined,
      billImage: undefined,
      aadhaarImages: undefined,
      aadhaarImage: undefined
    }));

    allOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    ordersById = new Map(allOrders.map(o => [o.id, o]));

    applyOrderFilter(currentOrderFilter);
    setupLiveSearch('orderSearch', 'orderSearchDropdown', allOrders, ['orderId', 'phoneModel', 'imei', 'customerName', 'agent', 'color']);
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

  const query = getVal('orderSearch').trim();

  if (query && window.Fuse) {
    const fuse = new Fuse(filtered, {
      keys: ['orderId', 'phoneModel', 'imei', 'customerName', 'agent', 'color'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true
    });
    filtered = fuse.search(query).map(r => r.item);
  }

  const dateFrom = getVal('orderDateFrom');
  const dateTo = getVal('orderDateTo');

  if (dateFrom) {
    filtered = filtered.filter(item => {
      if (!item.timestamp) return false;
      return getLocalYMD(new Date(item.timestamp)) >= dateFrom;
    });
  }

  if (dateTo) {
    filtered = filtered.filter(item => {
      if (!item.timestamp) return false;
      return getLocalYMD(new Date(item.timestamp)) <= dateTo;
    });
  }

  const agentFilter = getVal('orderAgentFilter');
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
  setVal('orderAgentFilter', 'all');
  applyOrderFilter(currentOrderFilter);
}

async function loadAgentsForFilter(force = false) {
  try {
    const data = await getData('users', force);
    const select = $('orderAgentFilter');
    if (!select) return;

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
    console.error(e);
  }
}

function applyOrderDateFilter() {
  applyOrderFilter(currentOrderFilter);
}

function clearOrderDateFilter() {
  setVal('orderDateFrom', '');
  setVal('orderDateTo', '');
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
  setVal('orderSearch', '');
  applyOrderFilter(currentOrderFilter);
}

function renderOrdersTable() {
  const tbody = $('ordersTableBody');
  if (!tbody) return;

  const total = filteredOrders.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageItems = filteredOrders.slice(start, end);

  setText('orderCountDisplay', total + ' orders');
  setText('orderPageInfo', `${currentPage} / ${totalPages}`);

  const prevBtn = $('prevOrderPageBtn');
  const nextBtn = $('nextOrderPageBtn');

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No orders match</p></div></td></tr>`;
    refreshIcons();
    return;
  }

  let html = '';

  pageItems.forEach((item, idx) => {
    const num = start + idx + 1;

    html += `
      <tr class="order-row border-b border-gray-50">
        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td>
        <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
        <td class="py-3 px-4"><span class="badge-status ${getStatusClass(item)}">${getStatusDisplay(item)}</span></td>
        <td class="py-3 px-4 hidden sm:table-cell text-gray-600 text-sm">${item.phoneModel || '—'}</td>
        <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
        <td class="py-3 px-4 hidden lg:table-cell font-bold text-gray-700">${item.value !== undefined && item.value !== null ? formatINR(item.value) : '—'}</td>
        <td class="py-3 px-4 hidden xl:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td>
        <td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${item.agent || '—'}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-1.5">
            <button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button>
            ${!item.sold && item.status === 'pickup' ? `<button onclick="openSellModalFromOrders('${item.id}')" class="btn-action sell"><i data-lucide="badge-dollar-sign"></i></button>` : ''}
            <button onclick="deleteOrder('${item.id}')" class="btn-action delete"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  refreshIcons();
}

async function openSellModalFromOrders(orderId) {
  let order = ordersById.get(orderId);

  if (!order) {
    try {
      const snap = await db.ref('pickups/' + orderId).once('value');
      const val = snap.val();
      if (val) order = { id: orderId, ...val };
    } catch (e) {
      console.error(e);
    }
  }

  if (!order) {
    showToast('Order not found', 'error');
    return;
  }

  if (order.sold) {
    showToast('Already sold', 'error');
    return;
  }

  if (order.status !== 'pickup') {
    showToast('Only pickup orders can be sold', 'error');
    return;
  }

  openSellModalWithOrder({ ...order, id: orderId });
}

function prevOrderPage() {
  if (currentPage > 1) {
    currentPage--;
    renderOrdersTable();
  }
}

function nextOrderPage() {
  const totalPages = Math.ceil(filteredOrders.length / pageSize);
  if (currentPage < totalPages) {
    currentPage++;
    renderOrdersTable();
  }
}

function refreshOrders() {
  loadOrders(true);
  loadAgentsForFilter(true);
  showToast('🔄 Orders refreshed', 'info');
}

// ================================================================
// PENDING ADMIN
// ================================================================
async function loadPendingAdmin(force = false) {
  try {
    const data = await getData('pending', force);

    const items = Object.entries(data).map(([id, item]) => ({ id, ...item }));
    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const container = $('pendingListAdmin');

    if (!items.length) {
      setHTML('pendingListAdmin', `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No pending orders</p></div>`);
    } else {
      let html = '';

      items.forEach(item => {
        const isOnWay = item.reason && item.reason.toLowerCase().includes('on the way');

        html += `
          <div class="pending-item glass rounded-xl p-4 shadow-sm border border-gray-100">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
                  ${isOnWay ? '<span class="badge-onway">🚗 On the way</span>' : '<span class="badge-pending">⏳ Pending</span>'}
                  <span class="text-xs text-gray-400">(Agent: ${item.agent || '—'})</span>
                </div>
                <p class="text-xs text-gray-500 mt-1"><i data-lucide="message-circle" class="w-3 h-3 inline"></i> ${item.reason || '—'}</p>
                <p class="text-xs text-gray-400 mt-0.5"><i data-lucide="clock" class="w-3 h-3 inline"></i> ${item.timestampIST || item.timestamp || ''}</p>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0 ml-3">
                <button onclick="deletePending('${item.id}')" class="btn-action delete"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          </div>
        `;
      });

      setHTML('pendingListAdmin', html);
    }

    refreshIcons();
    setText('pendingBadge', items.length);
  } catch (e) {
    console.error(e);
    showToast('Error loading pending', 'error');
  }
}

function refreshPending() {
  loadPendingAdmin(true);
  showToast('🔄 Pending refreshed', 'info');
}

async function deletePending(orderId) {
  const result = await Swal.fire({
    title: 'Remove from Pending?',
    text: 'Remove from pending list?',
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

    invalidate('pending');
    showToast('🗑️ Removed from pending', 'success');

    loadPendingAdmin(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error removing pending', 'error');
    console.error(e);
  }
}

// ================================================================
// REJECTED ADMIN
// ================================================================
async function loadRejectedAdmin(force = false) {
  try {
    const data = await getData('pickups', force);

    const items = Object.entries(data)
      .filter(([_, item]) => item.status === 'rejected')
      .map(([id, item]) => ({ id, ...item }));

    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const tbody = $('rejectedTableBody');

    if (!items.length) {
      setHTML('rejectedTableBody', `<tr><td colspan="7"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No rejected orders</p></div></td></tr>`);
    } else {
      let html = '';

      items.forEach((item, idx) => {
        const approved = Boolean(item.incentive_approved);
        const statusLabel = approved ? 'Approved' : 'Pending';
        const statusClass = approved ? 'approved' : 'reschedule';

        html += `
          <tr class="order-row border-b border-gray-50">
            <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
            <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
            <td class="py-3 px-4 text-gray-600 text-sm">${item.reason || '—'}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-gray-500 text-sm">${item.agent || '—'}</td>
            <td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-400">${item.timestampIST || item.timestamp || ''}</td>
            <td class="py-3 px-4"><span class="badge-status ${statusClass}">${statusLabel}</span></td>
            <td class="py-3 px-4">
              <div class="flex items-center gap-1.5">
                ${!approved
                  ? `<button onclick="toggleRejectApproval('${item.id}', true)" class="btn-action approve"><i data-lucide="check-circle"></i> Approve</button>`
                  : `<button onclick="toggleRejectApproval('${item.id}', false)" class="btn-action delete"><i data-lucide="x-circle"></i> Reject</button>`
                }
                <button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button>
              </div>
            </td>
          </tr>
        `;
      });

      setHTML('rejectedTableBody', html);
    }

    refreshIcons();
    setText('rejectedBadge', items.length);
  } catch (e) {
    console.error(e);
    showToast('Error loading rejected', 'error');
  }
}

function refreshRejected() {
  loadRejectedAdmin(true);
  showToast('🔄 Rejected refreshed', 'info');
}

async function toggleRejectApproval(orderId, approve) {
  const action = approve ? 'Approve' : 'Reject';

  const confirm = await Swal.fire({
    title: `${action} Rejection?`,
    text: approve
      ? 'This will count the reject incentive for the agent.'
      : 'This will remove the reject incentive from the agent earnings.',
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

    if (!item) {
      showToast('Order not found', 'error');
      return;
    }

    const updates = {
      incentive_approved: approve,
      incentive_paid: false
    };

    if (approve) {
      updates.incentive_approved_at = Date.now();
    }

    await db.ref('pickups/' + orderId).update(updates);

    if (!approve) {
      await db.ref('pickups/' + orderId + '/incentive_approved_at').remove();
    }

    invalidate('pickups');
    showToast(`✅ Reject ${action}d!`, 'success');

    loadRejectedAdmin(true);
    loadDashboard(true);

    if (currentPageView === 'salary') loadSalaryData(true);
  } catch (e) {
    showToast(`Error ${action}ing reject`, 'error');
    console.error(e);
  }
}

// ================================================================
// INVENTORY
// ================================================================
async function loadInventory(force = false) {
  try {
    const data = await getData('pickups', force);

    inventoryList = Object.entries(data)
      .filter(([_, item]) => item.status === 'pickup' && !item.sold)
      .map(([id, item]) => ({
        id,
        ...item,
        billImages: undefined,
        billImage: undefined,
        aadhaarImages: undefined,
        aadhaarImage: undefined
      }));

    inventoryList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    applyInventorySearch();
    setupLiveSearch('inventorySearch', 'inventorySearchDropdown', inventoryList, ['orderId', 'phoneModel', 'imei', 'customerName', 'color']);
  } catch (e) {
    console.error('Inventory error:', e);
    showToast('Error loading inventory', 'error');
  }
}

function applyInventorySearch() {
  const query = getVal('inventorySearch').trim();
  let filtered = inventoryList;

  if (query && window.Fuse) {
    const fuse = new Fuse(filtered, {
      keys: ['orderId', 'phoneModel', 'imei', 'customerName', 'color'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true
    });
    filtered = fuse.search(query).map(r => r.item);
  }

  filteredInventory = filtered;
  renderInventoryTable();
  setText('inventoryCount', filteredInventory.length + ' units');
}

function clearInventorySearch() {
  setVal('inventorySearch', '');
  applyInventorySearch();
}

function renderInventoryTable() {
  const tbody = $('inventoryTableBody');
  if (!tbody) return;

  if (!filteredInventory.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory available</p></div></td></tr>`;
    refreshIcons();
    return;
  }

  let html = '';

  filteredInventory.forEach((item, idx) => {
    const commission = calculateCommission(item.value || 0);

    html += `
      <tr class="order-row border-b border-gray-50">
        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
        <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
        <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
        <td class="py-3 px-4 hidden md:table-cell font-mono text-xs text-gray-500">${item.imei || '—'}</td>
        <td class="py-3 px-4 font-bold text-gray-700">${formatINR(item.value || 0)}</td>
        <td class="py-3 px-4"><span class="commission-col">${formatINR(commission)}</span></td>
        <td class="py-3 px-4 hidden lg:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td>
        <td class="py-3 px-4">
          <button onclick="openSellModal('${item.id}')" class="btn-action sell"><i data-lucide="badge-dollar-sign"></i> Sell</button>
          <button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  refreshIcons();
}

function refreshInventory() {
  loadInventory(true);
  showToast('🔄 Inventory refreshed', 'info');
}

// ================================================================
// SALES
// ================================================================
async function loadSales(force = false) {
  try {
    const [data, users, allAttendance] = await Promise.all([
      getData('pickups', force),
      getData('users', force),
      getData('attendance', force)
    ]);

    if (!force && overheadCache.version === cacheVersion && overheadCache.value > 0) {
      overheadPerPhone = overheadCache.value;
    } else {
      let totalOverhead = 0;
      const today = new Date();

      for (const [uname, uData] of Object.entries(users)) {
        const role = uData.role || 'agent';
        if (role !== 'agent') continue;

        const monthlySalary = uData.salary || 0;
        const perDaySalary = monthlySalary / 30;

        let joinDate = null;
        if (uData.joinDate) joinDate = new Date(uData.joinDate + 'T00:00:00');
        else if (uData.createdAt) joinDate = new Date(uData.createdAt);
        if (!joinDate) joinDate = new Date(today);

        let agentBaseSalary = 0;
        let currentDate = new Date(joinDate);

        while (currentDate <= today) {
          const dateStr = getLocalYMD(currentDate);
          const att = (allAttendance[uname] && allAttendance[uname][dateStr]) || {};

          const isPresent = att.status === 'present';
          const salaryCounted = att.salary_counted !== false;

          if (isPresent && salaryCounted) {
            let dayAmount = perDaySalary;

            // HALF DAY: 12 baje ke baad admin ne Half Day select kiya hai to 50% salary
            if (att.half_day === true) {
              dayAmount = perDaySalary * 0.5;
            }

            agentBaseSalary += dayAmount;
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        totalOverhead += agentBaseSalary;
      }

      let totalPickupIncentives = 0;
      let totalRejectIncentives = 0;

      Object.values(data).forEach(item => {
        if (item.status === 'on_hold') return;

        const agent = item.agent;
        if (!agent) return;

        const uData = users[agent];
        if (!uData || (uData.role || 'agent') !== 'agent') return;

        if (item.status === 'pickup') {
          totalPickupIncentives += uData.pickup_incentive || 0;
        } else if (item.status === 'rejected' && Boolean(item.incentive_approved)) {
          totalRejectIncentives += uData.reject_incentive || 0;
        }
      });

      totalOverhead += totalPickupIncentives + totalRejectIncentives;

      let totalSold = 0;
      Object.values(data).forEach(item => {
        if (item.status === 'pickup' && item.sold) totalSold++;
      });

      overheadPerPhone = totalSold > 0 ? totalOverhead / totalSold : 0;
      overheadCache = { version: cacheVersion, value: overheadPerPhone };
    }

    salesList = Object.entries(data)
      .filter(([_, item]) => item.sold === true && item.status !== 'on_hold')
      .map(([id, item]) => {
        const purchase = item.value || 0;
        const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
        const grossProfit = (item.salePrice || 0) - purchase - commission;
        const finalNetProfit = grossProfit - overheadPerPhone;

        return {
          id,
          ...item,
          commission,
          grossProfit,
          finalNetProfit
        };
      });

    salesList.sort((a, b) => (b.saleTimestamp || b.timestamp || 0) - (a.saleTimestamp || a.timestamp || 0));

    applySalesFilters();
    setText('salesBadge', salesList.length);

    setupLiveSearch('salesSearch', 'salesSearchDropdown', salesList, ['orderId', 'phoneModel', 'buyerName', 'agent', 'color']);
  } catch (e) {
    console.error('Sales error:', e);
    showToast('Error loading sales', 'error');
  }
}

function applySalesFilters() {
  const query = getVal('salesSearch').trim();
  const dateFrom = getVal('salesDateFrom');
  const dateTo = getVal('salesDateTo');

  let filtered = salesList;

  if (query && window.Fuse) {
    const fuse = new Fuse(filtered, {
      keys: ['orderId', 'phoneModel', 'buyerName', 'agent', 'color'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true
    });
    filtered = fuse.search(query).map(r => r.item);
  }

  if (dateFrom) filtered = filtered.filter(item => (item.saleDate || '') >= dateFrom);
  if (dateTo) filtered = filtered.filter(item => (item.saleDate || '') <= dateTo);

  filteredSales = filtered;
  renderSalesTable();
  updateSalesSummary();
}

function clearSalesFilters() {
  setVal('salesSearch', '');
  setVal('salesDateFrom', '');
  setVal('salesDateTo', '');
  applySalesFilters();
}

function updateSalesSummary() {
  const total = filteredSales.length;
  let revenue = 0;
  let grossProfitTotal = 0;
  let finalProfitTotal = 0;

  filteredSales.forEach(item => {
    const purchase = item.value || 0;
    const c = item.commission !== undefined ? item.commission : calculateCommission(purchase);

    revenue += (item.salePrice || 0) - c;

    const gp = item.grossProfit !== undefined ? item.grossProfit : (item.salePrice - c - purchase);
    grossProfitTotal += gp || 0;

    const fp = item.finalNetProfit !== undefined ? item.finalNetProfit : (gp - overheadPerPhone);
    finalProfitTotal += fp || 0;
  });

  setText('salesTotalCount', total);
  setText('salesTotalRevenue', formatINR(revenue));
  setText('salesTotalGrossProfit', formatINR(grossProfitTotal));
  setText('salesTotalFinalProfit', formatINR(finalProfitTotal));
  setText('salesAvgProfit', total > 0 ? formatINR(grossProfitTotal / total) : '₹0');
  setText('salesOverheadPerPhone', formatINR(overheadPerPhone));
}

function renderSalesTable() {
  const tbody = $('salesTableBody');
  if (!tbody) return;

  if (!filteredSales.length) {
    tbody.innerHTML = `<tr><td colspan="13"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No sales found</p></div></td></tr>`;
    refreshIcons();
    return;
  }

  let html = '';

  filteredSales.forEach((item, idx) => {
    const purchase = item.value || 0;
    const commission = item.commission !== undefined ? item.commission : calculateCommission(purchase);
    const grossProfit = item.grossProfit !== undefined ? item.grossProfit : (item.salePrice - commission - purchase);
    const finalProfit = item.finalNetProfit !== undefined ? item.finalNetProfit : (grossProfit - overheadPerPhone);
    const profitClass = finalProfit >= 0 ? 'profit-green' : 'profit-red';

    html += `
      <tr class="order-row border-b border-gray-50">
        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
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
        <td class="py-3 px-4 text-xs text-gray-500">${item.saleDate || item.timestampIST || '—'} (${item.agent || '—'})</td>
        <td class="py-3 px-4"><button onclick="viewOrder('${item.id}')" class="btn-action view"><i data-lucide="eye"></i></button></td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  refreshIcons();
}

function refreshSales() {
  loadSales(true);
  showToast('🔄 Sales refreshed', 'info');
}

function exportSalesCSV() {
  if (!filteredSales.length) {
    showToast('No data', 'error');
    return;
  }

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

  rows.forEach(row => {
    csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `sales_report_${getLocalYMD()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  showToast('📥 Sales CSV exported', 'success');
}

// ================================================================
// SELL MODAL
// ================================================================
function openSellModal(orderId) {
  const order = inventoryList.find(item => item.id === orderId) || ordersById.get(orderId);

  if (!order) {
    showToast('Order not found', 'error');
    return;
  }

  openSellModalWithOrder(order);
}

function openSellModalWithOrder(order) {
  sellOrderData = order;

  setVal('sellOrderId', order.orderId || order.id);
  setVal('sellModel', order.phoneModel || '—');
  setVal('sellPurchasePrice', formatINR(order.value || 0));
  setVal('sellSalePrice', '');
  setVal('sellBuyerName', '');
  setVal('sellBuyerContact', '');
  setVal('sellSaleDate', getLocalYMD());

  const preview = $('sellProfitPreview');
  if (preview) {
    preview.className = 'profit-preview neutral';
    preview.textContent = 'Enter sale price to see profit (commission based on purchase price)';
  }

  const modal = $('sellModal');
  if (modal) modal.style.display = 'flex';

  refreshIcons();

  const salePriceInput = $('sellSalePrice');
  if (salePriceInput) salePriceInput.oninput = updateSellProfitPreview;

  updateSellProfitPreview();

  setTimeout(() => {
    if (salePriceInput) salePriceInput.focus();
  }, 300);
}

function updateSellProfitPreview() {
  const purchase = sellOrderData ? (sellOrderData.value || 0) : 0;
  const sale = parseFloat(getVal('sellSalePrice')) || 0;
  const commission = calculateCommission(purchase);
  const grossProfit = sale - purchase - commission;
  const finalProfit = grossProfit - overheadPerPhone;

  const preview = $('sellProfitPreview');
  const breakdown = $('sellProfitBreakdown');

  if (sale > 0) {
    setText('sellGrossProfit', formatINR(grossProfit));
    setText('sellOverhead', formatINR(overheadPerPhone));
    setText('sellFinalProfit', formatINR(finalProfit));

    if (preview) {
      preview.textContent = `Commission: ${formatINR(commission)} | Gross: ${formatINR(grossProfit)} | Final: ${formatINR(finalProfit)}`;
      preview.className = finalProfit >= 0 ? 'profit-preview positive' : 'profit-preview negative';
    }

    if (breakdown) breakdown.style.display = 'block';
  } else {
    if (preview) {
      preview.textContent = 'Enter sale price to see profit breakdown';
      preview.className = 'profit-preview neutral';
    }

    if (breakdown) breakdown.style.display = 'none';
  }
}

function closeSellModal() {
  const modal = $('sellModal');
  if (modal) modal.style.display = 'none';
  sellOrderData = null;
}

async function confirmSell() {
  if (!sellOrderData) return;

  const salePrice = parseFloat(getVal('sellSalePrice'));
  const buyerName = getVal('sellBuyerName').trim();
  const buyerContact = getVal('sellBuyerContact').trim();
  const saleDate = getVal('sellSaleDate');

  if (!salePrice || salePrice <= 0) {
    showToast('Valid sale price required', 'error');
    return;
  }

  if (!buyerName) {
    showToast('Buyer name required', 'error');
    return;
  }

  const purchasePrice = sellOrderData.value || 0;
  const commission = calculateCommission(purchasePrice);
  const grossProfit = salePrice - purchasePrice - commission;
  const finalProfit = grossProfit - overheadPerPhone;

  const confirm = await Swal.fire({
    title: 'Confirm Sale',
    html: `
      <div class="text-left">
        <p><strong>Order:</strong> ${sellOrderData.orderId || sellOrderData.id}</p>
        <p><strong>Model:</strong> ${sellOrderData.phoneModel || '—'}</p>
        <p><strong>Purchase:</strong> ${formatINR(purchasePrice)}</p>
        <p><strong>Sale Price:</strong> ${formatINR(salePrice)}</p>
        <p><strong>Commission:</strong> ${formatINR(commission)}</p>
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
    await db.ref('pickups/' + sellOrderData.id).update({
      sold: true,
      salePrice,
      commission,
      grossProfit,
      finalNetProfit: finalProfit,
      buyerName,
      buyerContact: buyerContact || '',
      saleDate,
      saleTimestamp: new Date().toISOString()
    });

    invalidate('pickups');
    showToast(`✅ Sold! Final Net Profit: ${formatINR(finalProfit)}`, 'success');

    closeSellModal();

    await Promise.allSettled([
      loadInventory(true),
      loadSales(true),
      loadDashboard(true)
    ]);

    if (currentPageView === 'sales') applySalesFilters();
  } catch (e) {
    console.error('Sale error:', e);
    showToast('Error saving sale', 'error');
  }
}

// ================================================================
// VIEW ORDER
// ================================================================
async function viewOrder(orderId) {
  detailOrderId = orderId;
  isEditMode = false;

  setText('detailModalTitle', 'Order Details');

  const modal = $('detailModal');
  const content = $('detailContent');

  if (!modal || !content) return;

  modal.style.display = 'flex';
  content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span><p class="text-sm text-gray-400 mt-2">Loading...</p></div>`;

  const detailActions = $('detailActions');
  const detailSaveActions = $('detailSaveActions');
  const detailEditBtn = $('detailEditBtn');
  const detailHoldBtn = $('detailHoldBtn');
  const detailUnholdBtn = $('detailUnholdBtn');

  if (detailActions) detailActions.style.display = 'flex';
  if (detailSaveActions) detailSaveActions.style.display = 'none';

  if (detailEditBtn) {
    detailEditBtn.textContent = '✏️ Edit';
    detailEditBtn.onclick = toggleEditMode;
  }

  if (detailHoldBtn) {
    detailHoldBtn.style.display = 'inline-flex';
    detailHoldBtn.onclick = holdOrderFromDetail;
  }

  if (detailUnholdBtn) detailUnholdBtn.style.display = 'none';

  try {
    const snap = await db.ref('pickups/' + orderId).once('value');
    const item = snap.val();

    if (!item) {
      content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`;
      showToast('Order not found', 'error');
      return;
    }

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
      if (detailHoldBtn) detailHoldBtn.style.display = 'none';
      if (detailUnholdBtn) {
        detailUnholdBtn.style.display = 'inline-flex';
        detailUnholdBtn.onclick = unholdOrderFromDetail;
      }
    } else {
      if (detailHoldBtn) detailHoldBtn.style.display = 'inline-flex';
      if (detailUnholdBtn) detailUnholdBtn.style.display = 'none';
    }
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading order</p></div>`;
    showToast('Error loading order', 'error');
  }
}

function renderDetailView(item) {
  try {
    const content = $('detailContent');
    if (!content) return;

    let commissionDisplay = '—';
    let grossProfitDisplay = '—';
    let finalProfitDisplay = '—';
    let profitClass = '';
    let finalProfitClass = '';

    if (item.sold) {
      const commission = item.commission !== undefined ? item.commission : calculateCommission(item.value || 0);
      const grossProfit = item.profit !== undefined ? item.profit : ((item.salePrice || 0) - commission - (item.value || 0));
      const finalProfit = grossProfit - overheadPerPhone;

      commissionDisplay = formatINR(commission);
      grossProfitDisplay = formatINR(grossProfit);
      finalProfitDisplay = formatINR(finalProfit);

      profitClass = grossProfit >= 0 ? 'green' : 'red';
      finalProfitClass = finalProfit >= 0 ? 'green' : 'red';
    }

    let saleHtml = '';

    if (item.sold) {
      saleHtml = `
        <div class="detail-item"><div class="label">Sale Price</div><div class="value green">${formatINR(item.salePrice || 0)}</div></div>
        <div class="detail-item"><div class="label">Commission</div><div class="value amber">${commissionDisplay}</div></div>
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
      holdHtml = `
        <div class="detail-item"><div class="label">Hold Reason</div><div class="value text-red-600">${item.hold_reason || '—'}</div></div>
        <div class="detail-item"><div class="label">Previous Status</div><div class="value">${item.previous_status || '—'}</div></div>
      `;
    }

    let html = `
      <div class="flex items-center gap-3 mb-4">
        <span class="badge-status ${getStatusClass(item)} text-sm px-4 py-1.5">${getStatusDisplay(item)}</span>
        <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</span>
        ${item.agent ? `<span class="text-xs text-gray-400">(Agent: ${item.agent})</span>` : ''}
      </div>

      <div class="detail-grid">
        <div class="detail-item"><div class="label">Phone Model</div><div class="value">${item.phoneModel || '—'}</div></div>
        <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs">${item.imei || '—'}</div></div>
        ${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs">${item.imei2}</div></div>` : ''}
        <div class="detail-item"><div class="label">Purchase Price</div><div class="value font-bold">${item.value !== undefined && item.value !== null ? formatINR(item.value) : '—'}</div></div>
        <div class="detail-item"><div class="label">Customer Name</div><div class="value">${item.customerName || '—'}</div></div>
        <div class="detail-item"><div class="label">RAM / Storage</div><div class="value">${getRamStorageText(item) || '—'}</div></div>
        <div class="detail-item"><div class="label">Network</div><div class="value">${item.networkType || '—'}</div></div>
        <div class="detail-item"><div class="label">Reason</div><div class="value">${item.reason || '—'}</div></div>
        <div class="detail-item"><div class="label">Status</div><div class="value">${getStatusDisplay(item)}</div></div>
        <div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs">${item.timestampIST || item.timestamp || '—'}</div></div>
        ${holdHtml}
        ${saleHtml}
      </div>
    `;

    const billImgs = getDocImages(item, 'bill');
    const aadImgs = getDocImages(item, 'aadhaar');

    const docCard = (which, label, num, imgs, colorClass) => {
      let gallery;

      if (!imgs.length) {
        gallery = `<div class="w-full h-32 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400 text-xs">No image</div>`;
      } else {
        gallery = `<div class="grid grid-cols-3 gap-2">` + imgs.map((img, i) => {
          const kb = Math.round((img.length * 3 / 4) / 1024);

          return `
            <div class="relative group">
              <img loading="lazy" src="${img}" onclick="openImageViewer('${esc(img)}','${label} ${i + 1}')" class="w-full h-24 object-cover rounded-lg border border-gray-200 cursor-zoom-in hover:opacity-90 transition" alt="${label} ${i + 1}">
              <button onclick="adminDeleteDocImage('${which}',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md hover:bg-red-700" title="Delete">✕</button>
              <div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center rounded-b-lg">${kb}KB</div>
            </div>
          `;
        }).join('') + `</div>`;
      }

      return `
        <div class="rounded-xl border border-gray-200 p-3 ${colorClass.card}">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-bold ${colorClass.text} uppercase tracking-wide">${label} <span class="text-[10px] text-gray-500 font-normal">(${imgs.length}/${ADMIN_MAX_DOC_IMAGES})</span></p>
            <button onclick="adminSaveDocNumber('${which}')" class="text-[11px] text-indigo-600 font-semibold hover:underline">✏️ Edit No.</button>
          </div>
          <div class="text-sm font-mono font-semibold text-gray-800 mb-2 break-all">${num || '<span class="text-gray-400 font-sans font-normal">— no number —</span>'}</div>
          ${gallery}
        </div>
      `;
    };

    html += `
      <div class="mt-5 pt-4 border-t border-gray-100">
        <p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">📄 Documents</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${docCard('bill', 'Bill', item.billNumber || '', billImgs, { card: 'bg-blue-50', text: 'text-blue-700' })}
          ${docCard('aadhaar', 'Aadhaar', item.aadhaarNumber || '', aadImgs, { card: 'bg-indigo-50', text: 'text-indigo-700' })}
        </div>
      </div>
    `;

    content.innerHTML = html;
    refreshIcons();
    editData = { ...item };
  } catch (e) {
    console.error('renderDetailView error:', e);
    setHTML('detailContent', `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Render error</p></div>`);
    showToast('Error rendering details', 'error');
  }
}

// ================================================================
// HOLD / UNHOLD / REVERT SALE
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

    if (!order) {
      showToast('Order not found', 'error');
      return;
    }

    await db.ref('pickups/' + detailOrderId).update({
      status: 'on_hold',
      hold_reason: reason,
      previous_status: order.status || 'pickup'
    });

    invalidate('pickups');
    showToast('⏸️ Order put on hold', 'success');

    closeDetail();
    refreshOrderRelated();
  } catch (e) {
    showToast('Error holding order', 'error');
    console.error(e);
  }
}

async function unholdOrderFromDetail() {
  if (!detailOrderId) return;

  const confirm = await Swal.fire({
    title: 'Unhold Order?',
    text: 'This will set the order status back to its previous state.',
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

    if (!order) {
      showToast('Order not found', 'error');
      return;
    }

    const previousStatus = order.previous_status || 'pickup';

    await db.ref('pickups/' + detailOrderId).update({
      status: previousStatus,
      hold_reason: null,
      previous_status: null
    });

    invalidate('pickups');
    showToast(`▶️ Order unheld. Reverted to ${previousStatus}`, 'success');

    closeDetail();
    refreshOrderRelated();
  } catch (e) {
    showToast('Error unholding order', 'error');
    console.error(e);
  }
}

async function revertSale() {
  if (!detailOrderId) return;

  const confirm = await Swal.fire({
    title: 'Revert Sale?',
    text: 'This will remove sale details and put the phone back in inventory.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Revert',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref('pickups/' + detailOrderId).update({
      sold: false,
      salePrice: null,
      buyerName: null,
      buyerContact: null,
      saleDate: null,
      saleTimestamp: null,
      grossProfit: null,
      finalNetProfit: null
    });

    invalidate('pickups');
    showToast('↩️ Sale reverted', 'success');

    closeDetail();
    refreshOrderRelated();
  } catch (e) {
    showToast('Error reverting sale', 'error');
    console.error(e);
  }
}

async function refreshOrderRelated() {
  invalidate('pickups', 'pending');

  await Promise.allSettled([
    loadOrders(true),
    loadPendingAdmin(true),
    loadRejectedAdmin(true),
    loadInventory(true),
    loadSales(true),
    loadDashboard(true)
  ]);
}

// ================================================================
// EDIT MODE
// ================================================================
function toggleEditMode() {
  if (isEditMode) return;

  isEditMode = true;

  setText('detailModalTitle', 'Edit Order');

  const actBar = $('detailActions');
  const saveBar = $('detailSaveActions');

  if (actBar) actBar.style.display = 'none';

  if (saveBar) {
    saveBar.style.setProperty('display', 'flex', 'important');
    saveBar.style.zIndex = '20';
  }

  const content = $('detailContent');
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

  const imeiVal = item.imei || '';
  const imei2Val = item.imei2 || '';
  const imeiOver = imeiVal.length > 15;
  const imei2Over = imei2Val.length > 15;

  let html = `
    <div class="space-y-4">
      <div><label class="edit-label">Order ID</label><input type="text" id="edit-orderId" value="${item.orderId || item.id || ''}" class="edit-field" readonly style="background:#f1f5f9;cursor:not-allowed;"></div>

      <div><label class="edit-label">Status</label>
        <select id="edit-status" class="status-select">
          <option value="pickup" ${item.status === 'pickup' ? 'selected' : ''}>Pickup</option>
          <option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="reschedule" ${item.status === 'reschedule' ? 'selected' : ''}>Pending</option>
          <option value="on_hold" ${item.status === 'on_hold' ? 'selected' : ''}>Hold</option>
        </select>
      </div>

      <div><label class="edit-label">Phone Model</label><input type="text" id="edit-model" value="${item.phoneModel || ''}" class="edit-field" placeholder="Optional"></div>

      <div><label class="edit-label">IMEI</label>
        <div class="imei-wrap">
          <input type="text" id="edit-imei" value="${item.imei || ''}" class="edit-field font-mono" maxlength="15" placeholder="15 digits max">
          <button id="imeiAllowBtn" class="imei-allow-btn ${imeiOver ? 'allowed' : ''}" onclick="toggleImeiLimit('edit-imei', 'imeiAllowBtn')">${imeiOver ? '✅ Unlimited' : 'Add more'}</button>
        </div>
      </div>

      <div><label class="edit-label">IMEI 2</label>
        <div class="imei-wrap">
          <input type="text" id="edit-imei2" value="${item.imei2 || ''}" class="edit-field font-mono" maxlength="15" placeholder="15 digits max">
          <button id="imei2AllowBtn" class="imei-allow-btn ${imei2Over ? 'allowed' : ''}" onclick="toggleImeiLimit('edit-imei2', 'imei2AllowBtn')">${imei2Over ? '✅ Unlimited' : 'Add more'}</button>
        </div>
      </div>

      <div><label class="edit-label">Purchase Price (₹)</label><input type="number" id="edit-value" value="${item.value !== undefined && item.value !== null ? item.value : ''}" class="edit-field" placeholder="Optional"></div>

      <div><label class="edit-label">Customer Name</label><input type="text" id="edit-customer" value="${item.customerName || ''}" class="edit-field" placeholder="Optional"></div>

      <div class="grid grid-cols-2 gap-2">
        <div><label class="edit-label">RAM</label><select id="edit-ram" class="edit-field">${buildOptionList(ADMIN_RAM_OPTIONS, getRam(item))}</select></div>
        <div><label class="edit-label">Storage</label><select id="edit-storage" class="edit-field">${buildOptionList(ADMIN_STORAGE_OPTIONS, getStorage(item))}</select></div>
      </div>

      <div><label class="edit-label">Network</label><select id="edit-network" class="edit-field">${buildOptionList(ADMIN_NETWORK_OPTIONS, item.networkType || '')}</select></div>

      <div><label class="edit-label">Reason</label><input type="text" id="edit-reason" value="${item.reason || ''}" class="edit-field" placeholder="Optional"></div>

      <div><label class="edit-label">Date & Time (IST)</label><input type="datetime-local" id="edit-datetime" value="${datetimeVal}" class="edit-field"></div>

      <div class="pt-3 border-t border-gray-100">
        <p class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📄 Documents</p>

        <div><label class="edit-label">Bill Number</label><input type="text" id="edit-billNumber" value="${item.billNumber || ''}" class="edit-field" placeholder="Optional"></div>

        <div class="mt-2">
          <label class="edit-label">Bill Images (${getDocImages(item, 'bill').length}/${ADMIN_MAX_DOC_IMAGES})</label>
          <button type="button" onclick="adminUploadDocImage('bill')" class="w-full py-2.5 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 text-blue-700 font-semibold text-sm">
            ${getDocImages(item, 'bill').length >= ADMIN_MAX_DOC_IMAGES ? '✅ Max reached' : '➕ Add Bill Image'}
          </button>
          ${getDocImages(item, 'bill').length ? `<div class="mt-2 grid grid-cols-3 gap-2">${getDocImages(item, 'bill').map((im, i) => `<div class="relative"><img loading="lazy" src="${im}" onclick="openImageViewer('${esc(im)}','Bill ${i + 1}')" class="w-full h-20 object-cover rounded-lg border cursor-zoom-in"><button type="button" onclick="adminDeleteDocImage('bill',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md">✕</button></div>`).join('')}</div>` : ''}
        </div>

        <div class="mt-3"><label class="edit-label">Aadhaar Number</label><input type="text" id="edit-aadhaarNumber" value="${item.aadhaarNumber || ''}" class="edit-field font-mono" placeholder="Optional" maxlength="14"></div>

        <div class="mt-2">
          <label class="edit-label">Aadhaar Images (${getDocImages(item, 'aadhaar').length}/${ADMIN_MAX_DOC_IMAGES})</label>
          <button type="button" onclick="adminUploadDocImage('aadhaar')" class="w-full py-2.5 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold text-sm">
            ${getDocImages(item, 'aadhaar').length >= ADMIN_MAX_DOC_IMAGES ? '✅ Max reached' : '➕ Add Aadhaar Image'}
          </button>
          ${getDocImages(item, 'aadhaar').length ? `<div class="mt-2 grid grid-cols-3 gap-2">${getDocImages(item, 'aadhaar').map((im, i) => `<div class="relative"><img loading="lazy" src="${im}" onclick="openImageViewer('${esc(im)}','Aadhaar ${i + 1}')" class="w-full h-20 object-cover rounded-lg border cursor-zoom-in"><button type="button" onclick="adminDeleteDocImage('aadhaar',${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold shadow-md">✕</button></div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>
  `;

  if (item.sold) {
    html += `
      <div class="border-t pt-3">
        <p class="font-bold">Sale Details</p>
        <div><label class="edit-label">Sale Price</label><input type="number" id="edit-salePrice" value="${item.salePrice || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Buyer</label><input type="text" id="edit-buyer" value="${item.buyerName || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Buyer Contact</label><input type="text" id="edit-buyerContact" value="${item.buyerContact || ''}" class="edit-field" placeholder="Optional"></div>
        <div><label class="edit-label">Sale Date</label><input type="date" id="edit-saleDate" value="${item.saleDate || ''}" class="edit-field"></div>
      </div>
    `;
  }

  content.innerHTML = html;
  refreshIcons();

  setTimeout(() => {
    setupImeiValidation('edit-imei', 'imeiAllowBtn');
    setupImeiValidation('edit-imei2', 'imei2AllowBtn');

    const saveBar = $('detailSaveActions');
    if (saveBar) {
      saveBar.style.setProperty('display', 'flex', 'important');
      try {
        saveBar.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } catch (_) {}
    }
  }, 100);
}

function toggleImeiLimit(inputId, btnId) {
  const input = $(inputId);
  const btn = $(btnId);

  if (!input || !btn) return;

  const currentMax = input.maxLength;

  if (currentMax === -1 || currentMax === 999) {
    Swal.fire({
      title: 'Limit IMEI to 15 digits?',
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
        if (input.value.length > 15) input.value = input.value.slice(0, 15);
        showToast('IMEI limited to 15 digits', 'info');
      }
    });
  } else {
    Swal.fire({
      title: 'Allow more than 15 digits?',
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
        showToast('IMEI limit removed', 'success');
      }
    });
  }
}

function setupImeiValidation(inputId, btnId) {
  const input = $(inputId);
  const btn = $(btnId);

  if (!input) return;

  input.addEventListener('input', function () {
    if (input.maxLength === 15 && this.value.length > 15) {
      Swal.fire({
        title: 'More than 15 digits?',
        text: 'Allow unlimited digits?',
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

  input.addEventListener('paste', function () {
    setTimeout(() => {
      if (input.maxLength === 15 && this.value.length > 15) {
        input.dispatchEvent(new Event('input'));
      }
    }, 50);
  });
}

function cancelEdit() {
  isEditMode = false;

  if (detailOrderId) {
    db.ref('pickups/' + detailOrderId).once('value').then(snap => {
      const item = snap.val();

      if (item) {
        renderDetailView(item);

        const detailActions = $('detailActions');
        const detailSaveActions = $('detailSaveActions');
        const detailEditBtn = $('detailEditBtn');

        if (detailActions) detailActions.style.display = 'flex';
        if (detailSaveActions) detailSaveActions.style.display = 'none';

        setText('detailModalTitle', 'Order Details');

        if (detailEditBtn) {
          detailEditBtn.textContent = '✏️ Edit';
          detailEditBtn.onclick = toggleEditMode;
        }

        editData = { ...item, id: detailOrderId };
      }
    });
  }
}

// ================================================================
// SAVE EDIT
// ================================================================
async function saveEdit() {
  if (!detailOrderId) {
    showToast('No order selected', 'error');
    return;
  }

  const orderId = getVal('edit-orderId').trim();
  const status = getVal('edit-status');
  const model = getVal('edit-model').trim();
  const imei = getVal('edit-imei').trim();
  const imei2 = getVal('edit-imei2').trim();
  const value = parseFloat(getVal('edit-value')) || 0;
  const customer = getVal('edit-customer').trim();
  const reason = getVal('edit-reason').trim();
  const ramVal = getVal('edit-ram') || '';
  const storageVal = getVal('edit-storage') || '';
  const networkVal = getVal('edit-network') || '';
  const datetimeVal = getVal('edit-datetime');
  const salePrice = parseFloat(getVal('edit-salePrice')) || 0;
  const buyer = getVal('edit-buyer').trim() || '';
  const buyerContact = getVal('edit-buyerContact').trim() || '';
  const saleDate = getVal('edit-saleDate') || '';

  if (!orderId) {
    showToast('Order ID required', 'error');
    return;
  }

  const billNumberVal = getVal('edit-billNumber').trim();
  const aadhaarNumberVal = getVal('edit-aadhaarNumber').trim();

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
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref('pickups/' + detailOrderId).update(updated);

    invalidate('pickups');
    showToast('✅ Updated', 'success');

    isEditMode = false;

    const snap = await db.ref('pickups/' + detailOrderId).once('value');
    const item = snap.val();

    if (item) {
      renderDetailView(item);

      const detailActions = $('detailActions');
      const detailSaveActions = $('detailSaveActions');
      const detailEditBtn = $('detailEditBtn');

      if (detailActions) detailActions.style.display = 'flex';
      if (detailSaveActions) detailSaveActions.style.display = 'none';

      setText('detailModalTitle', 'Order Details');

      if (detailEditBtn) {
        detailEditBtn.textContent = '✏️ Edit';
        detailEditBtn.onclick = toggleEditMode;
      }

      editData = { ...item, id: detailOrderId };
    }

    refreshOrderRelated();
  } catch (e) {
    console.error(e);
    showToast('Error updating', 'error');
  }
}

// ================================================================
// DELETE ORDER
// ================================================================
async function deleteOrder(orderId) {
  const result = await Swal.fire({
    title: 'Delete Order?',
    text: 'Cannot be undone.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, delete',
    cancelButtonText: 'Cancel'
  });

  if (!result.isConfirmed) return;

  try {
    const snap = await db.ref('pickups/' + orderId).once('value');
    const item = snap.val();

    if (item) {
      const billImages = getDocImages(item, 'bill');
      const aadhaarImages = getDocImages(item, 'aadhaar');
      const allImages = [...billImages, ...aadhaarImages];

      for (const url of allImages) {
        await _deleteImageFromStorageAdmin(url);
      }
    }

    await db.ref('pickups/' + orderId).remove();
    await db.ref('pending/' + orderId).remove();

    invalidate('pickups', 'pending');
    showToast('🗑️ Deleted', 'success');

    closeDetail();
    refreshOrderRelated();
  } catch (e) {
    showToast('Error deleting', 'error');
    console.error(e);
  }
}

function deleteOrderFromDetail() {
  if (detailOrderId) deleteOrder(detailOrderId);
}

function closeDetail() {
  const modal = $('detailModal');
  if (modal) modal.style.display = 'none';

  detailOrderId = null;
  isEditMode = false;

  const detailActions = $('detailActions');
  const detailSaveActions = $('detailSaveActions');

  if (detailActions) detailActions.style.display = 'flex';
  if (detailSaveActions) detailSaveActions.style.display = 'none';
}

// ================================================================
// EXPORT ORDERS CSV
// ================================================================
function exportCSV() {
  if (!allOrders.length) {
    showToast('No data', 'error');
    return;
  }

  const headers = ['Order ID', 'Status', 'Model', 'RAM/Storage', 'Network', 'IMEI', 'IMEI2', 'Value', 'Customer', 'Reason', 'Time (IST)', 'Agent'];

  const rows = allOrders.map(item => [
    item.orderId || item.id || '',
    item.status || '',
    item.phoneModel || '',
    getRamStorageText(item) || '',
    item.networkType || '',
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
  link.download = `flipkart_orders_${getLocalYMD()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  showToast('📥 Exported', 'success');
}

// ================================================================
// DEPOSITS
// ================================================================
async function loadDeposits(force = false) {
  try {
    const data = await getData('deposits', force);

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

  const dateFrom = getVal('depositDateFrom');
  const dateTo = getVal('depositDateTo');

  if (dateFrom) filtered = filtered.filter(item => item.date && item.date >= dateFrom);
  if (dateTo) filtered = filtered.filter(item => item.date && item.date <= dateTo);

  filteredDeposits = filtered;
  depositCurrentPage = 1;
  renderDepositsTable();
}

function applyDepositDateFilter() {
  applyDepositFilters();
}

function clearDepositDateFilter() {
  setVal('depositDateFrom', '');
  setVal('depositDateTo', '');
  applyDepositFilters();
  showToast('Date filters cleared', 'info');
}

async function updateDepositStats() {
  let total = 0;

  allDeposits.forEach(d => {
    total += d.amount || 0;
  });

  setText('depositTotal', formatINR(total));
  setText('depositCount', allDeposits.length);
  setText('depositCountDisplay', allDeposits.length + ' entries');
  setText('depositsBadge', allDeposits.length);

  let stockValue = 0;
  let totalCommission = 0;

  const pickups = cache.pickups || await getData('pickups', false);

  Object.values(pickups).forEach(item => {
    if (item.status === 'pickup') stockValue += item.value || 0;

    if (item.status !== 'on_hold') {
      totalCommission += item.commission !== undefined
        ? item.commission
        : calculateCommission(item.value || 0);
    }
  });

  setText('depositStockValue', formatINR(stockValue));
  setText('depositBalance', formatINR(total - stockValue));
  setText('depositCommission', formatINR(totalCommission));
}

function renderDepositsTable() {
  const tbody = $('depositsTableBody');
  if (!tbody) return;

  const total = filteredDeposits.length;
  const totalPages = Math.ceil(total / depositPageSize) || 1;
  if (depositCurrentPage > totalPages) depositCurrentPage = totalPages;

  const start = (depositCurrentPage - 1) * depositPageSize;
  const end = Math.min(start + depositPageSize, total);
  const pageItems = filteredDeposits.slice(start, end);

  setText('depositCountDisplay', total + ' entries');
  setText('depositPageInfo', `${depositCurrentPage} / ${totalPages}`);

  const prevBtn = $('prevDepositPageBtn');
  const nextBtn = $('nextDepositPageBtn');

  if (prevBtn) prevBtn.disabled = depositCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = depositCurrentPage >= totalPages;

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No deposits found</p></div></td></tr>`;
    refreshIcons();
    return;
  }

  let html = '';

  pageItems.forEach((item, idx) => {
    const num = start + idx + 1;

    html += `
      <tr class="order-row border-b border-gray-50">
        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${num}</td>
        <td class="py-3 px-4 font-bold text-green-600">${formatINR(item.amount || 0)}</td>
        <td class="py-3 px-4 text-gray-600 text-sm">${item.description || '—'}</td>
        <td class="py-3 px-4 hidden sm:table-cell text-xs text-gray-500">${item.date || '—'}</td>
        <td class="py-3 px-4 hidden md:table-cell text-xs text-gray-400">${item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}</td>
        <td class="py-3 px-4">
          <button onclick="deleteDeposit('${item.id}')" class="btn-action delete" title="Delete"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  refreshIcons();
}

function prevDepositPage() {
  if (depositCurrentPage > 1) {
    depositCurrentPage--;
    renderDepositsTable();
  }
}

function nextDepositPage() {
  const totalPages = Math.ceil(filteredDeposits.length / depositPageSize);

  if (depositCurrentPage < totalPages) {
    depositCurrentPage++;
    renderDepositsTable();
  }
}

function submitDeposit(e) {
  e.preventDefault();

  const amount = parseFloat(getVal('depositAmount'));
  const date = getVal('depositDate') || getLocalYMD();
  const description = getVal('depositDescription').trim();

  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

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

      await newRef.set({
        amount,
        date,
        description: description || '',
        timestamp: Date.now()
      });

      invalidate('deposits');
      showToast('✅ Deposit added successfully!', 'success');

      setVal('depositAmount', '');
      setVal('depositDescription', '');
      setVal('depositDate', getLocalYMD());

      loadDeposits(true);
      loadDashboard(true);
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

    invalidate('deposits');
    showToast('🗑️ Deposit deleted', 'success');

    loadDeposits(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error deleting deposit', 'error');
    console.error(e);
  }
}

function exportDepositsCSV() {
  if (!filteredDeposits.length) {
    showToast('No deposits to export', 'error');
    return;
  }

  const headers = ['Amount', 'Description', 'Date', 'Added On'];

  const rows = filteredDeposits.map(item => [
    item.amount || 0,
    item.description || '—',
    item.date || '—',
    item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'
  ]);

  let csv = '\uFEFF' + headers.join(',') + '\n';

  rows.forEach(row => {
    csv += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `deposits_${getLocalYMD()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  showToast('📥 Deposits CSV exported', 'success');
}

function refreshDeposits() {
  loadDeposits(true);
  showToast('🔄 Deposits refreshed', 'info');
}

// ================================================================
// AGENTS
// ================================================================
async function loadAgents(force = false) {
  try {
    const data = await getData('users', force);

    agentsList = Object.entries(data).map(([username, item]) => {
      if (!item.role) item.role = 'agent';
      return { username, ...item };
    });

    agentsList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    renderAgentsTable();
    setText('agentsBadge', agentsList.filter(u => u.role === 'agent' && u.is_active !== false).length);

    loadAgentsForFilter(force);
  } catch (e) {
    console.error(e);
    showToast('Error loading agents', 'error');
  }
}

function renderAgentsTable() {
  const tbody = $('agentsTableBody');
  if (!tbody) return;

  if (!agentsList.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No users</p></div></td></tr>`;
    refreshIcons();
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

    const promoteBtn = isAgent
      ? `<button onclick="promoteToAdmin('${item.username}')" class="btn-action promote" title="Promote to Admin"><i data-lucide="user-cog"></i></button>`
      : '';

    html += `
      <tr class="user-row border-b border-gray-50">
        <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
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
      </tr>
    `;
  });

  tbody.innerHTML = html;
  setText('agentsCount', agentsList.length + ' users');
  refreshIcons();
}

async function leaveAgent(username) {
  const { value: reason, isConfirmed } = await Swal.fire({
    title: `Agent "${username}" ko leave karna?`,
    text: 'Is agent ne job chhod di hai. Account block ho jayega.',
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
    const today = getLocalYMD();

    await db.ref('users/' + username).update({
      is_active: false,
      left_date: today,
      left_reason: reason || 'Left the job'
    });

    invalidate('users');
    showToast(`✅ ${username} marked as left.`, 'success');

    loadAgents(true);
    loadDashboard(true);
    loadAttendance(true);
    loadSalaryData(true);

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
    text: 'Agent ka account dobara active ho jayega.',
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

    invalidate('users');
    showToast(`✅ ${username} reactivated.`, 'success');

    loadAgents(true);
    loadDashboard(true);
    loadAttendance(true);
    loadSalaryData(true);
  } catch (e) {
    showToast('Error', 'error');
    console.error(e);
  }
}

async function promoteToAdmin(username) {
  const confirm = await Swal.fire({
    title: `Promote "${username}" to Admin?`,
    text: 'This will remove salary/incentive fields.',
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

    invalidate('users');
    showToast(`✅ ${username} is now an admin`, 'success');

    loadAgents(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error promoting user', 'error');
    console.error(e);
  }
}

async function forceLogout(username) {
  const result = await Swal.fire({
    title: `Force Logout "${username}"?`,
    text: 'Immediately log out the user.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes',
    cancelButtonText: 'Cancel'
  });

  if (!result.isConfirmed) return;

  try {
    await db.ref('users/' + username + '/forceLogout').set(true);
    showToast('✅ Force logout sent', 'success');
  } catch (e) {
    showToast('Error', 'error');
    console.error(e);
  }
}

function togglePassword(username) {
  passwordVisible[username] = !passwordVisible[username];
  renderAgentsTable();
}

async function deleteAgent(username) {
  const result = await Swal.fire({
    title: 'Delete User?',
    text: `Delete "${username}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes',
    cancelButtonText: 'Cancel'
  });

  if (!result.isConfirmed) return;

  try {
    await db.ref('users/' + username).remove();

    invalidate('users');
    showToast('✅ Deleted', 'success');

    loadAgents(true);
  } catch (e) {
    showToast('Error', 'error');
    console.error(e);
  }
}

function registerAgent(e) {
  e.preventDefault();

  const name = getVal('regName').trim();
  const username = getVal('regUsername').trim().toLowerCase();
  const password = getVal('regPassword').trim();
  const mobile = getVal('regMobile').trim();
  const aadhar = getVal('regAadhar').trim();
  const alternate = getVal('regAlternate').trim();

  const roleEl = document.querySelector('input[name="regRole"]:checked');
  const role = roleEl ? roleEl.value : 'agent';

  const salary = parseFloat(getVal('regSalary').trim()) || 0;
  const pickupIncentive = parseFloat(getVal('regPickupIncentive').trim()) || 0;
  const rejectIncentive = parseFloat(getVal('regRejectIncentive').trim()) || 0;

  const errorEl = $('agentError');
  const successEl = $('agentSuccess');

  if (errorEl) errorEl.style.display = 'none';
  if (successEl) successEl.style.display = 'none';

  if (!name || !username || !password || !mobile) {
    if (errorEl) {
      errorEl.textContent = 'Please fill Name, Username, Password, and Mobile.';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (username.length < 3 || password.length < 4 || mobile.length < 10) {
    if (errorEl) {
      errorEl.textContent = 'Username (3+), Password (4+), Mobile (10 digits).';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (role === 'agent' && (!salary || !pickupIncentive || !rejectIncentive)) {
    if (errorEl) {
      errorEl.textContent = 'For Agent, Salary, Pickup Incentive and Reject Incentive are required.';
      errorEl.style.display = 'block';
    }
    return;
  }

  const userData = {
    name,
    username,
    password,
    aadhar: aadhar || '',
    mobile,
    alternate: alternate || '',
    role,
    createdAt: Date.now(),
    joinDate: getLocalYMD(),
    is_active: true
  };

  if (role === 'agent') {
    userData.salary = salary;
    userData.pickup_incentive = pickupIncentive;
    userData.reject_incentive = rejectIncentive;
  }

  db.ref('users/' + username).once('value').then(snap => {
    if (snap.exists()) {
      if (errorEl) {
        errorEl.textContent = 'Username taken.';
        errorEl.style.display = 'block';
      }
      return;
    }

    return db.ref('users/' + username).set(userData);
  }).then(() => {
    if (successEl) {
      successEl.textContent = '✅ User registered!';
      successEl.style.display = 'block';
    }

    setVal('regName', '');
    setVal('regUsername', '');
    setVal('regPassword', '');
    setVal('regMobile', '');
    setVal('regAadhar', '');
    setVal('regAlternate', '');
    setVal('regSalary', '');
    setVal('regPickupIncentive', '');
    setVal('regRejectIncentive', '');

    invalidate('users');
    loadAgents(true);

    setTimeout(() => {
      if (successEl) successEl.style.display = 'none';
    }, 5000);
  }).catch(err => {
    console.error(err);
    if (errorEl) {
      errorEl.textContent = 'Something went wrong.';
      errorEl.style.display = 'block';
    }
  });
}

function toggleAdminFields() {
  const roleEl = document.querySelector('input[name="regRole"]:checked');
  const role = roleEl ? roleEl.value : 'agent';
  const agentFields = $('agentFields');

  if (role === 'admin') {
    if (agentFields) agentFields.style.display = 'none';

    $('regSalary')?.removeAttribute('required');
    $('regPickupIncentive')?.removeAttribute('required');
    $('regRejectIncentive')?.removeAttribute('required');
  } else {
    if (agentFields) agentFields.style.display = 'grid';

    $('regSalary')?.setAttribute('required', '');
    $('regPickupIncentive')?.setAttribute('required', '');
    $('regRejectIncentive')?.setAttribute('required', '');
  }
}

function showChangePasswordModal(username) {
  Swal.fire({
    title: `Change Password for "${username}"`,
    html: `<input type="password" id="newPassword" class="swal2-input" placeholder="New password" minlength="4"><input type="password" id="confirmPassword" class="swal2-input" placeholder="Confirm" minlength="4">`,
    showCancelButton: true,
    confirmButtonText: 'Update',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#4f46e5',
    preConfirm: () => {
      const newPw = $('newPassword')?.value;
      const confirmPw = $('confirmPassword')?.value;

      if (!newPw || newPw.length < 4) {
        Swal.showValidationMessage('Min 4 chars');
        return false;
      }

      if (newPw !== confirmPw) {
        Swal.showValidationMessage('No match');
        return false;
      }

      return newPw;
    }
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        await db.ref('users/' + username + '/password').set(result.value);

        invalidate('users');
        showToast('✅ Password updated', 'success');

        loadAgents(true);
      } catch (e) {
        showToast('Error', 'error');
        console.error(e);
      }
    }
  });
}

// ================================================================
// AGENT ACTIVITY
// ================================================================
function viewAgentActivity(username) {
  const today = getLocalYMD();
  viewAgentActivityWithPeriod(username, { mode: 'today', date: today });
}

async function viewAgentActivityWithPeriod(username, period) {
  const modal = $('activityModal');
  const content = $('activityContent');
  const title = $('activityModalTitle');

  if (!modal || !content) return;

  if (title) title.textContent = `Activity: ${username}`;

  modal.style.display = 'flex';
  content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span> Loading...</div>`;

  let filterFn;
  let periodLabel = '';

  if (period.mode === 'today') {
    const today = getLocalYMD();
    filterFn = (ts) => ts && getLocalYMD(new Date(ts)) === today;
    periodLabel = 'Today';
  } else if (period.mode === 'monthly') {
    const year = period.year;
    const month = period.month;

    filterFn = (ts) => {
      if (!ts) return false;
      const d = new Date(ts);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    };

    periodLabel = `${String(month).padStart(2, '0')}-${year}`;
  } else if (period.mode === 'date') {
    const date = period.date;
    filterFn = (ts) => ts && getLocalYMD(new Date(ts)) === date;
    periodLabel = date;
  } else {
    filterFn = () => true;
    periodLabel = 'All Time';
  }

  try {
    const data = await getData('pickups', false);

    const orders = Object.entries(data)
      .filter(([_, item]) => item.agent === username && filterFn(item.timestamp))
      .map(([id, item]) => ({ id, ...item }));

    orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let pickupCount = 0;
    let rejectCount = 0;
    let rescheduleCount = 0;
    const totalOrders = orders.length;

    orders.forEach(item => {
      if (item.status === 'pickup') pickupCount++;
      else if (item.status === 'rejected') rejectCount++;
      else if (item.status === 'reschedule') rescheduleCount++;
    });

    let allPickup = 0;
    let allReject = 0;
    let allReschedule = 0;
    let allTotal = 0;

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

    if (!orders.length) {
      html += `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No activity for this period</p></div>`;
      content.innerHTML = html;
      refreshIcons();
      return;
    }

    html += `<div class="space-y-2">`;

    orders.forEach(item => {
      let rejectActions = '';

      if (item.status === 'rejected') {
        const approved = Boolean(item.incentive_approved);
        const statusText = approved ? '✅ Approved' : '⏳ Pending';
        const approvalTime = item.incentive_approved_at ? new Date(item.incentive_approved_at).toLocaleString() : '—';

        rejectActions = `
          <span class="text-xs font-bold ${approved ? 'text-green-600' : 'text-amber-600'}">${statusText}</span>
          ${!approved
            ? `<button onclick="toggleRejectApproval('${item.id}', true)" class="btn-action approve text-xs py-0.5 px-2"><i data-lucide="check-circle"></i></button>`
            : `<button onclick="toggleRejectApproval('${item.id}', false)" class="btn-action delete text-xs py-0.5 px-2"><i data-lucide="x-circle"></i></button>`
          }
          ${approved ? `<span class="text-[10px] text-gray-400" title="Approved at ${approvalTime}">⏱️ ${approvalTime}</span>` : ''}
        `;
      }

      html += `
        <div class="activity-item flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 cursor-pointer" onclick="viewOrder('${item.id}')">
          <div class="flex items-center gap-3">
            <span class="badge-status ${getStatusClass(item)}">${getStatusDisplay(item)}</span>
            <span class="font-mono font-bold text-gray-700 text-sm">${item.orderId || item.id}</span>
            <span class="text-xs text-gray-400 hidden sm:inline">${item.phoneModel || '—'}</span>
            <span class="text-xs text-gray-400 hidden md:inline">${item.value !== undefined ? formatINR(item.value) : '—'}</span>
          </div>
          <div class="flex items-center gap-2">
            ${rejectActions}
            <span class="text-[10px] text-gray-400">${item.timestampIST || item.timestamp || ''}</span>
          </div>
        </div>
      `;
    });

    html += `</div>`;

    content.innerHTML = html;
    refreshIcons();
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error</p></div>`;
    showToast('Error', 'error');
  }
}

function closeActivityModal() {
  const modal = $('activityModal');
  if (modal) modal.style.display = 'none';
}

// ================================================================
// ATTENDANCE + HALF DAY FEATURE
// ================================================================
async function generateOTPs() {
  const users = await getData('users', true);
  const today = getLocalYMD();

  const agents = Object.keys(users).filter(uname => {
    const u = users[uname];
    const role = u.role || 'agent';
    return role === 'agent' && u.is_active !== false;
  });

  if (!agents.length) {
    showToast('No active agents to generate OTP for', 'error');
    return;
  }

  const confirm = await Swal.fire({
    title: 'Generate OTPs?',
    text: `Generate OTP for ${agents.length} agents for ${today}?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Generate',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    const updates = {};

    for (const uname of agents) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      updates[`daily_otp/${today}/${uname}`] = { otp, generated_at: Date.now() };
    }

    await db.ref().update(updates);

    showToast(`✅ OTPs generated for ${agents.length} agents`, 'success');
    loadAttendance(true);
  } catch (e) {
    showToast('Error generating OTPs', 'error');
    console.error(e);
  }
}

async function loadAttendance(force = false) {
  const dateInput = $('attendanceDate');

  if (dateInput && !dateInput.value) {
    dateInput.value = getLocalYMD();
  }

  const date = dateInput ? dateInput.value : getLocalYMD();
  const container = $('attendanceList');

  if (!container) return;

  container.innerHTML = `<div class="text-center py-4"><span class="spinner-sm"></span></div>`;

  try {
    const [users, allAttendance, otpSnap] = await Promise.all([
      getData('users', force),
      getData('attendance', force),
      db.ref('daily_otp/' + date).once('value')
    ]);

    const otps = otpSnap.val() || {};

    const agents = Object.fromEntries(
      Object.entries(users).filter(([_, u]) => (u.role || 'agent') === 'agent' && u.is_active !== false)
    );

    if (!Object.keys(agents).length) {
      container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No active agents</p></div>`;
      return;
    }

    let html = `<div class="space-y-3"><div class="text-sm font-bold text-gray-600 mb-2">📅 ${date}</div>`;

    for (const [uname, uData] of Object.entries(agents)) {
      const att = (allAttendance[uname] && allAttendance[uname][date]) || {};
      const otpData = otps[uname] || {};

      const isBlocked = att.blocked === true || uData.is_blocked === true;
      const status = att.status || 'Not Marked';

      let statusHtml = `<span class="text-gray-400">Not Marked</span>`;

      if (status === 'present') statusHtml = `<span class="attendance-present">✅ Present</span>`;
      else if (status === 'absent' && isBlocked) statusHtml = `<span class="attendance-blocked">🚫 Blocked</span>`;
      else if (status === 'absent') statusHtml = `<span class="attendance-absent">❌ Absent (Not Blocked)</span>`;

      const otp = otpData.otp || '—';

      const isPresent = status === 'present';
      const isLate = isPresent && att.timestamp && isAfter12Local(att.timestamp);

      let halfDayInfo = '';
      let halfDayActions = '';

      if (isLate) {
        const attTime = formatAttTime(att.timestamp);

        if (att.half_day === true) {
          halfDayInfo = `
            <div class="text-xs font-semibold text-red-600 mt-1">
              🌗 Half Day (50% salary) — ${attTime}
            </div>
          `;

          halfDayActions = `
            <button onclick="markHalfDay('${uname}','${date}', false)" class="btn-action approve">
              <i data-lucide="sun"></i> Full Day
            </button>
          `;
        } else if (att.half_day === false) {
          halfDayInfo = `
            <div class="text-xs font-semibold text-green-600 mt-1">
              ✅ Full Day (late arrival) — ${attTime}
            </div>
          `;

          halfDayActions = `
            <button onclick="markHalfDay('${uname}','${date}', true)" class="btn-action delete">
              <i data-lucide="moon"></i> Half Day
            </button>
          `;
        } else {
          halfDayInfo = `
            <div class="text-xs font-semibold text-amber-600 mt-1">
              ⚠️ 12:00 ke baad present (${attTime}) — Half day?
            </div>
          `;

          halfDayActions = `
            <button onclick="markHalfDay('${uname}','${date}', true)" class="btn-action delete">
              <i data-lucide="moon"></i> Half Day
            </button>
            <button onclick="markHalfDay('${uname}','${date}', false)" class="btn-action approve">
              <i data-lucide="sun"></i> Full Day
            </button>
          `;
        }
      }

      html += `
        <div class="attendance-card glass rounded-xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAttendanceHistory('${uname}')">${uData.name}</span>
            <span class="text-xs text-gray-500">(${uname})</span><br>
            <span class="text-xs">OTP: <strong class="otp-display text-sm">${otp}</strong></span>
            ${halfDayInfo}
          </div>

          <div class="text-sm">${statusHtml}</div>

          <div class="flex items-center gap-2 flex-wrap">
            ${att.status === 'absent' && isBlocked ? `<button onclick="unblockAgent('${uname}','${date}')" class="btn-action unblock"><i data-lucide="unlock"></i> Unblock</button>` : ''}
            ${att.status === 'absent' && !isBlocked ? `<button onclick="blockAgent('${uname}','${date}')" class="btn-action delete"><i data-lucide="lock"></i> Block</button>` : ''}
            ${!att.status || att.status === 'Not Marked' ? `<button onclick="markPresentManually('${uname}','${date}')" class="btn-action approve"><i data-lucide="check"></i> Mark Present</button>` : ''}
            ${halfDayActions}
          </div>
        </div>
      `;
    }

    html += `</div>`;

    container.innerHTML = html;
    refreshIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm text-red-500">Error loading</p></div>`;
    showToast('Error loading attendance', 'error');
  }
}

async function markHalfDay(username, date, isHalf) {
  const title = isHalf ? 'Half Day (50% cut) lagana hai?' : 'Full Day lagana hai?';

  const text = isHalf
    ? `${username} - ${date}: is din ka salary 50% count hoga.`
    : `${username} - ${date}: is din ka full salary count hoga.`;

  const confirm = await Swal.fire({
    title,
    text,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: isHalf ? '#dc2626' : '#059669',
    cancelButtonColor: '#64748b',
    confirmButtonText: isHalf ? 'Yes, Half Day' : 'Yes, Full Day',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref('attendance/' + username + '/' + date).update({
      half_day: isHalf,
      half_day_decided: true,
      half_day_decided_at: Date.now(),
      half_day_decided_by: 'admin'
    });

    invalidate('attendance');

    showToast(
      isHalf ? '🌗 Half Day applied (50% salary)' : '✅ Full Day applied',
      'success'
    );

    loadAttendance(true);
    loadDashboard(true);

    if (currentPageView === 'salary') loadSalaryData(true);
    if (currentPageView === 'sales') loadSales(true);
  } catch (e) {
    showToast('Error updating half day', 'error');
    console.error(e);
  }
}

async function viewAttendanceHistory(username) {
  const monthInput = $('salaryMonth');
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

    if (!userData) {
      showToast('User not found', 'error');
      return;
    }

    const allAtt = await getData('attendance', false);
    const userAtt = allAtt[username] || {};

    let rows = '';
    let presentCount = 0;
    let absentCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
      const att = userAtt[dateStr] || {};
      const status = att.status || 'Not Marked';

      let statusDisplay = '—';
      let statusClass = 'text-gray-400';

      if (status === 'present') {
        presentCount++;

        if (att.half_day === true) {
          statusDisplay = '🌗 Present (Half Day)';
          statusClass = 'text-red-600';
        } else if (att.half_day === false && att.timestamp && isAfter12Local(att.timestamp)) {
          statusDisplay = '✅ Present (Late, Full Day)';
          statusClass = 'text-green-600';
        } else if (att.timestamp && isAfter12Local(att.timestamp)) {
          statusDisplay = '⚠️ Present (Late)';
          statusClass = 'text-amber-600';
        } else {
          statusDisplay = '✅ Present';
          statusClass = 'text-green-600';
        }
      } else if (status === 'absent') {
        statusDisplay = '❌ Absent';
        statusClass = 'text-red-600';
        absentCount++;
      }

      const markedBy = att.marked_by || '—';
      const markedDisplay = markedBy === 'admin' ? 'Admin' : (markedBy === 'otp' ? 'OTP' : '—');

      rows += `
        <tr class="border-b border-gray-100">
          <td class="py-2 px-3 text-sm">${dateStr}</td>
          <td class="py-2 px-3 text-sm ${statusClass}">${statusDisplay}</td>
          <td class="py-2 px-3 text-sm text-gray-500">${markedDisplay}</td>
        </tr>
      `;
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
      html,
      icon: 'info',
      confirmButtonColor: '#4f46e5',
      confirmButtonText: 'Close',
      width: 600
    });
  } catch (e) {
    console.error(e);
    showToast('Error loading history', 'error');
  }
}

async function markPresentManually(username, date) {
  const confirm = await Swal.fire({
    title: `Mark ${username} Present?`,
    text: `Mark attendance for ${username} on ${date}?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref('attendance/' + username + '/' + date).set({
      status: 'present',
      timestamp: Date.now(),
      blocked: false,
      salary_counted: true,
      marked_by: 'admin'
    });

    invalidate('attendance');
    showToast('✅ Marked present (by admin)', 'success');

    loadAttendance(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error', 'error');
    console.error(e);
  }
}

async function unblockAgent(username, date) {
  const result = await Swal.fire({
    title: `Unblock ${username}?`,
    text: 'Do you want to count salary for this day?',
    icon: 'question',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Yes, Count Salary',
    denyButtonText: "No, Don't Count",
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

    invalidate('attendance', 'users');

    if (!countSalary) {
      showToast(`✅ Unblocked. Salary counted: No`, 'success');
    } else {
      showToast(`✅ Unblocked. Salary will be counted.`, 'success');
    }

    loadAttendance(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error unblocking', 'error');
    console.error(e);
  }
}

async function blockAgent(username, date) {
  const confirm = await Swal.fire({
    title: 'Block Agent?',
    text: `Block ${username} for ${date}?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Block',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref('users/' + username + '/is_blocked').set(true);

    await db.ref('attendance/' + username + '/' + date).update({
      status: 'absent',
      blocked: true,
      reason: 'Manually blocked by admin',
      marked_by: 'admin'
    });

    invalidate('attendance', 'users');
    showToast('🔒 Agent blocked', 'success');

    loadAttendance(true);
    loadDashboard(true);
  } catch (e) {
    showToast('Error blocking', 'error');
    console.error(e);
  }
}

// ================================================================
// SALARY / EARNINGS
// ================================================================
function setSalaryMode(mode) {
  currentSalaryMode = mode;

  $('salaryModeToday')?.classList.toggle('active', mode === 'today');
  $('salaryModeSinceJoin')?.classList.toggle('active', mode === 'since_join');
  $('salaryModeDate')?.classList.toggle('active', mode === 'date');

  const wrapper = $('salaryDateWrapper');
  if (wrapper) wrapper.style.display = mode === 'date' ? 'inline-block' : 'none';

  const label = $('salaryModeLabel');

  if (label) {
    if (mode === 'today') {
      label.textContent = "Today's Earnings";
    } else if (mode === 'since_join') {
      label.textContent = "Earnings from Joining Date to Today";
    } else if (mode === 'date') {
      const dateVal = getVal('salaryDate') || 'selected date';
      label.textContent = `Earnings for ${dateVal}`;
    }
  }

  loadSalaryData(true);
}

async function loadSalaryData(force = false) {
  const mode = currentSalaryMode || 'today';
  const container = $('salaryContainer');

  if (!container) return;

  container.innerHTML = `<div class="text-center py-4"><span class="spinner-sm"></span> Calculating...</div>`;

  try {
    const [users, pickups, allAttendance] = await Promise.all([
      getData('users', force),
      getData('pickups', force),
      getData('attendance', force)
    ]);

    const agents = Object.fromEntries(
      Object.entries(users).filter(([_, u]) => (u.role || 'agent') === 'agent' && u.is_active !== false)
    );

    if (!Object.keys(agents).length) {
      container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No active agents</p></div>`;

      setText('globalPickups', '0');
      setText('globalRejects', '0');
      setText('globalPending', '0');
      setText('globalEarnings', '₹0');

      return;
    }

    const today = getLocalYMD();

    let dateFilterFn;
    let periodInfo = { mode };

    if (mode === 'today') {
      dateFilterFn = (ordDate) => ordDate === today;
      periodInfo.date = today;
    } else if (mode === 'since_join') {
      periodInfo.mode = 'since_join';
    } else if (mode === 'date') {
      const dateInput = $('salaryDate');
      let dateVal = dateInput ? dateInput.value : '';

      if (!dateVal) {
        dateVal = today;
        if (dateInput) dateInput.value = dateVal;
      }

      dateFilterFn = (ordDate) => ordDate === dateVal;
      periodInfo.date = dateVal;
    } else {
      dateFilterFn = () => true;
      periodInfo.mode = 'all';
    }

    currentSalaryPeriod = periodInfo;

    const pickupsByAgentDate = {};
    const allRejectedOrders = [];

    let globalPickup = 0;
    let globalReject = 0;
    let globalPending = 0;
    let globalEarnings = 0;

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

      const ordDate = getLocalYMD(new Date(ord.timestamp));

      if (mode === 'today' || mode === 'date') {
        if (!dateFilterFn(ordDate)) continue;
      }

      const key = agent + '|' + ordDate;
      if (!pickupsByAgentDate[key]) pickupsByAgentDate[key] = [];
      pickupsByAgentDate[key].push(ord);

      if (ord.status === 'rejected' && !Boolean(ord.incentive_approved) && rejectDateFilter(ordDate)) {
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

      let startDate;
      let endDate;

      if (mode === 'since_join') {
        if (joinDateObj) {
          startDate = new Date(joinDateObj);
          endDate = new Date();
        } else {
          startDate = new Date('2020-01-01T00:00:00');
          endDate = new Date();
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

      let agentPickupCount = 0;
      let agentRejectCount = 0;
      let agentPendingCount = 0;
      let agentHalfDayCount = 0;

      let currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dateStr = getLocalYMD(currentDate);

        if (joinDateObj && currentDate < joinDateObj) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }

        const att = userAttendance[dateStr] || {};

        const isPresent = att.status === 'present';
        const salaryCounted = att.salary_counted !== false;

        if (isPresent && salaryCounted) {
          let dayBaseSalary = perDaySalary;

          // HALF DAY SALARY: admin ne Half Day select kiya hai to 50%
          if (att.half_day === true) {
            dayBaseSalary = perDaySalary * 0.5;
            agentHalfDayCount++;
          }

          totalBaseSalary += dayBaseSalary;
        }

        const key = uname + '|' + dateStr;
        const dayPickups = pickupsByAgentDate[key] || [];

        let dayPickupInc = 0;
        let dayRejectInc = 0;

        for (const ord of dayPickups) {
          if (ord.status === 'pickup') {
            dayPickupInc += pickupInc;
            agentPickupCount++;
          }

          if (ord.status === 'rejected' && Boolean(ord.incentive_approved)) {
            dayRejectInc += rejectInc;
            agentRejectCount++;
          }

          if (ord.status === 'rejected' && !Boolean(ord.incentive_approved)) {
            pendingRejects.push({ id: ord.orderId || ord.id, ...ord });
          }

          if (ord.status === 'reschedule') {
            agentPendingCount++;
          }
        }

        totalPickupIncentive += dayPickupInc;
        totalRejectIncentive += dayRejectInc;

        if (isPresent || att.status === 'absent') {
          let statusIcon;

          if (isPresent) {
            statusIcon = att.half_day === true ? '🌗' : '✅';
          } else {
            statusIcon = att.blocked ? '🔒' : '❌';
          }

          detailsHtml += `<span class="text-xs mx-0.5" title="${dateStr}${att.half_day === true ? ' (Half Day)' : ''}">${statusIcon}</span>`;
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
        pendingRejectsHtml = `
          <div class="mt-2 pt-2 border-t border-gray-200">
            <p class="text-xs font-bold text-amber-600">⏳ Pending Reject Approvals (${uniquePending.length})</p>
            <div class="flex flex-wrap gap-1 mt-1">
              ${uniquePending.map(pr => `
                <span class="text-xs bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                  ${pr.orderId || pr.id}
                  <button onclick="toggleRejectApproval('${pr.id}', true)" class="text-green-600 hover:text-green-800 font-bold text-xs">✅</button>
                  <button onclick="toggleRejectApproval('${pr.id}', false)" class="text-red-600 hover:text-red-800 font-bold text-xs">❌</button>
                </span>
              `).join('')}
            </div>
          </div>
        `;
      }

      const joinDateDisplay = joinDateObj ? getLocalYMD(joinDateObj) : '—';
      const periodAttr = JSON.stringify(currentSalaryPeriod).replace(/"/g, '&quot;');

      html += `
        <div class="glass rounded-2xl p-5 shadow-sm border border-gray-100 salary-summary-card">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="font-bold text-gray-800 cursor-pointer hover:text-indigo-600" onclick="viewAgentActivityWithPeriod('${uname}', ${periodAttr})">${uData.name}</span>
              <span class="text-sm text-gray-500">(${uname})</span>
              <span class="text-xs text-gray-400 ml-2">Joined: ${joinDateDisplay}</span>
              <button onclick="viewAgentActivityWithPeriod('${uname}', ${periodAttr})" class="btn-action activity text-xs ml-2"><i data-lucide="activity"></i> Activity</button>
              <span class="text-xs text-gray-400 ml-2">📦 ${agentPickupCount} | ❌ ${agentRejectCount} | ⏳ ${agentPendingCount} | 🌗 ${agentHalfDayCount}</span>
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
        </div>
      `;
    }

    setText('globalPickups', globalPickup);
    setText('globalRejects', globalReject);
    setText('globalPending', globalPending);
    setText('globalEarnings', formatINR(globalEarnings));

    const filteredAllPending = [];
    const seenAll = new Set();

    for (const pr of allRejectedOrders) {
      if (!seenAll.has(pr.id)) {
        seenAll.add(pr.id);
        filteredAllPending.push(pr);
      }
    }

    if (filteredAllPending.length > 0) {
      html += `
        <div class="glass rounded-2xl p-5 shadow-sm border border-amber-200 bg-amber-50">
          <h4 class="font-bold text-amber-700 mb-2">📋 Pending Reject Approvals (${filteredAllPending.length})</h4>
          <div class="flex flex-wrap gap-2">
            ${filteredAllPending.map(pr => {
              const ordDate = pr.timestamp ? getLocalYMD(new Date(pr.timestamp)) : '—';

              return `
                <span class="text-sm bg-white px-3 py-1 rounded shadow flex items-center gap-2">
                  <span class="font-mono">${pr.orderId || pr.id}</span>
                  <span class="text-xs text-gray-500">(${pr.agent || '—'})</span>
                  <span class="text-xs text-gray-400">${ordDate}</span>
                  <button onclick="toggleRejectApproval('${pr.id}', true)" class="btn-action approve text-xs py-0.5 px-2">
                    <i data-lucide="check-circle"></i> Approve
                  </button>
                  <button onclick="toggleRejectApproval('${pr.id}', false)" class="btn-action delete text-xs py-0.5 px-2">
                    <i data-lucide="x-circle"></i> Reject
                  </button>
                </span>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    html += `<div class="text-right font-bold text-xl mt-4">Grand Total: ${formatINR(grandTotal)}</div>`;

    container.innerHTML = html;
    refreshIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm text-red-500">Error calculating salary</p></div>`;
    showToast('Error calculating salary', 'error');
  }
}

async function recalculateAllSalary() {
  showToast('🔄 Recalculating...', 'info');
  await loadSalaryData(true);
}

// ================================================================
// GLOBAL SEARCH
// ================================================================
async function openGlobalSearch() {
  const modal = $('globalSearchModal');
  const input = $('globalSearchModalInput');
  const results = $('globalSearchModalResults');

  if (!modal || !input || !results) return;

  modal.classList.add('open');
  input.value = '';
  results.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">Type to start searching</p></div>`;

  setTimeout(() => input.focus(), 300);

  if (!allOrders.length) await loadOrders(false);

  if (!inventoryList.length) {
    inventoryList = allOrders.filter(item => item.status === 'pickup' && !item.sold);
  }

  if (!salesList.length) {
    salesList = allOrders.filter(item => item.sold === true && item.status !== 'on_hold');
  }

  if (!agentsList.length) await loadAgents(false);

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

  modal._searchData = allData;

  if (window.Fuse) {
    modal._searchFuse = new Fuse(allData, {
      keys: ['orderId', 'phoneModel', 'imei', 'customerName', 'buyerName', 'agent', 'name', 'username', 'mobile', 'color', 'value'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
      shouldSort: true,
      minMatchCharLength: 2
    });
  } else {
    modal._searchFuse = null;
  }

  input.oninput = function () {
    const query = this.value.trim();

    if (!query) {
      results.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">Type to start searching</p></div>`;
      return;
    }

    let resultItems = [];

    if (modal._searchFuse) {
      resultItems = modal._searchFuse.search(query);
    } else {
      const lower = query.toLowerCase();

      resultItems = allData.filter(item => {
        const text = [
          item.orderId,
          item.phoneModel,
          item.imei,
          item.customerName,
          item.buyerName,
          item.agent,
          item.name,
          item.username,
          item.mobile
        ].filter(Boolean).join(' ').toLowerCase();

        return text.includes(lower);
      }).map(item => ({ item }));
    }

    if (!resultItems.length) {
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

      items.slice(0, 10).forEach(r => {
        const item = r.item;

        let label = '';
        let desc = '';
        let badge = '';
        let onClick = '';

        if (item._type === 'order' || item._type === 'inventory' || item._type === 'sale') {
          label = item.orderId || item.id;
          desc = item.phoneModel || '';
          badge = `<span class="badge-status ${getStatusClass(item)}">${getStatusDisplay(item)}</span>`;
          onClick = `onclick="viewOrder('${item.id || item.orderId}')"`;
        } else if (item._type === 'agent') {
          label = item.name || item.username;
          desc = item.username + (item.mobile ? ' | ' + item.mobile : '');
          badge = `<span class="badge-status admin">Agent</span>`;
          onClick = `onclick="viewAgentActivity('${item.username}')"`;
        }

        html += `
          <div class="result-item" ${onClick}>
            <div>
              <span class="text-mono">${label}</span>
              <span class="text-desc">${desc}</span>
            </div>
            <div class="action-buttons">${badge}</div>
          </div>
        `;
      });

      if (items.length > 10) {
        html += `<div id="${catId}-hidden" style="display:none;">`;

        items.slice(10).forEach(r => {
          const item = r.item;

          let label = '';
          let desc = '';
          let badge = '';
          let onClick = '';

          if (item._type === 'order' || item._type === 'inventory' || item._type === 'sale') {
            label = item.orderId || item.id;
            desc = item.phoneModel || '';
            badge = `<span class="badge-status ${getStatusClass(item)}">${getStatusDisplay(item)}</span>`;
            onClick = `onclick="viewOrder('${item.id || item.orderId}')"`;
          } else if (item._type === 'agent') {
            label = item.name || item.username;
            desc = item.username + (item.mobile ? ' | ' + item.mobile : '');
            badge = `<span class="badge-status admin">Agent</span>`;
            onClick = `onclick="viewAgentActivity('${item.username}')"`;
          }

          html += `
            <div class="result-item" ${onClick}>
              <div>
                <span class="text-mono">${label}</span>
                <span class="text-desc">${desc}</span>
              </div>
              <div class="action-buttons">${badge}</div>
            </div>
          `;
        });

        html += `</div>`;
        html += `<button class="show-more-btn" onclick="toggleShowMore('${catId}', ${items.length}, this)">+${items.length - 10} more</button>`;
      }

      html += `</div>`;
    }

    results.innerHTML = html;
    refreshIcons();
  };
}

function closeGlobalSearch() {
  $('globalSearchModal')?.classList.remove('open');
  setVal('globalSearchModalInput', '');
}

function toggleShowMore(catId, totalItems, btn) {
  const hiddenDiv = $(catId + '-hidden');

  if (!hiddenDiv || !btn) return;

  if (hiddenDiv.style.display === 'none') {
    hiddenDiv.style.display = 'block';
    btn.textContent = `Show less (${totalItems - 10} hidden)`;
  } else {
    hiddenDiv.style.display = 'none';
    btn.textContent = `+${totalItems - 10} more`;
  }
}

// ================================================================
// LIVE SEARCH DROPDOWN
// ================================================================
function setupLiveSearch(inputId, dropdownId, dataSource, fields) {
  const input = $(inputId);
  const dropdown = $(dropdownId);

  if (!input || !dropdown) return;

  input._lsData = dataSource;
  input._lsFields = fields;

  if (input._lsInit) return;

  input._lsInit = true;

  const handleInput = debounce(function () {
    const query = this.value.trim();
    const data = this._lsData || [];
    const searchFields = this._lsFields || [];

    if (!query) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      return;
    }

    let results = [];

    if (window.Fuse) {
      const fuse = new Fuse(data, {
        keys: searchFields,
        threshold: 0.3,
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 2
      });

      results = fuse.search(query);
    } else {
      const lower = query.toLowerCase();

      results = data.filter(item => {
        const text = searchFields.map(f => item[f]).filter(Boolean).join(' ').toLowerCase();
        return text.includes(lower);
      }).map(item => ({ item }));
    }

    if (!results.length) {
      dropdown.innerHTML = `<div class="empty-dropdown">No matches found</div>`;
      dropdown.classList.add('open');
      return;
    }

    let html = '';
    const maxResults = 10;

    results.slice(0, maxResults).forEach((r) => {
      const item = r.item;

      let primary = '';
      let extra = [];
      let clickAction = '';
      const id = item.id || '';

      if (item.orderId) {
        primary = item.orderId;

        if (item.phoneModel) extra.push(item.phoneModel);
        if (item.imei) extra.push('IMEI: ' + item.imei);
        if (item.customerName) extra.push('Cust: ' + item.customerName);
        if (item.agent) extra.push('Agent: ' + item.agent);

        if (id) clickAction = `onclick="viewOrder('${id}')"`;
      } else if (item.name) {
        primary = item.name;
        if (item.mobile) extra.push('📱 ' + item.mobile);
        if (item.username) clickAction = `onclick="viewAgentActivity('${item.username}')"`;
      } else {
        primary = item.id || 'Item';
        if (id) clickAction = `onclick="viewOrder('${id}')"`;
      }

      html += `
        <div class="dropdown-item" data-id="${id}" ${clickAction}>
          <div>
            <div class="item-primary">${primary}</div>
            <div class="item-secondary">${extra.join(' · ')}</div>
          </div>
          ${item.value !== undefined ? `<span class="item-badge">${formatINR(item.value)}</span>` : ''}
        </div>
      `;
    });

    if (results.length > maxResults) {
      html += `<div class="dropdown-item" style="color:#94a3b8; font-size:0.8rem; text-align:center;">+${results.length - maxResults} more</div>`;
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('open');
  }, 250);

  input.addEventListener('input', handleInput);

  input.addEventListener('focus', function () {
    if (this.value.trim()) handleInput.call(this);
  });

  document.addEventListener('click', function (e) {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.classList.remove('open');
    }
  });
}

// ================================================================
// REFRESH ALL
// ================================================================
async function refreshAll() {
  if (isRefreshing) return;

  isRefreshing = true;
  showToast('🔄 Refreshing...', 'info');

  invalidate('pickups', 'pending', 'users', 'deposits', 'attendance');

  await Promise.allSettled([
    loadDashboard(true),
    loadOrders(true),
    loadPendingAdmin(true),
    loadRejectedAdmin(true),
    loadInventory(true),
    loadSales(true),
    loadDeposits(true),
    loadAgents(true)
  ]);

  isRefreshing = false;
  showToast('✅ Refreshed', 'success');
}

// ================================================================
// LIVE CLOCK
// ================================================================
function updateClock() {
  const el = $('liveTime');
  if (!el) return;

  const now = new Date();
  el.textContent = now.toTimeString().slice(0, 8);
}

setInterval(updateClock, 1000);
updateClock();

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  refreshIcons();
  loadDashboard(true);

  const attendanceDate = $('attendanceDate');
  if (attendanceDate) attendanceDate.value = getLocalYMD();

  const today = new Date();

  const salaryMonth = $('salaryMonth');
  if (salaryMonth) salaryMonth.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

  const salaryDate = $('salaryDate');
  if (salaryDate) salaryDate.value = getLocalYMD();

  const depositDate = $('depositDate');
  if (depositDate) depositDate.value = getLocalYMD();

  const agentRole = document.querySelector('input[name="regRole"][value="agent"]');
  if (agentRole) agentRole.checked = true;

  toggleAdminFields();
  setSalaryMode('today');

  // Auto refresh only when tab visible
  setInterval(() => {
    if (document.hidden) return;
    refreshCurrentPage(true);
  }, 300000);

  showToast('👋 Welcome', 'info', 2000);
});

// ================================================================
// MODALS / KEYBOARD
// ================================================================
const detailModal = $('detailModal');

if (detailModal) {
  detailModal.addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });
}

const sellModal = $('sellModal');

if (sellModal) {
  sellModal.addEventListener('click', function (e) {
    if (e.target === this) closeSellModal();
  });
}

const activityModal = $('activityModal');

if (activityModal) {
  activityModal.addEventListener('click', function (e) {
    if (e.target === this) closeActivityModal();
  });
}

const imgViewerModal = $('imgViewerModal');

if (imgViewerModal) {
  imgViewerModal.addEventListener('click', function (e) {
    if (e.target === this) closeImageViewer();
  });
}

const globalSearchModal = $('globalSearchModal');

if (globalSearchModal) {
  globalSearchModal.addEventListener('click', function (e) {
    if (e.target === this) closeGlobalSearch();
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeDetail();
    closeSellModal();
    closeActivityModal();
    closeSidebar();
    closeGlobalSearch();
    closeImageViewer();
  }
});