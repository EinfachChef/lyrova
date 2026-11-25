// Lyrova – main process.
// Starts the wallpaper windows, song detection, lyrics service, bass analysis, tray and updater,
// and passes data between them.
//
// Developer/test options:
//   --preview              normal 1280×720 window instead of the wallpaper (for testing the look)
//   --role=clock           (with --preview) show the clock screen or "background" instead of the lyrics
//   --window               wallpaper in fallback mode (borderless window at the bottom)
//   --settings             open the settings window on start
//   --snapshot=file.png    (with --preview or --settings) save a screenshot after LYROVA_SNAPSHOT_DELAY ms and quit
//   --quit-after=ms        quit automatically
//   LYROVA_USER_DATA=dir   separate data folder (tests don't touch your real settings)
//   LYROVA_NO_MEDIA=1      no song detection (idle screen, e.g. for screenshots)

const { app, BrowserWindow, dialog, ipcMain, net, screen, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const log = require('./logger');

const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const flags = {
  preview: process.argv.includes('--preview'),
  window: process.argv.includes('--window'),
  settings: process.argv.includes('--settings'),
  snapshot: arg('snapshot'),
  quitAfter: Number(arg('quit-after')) || 0,
};

if (process.env.LYROVA_USER_DATA) app.setPath('userData', process.env.LYROVA_USER_DATA);
app.setAppUserModelId('app.lyrova.desktop');
// the hidden audio window must be allowed to process sound without a click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const ICON = path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const i18n = require('../shared/i18n');

  let settings = null;      // SettingsStore
  let t = i18n.translator('de');
  let media = null;         // SmtcWatcher
  let lyrics = null;        // LyricsService
  let audio = null;         // AudioCapture
  let wallpapers = null;    // WallpaperManager
  let monitor = null;       // PerformanceMonitor
  let tray = null;
  let previewWin = null;
  let quitting = false;

  // pause / throttle state
  let userPaused = false;
  let covered = new Set();
  let onBattery = false;

  const settingsUi = () => require('./settings-window').settingsWindow();
  const toFileUrl = (p) => (p ? pathToFileURL(p).href : '');

  /** Settings as the pages need them (file paths turned into URLs). */
  function settingsForPages() {
    const s = settings.get();
    return {
      ...s,
      backgroundImageUrl: toFileUrl(s.backgroundImage),
      backgroundVideoUrl: toFileUrl(s.backgroundVideo),
      clockBackgroundImageUrl: toFileUrl(s.clockBackgroundImage),
      clockBackgroundVideoUrl: toFileUrl(s.clockBackgroundVideo),
    };
  }
  function mediaForPages(state = media && media.lastState) {
    if (!state || !state.active) return { active: false };
    return { ...state, coverUrl: toFileUrl(state.cover) };
  }
  const throttled = () => onBattery && settings.get().throttleOnBattery;

  /** Send to every page that shows the wallpaper (wallpaper windows + preview window). */
  function toPages(channel, data) {
    if (wallpapers) wallpapers.broadcast(channel, data);
    if (previewWin && !previewWin.isDestroyed()) previewWin.webContents.send(channel, data);
  }
  function toSettings(channel, data) {
    const w = settingsUi();
    if (w) w.webContents.send(channel, data);
  }

  function pausedFor(displayId) {
    return userPaused || (settings.get().pauseOnFullscreen && covered.has(Number(displayId)));
  }
  function applyPause() {
    if (quitting) return;
    if (wallpapers) {
      for (const w of wallpapers.list()) w.send('paused', pausedFor(w.display.id));
    }
    if (previewWin && !previewWin.isDestroyed()) previewWin.webContents.send('paused', userPaused);
    // bass analysis only while someone can see it
    const anyoneWatching = !!settingsUi() || (previewWin && !userPaused) ||
      (wallpapers && wallpapers.visible && wallpapers.list().some((w) => !pausedFor(w.display.id)));
    if (audio) audio.setPaused(!anyoneWatching);
    if (tray) tray.update({ paused: userPaused });
  }

  function statusForSettings() {
    return {
      audio: audio ? audio.available : null,
      mode: wallpapers ? wallpapers.mode() : 'preview',
      displays: displayList(),
    };
  }
  function displayList() {
    const { roleOf } = require('../shared/settings-schema');
    const primary = screen.getPrimaryDisplay().id;
    const screens = settings.get().screens;
    return screen.getAllDisplays()
      .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      .map((d, i) => ({
        id: String(d.id), number: i + 1, primary: d.id === primary,
        bounds: d.bounds,
        portrait: d.bounds.height > d.bounds.width,
        role: roleOf(screens, d.id, d.id === primary),
        size: `${Math.round(d.size.width * d.scaleFactor)} × ${Math.round(d.size.height * d.scaleFactor)}`,
      }));
  }

  // ── IPC ──────────────────────────────────────────────────────────────────
  ipcMain.on('log', (_e, level, message) => (log[level] || log.info)('[page]', String(message).slice(0, 2000)));

  ipcMain.handle('wallpaper:init', (_e, displayId) => ({
    settings: settingsForPages(),
    media: mediaForPages(),
    lyrics: lyrics ? lyrics.current : null,
    dict: i18n.dictionary(settings.get().language),
    paused: displayId ? pausedFor(displayId) : userPaused,
    throttled: throttled(),
  }));

  ipcMain.on('audio:level', (event, level) => {
    if (!audio || !audio.ownsSender(event.sender)) return;
    toPages('bass', level);
    toSettings('bass', level);
  });
  ipcMain.on('audio:status', (event, ok) => {
    if (!audio || !audio.ownsSender(event.sender)) return;
    audio.setAvailable(ok);
    toSettings('status', statusForSettings());
  });

  ipcMain.handle('settings:load', () => ({
    settings: settings.get(),
    dict: i18n.dictionary(settings.get().language),
    languages: i18n.LANGUAGES,
    info: { version: app.getVersion(), packaged: app.isPackaged },
    status: statusForSettings(),
  }));
  ipcMain.handle('settings:set', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      // file paths are only set by the main process (file picker), never directly by the page
      const { backgroundImage, backgroundVideo, clockBackgroundImage, clockBackgroundVideo, ...rest } = patch;
      settings.set(rest);
    }
    return settings.get();
  });
  ipcMain.handle('settings:pickFile', async (event, kind, target) => {
    if (kind !== 'image' && kind !== 'video') return { ok: false };
    const forClock = target === 'clock';
    const { importMedia, removeMedia, IMAGE_EXT, VIDEO_EXT } = require('./media-files');
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: t(kind === 'image' ? 'dialog.chooseImage' : 'dialog.chooseVideo'),
      properties: ['openFile'],
      filters: [{ name: t(kind === 'image' ? 'dialog.images' : 'dialog.videos'), extensions: kind === 'image' ? IMAGE_EXT : VIDEO_EXT }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const dir = path.join(app.getPath('userData'), 'media');
    const key = (forClock ? 'clockBackground' : 'background') + (kind === 'image' ? 'Image' : 'Video');
    try {
      const copy = await importMedia(res.filePaths[0], kind, dir);
      const old = settings.get()[key];
      settings.set({ [key]: copy, [forClock ? 'clockBackground' : 'background']: kind });
      await removeMedia(old, dir);
      log.info(`Background ${kind} set: ${path.basename(res.filePaths[0])}`);
      return { ok: true, name: path.basename(res.filePaths[0]) };
    } catch (err) {
      log.warn(`Background ${kind} rejected:`, err.message);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('cache:clear', () => (lyrics ? lyrics.clearCache() : 0));
  ipcMain.handle('log:open', () => log.file() && shell.openPath(log.file()));

  // ── Lifecycle ────────────────────────────────────────────────────────────
  process.on('uncaughtException', (err) => log.error('Uncaught:', err));
  process.on('unhandledRejection', (err) => log.error('Unhandled promise:', err));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.quit());

  app.on('second-instance', () => openSettingsWindow());
  app.on('window-all-closed', () => { if (flags.preview) app.quit(); }); // tray app: keep running

  app.whenReady().then(() => {
    log.init(path.join(app.getPath('userData'), 'logs'));
    log.info(`Lyrova ${app.getVersion()} starting (Electron ${process.versions.electron}, Windows ${process.getSystemVersion()})`);

    const { SettingsStore } = require('./settings-store');
    settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), log);
    t = i18n.translator(settings.get().language);

    // Song detection
    const { SmtcWatcher } = require('./media/smtc-watcher');
    media = new SmtcWatcher();
    media.on('state', (state) => {
      toPages('media', mediaForPages(state));
      lyrics.onMedia(state);
      if (tray) tray.update({ song: state.active ? state : null });
    });
    media.on('unavailable', () => log.warn('Windows media controls are not available on this system'));

    // Lyrics
    const { LrclibClient } = require('./lyrics/lrclib-client');
    const { LyricsService } = require('./lyrics/lyrics-service');
    lyrics = new LyricsService({
      client: new LrclibClient({
        fetch: (url, opts) => net.fetch(url, opts), // uses the Windows proxy settings
        userAgent: `Lyrova/${app.getVersion()} (https://github.com/EinfachChef/lyrova)`,
        log,
      }),
      cacheDir: path.join(app.getPath('userData'), 'lyrics-cache'),
      log,
    });
    lyrics.on('lyrics', (result) => toPages('lyrics', result));

    // Bass analysis
    const { AudioCapture } = require('./audio-capture');
    audio = new AudioCapture();

    if (flags.preview) {
      previewWin = createPreviewWindow();
    } else {
      startWallpaper();
    }

    settings.on('change', onSettingsChange);
    if (!process.env.LYROVA_NO_MEDIA) media.start(); // LYROVA_NO_MEDIA=1: no song detection (screenshots/tests)
    audio.start();
    applyAutostart();
    require('./updater').startUpdater({ enabled: settings.get().autoUpdate, onReady: onUpdateReady });
    if (flags.settings) openSettingsWindow();
    if (flags.quitAfter) setTimeout(() => app.quit(), flags.quitAfter);
    if (flags.snapshot) scheduleSnapshot();
    if (process.env.LYROVA_SELFTEST && tray) runSelfTest();
  });

  /** LYROVA_SELFTEST=1: runs the tray actions once and logs the resulting state (developer check). */
  function runSelfTest() {
    const state = () => `visible=${wallpapers.list().map((w) => w.win && w.win.isVisible()).join(',')} paused=${userPaused} mode=${wallpapers.mode()}`;
    const steps = [
      ['start', () => {}],
      ['hide', () => tray.actions.toggleVisible()],
      ['show', () => tray.actions.toggleVisible()],
      ['pause', () => tray.actions.togglePause()],
      ['resume', () => tray.actions.togglePause()],
    ];
    steps.forEach(([name, fn], i) => setTimeout(() => { fn(); setTimeout(() => log.info(`[selftest] ${name}: ${state()}`), 300); }, 4000 + i * 1200));
    setTimeout(() => tray.actions.quit(), 4000 + steps.length * 1200 + 800);
  }

  function startWallpaper() {
    const { WallpaperManager } = require('./wallpaper-manager');
    wallpapers = new WallpaperManager({ getSettings: () => settings.get(), icon: ICON, forceWindowMode: flags.window });
    wallpapers.sync();

    const { PerformanceMonitor } = require('./performance-monitor');
    monitor = new PerformanceMonitor({ ownHandles: () => wallpapers.handles() });
    monitor.on('covered', (set) => {
      covered = set;
      if (set.size) log.info(`Fullscreen app detected – pausing display(s) ${[...set].join(', ')}`);
      applyPause();
    });
    monitor.on('battery', (b) => {
      onBattery = b;
      log.info(b ? 'On battery – throttling' : 'On mains power');
      toPages('throttle', throttled());
    });
    monitor.start();

    const { AppTray } = require('./tray');
    tray = new AppTray({
      icon: ICON,
      t,
      actions: {
        toggleVisible: () => {
          wallpapers.setVisible(!wallpapers.visible);
          tray.update({ visible: wallpapers.visible });
          applyPause();
        },
        openSettings: () => openSettingsWindow(),
        togglePause: () => { userPaused = !userPaused; applyPause(); },
        quit: () => app.quit(),
      },
    });
  }

  function onSettingsChange(values, changed) {
    if (changed.includes('language')) {
      t = i18n.translator(values.language);
      const dict = i18n.dictionary(values.language);
      toPages('i18n', dict);
      toSettings('i18n', dict);
      if (tray) tray.setTranslator(t);
    }
    toPages('settings', settingsForPages());
    toSettings('settings', values);
    if (changed.includes('screens') && wallpapers) {
      wallpapers.sync();
      setTimeout(() => toSettings('status', statusForSettings()), 2500);
    }
    if (changed.includes('autostart')) applyAutostart();
    if (changed.includes('autoUpdate')) require('./updater').startUpdater({ enabled: values.autoUpdate, onReady: onUpdateReady });
    if (changed.includes('throttleOnBattery')) toPages('throttle', throttled());
    if (changed.includes('pauseOnFullscreen')) applyPause();
  }

  function onUpdateReady(version) {
    log.info(`Update ${version} downloaded – installs on quit`);
    if (tray) tray.notify('Lyrova', t('update.ready', { version }));
  }

  /** Start with Windows – only the installed app (in development it would register electron.exe). */
  function applyAutostart() {
    if (!app.isPackaged || process.env.LYROVA_USER_DATA) return;
    const want = settings.get().autostart;
    const opts = { name: 'Lyrova', path: process.execPath, args: ['--autostart'] };
    try {
      if (app.getLoginItemSettings(opts).openAtLogin !== want) {
        app.setLoginItemSettings({ ...opts, openAtLogin: want });
        log.info(`Autostart ${want ? 'enabled' : 'disabled'}`);
      }
    } catch (err) {
      log.warn('Autostart could not be changed:', err.message);
    }
  }

  function openSettingsWindow() {
    const w = require('./settings-window').openSettings({ icon: ICON, title: t('settings.title') });
    applyPause();
    w.once('closed', () => setTimeout(applyPause, 0));
    return w;
  }

  /** --preview: the wallpaper page in an ordinary window. */
  function createPreviewWindow() {
    const w = new BrowserWindow({
      width: 1280, height: 720, title: 'Lyrova – Preview', icon: ICON, backgroundColor: '#07060a',
      autoHideMenuBar: true, show: !flags.snapshot,
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'wallpaper.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    w.loadFile(path.join(__dirname, '..', 'renderer', 'wallpaper', 'index.html'), { query: { display: '', role: arg('role') || 'lyrics' } });
    if (flags.snapshot) w.once('ready-to-show', () => w.showInactive());
    return w;
  }

  function scheduleSnapshot() {
    const fs = require('fs');
    setTimeout(async () => {
      try {
        const target = (flags.settings && settingsUi()) || previewWin;
        if (target) {
          if (process.env.LYROVA_SNAPSHOT_JS) {
            const r = await target.webContents.executeJavaScript(process.env.LYROVA_SNAPSHOT_JS);
            if (r !== undefined) log.info('Snapshot JS:', r);
            await new Promise((res) => setTimeout(res, 500));
          }
          const img = await target.webContents.capturePage();
          fs.writeFileSync(path.resolve(flags.snapshot), img.toPNG());
          log.info('Snapshot saved:', flags.snapshot);
        }
      } catch (err) {
        log.error('Snapshot failed:', err);
      }
      app.quit();
    }, Number(process.env.LYROVA_SNAPSHOT_DELAY || 6000));
  }

  // Clean exit: remove our windows and let Windows redraw its own wallpaper
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    if (media) media.stop();
    if (audio) audio.stop();
    if (monitor) monitor.stop();
    if (wallpapers) wallpapers.destroy();
    if (tray) tray.destroy();
    log.info('Lyrova stopped');
  });
}
