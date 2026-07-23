Unicode true
!include "LogicLib.nsh"

!ifndef OUTPUT_PATH
  !error "OUTPUT_PATH is required."
!endif

!define PRODUCTNAME "Arizona"

Var DeleteAppDataCheckboxState
Var UpdateMode

!macro CheckIfAppIsRunning EXECUTABLE PRODUCT
!macroend

!include "..\nsis\hooks.nsh"

Name "Arizona NSIS hook compile test"
OutFile "${OUTPUT_PATH}"
RequestExecutionLevel admin

Section "Install"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd

Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL
SectionEnd
