const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('parcelDesktop', {
  request: (path, options) => ipcRenderer.invoke('parcel:request', path, options),
  settings: () => ipcRenderer.invoke('parcel:settings'),
  saveSettings: value => ipcRenderer.invoke('parcel:save-settings', value),
  sync: () => ipcRenderer.invoke('parcel:sync'),
  backup: () => ipcRenderer.invoke('parcel:backup'),
  restore: () => ipcRenderer.invoke('parcel:restore')
});
