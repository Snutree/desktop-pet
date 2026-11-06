; Custom NSIS uninstall tweak for LingX
; The default electron-builder uninstaller removes files but can leave an empty
; install directory behind. Remove it when empty (RMDir without /r only removes
; empty directories, so unrelated user files are never touched).
!macro customUnInstall
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
!macroend
