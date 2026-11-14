import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  catalogId,
  inspectSource,
  parseSourceIndex,
  sourceCatalog,
} from '../examples/component-host/lx-source-catalog.mjs'
import {
  requestSourceTool,
  sourceEndpoint,
  sourceTools,
  startSourcePipe,
  validCall,
} from '../examples/component-host/music-source-pipe.mjs'
const root = 'https://raw.githubusercontent.com/pdone/lx-music-source/main/'
const mirror = 'https://gh-proxy.org/raw.githubusercontent.com/pdone/lx-music-source/main/'
const markdown = [
  '### Fish',
  root + 'fish/latest.js',
  mirror + 'fish/latest.js',
  '### Huibq',
  root + 'huibq/latest.js',
].join('\n')
assert.deepEqual(parseSourceIndex(markdown), [
  { id: 'fish', name: 'Fish' },
  { id: 'huibq', name: 'Huibq' },
])
assert.equal(catalogId(mirror + 'fish/latest.js'), 'fish')
const db = new DatabaseSync(':memory:')
{
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT)')
  const catalog = sourceCatalog(db)
  const script =
    "lx.on('request',()=>null);lx.send('inited',{sources:{tx:{actions:['musicUrl'],qualitys:['320k']},kg:{actions:['musicUrl','search'],qualitys:['128k']}}})"
  const saved = await inspectSource(script, undefined, 'kg')
  delete saved.catalogVersion
  delete saved.platforms.tx
  const id = catalog.install(saved, null, true)
  await catalog.upgrade()
  assert.equal(catalog.list().active, id)
  assert.equal(catalog.describe(id).platform, 'kg')
  assert.deepEqual(catalog.describe(id).platformDetails, [
    { platform: 'tx', search: 'platform', quality: ['320k'] },
    { platform: 'kg', search: 'source', quality: ['128k'] },
  ])
  db.close()
}
db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
const code = (name) =>
  '// @name ' +
  name +
  "\nlx.on('request',()=>null);lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['128k'],allowPermanentSave:false}}})"
const signal = new AbortController().signal
const old = await inspectSource(code('旧源'), signal)
delete old.permissionsVersion
delete old.permanentSave
db.prepare('INSERT INTO state VALUES(?,?)').run('lx-source', JSON.stringify(old))
const requested = []
const bank = sourceCatalog(db, async (file) => {
  requested.push(file)
  if (file === 'fish/latest.js') return old.code
  if (file === 'huibq/latest.js') return code('新源')
  if (file === 'README.md') return markdown
  throw Error('离线')
})
const initial = bank.list()
assert.equal(initial.installed.length, 1)
assert.equal(bank.describe(initial.active).permanentSave, null)
const res = await bank.importSelected(['fish', 'fish', 'huibq', 'lx'], signal)
assert.equal(res[0].id, initial.active)
assert.equal(res[2].error, '离线')
assert.deepEqual(requested, ['fish/latest.js', 'huibq/latest.js', 'lx/latest.js'])
assert.equal(bank.list().active, initial.active)
assert.equal(bank.describe(initial.active).permanentSave, false)
assert.equal(bank.select(res[1].id).name, '新源')
assert.equal(bank.select(initial.active).permanentSave, false)
bank.install(await inspectSource(code('旧源 v2'), signal), 'fish', true)
assert.equal(bank.list().active, initial.active)
assert.equal(bank.list().installed.length, 2)
assert.equal(bank.describe(initial.active).name, '旧源 v2')
assert.deepEqual((await bank.importSelected(['fish'], signal))[0], res[0])
assert.equal((await bank.refresh(signal)).catalog.length, 2)
await assert.rejects(bank.importSelected(['not-in-catalog'], signal))
assert.ok(!JSON.stringify(bank.list()).includes('lx.send'))
assert.deepEqual(
  sourceTools.map((t) => t.name),
  ['list_sources', 'import_sources', 'source_capabilities', 'select_source', 'recent_tracks', 'search_library', 'list_playlists', 'add_to_playlist', 'create_listening_playlist', 'compare_playlists'],
)
for (const [name, args] of [
  ['read_file', { path: 'x' }],
  ['import_sources', { ids: ['https://example.org/x.js'] }],
  ['list_sources', { token: 'x' }],
  ['select_source', { id: '../anything' }],
])
  assert.equal(validCall(name, args), false)
{
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  let health = { fish: '可用', huibq: '可用' }
  let offline = false
  let transient = false
  let script = code('目录 A')
  let partial = false
  let tree = { tree: [] }
  const reads = []
  const bank = sourceCatalog(db, async (file) => {
    reads.push(file)
    if (offline) throw Error('仓库不可达')
    if (file === 'tree') return JSON.stringify(tree)
    if (file === 'README.md') return partial ? markdown.split('### Huibq')[0] : markdown
    if (file === 'health-state.json') return JSON.stringify({ sources: health })
    if (file === 'fish/latest.js' && transient) throw Error('下载超时')
    if (file === 'fish/latest.js') return script
    if (file === 'huibq/latest.js') return code('手动 B')
    throw Error('未知文件')
  })
  const manual = bank.install(await inspectSource(code('手动 B'), signal), null, true)
  await bank.synchronize(signal)
  assert.equal(bank.list().installed.length, 2)
  const findFish = () => bank.list().installed.find((s) => s.origins.includes('fish'))
  const first = findFish().id
  script = code('目录 A2')
  await bank.synchronize(signal)
  assert.equal(findFish().id, first)
  assert.equal(findFish().name, '目录 A2')
  health = { fish: '异常', huibq: '失效' }
  transient = true
  await bank.synchronize(signal)
  assert.equal(findFish().id, first)
  assert.ok(bank.describe(manual).disabled)
  assert.throws(() => bank.select(manual))
  assert.equal(bank.list().active, first)
  transient = false
  script = 'const invalid = ;'
  await bank.synchronize(signal)
  assert.equal(findFish(), undefined)
  assert.equal(bank.list().active, null)
  health = { fish: '可用', huibq: '可用' }
  script = code('目录 A3')
  await bank.synchronize(signal)
  assert.equal(findFish().name, '目录 A3')
  assert.equal(bank.describe(manual).disabled, '')
  offline = true
  const stable = bank.list()
  await bank.synchronize(signal)
  assert.deepEqual(bank.list(), stable)
  assert.equal(reads.filter((f) => f === 'README.md').length, 6)
  offline = false
  partial = true
  tree = {
    truncated: false,
    tree: ['README.md', 'huibq/latest.js'].map((path) => ({
      path,
      type: 'blob',
      sha: '0'.repeat(40),
    })),
  }
  await bank.synchronize(signal)
  assert.ok(!bank.describe(manual).disabled)
  assert.ok(bank.list().catalog.some((s) => s.id === 'huibq'))
  tree.tree.pop()
  await bank.synchronize(signal)
  assert.ok(bank.describe(manual).disabled)
  assert.ok(!bank.list().catalog.some((s) => s.id === 'huibq'))
  db.close()
}
{
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  let next = "throw Error('初始化固定失败')"
  let offline = false
  let reads = 0
  const { createHash } = await import('node:crypto')
  const blob = () =>
    createHash('sha1')
      .update('blob ' + Buffer.byteLength(next) + '\0')
      .update(next)
      .digest('hex')
  const bank = sourceCatalog(db, async (file) => {
    if (file === 'README.md') return markdown
    if (file === 'tree')
      return JSON.stringify({
        truncated: false,
        tree: [{ type: 'blob', path: 'huibq/latest.js', sha: blob() }],
      })
    if (file === 'health-state.json')
      return JSON.stringify({ sources: { fish: '可用', huibq: '可用' } })
    if (file === 'fish/latest.js') return code('可用 A')
    if (file === 'huibq/latest.js') {
      reads++
      if (offline) throw Error('下载中断')
      return next
    }
    throw Error(file)
  })
  for (let i = 0; i < 3; i++) assert.equal(await bank.synchronize(signal), true)
  assert.equal(reads, 1)
  assert.equal(bank.list().installed.length, 1)
  next = code('已修复 B')
  offline = true
  assert.equal(await bank.synchronize(signal), false)
  offline = false
  assert.equal(await bank.synchronize(signal), true)
  assert.equal(reads, 3)
  assert.equal(bank.list().installed.length, 2)
  db.close()
}
await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/source-permissions-'))
const endpoint = await sourceEndpoint(profile, 'publish')
assert.ok(!endpoint.startsWith(profile))
let calls = 0
const close = await startSourcePipe(profile, async () => {
  calls++
  return bank.list()
})
try {
  assert.equal((await requestSourceTool(profile, 'list_sources', {})).active, initial.active)
  const authorized = await readFile(endpoint, 'utf8')
  await writeFile(endpoint, JSON.stringify({ ...JSON.parse(authorized), token: '0'.repeat(64) }))
  await assert.rejects(requestSourceTool(profile, 'list_sources', {}), /未授权/)
  await writeFile(endpoint, authorized)
  execFileSync('icacls.exe', [endpoint, '/grant', '*S-1-5-32-545:(R)'], {
    windowsHide: true,
    stdio: 'ignore',
  })
  await assert.rejects(sourceEndpoint(profile, 'connect'), /不可用/)
  await assert.rejects(requestSourceTool(profile, 'list_sources', {}))
  assert.equal(calls, 1)
} finally {
  close()
  await unlink(endpoint).catch(() => {})
  db.close()
}
console.log('PASS 旧源迁移、更新、目录勾选去重、逐项失败、切换、能力与本机 DACL/令牌拒绝')
