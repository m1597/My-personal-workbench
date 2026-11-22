import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'
import { mkdtemp } from 'node:fs/promises'
import { _electron, expect } from '@playwright/test'

const [phase, directory, executable] = process.argv.slice(2)
assert(
  ['seed', 'verify', 'recover'].includes(phase) &&
    path.isAbsolute(directory) &&
    path.isAbsolute(executable),
  'Usage: node scripts/check-music-installed-upgrade.mjs seed|verify|recover ABSOLUTE_NEW_FIXTURE ABSOLUTE_MUSIC_EXE',
)
const marker = path.join(directory, 'music-upgrade-fixture.json')
const profile = path.join(directory, 'profile')
const hash = (text) => createHash('sha256').update(text).digest('hex')
const key = phase === 'seed' ? randomUUID() : ''
// Non-recursive mkdir refuses to seed any existing directory, including a user's profile.
if (phase === 'seed') await mkdir(directory)
const fixture =
  phase === 'seed'
    ? {
        schema: 1,
        artist: randomUUID(),
        model: 'upgrade-' + randomUUID(),
        digest: hash(key),
        port: 0,
      }
    : JSON.parse(await readFile(marker, 'utf8'))
assert.equal(fixture.schema, 1)
let received = 0
const server = createServer(async (req, res) => {
  const body = []
  for await (const chunk of req) body.push(chunk)
  try {
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(JSON.parse(Buffer.concat(body)).model, fixture.model)
    assert.equal(hash((req.headers.authorization || '').replace(/^Bearer /, '')), fixture.digest)
    received++
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ keyword: 'upgrade-probe' }) } }],
      }),
    )
  } catch {
    res.writeHead(403).end()
  }
})
await new Promise((resolve, reject) =>
  server.once('error', reject).listen(fixture.port, '127.0.0.1', resolve),
)
let app
try {
  if (phase === 'seed') {
    fixture.port = server.address().port
    const root = path.join(profile, 'fitbay-music')
    await mkdir(root, { recursive: true })
    const db = new DatabaseSync(path.join(root, 'music.sqlite'))
    try {
      db.exec('CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare('INSERT INTO state VALUES(?,?)').run(
        'followed-musicbrainz-artists',
        JSON.stringify([
          { id: fixture.artist, name: 'Upgrade fixture artist', aliases: [], detail: '' },
        ]),
      )
    } finally {
      db.close()
    }
  }
  const runtimeProfile =
    phase === 'recover' ? await mkdtemp(path.join(directory, 'restore-')) : profile
  app = await _electron.launch({
    executablePath: executable,
    args: ['--user-data-dir=' + runtimeProfile],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.music?.aiCatalogQuery)
  if (phase === 'seed') {
    await page.evaluate((v) => window.music.writeConnection('music.model', v), {
      endpoint: 'http://127.0.0.1:' + fixture.port + '/v1',
      model: fixture.model,
      key,
      protocol: 'chat',
    })
  }
  if (phase === 'recover') {
    await app.evaluate(({ dialog }, oldProfile) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [oldProfile] })
    }, profile)
    const skip = page.getByRole('button', { name: '跳过', exact: true })
    await skip.waitFor({ timeout: 3000 }).catch(() => {})
    if (await skip.isVisible()) await skip.click()
    await openMusicSettings(page)
    await selectMusicSettings(page, '本地曲库')
    const restore = page.getByRole('button', { name: '从旧资料目录恢复' })
    await restore.click()
    await expect(
      page.getByRole('status').filter({ hasText: '新增关注 1 位。已恢复专用模型连接' }),
    ).toBeVisible()
    await restore.click()
    await expect(
      page.getByRole('status').filter({ hasText: '新增关注 0 位。已保留当前专用连接' }),
    ).toBeVisible()
    await page.screenshot({ path: path.join(runtimeProfile, 'restored.png') })
  }
  const artists = await page.evaluate(() => window.music.followedArtists())
  assert(artists.some((a) => a.id === fixture.artist))
  const result = await page.evaluate(() => window.music.aiCatalogQuery('artists', 'upgrade probe'))
  assert.equal(result, 'upgrade-probe')
  assert.equal(received, 1)
  if (phase === 'seed') await writeFile(marker, JSON.stringify(fixture), { flag: 'wx' })
  console.log(
    'PASS',
    phase,
    await app.evaluate(({ app }) => app.getVersion()),
    'followed artist, authenticated Music model request via packaged renderer',
  )
} finally {
  if (app) await app.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
