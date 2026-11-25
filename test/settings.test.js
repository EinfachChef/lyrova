const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, sanitize } = require('../src/shared/settings-schema');
const { SettingsStore } = require('../src/main/settings-store');
const { translator, dictionary } = require('../src/shared/i18n');

const quiet = { info() {}, warn() {}, error() {} };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lyrova-set-')), 'settings.json');

test('invalid values are dropped, numbers clamped', () => {
  const clean = sanitize({ background: 'lava', fontSize: 9, textColor: 'red', screens: { abc: 'lyrics', 12: 'party', 34: 'clock' }, offsetMs: -99999, unknown: 1, fps: 45, shakeAmount: 7, lyricsStyle: 'disco' });
  assert.deepStrictEqual(clean, { fontSize: 1.8, screens: { 34: 'clock' }, offsetMs: -5000, shakeAmount: 2 });
});

test('settings survive a restart and broken files fall back to defaults', () => {
  const file = tmp();
  new SettingsStore(file, quiet).set({ background: 'stars', accentColor: '#FF0000', screens: { 123: 'off' }, lyricsStyle: 'pixel' });
  const again = new SettingsStore(file, quiet).get();
  assert.strictEqual(again.background, 'stars');
  assert.strictEqual(again.accentColor, '#ff0000');
  assert.deepStrictEqual(again.screens, { 123: 'off' });
  assert.strictEqual(again.lyricsStyle, 'pixel');
  fs.writeFileSync(file, '{ broken');
  assert.deepStrictEqual(new SettingsStore(file, quiet).get(), DEFAULTS);
});

test('change event only fires on real changes', () => {
  const s = new SettingsStore(tmp(), quiet);
  let n = 0;
  s.on('change', () => n++);
  s.set({ edgeAmount: 0 });
  s.set({ edgeAmount: 0 });
  s.set({ edgeAmount: 'nope' });
  s.set({ screens: {} });
  assert.strictEqual(n, 1);
});

test('i18n: every German key exists in English and placeholders are filled', () => {
  const de = dictionary('de');
  const en = require('../src/shared/i18n/en.json');
  for (const key of Object.keys(de)) assert.ok(key in en, `missing in en.json: ${key}`);
  assert.strictEqual(translator('de')('tray.nowPlaying', { title: 'X' }), 'Läuft: X');
  assert.strictEqual(translator('en')('screens.display', { n: 2 }), 'Display 2');
});

test('display roles: saved choice, otherwise primary = lyrics, others = clock', () => {
  const { roleOf } = require('../src/shared/settings-schema');
  assert.strictEqual(roleOf({}, 1, true), 'lyrics');
  assert.strictEqual(roleOf({}, 2, false), 'clock');
  assert.strictEqual(roleOf({ 2: 'off' }, 2, false), 'off');
});

test('clock text: max 4 lines, no control characters', () => {
  assert.deepStrictEqual(sanitize({ clockText: 'a\r\nb\u0007\n3\n4\n5' }), { clockText: 'a\nb\n3\n4' });
});
