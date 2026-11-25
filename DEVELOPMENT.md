# Developing Lyrova

Everything you need to build, test and release Lyrova yourself.
For using the app, see the [README](README.md).

## Building from source

Requirements: Windows 10/11 and [Node.js](https://nodejs.org) 20+. No C++ build tools, no Rust –
every dependency ships prebuilt.

```powershell
npm.cmd install
npm.cmd start            # run Lyrova as wallpaper
npm.cmd test             # unit tests
npm.cmd run dist         # build dist\Lyrova-Setup.exe
```

(`npm.cmd` instead of `npm` avoids PowerShell's script execution policy blocking `npm.ps1`.)

Useful options while developing:

| Option | Effect |
|---|---|
| `npm.cmd start -- --preview` | the wallpaper page in a normal window |
| `npm.cmd start -- --window` | force the fallback window mode |
| `npm.cmd start -- --settings` | open the settings on start |
| `LYROVA_USER_DATA=<dir>` | use a separate data folder (doesn't touch your real settings) |
| `LYROVA_SELFTEST=1` | exercise the tray actions and quit (results in the log) |

## Releases & auto-update

Push a tag such as `v1.0.1`. The GitHub workflow (`.github/workflows/release.yml`) builds the
installer on `windows-latest` and attaches `Lyrova-Setup.exe` to a GitHub release. Installed copies
find the update automatically (unless “Check for updates automatically” is turned off) and install
it on the next restart.

The repository is set to `EinfachChef/lyrova` in `package.json`. If you fork or rename it, update
`repository`, `homepage` and `build.publish` there – the workflow always publishes to the repository
it runs in.

## Project structure

```
assets/                 icon.png, icon.ico
build/installer.nsh     removes the autostart entry on uninstall
src/
  main/                 main process
    index.js            app lifecycle, IPC, wiring
    wallpaper-manager.js one wallpaper window per display, watchdog, fallback
    win32.js            native calls via koffi (WorkerW, foreground window, battery)
    media/              song detection (PowerShell + WinRT SMTC)
    lyrics/             LRCLIB client, title clean-up, lookup + cache
    audio-capture.js    hidden window for system-audio bass analysis
    performance-monitor.js, tray.js, settings-window.js, updater.js, …
  preload/              the only bridges between pages and the main process
  renderer/
    wallpaper/          lyrics view, backgrounds, effects
    settings/           settings window
    audio/              bass analysis page
    common/             LRC parser, bass detector (shared with the tests)
  shared/               settings schema, translations (i18n/de.json, i18n/en.json)
test/                   node --test unit tests
```

Data folder: `%APPDATA%\Lyrova` (`settings.json`, `logs\lyrova.log`, `lyrics-cache\`, `media\`).
