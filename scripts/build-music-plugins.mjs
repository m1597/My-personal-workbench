import { build } from 'vite'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const titles = {
  wave: ['波形与片段试听', '查看波形、循环试听选段，给时间点添加标记。'],
  tags: ['歌曲标签与封面整理', '对照原资料和建议，选择要写入的曲目与字段。'],
  rules: ['智能歌单', '按来源、入库时间和收听次数组合规则，自动更新歌单。'],
}
const sha = (data) => createHash('sha256').update(data).digest('hex')
const shared = {
  react: 'FitBayReact',
  'react/jsx-runtime': 'FitBayJSX',
  'react-dom': 'FitBayReactDOM',
  '@fluentui/react-components': 'FitBayFluent',
}
export async function buildMusicPlugins(root) {
  const dest = path.join(root, 'plugin-packs')
  await mkdir(dest, { recursive: true })
  const catalog = []
  for (const [id, [title, description]] of Object.entries(titles)) {
    const files = {}
    const [ui] = await build({
      configFile: false,
      logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        write: false,
        lib: {
          entry: `components/music/plugins/${id}/index.tsx`,
          name: 'FitBayPlugin_' + id,
          formats: ['iife'],
        },
        rolldownOptions: {
          external: Object.keys(shared),
          output: { globals: shared, exports: 'default' },
        },
      },
    })
    for (const item of ui.output) {
      if (item.type === 'chunk') files['panel.js'] = item.code
      else if (item.fileName.endsWith('.css')) files['panel.css'] = item.source.toString()
    }
    files['panel.css'] ??= ''
    const host = await build({
      configFile: false,
      logLevel: 'error',
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'component-host-music',
          resolveId(source, importer) {
            if (source.startsWith('../music/') && importer?.includes('component-host/plugins/'))
              return path.resolve('components/music', source.slice('../music/'.length))
          },
        },
      ],
      build: {
        ssr: `examples/component-host/plugins/${id}.mjs`,
        write: false,
        rolldownOptions: { output: { format: 'es', codeSplitting: false } },
      },
    })
    const output = Array.isArray(host) ? host[0].output : host.output
    files['host.mjs'] = output.find((x) => x.type === 'chunk').code
    if (id === 'tags') {
      const { buildTagsRuntime } = await import('./build-tags-runtime.mjs')
      files['tags-engine.mjs'] = await buildTagsRuntime()
    }
    const data = Buffer.from(JSON.stringify({ id, format: 1, files }))
    await writeFile(path.join(dest, id + '.fitbayplugin'), data)
    catalog.push({
      id,
      title,
      description,
      bytes: data.length,
      digest: sha(data),
      files: Object.fromEntries(Object.entries(files).map(([key, data]) => [key, sha(data)])),
    })
  }
  await writeFile(path.join(root, 'host', 'plugin-catalog.json'), JSON.stringify(catalog))
}
