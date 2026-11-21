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

!define MUI_COMPONENTSPAGE_TEXT_TOP "请选择要安装的产品。下一步选择 FitBay 安装目录，首次安装的组件将放入对应子目录。"
!define MUI_COMPONENTSPAGE_NODESC
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 FitBay 工作台的安装目录。已安装的组件将沿用原位置升级。"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro InstallProduct id label arguments
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  ClearErrors
  File "/oname=${id}.exe" "${${id}}"
  IfErrors 0 +2
    Abort "无法解包${label}安装器。"
  ClearErrors
  ExecWait '"$PLUGINSDIR\${id}.exe" /currentuser /S ${arguments}' $1
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
  !insertmacro InstallProduct WORKBENCH "工作台" "/D=$INSTDIR"
  ; Keep the verified standalone installer for a later offline addition.
  SetOutPath "$INSTDIR\resources\app"
  File "/oname=music-offline-setup.exe" "${MUSIC}"
SectionEnd

Section /o "FitBay Music" MusicSection
  !insertmacro InstallProduct MUSIC "Music" ""
SectionEnd

Section /o "提示词仓库（文件库）" PromptsSection
  !insertmacro InstallProduct PROMPTS "提示词仓库" ""
SectionEnd

Section /o "工具集" ToolkitSection
  !insertmacro InstallProduct TOOLKIT "工具集" ""
SectionEnd

!macro SelectRequested flag section
  ClearErrors
  ${GetOptions} $0 "/WITH${flag}" $1
  ${IfNot} ${Errors}
    !insertmacro SelectSection ${section}
  ${EndIf}
!macroend

Function .onInit
  ${GetParameters} $0
  !insertmacro SelectRequested MUSIC ${MusicSection}
  !insertmacro SelectRequested PROMPTS ${PromptsSection}
  !insertmacro SelectRequested TOOLKIT ${ToolkitSection}
FunctionEnd
