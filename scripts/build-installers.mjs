import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { build, Platform, Arch } from 'electron-builder'
import nsis from 'app-builder-lib/out/targets/nsis/nsisUtil.js'
import { cp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { windowsAppIds } from '../examples/component-host/window-identity.mjs'
import { prepareProduct } from './prepare-package.mjs'
import { deliverInstallers } from './build-offline-setup.mjs'

// The pinned builder calls SetOutPath (which creates /D) before any customInit hook.
// Use a build-private copy of its stock template, including its separate uninstaller build.
const templates = path.resolve('.cache/fitbay-nsis')
await cp(nsis.nsisTemplatesDir, templates, { recursive: true })
const installer = path.join(templates, 'installer.nsi')
const template = await readFile(installer, 'utf8')
const earlyDestination =
  /(Function \.onInit\s+Call setInstallSectionSpaceRequired\s+)SetOutPath \$INSTDIR/
if (!earlyDestination.test(template)) throw Error('需要重新核对 NSIS 初始化和安装路径检查顺序')
await writeFile(installer, template.replace(earlyDestination, '$1SetOutPath $TEMP'))
// The assisted install-mode page recalculates INSTDIR after customInit. Supply the
// Music default inside the per-user calculation, before its explicit /D override.
const multiUser = path.join(templates, 'multiUser.nsh')
const modes = await readFile(multiUser, 'utf8')
// biome-ignore lint/suspicious/noTemplateCurlyInString: match the literal NSIS preprocessor expression.
const defaultPath = 'StrCpy $INSTDIR "$0\\${APP_FILENAME}"'
if (!modes.includes(defaultPath)) throw Error('需要重新核对 NSIS 当前用户默认安装路径')
await writeFile(
  multiUser,
  modes.replace(defaultPath, defaultPath + '\n      !insertmacro FitBayDefaultDir'),
)
const assisted = path.join(templates, 'assistedInstaller.nsh')
const pages = await readFile(assisted, 'utf8')
const normalize = /Function instFilesPre\s+\$\{StrContains\}[\s\S]*?FunctionEnd/
if (!normalize.test(pages)) throw Error('需要重新核对 NSIS 目录页校验时机')
await writeFile(
  assisted,
  pages
    .replace('!include StrContains.nsh', '')
    .replace(
      normalize,
      'Function instFilesPre\n      Call FitBayValidateDestination\n    FunctionEnd',
    ),
)
nsis.nsisTemplatesDir = templates

// Old FitBay uninstallers delete the desktop link by name, including on a manual
// upgrade. Let the new component installer check each link's target instead.
const installUtil = path.join(templates, 'include', 'installUtil.nsh')
const uninstallScript = await readFile(installUtil, 'utf8')
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal NSIS control flow.
const updateFlag = '  ${if} ${isDeleteAppData}'
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal NSIS control flow.
const previousDirLookup = '  ${if} $installationDir == ""'
const previousDirAt = uninstallScript.indexOf(previousDirLookup)
if (uninstallScript.split(updateFlag).length !== 2 || previousDirAt < 0) {
  throw Error('Unexpected old uninstaller lookup or flags')
}
// Guard the actual command snapshot used by the pinned builder, including after a registry change.
const checkedUninstaller =
  uninstallScript.slice(0, previousDirAt) +
  [
    '  StrCmp $installationDir $INSTDIR 0 fitbayInvalidOldUninstaller',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal NSIS filename definition.
    '  StrCmp $uninstallerFileName "$INSTDIR\\${UNINSTALL_FILENAME}" 0 fitbayInvalidOldUninstaller',
    '  Goto fitbayOldUninstallerVerified',
    '  fitbayInvalidOldUninstaller:',
    '  SetErrorLevel 2',
    '  Quit',
    '  fitbayOldUninstallerVerified:',
    '',
  ].join('\n') +
  uninstallScript.slice(previousDirAt)
await writeFile(
  installUtil,
  checkedUninstaller.replace(
    updateFlag,
    '  !ifdef DO_NOT_CREATE_DESKTOP_SHORTCUT\n    StrCpy $0 "$0 --keep-shortcuts"\n  !endif\n' +
      updateFlag,
  ),
)

// Compile owned paths into the uninstaller; there is no editable on-disk delete list.
async function writeInstallerInclude(output, appOutDir) {
  const quotePath = (value) => value.replaceAll('$', '$$$$')
  const lines = ['!macro customRemoveFiles', 'SetOutPath "$TEMP"']
  const checks = ['!macro FitBayCheckReinstallFiles']
  function checkVacantFile(target) {
    checks.push(
      `System::Call 'kernel32::GetFileAttributesW(w "${target}") i.r0'`,
      'IntCmp $0 -1 +2',
      'Goto invalidPath',
    )
  }
  let sequence = 0
  async function directory(relative) {
    const skip = `skipOwnedDirectory${sequence++}`
    const target = relative ? `$INSTDIR\\${quotePath(relative)}` : '$INSTDIR'
    if (relative) {
      checks.push(
        `System::Call 'kernel32::GetFileAttributesW(w "${target}") i.r0'`,
        'IntCmp $0 -1 +4',
        'IntOp $0 $0 & 0x410',
        'IntCmp $0 0x10 +2',
        'Goto invalidPath',
      )
    }
    lines.push(
      `System::Call 'kernel32::GetFileAttributesW(w "${target}") i.r0'`,
      'IntOp $0 $0 & 0x400',
      `IntCmp $0 0 0 ${skip} ${skip}`,
    )
    for (const entry of await readdir(path.join(appOutDir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) await directory(child)
      else {
        checkVacantFile(`$INSTDIR\\${quotePath(child)}`)
        lines.push(`Delete "$INSTDIR\\${quotePath(child)}"`)
      }
    }
    if (
      path.basename(path.dirname(output)) === 'workbench' &&
      relative === path.join('resources', 'app')
    ) {
      lines.push('Delete "$INSTDIR\\resources\\app\\music-offline-setup.exe"')
    }
    if (relative) lines.push(`RMDir "${target}"`)
    lines.push(`${skip}:`)
  }
  await directory('')
  const productName = path.basename(path.dirname(output))
  const executable =
    productName === 'workbench'
      ? 'FitBay'
      : 'FitBay ' + productName[0].toUpperCase() + productName.slice(1)
  checkVacantFile(`$INSTDIR\\Uninstall ${executable}.exe`)
  lines.push(
    `IfFileExists "$INSTDIR\\${executable}.exe" fitbayIncompleteRemoval`,
    'IfFileExists "$INSTDIR\\resources\\app\\package.json" fitbayIncompleteRemoval',
    '!insertmacro FitBaySuite Detach',
    `Delete "$INSTDIR\\\${UNINSTALL_FILENAME}"`,
    'RMDir "$INSTDIR"',
    'Goto fitbayRemovalDone',
    'fitbayIncompleteRemoval:',
    'SetErrorLevel 2',
    'Quit',
    'fitbayRemovalDone:',
    '!macroend',
    ...checks,
    '!macroend',
    `!define FITBAY_SUITE_SCRIPT "${quotePath(path.resolve('resources/fitbay-suite.ps1'))}"`,
    `!include "${quotePath(path.resolve('resources/fitbay-install.nsh'))}"`,
  )
  await writeFile(output, `\ufeff${lines.join('\r\n')}\r\n`)
}

const files = {}
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const optionalProduct = process.argv.includes('--toolkit')
  ? 'toolkit'
  : process.argv.includes('--prompts')
    ? 'prompts'
    : undefined
const products = {
  music: ['Music', 'FitBay Music', 'FitBay Music'],
  workbench: ['Workbench', 'FitBay', 'FitBay 工作台'],
  prompts: ['Prompts', 'FitBay Prompts', 'FitBay 文件库'],
  toolkit: ['Toolkit', 'FitBay Toolkit', 'FitBay 工具集'],
}
for (const product of optionalProduct ? [optionalProduct] : Object.keys(products)) {
  const { app, modules } = await prepareProduct(product)
  if (product === 'workbench') {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(files.music)) hash.update(chunk)
    await writeFile(path.join(app, 'music-setup.sha256'), hash.digest('hex'))
  }
  const [label, title, shortcut] = products[product]
  const filename = `FitBay-${label}-Setup-${version}-x64.exe`
  const output = path.resolve('.cache', 'fitbay-build', product)
  const include = path.join(output, 'fitbay-owned-files.nsh')
  await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    publish: 'never',
    config: {
      extends: path.resolve('electron-builder.yml'),
      appId: windowsAppIds[product],
      productName: title,
      publish: null,
      directories: { app, output },
      electronDist: path.resolve('node_modules/electron/dist'),
      asar: false,
      npmRebuild: true,
      // Skip builder's fallback to every production dependency of the workspace.
      // Only this product's locked runtime closure is copied in afterPack.
      ...(product === 'toolkit' && { onNodeModuleFile: () => false }),
      beforeBuild: async () => false,
      files: ['**/*'],
      afterPack: async ({ appOutDir }) => {
        await cp(modules, path.join(appOutDir, 'resources', 'app', 'node_modules'), {
          recursive: true,
        })
        await writeInstallerInclude(include, appOutDir)
      },
      win: {
        executableName: title,
        artifactName: filename,
        ...(product === 'toolkit' && { icon: path.resolve('components/toolkit/toolkit.ico') }),
      },
      nsis: {
        include,
        createDesktopShortcut: product === 'workbench',
        packElevateHelper: false,
        shortcutName: shortcut,
        uninstallDisplayName: shortcut,
      },
    },
  })
  files[product] = path.join(output, filename)
}
if (optionalProduct) console.log(files[optionalProduct])
else await deliverInstallers(files, version)
