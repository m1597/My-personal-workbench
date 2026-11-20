!include "LogicLib.nsh"
!include "FileFunc.nsh"

!if "${APP_ID}" == "io.github.m1597.fitbay.toolkit"
  !define FITBAY_SLOT "Toolkit"
  !define FITBAY_PEER "Music"
!else if "${APP_ID}" == "io.github.m1597.fitbay.music"
  !define FITBAY_SLOT "Music"
  !define FITBAY_PEER "Workbench"
!else if "${APP_ID}" == "io.github.m1597.fitbay.prompts"
  !define FITBAY_SLOT "Prompts"
  !define FITBAY_PEER "Music"
!else
  !define FITBAY_SLOT "Workbench"
  !define FITBAY_PEER "Music"
!endif
!define /ifndef FITBAY_REG "Software\FitBay\Installations"

!macro FitBayDefaultDir
  !ifndef BUILD_UNINSTALLER
    !if "${FITBAY_SLOT}" == "Music"
      SetRegView 64
      ReadRegStr $0 HKCU "${FITBAY_REG}" "Workbench"
      ${If} $0 != ""
        StrCpy $INSTDIR "$0\Music"
      ${EndIf}
    !endif
  !endif
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall 1
!macroend

!macro FitBayCurrentUserOnly
  ${If} ${isForAllUsers}
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $hasPerMachineInstallation 0
  StrCpy $hasPerUserInstallation 1
  !insertmacro setInstallModePerUser
!macroend

!macro customUnInit
  !insertmacro FitBayCurrentUserOnly
!macroend

!ifndef BUILD_UNINSTALLER
  ; Both arguments are canonical absolute paths. PathIsPrefix compares full components.
  !macro rejectOverlap other
    System::Call 'kernel32::GetFullPathNameW(w "${other}\.", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
    System::Call 'shlwapi::PathIsPrefixW(w r1, w r2) i.r0'
    ${If} $0 == 0
      System::Call 'shlwapi::PathIsPrefixW(w r2, w r1) i.r0'
    ${EndIf}
    ${If} $0 != 0
      Goto invalidPath
    ${EndIf}
  !macroend

  Function FitBayValidateDestination
    System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR\.", i ${NSIS_MAX_STRLEN}, w .r2, p 0) i.r0'
    ${If} $0 == 0
    ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
      Goto invalidPath
    ${EndIf}
    StrCpy $INSTDIR "$2"
    StrCpy $1 "$2"
    checkAncestor:
      System::Call 'kernel32::GetFileAttributesW(w r1) i.r0'
      ${If} $0 != -1
        IntOp $0 $0 & 0x400  ; FILE_ATTRIBUTE_REPARSE_POINT
        ${If} $0 != 0
          Goto invalidPath
        ${EndIf}
      ${EndIf}
      ${GetParent} "$1" $3
      ${If} $3 != ""
      ${AndIf} $3 != $1
        StrCpy $1 "$3"
        Goto checkAncestor
      ${EndIf}

    !insertmacro rejectOverlap "$APPDATA\FitBay\desktop-profile"
    SetRegView 64
    ReadRegStr $1 HKCU "Software\bd06d8eb-cf95-5823-8fa2-7461a7d20057" "InstallLocation"
    ${If} $1 != ""
      !insertmacro rejectOverlap "$1"
    ${EndIf}
    ReadRegStr $1 HKLM "Software\bd06d8eb-cf95-5823-8fa2-7461a7d20057" "InstallLocation"
    ${If} $1 != ""
      !insertmacro rejectOverlap "$1"
    ${EndIf}
    !if "${FITBAY_SLOT}" == "Prompts"
      ReadRegStr $1 HKCU "${FITBAY_REG}" "Workbench"
    !else
      ReadRegStr $1 HKCU "${FITBAY_REG}" "Prompts"
    !endif
    ${If} $1 != ""
      !insertmacro rejectOverlap "$1"
    ${EndIf}
    !if "${FITBAY_SLOT}" == "Toolkit"
      ReadRegStr $1 HKCU "${FITBAY_REG}" "Workbench"
    !else
      ReadRegStr $1 HKCU "${FITBAY_REG}" "Toolkit"
    !endif
    ${If} $1 != ""
      !insertmacro rejectOverlap "$1"
    ${EndIf}
    ReadRegStr $1 HKCU "${FITBAY_REG}" "${FITBAY_PEER}"
    StrCpy $4 ""
    ${If} $1 != ""
      System::Call 'kernel32::GetFullPathNameW(w "$1\.", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
      ${If} $0 == 0
      ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
        Goto invalidPath
      ${EndIf}
      !if "${FITBAY_SLOT}" == "Music"
        StrCmp "$1\Music" "$2" peerChecked
      !else if "${FITBAY_SLOT}" == "Workbench"
        ${If} "$2\Music" == "$1"
          StrCpy $4 "Music"
          Goto peerChecked
        ${EndIf}
      !endif
      !insertmacro rejectOverlap "$1"
    ${EndIf}
    !if "${FITBAY_SLOT}" == "Music"
    peerChecked:
    !else if "${FITBAY_SLOT}" == "Workbench"
    peerChecked:
    !endif
    ReadRegStr $1 HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
    ${If} $1 != ""
      System::Call 'kernel32::GetFullPathNameW(w "$1\.", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
      StrCmp $1 $2 validPath
      !insertmacro rejectOverlap "$1"
    ${EndIf}

    ; Use FindFirst so that hidden files and empty subdirectories count as contents too.
    FindFirst $0 $1 "$2\*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
      ${AndIf} $1 != $4
        FindClose $0
        Goto invalidPath
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
    validPath:
      Return
    invalidPath:
      MessageBox MB_OK|MB_ICONEXCLAMATION "首次安装请选择空目录。工作台下只允许已登记的 Music 子目录，安装位置不能与用户数据重叠或经过目录链接。" /SD IDOK
      SetErrorLevel 2
      Quit
  FunctionEnd

  !macro customInit
    !insertmacro FitBayCurrentUserOnly
    ; Hold the handle until this installer exits so two products cannot claim one empty folder.
    System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\FitBaySplitInstaller") p.r1 ?e'
    Pop $0
    ${If} $1 == 0
    ${OrIf} $0 == 183
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${If} ${Silent}
      Call FitBayValidateDestination
    ${EndIf}
  !macroend

!endif

!macro customInstall
  SetRegView 64
  WriteRegStr HKCU "${FITBAY_REG}" "${FITBAY_SLOT}" "$INSTDIR"
!macroend

!macro customUnInstall
  SetRegView 64
  ReadRegStr $0 HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
  ${If} $0 != ""
    GetFullPathName $0 "$0\."
    GetFullPathName $1 "$INSTDIR\."
    ${If} $0 == $1
      DeleteRegValue HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
    ${EndIf}
  ${EndIf}
!macroend
