// Clock screen (role "clock"): time in one of seven styles, date, greeting, your own text and
// a glass song card with progress and the current lyrics line.

(function () {
  'use strict';

  const L = (window.Lyrova = window.Lyrova || {});
  const pad = (n) => String(n).padStart(2, '0');
  const NS = 'http://www.w3.org/2000/svg';

  // Word clock phrases ("Es ist gleich halb zehn" / "It's just before half past nine")
  const WORDS = {
    de: {
      hours: ['zwölf', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf'],
      lead: { exact: 'Es ist', before: 'Es ist gleich', after: 'Es ist kurz nach' },
      phrase(m, h, next) {
        return {
          0: `<b>${h === 'eins' ? 'ein' : h}</b> Uhr`, 5: `fünf nach <b>${h}</b>`, 10: `zehn nach <b>${h}</b>`,
          15: `Viertel nach <b>${h}</b>`, 20: `zwanzig nach <b>${h}</b>`, 25: `fünf vor halb <b>${next}</b>`,
          30: `halb <b>${next}</b>`, 35: `fünf nach halb <b>${next}</b>`, 40: `zwanzig vor <b>${next}</b>`,
          45: `Viertel vor <b>${next}</b>`, 50: `zehn vor <b>${next}</b>`, 55: `fünf vor <b>${next}</b>`,
        }[m];
      },
    },
    en: {
      hours: ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'],
      lead: { exact: "It's", before: "It's almost", after: "It's just after" },
      phrase(m, h, next) {
        return {
          0: `<b>${h}</b> o'clock`, 5: `five past <b>${h}</b>`, 10: `ten past <b>${h}</b>`,
          15: `quarter past <b>${h}</b>`, 20: `twenty past <b>${h}</b>`, 25: `twenty-five past <b>${h}</b>`,
          30: `half past <b>${h}</b>`, 35: `twenty-five to <b>${next}</b>`, 40: `twenty to <b>${next}</b>`,
          45: `quarter to <b>${next}</b>`, 50: `ten to <b>${next}</b>`, 55: `five to <b>${next}</b>`,
        }[m];
      },
    },
  };

  class ClockFace {
    constructor(root, t) {
      this.root = root;
      this.widget = root.querySelector('#clock-widget');
      this.el = {
        greeting: root.querySelector('.c-greeting'),
        date: root.querySelector('.c-date'),
        time: root.querySelector('.c-time'),
        note: root.querySelector('.c-note'),
        song: root.querySelector('.c-song'),
        cover: root.querySelector('.cs-cover'),
        title: root.querySelector('.cs-title'),
        artist: root.querySelector('.cs-artist'),
        bar: root.querySelector('.cs-bar i'),
        line: root.querySelector('.cs-line'),
      };
      this.t = t;
      this.s = {};
      this.lang = 'de';
      this.timeKey = '';
      this.infoKey = '';
      this.analog = null;
      this.flip = [];
      this.song = null;
      this.lines = [];
      this.lineShown = null;
    }

    setTranslator(t, lang) {
      this.t = t;
      this.lang = lang === 'en' ? 'en' : 'de';
      this.infoKey = '';
      this.timeKey = '';
    }

    setSettings(s) {
      const restyle = s.clockStyle !== this.s.clockStyle || s.clockSeconds !== this.s.clockSeconds;
      this.s = s;
      this.widget.dataset.style = s.clockStyle;
      this.widget.dataset.pos = s.clockPosition;
      const c = L.hexToRgb(s.clockColor);
      this.root.style.setProperty('--clock-rgb', `${c.r} ${c.g} ${c.b}`);
      this.resize();
      if (restyle) {
        this.timeKey = '';
        this.analog = null;
        this.flip = [];
        this.el.time.replaceChildren();
      }
      this.infoKey = '';
      this.renderSongStatic();
    }

    resize() {
      const u = (Math.min(window.innerWidth, window.innerHeight) / 100) * (this.s.clockSize || 1);
      this.root.style.setProperty('--u', `${u.toFixed(2)}px`);
    }

    /** Current song + lyrics result (for the song card and its lyrics line). */
    setSong(song, lyrics) {
      this.song = song;
      this.lines = lyrics && lyrics.status === 'synced' ? L.parseLRC(lyrics.synced) : [];
      this.display = lyrics && song ? lyrics : null;
      this.lineShown = null;
      this.renderSongStatic();
    }

    renderSongStatic() {
      const show = !!(this.song && this.s.clockSongCard);
      this.el.song.hidden = !show;
      if (!show) return;
      this.el.title.textContent = (this.display && this.display.title) || this.song.title;
      this.el.artist.textContent = (this.display && this.display.artist) || this.song.artist || '';
      const cover = this.song.coverUrl || '';
      this.el.cover.hidden = !cover;
      if (cover && this.el.cover.getAttribute('src') !== cover) this.el.cover.src = cover;
    }

    /** Called every frame. songMs = current song position incl. offset. */
    frame(songMs) {
      const d = new Date();
      this.renderTime(d);
      this.renderInfo(d);
      if (this.song && this.s.clockSongCard) {
        const dur = this.song.durationMs || 0;
        this.el.bar.style.width = dur > 0 ? `${Math.min(100, (songMs / dur) * 100).toFixed(2)}%` : '0%';
        let text = '';
        if (this.s.clockLyricLine && this.lines.length) {
          for (let i = this.lines.length - 1; i >= 0; i--) if (this.lines[i].time <= songMs) { text = this.lines[i].text; break; }
        }
        if (text !== this.lineShown) {
          this.lineShown = text;
          this.el.line.textContent = text;
          this.el.line.classList.remove('swap');
          void this.el.line.offsetWidth;
          if (text) this.el.line.classList.add('swap');
        }
      }
    }

    renderInfo(d) {
      const key = `${d.toDateString()}|${d.getHours()}|${this.s.clockDate}|${this.s.clockGreeting}|${this.s.clockText}|${this.lang}`;
      if (key === this.infoKey) return;
      this.infoKey = key;
      const h = d.getHours();
      const greet = h < 5 ? 'greeting.night' : h < 11 ? 'greeting.morning' : h < 17 ? 'greeting.day' : h < 22 ? 'greeting.evening' : 'greeting.night';
      this.el.greeting.textContent = this.s.clockGreeting ? this.t(greet) : '';
      this.el.date.textContent = this.s.clockDate
        ? new Intl.DateTimeFormat(this.lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
        : '';
      this.el.note.textContent = this.s.clockText || '';
    }

    renderTime(d) {
      const style = this.s.clockStyle;
      const hh = pad(d.getHours());
      const mm = pad(d.getMinutes());
      const ss = pad(d.getSeconds());
      const time = this.el.time;

      if (style === 'analog') {
        if (!this.analog) {
          this.analog = this.buildAnalog();
          time.replaceChildren(this.analog.svg);
        }
        const ms = d.getMilliseconds();
        const sec = d.getSeconds() + ms / 1000;
        const min = d.getMinutes() + sec / 60;
        const hr = (d.getHours() % 12) + min / 60;
        this.analog.hour.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
        this.analog.minute.setAttribute('transform', `rotate(${min * 6} 100 100)`);
        this.analog.second.style.display = this.s.clockSeconds ? '' : 'none';
        this.analog.second.setAttribute('transform', `rotate(${(d.getSeconds() + Math.min(1, ms / 120)) * 6} 100 100)`);
        return;
      }

      if (style === 'words') {
        const W = WORDS[this.lang];
        const total = d.getHours() * 60 + d.getMinutes();
        const rounded = Math.round(total / 5) * 5;
        const diff = total - rounded;
        const m = ((rounded % 60) + 60) % 60;
        const hIdx = Math.floor(rounded / 60);
        const hour = (x) => W.hours[((x % 12) + 12) % 12];
        const lead = diff < 0 ? W.lead.before : diff > 0 ? W.lead.after : W.lead.exact;
        const key = `w|${this.lang}|${lead}|${m}|${hIdx}`;
        if (key !== this.timeKey) {
          this.timeKey = key;
          time.innerHTML = `<span class="w-lead">${lead}</span><span class="w-main">${W.phrase(m, hour(hIdx), hour(hIdx + 1))}</span>`;
        }
        return;
      }

      if (style === 'flip') {
        const digits = (hh + mm + (this.s.clockSeconds ? ss : '')).split('');
        const key = `f|${digits.length}`;
        if (key !== this.timeKey) {
          this.timeKey = key;
          time.replaceChildren();
          this.flip = digits.map((_, i) => {
            if (i === 2 || i === 4) {
              const colon = document.createElement('span');
              colon.className = 'f-colon';
              colon.textContent = ':';
              time.appendChild(colon);
            }
            const tile = document.createElement('span');
            tile.className = i >= 4 ? 'f-tile small' : 'f-tile';
            const span = document.createElement('span');
            tile.appendChild(span);
            time.appendChild(tile);
            return { tile, span, value: null };
          });
        }
        digits.forEach((v, i) => {
          const f = this.flip[i];
          if (f.value === v) return;
          const first = f.value === null;
          f.value = v;
          f.span.textContent = v;
          if (!first) { f.tile.classList.remove('turn'); void f.tile.offsetWidth; f.tile.classList.add('turn'); }
        });
        return;
      }

      // modern, glass, pixel, neon: plain digits
      const key = `${style}|${hh}:${mm}|${this.s.clockSeconds ? ss : ''}`;
      if (key === this.timeKey) return;
      const newMinute = !this.timeKey.includes(`|${hh}:${mm}|`);
      this.timeKey = key;
      time.textContent = `${hh}:${mm}`;
      if (this.s.clockSeconds) {
        const s = document.createElement('span');
        s.className = 'sec';
        s.textContent = ss;
        time.appendChild(s);
      }
      if (style === 'neon' && newMinute) { time.classList.remove('flicker'); void time.offsetWidth; time.classList.add('flicker'); }
    }

    buildAnalog() {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.classList.add('analog');
      const add = (name, attrs, cls) => {
        const e = document.createElementNS(NS, name);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        if (cls) e.setAttribute('class', cls);
        svg.appendChild(e);
        return e;
      };
      add('circle', { cx: 100, cy: 100, r: 96 }, 'face');
      for (let i = 0; i < 60; i++) {
        const big = i % 5 === 0;
        const a = (i / 60) * Math.PI * 2;
        const r1 = big ? 78 : 85;
        add('line', { x1: 100 + Math.sin(a) * r1, y1: 100 - Math.cos(a) * r1, x2: 100 + Math.sin(a) * 90, y2: 100 - Math.cos(a) * 90 }, big ? 'tick big' : 'tick');
      }
      const hour = add('line', { x1: 100, y1: 112, x2: 100, y2: 52 }, 'hand hour');
      const minute = add('line', { x1: 100, y1: 114, x2: 100, y2: 26 }, 'hand minute');
      const second = add('line', { x1: 100, y1: 120, x2: 100, y2: 20 }, 'hand second');
      add('circle', { cx: 100, cy: 100, r: 4.5 }, 'pin');
      return { svg, hour, minute, second };
    }

    rect() {
      return this.el.time.getBoundingClientRect();
    }
  }

  L.ClockFace = ClockFace;
})();
