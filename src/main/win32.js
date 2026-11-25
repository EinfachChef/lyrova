// Native Windows calls via koffi (prebuilt, nothing is compiled).
//
// The "WorkerW trick" puts our window behind the desktop icons:
//   1. Send Progman the undocumented message 0x052C – Windows then creates a WorkerW layer
//      that sits between the icons and the wallpaper.
//   2. Re-parent our window into that layer.
// Two desktop layouts exist:
//   classic (Windows 10, older 11): the icons (SHELLDLL_DefView) live in a top-level WorkerW;
//            the *next* WorkerW is the wallpaper layer → SetParent(our window, that WorkerW).
//   raised  (Windows 11 24H2+): DefView and WorkerW are children of Progman → our window becomes a
//            child of Progman, placed between DefView and WorkerW, and must be a layered window.

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const RECT = koffi.struct('LYROVA_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('LYROVA_POINT', { x: 'long', y: 'long' });
const POWER = koffi.struct('LYROVA_POWER', {
  ACLineStatus: 'uint8', BatteryFlag: 'uint8', BatteryLifePercent: 'uint8',
  SystemStatusFlag: 'uint8', BatteryLifeTime: 'uint32', BatteryFullLifeTime: 'uint32',
});
const EnumProc = koffi.proto('bool __stdcall LyrovaEnumProc(intptr hwnd, intptr lParam)');

const FindWindowW = user32.func('intptr __stdcall FindWindowW(const char16_t *cls, const char16_t *title)');
const FindWindowExW = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, const char16_t *cls, const char16_t *title)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(LyrovaEnumProc *cb, intptr lParam)');
const SendMessageTimeoutW = user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint32 msg, uintptr wp, intptr lp, uint32 flags, uint32 timeout, _Out_ uintptr *result)');
const SetParent = user32.func('intptr __stdcall SetParent(intptr child, intptr parent)');
const GetParent = user32.func('intptr __stdcall GetParent(intptr hwnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr hwnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)');
const SetLayeredWindowAttributes = user32.func('bool __stdcall SetLayeredWindowAttributes(intptr hwnd, uint32 key, uint8 alpha, uint32 flags)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ LYROVA_RECT *rect)');
const GetClientRect = user32.func('bool __stdcall GetClientRect(intptr hwnd, _Out_ LYROVA_RECT *rect)');
const ClientToScreen = user32.func('bool __stdcall ClientToScreen(intptr hwnd, _Inout_ LYROVA_POINT *pt)');
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16_t *buf, int max)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, void *pv, uint32 winIni)');
const GetSystemPowerStatus = kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ LYROVA_POWER *status)');
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)');

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_FRAME = 0x00c00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000; // caption, sizing border, menus, min/max
const WS_EX_FRAME = 0x00000100 | 0x00000200 | 0x00000001;
const WS_EX_LAYERED = 0x00080000;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40;
const HWND_BOTTOM = 1;

/** Electron gives the native handle as a Buffer; koffi wants a number. */
function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function className(hwnd) {
  const buf = new Uint16Array(256);
  const n = GetClassNameW(hwnd, buf, 256);
  return String.fromCharCode(...buf.slice(0, Math.max(0, n)));
}

/** Finds where the wallpaper window has to go. */
function findDesktopTarget() {
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;
  // Ask Explorer to create the WorkerW layer (both variants of the message are in use)
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, [0]);
  SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, [0]);

  const defView = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  const innerWorker = FindWindowExW(progman, 0, 'WorkerW', null);
  if (defView && innerWorker) return { mode: 'raised', parent: progman, defView, workerW: innerWorker };

  let workerW = 0;
  EnumWindows((hwnd) => {
    if (FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) workerW = FindWindowExW(0, hwnd, 'WorkerW', null);
    return true;
  }, 0);
  return workerW ? { mode: 'classic', parent: workerW, workerW } : null;
}

/**
 * Turns `hwnd` into the desktop wallpaper for the screen area `rect` (physical pixels).
 * Returns the target info, or null if the trick is not possible.
 */
function attachToDesktop(hwnd, rect) {
  const target = findDesktopTarget();
  if (!target) return null;

  // Borderless child window (frame bits would otherwise reserve an invisible ~8 px border)
  const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;
  SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & ~WS_POPUP & ~WS_FRAME) | WS_CHILD) >>> 0);
  let ex = (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0) & ~WS_EX_FRAME;
  if (target.mode === 'raised') ex |= WS_EX_LAYERED; // Progman is GPU-composited: children must be layered
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex >>> 0);
  if (target.mode === 'raised') SetLayeredWindowAttributes(hwnd, 0, 255, 0x2);

  SetParent(hwnd, target.parent);

  // Child coordinates are relative to the parent, which spans the whole virtual screen
  const parentRect = {};
  GetWindowRect(target.parent, parentRect);
  const x = rect.x - parentRect.left;
  const y = rect.y - parentRect.top;
  const flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED;
  if (target.mode === 'raised') {
    SetWindowPos(hwnd, target.defView, x, y, rect.width, rect.height, flags); // just below the icons
    keepWorkerWBelow(target); // every WorkerW layer (0x052C may have created a new one) goes to the bottom
  } else {
    SetWindowPos(hwnd, 0, x, y, rect.width, rect.height, flags);
  }

  // Chromium may keep an invisible border inside borderless windows – measure and compensate it
  const client = {};
  const origin = { x: 0, y: 0 };
  GetClientRect(hwnd, client);
  ClientToScreen(hwnd, origin);
  const l = origin.x - rect.x;
  const t = origin.y - rect.y;
  const r = rect.width - l - client.right;
  const b = rect.height - t - client.bottom;
  if (l || t || r || b) {
    SetWindowPos(hwnd, 0, x - l, y - t, rect.width + l + r, rect.height + t + b, SWP_NOZORDER | SWP_NOACTIVATE);
  }
  return { ...target, inset: { l, t, r, b } };
}

/**
 * Raised layout: Explorer sometimes creates a fresh WorkerW layer above existing wallpaper windows
 * (e.g. when another program sends 0x052C). Push every WorkerW inside Progman back to the bottom.
 */
function keepWorkerWBelow(target) {
  if (!target || target.mode !== 'raised' || !IsWindow(target.parent)) return;
  let w = FindWindowExW(target.parent, 0, 'WorkerW', null);
  while (w) {
    SetWindowPos(w, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    w = FindWindowExW(target.parent, w, 'WorkerW', null);
  }
}

/** Still correctly attached? (Not after an Explorer restart, for example.) */
function isAttached(hwnd, target) {
  return !!target && IsWindow(target.parent) && IsWindow(hwnd) && Number(GetParent(hwnd)) === target.parent;
}

/** Fallback mode: keep a normal window at the very bottom of the z-order. */
function sendToBottom(hwnd) {
  SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

/** Makes Windows redraw its own wallpaper (after our window is gone) by re-applying the current one. */
function redrawWindowsWallpaper() {
  const buf = Buffer.alloc(1040);
  SystemParametersInfoW(0x0073 /* SPI_GETDESKWALLPAPER */, 520, buf, 0);
  let end = 0;
  while (end < buf.length - 1 && (buf[end] || buf[end + 1])) end += 2;
  const current = buf.toString('utf16le', 0, end);
  SystemParametersInfoW(0x0014 /* SPI_SETDESKWALLPAPER */, 0, Buffer.from(current + '\0', 'utf16le'), 0x2);
}

const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'TopLevelWindowForOverflowXamlIsland']);

/** The foreground window and its rectangle (physical pixels), or null for the desktop/shell. */
function foregroundWindow() {
  const hwnd = Number(GetForegroundWindow());
  if (!hwnd || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return null;
  const cls = className(hwnd);
  if (SHELL_CLASSES.has(cls)) return null;
  const cloaked = [0];
  if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, cloaked, 4) === 0 && cloaked[0]) return null;
  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return null;
  return { hwnd, cls, rect };
}

/** true while the PC runs on battery (laptop unplugged). */
function onBattery() {
  const s = {};
  return GetSystemPowerStatus(s) ? s.ACLineStatus === 0 : false;
}

module.exports = { hwndOf, attachToDesktop, isAttached, keepWorkerWBelow, sendToBottom, redrawWindowsWallpaper, foregroundWindow, onBattery };
