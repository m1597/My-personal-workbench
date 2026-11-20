import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { build, Platform, Arch } from 'electron-builder'
import nsis from 'app-builder-lib/out/targets/nsis/nsisUtil.js'
import { cp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

// Compile owned paths into the uninstaller; there is no editable on-disk delete list.
async function writeInstallerInclude(output, appOutDir) {
  const quotePath = (value) => value.replaceAll('$', '$$$$')
  const lines = ['!macro customRemoveFiles', 'SetOutPath "$TEMP"']
  let sequence = 0
  async function directory(relative) {
    const skip = `skipOwnedDirectory${sequence++}`
    const target = relative ? `$INSTDIR\\${quotePath(relative)}` : '$INSTDIR'
    lines.push(
      `System::Call 'kernel32::GetFileAttributesW(w "${target}") i.r0'`,
      'IntOp $0 $0 & 0x400',
      `IntCmp $0 0 0 ${skip} ${skip}`,
    )
    for (const entry of await readdir(path.join(appOutDir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) await directory(child)
      else lines.push(`Delete "$INSTDIR\\${quotePath(child)}"`)
    }
    if (!relative) lines.push(`Delete "$INSTDIR\\\${UNINSTALL_FILENAME}"`)
    lines.push(`RMDir "${target}"`, `${skip}:`)
  }
  if (path.basename(path.dirname(output)) === 'workbench') {
    lines.push('Delete "$INSTDIR\\resources\\app\\music-offline-setup.exe"')
  }
  await directory('')
  lines.push('!macroend', `!include "${quotePath(path.resolve('resources/fitbay-install.nsh'))}"`)
  await writeFile(output, `\ufeff${lines.join('\r\n')}\r\n`)
}

const files = {}
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const promptsOnly = process.argv.includes('--prompts')
for (const product of promptsOnly ? ['prompts'] : ['music', 'workbench']) {
  const music = product === 'music'
  const { app, modules } = await prepareProduct(product)
  if (product === 'workbench') {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(files.music)) hash.update(chunk)
    await writeFile(path.join(app, 'music-setup.sha256'), hash.digest('hex'))
  }
  const title = promptsOnly ? 'FitBay Prompts' : music ? 'FitBay Music' : 'FitBay'
  const shortcut = promptsOnly ? 'FitBay 提示词仓库' : music ? title : 'FitBay 工作台'
  const filename = `FitBay-${promptsOnly ? 'Prompts' : music ? 'Music' : 'Workbench'}-Setup-${version}-x64.exe`
  const output = path.resolve('.cache', 'fitbay-build', product)
  const include = path.join(output, 'fitbay-owned-files.nsh')
  await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    publish: 'never',
    config: {
      extends: path.resolve('electron-builder.yml'),
      appId: `io.github.m1597.fitbay.${product}`,
      productName: title,
      publish: null,
      directories: { app, output },
      electronDist: path.resolve('node_modules/electron/dist'),
      asar: false,
      npmRebuild: true,
      // Skip builder's fallback to every production dependency of the workspace.
      // Only this product's locked runtime closure is copied in afterPack.
      beforeBuild: async () => false,
      files: ['**/*'],
      afterPack: async ({ appOutDir }) => {
        await cp(modules, path.join(appOutDir, 'resources', 'app', 'node_modules'), {
          recursive: true,
        })
        await writeInstallerInclude(include, appOutDir)
      },
      win: { executableName: title, artifactName: filename },
      nsis: {
        include,
        packElevateHelper: false,
        shortcutName: shortcut,
        uninstallDisplayName: shortcut,
      },
    },
  })
  files[product] = path.join(output, filename)
}
if (promptsOnly) console.log(files.prompts)
else await deliverInstallers(files.workbench, files.music, version)
