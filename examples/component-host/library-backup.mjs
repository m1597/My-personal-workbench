import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { audioTypes, pathKey } from './music/local-files.mjs'

const format = 'fitbay.music-library'
export const backupLimit = 32 * 1024 * 1024
export function exportLibrary(store, taste) {
  const tracks = store.library
    .list()
    .map(({ id, title, artist, album, duration, listed, observedAt, size, favorite, origin }) => ({
      id,
      file: store.library.row(id).file,
      title,
      artist,
      album,
      duration,
      listed,
      observedAt,
      size,
      favorite,
      origin,
    }))
  const allLists = store.library.playlists()
  const localIds = new Set(tracks.map((t) => t.id))
  const playlists = allLists
    .filter((p) => !p.system)
    .map((p) => ({
      ...p,
      tracks: p.tracks.filter((id) => localIds.has(id)),
      additions: p.additions.filter(([id]) => localIds.has(id)),
    }))
  const recommended = allLists.find((p) => p.system)
  return {
    format,
    version: 1,
    tracks,
    playlists,
    smartLists: store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='smart_playlists'")
      .get()
      ? store.db
          .prepare(
            'SELECT id,name,source,days,comparison,plays FROM smart_playlists ORDER BY rowid',
          )
          .all()
      : [],
    recommendations: recommended?.tracks ?? [],
    recommendationOrder: recommended && {
      sort: recommended.sort,
      descending: recommended.descending,
      additions: recommended.additions,
    },
    history: store.db
      .prepare('SELECT event,track,playedAt FROM local_play_history ORDER BY playedAt,event')
      .all(),
    preference: {
      draft: store.get('draft'),
      feedback: [...store.feedbackIds()],
      taste: taste.document(),
    },
  }
}
function requireValue(value) {
  if (!value) throw Error('备份资料无效或超过支持范围')
}
const text = (value, max) =>
  typeof value === 'string' && value.length <= max && !value.includes('\0')
const list = (value, max) => Array.isArray(value) && value.length <= max
// Match the built-in SQLite NOCASE collation used by both playlist tables.
const playlistKey = (name) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
const time = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
function validateOrder(order, tracks) {
  if (order.sort === undefined && order.descending === undefined && order.additions === undefined)
    return
  const remaining = new Set(tracks)
  requireValue(
    ['custom', 'title', 'artist', 'added'].includes(order.sort) &&
      typeof order.descending === 'boolean' &&
      list(order.additions, tracks.length) &&
      order.additions.length === tracks.length &&
      order.additions.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          remaining.delete(entry[0]) &&
          time(entry[1]),
      ),
  )
}
export function validateBackup(value) {
  requireValue(
    value?.format === format &&
      value.version === 1 &&
      list(value.tracks, 200000) &&
      list(value.playlists, 10000) &&
      list(value.history, 1000000),
  )
  const ids = new Set(),
    paths = new Set()
  requireValue(list(value.smartLists, 10000))
  const smartNames = new Set(),
    smartIds = new Set()
  for (const rule of value.smartLists) {
    requireValue(
      rule &&
        text(rule.id, 120) &&
        rule.id &&
        !smartIds.has(rule.id) &&
        text(rule.name, 100) &&
        rule.name.trim() &&
        !smartNames.has(playlistKey(rule.name)) &&
        ['any', 'daily', 'download', 'local'].includes(rule.source) &&
        (rule.days === null ||
          (Number.isSafeInteger(rule.days) && rule.days >= 1 && rule.days <= 36500)) &&
        ['any', 'eq', 'gte', 'lte'].includes(rule.comparison) &&
        Number.isSafeInteger(rule.plays) &&
        rule.plays >= 0 &&
        rule.plays <= 10000000,
    )
    smartNames.add(playlistKey(rule.name))
    smartIds.add(rule.id)
  }
  for (const t of value.tracks) {
    requireValue(
      t &&
        text(t.id, 120) &&
        /^local-[\w-]+$/.test(t.id) &&
        !ids.has(t.id) &&
        text(t.file, 32766) &&
        path.isAbsolute(t.file) &&
        Object.hasOwn(audioTypes, path.extname(t.file).toLowerCase()) &&
        !paths.has(pathKey(t.file)) &&
        text(t.title, 2048) &&
        text(t.artist, 2048) &&
        text(t.album, 2048) &&
        Number.isFinite(t.duration) &&
        t.duration > 0 &&
        time(t.observedAt) &&
        [0, 1].includes(t.listed) &&
        [0, 1].includes(t.favorite) &&
        ['daily', 'download', 'local'].includes(t.origin) &&
        (t.size === null || (Number.isSafeInteger(t.size) && t.size >= 0)),
    )
    ids.add(t.id)
    paths.add(pathKey(t.file))
  }
  const names = new Set(),
    lists = new Set(),
    events = new Set()
  requireValue(
    list(value.recommendations, 200000) &&
      new Set(value.recommendations).size === value.recommendations.length &&
      value.recommendations.every((id) => ids.has(id)),
  )
  for (const p of value.playlists) {
    requireValue(
      p &&
        text(p.id, 120) &&
        p.id.length &&
        !lists.has(p.id) &&
        text(p.name, 80) &&
        p.name.trim() &&
        !names.has(playlistKey(p.name)) &&
        list(p.tracks, 200000) &&
        new Set(p.tracks).size === p.tracks.length &&
        p.tracks.every((id) => ids.has(id)),
    )
    names.add(playlistKey(p.name))
    lists.add(p.id)
    validateOrder(p, p.tracks)
  }
  if (value.recommendationOrder !== undefined) {
    requireValue(value.recommendationOrder && value.recommendationOrder.sort !== undefined)
    validateOrder(value.recommendationOrder, value.recommendations)
  }
  for (const h of value.history) {
    requireValue(
      h &&
        text(h.event, 150) &&
        h.event.length &&
        !events.has(h.event) &&
        ids.has(h.track) &&
        time(h.playedAt),
    )
    events.add(h.event)
  }
  const pref = value.preference,
    doc = pref?.taste
  requireValue(
    pref &&
      text(pref.draft, 1000) &&
      list(pref.feedback, 200000) &&
      pref.feedback.every((v) => text(v, 4096)) &&
      doc &&
      text(doc.text, 200000) &&
      text(doc.updatedAt, 100) &&
      list(doc.incorporated, 1000000) &&
      doc.incorporated.every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)),
  )
  return value
}
export function backupSummary(value) {
  return {
    songs: value.tracks.length,
    playlists:
      value.playlists.length + (value.recommendations.length ? 1 : 0) + value.smartLists.length,
    favorites: value.tracks.filter((t) => t.favorite).length,
    events: value.history.length,
    feedback: value.preference.feedback.length,
    hasTaste: !!value.preference.taste.text,
    names: [
      ...(value.recommendations.length ? ['歌曲推荐'] : []),
      ...value.playlists.map((p) => p.name),
      ...value.smartLists.map((p) => p.name + '（智能）'),
    ],
  }
}
// Merging untrusted backup data must never grant file access. New tracks are offline
// references until the user locates their audio via the existing file/directory picker.
export function restoreLibrary(store, taste, value) {
  validateBackup(value)
  if (taste.pending || store.library.job.running) throw Error('请等待当前曲库或偏好更新完成')
  const db = store.db
  db.exec('BEGIN IMMEDIATE')
  try {
    const remap = new Map()
    const byPath = db.prepare('SELECT id FROM local_tracks WHERE path_key=?'),
      byId = db.prepare('SELECT id FROM local_tracks WHERE id=?')
    for (const t of value.tracks) {
      const already = byPath.get(pathKey(t.file))?.id,
        same = byId.get(t.id)?.id
      if (already && same && already !== same) throw Error('歌曲标识与现有路径冲突，曲库资料已保留')
      const id = already || same || t.id
      if (already || same)
        db.prepare(
          'UPDATE local_tracks SET favorite=MAX(favorite,?),observedAt=MIN(observedAt,?) WHERE id=?',
        ).run(t.favorite, t.observedAt, id)
      else {
        db.prepare(`INSERT INTO local_tracks(id,path_key,file,title,artist,album,duration,listed,observedAt,size,favorite,importedOrigin,available,awaitingLocation)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,1)`).run(
          id,
          pathKey(t.file),
          t.file,
          t.title,
          t.artist,
          t.album,
          t.duration,
          t.listed,
          t.observedAt,
          t.size,
          t.favorite,
          t.origin,
        )
      }
      remap.set(t.id, id)
    }
    const recommendationOrder = value.recommendationOrder
    for (const [track, joinedAt] of recommendationOrder?.additions ??
      value.recommendations.map((id) => [id, 0]))
      db.prepare('INSERT OR IGNORE INTO restored_recommendations(track,joinedAt) VALUES(?,?)').run(
        remap.get(track),
        joinedAt,
      )
    if (
      recommendationOrder &&
      !store.get('latest-daily-run') &&
      !db.prepare('SELECT 1 FROM batches LIMIT 1').get()
    ) {
      store.library.setPlaylistSort(
        'system-recommendations',
        recommendationOrder.sort,
        recommendationOrder.descending,
      )
      store.set(
        'recommendation-track-order',
        JSON.stringify([
          ...new Set([
            ...value.recommendations.map((id) => remap.get(id)),
            ...(store.library.playlists().find((p) => p.system)?.tracks ?? []),
          ]),
        ]),
      )
    }
    if (value.smartLists.length) {
      db.exec(
        'CREATE TABLE IF NOT EXISTS smart_playlists(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, source TEXT NOT NULL, days INTEGER, comparison TEXT, plays INTEGER NOT NULL)',
      )
      for (const r of value.smartLists) {
        const same = db.prepare('SELECT id FROM smart_playlists WHERE name=?').get(r.name)
        const id =
          same?.id ??
          (db.prepare('SELECT id FROM smart_playlists WHERE id=?').get(r.id) ? randomUUID() : r.id)
        db.prepare(
          'INSERT INTO smart_playlists VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,days=excluded.days,comparison=excluded.comparison,plays=excluded.plays',
        ).run(id, r.name, r.source, r.days, r.comparison, r.plays)
      }
    }
    for (const p of value.playlists) {
      const exists = db.prepare('SELECT id FROM playlists WHERE name=? COLLATE NOCASE').get(p.name)
      const id =
        exists?.id ??
        (db.prepare('SELECT 1 FROM playlists WHERE id=?').get(p.id) ? randomUUID() : p.id)
      if (!exists) db.prepare('INSERT INTO playlists(id,name) VALUES(?,?)').run(id, p.name)
      const old = db
        .prepare(
          'SELECT track,position,addedAt FROM playlist_tracks WHERE playlist=? ORDER BY addedAt,rowid',
        )
        .all(id)
      const additions = new Map(
        (p.additions ?? p.tracks.map((track) => [track, 0])).map(([track, addedAt]) => [
          remap.get(track),
          addedAt,
        ]),
      )
      for (const row of old) if (!additions.has(row.track)) additions.set(row.track, row.addedAt)
      const order = new Set([
        ...p.tracks.map((i) => remap.get(i)),
        ...old.sort((a, b) => a.position - b.position).map((r) => r.track),
      ])
      const positions = new Map([...order].map((track, index) => [track, index]))
      db.prepare('DELETE FROM playlist_tracks WHERE playlist=?').run(id)
      const insert = db.prepare(
        'INSERT INTO playlist_tracks(playlist,track,position,addedAt) VALUES(?,?,?,?)',
      )
      for (const [track, addedAt] of additions) insert.run(id, track, positions.get(track), addedAt)
      if (p.sort) store.library.setPlaylistSort(id, p.sort, p.descending)
    }
    for (const h of value.history) {
      const track = remap.get(h.track)
      const existing = db
        .prepare('SELECT track,playedAt FROM local_play_history WHERE event=?')
        .get(h.event)
      if (existing && (existing.track !== track || existing.playedAt !== h.playedAt))
        throw Error('播放记录标识冲突')
      if (!existing)
        db.prepare('INSERT INTO local_play_history VALUES(?,?,?)').run(h.event, track, h.playedAt)
    }
    db.exec(
      'UPDATE local_tracks SET lastHeardAt=(SELECT MAX(playedAt) FROM local_play_history WHERE track=local_tracks.id)',
    )
    for (const identity of value.preference.feedback)
      db.prepare('INSERT OR IGNORE INTO recording_feedback VALUES(?)').run(identity)
    store.set('draft', value.preference.draft)
    const { text, updatedAt, incorporated } = value.preference.taste
    store.set(
      'restored-taste-document',
      JSON.stringify({ version: 1, text, updatedAt, incorporated }),
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
