; An update reuses the shortcuts the first install made, so Explorer keeps
; drawing them, and the taskbar button, from the icon it cached back then.
; After the logo changed, that meant the old icon lingered until a reboot.
; Telling the shell its icons are stale makes it read the new ones now.
!macro NSIS_HOOK_POSTINSTALL
  ; SHCNE_UPDATEITEM on the exe and each shortcut that points at it
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x0005, w "$INSTDIR\${MAINBINARYNAME}.exe", p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x0005, w "$SMPROGRAMS\${PRODUCTNAME}.lnk", p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x0005, w "$DESKTOP\${PRODUCTNAME}.lnk", p 0)'
  ; SHCNE_ASSOCCHANGED, flushed: drops the shell's cached icon images
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
