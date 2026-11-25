// Automatic updates from GitHub Releases (electron-updater). Only in the installed app and only
// when enabled in the settings. Downloads in the background and installs on the next quit.
// Without a configured GitHub repository the check simply fails quietly (logged).

const { app } = require('electron');
const log = require('./logger');

const CHECK_EVERY_MS = 6 * 3600 * 1000;
let timer = null;
let started = false;

function startUpdater({ enabled, onReady }) {
  if (!app.isPackaged) return;
  if (!enabled) { stopUpdater(); return; }
  if (started) return;
  started = true;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log.warn('Updater not available:', err.message);
    return;
  }
  autoUpdater.logger = { info: (m) => log.info('[Update]', m), warn: (m) => log.warn('[Update]', m), error: (m) => log.warn('[Update]', m), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => onReady && onReady(info.version));
  autoUpdater.on('error', (err) => log.warn('[Update] check failed:', err && err.message));
  const check = () => autoUpdater.checkForUpdates().catch((err) => log.warn('[Update] check failed:', err.message));
  setTimeout(check, 30 * 1000); // not right at startup – let the wallpaper come up first
  timer = setInterval(check, CHECK_EVERY_MS);
}

function stopUpdater() {
  clearInterval(timer);
  timer = null;
  started = false;
}

module.exports = { startUpdater, stopUpdater };
