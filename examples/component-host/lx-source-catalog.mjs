import { createHash } from 'node:crypto'
import { openPublic } from './lx-net.mjs'
import { runSource } from './lx-runtime.mjs'
const text = (v) => (typeof v === 'string' ? v.trim().slice(0, 256) : '')
const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
export async function fetchSource(link, signal, headers) {
  if (typeof link !== 'string' || link.length > 8192 || !/^https?:\/\//i.test(link))
    throw Error('请输入 HTTP 或 HTTPS 音乐源直链')
  const timeout = AbortSignal.timeout(20000)
  try {
    const response = await openPublic(link, {
      signal: AbortSignal.any([signal, timeout]),
      headers,
    })
    if (response.statusCode !== 200) {
      response.destroy()
      throw Error('无法读取音乐源，HTTP ' + response.statusCode)
    }
    const chunks = []
    let bytes = 0
    for await (const chunk of response) {
      bytes += chunk.length
      if (bytes > 1024 * 1024) throw Error('音乐源超过 1 MB')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    signal.throwIfAborted()
    if (timeout.aborted) throw Error('在线导入超时，请重试')
    if (error.code) throw Error('无法读取音乐源，请检查链接和网络')
    throw error
  }
}
export async function inspectSource(code, signal, preferredPlatform) {
  if (typeof code !== 'string' || Buffer.byteLength(code) > 1024 * 1024) throw Error('源文件过大')
  const declared = await runSource(code, null, signal)
  const platforms = {}
  for (const platform of ['wy', 'kw', 'tx', 'kg', 'mg']) {
    const d = declared?.[platform]
    if (!Array.isArray(d?.actions) || !d.actions.includes('musicUrl')) continue
    if (!d.actions.includes('search') && !['wy', 'tx', 'kg'].includes(platform)) continue
    const quality = qualities.filter((q) => d.qualitys?.includes(q))
    if (!quality.length) continue
    platforms[platform] = {
      platform,
      permissionsVersion: 1,
      permanentSave: [d.allowPermanentSave, d.permanentDownload].includes(false)
        ? false
        : [d.allowPermanentSave, d.permanentDownload].includes(true)
          ? true
          : undefined,
      search: d.actions.includes('search'),
      quality,
    }
  }
  const first = platforms[preferredPlatform] ?? Object.values(platforms)[0]
  if (!first) throw Error('此源缺少可用的搜索平台、取址操作或音质')
  return {
    ...first,
    catalogVersion: 2,
    platforms,
    code,
    name: text(code.match(/@name\s+([^\r\n*]+)/)?.[1]) || '自定义音乐源',
  }
}
const rawRoot = 'https://raw.githubusercontent.com/pdone/lx-music-source/main/'
const mirror = 'https://gh-proxy.org/'
const initialEntries = [
  ['changqing', 'ChangQing'],
  ['feichangdao', 'FeiChangDao'],
  ['fish', 'Fish'],
  ['flower', 'Flower'],
  ['grass', 'Grass'],
  ['helloworld', 'HelloWorld'],
  ['huanyin', 'HuanYin'],
  ['huibq', 'Huibq'],
  ['hyw', 'HYW'],
  ['ikun', 'ikun'],
  ['jiexiang', 'JieXiang'],
  ['juhe', 'JuheApi'],
  ['lx', 'LX'],
  ['qdy', 'QDY'],
  ['qingliang', 'QingLiang'],
  ['sixyin', 'SixYin'],
  ['suyin', 'SuYin'],
  ['xinghai', 'XingHai'],
  ['xinglan', 'XingLan'],
  ['yuningxi', 'YuNingXi'],
].map(([id, name]) => ({ id, name }))
const slug = /^[a-z0-9][a-z0-9_-]{0,47}$/
export function catalogId(link) {
  if (typeof link !== 'string') return null
  let normalized = link
  for (const base of [mirror, 'https://gh.llkk.cc/', 'https://github.moeyy.xyz/']) {
    if (normalized.startsWith(base)) {
      normalized = normalized.slice(base.length)
      if (normalized.startsWith('raw.githubusercontent.com/')) normalized = 'https://' + normalized
      break
    }
  }
  if (!normalized.startsWith(rawRoot)) return null
  const match = /^([a-z0-9_-]+)\/latest\.js$/.exec(normalized.slice(rawRoot.length))
  return match && slug.test(match[1]) ? match[1] : null
}
async function fetchRepositoryFile(file, signal) {
  try {
    return await fetchSource(rawRoot + file, signal)
  } catch {
    signal.throwIfAborted()
    try {
      return await fetchSource(
        'https://api.github.com/repos/pdone/lx-music-source/contents/' + file + '?ref=main',
        signal,
        {
          accept: 'application/vnd.github.raw+json',
          'user-agent': 'FitBay-Music',
        },
      )
    } catch {
      signal.throwIfAborted()
      if (file === 'README.md') throw Error('无法读取上游目录')
      return fetchSource(mirror + (rawRoot + file).slice(8), signal)
    }
  }
}
export function readSourceLink(link, signal) {
  const origin = catalogId(link)
  return origin ? fetchRepositoryFile(origin + '/latest.js', signal) : fetchSource(link, signal)
}
export function parseSourceIndex(markdown) {
  const entries = new Map()
  let name = ''
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('### ')) name = line.slice(4).trim().slice(0, 80)
    else {
      const id = catalogId(line.trim())
      if (id && name && !entries.has(id)) entries.set(id, { id, name })
    }
  }
  if (!entries.size || entries.size > 200) throw Error('未能识别上游音乐源目录')
  return Array.from(entries.values())
}
const fingerprint = (code) => createHash('sha256').update(code).digest('hex')
function capabilities(src) {
  return {
    name: src.name,
    platform: src.platform,
    searchPlatforms: src.platforms ? Object.keys(src.platforms) : undefined,
    platformDetails: Object.values(src.platforms ?? {}).map((p) => ({
      platform: p.platform,
      search: p.search ? 'source' : 'platform',
      quality: p.quality,
    })),
    search: src.search ? 'source' : 'platform',
    musicUrl: true,
    quality: src.quality,
    permanentSave: src.permissionsVersion === 1 ? (src.permanentSave ?? null) : null,
  }
}

export function sourceCatalog(db, loadFile = fetchRepositoryFile) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS music_sources (id TEXT PRIMARY KEY, origin TEXT, digest TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)',
  )
  db.exec(
    'CREATE TABLE IF NOT EXISTS music_source_origins (origin TEXT PRIMARY KEY, source TEXT NOT NULL)',
  )
  const byOrigin = (origin) =>
    db.prepare('SELECT source FROM music_source_origins WHERE origin=?').get(origin)?.source
  const get = (key) => db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value
  const set = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').run(key, value)
  const entries = () => JSON.parse(get('lx-source-index') || JSON.stringify(initialEntries))
  const byDigest = (digest) =>
    db.prepare('SELECT id FROM music_sources WHERE digest=?').get(digest)?.id
  const add = (src, origin) => {
    const digest = fingerprint(src.code)
    const existing = byDigest(digest)
    const id =
      (origin && byOrigin(origin)) || existing || (origin ? 'pdone:' + origin : 'sha256:' + digest)
    if (existing && existing !== id) {
      db.prepare('UPDATE music_source_origins SET source=? WHERE source=?').run(id, existing)
      db.prepare('DELETE FROM music_sources WHERE id=?').run(existing)
    }
    db.prepare(
      'INSERT INTO music_sources(id,origin,digest,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=COALESCE(music_sources.origin,excluded.origin),digest=excluded.digest,payload=excluded.payload',
    ).run(id, origin ?? null, digest, JSON.stringify(src))
    if (origin)
      db.prepare('INSERT OR REPLACE INTO music_source_origins(origin,source) VALUES(?,?)').run(
        origin,
        id,
      )
    return id
  }
  const migrate = () => {
    const raw = get('lx-source')
    if (!raw) return
    const src = JSON.parse(raw)
    if (!byDigest(fingerprint(src.code))) add(src)
  }
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw e
    }
  }
  const install = (src, origin, activate) =>
    transaction(() => {
      migrate()
      const before = get('lx-source')
      const id = add(src, origin)
      if (activate || !before || JSON.parse(before).code === src.code)
        set('lx-source', JSON.stringify(src))
      return id
    })
  const list = () =>
    transaction(() => {
      migrate()
      const current = get('lx-source')
      const active = current ? byDigest(fingerprint(JSON.parse(current).code)) : null
      const aliases = db.prepare('SELECT origin,source FROM music_source_origins').all()
      const installed = db
        .prepare('SELECT id,origin,payload FROM music_sources ORDER BY rowid')
        .all()
        .map((row) => ({
          id: row.id,
          origin: row.origin,
          origins: aliases.filter((entry) => entry.source === row.id).map((entry) => entry.origin),
          ...capabilities(JSON.parse(row.payload)),
        }))
      return { catalog: entries(), installed, active }
    })
  async function importSelected(ids, signal) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20)
      throw Error('请选择 1 至 20 个目录条目')
    const known = new Set(entries().map((entry) => entry.id))
    if (ids.some((id) => typeof id !== 'string' || !slug.test(id) || !known.has(id)))
      throw Error('未知的目录音源 ID')
    const results = []
    for (const origin of new Set(ids)) {
      signal.throwIfAborted()
      const found = byOrigin(origin)
      if (found) {
        results.push({ origin, id: found })
        continue
      }
      try {
        const code = await loadFile(origin + '/latest.js', signal)
        const src = await inspectSource(code, signal)
        signal.throwIfAborted()
        results.push({ origin, id: install(src, origin, false) })
      } catch (e) {
        signal.throwIfAborted()
        results.push({ origin, error: e.message })
      }
    }
    return results
  }
  function select(id) {
    return transaction(() => {
      const row =
        typeof id === 'string' && db.prepare('SELECT payload FROM music_sources WHERE id=?').get(id)
      if (!row) throw Error('未知的已导入音乐源')
      migrate()
      set('lx-source', row.payload)
      return capabilities(JSON.parse(row.payload))
    })
  }
  let upgrading
  async function upgradeInstalled() {
    migrate()
    for (const row of db.prepare('SELECT id,payload FROM music_sources').all()) {
      const old = JSON.parse(row.payload)
      if (old.catalogVersion === 2) continue
      let next
      try {
        next = await inspectSource(old.code, undefined, old.platform)
      } catch {
        continue
      }
      transaction(() => {
        const updated = db
          .prepare('UPDATE music_sources SET payload=? WHERE id=? AND payload=?')
          .run(JSON.stringify(next), row.id, row.payload)
        if (updated.changes && get('lx-source') && JSON.parse(get('lx-source')).code === old.code)
          set('lx-source', JSON.stringify(next))
      })
    }
  }
  return {
    upgrade() {
      upgrading ??= upgradeInstalled().catch((error) => {
        upgrading = undefined
        throw error
      })
      return upgrading
    },
    list,
    importSelected,
    select,
    install,
    async refresh(signal) {
      const updated = parseSourceIndex(await loadFile('README.md', signal))
      signal.throwIfAborted()
      set('lx-source-index', JSON.stringify(updated))
      return list()
    },
    describe(id) {
      const record = list().installed.find((row) => row.id === id)
      if (!record) throw Error('未知的已导入音乐源')
      return record
    },
  }
}
