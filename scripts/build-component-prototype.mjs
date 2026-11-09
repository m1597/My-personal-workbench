import { cp, mkdir, writeFile } from 'node:fs/promises'
const root = 'dist/component-prototype'
for (const name of ['host', 'component', 'workbench'])
  await mkdir(`${root}/${name}`, { recursive: true })
await cp('examples/component-host', `${root}/host`, { recursive: true })
await cp('examples/sample-component', `${root}/component`, { recursive: true })
await cp('src/renderer/src/styles/tokens.css', `${root}/component/tokens.css`)
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
