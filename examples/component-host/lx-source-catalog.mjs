import { Script } from 'node:vm'
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
class InvalidSource extends Error {}
export async function inspectSource(code, signal, preferredPlatform) {
  if (typeof code !== 'string' || Buffer.byteLength(code) > 1024 * 1024) throw Error('源文件过大')
  try {
    new Script(code)
  } catch (error) {
    if (error instanceof SyntaxError) throw new InvalidSource('音乐源脚本语法损坏')
    throw error
  }
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
  if (!first) throw new InvalidSource('此源缺少可用的搜索平台、取址操作或音质')
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
// Only fixed GitHub repository URLs reach Chromium's system networking stack.
async function readRepositoryUrl(url, signal, headers) {
  if (
    process.versions.electron &&
    ['raw.githubusercontent.com', 'api.github.com'].includes(new URL(url).hostname)
  ) {
    try {
      const { net } = await import('electron')
      const response = await net.fetch(url, {
        headers,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw Error('仓库请求失败')
      }
      const chunks = []
      let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.length
        if (bytes > 1024 * 1024) throw Error('仓库文件过大')
        chunks.push(chunk)
      }
      return Buffer.concat(chunks).toString('utf8')
    } catch {
      signal.throwIfAborted()
    }
  }
  return fetchSource(url, signal, headers)
}
async function fetchRepositoryFile(file, signal) {
  if (file === 'health-state.json')
    return readRepositoryUrl(rawRoot.replace('/main/', '/health-status/') + file, signal)
  if (file === 'tree')
    return readRepositoryUrl(
      'https://api.github.com/repos/pdone/lx-music-source/git/trees/main?recursive=1',
      signal,
      { 'user-agent': 'FitBay-Music' },
    )
  try {
    return await readRepositoryUrl(rawRoot + file, signal)
  } catch {
    signal.throwIfAborted()
    try {
      return await readRepositoryUrl(
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
      return readRepositoryUrl(mirror + (rawRoot + file).slice(8), signal)
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
  const columns = db
    .prepare('PRAGMA table_info(music_sources)')
    .all()
    .map((row) => row.name)
  if (!columns.includes('manual')) {
    db.exec('ALTER TABLE music_sources ADD COLUMN manual INTEGER NOT NULL DEFAULT 0')
    db.exec("UPDATE music_sources SET manual=1 WHERE origin IS NULL OR id LIKE 'sha256:%'")
  }
  if (!columns.includes('disabled'))
    db.exec("ALTER TABLE music_sources ADD COLUMN disabled TEXT NOT NULL DEFAULT ''")
  const byOrigin = (origin) =>
    db.prepare('SELECT source FROM music_source_origins WHERE origin=?').get(origin)?.source
  const get = (key) => db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value
  const set = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').run(key, value)
  const entries = () => JSON.parse(get('lx-source-index') || JSON.stringify(initialEntries))
  const byDigest = (digest) =>
    db.prepare('SELECT id FROM music_sources WHERE digest=?').get(digest)?.id
  const add = (src, origin, activate = false) => {
    const digest = fingerprint(src.code)
    const existing = byDigest(digest)
    const prior = origin && byOrigin(origin)
    const replace =
      prior &&
      !existing &&
      db
        .prepare(
          'SELECT 1 FROM music_sources WHERE id=? AND (manual=0 OR ?=1) AND (SELECT count(*) FROM music_source_origins WHERE source=?)=1',
        )
        .get(prior, Number(activate), prior)
    let id = existing || (replace && prior) || (origin ? 'pdone:' + origin : 'sha256:' + digest)
    if (!existing && !replace && db.prepare('SELECT 1 FROM music_sources WHERE id=?').get(id))
      id = 'pdone:' + origin + ':' + digest
    db.prepare(
      "INSERT INTO music_sources(id,origin,digest,payload,manual) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=COALESCE(music_sources.origin,excluded.origin),digest=excluded.digest,payload=excluded.payload,manual=max(music_sources.manual,excluded.manual),disabled=''",
    ).run(id, origin ?? null, digest, JSON.stringify(src), Number(!origin))
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
      const selected = before && byDigest(fingerprint(JSON.parse(before).code))
      const prior = origin && byOrigin(origin)
      const id = add(src, origin, activate)
      if (
        activate ||
        !before ||
        selected === id ||
        (prior &&
          selected === prior &&
          !db.prepare('SELECT manual FROM music_sources WHERE id=?').get(prior)?.manual)
      )
        set('lx-source', JSON.stringify(src))
      if (!origin) verifiedManual.add(fingerprint(src.code))
      if (prior && prior !== id) removeOrphan(prior)
      return id
    })
  function removeOrphan(id) {
    db.prepare(
      'DELETE FROM music_sources WHERE id=? AND manual=0 AND NOT EXISTS (SELECT 1 FROM music_source_origins WHERE source=?)',
    ).run(id, id)
  }
  const list = () =>
    transaction(() => {
      migrate()
      const current = get('lx-source')
      const active = current ? byDigest(fingerprint(JSON.parse(current).code)) : null
      const aliases = db.prepare('SELECT origin,source FROM music_source_origins').all()
      const installed = db
        .prepare('SELECT id,origin,payload,disabled FROM music_sources ORDER BY rowid')
        .all()
        .map((row) => ({
          id: row.id,
          origin: row.origin,
          disabled: row.disabled,
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
        typeof id === 'string' &&
        db.prepare("SELECT payload FROM music_sources WHERE id=? AND disabled=''").get(id)
      if (!row) throw Error('未知的已导入音乐源')
      migrate()
      set('lx-source', row.payload)
      return capabilities(JSON.parse(row.payload))
    })
  }
  let upgrading
  async function upgradeInstalled() {
    migrate()
    for (const row of db.prepare("SELECT id,payload FROM music_sources WHERE disabled=''").all()) {
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
  function retire(origin, reason) {
    const id = byOrigin(origin)
    if (!id) return
    db.prepare('DELETE FROM music_source_origins WHERE origin=?').run(origin)
    if (db.prepare('SELECT 1 FROM music_source_origins WHERE source=?').get(id)) return
    db.prepare('UPDATE music_sources SET disabled=? WHERE id=? AND manual=1').run(reason, id)
    removeOrphan(id)
  }
  function repairSelection() {
    const active = JSON.parse(get('lx-source') || 'null')
    if (
      active &&
      db
        .prepare("SELECT 1 FROM music_sources WHERE digest=? AND disabled=''")
        .get(fingerprint(active.code))
    )
      return
    const first = db
      .prepare(
        "SELECT payload FROM music_sources WHERE disabled='' ORDER BY manual DESC,rowid LIMIT 1",
      )
      .get()
    if (first) set('lx-source', first.payload)
    else db.prepare("DELETE FROM state WHERE key='lx-source'").run()
  }
  const verifiedManual = new Set()
  async function synchronize(signal, onChecked) {
    migrate()
    for (const row of db
      .prepare("SELECT id,payload FROM music_sources WHERE manual=1 AND disabled=''")
      .all()) {
      const src = JSON.parse(row.payload)
      try {
        if (verifiedManual.has(fingerprint(src.code))) continue
        await inspectSource(src.code, signal, src.platform)
        verifiedManual.add(fingerprint(src.code))
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof InvalidSource)
          transaction(() => {
            db.prepare('UPDATE music_sources SET disabled=? WHERE id=? AND payload=?').run(
              error.message,
              row.id,
              row.payload,
            )
            repairSelection()
          })
      }
    }
    const read = (file, ms) => loadFile(file, AbortSignal.any([signal, AbortSignal.timeout(ms)]))
    const [index, report, tree] = await Promise.all([
      read('README.md', 4500)
        .then(parseSourceIndex)
        .catch(() => null),
      read('health-state.json', 4500)
        .then((raw) => JSON.parse(raw).sources)
        .catch(() => null),
      read('tree', 3000)
        .then((raw) => JSON.parse(raw))
        .catch(() => null),
    ])
    signal.throwIfAborted()
    if (!index) return
    const completeTree =
      Array.isArray(tree?.tree) &&
      tree.truncated === false &&
      tree.tree.some((row) => row.path === 'README.md' && row.type === 'blob')
    const gitBlobs = new Map(
      (Array.isArray(tree?.tree) && !tree.truncated ? tree.tree : [])
        .filter((row) => row.type === 'blob' && /^[a-f0-9]{40}$/.test(row.sha))
        .map((row) => [row.path, row.sha]),
    )
    const validReport =
      report &&
      !Array.isArray(report) &&
      typeof report === 'object' &&
      Object.entries(report).every(([id, status]) => slug.test(id) && typeof status === 'string')
    const health = validReport ? report : JSON.parse(get('lx-source-health') || 'null')
    const included = new Set(index.map((row) => row.id))
    const removed = (origin) =>
      !included.has(origin) && completeTree && !gitBlobs.has(origin + '/latest.js')
    const retained = entries().filter((row) => !included.has(row.id) && !removed(row.id))
    const dead = (origin) => ['失效', '停用', '已停用'].includes(health?.[origin])
    transaction(() => {
      if (validReport) set('lx-source-health', JSON.stringify(report))
      set('lx-source-index', JSON.stringify([...index, ...retained].filter((row) => !dead(row.id))))
      for (const { origin } of db.prepare('SELECT origin FROM music_source_origins').all())
        if (removed(origin) || dead(origin)) retire(origin, '仓库已停用')
      repairSelection()
    })
    const pending = index.filter(
      (row) =>
        !dead(row.id) && (!health?.[row.id] || health[row.id] === '可用' || byOrigin(row.id)),
    )
    await onChecked?.()
    signal.throwIfAborted()
    const budget = AbortSignal.any([signal, AbortSignal.timeout(15000)])
    let next = 0
    async function worker() {
      while (next < pending.length && !budget.aborted) {
        const { id: origin } = pending[next++]
        const file = origin + '/latest.js'
        const prior = db
          .prepare('SELECT payload FROM music_sources WHERE id=?')
          .get(byOrigin(origin) ?? null)
        const old = prior && JSON.parse(prior.payload)
        if (
          old &&
          gitBlobs.get(file) ===
            createHash('sha1')
              .update('blob ' + Buffer.byteLength(old.code) + '\0')
              .update(old.code)
              .digest('hex')
        )
          continue
        try {
          const code = await loadFile(file, AbortSignal.any([budget, AbortSignal.timeout(5500)]))
          if (!code.trim() || /^\s*(?:<!doctype|<html)/i.test(code)) continue
          if (old?.code === code) continue
          const cached = db
            .prepare("SELECT payload FROM music_sources WHERE digest=? AND disabled=''")
            .get(fingerprint(code))
          const src = cached ? JSON.parse(cached.payload) : await inspectSource(code, budget)
          budget.throwIfAborted()
          install(src, origin, false)
        } catch (error) {
          signal.throwIfAborted()
          if (error instanceof InvalidSource)
            transaction(() => {
              retire(origin, error.message)
              repairSelection()
            })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker))
    signal.throwIfAborted()
  }
  return {
    configuration(code = JSON.parse(get('lx-source') || 'null')?.code) {
      const active = code ? fingerprint(code) : ''
      const sources = new Set(
        db
          .prepare("SELECT digest FROM music_sources WHERE disabled=''")
          .all()
          .map((row) => row.digest),
      )
      // Older profiles can have an active source that has not entered the catalog yet.
      if (active) sources.add(active)
      return fingerprint(JSON.stringify([active, [...sources].sort()]))
    },
    independentManual() {
      migrate()
      const active = JSON.parse(get('lx-source') || 'null')
      return (
        active &&
        verifiedManual.has(fingerprint(active.code)) &&
        db
          .prepare(
            "SELECT 1 FROM music_sources WHERE digest=? AND manual=1 AND origin IS NULL AND disabled=''",
          )
          .get(fingerprint(active.code)) &&
        active.permissionsVersion === 1 &&
        active.catalogVersion === 2
      )
    },
    independentCount() {
      return db
        .prepare(
          "SELECT count(*) AS n FROM music_sources WHERE manual=1 AND origin IS NULL AND disabled=''",
        )
        .get().n
    },
    discoverySources(current, manualOnly = false) {
      const others = db
        .prepare(
          "SELECT payload FROM music_sources WHERE disabled='' AND (?=0 OR (manual=1 AND origin IS NULL)) ORDER BY rowid",
        )
        .all(Number(manualOnly))
        .map(({ payload }) => JSON.parse(payload))
        .filter((src) => src.code !== current.code)
      return [current, ...others].flatMap((src) =>
        Object.values(src.platforms ?? { [src.platform]: src }).map((platform) => ({
          ...src,
          ...platform,
          permanentSave: platform.permanentSave,
        })),
      )
    },
    alternatives(platform, quality, currentCode) {
      const result = []
      for (const { payload } of db
        .prepare("SELECT payload FROM music_sources WHERE disabled='' ORDER BY rowid")
        .all()) {
        const src = JSON.parse(payload)
        const supported = src.platforms?.[platform]
        if (src.code !== currentCode && supported?.quality.includes(quality))
          result.push({ ...src, ...supported })
      }
      return result
    },
    upgrade() {
      upgrading ??= upgradeInstalled().catch((error) => {
        upgrading = undefined
        throw error
      })
      return upgrading
    },
    list,
    synchronize,
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
