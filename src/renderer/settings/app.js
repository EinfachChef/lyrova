// Settings window logic. Every change is sent to the main process right away (it saves and
// updates the wallpaper live); slider drags are bundled to ~8 updates per second.

(async function () {
  'use strict';

  const api = window.lyrovaSettings;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const FONTS = [
    'Segoe UI Variable Display', 'Segoe UI', 'Bahnschrift', 'Pixelify Sans', 'Arial Black', 'Georgia',
    'Trebuchet MS', 'Impact', 'Ink Free', 'Segoe Print', 'Cascadia Mono', 'Consolas',
  ];
  const COLORS = {
    textColor: ['#ffffff', '#fff1d6', '#ffd60a', '#ff9ad5', '#c9a6ff', '#8ef3ff'],
    accentColor: ['#ff9a2e', '#ffb21e', '#ff5f1a', '#ff375f', '#bf5af2', '#64d2ff'],
    edgeColor: ['#33ffaa', '#ff9a2e', '#ff375f', '#bf5af2', '#64d2ff', '#ffffff'],
    clockColor: ['#ffffff', '#ffd9a0', '#ffb21e', '#ff9ad5', '#c9a6ff', '#8ef3ff'],
  };
  const BACKGROUNDS = [
    ['waves', 't-waves', ''], ['particles', 't-particles', ''], ['stars', 't-stars', ''], ['cover', 't-cover', ''],
    ['image', 't-image', '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.5" r="1.2"/><path d="M3 12l3.5-3 2.5 2 2-1.5 2 2"/></svg>'],
    ['video', 't-video', '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="9" height="9" rx="2"/><path d="M11 7l3-2v6l-3-2"/></svg>'],
  ];
  const ROLES = ['lyrics', 'clock', 'background', 'off'];

  const loaded = await api.load();
  let values = loaded.settings;
  let dict = loaded.dict;
  let status = loaded.status;
  const info = loaded.info;
  const t = (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

  // ── saving (bundled) ─────────────────────────────────────────────────────
  let pending = {};
  let timer = null;
  function update(patch) {
    Object.assign(values, patch);
    Object.assign(pending, patch);
    sync();
    if (!timer) {
      timer = setTimeout(() => {
        const p = pending;
        pending = {};
        timer = null;
        api.set(p);
      }, 120);
    }
  }

  // ── navigation ───────────────────────────────────────────────────────────
  function showPage(page) {
    document.body.dataset.page = page;
    $$('.nav').forEach((b) => b.classList.toggle('selected', b.dataset.page === page));
    $$('.page').forEach((p) => { p.hidden = p.dataset.page !== page; });
    $('.content').scrollTop = 0;
  }
  $$('.nav').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));

  // ── build dynamic controls ───────────────────────────────────────────────
  const fontSelect = $('#fontFamily');
  for (const f of FONTS) {
    const o = document.createElement('option');
    o.value = o.textContent = f;
    o.style.fontFamily = `"${f}"`;
    fontSelect.appendChild(o);
  }
  fontSelect.addEventListener('change', () => update({ fontFamily: fontSelect.value }));
  $('#language').addEventListener('change', () => update({ language: $('#language').value }));

  // background tiles for the lyrics screen and for the clock screen
  $$('.bg-tiles').forEach((box) => {
    for (const [value, cls, svg] of BACKGROUNDS) {
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.value = value;
      b.innerHTML = `<span class="thumb ${cls}">${svg}</span><b data-i18n="background.${value}"></b>`;
      box.appendChild(b);
    }
  });

  // every tile grid sets its data-key; own image/video without a file opens the picker
  $$('.tiles').forEach((box) => box.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const key = box.dataset.key;
    const value = tile.dataset.value;
    if (box.classList.contains('bg-tiles') && (value === 'image' || value === 'video')) {
      const fileKey = key + (value === 'image' ? 'Image' : 'Video');
      if (!values[fileKey]) return pick(value, box.dataset.target);
    }
    update({ [key]: value });
  }));
  $$('[data-pick]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.pick, b.dataset.target)));

  async function pick(kind, target) {
    const res = await api.pickFile(kind, target);
    const el = $(`.page[data-page="${target === 'clock' ? 'clock' : 'background'}"] .bg-status`);
    if (res && res.ok) el.textContent = '';
    else if (res && !res.canceled) el.textContent = t('background.error');
  }

  const pct = (v) => (v === 0 ? t('effects.off') : `${Math.round(v * 100)} %`);
  const RANGES = {
    fontSize: (v) => `${Math.round(v * 100)} %`,
    backgroundDim: (v) => `${Math.round(v * 100)} %`,
    clockSize: (v) => `${Math.round(v * 100)} %`,
    glowAmount: pct, pulseAmount: pct, particlesAmount: pct, edgeAmount: pct, shakeAmount: pct,
    offsetMs: (v) => `${v > 0 ? '+' : ''}${(v / 1000).toLocaleString(values.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`,
  };
  for (const id of Object.keys(RANGES)) $(`#${id}`).addEventListener('input', (e) => update({ [id]: Number(e.target.value) }));

  const SWITCHES = ['showSongInfo', 'autostart', 'pauseOnFullscreen', 'throttleOnBattery', 'autoUpdate',
    'clockGreeting', 'clockDate', 'clockSeconds', 'clockSongCard', 'clockLyricLine'];
  for (const id of SWITCHES) $(`#${id}`).addEventListener('change', (e) => update({ [id]: e.target.checked }));
  $('#clockText').addEventListener('input', (e) => update({ clockText: e.target.value }));

  $$('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    update({ [seg.dataset.key]: seg.dataset.key === 'fps' ? Number(b.dataset.value) : b.dataset.value });
  }));

  $$('.swatches').forEach((box) => {
    const key = box.dataset.key;
    for (const c of COLORS[key]) {
      const s = document.createElement('button');
      s.className = 'swatch';
      s.style.background = c;
      s.dataset.color = c;
      s.setAttribute('aria-label', c);
      s.addEventListener('click', () => update({ [key]: c }));
      box.appendChild(s);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.setAttribute('aria-label', 'custom color');
    custom.addEventListener('input', () => update({ [key]: custom.value }));
    box.appendChild(custom);
  });

  $('#offset-reset').addEventListener('click', () => update({ offsetMs: 0 }));
  $('#cache-clear').addEventListener('click', async () => {
    $('#cache-status').textContent = t('appearance.cache.cleared', { count: await api.clearCache() });
  });
  $('#open-log').addEventListener('click', () => api.openLog());

  // ── displays: little map + one role per display ──────────────────────────
  function renderDisplays() {
    const map = $('#screen-map');
    const list = $('#display-list');
    map.replaceChildren();
    list.replaceChildren();
    const ds = status.displays || [];
    if (!ds.length) return;
    const minX = Math.min(...ds.map((d) => d.bounds.x));
    const minY = Math.min(...ds.map((d) => d.bounds.y));
    const maxX = Math.max(...ds.map((d) => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...ds.map((d) => d.bounds.y + d.bounds.height));
    const scale = Math.min(460 / (maxX - minX), 170 / (maxY - minY));
    map.style.width = `${Math.round((maxX - minX) * scale)}px`;
    map.style.height = `${Math.round((maxY - minY) * scale)}px`;
    for (const d of ds) {
      const role = (values.screens && values.screens[d.id]) || (d.primary ? 'lyrics' : 'clock');
      const box = document.createElement('div');
      box.className = `screen-box role-${role}`;
      Object.assign(box.style, {
        left: `${(d.bounds.x - minX) * scale}px`, top: `${(d.bounds.y - minY) * scale}px`,
        width: `${d.bounds.width * scale - 6}px`, height: `${d.bounds.height * scale - 6}px`,
      });
      const n = document.createElement('b');
      n.textContent = d.number;
      const r = document.createElement('span');
      r.textContent = t(`screens.role.${role}`);
      box.append(n, r);
      map.appendChild(box);

      const row = document.createElement('label');
      row.className = 'row';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = t('screens.display', { n: d.number });
      const small = document.createElement('small');
      small.textContent = `${d.size}${d.portrait ? ' · ↕' : ''}${d.primary ? ' · ' + t('screens.main') : ''}`;
      lbl.appendChild(small);
      const select = document.createElement('select');
      for (const value of ROLES) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = t(`screens.role.${value}`);
        select.appendChild(o);
      }
      select.value = role;
      select.addEventListener('change', () => {
        update({ screens: { ...values.screens, [d.id]: select.value } });
        renderDisplays();
      });
      row.append(lbl, select);
      list.appendChild(row);
    }
  }

  // ── reflect current values ───────────────────────────────────────────────
  function sync() {
    fontSelect.value = FONTS.includes(values.fontFamily) ? values.fontFamily : FONTS[0];
    $('#language').value = values.language;
    for (const [id, fmt] of Object.entries(RANGES)) {
      const input = $(`#${id}`);
      if (document.activeElement !== input) input.value = values[id];
      $(`output[for="${id}"]`).textContent = fmt(values[id]);
    }
    for (const id of SWITCHES) $(`#${id}`).checked = !!values[id];
    $('#clockLyricLine').disabled = !values.clockSongCard;
    if (document.activeElement !== $('#clockText')) $('#clockText').value = values.clockText;
    $$('.seg').forEach((seg) => $$('button', seg).forEach((b) =>
      b.classList.toggle('selected', String(values[seg.dataset.key]) === b.dataset.value)));
    $$('.tiles').forEach((box) => $$('.tile', box).forEach((tile) =>
      tile.classList.toggle('selected', tile.dataset.value === values[box.dataset.key])));
    $$('.swatches').forEach((box) => {
      const key = box.dataset.key;
      $$('.swatch', box).forEach((s) => s.classList.toggle('selected', s.dataset.color === values[key]));
      $('input[type="color"]', box).value = values[key];
    });
    $$('.file-state').forEach((el) => { el.textContent = values[el.dataset.file] ? '✓' : t('background.noFile'); });
    $('#mode').textContent = status.mode === 'fallback' ? t('screens.mode.fallback') : t('screens.mode.wallpaper');
    $('#audio-status').hidden = status.audio !== false;
    $('#autostart').disabled = !info.packaged;
    $('#autostart-hint').hidden = info.packaged;
  }

  function translate() {
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $('#clockText').placeholder = t('clock.text.placeholder');
    document.title = t('settings.title');
    $('#version').textContent = t('system.version', { version: info.version });
    $('#version-row').textContent = t('system.version', { version: info.version });
    document.documentElement.lang = values.language;
    renderDisplays();
    sync();
  }

  // ── live updates from the main process ───────────────────────────────────
  api.onSettings((v) => { values = { ...v, ...pending }; sync(); });
  api.onI18n((d) => { dict = d; translate(); });
  api.onStatus((s) => { status = s; renderDisplays(); sync(); });
  const meter = $('#meter');
  api.onBass((level) => { meter.style.width = `${Math.round(Math.min(1, level) * 100)}%`; });

  translate();
  showPage('appearance');
})();
