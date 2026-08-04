/* =====================================================================
   CAR RENTAL ERP — DB CLIENT (renderer process)
   -----------------------------------------------------------------
   The real database now lives in the Electron main process, backed by
   SQLite (see main/db-service.js) instead of IndexedDB — a real SQL
   database that scales comfortably to hundreds of thousands of
   customers/vehicles/contracts, with proper indexes, ACID transactions,
   and no browser storage quota limits.

   This file is intentionally a THIN PROXY: every function below has the
   exact same name and signature as the old IndexedDB-based db.js, so
   none of the page modules (vehicles.js, customers.js, contracts.js...)
   needed to change at all. Every call here just forwards to the main
   process over IPC (window.electronAPI, exposed by preload.js) and
   returns the result.
   ===================================================================== */
'use strict';

function requireApi() {
  if (!window.electronAPI || !window.electronAPI.db) {
    throw new Error('لا يمكن الوصول لقاعدة البيانات — يجب تشغيل البرنامج كتطبيق سطح مكتب (npm start) وليس كصفحة ويب مباشرة');
  }
  return window.electronAPI;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
window.uid = uid;

/* ── Crash-proof storage (unchanged from the previous version): some
   environments make `localStorage` THROW instead of just being empty.
   Session-only data (current logged-in user, theme) still lives here —
   it isn't business data, so it doesn't need to be in the SQL database. ── */
const SafeStorage = (() => {
  let backend;
  try {
    const testKey = '__cr_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    backend = window.localStorage;
  } catch (e) {
    console.warn('localStorage unavailable, falling back to in-memory storage:', e);
    const mem = new Map();
    backend = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
  return {
    get(key) { try { return backend.getItem(key); } catch { return null; } },
    set(key, value) { try { backend.setItem(key, value); } catch (e) { console.warn('storage set failed', e); } },
    remove(key) { try { backend.removeItem(key); } catch (e) { console.warn('storage remove failed', e); } },
  };
})();
window.SafeStorage = SafeStorage;

function getCurrentUserId() { return SafeStorage.get('cr_current_user') || null; }
function setCurrentUserId(id) { if (id) SafeStorage.set('cr_current_user', id); else SafeStorage.remove('cr_current_user'); }
window.getCurrentUserId = getCurrentUserId;
window.setCurrentUserId = setCurrentUserId;

/* ── Core CRUD proxy ── */
const DB = {
  async add(storeName, obj) {
    return requireApi().db.add(storeName, obj, getCurrentUserId());
  },
  async put(storeName, obj) {
    return requireApi().db.put(storeName, obj);
  },
  async get(storeName, id) {
    return requireApi().db.get(storeName, id);
  },
  async getAll(storeName) {
    return requireApi().db.getAll(storeName);
  },
  async getAllByIndex(storeName, indexName, value) {
    return requireApi().db.getAllByIndex(storeName, indexName, value);
  },
  async existsByIndex(storeName, indexName, value) {
    return requireApi().db.existsByIndex(storeName, indexName, value);
  },
  async delete(storeName, id) {
    return requireApi().db.delete(storeName, id, getCurrentUserId());
  },
  async count(storeName) {
    return requireApi().db.count(storeName);
  },
};
window.DB = DB;

/* ── Recycle bin ── */
window.restoreFromTrash = (logId) => requireApi().restoreFromTrash(logId, getCurrentUserId());
window.permanentlyPurgeTrashItem = (logId) => requireApi().permanentlyPurgeTrashItem(logId, getCurrentUserId());
window.purgeAllTrash = () => requireApi().purgeAllTrash(getCurrentUserId());
window.resetActivityLog = () => requireApi().resetActivityLog();

/* ── Archive / restore ── */
window.archiveRecord = (storeName, id, opts) => requireApi().archiveRecord(storeName, id, opts, getCurrentUserId());
window.restoreRecord = (storeName, id) => requireApi().restoreRecord(storeName, id, getCurrentUserId());

/* ── Treasury ── */
window.getAccountBalance = (accountId) => requireApi().getAccountBalance(accountId);
window.createTransaction = (payload) => requireApi().createTransaction(payload, getCurrentUserId());

/* ── Activity log labels (static — kept identical to the main-process copy) ── */
const ENTITY_LABEL = {
  vehicles: 'سيارة', customers: 'عميل', bookings: 'حجز', contracts: 'عقد',
  accounts: 'حساب/خزينة', transactions: 'حركة مالية', expenses: 'مصروف',
  partners: 'شريك', partnerTx: 'حركة شريك', employees: 'موظف', users: 'مستخدم',
  maintenance: 'أمر صيانة', returns: 'استلام سيارة', incidents: 'حادث/مخالفة',
};
window.ENTITY_LABEL = ENTITY_LABEL;

/* ── Settings ── */
window.getSettings = () => requireApi().getSettings();
window.saveSettings = (partial) => requireApi().saveSettings(partial);

const DEFAULT_SETTINGS = {
  companyName: 'شركة تأجير السيارات', tagline: 'Car Rental ERP', phone: '', address: '',
  currencySymbol: 'ج.م', defaultFreeKm: 200, defaultExtraKmPrice: 0, defaultTaxPercent: 0,
  maintenanceKmInterval: 5000, maintenanceDayInterval: 90, contractFooterNote: '',
  permissions: {
    admin:        { deleteRecords: true,  manageClosedContracts: true, resetActivityLog: true, permanentDelete: true },
    accountant:   { deleteRecords: false, manageClosedContracts: true, resetActivityLog: false, permanentDelete: false },
    receptionist: { deleteRecords: false, manageClosedContracts: false, resetActivityLog: false, permanentDelete: false },
    viewer:       { deleteRecords: false, manageClosedContracts: false, resetActivityLog: false, permanentDelete: false },
  },
  notifications: {
    contractsOverdue: true, contractsEndingSoon: true, licenseExpiring: true,
    maintenanceDue: true, unpaidViolations: true, upcomingBookings: true, vehicleDocs: true, daysAhead: 7,
  },
  printOptions: { showLogo: true, showSignatures: true, showFooterNote: true, paperSize: 'A4' },
  backup: { reminderEnabled: true, reminderDays: 7, lastBackupAt: '' },
};
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

/* ── Roles / permissions ── */
window.getCurrentUserRole = () => requireApi().getCurrentUserRole(getCurrentUserId());
window.hasPermission = (action) => requireApi().hasPermission(action, getCurrentUserId());

/* ── Password hashing (now scrypt under the hood, in the main process) ── */
window.randomSalt = () => requireApi().randomSalt();
window.hashPassword = (password, salt) => requireApi().hashPassword(password, salt);
window.verifyPassword = (password, salt, expectedHash) => requireApi().verifyPassword(password, salt, expectedHash);

/* ── Sequences / availability ── */
window.nextContractNo = () => requireApi().nextContractNo();
window.checkVehicleAvailability = (vehicleId, startDate, endDate, excludeId) =>
  requireApi().checkVehicleAvailability(vehicleId, startDate, endDate, excludeId || null);

/* ── Backup / restore (JSON) ── */
window.exportAllData = () => requireApi().exportAllData();
window.importAllData = (data) => requireApi().importAllData(data);

/* ── Validation / integrity ── */
window.isDuplicateValue = (storeName, field, value, excludeId) => requireApi().isDuplicateValue(storeName, field, value, excludeId || null);
window.runDataIntegrityCheck = () => requireApi().runDataIntegrityCheck();
window.vehicleDeleteBlockReason = (id) => requireApi().vehicleDeleteBlockReason(id);
window.customerDeleteBlockReason = (id) => requireApi().customerDeleteBlockReason(id);
window.employeeDeleteBlockReason = (id) => requireApi().employeeDeleteBlockReason(id);
window.accountDeleteBlockReason = (id) => requireApi().accountDeleteBlockReason(id);

/* ── Database maintenance (new — surfaced in Settings → "قاعدة البيانات") ── */
window.getDbInfo = () => requireApi().getDbInfo();
window.vacuumDb = () => requireApi().vacuum();
window.backupDbNow = () => requireApi().backupNow();
window.openDbFolder = () => requireApi().openDbFolder();
window.openBackupsFolder = () => requireApi().openBackupsFolder();

/* =====================================================================
   ONE-TIME MIGRATION: old IndexedDB data → new SQLite database
   -----------------------------------------------------------------
   If this machine has data in the old `car_rental_db` IndexedDB
   database (from a previous version of the app) and the new SQLite
   database is still empty, read every record out of IndexedDB once
   and push it into SQLite via a single atomic import. The old
   IndexedDB data is left untouched on disk (harmless, unused) so
   nothing is ever lost even if something goes wrong.
   ===================================================================== */
const LEGACY_IDB_NAME = 'car_rental_db';
const LEGACY_STORES = [
  'vehicles', 'customers', 'bookings', 'contracts', 'returns', 'accounts',
  'transactions', 'expenses', 'partners', 'partnerTx', 'employees',
  'maintenance', 'incidents', 'users', 'activityLog', 'meta',
];

function openLegacyIndexedDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    // Open without specifying a version so we don't trigger/force an
    // upgrade — we only want to *read* whatever is already there.
    const req = indexedDB.open(LEGACY_IDB_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve(null); // no legacy DB, or inaccessible — nothing to migrate
    req.onupgradeneeded = (e) => {
      // A DB didn't already exist — abort the (accidental) creation and report "nothing to migrate".
      e.target.transaction.abort();
      resolve(null);
    };
  });
}

function readLegacyStore(idb, storeName) {
  return new Promise((resolve) => {
    if (!idb.objectStoreNames.contains(storeName)) return resolve([]);
    try {
      const t = idb.transaction(storeName, 'readonly');
      const req = t.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

async function migrateFromIndexedDBIfNeeded() {
  try {
    const api = requireApi();
    const existingUsers = await api.db.getAll('users');
    if (existingUsers && existingUsers.length) return null; // SQLite already has data — never overwrite it

    const idb = await openLegacyIndexedDB();
    if (!idb) return null;

    const collected = {};
    let totalRows = 0;
    for (const store of LEGACY_STORES) {
      const rows = await readLegacyStore(idb, store);
      if (rows.length) { collected[store] = rows; totalRows += rows.length; }
    }
    idb.close();

    if (!totalRows) return null;

    const report = await api.migrateLegacyData(collected);
    console.info('تم نقل البيانات القديمة إلى قاعدة البيانات الجديدة:', report);
    return report;
  } catch (err) {
    console.warn('legacy data migration skipped due to an error:', err);
    return null;
  }
}
window.migrateFromIndexedDBIfNeeded = migrateFromIndexedDBIfNeeded;
