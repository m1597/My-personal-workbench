import { build } from 'vite'
import { cp, mkdir, writeFile } from 'node:fs/promises'
const root = 'dist/component-prototype'
for (const name of ['host', 'component', 'workbench'])
  await mkdir(`${root}/${name}`, { recursive: true })
await cp('examples/component-host', `${root}/host`, { recursive: true })
await cp('src/renderer/public/fitbay.png', `${root}/host/fitbay.png`)
await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: `${root}/component`,
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
      entry: 'examples/sample-component/component.tsx',
      formats: ['es'],
      fileName: () => 'component.js',
      cssFileName: 'component',
    },
  },
})
for (const file of ['index.html', 'component.json'])
  await cp(`examples/sample-component/${file}`, `${root}/component/${file}`)
await cp('out/renderer', `${root}/workbench`, { recursive: true })
await writeFile(
  `${root}/host/package.json`,
  JSON.stringify(
    { name: 'component-host-prototype', version: '0.1.0', type: 'module', main: 'main.mjs' },
    null,
    2,
  ),
)
console.log(
  '独立部署目录：dist/component-prototype/{host,component,workbench}；宿主使用项目已安装的 Electron，不是自包含安装包。',
)
