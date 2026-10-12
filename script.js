// File: script.js
// Flipkart Admin Panel — Full Script
// Salary System v3: Paid Cycle Snapshot + Undo + Revert + Delete + Adjustment History
// + Per-activity incentive override (added)

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

function addDays(dateStr, n) {
  if (!dateStr) return getLocalYMD();
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return getLocalYMD();
  d.setDate(d.getDate() + n);
  return getLocalYMD(d);
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
  attendance: null,
  salary_payments: null
};

const cacheTime = {
  pickups: 0,
  pending: 0,
  users: 0,
  deposits: 0,
  attendance: 0,
  salary_payments: 0
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
// INCENTIVE HELPERS — default + per-activity override
// ----------------------------------------------------------------
// Default incentive is stored on the agent: users/{username}/pickup_incentive
// and users/{username}/reject_incentive.
//
// For individual activities (orders), an admin can override the incentive
// ONLY for that order via:
//     pickups/{orderId}/pickup_incentive_override
//     pickups/{orderId}/reject_incentive_override
//
// If the override is set, it wins for that order. Otherwise the agent's
// default is used. This never modifies the agent's default.
// ================================================================
function hasOverride(order, type) {
  if (!order) return false;
  const f = type === 'pickup' ? 'pickup_incentive_override' : 'reject_incentive_override';
  const v = order[f];
  return v !== undefined && v !== null && v !== '';
}

function getActivityIncentive(order, agentUser, type) {
  const agentField = type === 'pickup' ? 'pickup_incentive' : 'reject_incentive';
  const agentDefault = agentUser ? (Number(agentUser[agentField]) || 0) : 0;

  if (hasOverride(order, type)) {
    const n = Number(order[type === 'pickup' ? 'pickup_incentive_override' : 'reject_incentive_override']);
    if (!isNaN(n)) return n;
  }
  return agentDefault;
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

    let img = $('imgViewerImg');
    let caption = $('imgViewerCaption');

    if (!img) {
      modal.innerHTML = `
        <div style="position:relative; max-width:90vw; max-height:90vh; background:#000; border-radius:12px; padding:10px;">
          <button onclick="closeImageViewer()" style="position:absolute; top:10px; right:10px; z-index:20; background:#dc2626; color:white; border:none; border-radius:8px; padding:8px 12px;">Close</button>
          <img id="imgViewerImg" src="${src}" style="max-width:100%; max-height:85vh; display:block; margin:0 auto;" alt="Document">
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

// Date Activities modal state
let currentActivitiesDate = null;

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
          totalPickupIncentives += getActivityIncentive(item, uData, 'pickup');
        } else if (item.status === 'rejected' && Boolean(item.incentive_approved)) {
          totalRejectIncentives += getActivityIncentive(item, uData, 'reject');
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
// DATE ACTIVITIES — per-activity incentive override
// ----------------------------------------------------------------
// Admin can open this from the Salary page. It lists all pickup /
// approved-reject activities for a selected date, and lets the admin
// override the incentive amount for any individual activity.
//
// Override is stored as:
//     pickups/{orderId}/pickup_incentive_override
//     pickups/{orderId}/reject_incentive_override
//
// Agent's default pickup_incentive / reject_incentive are never touched.
// ================================================================

async function promptDateActivities() {
  const defaultDate = getVal('salaryDate') || getLocalYMD();

  const { value: dateVal, isConfirmed } = await Swal.fire({
    title: '📅 View Activities For Date',
    html: `
      <div class="text-left text-sm space-y-2">
        <p class="text-gray-600 text-xs">Select a date to view all pickup &amp; approved-reject activities:</p>
        <input type="date" id="dateActivitiesPicker" class="swal2-input" value="${defaultDate}" />
        <p class="text-[11px] text-gray-500 mt-1">You can adjust the incentive for individual activities on this date. Only that activity changes — the agent's default stays the same.</p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '📅 View Activities',
    confirmButtonColor: '#4f46e5',
    cancelButtonColor: '#64748b',
    preConfirm: () => {
      const v = document.getElementById('dateActivitiesPicker').value;
      if (!v) { Swal.showValidationMessage('Select a date'); return false; }
      return v;
    }
  });

  if (!isConfirmed || !dateVal) return;
  openDateActivitiesModal(dateVal);
}

async function openDateActivitiesModal(dateVal) {
  if (!dateVal) dateVal = currentActivitiesDate || getVal('salaryDate') || getLocalYMD();
  currentActivitiesDate = dateVal;

  try {
    const [pickups, users] = await Promise.all([
      getData('pickups', true),
      getData('users', true)
    ]);

    const activities = [];

    Object.entries(pickups).forEach(([id, ord]) => {
      if (!ord || !ord.timestamp) return;
      if (getLocalYMD(new Date(ord.timestamp)) !== dateVal) return;

      const isPickup = ord.status === 'pickup';
      const isApprovedReject = ord.status === 'rejected' && Boolean(ord.incentive_approved);

      if (!isPickup && !isApprovedReject) return;

      const type = isPickup ? 'pickup' : 'reject';
      const agentUser = users[ord.agent] || {};
      const defaultField = type === 'pickup' ? 'pickup_incentive' : 'reject_incentive';
      const overrideField = type === 'pickup' ? 'pickup_incentive_override' : 'reject_incentive_override';

      const defaultInc = Number(agentUser[defaultField]) || 0;
      const hasOv = ord[overrideField] !== undefined && ord[overrideField] !== null && ord[overrideField] !== '';
      const currentInc = hasOv ? (Number(ord[overrideField]) || 0) : defaultInc;

      activities.push({
        id,
        orderId: ord.orderId || id,
        agent: ord.agent || '',
        agentName: agentUser.name || ord.agent || '',
        phoneModel: ord.phoneModel || '',
        type,
        defaultInc,
        currentInc,
        hasOverride: hasOv,
        timestamp: ord.timestamp || 0,
        timestampIST: ord.timestampIST || ''
      });
    });

    activities.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let rows = '';

    if (!activities.length) {
      rows = `
        <tr>
          <td colspan="6" class="text-center py-10 text-gray-400">
            <div class="text-sm font-semibold text-gray-500">No pickup or approved-reject activities</div>
            <div class="text-xs text-gray-400 mt-1">on ${dateVal}</div>
          </td>
        </tr>
      `;
    } else {
      activities.forEach((a, i) => {
        const typeBadge = a.type === 'pickup'
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">📦 PICKUP</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">❌ REJECT</span>';

        const customIndicator = a.hasOverride
          ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">CUSTOM</span>'
          : '';

        const resetBtn = a.hasOverride
          ? `<button onclick="resetActivityIncentive('${a.id}', '${a.type}')" class="px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200" title="Reset to agent default">↩️</button>`
          : '';

        rows += `
          <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs">
            <td class="py-2 px-2 text-gray-400 font-mono">${i + 1}</td>
            <td class="py-2 px-2">
              <div class="font-mono font-bold text-gray-800 text-[11px]">${esc(a.orderId)}</div>
              <div class="text-[10px] text-gray-400">${esc(a.phoneModel || '—')}</div>
            </td>
            <td class="py-2 px-2">
              <div class="font-semibold text-gray-700 text-[11px]">${esc(a.agentName)}</div>
              <div class="text-[10px] text-gray-400 font-mono">${esc(a.agent)}</div>
              ${a.timestampIST ? `<div class="text-[9px] text-gray-400">${esc(a.timestampIST)}</div>` : ''}
            </td>
            <td class="py-2 px-2">${typeBadge}</td>
            <td class="py-2 px-2 text-right font-bold text-gray-600">${formatINR(a.defaultInc)}</td>
            <td class="py-2 px-2">
              <div class="flex items-center gap-1 flex-nowrap">
                <input type="number" id="incInput_${a.id}" value="${a.currentInc}" min="0" step="1"
                  class="w-20 px-2 py-1 border-2 border-gray-200 rounded text-xs font-bold text-indigo-700 outline-none focus:border-indigo-500" />
                ${customIndicator}
                <button onclick="saveActivityIncentive('${a.id}', '${a.type}')" class="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500 text-white hover:bg-emerald-600" title="Save">💾</button>
                ${resetBtn}
              </div>
            </td>
          </tr>
        `;
      });
    }

    const totalDefaults = activities.reduce((s, a) => s + a.defaultInc, 0);
    const totalCurrent = activities.reduce((s, a) => s + a.currentInc, 0);
    const changedCount = activities.filter(a => a.hasOverride).length;

    await Swal.fire({
      title: `📅 Activities for ${dateVal}`,
      width: '1050px',
      html: `
        <div class="text-left font-sans">
          <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs">
            <p class="font-bold text-blue-900 mb-1">💡 How it works</p>
            <p class="text-gray-700">Each activity uses the agent's default incentive. Override a specific activity by entering a new amount and clicking <strong>💾 Save</strong>. Only that activity changes — the agent's default and other activities stay the same. Use <strong>↩️ Reset</strong> to revert to the default.</p>
          </div>

          <div class="flex items-center justify-between mb-3 flex-wrap gap-2 text-xs">
            <span class="text-gray-500">Total activities: <strong>${activities.length}</strong>
              ${changedCount ? ` · Changed: <strong class="text-indigo-600">${changedCount}</strong>` : ''}
            </span>
            <span class="text-gray-500">
              Default: <strong>${formatINR(totalDefaults)}</strong>
              ${totalCurrent !== totalDefaults ? ` · Applied: <strong class="text-indigo-600">${formatINR(totalCurrent)}</strong>` : ''}
            </span>
          </div>

          <div class="max-h-[520px] overflow-y-auto border border-gray-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 text-[10px] uppercase font-bold sticky top-0">
                <tr>
                  <th class="py-2 px-2">#</th>
                  <th class="py-2 px-2">Order</th>
                  <th class="py-2 px-2">Agent / Time</th>
                  <th class="py-2 px-2">Type</th>
                  <th class="py-2 px-2 text-right">Default</th>
                  <th class="py-2 px-2">Applied Incentive</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  } catch (e) {
    console.error(e);
    showToast('Failed to load activities', 'error');
  }
}

async function saveActivityIncentive(orderId, type) {
  const inputEl = document.getElementById('incInput_' + orderId);
  if (!inputEl) return;

  const val = parseFloat(inputEl.value);
  if (isNaN(val) || val < 0) {
    showToast('Enter a valid amount (≥ 0)', 'error');
    return;
  }

  const overrideField = type === 'pickup' ? 'pickup_incentive_override' : 'reject_incentive_override';
  const defaultField = type === 'pickup' ? 'pickup_incentive' : 'reject_incentive';

  try {
    const snap = await db.ref('pickups/' + orderId).once('value');
    const ord = snap.val();
    if (!ord) { showToast('Order not found', 'error'); return; }

    const users = await getData('users', false);
    const agentUser = users[ord.agent] || {};
    const defaultVal = Number(agentUser[defaultField]) || 0;

    if (val === defaultVal) {
      // Same as default → remove override so it stays clean
      await db.ref('pickups/' + orderId + '/' + overrideField).remove();
      showToast(`↩️ Reset to default ${formatINR(defaultVal)}`, 'info');
    } else {
      await db.ref('pickups/' + orderId).update({ [overrideField]: val });
      showToast(`✅ Applied ${formatINR(val)} to this activity`, 'success');
    }

    invalidate('pickups');

    // Refresh the modal with updated values + recalc salary if on salary page
    setTimeout(() => openDateActivitiesModal(currentActivitiesDate), 300);
    if (currentPageView === 'salary') loadSalaryData(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to save', 'error');
  }
}

async function resetActivityIncentive(orderId, type) {
  const overrideField = type === 'pickup' ? 'pickup_incentive_override' : 'reject_incentive_override';

  try {
    await db.ref('pickups/' + orderId + '/' + overrideField).remove();
    invalidate('pickups');
    showToast('↩️ Reset to agent default', 'info');
    setTimeout(() => openDateActivitiesModal(currentActivitiesDate), 300);
    if (currentPageView === 'salary') loadSalaryData(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to reset', 'error');
  }
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
  } else if (period.mode === 'current_cycle') {
    const startD = period.cycleStart || '2020-01-01';
    const endD = period.cycleEnd || getLocalYMD();
    filterFn = (ts) => {
      if (!ts) return false;
      const ds = getLocalYMD(new Date(ts));
      return ds >= startD && ds <= endD;
    };
    periodLabel = `${startD} → ${endD}`;
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
// ATTENDANCE & OTP MANAGEMENT SYSTEM
// ================================================================
function getActiveAgents(users) {
  return Object.fromEntries(
    Object.entries(users || {}).filter(([_, u]) => {
      const role = (u.role || 'agent').toLowerCase();
      const isActive = u.is_active !== false && u.status !== 'inactive' && u.active !== false;
      return role === 'agent' && isActive;
    })
  );
}

async function generateOTPs() {
  const users = await getData('users', true);
  const dateInput = $('attendanceDate');
  const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalYMD();

  const activeAgents = getActiveAgents(users);
  const agentKeys = Object.keys(activeAgents);

  if (!agentKeys.length) {
    showToast('No active agents found to generate OTP.', 'warning');
    return;
  }

  const confirm = await Swal.fire({
    title: 'Generate Daily OTPs?',
    text: `Generate 6-digit attendance OTP for ${agentKeys.length} active agents for ${targetDate}?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Generate',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    const updates = {};
    const expiresAt = new Date().setHours(23, 59, 59, 999);

    for (const uname of agentKeys) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      updates[`daily_otp/${targetDate}/${uname}`] = {
        otp,
        generated_at: Date.now(),
        expires_at: expiresAt,
        used: false,
        valid_date: targetDate
      };
      updates[`otp/${uname}`] = {
        otp,
        date: targetDate,
        expiresAt,
        used: false,
        createdBy: 'admin'
      };
    }

    await db.ref().update(updates);
    showToast(`✅ Generated OTPs for ${agentKeys.length} active agents`, 'success');
    loadAttendance(true);
  } catch (e) {
    showToast('Error generating OTPs', 'error');
    console.error(e);
  }
}

async function openOtpGeneratorModal(username) {
  const dateInput = $('attendanceDate');
  const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalYMD();

  const snap = await db.ref(`daily_otp/${targetDate}/${username}`).once('value');
  const otpData = snap.val();
  const currentOtp = otpData ? otpData.otp : 'Not Generated';

  const { value: action } = await Swal.fire({
    title: `OTP: ${username}`,
    html: `
      <div class="text-left text-sm space-y-2 py-2">
        <p class="text-gray-600">Date: <strong>${targetDate}</strong></p>
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-xl text-center">
          <span class="text-xs text-gray-500 uppercase font-semibold">Today's OTP</span>
          <div class="text-2xl font-mono font-bold text-indigo-600 mt-1">${currentOtp}</div>
        </div>
      </div>
    `,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: '📋 Copy OTP',
    denyButtonText: '🔄 Regenerate OTP',
    cancelButtonText: 'Close',
    confirmButtonColor: '#4f46e5',
    denyButtonColor: '#059669'
  });

  if (action) {
    if (currentOtp && currentOtp !== 'Not Generated') {
      navigator.clipboard.writeText(currentOtp);
      showToast('OTP copied to clipboard!', 'success');
    } else {
      showToast('Generate OTP first', 'info');
    }
  } else if (action === false) {
    await generateSingleAgentOtp(username, targetDate);
  }
}

async function generateSingleAgentOtp(username, targetDate) {
  const newOtp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date().setHours(23, 59, 59, 999);

  try {
    const updates = {};
    updates[`daily_otp/${targetDate}/${username}`] = {
      otp: newOtp,
      generated_at: Date.now(),
      expires_at: expiresAt,
      used: false,
      valid_date: targetDate
    };
    updates[`otp/${username}`] = {
      otp: newOtp,
      date: targetDate,
      expiresAt,
      used: false,
      createdBy: 'admin'
    };
    await db.ref().update(updates);
    showToast(`✅ New OTP: ${newOtp}`, 'success');
    loadAttendance(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to regenerate OTP', 'error');
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

  container.innerHTML = `<div class="text-center py-6"><span class="spinner-sm"></span> Loading attendance...</div>`;

  try {
    const [users, allAttendance, otpSnap] = await Promise.all([
      getData('users', force),
      getData('attendance', force),
      db.ref('daily_otp/' + date).once('value')
    ]);

    const otps = otpSnap.val() || {};
    const agents = getActiveAgents(users);
    const activeCount = Object.keys(agents).length;

    if (!activeCount) {
      container.innerHTML = `<div class="empty-state p-6 text-center text-gray-500 font-medium">No active agents found.</div>`;
      return;
    }

    let presentCount = 0;
    let absentCount = 0;
    let halfDayCount = 0;
    let unmarkedCount = 0;

    let itemsHtml = '';

    for (const [uname, uData] of Object.entries(agents)) {
      const att = (allAttendance[uname] && allAttendance[uname][date]) || {};
      const otpData = otps[uname] || {};
      const otp = otpData.otp || '—';

      const status = att.status || 'unmarked';
      const isBlocked = att.blocked === true || uData.is_blocked === true;
      const isHalf = att.half_day === true;
      const isMarked = status === 'present' || status === 'absent';

      let badge = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Not Marked</span>';

      if (status === 'present') {
        if (isHalf) {
          halfDayCount++;
          badge = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">🌗 Half Day</span>';
        } else {
          presentCount++;
          badge = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">✅ Present</span>';
        }
      } else if (status === 'absent') {
        absentCount++;
        badge = isBlocked
          ? '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">🚫 Blocked</span>'
          : '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">❌ Absent</span>';
      } else {
        unmarkedCount++;
      }

      const unmarkBtn = isMarked
        ? `<button onclick="setAgentAttendanceStatus('${uname}', '${date}', 'unmarked', false)" title="Unmark attendance" class="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-semibold">
             ⚪ Unmark
           </button>`
        : '';

      itemsHtml += `
        <div class="glass rounded-xl p-4 border border-gray-100 flex flex-wrap items-center justify-between gap-3 hover:shadow-sm transition">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-gray-800 text-sm hover:text-indigo-600 cursor-pointer" onclick="viewAttendanceHistory('${uname}')">${uData.name || uname}</span>
              <span class="text-xs text-gray-400 font-mono">(${uname})</span>
            </div>
            <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>OTP: <strong class="text-indigo-600 font-mono cursor-pointer" onclick="openOtpGeneratorModal('${uname}')">${otp}</strong></span>
              ${att.timestamp ? `<span>• Marked: ${new Date(att.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>` : ''}
              ${att.reason ? `<span class="text-rose-600 font-medium">• ${att.reason}</span>` : ''}
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <div>${badge}</div>

            <div class="flex items-center gap-1.5 ml-2 flex-wrap">
              <button onclick="setAgentAttendanceStatus('${uname}', '${date}', 'present', false)" title="Mark Present" class="px-2 py-1 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold">
                Present
              </button>
              <button onclick="setAgentAttendanceStatus('${uname}', '${date}', 'present', true)" title="Mark Half Day" class="px-2 py-1 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 font-semibold">
                Half Day
              </button>
              <button onclick="setAgentAttendanceStatus('${uname}', '${date}', 'absent', false)" title="Mark Absent" class="px-2 py-1 text-xs rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 font-semibold">
                Absent
              </button>
              ${unmarkBtn}
              <button onclick="openOtpGeneratorModal('${uname}')" title="Manage OTP" class="px-2 py-1 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold">
                🔑 OTP
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const summaryBanner = `
      <div class="grid grid-cols-5 gap-3 mb-4 text-center">
        <div class="p-3 bg-blue-50 border border-blue-100 rounded-xl">
          <div class="text-xs text-blue-600 font-semibold">Active Agents</div>
          <div class="text-xl font-bold text-blue-800">${activeCount}</div>
        </div>
        <div class="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
          <div class="text-xs text-emerald-600 font-semibold">Present</div>
          <div class="text-xl font-bold text-emerald-800">${presentCount}</div>
        </div>
        <div class="p-3 bg-amber-50 border border-amber-100 rounded-xl">
          <div class="text-xs text-amber-600 font-semibold">Half Day</div>
          <div class="text-xl font-bold text-amber-800">${halfDayCount}</div>
        </div>
        <div class="p-3 bg-rose-50 border border-rose-100 rounded-xl">
          <div class="text-xs text-rose-600 font-semibold">Absent</div>
          <div class="text-xl font-bold text-rose-800">${absentCount}</div>
        </div>
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-xl">
          <div class="text-xs text-gray-600 font-semibold">Unmarked</div>
          <div class="text-xl font-bold text-gray-700">${unmarkedCount}</div>
        </div>
      </div>
    `;

    container.innerHTML = summaryBanner + `<div class="space-y-2.5">${itemsHtml}</div>`;
    refreshIcons();
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="p-4 text-center text-rose-500 font-medium">Failed to load attendance records.</div>`;
  }
}

async function setAgentAttendanceStatus(username, date, status, isHalfDay = false) {
  try {
    if (status === 'unmarked') {
      await db.ref(`attendance/${username}/${date}`).remove();

      await db.ref(`users/${username}`).update({
        is_blocked: false,
        blocked_date: null
      });

      invalidate('attendance', 'users');
      showToast(`⚪ Unmarked ${username} for ${date}`, 'info');
      loadAttendance(true);
      loadDashboard(true);
      return;
    }

    const record = {
      status: status,
      timestamp: Date.now(),
      marked_by: 'admin',
      salary_counted: status === 'present',
      half_day: isHalfDay,
      blocked: status === 'absent'
    };

    await db.ref(`attendance/${username}/${date}`).update(record);

    if (status === 'absent') {
      await db.ref(`users/${username}`).update({
        is_blocked: true,
        blocked_date: date
      });
    } else {
      await db.ref(`users/${username}`).update({
        is_blocked: false,
        blocked_date: null
      });
    }

    invalidate('attendance', 'users');
    showToast(`Updated ${username} to ${isHalfDay ? 'Half Day' : status}`, 'success');
    loadAttendance(true);
    loadDashboard(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to update status', 'error');
  }
}

async function markAllPresent() {
  const dateInput = $('attendanceDate');
  const targetDate = (dateInput && dateInput.value) ? dateInput.value : getLocalYMD();

  const users = await getData('users', true);
  const activeAgents = getActiveAgents(users);
  const agentKeys = Object.keys(activeAgents);

  if (!agentKeys.length) {
    showToast('No active agents to mark.', 'warning');
    return;
  }

  const confirm = await Swal.fire({
    title: 'Mark All Present?',
    text: `Mark all ${agentKeys.length} active agents as Present for ${targetDate}?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Mark All Present',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    const updates = {};
    for (const uname of agentKeys) {
      updates[`attendance/${uname}/${targetDate}`] = {
        status: 'present',
        timestamp: Date.now(),
        marked_by: 'admin_bulk',
        salary_counted: true,
        half_day: false,
        blocked: false
      };
      updates[`users/${uname}/is_blocked`] = false;
      updates[`users/${uname}/blocked_date`] = null;
    }

    await db.ref().update(updates);
    invalidate('attendance');
    showToast(`✅ Marked ${agentKeys.length} agents Present`, 'success');
    loadAttendance(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to mark all present', 'error');
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
// SALARY / EARNINGS — V3
// ================================================================
// FLOW:
//   Current Cycle Calculation
//      → Mark as Paid (snapshot saved to salary_payments)
//      → Cycle Closes → New Cycle Starts (auto, from next day)
//
//   Paid History → Open → Undo Paid
//      → Status flips to UNDONE → Data auto-restores (cycle reopens)
//
//   Paid History → Open → Delete Paid
//      → Permanent removal from Firebase (with confirmation)
//
//   Adjustment History → Revert (soft) / Delete (permanent)
//
// RULES:
//   • All paid cycles are stored as immutable snapshots (never auto-deleted).
//   • Undo = set status = 'UNDONE'. Cycle range recalculates from last
//     ACTIVE payment automatically.
//   • Adjustments: include "settledInCycle" only for record; date-range
//     filtering is the primary mechanism for cycle separation.
//   • Activity incentive uses per-order override if set, else agent default.
// ================================================================

// ---------- Cycle helpers ----------
function getActivePaymentsForAgent(allPayments, agentUsername) {
  const agentPays = allPayments[agentUsername] || {};
  return Object.values(agentPays)
    .filter(p => p.status !== 'UNDONE')
    .sort((a, b) => {
      const da = a.paymentDate || '';
      const dbb = b.paymentDate || '';
      if (da !== dbb) return dbb.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
}

function getLastActivePayment(allPayments, agentUsername) {
  const list = getActivePaymentsForAgent(allPayments, agentUsername);
  return list[0] || null;
}

function getPaymentHistoryForAgent(allPayments, agentUsername) {
  const agentPays = allPayments[agentUsername] || {};
  return Object.values(agentPays).sort((a, b) => {
    const da = a.paymentDate || '';
    const dbb = b.paymentDate || '';
    if (da !== dbb) return dbb.localeCompare(da);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function computeCycleRangeForAgent(mode, uData, lastActivePayment, selectedDate) {
  const today = getLocalYMD();
  const joinDateStr = uData.joinDate || null;

  if (mode === 'today') {
    return { start: today, end: today };
  }
  if (mode === 'date') {
    const d = selectedDate || today;
    return { start: d, end: d };
  }
  if (mode === 'since_join') {
    return { start: joinDateStr || '2020-01-01', end: today };
  }
  if (mode === 'current_cycle') {
    if (lastActivePayment && lastActivePayment.paymentDate) {
      const nextDay = addDays(lastActivePayment.paymentDate, 1);
      return { start: nextDay, end: today };
    }
    return { start: joinDateStr || '2020-01-01', end: today };
  }
  return { start: today, end: today };
}

function computeCycleTotals({ uname, uData, cycleStart, cycleEnd, allAttendance, pickupsByAgentDate, allAdjustments }) {
  const salary = uData.salary || 0;
  const perDaySalary = salary / 30;

  const joinDateObj = uData.joinDate ? new Date(uData.joinDate + 'T00:00:00') : null;

  let totalBaseSalary = 0;
  let totalPickupIncentive = 0;
  let totalRejectIncentive = 0;
  let totalBonus = 0;
  let totalDeduction = 0;

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;

  let agentPickupCount = 0;
  let agentRejectCount = 0;
  let agentPendingCount = 0;
  let agentHalfDayCount = 0;

  let detailsHtml = '';
  const pendingRejects = [];
  const usedAdjustmentIds = [];

  const userAttendance = allAttendance[uname] || {};

  const startD = new Date(cycleStart + 'T00:00:00');
  const endD = new Date(cycleEnd + 'T00:00:00');

  let currentDate = new Date(startD);

  while (currentDate <= endD) {
    const dateStr = getLocalYMD(currentDate);

    if (joinDateObj && currentDate < joinDateObj) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    const att = userAttendance[dateStr] || {};
    const isPresent = att.status === 'present';
    const salaryCounted = att.salary_counted !== false;

    if (isPresent && salaryCounted) {
      if (att.half_day === true) {
        totalBaseSalary += perDaySalary * 0.5;
        halfDays++;
        agentHalfDayCount++;
      } else {
        totalBaseSalary += perDaySalary;
        presentDays++;
      }
    } else if (att.status === 'absent') {
      absentDays++;
    }

    const key = uname + '|' + dateStr;
    const dayPickups = pickupsByAgentDate[key] || [];

    for (const ord of dayPickups) {
      if (ord.status === 'pickup') {
        totalPickupIncentive += getActivityIncentive(ord, uData, 'pickup');
        agentPickupCount++;
      }
      if (ord.status === 'rejected' && Boolean(ord.incentive_approved)) {
        totalRejectIncentive += getActivityIncentive(ord, uData, 'reject');
        agentRejectCount++;
      }
      if (ord.status === 'rejected' && !Boolean(ord.incentive_approved)) {
        pendingRejects.push({ id: ord.orderId || ord.id, ...ord });
      }
      if (ord.status === 'reschedule') {
        agentPendingCount++;
      }
    }

    if (isPresent || att.status === 'absent') {
      let icon;
      if (isPresent) icon = att.half_day === true ? '🌗' : '✅';
      else icon = att.blocked ? '🔒' : '❌';
      detailsHtml += `<span class="text-xs mx-0.5" title="${dateStr}">${icon}</span>`;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // ADJUSTMENTS — all pending (unsettled) + non-reverted count in every mode
  const agentAdjustments = Object.values(allAdjustments[uname] || {});
  for (const adj of agentAdjustments) {
    if (adj.status === 'REVERTED') continue;
    if (adj.settledInCycle) continue;

    const amt = Number(adj.amount) || 0;
    if (adj.effect === 'add') totalBonus += amt;
    else if (adj.effect === 'deduct') totalDeduction += amt;

    usedAdjustmentIds.push(adj.id);
  }

  // Grand Total = Base + Bonus − Deduction (incentives EXCLUDED)
  const grandTotal = Math.max(0, totalBaseSalary + totalBonus - totalDeduction);

  const uniquePending = [];
  const seen = new Set();
  for (const pr of pendingRejects) {
    if (!seen.has(pr.id)) { seen.add(pr.id); uniquePending.push(pr); }
  }

  return {
    totalBaseSalary,
    totalBonus,
    totalDeduction,
    grandTotal,
    totalPickupIncentive,
    totalRejectIncentive,
    agentPickupCount,
    agentRejectCount,
    agentPendingCount,
    agentHalfDayCount,
    presentDays,
    halfDays,
    absentDays,
    detailsHtml,
    uniquePending,
    usedAdjustmentIds
  };
}

// ---------- Premium salary card ----------
function buildSalaryCard({
  uname, uData,
  cycleStart, cycleEnd, lastPaidDate, mode,
  totals,
  cycleAlreadyPaid, pendingAmount,
  joinDateDisplay, periodAttr,
  paidCyclesCount
}) {
  const t = totals;

  const fullyPaid = pendingAmount <= 0 && t.grandTotal > 0;
  const partiallyPaid = cycleAlreadyPaid > 0 && pendingAmount > 0;

  let statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">🔴 UNPAID</span>';
  if (fullyPaid) statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ FULLY PAID</span>';
  else if (partiallyPaid) statusBadge = '<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">⏳ PARTIALLY PAID</span>';

  const cycleLabel = cycleStart === cycleEnd
    ? cycleStart
    : `${cycleStart} → ${cycleEnd}`;

  return `
    <div class="glass rounded-2xl p-5 shadow-sm border border-gray-100 salary-summary-card">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <span class="font-bold text-gray-800 text-base">${uData.name || uname}</span>
          <span class="text-sm text-gray-500 ml-1">(${uname})</span>
          <span class="text-xs text-gray-400 ml-2">Joined: ${joinDateDisplay}</span>
        </div>
        <div class="flex items-center gap-2">
          ${statusBadge}
          <span class="text-[10px] text-gray-400">${paidCyclesCount} paid cycle${paidCyclesCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div class="mb-3 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span class="text-indigo-700 font-semibold">📅 Cycle: <strong>${cycleLabel}</strong></span>
        ${lastPaidDate ? `<span class="text-gray-500">Last paid: <strong>${lastPaidDate}</strong></span>` : '<span class="text-gray-500">No payment yet</span>'}
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div class="bg-gray-50 border border-gray-200 p-3 rounded-xl">
          <div class="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Base Salary</div>
          <div class="text-base font-bold text-gray-800 mt-1">${formatINR(t.totalBaseSalary)}</div>
          <div class="text-[10px] text-gray-400 mt-0.5">${t.presentDays} full · ${t.halfDays} half</div>
        </div>
        <div class="bg-blue-50 border border-blue-200 p-3 rounded-xl">
          <div class="text-[10px] text-blue-600 font-bold uppercase tracking-wide">+ Bonus</div>
          <div class="text-base font-bold text-blue-700 mt-1">+${formatINR(t.totalBonus)}</div>
        </div>
        <div class="bg-rose-50 border border-rose-200 p-3 rounded-xl">
          <div class="text-[10px] text-rose-600 font-bold uppercase tracking-wide">− Deduction</div>
          <div class="text-base font-bold text-rose-700 mt-1">-${formatINR(t.totalDeduction)}</div>
        </div>
        <div class="bg-emerald-50 border-2 border-emerald-300 p-3 rounded-xl">
          <div class="text-[10px] text-emerald-700 font-bold uppercase tracking-wide">Grand Total</div>
          <div class="text-lg font-black text-emerald-800 mt-1">${formatINR(t.grandTotal)}</div>
        </div>
      </div>

      <div class="mb-3 p-3 rounded-xl bg-amber-50 border border-dashed border-amber-300">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] font-bold text-amber-700 uppercase tracking-wide">💡 Incentives</span>
          <span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold">Excluded from Grand Total</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-white p-2 rounded-lg border border-amber-200">
            <div class="text-[10px] text-gray-500 font-semibold">📦 Pickup Incentive</div>
            <div class="text-sm font-bold text-green-700">${formatINR(t.totalPickupIncentive)}</div>
            <div class="text-[10px] text-gray-400">${t.agentPickupCount} pickups</div>
          </div>
          <div class="bg-white p-2 rounded-lg border border-amber-200">
            <div class="text-[10px] text-gray-500 font-semibold">❌ Reject Incentive</div>
            <div class="text-sm font-bold text-amber-700">${formatINR(t.totalRejectIncentive)}</div>
            <div class="text-[10px] text-gray-400">${t.agentRejectCount} rejects</div>
          </div>
        </div>
      </div>

      <div class="mb-3 grid grid-cols-2 gap-2">
        <div class="p-3 rounded-xl bg-gray-100 border border-gray-200">
          <div class="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Already Paid (this cycle)</div>
          <div class="text-base font-bold text-gray-800 mt-1">${formatINR(cycleAlreadyPaid)}</div>
        </div>
        <div class="p-3 rounded-xl ${pendingAmount > 0 ? 'bg-rose-50 border border-rose-200' : 'bg-emerald-50 border border-emerald-200'}">
          <div class="text-[10px] font-bold uppercase tracking-wide ${pendingAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}">Pending / Current</div>
          <div class="text-base font-black mt-1 ${pendingAmount > 0 ? 'text-rose-700' : 'text-emerald-700'}">${formatINR(pendingAmount)}</div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button onclick="openPaidModal('${uname}')" class="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition flex items-center gap-1.5">
          💰 Mark as Paid
        </button>
        <button onclick="openPaymentHistoryModal('${uname}')" class="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold border border-indigo-200 hover:bg-indigo-100 transition flex items-center gap-1.5">
          📜 Paid History
        </button>
        <button onclick="openAddAdjustmentModal('${uname}')" class="px-3 py-2 bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold border border-gray-200 hover:bg-gray-100 transition">
          ➕ Adjustment
        </button>
        <button onclick="openAdjustmentHistoryModal('${uname}')" class="px-3 py-2 bg-purple-50 text-purple-700 rounded-xl text-xs font-bold border border-purple-200 hover:bg-purple-100 transition">
          📋 Adj History
        </button>
        <button onclick='viewAgentActivityWithPeriod("${uname}", ${periodAttr})' class="px-3 py-2 bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold border border-gray-200 hover:bg-gray-100 transition">
          📊 Activity
        </button>
      </div>

      <div class="mt-2 text-xs text-gray-400">Attendance: ${t.detailsHtml}</div>

      ${t.uniquePending.length > 0 ? `
        <div class="mt-2 pt-2 border-t border-gray-200">
          <p class="text-xs font-bold text-amber-600">⏳ Pending Reject Approvals (${t.uniquePending.length})</p>
          <div class="flex flex-wrap gap-1 mt-1">
            ${t.uniquePending.map(pr => `
              <span class="text-xs bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                ${pr.orderId || pr.id}
                <button onclick="toggleRejectApproval('${pr.id}', true)" class="text-green-600 font-bold">✅</button>
                <button onclick="toggleRejectApproval('${pr.id}', false)" class="text-red-600 font-bold">❌</button>
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ---------- Main salary loader ----------
async function loadSalaryData(force = false) {
  const mode = currentSalaryMode || 'today';
  const container = $('salaryContainer');

  if (!container) return;

  container.innerHTML = `<div class="text-center py-4"><span class="spinner-sm"></span> Calculating...</div>`;

  try {
    const [users, pickups, allAttendance, allAdjustmentsSnap, allPaymentsSnap] = await Promise.all([
      getData('users', force),
      getData('pickups', force),
      getData('attendance', force),
      db.ref('adjustments').once('value'),
      db.ref('salary_payments').once('value')
    ]);

    const allAdjustments = allAdjustmentsSnap.val() || {};
    const allPayments = allPaymentsSnap.val() || {};

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

    const pickupsByAgentDate = {};
    Object.values(pickups).forEach(ord => {
      if (!ord.timestamp) return;
      if (ord.status === 'on_hold') return;
      if (!ord.agent) return;
      const ds = getLocalYMD(new Date(ord.timestamp));
      const key = ord.agent + '|' + ds;
      if (!pickupsByAgentDate[key]) pickupsByAgentDate[key] = [];
      pickupsByAgentDate[key].push(ord);
    });

    let html = '';
    let grandTotalAll = 0;
    let globalPickup = 0, globalReject = 0, globalPending = 0;

    const selectedDate = mode === 'date' ? (getVal('salaryDate') || getLocalYMD()) : null;

    for (const [uname, uData] of Object.entries(agents)) {
      const lastActivePayment = getLastActivePayment(allPayments, uname);
      const lastPaidDate = lastActivePayment ? lastActivePayment.paymentDate : null;

      const { start: cycleStart, end: cycleEnd } = computeCycleRangeForAgent(mode, uData, lastActivePayment, selectedDate);

      const totals = computeCycleTotals({
        uname, uData,
        cycleStart, cycleEnd,
        allAttendance,
        pickupsByAgentDate,
        allAdjustments
      });

      const agentPaysActive = getActivePaymentsForAgent(allPayments, uname);
      const cycleAlreadyPaid = agentPaysActive
        .filter(p => p.paymentDate && p.paymentDate >= cycleStart && p.paymentDate <= cycleEnd)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);

      const pendingAmount = Math.max(0, totals.grandTotal - cycleAlreadyPaid);

      grandTotalAll += totals.grandTotal;
      globalPickup += totals.agentPickupCount;
      globalReject += totals.agentRejectCount;
      globalPending += totals.agentPendingCount;

      const joinDateDisplay = uData.joinDate || '—';
      const paidCyclesCount = getActivePaymentsForAgent(allPayments, uname).length;

      const periodAttr = JSON.stringify({
        mode: 'current_cycle',
        cycleStart,
        cycleEnd,
        lastPaidDate
      }).replace(/"/g, '&quot;');

      html += buildSalaryCard({
        uname, uData,
        cycleStart, cycleEnd, lastPaidDate, mode,
        totals,
        cycleAlreadyPaid,
        pendingAmount,
        joinDateDisplay,
        periodAttr,
        paidCyclesCount
      });
    }

    setText('globalPickups', globalPickup);
    setText('globalRejects', globalReject);
    setText('globalPending', globalPending);
    setText('globalEarnings', formatINR(grandTotalAll));

    html += `<div class="text-right font-bold text-xl mt-4">Grand Total (All Agents): ${formatINR(grandTotalAll)}</div>`;

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
  invalidate('salary_payments');
  await loadSalaryData(true);
}

function setSalaryMode(mode) {
  currentSalaryMode = mode;

  $('salaryModeToday')?.classList.toggle('active', mode === 'today');
  $('salaryModeSinceJoin')?.classList.toggle('active', mode === 'since_join');
  $('salaryModeDate')?.classList.toggle('active', mode === 'date');
  $('salaryModeCurrentCycle')?.classList.toggle('active', mode === 'current_cycle');

  const wrapper = $('salaryDateWrapper');
  if (wrapper) wrapper.style.display = mode === 'date' ? 'inline-block' : 'none';

  const label = $('salaryModeLabel');

  if (label) {
    if (mode === 'today') {
      label.textContent = "Today's Earnings";
    } else if (mode === 'since_join') {
      label.textContent = "Complete Record — Since Joining Date";
    } else if (mode === 'date') {
      const dateVal = getVal('salaryDate') || 'selected date';
      label.textContent = `Earnings for ${dateVal}`;
    } else if (mode === 'current_cycle') {
      label.textContent = "Current Cycle — Since Last Payment";
    }
  }

  loadSalaryData(true);
}

// ---------- Mark as Paid ----------
async function openPaidModal(agentUsername) {
  if (!agentUsername) return;

  const users = await getData('users', false);
  const uData = users[agentUsername];
  if (!uData) { showToast('Agent not found', 'error'); return; }

  const paymentsSnap = await db.ref('salary_payments/' + agentUsername).once('value');
  const agentPayments = paymentsSnap.val() || {};

  const activePayments = Object.values(agentPayments)
    .filter(p => p.status !== 'UNDONE')
    .sort((a, b) => {
      const da = a.paymentDate || '';
      const dbb = b.paymentDate || '';
      if (da !== dbb) return dbb.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  const lastActivePayment = activePayments[0] || null;
  const lastPaidDate = lastActivePayment ? lastActivePayment.paymentDate : null;

  const today = getLocalYMD();
  const joinDateStr = uData.joinDate || null;
  const cycleStart = lastPaidDate ? addDays(lastPaidDate, 1) : (joinDateStr || '2020-01-01');
  const cycleEnd = today;

  const [pickups, allAttendance, allAdjustmentsSnap] = await Promise.all([
    getData('pickups', false),
    getData('attendance', false),
    db.ref('adjustments').once('value')
  ]);
  const allAdjustments = allAdjustmentsSnap.val() || {};

  const pickupsByAgentDate = {};
  Object.values(pickups).forEach(ord => {
    if (!ord.timestamp || ord.status === 'on_hold' || !ord.agent) return;
    const ds = getLocalYMD(new Date(ord.timestamp));
    const key = ord.agent + '|' + ds;
    if (!pickupsByAgentDate[key]) pickupsByAgentDate[key] = [];
    pickupsByAgentDate[key].push(ord);
  });

  const totals = computeCycleTotals({
    uname: agentUsername, uData,
    cycleStart, cycleEnd,
    allAttendance,
    pickupsByAgentDate,
    allAdjustments
  });

  const alreadyPaid = activePayments
    .filter(p => p.paymentDate && p.paymentDate >= cycleStart && p.paymentDate <= cycleEnd)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const pending = Math.max(0, totals.grandTotal - alreadyPaid);

  const step1 = await Swal.fire({
    title: '💰 Mark Salary as Paid?',
    html: `
      <div class="text-left text-sm space-y-2">
        <p class="text-gray-600">Are you sure you want to record a payment for:</p>
        <p class="font-bold text-lg text-gray-800">${uData.name || agentUsername}</p>
        <div class="bg-gray-50 p-3 rounded-xl border border-gray-200">
          <div class="flex justify-between text-xs"><span>Cycle:</span><strong>${cycleStart} → ${cycleEnd}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Base Salary:</span><strong>${formatINR(totals.totalBaseSalary)}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Bonus:</span><strong class="text-blue-600">+${formatINR(totals.totalBonus)}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Deduction:</span><strong class="text-rose-600">-${formatINR(totals.totalDeduction)}</strong></div>
          <div class="flex justify-between text-xs mt-1 pt-1 border-t border-gray-200"><span>Grand Total:</span><strong>${formatINR(totals.grandTotal)}</strong></div>
          ${alreadyPaid > 0 ? `<div class="flex justify-between text-xs mt-1 text-gray-600"><span>Already Paid:</span><strong>${formatINR(alreadyPaid)}</strong></div>` : ''}
          <div class="flex justify-between text-sm mt-2 pt-2 border-t border-gray-200"><span class="font-bold">Pending:</span><strong class="text-rose-600">${formatINR(pending)}</strong></div>
        </div>
        <p class="text-[11px] text-gray-500 font-semibold mt-2">✔️ Mark as Paid → cycle will close & a new fresh cycle starts automatically.</p>
        <p class="text-[11px] text-gray-400">Pickup/Reject incentives are excluded from Grand Total. Can be undone anytime.</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Yes, Continue',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b'
  });

  if (!step1.isConfirmed) return;

  const step2 = await Swal.fire({
    title: '💵 Enter Paid Amount',
    html: `
      <div class="text-left text-sm space-y-3">
        <p class="text-gray-500 text-xs">Enter the amount you are paying now:</p>
        <div>
          <label class="block font-semibold text-gray-700 mb-1 text-xs">Amount (₹)</label>
          <input type="number" id="paid_amount" class="swal2-input" placeholder="Enter amount" min="1" value="${pending || totals.grandTotal}">
        </div>
        <div>
          <label class="block font-semibold text-gray-700 mb-1 text-xs">Payment Date</label>
          <input type="date" id="paid_date" class="swal2-input" value="${today}">
        </div>
        <div>
          <label class="block font-semibold text-gray-700 mb-1 text-xs">Note (optional)</label>
          <input type="text" id="paid_note" class="swal2-input" placeholder="e.g. UPI transfer">
        </div>
        <p class="text-[11px] text-gray-400">ℹ️ After payment, a new cycle will start the next day.</p>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '✅ Confirm Payment',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b',
    preConfirm: () => {
      const amt = parseFloat(document.getElementById('paid_amount').value);
      const dt = document.getElementById('paid_date').value;
      const note = document.getElementById('paid_note').value.trim();
      if (!amt || amt <= 0) { Swal.showValidationMessage('Enter a valid amount'); return false; }
      if (!dt) { Swal.showValidationMessage('Select payment date'); return false; }
      return { amt, dt, note };
    }
  });

  if (!step2.isConfirmed) return;
  const { amt, dt, note } = step2.value;

  try {
    const payId = 'pay_' + Date.now();
    const entry = {
      id: payId,
      agent: agentUsername,

      // Payment info
      amount: Number(amt),
      paymentDate: dt,
      note: note || '',

      // Cycle snapshot (immutable)
      cycleStartDate: cycleStart,
      cycleEndDate: cycleEnd,
      cycleBaseSalary: totals.totalBaseSalary,
      cycleBonus: totals.totalBonus,
      cycleDeduction: totals.totalDeduction,
      cycleGrandTotal: totals.grandTotal,
      cyclePickupIncentive: totals.totalPickupIncentive,
      cycleRejectIncentive: totals.totalRejectIncentive,
      cyclePickupCount: totals.agentPickupCount,
      cycleRejectCount: totals.agentRejectCount,
      cycleHalfDayCount: totals.agentHalfDayCount,
      cyclePresentDays: totals.presentDays,
      cycleHalfDays: totals.halfDays,
      cycleAbsentDays: totals.absentDays,
      cycleAdjustmentIds: totals.usedAdjustmentIds || [],

      // Meta
      status: 'PAID',
      createdAt: Date.now(),
      createdBy: 'admin'
    };

    await db.ref('salary_payments/' + agentUsername + '/' + payId).set(entry);

    // Mark adjustments as settled (linked to this cycle) for cleaner next-cycle filtering
    if (totals.usedAdjustmentIds && totals.usedAdjustmentIds.length) {
      const adjUpdates = {};
      for (const adjId of totals.usedAdjustmentIds) {
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledInCycle`] = payId;
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledAt`] = Date.now();
      }
      await db.ref().update(adjUpdates);
    }

    invalidate('salary_payments');
    showToast(`✅ Payment of ${formatINR(amt)} recorded`, 'success');
    showToast(`🔄 Cycle closed. New cycle starts from ${addDays(dt, 1)}`, 'info', 4500);

    loadSalaryData(true);
    loadDashboard(true);
  } catch (e) {
    console.error(e);
    showToast('Failed to save payment', 'error');
  }
}

// ---------- Undo Paid Cycle ----------
async function undoPaidCycle(agentUsername, payId) {
  if (!agentUsername || !payId) return;

  const snap = await db.ref(`salary_payments/${agentUsername}/${payId}`).once('value');
  const entry = snap.val();

  if (!entry) {
    showToast('Payment record not found', 'error');
    return;
  }

  if (entry.status === 'UNDONE') {
    showToast('Already undone', 'info');
    return;
  }

  const confirm = await Swal.fire({
    title: '↩️ Undo Paid Cycle?',
    html: `
      <div class="text-left text-sm space-y-2">
        <p class="text-gray-600">This will reopen the cycle:</p>
        <div class="bg-amber-50 p-3 rounded-xl border border-amber-200">
          <div class="flex justify-between text-xs"><span>Cycle:</span><strong>${entry.cycleStartDate || '—'} → ${entry.cycleEndDate || '—'}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Paid amount:</span><strong class="text-emerald-700">${formatINR(entry.amount || 0)}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Paid on:</span><strong>${entry.paymentDate || '—'}</strong></div>
        </div>
        <p class="text-xs text-gray-500 mt-2">The cycle's Base Salary, Pickup, Reject, Bonus, and Deduction will be <strong>restored</strong> into the current cycle so you can correct and re-pay.</p>
        <p class="text-xs text-rose-600 font-semibold">⚠️ No data will be deleted — this action is fully reversible.</p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, Undo',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b'
  });

  if (!confirm.isConfirmed) return;

  try {
    const updates = {
      status: 'UNDONE',
      undoneAt: Date.now(),
      undoneBy: 'admin'
    };

    await db.ref(`salary_payments/${agentUsername}/${payId}`).update(updates);

    if (Array.isArray(entry.cycleAdjustmentIds) && entry.cycleAdjustmentIds.length) {
      const adjUpdates = {};
      for (const adjId of entry.cycleAdjustmentIds) {
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledInCycle`] = null;
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledAt`] = null;
      }
      await db.ref().update(adjUpdates);
    }

    invalidate('salary_payments');
    showToast('↩️ Paid cycle undone. Data restored.', 'success');

    loadSalaryData(true);
    loadDashboard(true);

    setTimeout(() => openPaymentHistoryModal(agentUsername), 300);
  } catch (e) {
    console.error(e);
    showToast('Failed to undo payment', 'error');
  }
}

async function redoPaidCycle(agentUsername, payId) {
  const snap = await db.ref(`salary_payments/${agentUsername}/${payId}`).once('value');
  const entry = snap.val();
  if (!entry) { showToast('Not found', 'error'); return; }

  if (entry.status !== 'UNDONE') { showToast('Already active', 'info'); return; }

  const confirm = await Swal.fire({
    title: 'Re-apply this Paid Cycle?',
    text: 'This will close the cycle again and start a fresh one.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Yes, Re-apply',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#059669',
    cancelButtonColor: '#64748b'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref(`salary_payments/${agentUsername}/${payId}`).update({
      status: 'PAID',
      redoneAt: Date.now()
    });

    if (Array.isArray(entry.cycleAdjustmentIds) && entry.cycleAdjustmentIds.length) {
      const adjUpdates = {};
      for (const adjId of entry.cycleAdjustmentIds) {
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledInCycle`] = payId;
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledAt`] = Date.now();
      }
      await db.ref().update(adjUpdates);
    }

    invalidate('salary_payments');
    showToast('✅ Cycle re-applied', 'success');

    loadSalaryData(true);
    loadDashboard(true);

    setTimeout(() => openPaymentHistoryModal(agentUsername), 300);
  } catch (e) {
    console.error(e);
    showToast('Failed to re-apply', 'error');
  }
}

// ---------- Delete Paid Cycle ----------
async function deletePaidCycle(agentUsername, payId) {
  if (!agentUsername || !payId) return;

  const snap = await db.ref(`salary_payments/${agentUsername}/${payId}`).once('value');
  const entry = snap.val();

  if (!entry) {
    showToast('Payment record not found', 'error');
    return;
  }

  const confirm = await Swal.fire({
    title: '🗑️ Delete Paid Cycle Permanently?',
    html: `
      <div class="text-left text-sm space-y-2">
        <p class="text-rose-600 font-semibold">⚠️ This will PERMANENTLY remove the payment record from Firebase.</p>
        <div class="bg-gray-50 p-3 rounded-xl border border-gray-200">
          <div class="flex justify-between text-xs"><span>Cycle:</span><strong>${entry.cycleStartDate || '—'} → ${entry.cycleEndDate || '—'}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Paid amount:</span><strong>${formatINR(entry.amount || 0)}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Paid on:</span><strong>${entry.paymentDate || '—'}</strong></div>
          <div class="flex justify-between text-xs mt-1"><span>Status:</span><strong>${entry.status || 'PAID'}</strong></div>
        </div>
        <p class="text-xs text-gray-600 mt-2">Agar sirf cycle ko reopen karna hai, to <strong>Undo</strong> use karein.<br>
        Delete sirf tab karein jab aap Firebase se record hataana chahte hain (irreversible).</p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Delete Permanently',
    cancelButtonText: 'Cancel'
  });

  if (!confirm.isConfirmed) return;

  try {
    if (Array.isArray(entry.cycleAdjustmentIds) && entry.cycleAdjustmentIds.length) {
      const adjUpdates = {};
      for (const adjId of entry.cycleAdjustmentIds) {
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledInCycle`] = null;
        adjUpdates[`adjustments/${agentUsername}/${adjId}/settledAt`] = null;
      }
      await db.ref().update(adjUpdates);
    }

    await db.ref(`salary_payments/${agentUsername}/${payId}`).remove();

    invalidate('salary_payments');
    showToast('🗑️ Paid cycle deleted from Firebase', 'success');

    loadSalaryData(true);
    loadDashboard(true);

    setTimeout(() => openPaymentHistoryModal(agentUsername), 300);
  } catch (e) {
    console.error(e);
    showToast('Failed to delete paid cycle', 'error');
  }
}

// ---------- Payment History modal ----------
async function openPaymentHistoryModal(agentUsername) {
  if (!agentUsername) return;

  try {
    const users = await getData('users', false);
    const uData = users[agentUsername] || { name: agentUsername };

    const snap = await db.ref('salary_payments/' + agentUsername).once('value');
    const payments = snap.val() || {};
    const list = Object.values(payments).sort((a, b) => {
      const da = a.paymentDate || '';
      const dbb = b.paymentDate || '';
      if (da !== dbb) return dbb.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    let rows = '';

    if (!list.length) {
      rows = '<tr><td colspan="8" class="text-center py-6 text-gray-400 text-sm">No payments recorded yet.</td></tr>';
    } else {
      rows = list.map((p, i) => {
        const isUndone = p.status === 'UNDONE';
        const statusBadge = isUndone
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-700">↩️ UNDONE</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ PAID</span>';

        const cycle = p.cycleStartDate === p.cycleEndDate
          ? (p.cycleStartDate || '—')
          : `${p.cycleStartDate || '—'} → ${p.cycleEndDate || '—'}`;

        const undoBtn = !isUndone
          ? `<button onclick="undoPaidCycle('${agentUsername}','${p.id}')" class="px-2 py-1 rounded bg-rose-50 text-rose-700 text-[11px] font-bold border border-rose-200 hover:bg-rose-100" title="Undo (restore data)">↩️ Undo</button>`
          : `<button onclick="redoPaidCycle('${agentUsername}','${p.id}')" class="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200 hover:bg-emerald-100" title="Re-apply">✔️ Re-apply</button>`;

        const deleteBtn = `<button onclick="deletePaidCycle('${agentUsername}','${p.id}')" class="px-2 py-1 rounded bg-red-50 text-red-600 text-[11px] font-bold border border-red-200 hover:bg-red-100 ml-1" title="Delete permanently from Firebase">🗑️</button>`;

        const rowStyle = isUndone ? 'opacity-60 line-through decoration-gray-300' : '';

        return `
          <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs ${rowStyle}">
            <td class="py-2.5 px-3 text-gray-500 font-mono">${i + 1}</td>
            <td class="py-2.5 px-3 font-semibold text-gray-800">${p.paymentDate || '—'}</td>
            <td class="py-2.5 px-3 text-gray-600">${cycle}</td>
            <td class="py-2.5 px-3 font-bold text-gray-800">${formatINR(p.cycleGrandTotal || 0)}</td>
            <td class="py-2.5 px-3 font-bold text-emerald-600">${formatINR(p.amount || 0)}</td>
            <td class="py-2.5 px-3">${statusBadge}</td>
            <td class="py-2.5 px-3 text-gray-500 max-w-[140px] truncate" title="${esc(p.note || '')}">${p.note || '—'}</td>
            <td class="py-2.5 px-3 text-right whitespace-nowrap">${undoBtn}${deleteBtn}</td>
          </tr>
        `;
      }).join('');
    }

    const activeList = list.filter(p => p.status !== 'UNDONE');
    const totalPaid = activeList.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    await Swal.fire({
      title: `📜 Paid History — ${uData.name || agentUsername}`,
      width: '1050px',
      html: `
        <div class="text-left py-2 font-sans">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span class="text-xs text-gray-500">Active cycles: <strong>${activeList.length}</strong> · Total cycles: <strong>${list.length}</strong></span>
            <span class="text-xs text-gray-500">Total paid: <strong class="text-emerald-600">${formatINR(totalPaid)}</strong></span>
          </div>
          <div class="max-h-[460px] overflow-y-auto border border-gray-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 text-[11px] uppercase font-bold sticky top-0">
                <tr>
                  <th class="py-2.5 px-3">#</th>
                  <th class="py-2.5 px-3">Payment Date</th>
                  <th class="py-2.5 px-3">Cycle Period</th>
                  <th class="py-2.5 px-3">Grand Total</th>
                  <th class="py-2.5 px-3">Paid Amount</th>
                  <th class="py-2.5 px-3">Status</th>
                  <th class="py-2.5 px-3">Note</th>
                  <th class="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100 text-[11px] text-gray-700 leading-relaxed">
            <p><strong>💡 Options:</strong></p>
            <p>• <strong>↩️ Undo</strong> → Cycle reopen ho jaayegi, saara data wapas restore ho jaayega.</p>
            <p>• <strong>✔️ Re-apply</strong> → Undone cycle ko wapas PAID mark kar dega.</p>
            <p>• <strong>🗑️ Delete</strong> → Firebase se permanently hata dega (irreversible).</p>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  } catch (e) {
    console.error(e);
    showToast('Failed to load payment history', 'error');
  }
}

async function openAllPaymentsHistoryModal() {
  try {
    const [users, snap] = await Promise.all([
      getData('users', false),
      db.ref('salary_payments').once('value')
    ]);
    const allPayments = snap.val() || {};

    let list = [];
    for (const [uname, uPays] of Object.entries(allPayments)) {
      for (const p of Object.values(uPays)) {
        list.push({ ...p, agent: uname });
      }
    }

    list.sort((a, b) => {
      const da = a.paymentDate || '';
      const dbb = b.paymentDate || '';
      if (da !== dbb) return dbb.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    let rows = '';
    if (!list.length) {
      rows = '<tr><td colspan="8" class="text-center py-6 text-gray-400 text-sm">No payments recorded yet.</td></tr>';
    } else {
      rows = list.map((p, i) => {
        const isUndone = p.status === 'UNDONE';
        const statusBadge = isUndone
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-700">↩️ UNDONE</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ PAID</span>';

        const cycle = p.cycleStartDate === p.cycleEndDate
          ? (p.cycleStartDate || '—')
          : `${p.cycleStartDate || '—'} → ${p.cycleEndDate || '—'}`;

        const agentName = (users[p.agent] && users[p.agent].name) || p.agent;

        const undoBtn = !isUndone
          ? `<button onclick="undoPaidCycle('${p.agent}','${p.id}')" class="px-2 py-1 rounded bg-rose-50 text-rose-700 text-[11px] font-bold border border-rose-200 hover:bg-rose-100">↩️</button>`
          : `<button onclick="redoPaidCycle('${p.agent}','${p.id}')" class="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200 hover:bg-emerald-100">✔️</button>`;

        const deleteBtn = `<button onclick="deletePaidCycle('${p.agent}','${p.id}')" class="px-2 py-1 rounded bg-red-50 text-red-600 text-[11px] font-bold border border-red-200 hover:bg-red-100 ml-1">🗑️</button>`;

        const rowStyle = isUndone ? 'opacity-60' : '';

        return `
          <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs ${rowStyle}">
            <td class="py-2.5 px-3 text-gray-500 font-mono">${i + 1}</td>
            <td class="py-2.5 px-3 font-semibold text-gray-800">${agentName} <span class="text-gray-400 font-mono">(${p.agent})</span></td>
            <td class="py-2.5 px-3 font-semibold text-gray-800">${p.paymentDate || '—'}</td>
            <td class="py-2.5 px-3 text-gray-600">${cycle}</td>
            <td class="py-2.5 px-3 font-bold text-gray-800">${formatINR(p.cycleGrandTotal || 0)}</td>
            <td class="py-2.5 px-3 font-bold text-emerald-600">${formatINR(p.amount || 0)}</td>
            <td class="py-2.5 px-3">${statusBadge}</td>
            <td class="py-2.5 px-3 text-right whitespace-nowrap">${undoBtn}${deleteBtn}</td>
          </tr>
        `;
      }).join('');
    }

    const activeList = list.filter(p => p.status !== 'UNDONE');
    const totalPaid = activeList.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    await Swal.fire({
      title: `📜 All Paid Cycles (All Agents)`,
      width: '1100px',
      html: `
        <div class="text-left py-2 font-sans">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span class="text-xs text-gray-500">Active cycles: <strong>${activeList.length}</strong> · Total cycles: <strong>${list.length}</strong></span>
            <span class="text-xs text-gray-500">Total paid: <strong class="text-emerald-600">${formatINR(totalPaid)}</strong></span>
          </div>
          <div class="max-h-[500px] overflow-y-auto border border-gray-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 text-[11px] uppercase font-bold sticky top-0">
                <tr>
                  <th class="py-2.5 px-3">#</th>
                  <th class="py-2.5 px-3">Agent</th>
                  <th class="py-2.5 px-3">Payment Date</th>
                  <th class="py-2.5 px-3">Cycle Period</th>
                  <th class="py-2.5 px-3">Grand Total</th>
                  <th class="py-2.5 px-3">Paid Amount</th>
                  <th class="py-2.5 px-3">Status</th>
                  <th class="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  } catch (e) {
    console.error(e);
    showToast('Failed to load history', 'error');
  }
}

// ================================================================
// ADJUSTMENT SYSTEM (Bonus / Deduction / Advance etc.)
// ================================================================
let currentAdjustmentAgent = null;

async function openAddAdjustmentModal(defaultAgent = '') {
  const users = await getData('users', false);
  const activeAgents = getActiveAgents(users);

  const agentOptions = Object.entries(activeAgents).map(([uname, u]) =>
    `<option value="${uname}" ${uname === defaultAgent ? 'selected' : ''}>${u.name || uname} (${uname})</option>`
  ).join('');

  const now = new Date();
  const todayDate = getLocalYMD(now);
  const curTime = now.toTimeString().slice(0, 5);

  const { value: formValues } = await Swal.fire({
    title: '➕ Add Payment / Adjustment',
    width: '560px',
    html: `
      <div class="text-left text-xs space-y-3 font-sans pt-1">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block font-semibold text-gray-700 mb-1">Select Agent</label>
            <select id="adj_agent" class="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white">
              ${agentOptions}
            </select>
          </div>
          <div>
            <label class="block font-semibold text-gray-700 mb-1">Type</label>
            <select id="adj_type" class="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="Bonus">🎁 Bonus (Add)</option>
              <option value="Incentive">⭐ Extra Incentive (Add)</option>
              <option value="Extra Salary">💵 Extra Salary (Add)</option>
              <option value="Advance">💸 Salary Advance (Deduct)</option>
              <option value="Penalty">⚠️ Penalty / Cut (Deduct)</option>
              <option value="Fuel/Travel Allowance">⛽ Fuel / Travel Allowance (Add)</option>
              <option value="Other Adjustment">📝 Other Adjustment</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block font-semibold text-gray-700 mb-1">Amount (₹)</label>
            <input type="number" id="adj_amount" min="1" placeholder="e.g. 500" class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block font-semibold text-gray-700 mb-1">Date & Time</label>
            <div class="flex gap-1">
              <input type="date" id="adj_date" value="${todayDate}" class="w-2/3 p-2 border border-gray-300 rounded-lg text-xs" />
              <input type="time" id="adj_time" value="${curTime}" class="w-1/3 p-2 border border-gray-300 rounded-lg text-xs" />
            </div>
          </div>
        </div>

        <div class="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
          <div class="font-semibold text-gray-800 text-[11px] uppercase tracking-wide">Adjustment Rules</div>

          <div class="flex items-center justify-between">
            <span class="text-gray-700 font-medium">Salary Effect:</span>
            <select id="adj_is_deduction" class="p-1 border border-gray-300 rounded text-xs bg-white">
              <option value="add">➕ Add to Salary (Earnings)</option>
              <option value="deduct">➖ Deduct from Salary</option>
              <option value="neutral">Neutral (Record only)</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-gray-700 font-medium">Deduct from Pickup/Reject Incentives?</span>
            <select id="adj_deduct_incentives" class="p-1 border border-gray-300 rounded text-xs bg-white">
              <option value="no">No (Base salary only)</option>
              <option value="yes">Yes (Can cut from incentives)</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-gray-700 font-medium">Adjustment Period:</span>
            <select id="adj_adjust_target" class="p-1 border border-gray-300 rounded text-xs bg-white">
              <option value="current">Current Month Salary</option>
              <option value="previous_balance">Previous Balance / Carry Forward</option>
            </select>
          </div>
        </div>

        <div>
          <label class="block font-semibold text-gray-700 mb-1">Reason / Notes</label>
          <input type="text" id="adj_reason" placeholder="e.g. Good performance on Sunday pickup rush" class="w-full p-2 border border-gray-300 rounded-lg text-xs" />
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '💾 Save Adjustment',
    confirmButtonColor: '#4f46e5',
    cancelButtonColor: '#64748b',
    preConfirm: () => {
      const agent = document.getElementById('adj_agent').value;
      const amount = Number(document.getElementById('adj_amount').value);
      const type = document.getElementById('adj_type').value;
      const date = document.getElementById('adj_date').value;
      const time = document.getElementById('adj_time').value;
      const effect = document.getElementById('adj_is_deduction').value;
      const deductIncentives = document.getElementById('adj_deduct_incentives').value;
      const adjustTarget = document.getElementById('adj_adjust_target').value;
      const reason = document.getElementById('adj_reason').value.trim();

      if (!agent) { Swal.showValidationMessage('Select an agent'); return false; }
      if (!amount || amount <= 0) { Swal.showValidationMessage('Enter a valid amount'); return false; }
      if (!date) { Swal.showValidationMessage('Select a date'); return false; }

      return { agent, amount, type, date, time, effect, deductIncentives, adjustTarget, reason };
    }
  });

  if (!formValues) return;

  try {
    const adjId = 'adj_' + Date.now();
    const entry = {
      id: adjId,
      agent: formValues.agent,
      amount: formValues.amount,
      type: formValues.type,
      date: formValues.date,
      time: formValues.time || '12:00',
      timestamp: new Date(`${formValues.date}T${formValues.time || '12:00'}`).getTime() || Date.now(),
      effect: formValues.effect,
      deductIncentives: formValues.deductIncentives === 'yes',
      adjustTarget: formValues.adjustTarget,
      reason: formValues.reason || 'None',

      // History meta
      createdAt: Date.now(),
      createdBy: 'admin',
      createdByName: 'Admin',
      status: 'ACTIVE', // ACTIVE | REVERTED
      settledInCycle: null,
      settledAt: null
    };

    await db.ref(`adjustments/${formValues.agent}/${adjId}`).set(entry);
    showToast(`✅ ${formValues.type} of ₹${formValues.amount} saved!`, 'success');

    loadSalaryData(true);
  } catch (e) {
    console.error('Error saving adjustment:', e);
    showToast('Failed to save adjustment', 'error');
  }
}

async function openAdjustmentHistoryModal(agentUsername = null) {
  try {
    const [snap, paymentsSnap] = await Promise.all([
      db.ref('adjustments').once('value'),
      db.ref('salary_payments').once('value')
    ]);
    const allAdjustments = snap.val() || {};
    const allPayments = paymentsSnap.val() || {};

    const paymentIndex = {};
    for (const [uname, uPays] of Object.entries(allPayments)) {
      for (const p of Object.values(uPays)) {
        paymentIndex[p.id] = {
          agent: uname,
          paymentDate: p.paymentDate,
          cycleStartDate: p.cycleStartDate,
          cycleEndDate: p.cycleEndDate,
          status: p.status || 'PAID'
        };
      }
    }

    let list = [];
    if (agentUsername) {
      const agentList = allAdjustments[agentUsername] || {};
      list = Object.values(agentList).map(a => ({ ...a, agent: agentUsername }));
    } else {
      for (const [uname, uAdj] of Object.entries(allAdjustments)) {
        for (const item of Object.values(uAdj)) {
          list.push({ ...item, agent: uname });
        }
      }
    }

    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let rowsHtml = '';
    if (!list.length) {
      rowsHtml = '<tr><td colspan="8" class="text-center py-6 text-gray-400">No adjustment entries found.</td></tr>';
    } else {
      rowsHtml = list.map(item => {
        const isAdd = item.effect === 'add';
        const isDeduct = item.effect === 'deduct';
        const colorClass = isAdd ? 'text-emerald-700 bg-emerald-50' : (isDeduct ? 'text-rose-700 bg-rose-50' : 'text-gray-700 bg-gray-50');
        const sign = isAdd ? '+₹' : (isDeduct ? '-₹' : '₹');

        const isReverted = item.status === 'REVERTED';

        let cycleLabel = '—';
        if (item.settledInCycle && paymentIndex[item.settledInCycle]) {
          const p = paymentIndex[item.settledInCycle];
          cycleLabel = `${p.cycleStartDate || '—'} → ${p.cycleEndDate || '—'}`;
          if (p.status === 'UNDONE') {
            cycleLabel += ' (undone)';
          }
        } else {
          cycleLabel = 'Current / Open';
        }

        let statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">🟢 ACTIVE</span>';
        if (isReverted) {
          statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-700">↩️ REVERTED</span>';
        } else if (item.settledInCycle) {
          statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ SETTLED</span>';
        }

        const createdInfo = item.createdAt
          ? new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
          : '—';

        const revertBtn = isReverted
          ? `<span class="text-[10px] text-gray-400">Reverted</span>`
          : `<button onclick="revertAdjustment('${item.agent}','${item.id}')" class="text-amber-600 hover:text-amber-800 font-semibold p-1" title="Revert">↩️</button>
             <button onclick="deleteAdjustment('${item.agent}','${item.id}')" class="text-rose-500 hover:text-rose-700 font-semibold p-1" title="Delete permanently">🗑</button>`;

        return `
          <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs ${isReverted ? 'opacity-60' : ''}">
            <td class="py-2.5 px-3 font-medium text-gray-800 whitespace-nowrap">${item.date || '—'} <span class="text-gray-400 font-mono">${item.time || ''}</span></td>
            <td class="py-2.5 px-3 font-semibold text-gray-700">${item.agent}</td>
            <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded font-semibold ${colorClass}">${item.type || '—'}</span></td>
            <td class="py-2.5 px-3 font-bold ${isAdd ? 'text-emerald-600' : (isDeduct ? 'text-rose-600' : 'text-gray-800')}">${sign}${item.amount || 0}</td>
            <td class="py-2.5 px-3 text-gray-600 max-w-[160px] truncate" title="${esc(item.reason || '')}">${esc(item.reason || '—')}</td>
            <td class="py-2.5 px-3 text-gray-600 whitespace-nowrap">${cycleLabel}</td>
            <td class="py-2.5 px-3">${statusBadge}<div class="text-[9px] text-gray-400 mt-0.5">by ${item.createdByName || item.createdBy || 'admin'} · ${createdInfo}</div></td>
            <td class="py-2.5 px-3 text-right whitespace-nowrap">${revertBtn}</td>
          </tr>
        `;
      }).join('');
    }

    await Swal.fire({
      title: agentUsername ? `Adjustment History: ${agentUsername}` : '📋 All Payments & Adjustments',
      width: '1150px',
      html: `
        <div class="text-left py-2 font-sans">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span class="text-xs text-gray-500 font-medium">Total entries: <strong>${list.length}</strong></span>
            <button onclick="Swal.close(); openAddAdjustmentModal('${agentUsername || ''}')" class="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700">
              ➕ Add New
            </button>
          </div>
          <div class="max-h-[460px] overflow-y-auto border border-gray-200 rounded-xl">
            <table class="w-full text-left">
              <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 text-[11px] uppercase font-bold sticky top-0">
                <tr>
                  <th class="py-2.5 px-3">Date/Time</th>
                  <th class="py-2.5 px-3">Agent</th>
                  <th class="py-2.5 px-3">Type</th>
                  <th class="py-2.5 px-3">Amount</th>
                  <th class="py-2.5 px-3">Reason / Notes</th>
                  <th class="py-2.5 px-3">Cycle</th>
                  <th class="py-2.5 px-3">Status</th>
                  <th class="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <p class="text-[11px] text-gray-400 mt-3">💡 Revert: settled adjustment ko wapas active kar dega (data safe). Delete: Firebase se permanently hata dega (irreversible).</p>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  } catch (e) {
    console.error(e);
    showToast('Failed to load history', 'error');
  }
}

async function revertAdjustment(agent, id) {
  const confirm = await Swal.fire({
    title: 'Revert this Adjustment?',
    html: `
      <div class="text-left text-xs space-y-2">
        <p class="text-gray-600">Is adjustment ko revert karne par:</p>
        <ul class="list-disc list-inside text-gray-700 space-y-1 ml-1">
          <li>Status <strong>REVERTED</strong> ho jaayega</li>
          <li>Salary calculation se effect hat jaayega</li>
          <li>Data delete nahi hoga — history mein dikhega</li>
        </ul>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: '↩️ Yes, Revert',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#d97706',
    cancelButtonColor: '#64748b'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref(`adjustments/${agent}/${id}`).update({
      status: 'REVERTED',
      revertedAt: Date.now(),
      revertedBy: 'admin',
      settledInCycle: null,
      settledAt: null
    });

    showToast('↩️ Adjustment reverted', 'success');
    loadSalaryData(true);
    setTimeout(() => openAdjustmentHistoryModal(agent), 300);
  } catch (e) {
    console.error(e);
    showToast('Failed to revert', 'error');
  }
}

async function deleteAdjustment(agent, id) {
  const confirm = await Swal.fire({
    title: 'Delete Adjustment?',
    html: `
      <div class="text-left text-xs">
        <p class="text-rose-600 font-semibold mb-2">⚠️ This will PERMANENTLY delete this adjustment from Firebase.</p>
        <p class="text-gray-600">Agar sirf effect hatana hai to <strong>Revert</strong> use karein.</p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Delete Permanently'
  });

  if (!confirm.isConfirmed) return;

  try {
    await db.ref(`adjustments/${agent}/${id}`).remove();
    showToast('Adjustment deleted', 'info');
    loadSalaryData(true);
    setTimeout(() => openAdjustmentHistoryModal(agent), 300);
  } catch (e) {
    showToast('Failed to delete', 'error');
  }
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

  invalidate('pickups', 'pending', 'users', 'deposits', 'attendance', 'salary_payments');

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
// INJECT SALARY HEADER BUTTONS
// ================================================================
function injectSalaryHeaderButtons() {
  const recalcBtn = document.querySelector('button[onclick="recalculateAllSalary()"]');
  if (!recalcBtn || !recalcBtn.parentElement) return;

  const parent = recalcBtn.parentElement;

  if (!$('globalAdjustBtn')) {
    const adjBtn = document.createElement('button');
    adjBtn.id = 'globalAdjustBtn';
    adjBtn.className = 'btn-action edit';
    adjBtn.innerHTML = '<i data-lucide="list"></i> Adjustments';
    adjBtn.onclick = () => openAdjustmentHistoryModal(null);
    parent.appendChild(adjBtn);
  }

  if (!$('globalPayHistBtn')) {
    const payHistBtn = document.createElement('button');
    payHistBtn.id = 'globalPayHistBtn';
    payHistBtn.className = 'btn-action view';
    payHistBtn.innerHTML = '<i data-lucide="receipt"></i> Paid History';
    payHistBtn.onclick = () => openAllPaymentsHistoryModal();
    parent.appendChild(payHistBtn);
  }

  if (!$('dateActivitiesBtn')) {
    const dateBtn = document.createElement('button');
    dateBtn.id = 'dateActivitiesBtn';
    dateBtn.className = 'btn-action save';
    dateBtn.innerHTML = '<i data-lucide="calendar-clock"></i> Date Activities';
    dateBtn.title = 'View / adjust incentive for a specific date';
    dateBtn.onclick = () => promptDateActivities();
    parent.appendChild(dateBtn);
  }

  refreshIcons();
}

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

  // Inject "Current Cycle" button dynamically (no HTML change)
  const salaryToggleBar = $('salaryModeDate')?.parentElement;
  if (salaryToggleBar && !$('salaryModeCurrentCycle')) {
    const btn = document.createElement('button');
    btn.id = 'salaryModeCurrentCycle';
    btn.className = 'salary-toggle-btn';
    btn.textContent = 'Current Cycle';
    btn.onclick = () => setSalaryMode('current_cycle');
    salaryToggleBar.appendChild(btn);
  }

  // Inject global salary header buttons
  injectSalaryHeaderButtons();

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

// ================================================================
// ATTENDANCE CALENDAR SYSTEM
// ================================================================
let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth() + 1;
let currentCalendarAgent = null;

async function viewAttendanceCalendar(username = null) {
  const users = await getData('users', false);
  const activeAgents = getActiveAgents(users);

  if (!username) {
    const firstKey = Object.keys(activeAgents)[0];
    if (!firstKey) { showToast('No active agents', 'warning'); return; }
    username = firstKey;
  }
  currentCalendarAgent = username;

  renderAttendanceCalendarModal();
}

function changeCalendarMonth(delta) {
  currentCalendarMonth += delta;
  if (currentCalendarMonth > 12) {
    currentCalendarMonth = 1;
    currentCalendarYear++;
  } else if (currentCalendarMonth < 1) {
    currentCalendarMonth = 12;
    currentCalendarYear--;
  }
  renderAttendanceCalendarModal();
}

async function renderAttendanceCalendarModal() {
  const username = currentCalendarAgent;
  const year = currentCalendarYear;
  const month = currentCalendarMonth;
  const monthStr = String(month).padStart(2, '0');

  const users = await getData('users', false);
  const uData = users[username] || { name: username };
  const activeAgents = getActiveAgents(users);

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthLabel = `${monthNames[month - 1]} ${year}`;

  const allAtt = await getData('attendance', true);
  const userAtt = (allAtt && allAtt[username]) || {};

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayIndex = new Date(year, month - 1, 1).getDay();

  let presentCount = 0;
  let halfDayCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;

  let calendarCells = '';

  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells += `<div class="p-2 min-h-[50px] bg-gray-50 rounded-lg border border-gray-100 opacity-30"></div>`;
  }

  const todayStr = getLocalYMD();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
    const att = userAtt[dateStr] || {};
    const status = att.status || (dateStr <= todayStr ? 'unmarked' : 'future');

    let bg = 'bg-white border-gray-200';
    let text = 'text-gray-400';
    let label = '—';

    if (status === 'present') {
      if (att.half_day === true) {
        halfDayCount++;
        bg = 'bg-amber-50 border-amber-200';
        text = 'text-amber-800 font-bold';
        label = '🌗 Half';
      } else {
        presentCount++;
        bg = 'bg-emerald-50 border-emerald-200';
        text = 'text-emerald-800 font-bold';
        label = '✅ Present';
      }
    } else if (status === 'absent') {
      absentCount++;
      bg = 'bg-rose-50 border-rose-200';
      text = 'text-rose-800 font-bold';
      label = '❌ Absent';
    } else if (status === 'unmarked') {
      unmarkedCount++;
      bg = 'bg-gray-50 border-gray-200';
      text = 'text-gray-500 font-medium';
      label = '⚪ None';
    } else {
      bg = 'bg-gray-50 border-gray-100 opacity-60';
      text = 'text-gray-400';
      label = '';
    }

    const isToday = dateStr === todayStr;

    calendarCells += `
      <div class="p-2 min-h-[55px] rounded-xl border ${bg} flex flex-col justify-between cursor-pointer hover:shadow-md transition"
           onclick="quickToggleDay('${username}', '${dateStr}', '${status}', ${att.half_day === true})">
        <div class="flex justify-between items-center text-xs">
          <span class="font-bold ${isToday ? 'px-1.5 py-0.5 bg-indigo-600 text-white rounded-full' : 'text-gray-700'}">${d}</span>
          ${att.timestamp ? `<span class="text-[9px] text-gray-400">${new Date(att.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>` : ''}
        </div>
        <div class="text-[11px] mt-1 ${text}">${label}</div>
      </div>
    `;
  }

  const agentSelectOptions = Object.entries(activeAgents).map(([uname, u]) =>
    `<option value="${uname}" ${uname === username ? 'selected' : ''}>${u.name || uname}</option>`
  ).join('');

  const attendancePercent = daysInMonth > 0 ? Math.round(((presentCount + (halfDayCount * 0.5)) / daysInMonth) * 100) : 0;

  const html = `
    <div class="text-left font-sans">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <label class="text-xs font-semibold text-gray-600">Agent:</label>
          <select id="cal_agent_select" onchange="currentCalendarAgent=this.value; renderAttendanceCalendarModal();" class="p-1.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-800 bg-white">
            ${agentSelectOptions}
          </select>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="changeCalendarMonth(-1)" class="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-100 font-bold text-gray-700 text-xs">◀ Prev</button>
          <span class="font-bold text-sm text-gray-800 min-w-[130px] text-center">${monthLabel}</span>
          <button onclick="changeCalendarMonth(1)" class="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-100 font-bold text-gray-700 text-xs">Next ▶</button>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-2 mb-4 text-center">
        <div class="p-2 bg-emerald-50 border border-emerald-100 rounded-xl">
          <div class="text-[10px] text-emerald-600 font-semibold uppercase">Present</div>
          <div class="text-lg font-bold text-emerald-800">${presentCount}</div>
        </div>
        <div class="p-2 bg-amber-50 border border-amber-100 rounded-xl">
          <div class="text-[10px] text-amber-600 font-semibold uppercase">Half Day</div>
          <div class="text-lg font-bold text-amber-800">${halfDayCount}</div>
        </div>
        <div class="p-2 bg-rose-50 border border-rose-100 rounded-xl">
          <div class="text-[10px] text-rose-600 font-semibold uppercase">Absent</div>
          <div class="text-lg font-bold text-rose-800">${absentCount}</div>
        </div>
        <div class="p-2 bg-indigo-50 border border-indigo-100 rounded-xl">
          <div class="text-[10px] text-indigo-600 font-semibold uppercase">Attendance %</div>
          <div class="text-lg font-bold text-indigo-800">${attendancePercent}%</div>
        </div>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-gray-500 mb-1">
        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
      </div>

      <div class="grid grid-cols-7 gap-1.5 max-h-[380px] overflow-y-auto no-scrollbar p-1">
        ${calendarCells}
      </div>

      <div class="text-[10px] text-gray-400 mt-3 text-center">
        💡 Click on any date box to instantly change or toggle status (Present / Half / Absent / Unmark).
      </div>
    </div>
  `;

  Swal.fire({
    title: '📅 Monthly Attendance Calendar',
    width: '720px',
    html: html,
    showConfirmButton: false,
    showCloseButton: true
  });
}

async function quickToggleDay(username, dateStr, currentStatus, isHalfDay) {
  const { value: newStatus } = await Swal.fire({
    title: `Date: ${dateStr}`,
    text: `Update status for ${username}:`,
    input: 'select',
    inputOptions: {
      'present_full': '✅ Present (Full Day)',
      'present_half': '🌗 Present (Half Day - 50%)',
      'absent': '❌ Absent',
      'unmarked': '⚪ Unmarked'
    },
    inputValue: isHalfDay ? 'present_half' : (currentStatus === 'present' ? 'present_full' : currentStatus),
    showCancelButton: true,
    confirmButtonText: 'Update',
    confirmButtonColor: '#4f46e5'
  });

  if (!newStatus) return;

  if (newStatus === 'present_full') {
    await setAgentAttendanceStatus(username, dateStr, 'present', false);
  } else if (newStatus === 'present_half') {
    await setAgentAttendanceStatus(username, dateStr, 'present', true);
  } else if (newStatus === 'absent') {
    await setAgentAttendanceStatus(username, dateStr, 'absent', false);
  } else if (newStatus === 'unmarked') {
    await db.ref(`attendance/${username}/${dateStr}`).remove();
    showToast('Marked as unmarked', 'info');
  }

  loadAttendance(true);
  renderAttendanceCalendarModal();
}

// ================================================================
// Expose functions for inline HTML handlers
// ================================================================
window.promptDateActivities = promptDateActivities;
window.openDateActivitiesModal = openDateActivitiesModal;
window.saveActivityIncentive = saveActivityIncentive;
window.resetActivityIncentive = resetActivityIncentive;