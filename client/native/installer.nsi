; Native Qt Widgets installer. Builds per-user and does not embed a browser.
Unicode true
RequestExecutionLevel user
Name "OpenPath VPN"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\OpenPath"
InstallDirRegKey HKCU "Software\OpenPath" "InstallDir"
ShowInstDetails show
ShowUninstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "OpenPath VPN" SEC01
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*"
  CreateDirectory "$SMPROGRAMS\OpenPath"
  CreateShortCut "$SMPROGRAMS\OpenPath\OpenPath VPN.lnk" "$INSTDIR\OpenPath.exe"
  WriteRegStr HKCU "Software\OpenPath" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN" "DisplayName" "OpenPath VPN"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  MessageBox MB_OK|MB_ICONINFORMATION "Disconnect the device VPN before uninstalling. Your saved profile remains in the system keychain until removed in the app." /SD IDOK
  Delete "$SMPROGRAMS\OpenPath\OpenPath VPN.lnk"
  RMDir "$SMPROGRAMS\OpenPath"
  Delete "$INSTDIR\OpenPath.exe"
  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenPathVPN"
  DeleteRegKey HKCU "Software\OpenPath"
SectionEnd
