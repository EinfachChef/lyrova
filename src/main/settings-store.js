// Loads and saves settings.json in the app's data folder. Emits 'change' with the full
// settings object whenever something actually changes.

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { DEFAULTS, sanitize } = require('../shared/settings-schema');

class SettingsStore extends EventEmitter {
  constructor(file, log) {
    super();
    this.file = file;
    this.log = log;
    this.values = { ...DEFAULTS, screens: {} };
    try {
      Object.assign(this.values, sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))));
    } catch {
      /* first start or unreadable file → defaults */
    }
  }

  get() {
    return { ...this.values, screens: { ...this.values.screens } };
  }

  /** Applies only valid values. Returns true if anything changed. */
  set(patch) {
    const clean = sanitize(patch);
    const changed = Object.keys(clean).filter((k) => JSON.stringify(clean[k]) !== JSON.stringify(this.values[k]));
    if (!changed.length) return false;
    for (const k of changed) this.values[k] = clean[k];
    this.save();
    this.emit('change', this.get(), changed);
    return true;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // write to a temp file first, then rename: the file is never half-written
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.values, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (err) {
      this.log.warn('Could not save settings:', err.message);
    }
  }
}

module.exports = { SettingsStore };
