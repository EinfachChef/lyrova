# Lyrova

**Time-synced lyrics as your animated Windows desktop wallpaper.**

Lyrova sits behind your desktop icons and shows the lyrics of whatever you're playing — Spotify,
YouTube in the browser, Apple Music, anything that shows up in the Windows media controls — line by
line, in time with the music. The active line glows and pulses with the bass of your system audio.

![Lyrova on the desktop](docs/screenshot.png)

| Clock screen | Settings |
|---|---|
| ![Clock screen](docs/screenshot-clock.png) | ![Settings](docs/screenshot-settings.png) |

## Features

- **Real wallpaper** – runs behind the desktop icons (WorkerW technique via `koffi`, supports the
  classic Windows 10 desktop and the newer Windows 11 24H2+ layout). Falls back to a borderless
  fullscreen window if that isn't possible.
- **Multiple monitors** – choose per display: lyrics, a clock screen, background only, or off.
- **Automatic song detection** – title, artist, album, position and play/pause from the Windows
  media controls (SMTC). No login, no API keys.
- **Synced lyrics from [LRCLIB](https://lrclib.net)** – exact lookup by title/artist/album/duration
  with a search fallback, cleaned-up titles (no “(Official Video)” or “feat.” noise), local cache.
  Unsynced lyrics scroll gently; a subtle hint appears when nothing is found or you're offline.
- **Seven lyrics styles** – Column (active line big and glowing, neighbours dimmed and blurred),
  Scattered, Karaoke, One word, Pixel words, Typewriter and Neon. Font, size, colors and position
  are configurable.
- **Clock screen** – e.g. for a second display: seven clock styles (modern, glass, flip, analog,
  word clock, pixel, neon), date, greeting, your own text and a glass song card with the current
  lyrics line and its own background.
- **Bass-reactive effects** – glow, pulse, beat particles, a glowing screen edge and a subtle
  screen shake, each with its own strength slider (0 % = off), driven by your system audio
  (`getDisplayMedia` loopback + `AnalyserNode`). Nothing is recorded or sent anywhere.
- **Backgrounds** – animated color waves, particles or a starry sky, your own image or video, or
  the current album cover as a blurred backdrop.
- **Tray menu** – show/hide, pause/resume, settings, quit.
- **Settings window** – dark glass design in the logo colors, German UI (English included; translations live in one file
  per language).
- **Light on resources** – pauses while a fullscreen game, video or maximized window covers the
  screen, throttles on battery, configurable frame rate.
- **Start with Windows** (optional), single instance, automatic updates via GitHub Releases
  (can be turned off).

## Installation

1. Download `Lyrova-Setup.exe` from the [latest release](https://github.com/EinfachChef/lyrova/releases/latest).
2. Run it. No administrator rights are needed; you can pick the install folder.
3. Windows SmartScreen may warn because the app is not code-signed: click
   **More info → Run anyway**.

Lyrova starts right away. Double-click the tray icon (next to the clock) to open the settings.

**Uninstall:** Windows Settings → Apps → Installed apps → Lyrova → Uninstall.
Your settings stay in `%APPDATA%\Lyrova` unless you delete that folder.

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

## Privacy & copyright

Lyrova contains no lyrics. They are fetched at runtime from LRCLIB and only displayed on your own
screen. Song titles are sent to LRCLIB to look up the lyrics; nothing else leaves your PC. Lyrics
are copyrighted by their respective owners.

## License

[MIT](LICENSE) © 2026 Georg

The bundled font *Pixelify Sans* (used by the pixel styles) is licensed under the SIL Open Font
License 1.1 – see `src/renderer/fonts/PixelifySans-OFL.txt`.
