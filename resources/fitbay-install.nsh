!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Win\COM.nsh"

!if "${APP_ID}" == "io.github.m1597.fitbay.toolkit"
  !define FITBAY_SLOT "Toolkit"
!else if "${APP_ID}" == "io.github.m1597.fitbay.music"
  !define FITBAY_SLOT "Music"
!else if "${APP_ID}" == "io.github.m1597.fitbay.prompts"
  !define FITBAY_SLOT "Prompts"
!else
  !define FITBAY_SLOT "Workbench"
!endif
!define /ifndef FITBAY_REG "Software\FitBay\Installations"

!define /ifndef FITBAY_HISTORY "Software\FitBay\PreviousInstallations"

!macro FitBayDefaultDir
  !ifndef BUILD_UNINSTALLER
    !if "${FITBAY_SLOT}" != "Workbench"
      SetRegView 64
      ReadRegStr $0 HKCU "${FITBAY_REG}" "Workbench"
      ${If} $0 != ""
        StrCpy $INSTDIR "$0\${FITBAY_SLOT}"
      ${EndIf}
      ReadRegStr $0 HKCU "${FITBAY_HISTORY}" "${FITBAY_SLOT}"
      ${If} $0 != ""
      ${AndIf} ${FileExists} "$0\."
        StrCpy $INSTDIR "$0"
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

  ; Allow only the registered, named direct children when (re)installing Workbench.
  !macro FitBayCheckPeer peer allowed
    !if "${FITBAY_SLOT}" != "${peer}"
      ReadRegStr $1 HKCU "${FITBAY_REG}" "${peer}"
      !if "${FITBAY_SLOT}" == "Workbench"
        ${If} $1 == ""
          ReadRegStr $0 HKCU "${FITBAY_HISTORY}" "${peer}"
          ${If} $0 == "$2\${peer}"
            System::Call 'kernel32::GetFileAttributesW(w r0) i.r0'
            IntOp $0 $0 & 0x410
            ${If} $0 = 16
              StrCpy ${allowed} "${peer}"
            ${EndIf}
          ${EndIf}
        ${EndIf}
      !endif
      ${If} $1 != ""
        System::Call 'kernel32::GetFullPathNameW(w "$1\.", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
        ${If} $0 == 0
        ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
          Goto invalidPath
        ${EndIf}
        !if "${FITBAY_SLOT}" == "Workbench"
          ${If} "$2\${peer}" == "$1"
            StrCpy ${allowed} "${peer}"
          ${Else}
            !insertmacro rejectOverlap "$1"
          ${EndIf}
        !else if "${peer}" == "Workbench"
          ${If} "$1\${FITBAY_SLOT}" != "$2"
            !insertmacro rejectOverlap "$1"
          ${EndIf}
        !else
          !insertmacro rejectOverlap "$1"
        !endif
      ${EndIf}
    !endif
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
    StrCpy $4 ""
    StrCpy $5 ""
    StrCpy $6 ""
    !insertmacro FitBayCheckPeer "Workbench" $4
    !insertmacro FitBayCheckPeer "Music" $4
    !insertmacro FitBayCheckPeer "Prompts" $5
    !insertmacro FitBayCheckPeer "Toolkit" $6
    ReadRegStr $1 HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
    ${If} $1 != ""
      System::Call 'kernel32::GetFullPathNameW(w "$1\.", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
      StrCmp $1 $2 validPath
      !insertmacro rejectOverlap "$1"
    ${EndIf}

    !if "${FITBAY_SLOT}" != "Workbench"
      ReadRegStr $1 HKCU "${FITBAY_HISTORY}" "${FITBAY_SLOT}"
      ${If} $1 == $INSTDIR
        !insertmacro FitBayCheckReinstallFiles
        Goto validPath
      ${EndIf}
    !endif

    ; Use FindFirst so that hidden files and empty subdirectories count as contents too.
    FindFirst $0 $1 "$2\*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
      ${AndIf} $1 != $4
      ${AndIf} $1 != $5
      ${AndIf} $1 != $6
        FindClose $0
        Goto invalidPath
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
    validPath:
      Return
    invalidPath:
      MessageBox MB_OK|MB_ICONEXCLAMATION "首次安装请选择空目录。工作台下只允许已登记的 Music、Prompts、Toolkit 组件子目录，安装位置不能与用户数据重叠或经过目录链接。" /SD IDOK
      SetErrorLevel 2
      Quit
  FunctionEnd

  !macro customInit
    !insertmacro FitBayCurrentUserOnly
    !if "${FITBAY_SLOT}" != "Workbench"
      Var /GLOBAL fitbayPreviousDirectory
      SetRegView 64
      ReadRegStr $fitbayPreviousDirectory HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
    !endif
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
  !if "${FITBAY_SLOT}" != "Workbench"
    ${If} $fitbayPreviousDirectory != ""
      FindFirst $6 $7 "$DESKTOP\*.lnk"
      ${DoWhile} $7 != ""
        !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
        ${If} $0 P<> 0
          ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
          ${If} $1 P<> 0
            ${IPersistFile::Load} $1 '("$DESKTOP\$7",0).r2'
            ${If} $2 = 0
              ${IShellLink::GetPath} $0 '(.r3,${NSIS_MAX_STRLEN},0,4).r2'
              ${If} $2 = 0
              ${AndIf} $3 == "$fitbayPreviousDirectory\${APP_EXECUTABLE_FILENAME}"
                Delete "$DESKTOP\$7"
              ${EndIf}
            ${EndIf}
            ${IUnknown::Release} $1 ""
          ${EndIf}
          ${IUnknown::Release} $0 ""
        ${EndIf}
        FindNext $6 $7
      ${Loop}
      FindClose $6
    ${EndIf}
  !endif
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
      !if "${FITBAY_SLOT}" != "Workbench"
        WriteRegStr HKCU "${FITBAY_HISTORY}" "${FITBAY_SLOT}" "$1"
      !endif
      DeleteRegValue HKCU "${FITBAY_REG}" "${FITBAY_SLOT}"
    ${EndIf}
  ${EndIf}
!macroend
