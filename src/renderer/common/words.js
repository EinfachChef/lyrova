// Splits synced lines into single words with their own times (for the word-based styles).
// LRCLIB only has line times, so each line's time is shared out among its words by length.
// In long pauses an empty "word" is inserted so the screen clears instead of freezing.
// Works in the browser and in Node (tests).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Lyrova = root.Lyrova || {}).splitWords = factory().splitWords;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_PER_WORD = 620;   // natural singing pace, caps how long a line's words take
  const TAIL_MS = 900;       // how long the last word stays before a pause clears the screen

  function splitWords(lines) {
    const out = [];
    lines.forEach((line, i) => {
      const words = line.text.split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push({ time: line.time, text: '' });
        return;
      }
      const next = i + 1 < lines.length ? lines[i + 1].time : line.time + words.length * MS_PER_WORD + TAIL_MS;
      const span = Math.max(200, Math.min(next - line.time, words.length * MS_PER_WORD + 400));
      const weights = words.map((w) => w.length + 2);
      const total = weights.reduce((a, b) => a + b, 0);
      let t = line.time;
      words.forEach((w, k) => {
        out.push({ time: Math.round(t), text: w });
        t += (span * weights[k]) / total;
      });
      if (line.time + span + TAIL_MS < next) out.push({ time: Math.round(line.time + span + TAIL_MS), text: '' });
    });
    return out;
  }

  return { splitWords };
});
