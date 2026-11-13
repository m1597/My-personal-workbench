import { build } from 'vite'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
const root = 'dist/component-prototype'
for (const name of ['host', 'component', 'workbench'])
  await mkdir(`${root}/${name}`, { recursive: true })
await cp('examples/component-host', `${root}/host`, {
  recursive: true,
  filter: (file) => !/(?:^|[\\/])(?:plugins|music-plugins\.mjs)$/.test(file),
})
await cp('src/renderer/public/fitbay.png', `${root}/host/fitbay.png`)
await mkdir(`${root}/host/music`, { recursive: true })
for (const f of [
  'offline-source.mjs',
  'store.mjs',
  'local-files.mjs',
  'albums.mjs',
  'library-worker.mjs',
  'local-library.mjs',
])
  await cp('components/music/' + f, `${root}/host/music/${f}`)
for (const [source, output] of [
  ['examples/sample-component', 'component'],
  ['components/music', 'music'],
]) {
  await build({
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: `${root}/${output}`,
      emptyOutDir: true,
      rolldownOptions: {
        onwarn(warning, warn) {
          // This is a client-only Electron view; React server directives have no role here.
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client'))
            return
          warn(warning)
        },
      },
      lib: {
        entry: `${source}/component.tsx`,
        formats: ['es'],
        fileName: () => 'component.js',
        cssFileName: 'component',
      },
    },
  })
  for (const file of ['index.html', 'component.json'])
    await cp(`${source}/${file}`, `${root}/${output}/${file}`)
  if (output === 'music') await cp(`${source}/default-cover.png`, `${root}/music/default-cover.png`)
}
await cp('out/renderer', `${root}/workbench`, { recursive: true })
// Discard only the previous release's generated plugin artifacts.
for (const file of [
  'host/music-plugins.mjs',
  'host/plugin-catalog.json',
  'plugin-packs/wave.fitbayplugin',
  'plugin-packs/tags.fitbayplugin',
  'plugin-packs/rules.fitbayplugin',
])
  await rm(`${root}/${file}`, { force: true })
await writeFile(
  `${root}/host/package.json`,
  JSON.stringify(
    { name: 'component-host-prototype', version: '0.1.0', type: 'module', main: 'main.mjs' },
    null,
    2,
  ),
)
console.log(
  '独立部署目录：dist/component-prototype/{host,component,music,workbench}；宿主使用项目已安装的 Electron，不是自包含安装包。',
)
