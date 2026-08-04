const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const dbService = require('./main/db-service');

// Ensures the Dock icon tooltip / top-left macOS menu bar shows the
// Arabic app name correctly, even when running unpacked (npm start).
app.setName('نظام تأجير السيارات');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }

let mainWindow;
let dbPaths = null;

function registerDbIpc() {
  // Generic CRUD (mirrors the old window.DB API)
  ipcMain.handle('db:add', (e, store, obj, userId) => dbService.DB.add(store, obj, userId));
  ipcMain.handle('db:put', (e, store, obj) => dbService.DB.put(store, obj));
  ipcMain.handle('db:get', (e, store, id) => dbService.DB.get(store, id));
  ipcMain.handle('db:getAll', (e, store) => dbService.DB.getAll(store));
  ipcMain.handle('db:getAllByIndex', (e, store, index, value) => dbService.DB.getAllByIndex(store, index, value));
  ipcMain.handle('db:existsByIndex', (e, store, index, value) => dbService.DB.existsByIndex(store, index, value));
  ipcMain.handle('db:delete', (e, store, id, userId) => dbService.DB.delete(store, id, userId));
  ipcMain.handle('db:count', (e, store) => dbService.DB.count(store));

  // Recycle bin
  ipcMain.handle('db:restoreFromTrash', (e, logId, userId) => dbService.restoreFromTrash(logId, userId));
  ipcMain.handle('db:permanentlyPurgeTrashItem', (e, logId, userId) => dbService.permanentlyPurgeTrashItem(logId, userId));
  ipcMain.handle('db:purgeAllTrash', (e, userId) => dbService.purgeAllTrash(userId));
  ipcMain.handle('db:resetActivityLog', () => dbService.resetActivityLog());

  // Archive / restore
  ipcMain.handle('db:archiveRecord', (e, store, id, opts, userId) => dbService.archiveRecord(store, id, opts, userId));
  ipcMain.handle('db:restoreRecord', (e, store, id, userId) => dbService.restoreRecord(store, id, userId));

  // Treasury
  ipcMain.handle('db:getAccountBalance', (e, accountId) => dbService.getAccountBalance(accountId));
  ipcMain.handle('db:createTransaction', (e, payload, userId) => dbService.createTransaction(payload, userId));

  // Settings
  ipcMain.handle('db:getSettings', () => dbService.getSettings());
  ipcMain.handle('db:saveSettings', (e, partial) => dbService.saveSettings(partial));

  // Roles / permissions / auth
  ipcMain.handle('db:getCurrentUserRole', (e, userId) => dbService.getCurrentUserRole(userId));
  ipcMain.handle('db:hasPermission', (e, action, userId) => dbService.hasPermission(action, userId));
  ipcMain.handle('db:randomSalt', () => dbService.randomSalt());
  ipcMain.handle('db:hashPassword', (e, password, salt) => dbService.hashPassword(password, salt));
  ipcMain.handle('db:verifyPassword', (e, password, salt, expectedHash) => dbService.verifyPassword(password, salt, expectedHash));

  // Sequences / availability
  ipcMain.handle('db:nextContractNo', () => dbService.nextContractNo());
  ipcMain.handle('db:checkVehicleAvailability', (e, vehicleId, startDate, endDate, excludeId) =>
    dbService.checkVehicleAvailability(vehicleId, startDate, endDate, excludeId));

  // Backup / restore (JSON) + legacy IndexedDB migration
  ipcMain.handle('db:exportAllData', () => dbService.exportAllData());
  ipcMain.handle('db:importAllData', (e, data) => dbService.importAllData(data));
  ipcMain.handle('db:migrateLegacyData', (e, data) => dbService.migrateLegacyData(data));

  // Validation / integrity
  ipcMain.handle('db:isDuplicateValue', (e, store, field, value, excludeId) => dbService.isDuplicateValue(store, field, value, excludeId));
  ipcMain.handle('db:runDataIntegrityCheck', () => dbService.runDataIntegrityCheck());
  ipcMain.handle('db:vehicleDeleteBlockReason', (e, id) => dbService.vehicleDeleteBlockReason(id));
  ipcMain.handle('db:customerDeleteBlockReason', (e, id) => dbService.customerDeleteBlockReason(id));
  ipcMain.handle('db:employeeDeleteBlockReason', (e, id) => dbService.employeeDeleteBlockReason(id));
  ipcMain.handle('db:accountDeleteBlockReason', (e, id) => dbService.accountDeleteBlockReason(id));

  // Database maintenance (new)
  ipcMain.handle('db:getDbInfo', () => dbService.getDbInfo());
  ipcMain.handle('db:vacuum', () => dbService.vacuum());
  ipcMain.handle('db:backupNow', () => dbService.backupNow());
  ipcMain.handle('db:openDbFolder', () => shell.showItemInFolder(dbPaths.dbFilePath));
  ipcMain.handle('db:openBackupsFolder', () => shell.openPath(dbPaths.backupsDir));
}

function buildMacMenu() {
  const template = [
    {
      label: 'نظام تأجير السيارات',
      submenu: [
        { role: 'about', label: 'حول البرنامج' },
        { type: 'separator' },
        {
          label: 'نسخة احتياطية الآن',
          accelerator: 'CmdOrCtrl+B',
          click: async () => {
            try { await dbService.backupNow(); } catch (err) { console.warn('backup failed', err); }
          }
        },
        { type: 'separator' },
        { role: 'services', label: 'خدمات' },
        { type: 'separator' },
        { role: 'hide', label: 'إخفاء' },
        { role: 'hideOthers', label: 'إخفاء الآخرين' },
        { role: 'unhide', label: 'إظهار الكل' },
        { type: 'separator' },
        { role: 'quit', label: 'إنهاء' },
      ],
    },
    {
      label: 'تحرير',
      submenu: [
        { role: 'undo', label: 'تراجع' },
        { role: 'redo', label: 'إعادة' },
        { type: 'separator' },
        { role: 'cut', label: 'قص' },
        { role: 'copy', label: 'نسخ' },
        { role: 'paste', label: 'لصق' },
        { role: 'selectAll', label: 'تحديد الكل' },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'resetZoom', label: 'الحجم الافتراضي' },
        { role: 'zoomIn', label: 'تكبير' },
        { role: 'zoomOut', label: 'تصغير' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' },
      ],
    },
    {
      label: 'نافذة',
      submenu: [
        { role: 'minimize', label: 'تصغير' },
        { role: 'close', label: 'إغلاق' },
        { role: 'zoom', label: 'تكبير النافذة' },
        { type: 'separator' },
        { role: 'front', label: 'إحضار الكل للأمام' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: 'نظام تأجير السيارات — Car Rental ERP',
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:car-rental-erp',
    }
  });

  if (process.platform === 'darwin') {
    buildMacMenu();
  } else {
    mainWindow.setMenuBarVisibility(false);
  }
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Open contract/print windows normally (used for "طباعة PDF")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file://')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          title: 'معاينة وطباعة العقد',
          backgroundColor: '#ffffff',
          width: 900,
          height: 1000,
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  try {
    dbPaths = dbService.initDb(app.getPath('userData'));
    registerDbIpc();

    // Best-effort automatic backup on launch, respecting the user's
    // existing backup settings (reminderEnabled / reminderDays), so
    // people who never remember to click "backup" still get one.
    try {
      const settings = dbService.getSettings();
      const last = settings.backup.lastBackupAt ? new Date(settings.backup.lastBackupAt).getTime() : 0;
      const daysSince = (Date.now() - last) / 86400000;
      if (settings.backup.reminderEnabled !== false && daysSince >= Number(settings.backup.reminderDays || 7)) {
        dbService.backupNow().catch(err => console.warn('auto-backup failed', err));
      }
    } catch (err) { console.warn('auto-backup check failed', err); }
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox('تعذّر تشغيل قاعدة البيانات',
      'حدث خطأ أثناء فتح قاعدة البيانات المحلية:\n' + (err && err.message || err) +
      '\n\nجرّب إعادة تثبيت البرنامج، أو تأكد من عدم وجود نسخة أخرى منه تعمل حالياً.');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('app:getVersion', () => app.getVersion());
