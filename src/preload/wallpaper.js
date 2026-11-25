// Bridge for the wallpaper window. Only these functions are visible to the page.

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['settings', 'media', 'lyrics', 'bass', 'paused', 'i18n', 'throttle'];

contextBridge.exposeInMainWorld('lyrova', {
  /** Everything the page needs on start: settings, current song, lyrics, texts. */
  init: (displayId) => ipcRenderer.invoke('wallpaper:init', String(displayId)),
  on: (channel, callback) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => callback(data));
  },
  log: (level, message) => ipcRenderer.send('log', String(level), String(message)),
});
