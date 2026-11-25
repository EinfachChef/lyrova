const test = require('node:test');
const assert = require('node:assert');
const { BassDetector } = require('../src/renderer/common/bass-detector');

const BIN_HZ = 48000 / 2048;
/** A spectrum with `bassDb` in the bass bins and quiet everything else. */
function spectrum(bassDb) {
  const f = new Float32Array(1024).fill(-100);
  for (let i = 1; i <= 7; i++) f[i] = bassDb;
  return f;
}

test('silence gives exactly 0', () => {
  const d = new BassDetector();
  for (let i = 0; i < 50; i++) assert.strictEqual(d.process(spectrum(-20), BIN_HZ, 0.0001), 0);
});

test('a constant hum settles low, kicks on top of it give clear peaks', () => {
  const d = new BassDetector();
  let level = 0;
  for (let i = 0; i < 400; i++) level = d.process(spectrum(-40), BIN_HZ, 0.05);
  assert.ok(level < 0.15, `hum too high: ${level}`);
  let max = 0;
  for (let beat = 0; beat < 8; beat++) {
    for (let i = 0; i < 3; i++) max = Math.max(max, d.process(spectrum(-18), BIN_HZ, 0.2));
    for (let i = 0; i < 25; i++) d.process(spectrum(-40), BIN_HZ, 0.05);
  }
  assert.ok(max > 0.6, `kick too weak: ${max}`);
});

test('level always stays within 0…1', () => {
  const d = new BassDetector();
  for (let i = 0; i < 300; i++) {
    const v = d.process(spectrum(-60 + Math.random() * 60), BIN_HZ, Math.random() * 0.3);
    assert.ok(v >= 0 && v <= 1);
  }
});
