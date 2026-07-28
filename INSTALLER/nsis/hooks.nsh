!define ARIZONA_EXE "arizona-app.exe"
!define ARIZONA_PS "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
; Tauri resource targets are relative to $INSTDIR. The mappings in
; tauri.conf.json therefore produce $INSTDIR\installer\{payload,scripts}.
!define ARIZONA_INSTALLER_ROOT "$INSTDIR\installer"
!define ARIZONA_PAYLOAD_ROOT "$INSTDIR\installer\payload"
!define ARIZONA_SCRIPT_ROOT "$INSTDIR\installer\scripts"
!define ARIZONA_STATE_PATH "$INSTDIR\installer\installed-assets.json"
; Version 2.0.0 used Tauri's default currentUser install mode. Its exact
; identity and location must be migrated before the perMachine installer
; writes the new copy under Program Files.
!define ARIZONA_LEGACY_PRODUCT_NAME "arizona-app"
!define ARIZONA_LEGACY_PUBLISHER "pc"
!define ARIZONA_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\arizona-app"
!define ARIZONA_LEGACY_MANUFACTURER_KEY "Software\pc\arizona-app"

!macro NSIS_HOOK_PREINSTALL
  SetRegView 64
  ReadRegStr $R8 HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}" "DisplayName"
  ReadRegStr $R9 HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}" "Publisher"

  ${If} $R8 == "${ARIZONA_LEGACY_PRODUCT_NAME}"
  ${AndIf} $R9 == "${ARIZONA_LEGACY_PUBLISHER}"
    ReadRegStr $R6 HKCU "${ARIZONA_LEGACY_MANUFACTURER_KEY}" ""

    ; Only migrate the exact default path used by the 2.0.0 currentUser
    ; installer. Never execute an arbitrary uninstaller from the registry.
    ${If} $R6 != "$LOCALAPPDATA\${ARIZONA_LEGACY_PRODUCT_NAME}"
      MessageBox MB_ICONSTOP|MB_OK "Arizona found the 2.0.0 user installation, but its path is not the expected safe location. Remove the old version manually and run this installer again." /SD IDOK
      SetErrorLevel 2
      Abort "Arizona stopped before installing a second copy."
    ${EndIf}

    ${IfNot} ${FileExists} "$R6\uninstall.exe"
      MessageBox MB_ICONSTOP|MB_OK "Arizona found the 2.0.0 user installation, but its uninstaller is missing. Remove the old version manually and run this installer again." /SD IDOK
      SetErrorLevel 2
      Abort "Arizona stopped before installing a second copy."
    ${EndIf}

    !insertmacro CheckIfAppIsRunning "${ARIZONA_EXE}" "${ARIZONA_LEGACY_PRODUCT_NAME}"

    DetailPrint "Replacing the Arizona 2.0.0 current-user installation..."
    nsExec::ExecToStack /TIMEOUT=120000 '"$R6\uninstall.exe" /S /UPDATE _?=$R6'
    Pop $R7
    Pop $R5

    ${If} $R7 != 0
      MessageBox MB_ICONSTOP|MB_OK "Arizona could not remove the installed 2.0.0 version (exit $R7). Close Arizona, remove the old version manually and run this installer again." /SD IDOK
      SetErrorLevel 2
      Abort "Arizona stopped before installing a second copy."
    ${EndIf}

    ${If} ${FileExists} "$R6\${ARIZONA_EXE}"
      MessageBox MB_ICONSTOP|MB_OK "Arizona 2.0.0 is still present after its uninstaller completed. Remove the old version manually and run this installer again." /SD IDOK
      SetErrorLevel 2
      Abort "Arizona stopped before installing a second copy."
    ${EndIf}

    ; The old uninstaller runs in update mode to preserve the authenticated
    ; app data. Finish the cross-scope migration by removing only its exact
    ; registration and shortcuts.
    DeleteRegKey HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}"
    DeleteRegKey HKCU "${ARIZONA_LEGACY_MANUFACTURER_KEY}"
    DeleteRegKey /ifempty HKCU "Software\pc"

    ReadRegStr $R5 HKCU "Software\Classes\arizona\shell\open\command" ""
    ${If} $R5 == '"$R6\${ARIZONA_EXE}" "%1"'
      DeleteRegKey HKCU "Software\Classes\arizona"
    ${EndIf}

    ReadRegStr $R5 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${ARIZONA_LEGACY_PRODUCT_NAME}"
    ${If} $R5 == '"$R6\${ARIZONA_EXE}"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${ARIZONA_LEGACY_PRODUCT_NAME}"
    ${EndIf}

    SetShellVarContext current
    Delete "$SMPROGRAMS\${ARIZONA_LEGACY_PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\Arizona\${ARIZONA_LEGACY_PRODUCT_NAME}.lnk"
    RMDir "$SMPROGRAMS\Arizona"
    Delete "$DESKTOP\${ARIZONA_LEGACY_PRODUCT_NAME}.lnk"
    SetShellVarContext all
    RMDir "$R6"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
arizona_install_adobe_retry:
  DetailPrint "Installing and validating the Arizona CEP extension..."
  nsExec::ExecToStack /TIMEOUT=120000 '"${ARIZONA_PS}" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ARIZONA_SCRIPT_ROOT}\install-adobe-assets.ps1" -InstallDir "$INSTDIR" -StatePath "${ARIZONA_STATE_PATH}" -PayloadRoot "${ARIZONA_PAYLOAD_ROOT}"'
  Pop $0
  Pop $1

  ${If} $0 = 20
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "Close After Effects, then choose Retry. Arizona found an old AEX plugin that must be removed during this upgrade." /SD IDCANCEL IDRETRY arizona_install_adobe_retry
    Goto arizona_install_adobe_abort
  ${ElseIf} $0 != 0
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "Arizona could not install or validate its CEP extension. Choose Retry, or Cancel to stop this installation. See the Arizona Installer log for details." /SD IDCANCEL IDRETRY arizona_install_adobe_retry
    Goto arizona_install_adobe_abort
  ${EndIf}
  Goto arizona_install_adobe_done

arizona_install_adobe_abort:
  SetErrorLevel 2
  Abort "Arizona installation stopped before completing its CEP extension."

arizona_install_adobe_done:
  ; Remove the retired deep-link left by older Arizona installers, but only
  ; when it still points to this installation.
  SetRegView 64
  ReadRegStr $2 HKLM "Software\Classes\arizona\shell\open\command" ""
  ${If} $2 == '"$INSTDIR\${ARIZONA_EXE}" "%1"'
    DeleteRegKey HKLM "Software\Classes\arizona"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's hook runs before its built-in process check. Check here as well so
  ; cancelling because Arizona is open cannot happen after Adobe assets moved.
  !insertmacro CheckIfAppIsRunning "${ARIZONA_EXE}" "${PRODUCTNAME}"

arizona_uninstall_preflight_retry:
  DetailPrint "Checking whether Arizona CEP and legacy assets can be removed..."
  nsExec::ExecToStack /TIMEOUT=120000 '"${ARIZONA_PS}" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ARIZONA_SCRIPT_ROOT}\uninstall-adobe-assets.ps1" -InstallDir "$INSTDIR" -StatePath "${ARIZONA_STATE_PATH}" -PreflightOnly'
  Pop $R5
  Pop $R6

  ${If} $R5 = 20
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "Close After Effects, then choose Retry. An old Arizona AEX plugin must be removed before uninstall can continue." /SD IDCANCEL IDRETRY arizona_uninstall_preflight_retry
    Goto arizona_uninstall_adobe_abort
  ${ElseIf} $R5 != 0
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "Arizona could not validate Adobe asset removal. Choose Retry, or Cancel to keep the app installed." /SD IDCANCEL IDRETRY arizona_uninstall_preflight_retry
    Goto arizona_uninstall_adobe_abort
  ${EndIf}

  StrCpy $R0 ""
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    StrCpy $R0 "-RemoveUserData"
  ${EndIf}

  ${If} $UpdateMode <> 1
    DetailPrint "Releasing the Arizona device and active sessions..."
    nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\${ARIZONA_EXE}" --release-device-for-uninstall'
    Pop $R3
    Pop $R7
    ${If} $R3 = 0
      DetailPrint "Arizona device released."
    ${ElseIf} $R3 = 21
      DetailPrint "No secure Arizona session was present; continuing uninstall."
    ${Else}
      ; Device release is best effort. A network or backend failure must never
      ; leave the desktop app, CEP extension, or local credentials installed.
      DetailPrint "Online device release was unavailable (exit $R3); continuing local uninstall."
    ${EndIf}

    DetailPrint "Removing the Arizona session from Windows Credential Manager..."
    nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\${ARIZONA_EXE}" --clear-local-auth-for-uninstall'
    Pop $R4
    Pop $R7
    ${If} $R4 != 0
      ; Keep uninstall non-blocking even if Credential Manager is temporarily
      ; unavailable. Reinstall/login can safely replace a stale credential.
      DetailPrint "Secure session cleanup returned exit $R4; continuing uninstall."
    ${EndIf}
  ${EndIf}

arizona_uninstall_adobe_retry:
  DetailPrint "Removing and validating Arizona CEP and legacy assets..."
  nsExec::ExecToStack /TIMEOUT=120000 '"${ARIZONA_PS}" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ARIZONA_SCRIPT_ROOT}\uninstall-adobe-assets.ps1" -InstallDir "$INSTDIR" -StatePath "${ARIZONA_STATE_PATH}" $R0'
  Pop $R1
  Pop $R6

  ${If} $R1 = 20
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "Close After Effects, then choose Retry. Uninstall will not leave an old Arizona AEX plugin behind." /SD IDCANCEL IDRETRY arizona_uninstall_adobe_retry
    Goto arizona_uninstall_adobe_abort
  ${ElseIf} $R1 != 0
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "Arizona could not completely remove its Adobe assets. Choose Retry, or Cancel to keep the app installed and inspect the Arizona Installer log." /SD IDCANCEL IDRETRY arizona_uninstall_adobe_retry
    Goto arizona_uninstall_adobe_abort
  ${EndIf}

  SetRegView 64
  ReadRegStr $R2 HKLM "Software\Classes\arizona\shell\open\command" ""
  ${If} $R2 == '"$INSTDIR\${ARIZONA_EXE}" "%1"'
    DeleteRegKey HKLM "Software\Classes\arizona"
  ${EndIf}
  Goto arizona_uninstall_adobe_done

arizona_uninstall_adobe_abort:
  SetErrorLevel 2
  Abort "Arizona uninstall stopped before removing the desktop app."

arizona_uninstall_adobe_done:
!macroend
