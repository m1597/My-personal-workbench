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
  ['list_sources', 'import_sources', 'source_capabilities', 'select_source'],
)
for (const [name, args] of [
  ['read_file', { path: 'x' }],
  ['import_sources', { ids: ['https://example.org/x.js'] }],
  ['list_sources', { token: 'x' }],
  ['select_source', { id: '../anything' }],
])
  assert.equal(validCall(name, args), false)
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
