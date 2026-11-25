// Watches for fullscreen games/videos (or maximized windows hiding the desktop) and battery power.
// Events: 'covered' (Set of display ids hidden by a fullscreen window), 'battery' (true/false)

const EventEmitter = require('events');
const { screen } = require('electron');
const log = require('./logger');

const INTERVAL_MS = 1500;
const TOLERANCE = 2;

/** Does the window rectangle cover the display area completely? */
function covers(r, area) {
  return r.left <= area.x + TOLERANCE && r.top <= area.y + TOLERANCE &&
    r.right >= area.x + area.width - TOLERANCE && r.bottom >= area.y + area.height - TOLERANCE;
}

class PerformanceMonitor extends EventEmitter {
  constructor({ ownHandles }) {
    super();
    this.ownHandles = ownHandles;
    this.covered = new Set();
    this.battery = false;
    this.timer = null;
    this.warned = false;
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.check(), INTERVAL_MS);
    this.check();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  check() {
    const win32 = require('./win32');
    let covered = new Set();
    try {
      const fg = win32.foregroundWindow();
      if (fg && !this.ownHandles().has(fg.hwnd)) {
        for (const d of screen.getAllDisplays()) {
          // fullscreen games/videos and maximized windows: either way the wallpaper is invisible
          if (covers(fg.rect, screen.dipToScreenRect(null, d.workArea))) covered.add(d.id);
        }
      }
      const battery = win32.onBattery();
      if (battery !== this.battery) {
        this.battery = battery;
        this.emit('battery', battery);
      }
    } catch (err) {
      if (!this.warned) log.warn('Performance check failed:', err.message);
      this.warned = true;
      covered = new Set();
    }
    const same = covered.size === this.covered.size && [...covered].every((id) => this.covered.has(id));
    if (!same) {
      this.covered = covered;
      this.emit('covered', covered);
    }
  }
}

module.exports = { PerformanceMonitor, covers };
