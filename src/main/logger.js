// Minimal file logger: %APPDATA%\Lyrova\logs\lyrova.log (rotated at 1 MB, one old copy kept).

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
let file = null;

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'lyrova.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(dir, 'lyrova.old.log'));
    }
  } catch (err) {
    console.error('Logging disabled:', err);
    file = null;
  }
}

function stringify(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function write(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(stringify).join(' ')}`;
  (level === 'ERROR' ? console.error : console.log)(line);
  if (!file) return;
  try { fs.appendFileSync(file, line + '\n'); } catch { /* never crash because of logging */ }
}

module.exports = {
  init,
  file: () => file,
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};
