const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  db: {
    add: (store, obj, userId) => ipcRenderer.invoke('db:add', store, obj, userId),
    put: (store, obj) => ipcRenderer.invoke('db:put', store, obj),
    get: (store, id) => ipcRenderer.invoke('db:get', store, id),
    getAll: (store) => ipcRenderer.invoke('db:getAll', store),
    getAllByIndex: (store, index, value) => ipcRenderer.invoke('db:getAllByIndex', store, index, value),
    existsByIndex: (store, index, value) => ipcRenderer.invoke('db:existsByIndex', store, index, value),
    delete: (store, id, userId) => ipcRenderer.invoke('db:delete', store, id, userId),
    count: (store) => ipcRenderer.invoke('db:count', store),
  },

  restoreFromTrash: (logId, userId) => ipcRenderer.invoke('db:restoreFromTrash', logId, userId),
  permanentlyPurgeTrashItem: (logId, userId) => ipcRenderer.invoke('db:permanentlyPurgeTrashItem', logId, userId),
  purgeAllTrash: (userId) => ipcRenderer.invoke('db:purgeAllTrash', userId),
  resetActivityLog: () => ipcRenderer.invoke('db:resetActivityLog'),

  archiveRecord: (store, id, opts, userId) => ipcRenderer.invoke('db:archiveRecord', store, id, opts, userId),
  restoreRecord: (store, id, userId) => ipcRenderer.invoke('db:restoreRecord', store, id, userId),

  getAccountBalance: (accountId) => ipcRenderer.invoke('db:getAccountBalance', accountId),
  createTransaction: (payload, userId) => ipcRenderer.invoke('db:createTransaction', payload, userId),

  getSettings: () => ipcRenderer.invoke('db:getSettings'),
  saveSettings: (partial) => ipcRenderer.invoke('db:saveSettings', partial),

  getCurrentUserRole: (userId) => ipcRenderer.invoke('db:getCurrentUserRole', userId),
  hasPermission: (action, userId) => ipcRenderer.invoke('db:hasPermission', action, userId),
  randomSalt: () => ipcRenderer.invoke('db:randomSalt'),
  hashPassword: (password, salt) => ipcRenderer.invoke('db:hashPassword', password, salt),
  verifyPassword: (password, salt, expectedHash) => ipcRenderer.invoke('db:verifyPassword', password, salt, expectedHash),

  nextContractNo: () => ipcRenderer.invoke('db:nextContractNo'),
  checkVehicleAvailability: (vehicleId, startDate, endDate, excludeId) =>
    ipcRenderer.invoke('db:checkVehicleAvailability', vehicleId, startDate, endDate, excludeId),

  exportAllData: () => ipcRenderer.invoke('db:exportAllData'),
  importAllData: (data) => ipcRenderer.invoke('db:importAllData', data),
  migrateLegacyData: (data) => ipcRenderer.invoke('db:migrateLegacyData', data),

  isDuplicateValue: (store, field, value, excludeId) => ipcRenderer.invoke('db:isDuplicateValue', store, field, value, excludeId),
  runDataIntegrityCheck: () => ipcRenderer.invoke('db:runDataIntegrityCheck'),
  vehicleDeleteBlockReason: (id) => ipcRenderer.invoke('db:vehicleDeleteBlockReason', id),
  customerDeleteBlockReason: (id) => ipcRenderer.invoke('db:customerDeleteBlockReason', id),
  employeeDeleteBlockReason: (id) => ipcRenderer.invoke('db:employeeDeleteBlockReason', id),
  accountDeleteBlockReason: (id) => ipcRenderer.invoke('db:accountDeleteBlockReason', id),

  getDbInfo: () => ipcRenderer.invoke('db:getDbInfo'),
  vacuum: () => ipcRenderer.invoke('db:vacuum'),
  backupNow: () => ipcRenderer.invoke('db:backupNow'),
  openDbFolder: () => ipcRenderer.invoke('db:openDbFolder'),
  openBackupsFolder: () => ipcRenderer.invoke('db:openBackupsFolder'),
});
