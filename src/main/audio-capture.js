// Runs the hidden audio window and answers its getDisplayMedia request with
// "primary screen + system audio (loopback)". The screen part is discarded by the page.

const { BrowserWindow, desktopCapturer, session } = require('electron');
const path = require('path');
const EventEmitter = require('events');
const log = require('./logger');

const MAX_RESTARTS = 3;

class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.win = null;
    this.restarts = 0;
    this.stopped = true;
    this.paused = false;
    this.available = null; // true / false once known
  }

  start() {
    this.stopped = false;
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      // only our own audio window gets anything
      const own = this.win && !this.win.isDestroyed() && request.frame === this.win.webContents.mainFrame;
      if (!own) return callback({});
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        callback({ video: sources[0], audio: 'loopback' });
      } catch (err) {
        log.warn('Audio capture refused:', err.message);
        callback({});
      }
    });
    this.create();
  }

  create() {
    this.win = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'audio.js'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'audio', 'index.html'));
    this.win.webContents.on('render-process-gone', (_e, d) => {
      log.error('Audio window crashed:', d);
      this.restart();
    });
  }

  restart() {
    if (this.stopped) return;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    if (this.restarts++ >= MAX_RESTARTS) {
      log.warn('Bass analysis disabled after repeated failures');
      this.setAvailable(false);
      return;
    }
    setTimeout(() => !this.stopped && this.create(), 4000);
  }

  setAvailable(ok) {
    this.available = ok;
    this.emit('status', ok);
  }

  /** Pause the analysis while nobody needs it (all wallpapers paused). */
  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('paused', paused);
  }

  ownsSender(sender) {
    return this.win && !this.win.isDestroyed() && sender === this.win.webContents;
  }

  stop() {
    this.stopped = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { AudioCapture };
