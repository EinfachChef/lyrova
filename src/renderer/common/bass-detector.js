// Turns an FFT spectrum into a bass level between 0 and 1.
// It adapts to loud and quiet music: the level says "how much stronger than usual is the bass
// right now", not "how loud is it". Silence gives exactly 0, so nothing pulses without music.
// Works in the browser and in Node (tests).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Lyrova = root.Lyrova || {}).BassDetector = factory().BassDetector;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOW_HZ = 35;
  const HIGH_HZ = 150;
  const SILENCE_RMS = 0.0025;

  class BassDetector {
    constructor() {
      this.avg = 0;      // slow running average of the bass energy
      this.peak = 0;     // recent peak above the average (decays slowly)
      this.level = 0;
    }

    /**
     * @param {Float32Array} freqDb  AnalyserNode.getFloatFrequencyData output (dB)
     * @param {number} binHz         width of one bin in Hz (sampleRate / fftSize)
     * @param {number} rms           overall loudness 0…1 (time domain)
     */
    process(freqDb, binHz, rms) {
      if (rms < SILENCE_RMS) {
        this.level *= 0.8;
        if (this.level < 0.01) this.level = 0;
        return this.level;
      }
      const from = Math.max(1, Math.floor(LOW_HZ / binHz));
      const to = Math.max(from, Math.ceil(HIGH_HZ / binHz));
      let sum = 0;
      for (let i = from; i <= to && i < freqDb.length; i++) {
        const db = Number.isFinite(freqDb[i]) ? freqDb[i] : -140;
        sum += Math.pow(10, db / 20);
      }
      const energy = sum / (to - from + 1);

      this.avg = this.avg === 0 ? energy : this.avg * 0.985 + energy * 0.015;
      const above = energy - this.avg;
      this.peak = Math.max(this.peak * 0.995, above, this.avg * 0.6);
      const raw = this.peak > 0 ? Math.max(0, above) / this.peak : 0;

      // fast attack, slower release
      this.level = raw > this.level ? this.level + (raw - this.level) * 0.7 : this.level + (raw - this.level) * 0.18;
      return Math.max(0, Math.min(1, this.level));
    }
  }

  return { BassDetector };
});
