; Extra installer steps (electron-builder / NSIS).
; Uninstall: remove the autostart entry so Windows does not try to launch a deleted app.
; (The app itself adds/removes the entry according to the "Start with Windows" setting.)

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lyrova"
!macroend
