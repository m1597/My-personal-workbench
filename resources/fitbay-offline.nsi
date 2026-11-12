Unicode true
RequestExecutionLevel user
Name "FitBay 离线安装"
InstallDir "$LOCALAPPDATA\Programs\FitBay"
InstallDirRegKey HKCU "Software\FitBay\Installations" "Workbench"
OutFile "${OUTPUT}"
Icon "app.ico"
SetCompress off
ShowInstDetails show
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define MUI_COMPONENTSPAGE_TEXT_TOP "请选择要安装的产品。下一步选择 FitBay 安装目录，勾选的 Music 会自动安装到其中的 Music 子目录。"
!define MUI_COMPONENTSPAGE_NODESC
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 FitBay 工作台的安装目录。以后单独补装 Music 时也会自动识别此位置。"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro InstallProduct id label destination
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ClearErrors
  File "/oname=${id}.exe" "${${id}}"
  IfErrors 0 +2
    Abort "无法解包${label}安装器。"
  ClearErrors
  ExecWait '"$PLUGINSDIR\${id}.exe" /currentuser /S /D=${destination}' $1
  ${If} ${Errors}
    SetErrorLevel 2
    Abort "无法启动${label}安装器。"
  ${EndIf}
  ${If} $1 != 0
    SetErrorLevel $1
    DetailPrint "${label}安装未完成（退出码 $1）。"
    MessageBox MB_OK|MB_ICONEXCLAMATION "${label}安装未完成，请检查所选目录是否有其他文件、目录链接或正在运行的程序。" /SD IDOK
    Abort
  ${EndIf}
!macroend

Section "FitBay 工作台（必选）"
  SectionIn RO
  !insertmacro InstallProduct WORKBENCH "工作台" "$INSTDIR"
SectionEnd

Section /o "FitBay Music" MusicSection
  !insertmacro InstallProduct MUSIC "Music" "$INSTDIR\Music"
SectionEnd

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/WITHMUSIC" $1
  ${IfNot} ${Errors}
    !insertmacro SelectSection ${MusicSection}
  ${EndIf}
FunctionEnd
