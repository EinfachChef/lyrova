// Shows the lyrics in one of seven styles.
//
// Column styles (one scrolling column, active line big and glowing):
//   column      – Apple-Music-like column, neighbours smaller, dimmer and blurred
//   karaoke     – like column, the active line fills up with light while it is sung
//   typewriter  – left-aligned terminal look, the active line is typed letter by letter
//   neon        – only the active line, as a thin glowing neon tube
// Floating styles (free positions on the screen):
//   spread      – each line appears somewhere else, the previous ones fade upwards
//   pixel       – single words in a pixel font, scattered, with little pixel sparkles
//   word        – only the word being sung, huge in the middle
// Unsynced lyrics and messages ("searching …") always use the column.

(function () {
  'use strict';

  const L = (window.Lyrova = window.Lyrova || {});
  const ANCHOR = { center: 0.5, left: 0.5, top: 0.32, bottom: 0.68 };
  const FLOAT_STYLES = ['spread', 'pixel', 'word'];

  /** Binary search: last item whose time has come. */
  function indexAt(items, t) {
    let lo = 0;
    let hi = items.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].time <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  // ═══ Column ═══════════════════════════════════════════════════════════════
  class ColumnView {
    constructor({ stage, column, message }) {
      this.stage = stage;
      this.column = column;
      this.message = message;
      this.mode = 'message';
      this.style = 'column';
      this.position = 'center';
      this.lines = [];
      this.els = [];
      this.index = -2;
      this.styled = [];
      this.plainShift = null;
      this.typed = -1;
    }

    setStyle(style) {
      this.style = style;
      this.column.dataset.style = style;
      this.applyPosition();
    }

    setPosition(position) {
      this.position = ANCHOR[position] !== undefined ? position : 'center';
      this.applyPosition();
    }

    /** Typewriter is always left-aligned and sits a bit lower; neon is always centered. */
    effectivePosition() {
      if (this.style === 'typewriter') return 'left';
      if (this.style === 'neon' && this.position === 'left') return 'center';
      return this.position;
    }

    applyPosition() {
      this.stage.dataset.position = this.effectivePosition();
      this.relayout();
    }

    anchor() {
      if (this.style === 'typewriter') return 0.62;
      return ANCHOR[this.effectivePosition()];
    }

    showSynced(lines) {
      this.mode = 'synced';
      this.lines = lines;
      this.build(lines.map((l) => l.text));
      this.column.classList.remove('plain');
      this.index = -2;
    }

    showPlain(text) {
      this.mode = 'plain';
      this.lines = [];
      this.build(String(text).split(/\r?\n/));
      this.column.classList.add('plain');
      this.plainShift = null;
    }

    showMessage(title, hint) {
      this.mode = 'message';
      this.clear();
      this.message.hidden = false;
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = title || '';
      this.message.querySelector('.msg-title').replaceChildren(t);
      this.message.querySelector('.msg-hint').textContent = hint || '';
    }

    /** Empty column (a floating style is showing the lyrics). */
    clear() {
      this.column.replaceChildren();
      this.els = [];
      this.styled = [];
      this.message.hidden = true;
    }

    build(texts) {
      this.message.hidden = true;
      const frag = document.createDocumentFragment();
      this.els = texts.map((text) => {
        const line = document.createElement('div');
        line.className = text.trim() ? 'line' : 'line blank';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = text;
        line.appendChild(t);
        line._text = text;
        frag.appendChild(line);
        return line;
      });
      this.column.replaceChildren(frag);
      this.styled = [];
      this.typed = -1;
    }

    update(timeMs, durationMs) {
      if (this.mode === 'synced') {
        const idx = indexAt(this.lines, timeMs);
        if (idx !== this.index) {
          this.index = idx;
          this.applyClasses();
          this.relayout();
        }
        if (this.index >= 0) {
          const line = this.lines[this.index];
          const next = this.index + 1 < this.lines.length ? this.lines[this.index + 1].time : line.time + 5000;
          if (this.style === 'karaoke') {
            const p = Math.min(1, Math.max(0, (timeMs - line.time) / Math.max(400, (next - line.time) * 0.9)));
            this.els[this.index].style.setProperty('--p', p.toFixed(3));
          } else if (this.style === 'typewriter') {
            this.type(timeMs, line, next);
          }
        }
      } else if (this.mode === 'plain' && durationMs > 0) {
        const shift = Math.round(Math.min(1, Math.max(0, timeMs / durationMs)) * 200) / 200;
        if (shift !== this.plainShift) {
          this.plainShift = shift;
          this.relayout();
        }
      }
    }

    /** Typewriter: reveal the active line letter by letter (~55 ms each, max 80 % of its time). */
    type(timeMs, line, next) {
      const el = this.els[this.index];
      const full = el._text;
      const duration = Math.min(full.length * 55 + 150, Math.max(300, (next - line.time) * 0.8));
      const n = Math.round(Math.min(1, Math.max(0, (timeMs - line.time) / duration)) * full.length);
      if (n === this.typed) return;
      this.typed = n;
      const t = el.querySelector('.t');
      t.textContent = full.slice(0, n);
      const caret = document.createElement('i');
      caret.className = 'caret';
      t.appendChild(caret);
    }

    applyClasses() {
      for (const el of this.styled) {
        el.classList.remove('active', 'd1', 'd2', 'past');
        el.style.removeProperty('--p');
        if (this.style === 'typewriter') el.querySelector('.t').textContent = el._text;
      }
      this.styled = [];
      this.typed = -1;
      const center = this.index < 0 ? 0 : this.index;
      for (let i = center - 3; i <= center + 2; i++) {
        const el = this.els[i];
        if (!el) continue;
        const d = Math.abs(i - this.index);
        el.classList.add(d === 0 ? 'active' : d === 1 ? 'd1' : 'd2');
        if (i < this.index) el.classList.add('past');
        this.styled.push(el);
      }
    }

    relayout() {
      if (!this.els.length) return;
      const anchorY = this.stage.clientHeight * this.anchor();
      let y;
      if (this.mode === 'plain') {
        const total = this.column.scrollHeight;
        y = anchorY - this.els[0].offsetHeight / 2 - (this.plainShift || 0) * Math.max(0, total - this.els[0].offsetHeight);
      } else {
        const el = this.els[Math.max(0, this.index)];
        y = anchorY - (el.offsetTop + el.offsetHeight / 2);
      }
      const x = this.effectivePosition() === 'left' ? '0' : '-50%';
      this.column.style.transform = `translate(${x}, ${Math.round(y)}px)`;
    }

    activeRect() {
      if (this.mode === 'synced' && this.index >= 0 && this.els[this.index]) {
        return this.els[this.index].querySelector('.t').getBoundingClientRect();
      }
      if (this.mode === 'message') return this.message.querySelector('.msg-title .t')?.getBoundingClientRect() || null;
      return null;
    }
  }

  // ═══ Floating ═════════════════════════════════════════════════════════════
  const KEEP = { spread: 3, pixel: 4, word: 1 };           // how many units stay visible
  const AGE_OPACITY = { spread: [1, 0.32, 0.12], pixel: [1, 0.8, 0.55, 0.3], word: [1] };

  class FloatView {
    constructor(layer) {
      this.layer = layer;
      this.style = 'spread';
      this.units = [];
      this.index = -2;
      this.visible = []; // newest first
    }

    show(lines, style) {
      this.style = style;
      this.layer.dataset.style = style;
      this.units = style === 'spread' ? lines : L.splitWords(lines);
      this.index = -2;
      this.clear();
    }

    clear() {
      this.visible = [];
      this.layer.replaceChildren();
    }

    update(timeMs) {
      const idx = indexAt(this.units, timeMs);
      if (idx === this.index) return;
      // big jump (seeking): start fresh instead of replaying every unit
      if (Math.abs(idx - this.index) > 3) this.clear();
      this.index = idx;
      const unit = this.units[idx];
      if (!unit || !unit.text) {
        // pause: let everything fade away (word/pixel) or keep the last line dimmed (spread)
        if (this.style !== 'spread') this.retireAll();
        return;
      }
      this.add(unit.text);
    }

    add(text) {
      const el = document.createElement('div');
      el.className = 'unit';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = text;
      el.appendChild(t);
      if (this.style === 'pixel') this.sparkle(el, text);
      this.layer.appendChild(el);
      this.place(el);
      this.visible.unshift(el);
      // next frame: fade in (and age the others)
      requestAnimationFrame(() => {
        el.classList.add('in');
        this.age();
      });
    }

    /** Two little pixel crosses at fixed-but-random spots next to the word. */
    sparkle(el, text) {
      let h = 0;
      for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const spots = [[-0.3, -0.15], [1.05, -0.2], [-0.25, 0.75], [1.02, 0.8], [0.45, -0.45]];
      for (let k = 0; k < 2; k++) {
        const [x, y] = spots[(h + k * 2) % spots.length];
        const s = document.createElement('i');
        s.className = 'spark';
        s.style.left = `${x * 100}%`;
        s.style.top = `${y * 100}%`;
        s.style.animationDelay = `${-((h >> (k * 4)) % 15) / 10}s`;
        el.appendChild(s);
      }
    }

    /** Finds a free spot: the screen is a grid of zones, the least crowded zone wins. */
    place(el) {
      const W = this.layer.clientWidth;
      const H = this.layer.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (this.style === 'word') {
        el.style.left = `${Math.round((W - w) / 2)}px`;
        el.style.top = `${Math.round((H - h) / 2)}px`;
        return;
      }
      const cols = this.style === 'pixel' ? 4 : 3;
      const rows = this.style === 'pixel' ? 4 : 5;
      const taken = this.visible.slice(0, KEEP[this.style]).map((v) => ({
        x: v.offsetLeft, y: v.offsetTop, w: v.offsetWidth, h: v.offsetHeight,
      }));
      let best = null;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = Math.min(Math.max(W * 0.06, (W * (c + 0.15)) / cols + (Math.random() - 0.5) * W * 0.05), W - w - W * 0.04);
          const y = Math.min(Math.max(H * 0.08, (H * (r + 0.2)) / rows), H - h - H * 0.08);
          let overlap = 0;
          for (const o of taken) {
            const ox = Math.max(0, Math.min(x + w, o.x + o.w) - Math.max(x, o.x));
            const oy = Math.max(0, Math.min(y + h, o.y + o.h) - Math.max(y, o.y));
            overlap += ox * oy;
          }
          const score = overlap + Math.random() * w * h * 0.15;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      el.style.left = `${Math.round(best.x)}px`;
      el.style.top = `${Math.round(best.y)}px`;
    }

    age() {
      const keep = KEEP[this.style];
      const ops = AGE_OPACITY[this.style];
      this.visible.forEach((el, i) => {
        el.classList.toggle('active', i === 0);
        if (i < keep) {
          el.style.opacity = String(ops[i] ?? 0);
          el.classList.toggle('old', i > 0);
        } else {
          this.retire(el);
        }
      });
      this.visible = this.visible.slice(0, keep);
    }

    retire(el) {
      el.classList.add('out');
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 900);
    }

    retireAll() {
      this.visible.forEach((el) => this.retire(el));
      this.visible = [];
    }

    activeRect() {
      const el = this.visible[0];
      return el ? el.querySelector('.t').getBoundingClientRect() : null;
    }
  }

  // ═══ Facade used by app.js ════════════════════════════════════════════════
  class LyricsView {
    constructor({ stage, column, message, floatLayer }) {
      this.column = new ColumnView({ stage, column, message });
      this.float = new FloatView(floatLayer);
      this.style = 'column';
      this.lines = null;
      this.usingFloat = false;
    }

    setStyle(style) {
      if (style === this.style) return;
      this.style = style;
      this.column.setStyle(FLOAT_STYLES.includes(style) ? 'column' : style);
      if (this.lines) this.showSynced(this.lines); // rebuild in the new style
    }

    setPosition(position) {
      this.column.setPosition(position);
    }

    showSynced(lines) {
      this.lines = lines;
      if (FLOAT_STYLES.includes(this.style)) {
        this.usingFloat = true;
        this.column.clear();
        this.column.mode = 'float';
        this.float.show(lines, this.style);
      } else {
        this.usingFloat = false;
        this.float.clear();
        this.column.showSynced(lines);
      }
    }

    showPlain(text) {
      this.lines = null;
      this.usingFloat = false;
      this.float.clear();
      this.column.showPlain(text);
    }

    showMessage(title, hint) {
      this.lines = null;
      this.usingFloat = false;
      this.float.clear();
      this.column.showMessage(title, hint);
    }

    update(timeMs, durationMs) {
      if (this.usingFloat) this.float.update(timeMs);
      else this.column.update(timeMs, durationMs);
    }

    relayout() {
      this.column.relayout();
    }

    activeRect() {
      return this.usingFloat ? this.float.activeRect() : this.column.activeRect();
    }
  }

  L.LyricsView = LyricsView;
})();
