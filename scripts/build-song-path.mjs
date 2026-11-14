import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildMusicPlugins } from './build-music-plugins.mjs'

export async function buildSongPath(root) {
  const dest = path.join(root, 'plugin-packs')
  await mkdir(dest, { recursive: true })
  const stage = await mkdtemp(path.join(root, '.song-path-'))
  try {
    await mkdir(path.join(stage, 'host'))
    const [entry] = await buildMusicPlugins(stage, {
      path: ['歌曲过渡', '选择起点和终点，按本地录音的响度、明亮度和动态生成播放队列。'],
    })
    await cp(
      path.join(stage, 'plugin-packs/path.fitbayplugin'),
      path.join(dest, 'path.fitbayplugin'),
    )
    return entry
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dest = path.resolve(process.argv[2] || 'dist/song-path-offline')
  console.log(await buildSongPath(dest), path.join(dest, 'plugin-packs/path.fitbayplugin'))
}
