// Bridge for the settings window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyrovaSettings', {
  load: () => ipcRenderer.invoke('settings:load'),             // { settings, dict, info, displays }
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFile: (kind, target) => ipcRenderer.invoke('settings:pickFile', kind, target), // 'image'|'video', 'lyrics'|'clock'
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openLog: () => ipcRenderer.invoke('log:open'),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, v) => cb(v)),
  onI18n: (cb) => ipcRenderer.on('i18n', (_e, d) => cb(d)),
  onBass: (cb) => ipcRenderer.on('bass', (_e, v) => cb(v)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, v) => cb(v)),  // { audio, mode, displays }
});
