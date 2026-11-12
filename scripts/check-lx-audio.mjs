import { app } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { verifyAudio } from '../examples/component-host/lx-audio-check.mjs'
app.commandLine.appendSwitch('mute-audio')
void app.whenReady().then(async () => {
  app.on('window-all-closed', () => {})
  try {
    const root = app.getPath('userData')
    const valid = path.resolve('tests/fixtures/local-music/tone.mp3')
    await verifyAudio(valid, new AbortController().signal)
    const truncated = (await fs.readFile('tests/fixtures/local-music/tone.flac')).subarray(0, 42)
    truncated[4] |= 128
    const bad = path.join(root, 'empty.flac')
    await fs.writeFile(bad, truncated)
    await assert.rejects(verifyAudio(bad, new AbortController().signal))
    console.log('PASS 原生解码及仅含元数据的 FLAC 拒绝入库')
    const { publishToLibrary } = await import('../dist/component-prototype/host/lx-music.mjs')
    const { MusicStore } = await import('../components/music/store.mjs')
    const store = new MusicStore(path.join(root, 'db'))
    const temp = path.join(root, 'recording.part'),
      file = path.join(root, 'recording.mp3')
    await fs.copyFile(valid, temp)
    const row = { file, title: '测试', artist: '未知艺人', album: '', duration: 4 }
    store.db.exec(
      "CREATE TRIGGER refuse BEFORE INSERT ON local_tracks BEGIN SELECT RAISE(ABORT,'storage failed'); END",
    )
    assert.throws(() => publishToLibrary(temp, row, store))
    await assert.rejects(fs.stat(file), { code: 'ENOENT' })
    assert.equal(store.library.list().length, 0)
    store.db.exec('DROP TRIGGER refuse')
    await fs.writeFile(file, '保留已有文件')
    assert.throws(() => publishToLibrary(temp, row, store))
    assert.equal(await fs.readFile(file, 'utf8'), '保留已有文件')
    assert.equal(store.library.list().length, 0)
    await fs.unlink(file)
    publishToLibrary(temp, row, store)
    assert.equal(store.library.list().length, 1)
    store.db.close()
    console.log('PASS 存储失败回滚、同名保护和重试')
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
