// Bass-reactive effects: smoothing of the bass level, and sparks that fly off the active line
// on every beat. (Glow and pulse are pure CSS, driven by the --bass variable.)

(function () {
  'use strict';

  /** Smooths the raw level: fast attack, slower release – feels like a VU meter. */
  class BassSmoother {
    constructor() {
      this.target = 0;
      this.value = 0;
      this.prev = 0;
    }
    push(level) {
      this.target = Math.max(0, Math.min(1.5, Number(level) || 0));
    }
    step(dt) {
      const k = this.target > this.value ? 0.55 : 1 - Math.pow(0.86, dt / 16.7);
      this.prev = this.value;
      this.value += (this.target - this.value) * k;
      if (this.value < 0.003) this.value = 0;
      return this.value;
    }
    /** true on a rising edge = a beat */
    get beat() {
      return this.value - this.prev > 0.12 && this.value > 0.45;
    }
  }

  class Sparks {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.list = [];
      this.resize();
    }
    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
    /** A burst of sparks around a rectangle (the active line). */
    burst(rect, count, color) {
      if (!rect) return;
      for (let i = 0; i < count; i++) {
        const edge = Math.random();
        this.list.push({
          x: rect.left + edge * rect.width,
          y: rect.top + rect.height * (0.3 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 60,
          vy: -40 - Math.random() * 110,
          life: 0,
          max: 700 + Math.random() * 900,
          r: 1 + Math.random() * 2.2,
          color,
        });
      }
      if (this.list.length > 400) this.list.splice(0, this.list.length - 400);
    }
    /** Returns false when nothing is left to draw (then the loop can skip clearing). */
    frame(dt) {
      const { ctx } = this;
      if (!this.list.length && !this.dirty) return false;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const s = dt / 1000;
      this.list = this.list.filter((p) => (p.life += dt) < p.max);
      for (const p of this.list) {
        p.x += p.vx * s;
        p.y += p.vy * s;
        p.vy += 30 * s;
        const a = 1 - p.life / p.max;
        ctx.fillStyle = `rgba(${p.color},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      this.dirty = this.list.length > 0;
      return true;
    }
    clear() {
      this.list = [];
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  Object.assign((window.Lyrova = window.Lyrova || {}), { BassSmoother, Sparks });
})();
