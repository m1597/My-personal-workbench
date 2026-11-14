import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { linkSync, lstatSync, realpathSync, readdirSync, unlinkSync } from 'node:fs'
import { audioTypes, fileIdentity, openAudio, pathKey } from './music/local-files.mjs'
import { lyricPath } from './music-lyrics.mjs'
import { sameWaveform } from './music-recording-identity.mjs'
import { verifyAudio } from './lx-audio-check.mjs'

const stat = (file) => lstatSync(file, { bigint: true, throwIfNoEntry: false })
const stamp = (s) => s && [s.dev, s.ino, s.birthtimeNs, s.mtimeNs, s.size].join(':')
const safelyAt = (file, version) => {
  const s = stat(file)
  return s?.isFile() && stamp(s) === version && pathKey(realpathSync(file)) === pathKey(file)
}
const rows = (store) =>
  store.db
    .prepare(
      'SELECT id,file,title,artist,album,duration,favorite,fileIdentity FROM local_tracks WHERE listed=1 AND available=1 AND awaitingLocation=0 ORDER BY favorite DESC, observedAt,id',
    )
    .all()
function cleanName(file) {
  const { dir, name, ext } = path.parse(file)
  const clean = name.replace(/^\s*(?:\[\d{1,3}\]\s*|\d{1,3}\s*[.、_\-]\s*|\d{2}\s+)(?=\S)/u, '')
  if (
    clean === name ||
    !clean.trim() ||
    /[. ]$/.test(clean) ||
    /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(clean)
  )
    return null
  return path.join(dir, clean + ext)
}
function ensureMoves(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS cleanup_renames(id TEXT PRIMARY KEY, original TEXT NOT NULL, destination TEXT NOT NULL, files TEXT NOT NULL)',
  )
}
export function recoverRenames(store) {
  const db = store.db
  ensureMoves(db)
  for (const op of db.prepare('SELECT * FROM cleanup_renames').all()) {
    const file = db.prepare('SELECT file FROM local_tracks WHERE id=?').get(op.id)?.file
    if (file !== op.original && file !== op.destination) continue
    const committed = file === op.destination
    try {
      if (cleanName(op.original) !== op.destination) continue
      const pairs = JSON.parse(op.files)
      for (const { from, to, version, created } of pairs) {
        if (!created) continue
        if (
          !(from === op.original && to === op.destination) &&
          !(from === lyricPath(op.original) && to === lyricPath(op.destination))
        )
          throw Error('路径无效')
        const keep = committed ? to : from,
          drop = committed ? from : to
        if (!safelyAt(keep, version)) throw Error('文件变化')
        if (safelyAt(drop, version)) unlinkSync(drop)
      }
      db.prepare('DELETE FROM cleanup_renames WHERE id=?').run(op.id)
    } catch {
      /* Release locked names on the next pass. */
    }
  }
}
function renamePlan(store, row) {
  const to = cleanName(row.file)
  if (!to) return null
  const audio = stat(row.file)
  const pairs = [{ from: row.file, to, version: stamp(audio) }]
  let reason
  if (
    !audio?.isFile() ||
    !safelyAt(row.file, stamp(audio)) ||
    (row.fileIdentity && row.fileIdentity !== fileIdentity(audio))
  )
    reason = '原文件已变化'
  else if (
    stat(to) ||
    store.db.prepare('SELECT id FROM local_tracks WHERE path_key=?').get(pathKey(to))
  )
    reason = '目标音频已存在'
  const fromLrc = lyricPath(row.file),
    toLrc = lyricPath(to),
    lyric = stat(fromLrc)
  if (stat(toLrc)) reason = '目标歌词已存在'
  if (lyric) {
    if (!lyric.isFile() || !safelyAt(fromLrc, stamp(lyric))) reason = '歌词不是普通文件'
    else if (
      readdirSync(path.dirname(to)).some(
        (name) =>
          path.parse(name).name.toLowerCase() === path.parse(to).name.toLowerCase() &&
          Object.hasOwn(audioTypes, path.extname(name).toLowerCase()),
      )
    )
      reason = '目标歌词将由其他录音共用'
    else if (
      readdirSync(path.dirname(row.file)).some(
        (name) =>
          path.parse(name).name.toLowerCase() === path.parse(row.file).name.toLowerCase() &&
          name.toLowerCase() !== path.basename(row.file).toLowerCase() &&
          Object.hasOwn(audioTypes, path.extname(name).toLowerCase()),
      )
    )
      reason = '歌词由多份音频共用'
    pairs.push({ from: fromLrc, to: toLrc, version: stamp(lyric) })
  }
  return { id: row.id, file: row.file, to, pairs, reason }
}
function applyRename(store, plan) {
  const { db } = store,
    row = store.library.row(plan.id)
  if (row.file !== plan.file) throw Error('索引已变化')
  const current = renamePlan(store, row)
  if (!current || current.reason || JSON.stringify(current.pairs) !== JSON.stringify(plan.pairs))
    throw Error(current?.reason || '预览后文件已变化')
  db.prepare('INSERT INTO cleanup_renames VALUES(?,?,?,?)').run(
    row.id,
    row.file,
    plan.to,
    JSON.stringify(plan.pairs),
  )
  try {
    for (const pair of plan.pairs) {
      linkSync(pair.from, pair.to)
      pair.created = true
      db.prepare('UPDATE cleanup_renames SET files=? WHERE id=?').run(
        JSON.stringify(plan.pairs),
        row.id,
      )
    }
    for (const pair of plan.pairs)
      if (!safelyAt(pair.to, pair.version) || !safelyAt(pair.from, pair.version))
        throw Error('文件已变化')
    db.exec('BEGIN IMMEDIATE')
    const touched = db
      .prepare(
        'UPDATE local_tracks SET file=?,path_key=?,title=CASE WHEN title=? THEN ? ELSE title END WHERE id=? AND file=?',
      )
      .run(
        plan.to,
        pathKey(plan.to),
        path.parse(row.file).name,
        path.parse(plan.to).name,
        row.id,
        row.file,
      )
    if (!touched.changes) throw Error('索引已变化')
    db.prepare('UPDATE daily_downloads SET file=? WHERE local=? AND file=?').run(
      plan.to,
      row.id,
      row.file,
    )
    db.prepare('UPDATE library SET file=? WHERE file=?').run(plan.to, row.file)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='lyric_files'").get())
      db.prepare('UPDATE lyric_files SET audio=?,file=? WHERE audio=? AND file=?').run(
        plan.to,
        lyricPath(plan.to),
        row.file,
        lyricPath(row.file),
      )
    db.exec('COMMIT')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw e
  } finally {
    recoverRenames(store)
  }
  if (db.prepare('SELECT 1 FROM cleanup_renames WHERE id=?').get(row.id))
    throw Error('已改名，旧文件名等待解除占用')
}
async function duplicateGroups(rows, signal) {
  const groups = [],
    unreadable = [],
    waveCache = new Map()
  async function waveform(row) {
    if (!waveCache.has(row.id)) {
      if (waveCache.size >= 32) waveCache.delete(waveCache.keys().next().value)
      waveCache.set(row.id, await verifyAudio(row.file, signal, row.duration))
    }
    return waveCache.get(row.id)
  }
  for (const row of rows) {
    signal.throwIfAborted()
    let handle
    try {
      handle = await openAudio(row.file)
      const s = await handle.stat({ bigint: true })
      row.version = stamp(s)
      row.bytes = Number(s.size)
      if (row.fileIdentity && row.fileIdentity !== fileIdentity(s)) throw Error('文件已变化')
      const hash = createHash('sha256')
      for await (const chunk of handle.createReadStream({ autoClose: false, signal }))
        hash.update(chunk)
      row.digest = hash.digest('hex')
      let group = groups.find((g) => g.some((r) => r.digest === row.digest))
      if (!group && row.bytes <= 128 * 1024 * 1024 && row.duration > 0 && row.duration <= 1200) {
        for (const candidate of groups) {
          const first = candidate[0]
          if (Math.abs(first.duration - row.duration) > 0.5 || first.bytes > 128 * 1024 * 1024)
            continue
          if (sameWaveform(await waveform(first), await waveform(row))) {
            group = candidate
            break
          }
        }
      }
      if (!safelyAt(row.file, row.version)) throw Error('文件已变化')
      if (group) group.push(row)
      else groups.push([row])
    } catch {
      signal.throwIfAborted()
      unreadable.push(row.file)
    } finally {
      await handle?.close()
    }
  }
  return { groups: groups.filter((g) => g.length > 1), unreadable }
}
export function registerCleanup(bind, getStore, { forget, trash, epoch, inUse }) {
  let pending,
    controller,
    working = false
  const run =
    (fn) =>
    async (...args) => {
      const store = getStore()
      if (working || store.library.job.running) throw Error('请等待当前曲库操作结束')
      working = true
      try {
        return await fn(store, ...args)
      } finally {
        working = false
      }
    }
  bind(
    'previewCleanup',
    run(async (store, mode) => {
      if (!['duplicates', 'rename'].includes(mode)) throw Error('未知整理操作')
      const token = randomUUID(),
        page = epoch(),
        candidates = rows(store)
      pending = undefined
      if (mode === 'rename') {
        recoverRenames(store)
        const items = []
        for (const row of candidates) {
          try {
            const item = renamePlan(store, row)
            if (item) items.push(item)
          } catch {
            if (cleanName(row.file))
              items.push({
                id: row.id,
                file: row.file,
                to: cleanName(row.file),
                reason: '文件无法读取',
              })
          }
        }
        const names = new Map()
        for (const item of items) {
          const key = pathKey(item.to)
          names.set(key, (names.get(key) || 0) + 1)
        }
        const lyricTargets = new Map()
        for (const item of items) {
          const key = pathKey(lyricPath(item.to))
          const others = lyricTargets.get(key) || []
          others.push(item)
          lyricTargets.set(key, others)
        }
        for (const targets of lyricTargets.values())
          if (targets.length > 1 && targets.some((item) => item.pairs?.length > 1))
            for (const item of targets) item.reason = '多首歌曲的目标歌词同名'
        for (const item of items)
          if (names.get(pathKey(item.to)) > 1) item.reason = '多首歌曲的目标名称相同'
        pending = { token, page, mode, items }
        return { token, items: items.map(({ id, file, to, reason }) => ({ id, file, to, reason })) }
      }
      controller = new AbortController()
      const { groups, unreadable } = await duplicateGroups(candidates, controller.signal)
      if (epoch() !== page) throw Error('窗口已关闭')
      pending = { token, page, mode, groups }
      return {
        token,
        groups: groups.map((group) =>
          group.map(({ id, file, title, artist, bytes, favorite }) => ({
            id,
            file,
            title,
            artist,
            bytes,
            favorite: !!favorite,
          })),
        ),
        unreadable,
      }
    }),
  )
  bind(
    'applyCleanup',
    run(async (store, token, action, selections) => {
      const plan = pending
      if (!plan || plan.token !== token || plan.page !== epoch()) throw Error('请重新预览')
      if (
        !Array.isArray(selections) ||
        selections.some((s) => typeof s !== 'string') ||
        new Set(selections).size !== selections.length
      )
        throw Error('选择无效')
      const skipped = []
      let changed = 0
      if (plan.mode === 'rename') {
        if (
          action !== 'rename' ||
          selections.some((id) => !plan.items.some((r) => r.id === id && !r.reason))
        )
          throw Error('选择无效')
        pending = undefined
        for (const row of plan.items.filter((r) => selections.includes(r.id))) {
          try {
            if (inUse(row.id)) throw Error('正在播放，请停止后重试')
            applyRename(store, row)
            changed++
          } catch (e) {
            skipped.push(
              row.file +
                ' · ' +
                (['ENOTSUP', 'ENOSYS', 'EOPNOTSUPP'].includes(e.code)
                  ? '文件系统不支持安全改名'
                  : e.code
                    ? '文件占用、权限不足或目标冲突'
                    : e.message),
            )
          }
        }
      } else {
        if (!['forget', 'trash'].includes(action) || selections.length !== plan.groups.length)
          throw Error('每组必须保留一份')
        const pairs = []
        for (const [i, group] of plan.groups.entries()) {
          const keep = group.find((r) => r.id === selections[i])
          if (!keep) throw Error('无效保留项')
          for (const duplicate of group.filter((r) => r !== keep)) pairs.push({ keep, duplicate })
        }
        const verify = ({ keep, duplicate }) => {
          for (const row of [keep, duplicate])
            if (store.library.row(row.id).file !== row.file || !safelyAt(row.file, row.version))
              throw Error('预览后文件已变化，请重新扫描')
          if (inUse(duplicate.id)) throw Error('重复项正在播放，请停止后重试')
        }
        for (const pair of pairs) verify(pair)
        pending = undefined
        if (action === 'trash' && pairs.length) {
          if (
            await trash(
              pairs.map((p) => p.duplicate.id),
              (id) => verify(pairs.find((p) => p.duplicate.id === id)),
            )
          )
            changed = pairs.length
        } else
          for (const pair of pairs) {
            verify(pair)
            forget([pair.duplicate.id])
            changed++
          }
      }
      if (changed) store.library.changed?.()
      return { changed, skipped }
    }),
  )
  return () => {
    controller?.abort()
    pending = undefined
  }
}
