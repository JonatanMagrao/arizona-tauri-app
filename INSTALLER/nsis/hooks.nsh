!define ARIZONA_PROTOCOL "arizona"
!define ARIZONA_EXE "arizona-app.exe"
!define ARIZONA_PS "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
!define ARIZONA_INSTALLER_ROOT "$INSTDIR\resources\installer"
!define ARIZONA_PAYLOAD_ROOT "$INSTDIR\resources\installer\payload"
!define ARIZONA_SCRIPT_ROOT "$INSTDIR\resources\installer\scripts"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Arizona Windows integrations..."
  SetRegView 64
  WriteRegStr HKLM "Software\Classes\${ARIZONA_PROTOCOL}" "" "URL:Arizona Protocol"
  WriteRegStr HKLM "Software\Classes\${ARIZONA_PROTOCOL}" "URL Protocol" ""
  WriteRegStr HKLM "Software\Classes\${ARIZONA_PROTOCOL}\DefaultIcon" "" "$INSTDIR\${ARIZONA_EXE},0"
  WriteRegStr HKLM "Software\Classes\${ARIZONA_PROTOCOL}\shell\open\command" "" '"$INSTDIR\${ARIZONA_EXE}" "%1"'

  DetailPrint "Installing Arizona Adobe assets..."
  ExecWait '"${ARIZONA_PS}" -NoProfile -ExecutionPolicy Bypass -File "${ARIZONA_SCRIPT_ROOT}\install-adobe-assets.ps1" -InstallDir "$INSTDIR" -PayloadRoot "${ARIZONA_PAYLOAD_ROOT}"' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Arizona App was installed, but Adobe assets could not be installed. Close After Effects and run the installer again, or check the installer log."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Arizona Windows integrations..."
  SetRegView 64
  DeleteRegKey HKLM "Software\Classes\${ARIZONA_PROTOCOL}"

  StrCpy $R0 ""
  MessageBox MB_YESNO "Remove Arizona user data, session, logs and settings from this Windows user?" IDNO +2
  StrCpy $R0 "-RemoveUserData"

  DetailPrint "Removing Arizona Adobe assets..."
  ExecWait '"${ARIZONA_PS}" -NoProfile -ExecutionPolicy Bypass -File "${ARIZONA_SCRIPT_ROOT}\uninstall-adobe-assets.ps1" -InstallDir "$INSTDIR" $R0' $R1
  ${If} $R1 != 0
    MessageBox MB_ICONEXCLAMATION "Adobe assets could not be fully removed. Close After Effects and run uninstall again, or check the installer log."
  ${EndIf}
!macroend
