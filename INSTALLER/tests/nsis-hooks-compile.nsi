Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"

!ifndef OUTPUT_PATH
  !error "OUTPUT_PATH is required."
!endif

!define PRODUCTNAME "Arizona"

!macro CheckIfAppIsRunning EXECUTABLE PRODUCT
!macroend

!include "..\nsis\hooks.nsh"

; Tauri declares these after installerHooks is included.
Var DeleteAppDataCheckboxState
Var UpdateMode
Var ReinstallPageCheck

Name "Arizona NSIS hook compile test"
OutFile "${OUTPUT_PATH}"
RequestExecutionLevel admin

Section "Install"
  !insertmacro ARIZONA_NSIS_HOOK_AFTER_RESOURCES
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd

Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL
SectionEnd
