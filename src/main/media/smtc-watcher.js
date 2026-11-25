// Starts smtc.ps1 in the built-in Windows PowerShell and turns its JSON lines into events.
// The script is passed via -EncodedCommand, so the PowerShell execution policy does not matter
// and no system setting is changed.
//
// Events: 'ready', 'state' (song info), 'unavailable' (SMTC could not be started at all)

const EventEmitter = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../logger');

const RESTART_DELAYS = [2000, 5000, 15000, 30000];

class SmtcWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = true;
    this.failures = 0;
    this.lastState = { active: false };
    this.coverDir = path.join(os.tmpdir(), 'lyrova-covers');
  }

  start() {
    this.stopped = false;
    this.spawn();
  }

  spawn() {
    // read from disk (works inside the packaged app.asar too)
    const body = fs.readFileSync(path.join(__dirname, 'smtc.ps1'), 'utf8');
    const script = `$ParentPid = ${process.pid}\n$CoverDir = '${this.coverDir.replace(/'/g, "''")}'\n${body}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

    const proc = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
    this.proc = proc;
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => log.warn('[SMTC]', d.trim().slice(0, 300)));
    proc.on('error', (err) => log.error('Could not start PowerShell:', err.message));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopped) return;
      if (code === 2) {
        // SMTC itself is missing (very old Windows) – don't hammer it
        this.emit('unavailable');
        return;
      }
      const delay = RESTART_DELAYS[Math.min(this.failures++, RESTART_DELAYS.length - 1)];
      log.warn(`Song detection exited (code ${code}), restarting in ${delay / 1000}s`);
      setTimeout(() => !this.stopped && this.spawn(), delay);
    });
  }

  handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'ready') {
      this.failures = 0;
      log.info('Song detection ready');
      this.emit('ready');
    } else if (msg.type === 'error') {
      log.warn('Song detection:', msg.message);
    } else if (msg.type === 'state') {
      const state = msg.active ? {
        active: true,
        title: msg.title || '',
        artist: msg.artist || '',
        album: msg.album || '',
        status: msg.status,
        positionMs: msg.positionMs || 0,
        durationMs: msg.durationMs || 0,
        app: msg.app || '',
        cover: msg.cover || '',
        sampledAt: msg.sampledAt || Date.now(),
      } : { active: false };
      const prev = this.lastState;
      this.lastState = state;
      if (state.active && (!prev.active || prev.title !== state.title || prev.artist !== state.artist)) {
        log.info(`Now playing: "${state.title}" – ${state.artist} [${state.app}]`);
      }
      this.emit('state', state);
    }
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      try { this.proc.kill(); } catch { /* already gone */ }
      this.proc = null;
    }
  }
}

module.exports = { SmtcWatcher };
