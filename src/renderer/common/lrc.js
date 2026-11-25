// Parser for the LRC lyrics format:  "[01:23.45] Some line"
// Supports several time tags per line ("[00:10.00][01:20.00] Chorus"), an [offset:±ms] tag,
// and ignores metadata tags like [ar:Artist]. Works in the browser and in Node (tests).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Lyrova = root.Lyrova || {}).parseLRC = factory().parseLRC;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  /** @returns {{time:number, text:string}[]} sorted by time (ms) */
  function parseLRC(source) {
    const lines = [];
    let offset = 0;
    for (const raw of String(source || '').split(/\r?\n/)) {
      const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) { offset = Number(off[1]); continue; }
      const times = [];
      let m;
      TIME.lastIndex = 0;
      let lastEnd = 0;
      while ((m = TIME.exec(raw)) && m.index === lastEnd) {
        const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
        times.push(Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac);
        lastEnd = TIME.lastIndex;
      }
      if (!times.length) continue;
      // strip word-level tags like <00:12.34> that some files contain
      const text = raw.slice(lastEnd).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      for (const t of times) lines.push({ time: t, text });
    }
    // a positive offset means the lyrics should appear earlier
    for (const l of lines) l.time = Math.max(0, l.time - offset);
    lines.sort((a, b) => a.time - b.time);
    return lines;
  }

  return { parseLRC };
});
