/* =====================================================================
   CAR RENTAL ERP — SQLite DATABASE SERVICE (main process only)
   -----------------------------------------------------------------
   Replaces the old renderer-side IndexedDB engine with a real,
   file-based SQL database (better-sqlite3 / SQLite). This runs
   ENTIRELY in the Electron main process — the renderer never touches
   the database directly, it only talks to this module over IPC
   (see main.js + preload.js + js/db.js).

   Why this is more robust than IndexedDB for "a lot of customers":
   - Real ACID transactions instead of best-effort browser storage.
   - WAL journal mode: fast concurrent reads/writes, crash-safe.
   - Real SQL indexes on every field the app used to filter by
     (phone, plate, status, contract number, ...) — lookups that used
     to be a full table scan in the browser are now indexed queries.
   - No browser storage quota (IndexedDB in Chromium/Electron can hit
     "QuotaExceededError" after a few hundred MB depending on disk
     space); SQLite is only limited by actual free disk space.
   - A single portable .sqlite3 file that's trivial to back up.
   ===================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

/* ── Store definitions: mirrors the old IndexedDB STORES config.
   `indexes` are fields we create real SQL indexes on (as SQLite
   "generated columns" derived from the JSON payload — no dual writes
   needed, the index just reads out of the JSON automatically). ── */
const STORES = {
  vehicles:     { key: 'id',  indexes: ['plate', 'status', 'category'] },
  customers:    { key: 'id',  indexes: ['phone', 'nationalId', 'name', '_archived'] },
  bookings:     { key: 'id',  indexes: ['vehicleId', 'customerId', 'status'] },
  contracts:    { key: 'id',  indexes: ['vehicleId', 'customerId', 'contractNo', 'status'] },
  returns:      { key: 'id',  indexes: ['contractId'] },
  accounts:     { key: 'id',  indexes: ['type', 'active'] },
  transactions: { key: 'id',  indexes: ['accountId', 'refType', 'refId', 'direction'] },
  expenses:     { key: 'id',  indexes: ['category', 'vehicleId', 'accountId', 'employeeId'] },
  partners:     { key: 'id',  indexes: [] },
  partnerTx:    { key: 'id',  indexes: ['partnerId'] },
  employees:    { key: 'id',  indexes: ['role', '_archived'] },
  maintenance:  { key: 'id',  indexes: ['vehicleId', 'status', 'type'] },
  incidents:    { key: 'id',  indexes: ['vehicleId', 'customerId', 'type', 'status'] },
  users:        { key: 'id',  indexes: ['username'] },
  activityLog:  { key: 'id',  indexes: ['entity', 'action', 'userId'] },
  meta:         { key: 'key', indexes: [] },
};

const NO_LOG_STORES = new Set(['activityLog', 'meta']);

const ENTITY_LABEL = {
  vehicles: 'سيارة', customers: 'عميل', bookings: 'حجز', contracts: 'عقد',
  accounts: 'حساب/خزينة', transactions: 'حركة مالية', expenses: 'مصروف',
  partners: 'شريك', partnerTx: 'حركة شريك', employees: 'موظف', users: 'مستخدم',
  maintenance: 'أمر صيانة', returns: 'استلام سيارة', incidents: 'حادث/مخالفة',
};

const DEFAULT_SETTINGS = {
  companyName: 'شركة تأجير السيارات',
  tagline: 'Car Rental ERP',
  phone: '',
  address: '',
  currencySymbol: 'ج.م',
  defaultFreeKm: 200,
  defaultExtraKmPrice: 0,
  defaultTaxPercent: 0,
  maintenanceKmInterval: 5000,
  maintenanceDayInterval: 90,
  contractFooterNote: '',
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

let db = null;
let dbFilePath = null;
let backupsDir = null;

/* ── Friendly error translation (kept in Arabic, like the old engine) ── */
function friendlyDbError(err) {
  const msg = String(err && err.message || err || '');
  if (/UNIQUE constraint/i.test(msg)) return new Error('هذه القيمة مستخدمة بالفعل ولا يمكن تكرارها');
  if (/SQLITE_FULL/i.test(msg) || /disk/i.test(msg)) return new Error('مساحة التخزين على الجهاز ممتلئة — حرّر مساحة وأعد المحاولة');
  if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(msg)) return new Error('قاعدة البيانات مشغولة حالياً — أعد المحاولة خلال لحظات');
  return err instanceof Error ? err : new Error(msg || 'خطأ غير معروف في قاعدة البيانات');
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() { return new Date().toISOString(); }

/* ── Schema creation ── */
function ensureSchema() {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF'); // records are flexible JSON documents, integrity is enforced at the app level (see guards below)

  for (const [name, cfg] of Object.entries(STORES)) {
    const keyCol = cfg.key === 'key' ? 'key' : 'id';
    db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (
      "${keyCol}" TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );`);

    // Add any indexed (generated) columns that don't exist yet — safe to
    // re-run every launch, so future app updates can add more indexes
    // to an existing user's database without any manual migration step.
    const existingCols = new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name));
    for (const field of cfg.indexes) {
      const col = `ix_${field}`;
      if (!existingCols.has(col)) {
        db.exec(`ALTER TABLE "${name}" ADD COLUMN "${col}" TEXT GENERATED ALWAYS AS (json_extract(data,'$.${field}')) VIRTUAL;`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_${name}_${field}" ON "${name}"("${col}");`);
    }
  }
}

function initDb(userDataPath) {
  const dir = path.join(userDataPath, 'database');
  fs.mkdirSync(dir, { recursive: true });
  backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  dbFilePath = path.join(dir, 'car-rental-erp.sqlite3');

  db = new Database(dbFilePath);
  ensureSchema();
  return { dbFilePath, backupsDir };
}

function colFor(store) { return STORES[store] && STORES[store].key === 'key' ? 'key' : 'id'; }

function rowToObj(row) {
  if (!row) return null;
  return JSON.parse(row.data);
}

/* ── Low-level row writer shared by add/put/import/logActivity — no
   activity logging here, callers decide when to log. ── */
function writeRow(storeName, obj) {
  const keyCol = colFor(storeName);
  const keyVal = obj[keyCol];
  if (!keyVal) throw new Error(`missing ${keyCol} for store ${storeName}`);
  const stmt = db.prepare(`INSERT INTO "${storeName}" ("${keyCol}", data, createdAt, updatedAt)
    VALUES (@key, @data, @createdAt, @updatedAt)
    ON CONFLICT("${keyCol}") DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`);
  stmt.run({ key: keyVal, data: JSON.stringify(obj), createdAt: obj.createdAt || null, updatedAt: obj.updatedAt || null });
  return obj;
}

function logActivity(entity, action, obj, userId) {
  try {
    const rec = {
      id: uid(),
      entity, action,
      label: ENTITY_LABEL[entity] || entity,
      summary: describeRecord(entity, obj || {}),
      refId: (obj && obj.id) || null,
      userId: userId || null,
      createdAt: nowIso(),
    };
    if (action === 'delete' && obj) rec.snapshot = JSON.stringify(obj);
    writeRow('activityLog', rec);
  } catch (e) { console.warn('activity log failed', e); }
}

function describeRecord(entity, obj) {
  if (entity === 'transactions') {
    const dir = obj.direction === 'in' ? 'قبض' : 'صرف';
    return `${dir} ${obj.amount ? Number(obj.amount).toLocaleString('ar-EG') : ''} — ${obj.category || ''}`.trim();
  }
  if (entity === 'accounts') return `${obj.name || ''}${obj.type ? ' (' + (obj.type === 'wallet' ? 'محفظة' : 'خزينة') + ')' : ''}`;
  return obj.plate || obj.name || obj.contractNo || obj.username || obj.category || obj.title || obj.id;
}

/* ── Core CRUD (mirrors the old window.DB API 1:1) ── */
const DB = {
  add(storeName, obj, userId) {
    try {
      const keyCol = colFor(storeName);
      const isNew = !obj[keyCol];
      if (isNew) obj[keyCol] = uid();
      if (!obj.createdAt) obj.createdAt = nowIso();
      obj.updatedAt = nowIso();
      writeRow(storeName, obj);
      if (!NO_LOG_STORES.has(storeName)) logActivity(storeName, isNew ? 'create' : 'update', obj, userId);
      return obj;
    } catch (e) { throw friendlyDbError(e); }
  },

  put(storeName, obj) {
    try {
      const keyCol = colFor(storeName);
      if (!obj[keyCol]) obj[keyCol] = uid();
      obj.updatedAt = nowIso();
      writeRow(storeName, obj);
      return obj;
    } catch (e) { throw friendlyDbError(e); }
  },

  get(storeName, id) {
    const keyCol = colFor(storeName);
    const row = db.prepare(`SELECT data FROM "${storeName}" WHERE "${keyCol}" = ?`).get(id);
    return rowToObj(row);
  },

  getAll(storeName) {
    const rows = db.prepare(`SELECT data FROM "${storeName}"`).all();
    return rows.map(r => JSON.parse(r.data));
  },

  getAllByIndex(storeName, indexName, value) {
    const cfg = STORES[storeName];
    if (!cfg || !cfg.indexes.includes(indexName)) {
      // fall back to a full scan if this isn't an indexed field
      return this.getAll(storeName).filter(r => r[indexName] === value);
    }
    const rows = db.prepare(`SELECT data FROM "${storeName}" WHERE "ix_${indexName}" = ?`).all(value);
    return rows.map(r => JSON.parse(r.data));
  },

  existsByIndex(storeName, indexName, value) {
    return this.getAllByIndex(storeName, indexName, value).length > 0;
  },

  delete(storeName, id, userId) {
    try {
      const keyCol = colFor(storeName);
      const existing = this.get(storeName, id) || { [keyCol]: id };
      db.prepare(`DELETE FROM "${storeName}" WHERE "${keyCol}" = ?`).run(id);
      if (!NO_LOG_STORES.has(storeName)) logActivity(storeName, 'delete', existing, userId);
      return true;
    } catch (e) { throw friendlyDbError(e); }
  },

  count(storeName) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${storeName}"`).get();
    return row.c;
  },
};

/* ── Recycle bin ── */
function restoreFromTrash(logId, userId) {
  const logRec = DB.get('activityLog', logId);
  if (!logRec || logRec.action !== 'delete' || !logRec.snapshot) return null;
  const snapshot = JSON.parse(logRec.snapshot);
  const restored = DB.put(logRec.entity, snapshot);
  logRec.restoredAt = nowIso();
  DB.put('activityLog', logRec);
  logActivity(logRec.entity, 'restore', snapshot, userId);
  return restored;
}

function permanentlyPurgeTrashItem(logId, userId) {
  const rec = DB.get('activityLog', logId);
  if (!rec || rec.action !== 'delete' || rec.restoredAt) return null;
  rec.snapshot = null;
  rec.purgedAt = nowIso();
  rec.purgedBy = userId || null;
  DB.put('activityLog', rec);
  return rec;
}

function purgeAllTrash(userId) {
  const log = DB.getAll('activityLog');
  const deletions = log.filter(l => l.action === 'delete' && l.snapshot && !l.restoredAt);
  const runAll = db.transaction((items) => {
    for (const rec of items) {
      rec.snapshot = null;
      rec.purgedAt = nowIso();
      rec.purgedBy = userId || null;
      writeRow('activityLog', rec);
    }
  });
  runAll(deletions);
  return deletions.length;
}

function resetActivityLog() {
  db.exec(`DELETE FROM "activityLog"`);
  return true;
}

/* ── Archive / restore (soft delete) ── */
function archiveRecord(storeName, id, opts, userId) {
  opts = opts || {};
  const rec = DB.get(storeName, id);
  if (!rec) return null;
  rec._archived = '1';
  rec._archivedAt = nowIso();
  rec._archivedBy = userId || null;
  rec._previousStatus = rec.status || null;
  if (opts.reason) rec._archiveReason = opts.reason;
  if (opts.newStatus) rec.status = opts.newStatus;
  const saved = DB.put(storeName, rec);
  logActivity(storeName, 'archive', saved, userId);
  return saved;
}

function restoreRecord(storeName, id, userId) {
  const rec = DB.get(storeName, id);
  if (!rec) return null;
  rec._archived = '0';
  if (rec._previousStatus) rec.status = rec._previousStatus;
  delete rec._archiveReason;
  const saved = DB.put(storeName, rec);
  logActivity(storeName, 'restore', saved, userId);
  return saved;
}

/* ── Treasury ── */
function getAccountBalance(accountId) {
  const txs = DB.getAllByIndex('transactions', 'accountId', accountId);
  return txs.filter(t => t._archived !== '1')
    .reduce((sum, t) => sum + (t.direction === 'in' ? Number(t.amount) : -Number(t.amount)), 0);
}

function createTransaction(payload, userId) {
  const { accountId, direction, amount, category, refType, note, refId } = payload;
  return DB.add('transactions', {
    accountId, direction, amount: Number(amount), category: category || 'أخرى',
    refType: refType || 'manual', refId: refId || null, note: note || '', date: nowIso(),
    createdBy: userId || null,
  }, userId);
}

/* ── Settings ── */
function mergeSettings(saved) {
  const s = saved || {};
  const out = Object.assign({}, DEFAULT_SETTINGS, s);
  out.permissions = {};
  Object.keys(DEFAULT_SETTINGS.permissions).forEach(role => {
    out.permissions[role] = Object.assign({}, DEFAULT_SETTINGS.permissions[role], (s.permissions || {})[role] || {});
  });
  out.notifications = Object.assign({}, DEFAULT_SETTINGS.notifications, s.notifications || {});
  out.printOptions = Object.assign({}, DEFAULT_SETTINGS.printOptions, s.printOptions || {});
  out.backup = Object.assign({}, DEFAULT_SETTINGS.backup, s.backup || {});
  return out;
}

function getSettings() {
  const rec = DB.get('meta', 'company_settings');
  return mergeSettings(rec ? rec.value : {});
}

function saveSettings(partial) {
  const rec = DB.get('meta', 'company_settings');
  const merged = mergeSettings(Object.assign({}, rec ? rec.value : {}, partial));
  DB.put('meta', { key: 'company_settings', value: merged });
  return merged;
}

/* ── Roles / permissions ── */
function getCurrentUserRole(userId) {
  if (!userId) return 'admin';
  try {
    const u = DB.get('users', userId);
    return (u && u.role) || 'admin';
  } catch (e) { return 'admin'; }
}

function hasPermission(action, userId) {
  const role = getCurrentUserRole(userId);
  if (role === 'admin') return true;
  const settings = getSettings();
  return !!(settings.permissions && settings.permissions[role] && settings.permissions[role][action]);
}

/* ── Password hashing — upgraded from plain salted SHA-256 to scrypt
   (Node's built-in memory-hard KDF), a meaningful security improvement
   while keeping the exact same function signatures the app already
   uses (randomSalt / hashPassword / verifyPassword). ── */
function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(String(expectedHash), 'hex'));
  } catch (e) { return actual === expectedHash; }
}

/* ── Sequence numbers ── */
function nextSequence(key) {
  const rec = DB.get('meta', key);
  const next = ((rec && rec.value) || 0) + 1;
  DB.put('meta', { key, value: next });
  return next;
}

function nextContractNo() {
  const year = new Date().getFullYear();
  const seq = nextSequence('contract_seq_' + year);
  return `CR-${year}-${String(seq).padStart(4, '0')}`;
}

/* ── Availability / double-booking prevention ── */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function checkVehicleAvailability(vehicleId, startDate, endDate, excludeId) {
  const vehicleBookings = DB.getAllByIndex('bookings', 'vehicleId', vehicleId);
  const vehicleContracts = DB.getAllByIndex('contracts', 'vehicleId', vehicleId);

  const conflictingBooking = vehicleBookings.find(b =>
    b.id !== excludeId &&
    ['pending', 'confirmed'].includes(b.status) &&
    rangesOverlap(startDate, endDate, b.startDate, b.endDate)
  );

  const conflictingContract = vehicleContracts.find(c =>
    c.id !== excludeId &&
    c.status === 'active' &&
    rangesOverlap(startDate, endDate, c.startDate, c.endDate)
  );

  return {
    available: !conflictingBooking && !conflictingContract,
    conflict: conflictingBooking || conflictingContract || null,
  };
}

/* ── Export / Import (JSON backup) — now a single atomic transaction,
   so a restore either fully succeeds or changes nothing at all, instead
   of the old row-by-row loop that could leave a half-imported database
   behind if something failed partway through. ── */
function exportAllData() {
  const data = {};
  for (const name of Object.keys(STORES)) data[name] = DB.getAll(name);
  return data;
}

function importAllData(data) {
  const runImport = db.transaction((incoming) => {
    for (const name of Object.keys(STORES)) {
      if (!Array.isArray(incoming[name])) continue;
      for (const obj of incoming[name]) writeRow(name, obj);
    }
  });
  runImport(data || {});
  return true;
}

/** Bulk import used only by the one-time legacy-IndexedDB migration —
 *  same as importAllData but only touches stores that actually have
 *  incoming rows, and reports how many rows were migrated per store. */
function migrateLegacyData(data) {
  const report = {};
  const runImport = db.transaction((incoming) => {
    for (const name of Object.keys(STORES)) {
      const rows = incoming[name];
      if (!Array.isArray(rows) || !rows.length) continue;
      for (const obj of rows) writeRow(name, obj);
      report[name] = rows.length;
    }
  });
  runImport(data || {});
  return report;
}

/* ── Duplicate check ── */
function isDuplicateValue(storeName, field, value, excludeId) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const norm = String(value).trim().toLowerCase();
  const all = DB.getAll(storeName);
  return all.some(r => r.id !== excludeId && String(r[field] || '').trim().toLowerCase() === norm);
}

/* ── Data integrity scan ── */
function runDataIntegrityCheck() {
  const vehicles = DB.getAll('vehicles'), customers = DB.getAll('customers'), contracts = DB.getAll('contracts'),
    bookings = DB.getAll('bookings'), returns = DB.getAll('returns'), maintenance = DB.getAll('maintenance'),
    incidents = DB.getAll('incidents'), expenses = DB.getAll('expenses'), accounts = DB.getAll('accounts'),
    transactions = DB.getAll('transactions'), employees = DB.getAll('employees');

  const vIds = new Set(vehicles.map(v => v.id));
  const cIds = new Set(customers.map(c => c.id));
  const contractIds = new Set(contracts.map(c => c.id));
  const accIds = new Set(accounts.map(a => a.id));

  const issues = [];
  const add = (severity, area, message) => issues.push({ severity, area, message });

  contracts.forEach(c => {
    if (c.vehicleId && !vIds.has(c.vehicleId)) add('error', 'العقود', `العقد ${c.contractNo || c.id} يشير إلى سيارة محذوفة`);
    if (c.customerId && !cIds.has(c.customerId)) add('error', 'العقود', `العقد ${c.contractNo || c.id} يشير إلى عميل محذوف`);
    if (Number(c.paidAmount || 0) > Number(c.totalAmount || 0)) add('warn', 'العقود', `العقد ${c.contractNo || c.id}: المدفوع أكبر من الإجمالي`);
  });
  bookings.forEach(b => {
    if (b.vehicleId && !vIds.has(b.vehicleId)) add('error', 'الحجوزات', `حجز يشير إلى سيارة محذوفة`);
    if (b.customerId && !cIds.has(b.customerId)) add('error', 'الحجوزات', `حجز يشير إلى عميل محذوف`);
  });
  returns.forEach(r => {
    if (r.contractId && !contractIds.has(r.contractId)) add('error', 'المرتجعات', `سجل استلام يشير إلى عقد محذوف`);
  });
  maintenance.forEach(m => {
    if (m.vehicleId && !vIds.has(m.vehicleId)) add('error', 'الصيانة', `أمر صيانة يشير إلى سيارة محذوفة`);
  });
  incidents.forEach(i => {
    if (i.vehicleId && !vIds.has(i.vehicleId)) add('error', 'الحوادث والمخالفات', `سجل يشير إلى سيارة محذوفة`);
    if (i.customerId && !cIds.has(i.customerId)) add('error', 'الحوادث والمخالفات', `سجل يشير إلى عميل محذوف`);
  });
  expenses.forEach(e => {
    if (e.accountId && !accIds.has(e.accountId)) add('error', 'المصروفات', `مصروف "${e.category || ''}" يشير إلى حساب محذوف`);
    if (e.vehicleId && !vIds.has(e.vehicleId)) add('warn', 'المصروفات', `مصروف "${e.category || ''}" يشير إلى سيارة محذوفة`);
  });
  transactions.forEach(t => {
    if (t.accountId && !accIds.has(t.accountId)) add('error', 'الخزينة', `حركة مالية (${t.category || ''}) تشير إلى حساب محذوف`);
  });

  const plateSeen = new Map();
  vehicles.forEach(v => {
    const key = (v.plate || '').trim().toLowerCase();
    if (!key) return;
    if (plateSeen.has(key)) add('warn', 'السيارات', `رقم لوحة مكرر: ${v.plate}`);
    plateSeen.set(key, true);
  });

  return {
    issues,
    counts: {
      vehicles: vehicles.length, customers: customers.length, contracts: contracts.length,
      bookings: bookings.length, employees: employees.length, accounts: accounts.length,
      transactions: transactions.length, expenses: expenses.length,
    },
  };
}

/* ── Referential-integrity delete guards ── */
function vehicleDeleteBlockReason(vehicleId) {
  const contracts = DB.getAllByIndex('contracts', 'vehicleId', vehicleId);
  const bookings = DB.getAllByIndex('bookings', 'vehicleId', vehicleId);
  const maintenance = DB.getAllByIndex('maintenance', 'vehicleId', vehicleId);
  if (contracts.some(c => c.status === 'active')) return 'يوجد عقد إيجار ساري على هذه السيارة';
  if (bookings.some(b => ['pending', 'confirmed'].includes(b.status))) return 'يوجد حجز نشط على هذه السيارة';
  if (maintenance.some(m => m.status === 'in_progress')) return 'السيارة تحت الصيانة حالياً';
  return null;
}

function customerDeleteBlockReason(customerId) {
  const contracts = DB.getAllByIndex('contracts', 'customerId', customerId);
  if (contracts.some(c => c.status === 'active')) return 'يوجد عقد إيجار ساري لهذا العميل';
  return null;
}

function employeeDeleteBlockReason(employeeId) {
  const linked = DB.getAllByIndex('expenses', 'employeeId', employeeId);
  if (linked.length) return 'يوجد مصروفات مالية (رواتب/عمولات) مسجّلة لهذا الموظف';
  return null;
}

function accountDeleteBlockReason(accountId) {
  const linked = DB.getAllByIndex('transactions', 'accountId', accountId);
  return linked.length
    ? 'يوجد حركات مالية مسجّلة على هذا الحساب — أوقف الحساب بدلاً من حذفه للحفاظ على سجل الحركات'
    : null;
}

/* ── Database maintenance (new: exposed in Settings → "قاعدة البيانات") ── */
function getDbInfo() {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(dbFilePath).size; } catch (e) { /* ignore */ }
  const counts = {};
  for (const name of Object.keys(STORES)) counts[name] = DB.count(name);
  return { path: dbFilePath, backupsDir, sizeBytes, counts };
}

function vacuum() {
  db.exec('VACUUM;');
  return true;
}

/** Copies the live SQLite file to the backups folder (uses SQLite's own
 *  online backup API, so it's safe to run while the app is in use), and
 *  keeps only the most recent `keep` backups so disk usage doesn't grow
 *  forever. */
async function backupNow(keep) {
  keep = keep || 20;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir, `car-rental-erp-${stamp}.sqlite3`);
  await db.backup(dest);
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.sqlite3'))
    .map(f => ({ f, t: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.slice(keep).forEach(({ f }) => { try { fs.unlinkSync(path.join(backupsDir, f)); } catch (e) {} });
  saveSettings({ backup: Object.assign({}, getSettings().backup, { lastBackupAt: nowIso() }) });
  return dest;
}

module.exports = {
  STORES, ENTITY_LABEL, DEFAULT_SETTINGS,
  initDb, uid,
  DB,
  logActivity, restoreFromTrash, permanentlyPurgeTrashItem, purgeAllTrash, resetActivityLog,
  archiveRecord, restoreRecord,
  getAccountBalance, createTransaction,
  getSettings, saveSettings,
  getCurrentUserRole, hasPermission,
  randomSalt, hashPassword, verifyPassword,
  nextContractNo, checkVehicleAvailability,
  exportAllData, importAllData, migrateLegacyData,
  isDuplicateValue, runDataIntegrityCheck,
  vehicleDeleteBlockReason, customerDeleteBlockReason, employeeDeleteBlockReason, accountDeleteBlockReason,
  getDbInfo, vacuum, backupNow,
};
