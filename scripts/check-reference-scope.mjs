import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { MusicTaste } from '../examples/component-host/music-taste.mjs'
import { catalogKeyword, requestMusicModel } from '../dist/component-prototype/host/music-model.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/reference-scope-'))
const store = new MusicStore(root)
let key = randomUUID()
const calls = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  assert.equal(req.url, '/chat/completions')
  assert.equal(req.headers.authorization, 'Bearer ' + key)
  const payload = JSON.parse(JSON.parse(Buffer.concat(chunks)).messages.at(-1).content)
  calls.push(payload)
  const content = JSON.stringify(
    payload.kind
      ? { keyword: '日语歌' }
      : payload.scope
        ? {
            songs: [
              {
                title: 'English Title',
                artist: '试验甲',
                reason: '夹具日语演唱',
                vocalLanguage: 'ja',
              },
              { title: '英文演唱', artist: '试验乙', reason: '夹具英语演唱', vocalLanguage: 'en' },
              { title: '未知', artist: '试验丙', reason: '语种不明', vocalLanguage: 'und' },
            ],
          }
        : { profile: '测试摘要第' + calls.length + '段' },
  )
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content } }] }))
})
server.listen(0, '127.0.0.1')
try {
  await once(server, 'listening')
  store.connections = {
    resolve: () => ({
      endpoint: 'http://127.0.0.1:' + server.address().port,
      protocol: 'chat',
      key,
      model: 'fixture',
    }),
  }
  const taste = new MusicTaste(store, root, (data, signal) =>
    requestMusicModel(store, null, 'profile', data, signal),
  )
  const local = store.db.prepare(
    'INSERT INTO local_tracks(id,file,title,artist,album,duration,favorite) VALUES(?,?,?, ?,?,?,?)',
  )
  local.run('local-a', path.join(root, 'PRIVATE-FOLDER', '1.mp3'), '同标签', '艺人', '专辑', 1, 1)
  local.run('local-b', path.join(root, 'PRIVATE-FOLDER', '2.mp3'), '同标签', '艺人', '专辑', 5, 0)
  local.run(
    'local-private',
    path.join(root, 'PRIVATE-FOLDER', '3.mp3'),
    '拒绝外传',
    'https://private.invalid',
    '专辑',
    5,
    0,
  )
  store.db.exec("UPDATE local_tracks SET importedOrigin='daily' WHERE id='local-b'")
  const online = store.db.prepare('INSERT INTO online_tracks VALUES(?,?,?,?,?)')
  for (const [id, title] of [
    ['online-copy', '在线别名'],
    ['online-only', '另一首'],
  ]) {
    online.run(id, title, '在线艺人', '', 3)
    store.db
      .prepare('INSERT INTO online_recording_sources VALUES(?,?,?,?,?,?,?)')
      .run(id, 'fixture', 'wy', id, '320k', '{}', '{"catalogScope":"fixture"}')
  }
  store.db
    .prepare(
      'INSERT INTO recording_copies(version,local,automatic,platform,sourceId,artScope) VALUES(?,?,?,?,?,?)',
    )
    .run('v', 'local-a', 0, 'wy', 'online-copy', 'fixture')
  const playlist = store.library.createPlaylist('日语歌', ['online-copy', 'online-only'], true)
  const folder = store.library.list()[0].folder.id
  const empty = { folders: [], playlists: [], favorites: false }
  const all = { folders: [folder], playlists: [playlist], favorites: true }
  assert.equal(taste.references(all).summary.count, 3)
  assert.equal(taste.references(empty).summary.count, 0)
  assert.equal(taste.references({ ...empty, folders: [folder, folder] }).summary.count, 2)
  assert.throws(() => taste.references({ ...all, folders: 'wrong' }), /参考范围/)
  const only = { ...empty, playlists: [playlist] }
  const signal = new AbortController().signal
  const groups = (selection) => taste.references(selection).groups
  const profile = (selection) => taste.referenceProfile(groups(selection), signal)
  const keyword = (desc, selection, weight) =>
    catalogKeyword(store, null, taste, 'publicLists', desc, selection, signal, weight)
  assert.deepEqual(
    taste
      .references(only)
      .tracks.map((row) => row.title)
      .sort(),
    ['在线别名', '另一首'].sort(),
  )
  assert.equal(await profile(only), '')
  assert.equal(calls.length, 0)
  taste.consent(true)
  const japanese = await profile(only)
  assert.equal(JSON.parse(japanese)[0].name, '日语歌')
  assert.equal(calls[0].collection.name, '日语歌')
  assert(!/PRIVATE|fixture|online-|local-|同标签|拒绝外传/.test(JSON.stringify(calls[0])))
  assert.equal(await profile(empty), '')
  assert.equal(await profile(only), japanese)
  for (const scope of ['direct', 'related']) {
    const result = await requestMusicModel(
      store,
      null,
      'recommend',
      { scope, preference: '我喜欢的音乐', profile: japanese },
      signal,
    )
    assert.equal(calls.at(-1).requiredVocalLanguage, 'ja')
    assert.deepEqual(
      result.songs.map((row) => row.title),
      ['English Title'],
    )
  }
  await requestMusicModel(
    store,
    null,
    'recommend',
    { scope: 'direct', preference: '我这次想听英文歌', profile: japanese },
    signal,
  )
  assert.equal(calls.at(-1).requiredVocalLanguage, 'en')
  const begin = calls.length
  const mixed = JSON.parse(await profile(all))
  assert.deepEqual(
    mixed.map((group) => group.uniqueRecordings),
    [2, 1, 0],
  )
  assert.equal(calls.slice(begin).flatMap((call) => call.changes).length, 3)
  const beforeCache = calls.length
  assert.equal(await profile(only), japanese)
  assert.equal(calls.length, beforeCache)
  await assert.rejects(taste.referenceProfile(groups(only), AbortSignal.abort()), /aborted/i)
  taste.setExcluded('folder', folder, true)
  assert.deepEqual(
    taste
      .references()
      .tracks.map((r) => r.title)
      .sort(),
    ['另一首', '同标签'].sort(),
  )
  assert.equal(await keyword('', only, 80), '日语歌')
  assert.deepEqual(calls.at(-1), {
    kind: 'publicLists',
    description: '',
    requestWeight: 0,
    tasteWeight: 100,
    profile: japanese,
  })
  await keyword('通勤', only, 65)
  assert.deepEqual(calls.at(-1), {
    kind: 'publicLists',
    description: '通勤',
    requestWeight: 65,
    tasteWeight: 35,
    profile: japanese,
  })
  await keyword('通勤', empty, 65)
  assert.deepEqual(calls.at(-1), {
    kind: 'publicLists',
    description: '通勤',
    requestWeight: 100,
    tasteWeight: 0,
  })
  const beforeEmpty = calls.length
  await assert.rejects(keyword('', empty, 0), /请输入/)
  assert.equal(calls.length, beforeEmpty)
  key = randomUUID()
  const rotated = await profile(only)
  assert.notEqual(rotated, japanese)
  store.db.prepare("UPDATE playlists SET name='演歌' WHERE id=?").run(playlist)
  assert.notEqual(await profile(only), rotated)
  store.db
    .prepare("DELETE FROM playlist_tracks WHERE playlist=? AND track='online-only'")
    .run(playlist)
  const changed = await profile(only)
  assert.equal(JSON.parse(changed)[0].uniqueRecordings, 1)
  taste.consent(false)
  await assert.rejects(keyword('', only, 80), /请输入/)
  assert.equal(await profile(only), '')
  taste.consent(true)
  assert.notEqual(await profile(only), changed)
  const large = Array.from({ length: 105 }, (_, i) => ({
    id: 'large' + i,
    kind: 'playlist',
    name: '测试集合'.repeat(18) + i,
    tracks: new Map([['track' + i, { title: '夹具' + i, artist: '测试', album: '' }]]),
  }))
  const folded = await taste.referenceProfile(large, signal)
  assert.ok(folded.length <= 12000)
  assert.equal(
    JSON.parse(folded).reduce((n, g) => n + g.uniqueRecordings, 0),
    105,
  )
  assert.ok(calls.some((call) => Array.isArray(call.collections)))
  console.log(
    'PASS 录音身份、在线副本、独立同标签录音、目录自动入库、旧交叉排除、授权、空集、取消、隐私、回环模型分批请求、公开歌单关键词与摘要缓存失效',
  )
} finally {
  const closed = once(server, 'close')
  server.close()
  await closed
  store.db.close()
  await rm(root, { recursive: true, force: true })
}
