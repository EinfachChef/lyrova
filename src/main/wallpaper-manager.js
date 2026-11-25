// Creates one wallpaper window per selected display and keeps it attached behind the icons.
// If the WorkerW trick fails, it falls back to a borderless fullscreen window kept at the bottom.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const EventEmitter = require('events');
const log = require('./logger');

const WATCH_MS = 3000;
const ATTACH_RETRIES = 3;

class WallpaperWindow {
  constructor(display, role, opts) {
    this.display = display;
    this.role = role;            // 'lyrics' | 'clock' | 'background'
    this.opts = opts;            // { preload, page, forceWindowMode }
    this.win = null;
    this.target = null;
    this.mode = 'pending';       // 'wallpaper' | 'fallback'
    this.attempts = 0;
    this.closed = false;
    this.create();
  }

  create() {
    const { x, y, width, height } = this.display.bounds;
    this.win = new BrowserWindow({
      x, y, width, height,
      show: false,
      frame: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#07060a',
      title: 'Lyrova',
      icon: this.opts.icon,
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const wa = this.display.workArea;
    const b = this.display.bounds;
    this.win.loadFile(this.opts.page, {
      query: {
        display: String(this.display.id),
        role: this.role,
        // space taken by the taskbar, so the song info is never hidden behind it
        insetBottom: String(b.y + b.height - (wa.y + wa.height)),
        insetLeft: String(wa.x - b.x),
      },
    });
    this.win.once('ready-to-show', () => this.attach());
    this.win.webContents.on('render-process-gone', (_e, d) => {
      log.error('Wallpaper renderer crashed:', d);
      this.recreate();
    });
  }

  attach() {
    if (!this.win || this.win.isDestroyed()) return;
    const win32 = require('./win32');
    const hwnd = win32.hwndOf(this.win);
    if (!this.opts.forceWindowMode) {
      try {
        const phys = screen.dipToScreenRect(null, this.display.bounds);
        this.target = win32.attachToDesktop(hwnd, phys);
      } catch (err) {
        log.error('Attaching to the desktop failed:', err);
        this.target = null;
      }
    }
    if (this.target) {
      this.mode = 'wallpaper';
      this.win.showInactive();
      log.info(`Wallpaper attached (${this.target.mode}) on display ${this.display.id}`);
      return;
    }
    // Fallback: plain borderless window covering the display, pushed to the bottom
    this.mode = 'fallback';
    this.win.setBounds(this.display.bounds);
    this.win.showInactive();
    win32.sendToBottom(hwnd);
    log.warn(`Fallback window mode on display ${this.display.id}`);
  }

  /** Called regularly: re-attach after an Explorer restart, keep the fallback window at the bottom. */
  watch() {
    if (this.closed || !this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    const win32 = require('./win32');
    const hwnd = win32.hwndOf(this.win);
    if (this.mode === 'fallback') {
      win32.sendToBottom(hwnd);
      // try the real wallpaper mode again now and then (Explorer may have been busy at startup)
      if (!this.opts.forceWindowMode && this.attempts++ < ATTACH_RETRIES) this.recreate();
      return;
    }
    if (this.mode === 'wallpaper' && !win32.isAttached(hwnd, this.target)) {
      log.warn('Wallpaper got detached (Explorer restart?) – recreating');
      this.recreate();
    }
    else if (this.mode === 'wallpaper') win32.keepWorkerWBelow(this.target);
  }

  recreate() {
    if (this.closed) return;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.target = null;
    this.mode = 'pending';
    this.create();
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, data);
  }

  setVisible(visible) {
    if (!this.win || this.win.isDestroyed()) return;
    if (visible) this.win.showInactive(); else this.win.hide();
  }

  destroy() {
    this.closed = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

/**
 * Keeps the set of wallpaper windows in line with the settings and the connected displays.
 * Events: none needed outside; use send()/broadcast for data.
 */
class WallpaperManager extends EventEmitter {
  constructor({ getSettings, icon, forceWindowMode = false }) {
    super();
    this.getSettings = getSettings;
    this.windows = new Map(); // key → WallpaperWindow
    this.visible = true;
    this.opts = {
      preload: path.join(__dirname, '..', 'preload', 'wallpaper.js'),
      page: path.join(__dirname, '..', 'renderer', 'wallpaper', 'index.html'),
      icon,
      forceWindowMode,
    };
    this.timer = setInterval(() => this.windows.forEach((w) => w.watch()), WATCH_MS);
    let debounce = null;
    const onDisplays = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this.sync(), 800);
    };
    screen.on('display-added', onDisplays);
    screen.on('display-removed', onDisplays);
    screen.on('display-metrics-changed', onDisplays);
  }

  /** Every display with the role chosen in the settings (displays set to 'off' are left out). */
  displaysWithRoles() {
    const { roleOf } = require('../shared/settings-schema');
    const screens = this.getSettings().screens;
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays()
      .map((d) => ({ display: d, role: roleOf(screens, d.id, d.id === primary) }))
      .filter((x) => x.role !== 'off');
  }

  sync() {
    const wanted = new Map();
    for (const { display: d, role } of this.displaysWithRoles()) {
      wanted.set(`${d.id}|${role}|${JSON.stringify(d.bounds)}|${JSON.stringify(d.workArea)}|${d.scaleFactor}`, { d, role });
    }
    let removed = false;
    for (const [key, w] of this.windows) {
      if (!wanted.has(key)) {
        w.destroy();
        this.windows.delete(key);
        removed = true;
      }
    }
    for (const [key, { d, role }] of wanted) {
      if (!this.windows.has(key)) {
        const w = new WallpaperWindow(d, role, this.opts);
        log.info(`Display ${d.id} (${d.bounds.width}×${d.bounds.height}): ${role}`);
        if (!this.visible) w.win.once('show', () => w.setVisible(false));
        this.windows.set(key, w);
      }
    }
    if (removed) this.redrawDesktop();
  }

  broadcast(channel, data) {
    this.windows.forEach((w) => w.send(channel, data));
  }

  /** Send to the window of one display only (for pausing a single covered screen). */
  sendToDisplay(displayId, channel, data) {
    this.windows.forEach((w) => { if (w.display.id === displayId) w.send(channel, data); });
  }

  list() {
    return [...this.windows.values()];
  }

  /** Mode of the first window ('wallpaper' / 'fallback'), for the settings window. */
  mode() {
    const first = this.list()[0];
    return first ? first.mode : 'pending';
  }

  handles() {
    const win32 = require('./win32');
    return new Set(this.list().filter((w) => w.win && !w.win.isDestroyed()).map((w) => win32.hwndOf(w.win)));
  }

  setVisible(visible) {
    this.visible = visible;
    this.windows.forEach((w) => w.setVisible(visible));
    if (!visible) this.redrawDesktop();
  }

  redrawDesktop() {
    try { require('./win32').redrawWindowsWallpaper(); } catch (err) { log.warn('Desktop redraw failed:', err.message); }
  }

  destroy() {
    clearInterval(this.timer);
    this.windows.forEach((w) => w.destroy());
    this.windows.clear();
    this.redrawDesktop();
  }
}

module.exports = { WallpaperManager };
