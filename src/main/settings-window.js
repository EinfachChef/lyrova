// The settings window – only one at a time; opening it again brings it to the front.

const { BrowserWindow } = require('electron');
const path = require('path');
const log = require('./logger');

let win = null;

function openSettings({ icon, title }) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title,
    icon,
    show: false,
    backgroundColor: '#0b0a0f',
    autoHideMenuBar: true,
    // no grey title bar: Windows only draws the three caption buttons on top (rounded corners stay)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f5f5f7', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_e, d) => log.error('Settings window crashed:', d));
  win.on('closed', () => { win = null; });
  return win;
}

function settingsWindow() {
  return win && !win.isDestroyed() ? win : null;
}

module.exports = { openSettings, settingsWindow };
