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
  await directory('')
  lines.push('!macroend', `!include "${quotePath(path.resolve('resources/fitbay-install.nsh'))}"`)
  await writeFile(output, `\ufeff${lines.join('\r\n')}\r\n`)
}

const files = []
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
for (const product of ['workbench', 'music']) {
  const music = product === 'music'
  const { app, modules } = await prepareProduct(product)
  const title = music ? 'FitBay Music' : 'FitBay'
  const shortcut = music ? title : 'FitBay 工作台'
  const filename = `FitBay-${music ? 'Music' : 'Workbench'}-Setup-${version}-x64.exe`
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
  files.push(path.join(output, filename))
}
await deliverInstallers(files[0], files[1], version)
