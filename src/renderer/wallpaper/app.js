// Wallpaper page: connects song, lyrics, settings, bass and the background, and runs the
// animation loop (limited to the chosen frame rate; stopped completely while paused).
// The page has a role (from the URL): 'lyrics', 'clock' or 'background' (background + effects only).

(function () {
  'use strict';

  const L = window.Lyrova;
  const api = window.lyrova;
  const params = new URLSearchParams(location.search);
  const displayId = params.get('display') || '';
  const role = ['lyrics', 'clock', 'background'].includes(params.get('role')) ? params.get('role') : 'lyrics';
  const root = document.documentElement;
  root.style.setProperty('--inset-bottom', `${Number(params.get('insetBottom')) || 0}px`);
  root.style.setProperty('--inset-left', `${Number(params.get('insetLeft')) || 0}px`);

  const report = (level, msg) => { try { api.log(level, msg); } catch { /* ignore */ } };
  window.addEventListener('error', (e) => report('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => report('error', String(e.reason && e.reason.stack || e.reason)));

  const $ = (sel) => document.querySelector(sel);
  const scene = $('#scene');
  const edge = $('#edge');
  const view = new L.LyricsView({ stage: $('#stage'), column: $('#lyrics'), message: $('#message'), floatLayer: $('#float') });
  const background = new L.BackgroundLayer($('#bg'), $('#dim'), (msg) => report('warn', msg));
  const sparks = new L.Sparks($('#particles'));
  const bass = new L.BassSmoother();

  let dict = {};
  let lang = 'de';
  const t = (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const clockFace = new L.ClockFace($('#clock'), t);

  // show only what this role needs
  $('#stage').hidden = role !== 'lyrics';
  $('#clock').hidden = role !== 'clock';

  let settings = null;
  let song = null;          // current media state or null
  let lyrics = null;        // last lyrics result from the main process
  let paused = false;       // tray "pause" or fullscreen game
  let throttled = false;    // on battery

  // ── Song clock: the media report is only sent now and then; we count on in between ──
  const clock = {
    base: 0, at: performance.now(), playing: false,
    set(pos, playing) { this.base = pos; this.at = performance.now(); this.playing = playing; },
    now() { return this.base + (this.playing ? performance.now() - this.at : 0); },
  };
  const songTime = () => clock.now() + (settings ? settings.offsetMs : 0);
  const keyOf = (s) => `${s.app}|${s.title}|${s.artist}`;
  const currentLyrics = () => (song && lyrics && lyrics.key === keyOf(song) ? lyrics : null);

  // ── Song + lyrics → screen ───────────────────────────────────────────────
  function onMedia(state) {
    if (!state || !state.active) {
      song = null;
    } else {
      const playing = state.status === 'Playing';
      const isNew = !song || keyOf(song) !== keyOf(state);
      song = state;
      clock.set(state.positionMs + (playing ? Math.max(0, Date.now() - state.sampledAt) : 0), playing);
      if (!isNew) { renderSongInfo(); background.set(backgroundOptions()); return; }
    }
    renderLyrics();
    renderSongInfo();
    clockFace.setSong(song, currentLyrics());
    if (settings) background.set(backgroundOptions());
  }

  function onLyrics(result) {
    lyrics = result;
    renderLyrics();
    renderSongInfo();
    clockFace.setSong(song, currentLyrics());
  }

  const HINTS = {
    loading: 'lyrics.searching', instrumental: 'lyrics.instrumental', notfound: 'lyrics.notFound',
    offline: 'lyrics.offline', unavailable: 'lyrics.unavailable',
  };

  function renderLyrics() {
    if (role !== 'lyrics') return;
    if (!song) return view.showMessage('Lyrova', t('lyrics.idle'));
    const r = currentLyrics();
    const title = (r && r.title) || song.title;
    if (!r) return view.showMessage(title, t('lyrics.searching'));
    if (r.status === 'synced') {
      const lines = L.parseLRC(r.synced);
      if (lines.some((l) => l.text)) return view.showSynced(lines);
    }
    if (r.status === 'plain' || (r.status === 'synced' && r.plain)) return view.showPlain(r.plain);
    view.showMessage(title, t(HINTS[r.status] || 'lyrics.notFound'));
  }

  // ── Song info capsule (lyrics screen only) ───────────────────────────────
  const si = {
    box: $('#songinfo'), cover: $('.si-cover'), title: $('.si-title'), artist: $('.si-artist'),
    bar: $('.si-bar i'), time: $('.si-time'),
  };
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  function renderSongInfo() {
    const show = !!(role === 'lyrics' && song && settings && settings.showSongInfo);
    si.box.hidden = !show;
    if (!show) return;
    const r = currentLyrics();
    si.title.textContent = (r && r.title) || song.title;
    si.artist.textContent = (r && r.artist) || song.artist;
    const coverUrl = song.coverUrl || '';
    si.cover.hidden = !coverUrl;
    if (coverUrl && si.cover.getAttribute('src') !== coverUrl) si.cover.src = coverUrl;
    updateProgress();
  }
  function updateProgress() {
    if (!song || si.box.hidden) return;
    const pos = Math.min(clock.now(), song.durationMs || Infinity);
    si.bar.style.width = song.durationMs > 0 ? `${((pos / song.durationMs) * 100).toFixed(1)}%` : '0%';
    si.time.textContent = song.status === 'Playing' ? fmt(pos) : t('lyrics.paused');
    si.box.classList.toggle('paused', song.status !== 'Playing');
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  function backgroundOptions() {
    const c = role === 'clock';
    return {
      kind: c ? settings.clockBackground : settings.background,
      accent: settings.accentColor,
      imageUrl: c ? settings.clockBackgroundImageUrl : settings.backgroundImageUrl,
      videoUrl: c ? settings.clockBackgroundVideoUrl : settings.backgroundVideoUrl,
      coverUrl: song && song.coverUrl,
      dimAmount: settings.backgroundDim,
    };
  }

  function applySettings(s) {
    if (!s) return;
    const prev = settings || {};
    settings = s;
    const rgb = (hex) => { const c = L.hexToRgb(hex); return `${c.r} ${c.g} ${c.b}`; };
    root.style.setProperty('--accent', s.accentColor);
    root.style.setProperty('--accent-rgb', rgb(s.accentColor));
    root.style.setProperty('--text', s.textColor);
    root.style.setProperty('--text-rgb', rgb(s.textColor));
    root.style.setProperty('--edge-rgb', rgb(s.edgeColor));
    root.style.setProperty('--font', `"${s.fontFamily}"`);
    root.style.setProperty('--glow-amt', String(s.glowAmount));
    root.style.setProperty('--pulse-amt', String(s.pulseAmount));
    applySize();
    view.setStyle(s.lyricsStyle);
    view.setPosition(s.position);
    if (!s.particlesAmount) sparks.clear();
    if (!s.shakeAmount) scene.style.transform = '';
    background.set(backgroundOptions());
    clockFace.setSettings(s);
    renderSongInfo();
    if (prev.fontFamily !== s.fontFamily || prev.fontSize !== s.fontSize) requestAnimationFrame(() => view.relayout());
  }

  function applySize() {
    if (!settings) return;
    root.style.setProperty('--size', `${Math.round(window.innerHeight * 0.056 * settings.fontSize)}px`);
  }

  // ── Bass effects: glow/pulse (CSS), edge, shake, sparks ──────────────────
  let bassShown = -1;
  let edgeShown = -1;
  let shaking = false;
  function bassEffects(now, b) {
    const shown = Math.round(b * 100) / 100;
    if (shown !== bassShown) { bassShown = shown; root.style.setProperty('--bass', String(shown)); }

    const e = Math.round(Math.min(1, b * settings.edgeAmount) * 100) / 100;
    if (e !== edgeShown) { edgeShown = e; edge.style.opacity = String(e); }

    // shake: zoom in a little and jitter – never further than the zoom margin, so no black edges
    const k = b * settings.shakeAmount;
    if (k < 0.01) {
      if (shaking) { scene.style.transform = ''; shaking = false; }
    } else {
      const zoom = 1 + 0.014 * k;
      const maxX = ((zoom - 1) * window.innerWidth) / 2;
      const maxY = ((zoom - 1) * window.innerHeight) / 2;
      const amp = 7 * k;
      const dx = Math.max(-maxX, Math.min(maxX, (Math.sin(now * 0.091) + Math.sin(now * 0.137)) * 0.5 * amp));
      const dy = Math.max(-maxY, Math.min(maxY, (Math.sin(now * 0.113 + 1) + Math.sin(now * 0.071)) * 0.5 * amp));
      scene.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${zoom.toFixed(4)})`;
      shaking = true;
    }

    if (settings.particlesAmount > 0 && !throttled && bass.beat) {
      const rect = role === 'lyrics' ? view.activeRect() : role === 'clock' ? clockFace.rect() : null;
      sparks.burst(rect, Math.round(6 * settings.particlesAmount + 2), root.style.getPropertyValue('--accent-rgb').replace(/ /g, ','));
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  let last = performance.now();
  let lastDraw = 0;
  let lastSecond = -1;
  let running = false;

  function tick(now) {
    if (paused) { running = false; return; }
    requestAnimationFrame(tick);
    const fps = throttled ? 30 : (settings ? settings.fps : 60);
    if (now - lastDraw < 1000 / fps - 2) return;
    const dt = Math.min(100, now - last);
    last = now;
    lastDraw = now;
    if (!settings) return;
    try {
      const b = bass.step(dt);
      bassEffects(now, b);
      background.frame(now, dt, b);
      if (role === 'lyrics') view.update(songTime(), song ? song.durationMs : 0);
      if (role === 'clock') clockFace.frame(song ? Math.min(songTime(), song.durationMs || Infinity) : 0);
      sparks.frame(dt);
      const second = Math.floor(clock.now() / 1000);
      if (song && second !== lastSecond) { lastSecond = second; updateProgress(); }
    } catch (err) {
      report('error', err && err.stack || String(err));
    }
  }
  function start() {
    if (running || paused) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  api.on('settings', (s) => {
    if (s.language !== lang) { lang = s.language; clockFace.setTranslator(t, lang); }
    applySettings(s);
  });
  api.on('media', onMedia);
  api.on('lyrics', onLyrics);
  api.on('bass', (level) => bass.push(level));
  api.on('paused', (p) => {
    paused = !!p;
    background.setPaused(paused);
    if (paused) { scene.style.transform = ''; edge.style.opacity = '0'; }
    else start();
  });
  api.on('throttle', (v) => { throttled = !!v; if (throttled) sparks.clear(); });
  api.on('i18n', (d) => { dict = d || {}; clockFace.setTranslator(t, lang); renderLyrics(); renderSongInfo(); });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applySize();
      background.resize();
      sparks.resize();
      clockFace.resize();
      view.relayout();
    }, 150);
  });
  document.fonts.addEventListener('loadingdone', () => { view.relayout(); clockFace.timeKey = ''; });

  api.init(displayId).then((init) => {
    dict = init.dict || {};
    lang = init.settings.language;
    clockFace.setTranslator(t, lang);
    throttled = !!init.throttled;
    applySettings(init.settings);
    onMedia(init.media);
    onLyrics(init.lyrics);
    paused = !!init.paused;
    start();
  }).catch((err) => report('error', 'init failed: ' + err));
})();
