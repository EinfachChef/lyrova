// The background layer: three animated canvas scenes (color waves, particles, starry sky),
// the blurred album cover, or the user's own image/video. All animations are drawn by code –
// no bundled third-party images.

(function () {
  'use strict';

  /** "#ff9a2e" → {r,g,b} */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  /** Shift a color's hue by `deg` degrees (for matching palettes). */
  function hueShift({ r, g, b }, deg) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const m = [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
    ];
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return { r: c(m[0] * r + m[1] * g + m[2] * b), g: c(m[3] * r + m[4] * g + m[5] * b), b: c(m[6] * r + m[7] * g + m[8] * b) };
  }
  const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;

  // ── Canvas scenes ─────────────────────────────────────────────────────────
  class CanvasScene {
    constructor(canvas, accent) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.setAccent(accent);
      this.resize();
    }
    setAccent(hex) {
      this.accent = hexToRgb(hex);
    }
    resize() {
      // CSS pixels (not device pixels): plenty sharp for soft shapes and much cheaper
      this.w = this.canvas.width = Math.max(1, this.canvas.clientWidth);
      this.h = this.canvas.height = Math.max(1, this.canvas.clientHeight);
      this.setup();
    }
    setup() {}
  }

  /** Slowly flowing color waves, a little taller with the bass. */
  class Waves extends CanvasScene {
    frame(t, dt, bass) {
      const { ctx, w, h } = this;
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#07060c');
      bg.addColorStop(1, '#120a12');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const color = hueShift(this.accent, -40 + i * 28);
        const base = h * (0.55 + i * 0.1);
        const amp = h * (0.05 + i * 0.012) * (1 + bass * 0.35);
        const speed = 0.00012 + i * 0.00005;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) {
          const y = base
            + Math.sin(x * 0.0021 + t * speed * 6 + i * 1.7) * amp
            + Math.sin(x * 0.0047 - t * speed * 4 + i) * amp * 0.45;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, base - amp, 0, h);
        g.addColorStop(0, rgba(color, 0.32 - i * 0.04));
        g.addColorStop(1, rgba(color, 0.02));
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  /** Soft glowing dots drifting upwards. */
  class Particles extends CanvasScene {
    setup() {
      const n = Math.round((this.w * this.h) / 16000);
      this.dots = Array.from({ length: n }, () => this.spawn(true));
    }
    spawn(anywhere) {
      return {
        x: Math.random() * this.w,
        y: anywhere ? Math.random() * this.h : this.h + 20,
        r: 1 + Math.random() * 3.5,
        vy: 6 + Math.random() * 18,
        drift: Math.random() * Math.PI * 2,
        hue: -30 + Math.random() * 60,
        a: 0.15 + Math.random() * 0.5,
      };
    }
    frame(t, dt, bass) {
      const { ctx, w, h } = this;
      ctx.fillStyle = '#07060b';
      ctx.fillRect(0, 0, w, h);
      const s = dt / 1000;
      for (const d of this.dots) {
        d.y -= d.vy * s * (1 + bass * 1.5);
        d.x += Math.sin(t * 0.0004 + d.drift) * 0.25;
        if (d.y < -20) Object.assign(d, this.spawn(false));
        const c = hueShift(this.accent, d.hue);
        ctx.beginPath();
        ctx.fillStyle = rgba(c, Math.min(1, d.a * (0.7 + bass * 0.8)));
        ctx.shadowColor = rgba(c, 0.9);
        ctx.shadowBlur = d.r * 4;
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  /** Twinkling stars with a slow drift and the occasional shooting star. */
  class Stars extends CanvasScene {
    setup() {
      const n = Math.round((this.w * this.h) / 2600);
      this.stars = Array.from({ length: n }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: Math.random() < 0.9 ? 0.4 + Math.random() * 0.8 : 1.2 + Math.random() * 0.9,
        tw: Math.random() * Math.PI * 2,
        sp: 0.5 + Math.random() * 2,
      }));
      this.shooting = null;
    }
    frame(t, dt, bass) {
      const { ctx, w, h } = this;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#03040b');
      g.addColorStop(1, rgba(hueShift(this.accent, 200), 0.18));
      ctx.fillStyle = '#03040b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const shift = (t * 0.004) % w;
      for (const s of this.stars) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.001 * s.sp + s.tw));
        let x = s.x - shift * (s.r * 0.3);
        if (x < 0) x += w;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * (0.8 + bass * 0.5))})`;
        ctx.fillRect(x, s.y, s.r, s.r);
      }
      if (!this.shooting && Math.random() < dt / 9000) {
        this.shooting = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.4, life: 0 };
      }
      if (this.shooting) {
        const st = this.shooting;
        st.life += dt;
        const p = st.life / 900;
        const x = st.x - p * 380;
        const y = st.y + p * 160;
        const grad = ctx.createLinearGradient(x, y, x + 120, y - 50);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - p)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 120, y - 50);
        ctx.stroke();
        if (p >= 1) this.shooting = null;
      }
    }
  }

  const SCENES = { waves: Waves, particles: Particles, stars: Stars };

  // ── The layer ─────────────────────────────────────────────────────────────
  class BackgroundLayer {
    constructor(container, dim, onError) {
      this.container = container;
      this.dim = dim;
      this.onError = onError;
      this.kind = null;
      this.scene = null;
      this.video = null;
      this.coverEls = [];
      this.coverUrl = '';
      this.signature = '';
    }

    /**
     * @param {object} o  { kind, accent, imageUrl, videoUrl, coverUrl, dimAmount }
     */
    set(o) {
      let kind = o.kind;
      // fall back to waves when the chosen source is missing
      if (kind === 'image' && !o.imageUrl) kind = 'waves';
      if (kind === 'video' && !o.videoUrl) kind = 'waves';
      const signature = `${kind}|${kind === 'image' ? o.imageUrl : ''}|${kind === 'video' ? o.videoUrl : ''}`;
      if (signature !== this.signature) {
        this.signature = signature;
        this.build(kind, o);
      }
      if (this.scene) this.scene.setAccent(o.accent);
      if (kind === 'cover') this.setCover(o.coverUrl);
      const dim = kind === 'image' || kind === 'video' ? o.dimAmount : kind === 'cover' ? Math.max(0.15, o.dimAmount * 0.6) : 0;
      this.dim.style.opacity = String(dim);
      this.fallbackScene = o.accent;
    }

    build(kind, o) {
      this.clear();
      this.kind = kind;
      if (SCENES[kind]) {
        const canvas = document.createElement('canvas');
        this.container.appendChild(canvas);
        this.scene = new SCENES[kind](canvas, o.accent);
      } else if (kind === 'image') {
        const img = document.createElement('img');
        img.alt = '';
        img.src = o.imageUrl;
        img.onerror = () => this.failed('image');
        this.container.appendChild(img);
      } else if (kind === 'video') {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, loop: true, autoplay: true, playsInline: true, src: o.videoUrl });
        v.onerror = () => this.failed('video');
        this.container.appendChild(v);
        v.play().catch(() => {});
        this.video = v;
      } else if (kind === 'cover') {
        // dark base plus two image layers that crossfade when the cover changes
        const base = document.createElement('div');
        base.style.background = '#0b0910';
        this.container.appendChild(base);
        this.coverEls = [0, 1].map(() => {
          const img = document.createElement('img');
          img.className = 'cover';
          img.alt = '';
          this.container.appendChild(img);
          return img;
        });
        this.coverUrl = '';
        this.flip = 0;
      }
    }

    setCover(url) {
      if (!this.coverEls.length || url === this.coverUrl) return;
      this.coverUrl = url;
      const next = this.coverEls[this.flip ^ 1];
      const prev = this.coverEls[this.flip];
      if (!url) { prev.classList.remove('visible'); next.classList.remove('visible'); return; }
      next.onload = () => {
        next.classList.add('visible');
        prev.classList.remove('visible');
        this.flip ^= 1;
      };
      next.src = url;
    }

    failed(what) {
      this.onError(`${what} background could not be loaded`);
      this.signature = '';
      this.build('waves', { accent: this.fallbackScene || '#ff9a2e' });
    }

    clear() {
      if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
      this.container.replaceChildren();
      this.scene = null;
      this.video = null;
      this.coverEls = [];
    }

    resize() {
      if (this.scene) this.scene.resize();
    }

    frame(t, dt, bass) {
      if (this.scene) this.scene.frame(t, Math.min(dt, 100), bass);
    }

    setPaused(paused) {
      if (!this.video) return;
      if (paused) this.video.pause(); else this.video.play().catch(() => {});
    }
  }

  (window.Lyrova = window.Lyrova || {}).BackgroundLayer = BackgroundLayer;
  window.Lyrova.hexToRgb = hexToRgb;
})();
