// Bridge for the hidden audio window: it may only report the bass level, its status and log lines.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyrovaAudio', {
  level: (value) => ipcRenderer.send('audio:level', Number(value) || 0),
  status: (ok) => ipcRenderer.send('audio:status', !!ok),
  onPause: (callback) => ipcRenderer.on('paused', (_e, p) => callback(!!p)),
  log: (level, message) => ipcRenderer.send('log', String(level), String(message)),
});
