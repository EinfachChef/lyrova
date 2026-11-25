// Tray icon (next to the clock) with: now playing, Show/Hide, Settings, Pause/Resume, Quit.

const { Tray, Menu, nativeImage } = require('electron');

class AppTray {
  /**
   * @param {{ icon: string, t: Function, actions: { toggleVisible, openSettings, togglePause, quit } }} opts
   */
  constructor({ icon, t, actions }) {
    this.t = t;
    this.actions = actions;
    this.state = { visible: true, paused: false, song: null };
    this.tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
    this.tray.on('double-click', () => actions.openSettings());
    this.rebuild();
  }

  setTranslator(t) {
    this.t = t;
    this.rebuild();
  }

  update(patch) {
    Object.assign(this.state, patch);
    this.rebuild();
  }

  rebuild() {
    if (this.tray.isDestroyed()) return;
    const { t, actions, state } = this;
    const title = state.song ? `${state.song.title}${state.song.artist ? ' – ' + state.song.artist : ''}` : '';
    this.tray.setToolTip(title ? `Lyrova · ${title}`.slice(0, 127) : t('tray.tooltip'));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: title ? t('tray.nowPlaying', { title }).slice(0, 80) : t('tray.nothingPlaying'), enabled: false },
      { type: 'separator' },
      { label: state.visible ? t('tray.hide') : t('tray.show'), click: actions.toggleVisible },
      { label: state.paused ? t('tray.resume') : t('tray.pause'), click: actions.togglePause },
      { label: t('tray.settings'), click: actions.openSettings },
      { type: 'separator' },
      { label: t('tray.quit'), click: actions.quit },
    ]));
  }

  notify(title, content) {
    try { this.tray.displayBalloon({ title, content, iconType: 'info' }); } catch { /* not supported */ }
  }

  destroy() {
    this.tray.destroy();
  }
}

module.exports = { AppTray };
