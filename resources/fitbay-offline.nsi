Unicode true
RequestExecutionLevel user
Name "FitBay 离线安装"
OutFile "${OUTPUT}"
Icon "app.ico"
SetCompress off
ShowInstDetails show
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define MUI_COMPONENTSPAGE_TEXT_TOP "请选择要安装的产品。下一步将依次打开所选产品的安装向导，可分别选择安装目录。"
!define MUI_COMPONENTSPAGE_NODESC
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro InstallProduct id label
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ClearErrors
  File "/oname=${id}.exe" "${${id}}"
  IfErrors 0 +2
    Abort "无法解包${label}安装器。"
  StrCpy $0 ""
  ${If} ${Silent}
    StrCpy $0 "/S"
  ${EndIf}
  ClearErrors
  ExecWait '"$PLUGINSDIR\${id}.exe" /currentuser $0' $1
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "无法启动${label}安装器。"
  ${EndIf}
  ${If} $1 != 0
    SetErrorLevel $1
    Abort "${label}安装未完成（退出码 $1）。"
  ${EndIf}
!macroend

Section "FitBay 工作台（必选）"
  SectionIn RO
  !insertmacro InstallProduct WORKBENCH "工作台"
SectionEnd

Section /o "FitBay Music" MusicSection
  !insertmacro InstallProduct MUSIC "Music"
SectionEnd

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/WITHMUSIC" $1
  ${IfNot} ${Errors}
    !insertmacro SelectSection ${MusicSection}
  ${EndIf}
FunctionEnd
