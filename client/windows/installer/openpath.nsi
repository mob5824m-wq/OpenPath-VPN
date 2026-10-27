; OpenPath VPN Windows NSIS Installer
; TLS obfuscation: installs WinTun adapter + GUI + CLI (openpath.exe)
!define APPNAME "OpenPath VPN"
!define APPVERSION "1.0.0"
!define COMPANY "OpenPath"
Name "${APPNAME}"
OutFile "OpenPath-Setup-${APPVERSION}.exe"
InstallDir "$PROGRAMFILES64\OpenPath VPN"
RequestExecutionLevel admin

Section "Install"
  SetOutPath $INSTDIR
  File /r "..\..\desktop\dist-installer\win-unpacked\*"
  File "wintun.dll"
  CreateShortCut "$DESKTOP\OpenPath VPN.lnk" "$INSTDIR\OpenPath VPN.exe"
  CreateShortCut "$SMPROGRAMS\OpenPath VPN.lnk" "$INSTDIR\OpenPath VPN.exe"
  ; Add to PATH for CLI: openpath.exe
  EnVar::SetHKLM
  EnVar::AddValue "Path" "$INSTDIR\resources\cli"
  ; TAP adapter setup (invoked on first run with admin)
  ExecWait '"$INSTDIR\resources\openpath-tun.exe" --install-tun'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPath" "DisplayName" "${APPNAME}"
SectionEnd

Section "Uninstall"
  ExecWait '"$INSTDIR\resources\openpath-tun.exe" --remove-tun'
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\OpenPath VPN.lnk"
SectionEnd
; Build: makensis client/windows/installer/openpath.nsi
; Or: cd client/desktop && npx electron-builder --win nsis
