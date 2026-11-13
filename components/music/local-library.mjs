import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { audioFileStat, fileIdentity, confirmedMissing, pathKey } from './local-files.mjs'
import { AlbumLibrary } from './albums.mjs'

const folderKey = (dir) => createHash('sha256').update(pathKey(dir)).digest('hex')
function playlistName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw Error('歌单名称须为 1 至 80 个字符')
  return name.trim()
}
export class LocalLibrary {
  constructor(store) {
    this.store = store
    this.db = store.db
    this.job = { running: false, added: 0, duplicates: 0, failed: 0, cancelled: false }
    this.db.exec('BEGIN')
    try {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS local_tracks(id TEXT PRIMARY KEY, path_key TEXT UNIQUE, file TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,duration REAL NOT NULL,available INTEGER NOT NULL DEFAULT 1,unplayable INTEGER NOT NULL DEFAULT 0)',
      )
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS music_roots(dir TEXT PRIMARY KEY COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS playlist_tracks(
          playlist TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          track TEXT NOT NULL REFERENCES local_tracks(id) ON DELETE CASCADE,
          PRIMARY KEY(playlist,track)
        );
        CREATE TABLE IF NOT EXISTS recording_copies(version TEXT NOT NULL, local TEXT NOT NULL, automatic INTEGER NOT NULL, source TEXT, platform TEXT, sourceId TEXT, quality TEXT,digest TEXT,PRIMARY KEY(version,local));
        CREATE TABLE IF NOT EXISTS recommended_items(item TEXT PRIMARY KEY, local TEXT, error TEXT DEFAULT '');
        CREATE INDEX IF NOT EXISTS recording_copy_local ON recording_copies(local);
        CREATE INDEX IF NOT EXISTS playlist_track_lookup ON playlist_tracks(track);
      `)
      if (
        !this.db
          .prepare('PRAGMA table_info(playlist_tracks)')
          .all()
          .some((c) => c.name === 'position')
      ) {
        this.db.exec(`ALTER TABLE playlist_tracks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE playlist_tracks ADD COLUMN addedAt INTEGER NOT NULL DEFAULT 0;
          UPDATE playlist_tracks SET position=rowid;
          ALTER TABLE playlists ADD COLUMN sort TEXT NOT NULL DEFAULT 'custom';
          ALTER TABLE playlists ADD COLUMN descending INTEGER NOT NULL DEFAULT 0;`)
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS online_tracks(
        id TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,duration REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS online_recording_sources (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, platform TEXT NOT NULL, recording TEXT NOT NULL,
        quality TEXT NOT NULL, query TEXT NOT NULL, identifiers TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS copy_by_platform_recording ON recording_copies(platform,sourceId);`)
      if (
        this.db
          .prepare('PRAGMA foreign_key_list(playlist_tracks)')
          .all()
          .some((fk) => fk.table === 'local_tracks')
      ) {
        // A playlist can address either kind of recording. Keep SQLite cascades for
        // local removals and preserve rowids used as tie breakers for old playlists.
        this.db.exec(`CREATE TABLE playlist_recordings(id TEXT PRIMARY KEY);
          INSERT INTO playlist_recordings SELECT id FROM local_tracks;
          CREATE TRIGGER register_local_playlist_recording AFTER INSERT ON local_tracks BEGIN
            INSERT OR IGNORE INTO playlist_recordings VALUES(NEW.id); END;
          CREATE TRIGGER unregister_local_playlist_recording AFTER DELETE ON local_tracks BEGIN
            DELETE FROM playlist_recordings WHERE id=OLD.id; END;
          CREATE TRIGGER register_online_playlist_recording AFTER INSERT ON online_tracks BEGIN
            INSERT INTO playlist_recordings VALUES(NEW.id); END;
          CREATE TRIGGER unregister_online_playlist_recording AFTER DELETE ON online_tracks BEGIN
            DELETE FROM playlist_recordings WHERE id=OLD.id; END;
          ALTER TABLE playlist_tracks RENAME TO previous_playlist_tracks;
          CREATE TABLE playlist_tracks(
            playlist TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track TEXT NOT NULL REFERENCES playlist_recordings(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0, addedAt INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(playlist,track));
          INSERT INTO playlist_tracks(rowid,playlist,track,position,addedAt)
            SELECT rowid,playlist,track,position,addedAt FROM previous_playlist_tracks;
          DROP TABLE previous_playlist_tracks;
          CREATE INDEX playlist_track_lookup ON playlist_tracks(track);`)
      }
      if (
        !this.db
          .prepare('PRAGMA table_info(local_tracks)')
          .all()
          .some((col) => col.name === 'listed')
      )
        this.db.exec('ALTER TABLE local_tracks ADD COLUMN listed INTEGER NOT NULL DEFAULT 1')
      if (
        !this.db
          .prepare('PRAGMA table_info(recommended_items)')
          .all()
          .some((c) => c.name === 'diagnosis')
      ) {
        this.db.exec("ALTER TABLE recommended_items ADD COLUMN diagnosis TEXT NOT NULL DEFAULT ''")
        this.db
          .prepare(
            "UPDATE recommended_items SET error='请重新核对该录音的保存许可',diagnosis='unknown' WHERE error=?",
          )
          .run('音乐源未允许永久保存此录音，或仅提供试听')
      }
      const trackColumns = this.db.prepare('PRAGMA table_info(local_tracks)').all()
      if (!trackColumns.some((column) => column.name === 'albumArtist'))
        this.db.exec(`ALTER TABLE local_tracks ADD COLUMN albumArtist TEXT;
          ALTER TABLE local_tracks ADD COLUMN discNumber INTEGER;
          ALTER TABLE local_tracks ADD COLUMN trackNumber INTEGER;`)
      if (
        !this.db
          .prepare('PRAGMA table_info(recommended_items)')
          .all()
          .some((c) => c.name === 'summary')
      )
        this.db.exec("ALTER TABLE recommended_items ADD COLUMN summary TEXT NOT NULL DEFAULT ''")
      if (
        !this.db
          .prepare('PRAGMA table_info(recommended_items)')
          .all()
          .some((c) => c.name === 'attemptSources')
      )
        this.db.exec(
          "ALTER TABLE recommended_items ADD COLUMN attemptSources TEXT NOT NULL DEFAULT ''",
        )
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS restored_recommendations(track TEXT PRIMARY KEY REFERENCES local_tracks(id) ON DELETE CASCADE)',
      )
      if (
        !this.db
          .prepare('PRAGMA table_info(recommended_items)')
          .all()
          .some((c) => c.name === 'joinedAt')
      ) {
        this.db.exec(`ALTER TABLE recommended_items ADD COLUMN joinedAt INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE restored_recommendations ADD COLUMN joinedAt INTEGER NOT NULL DEFAULT 0;
          CREATE TRIGGER recommendation_joined AFTER UPDATE OF local ON recommended_items
          WHEN NEW.local IS NOT NULL AND OLD.local IS NOT NEW.local
          BEGIN UPDATE recommended_items SET joinedAt=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE item=NEW.item; END;`)
      }
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS recommended_local_track ON recommended_items(local);
        CREATE TABLE IF NOT EXISTS removed_recommendation_members(track TEXT PRIMARY KEY REFERENCES local_tracks(id) ON DELETE CASCADE);
        DROP VIEW IF EXISTS recommendation_playlist_members;
        CREATE VIEW recommendation_playlist_members AS
          SELECT track, source, position,joinedAt FROM (
            SELECT r.local AS track, 0 AS source, MIN(r.rowid) AS position, MIN(r.joinedAt) AS joinedAt
              FROM recommended_items r JOIN local_tracks t ON t.id=r.local
              JOIN items i ON i.id=r.item JOIN batches b ON b.id=i.batch
              WHERE i.status='已入库' AND b.id=COALESCE(
                (SELECT value FROM state WHERE key='latest-daily-run'),
                (SELECT id FROM batches ORDER BY rowid DESC LIMIT 1))
              GROUP BY r.local
            UNION ALL
            SELECT s.track, 1 AS source, s.rowid AS position,s.joinedAt FROM restored_recommendations s
              WHERE NOT EXISTS (SELECT 1 FROM state WHERE key='latest-daily-run')
              AND NOT EXISTS (SELECT 1 FROM batches)
              AND NOT EXISTS (SELECT 1 FROM recommended_items r WHERE r.local=s.track)
          ) AS members WHERE NOT EXISTS (SELECT 1 FROM removed_recommendation_members x WHERE x.track=members.track);
      `)
      if (!trackColumns.some((column) => column.name === 'language'))
        this.db.exec('ALTER TABLE local_tracks ADD COLUMN language TEXT')
      if (!trackColumns.some((column) => column.name === 'fileIdentity'))
        this.db.exec('ALTER TABLE local_tracks ADD COLUMN fileIdentity TEXT')
      if (!trackColumns.some((column) => column.name === 'hiddenFromRecent'))
        this.db.exec(
          'ALTER TABLE local_tracks ADD COLUMN hiddenFromRecent INTEGER NOT NULL DEFAULT 0',
        )
      if (!trackColumns.some((column) => column.name === 'observedAt')) {
        this.db.exec(`ALTER TABLE local_tracks ADD COLUMN observedAt INTEGER;
          ALTER TABLE local_tracks ADD COLUMN lastHeardAt INTEGER;
          ALTER TABLE local_tracks ADD COLUMN size INTEGER;`)
        this.db.prepare('UPDATE local_tracks SET observedAt=?').run(Date.now())
      }
      if (!trackColumns.some((column) => column.name === 'favorite')) {
        this.db.exec(`ALTER TABLE local_tracks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE local_tracks ADD COLUMN importedOrigin TEXT NOT NULL DEFAULT 'local';
          CREATE TABLE local_play_history(event TEXT PRIMARY KEY, track TEXT NOT NULL REFERENCES local_tracks(id) ON DELETE CASCADE, playedAt INTEGER NOT NULL);
          CREATE INDEX play_history_time ON local_play_history(playedAt DESC);
          CREATE INDEX play_history_track ON local_play_history(track);
          INSERT INTO local_play_history SELECT 'legacy-'||id, id, lastHeardAt FROM local_tracks WHERE lastHeardAt IS NOT NULL;`)
        const root = store.get('root')
        if (root)
          for (const row of this.db.prepare('SELECT file FROM library').all())
            this.db
              .prepare('UPDATE local_tracks SET favorite=1 WHERE path_key=?')
              .run(pathKey(path.join(root, row.file)))
      }
      if (!trackColumns.some((column) => column.name === 'awaitingLocation'))
        this.db.exec(
          'ALTER TABLE local_tracks ADD COLUMN awaitingLocation INTEGER NOT NULL DEFAULT 0',
        )
      const legacyColumns = new Set(
        this.db
          .prepare('PRAGMA table_info(recording_versions)')
          .all()
          .map((col) => col.name),
      )
      this.db.exec(`CREATE VIEW IF NOT EXISTS online_local_copies AS
        SELECT s.id AS online,t.id AS local FROM online_recording_sources s
        JOIN recording_copies c ON c.platform=s.platform AND c.sourceId=s.recording
        JOIN local_tracks t ON t.id=c.local WHERE t.available=1 AND t.unplayable=0 AND t.awaitingLocation=0;`)
      if (legacyColumns.size) {
        // Legacy mappings retain provenance but cannot prove the identity of current file bytes.
        const columns = [
          'version',
          'local',
          'automatic',
          ...['source', 'platform', 'sourceId', 'quality'].filter((name) =>
            legacyColumns.has(name),
          ),
        ].join(',')
        this.db.exec(`INSERT OR IGNORE INTO recording_copies(${columns})
          SELECT ${columns} FROM recording_versions;
          DROP TABLE recording_versions;`)
      }
      if (!store.get('local-index-v1')) {
        for (const row of this.db.prepare('SELECT track,file FROM library').all())
          this.saved(row.track, row.file)
        store.set('local-index-v1', 1)
      }
      this.albums = new AlbumLibrary(this.db)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  saved(track, filename) {
    const t = this.store.metadata(track),
      root = this.store.get('root')
    if (t && root && path.basename(filename) === filename) {
      this.upsert({
        file: path.join(root, filename),
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration ?? 20,
      })
      this.db
        .prepare('UPDATE local_tracks SET favorite=1 WHERE path_key=?')
        .run(pathKey(path.join(root, filename)))
    }
  }
  heard(id, time = Date.now()) {
    this.db.exec('BEGIN')
    try {
      if (
        this.db
          .prepare(
            'UPDATE local_tracks SET lastHeardAt=MAX(COALESCE(lastHeardAt,?),?),hiddenFromRecent=0 WHERE id=?',
          )
          .run(time, time, id).changes
      )
        this.db.prepare('INSERT INTO local_play_history VALUES(?,?,?)').run(randomUUID(), id, time)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
  upsert(row, replacing) {
    const key = pathKey(row.file)
    const existing = this.db.prepare('SELECT id FROM local_tracks WHERE path_key=?').get(key)
    if (replacing && existing && existing.id !== replacing) throw Error('所选文件已经在曲库中')
    const values = [
      key,
      row.file,
      row.title,
      row.artist,
      row.album,
      row.duration,
      typeof row.language === 'string' ? row.language.trim().slice(0, 80) : null,
      row.albumArtist ?? null,
      row.discNumber ?? null,
      row.trackNumber ?? null,
    ]
    if (replacing || existing)
      this.db
        .prepare(
          'UPDATE local_tracks SET path_key=?,file=?,title=?,artist=?,album=?,duration=?,language=?,albumArtist=?,discNumber=?,trackNumber=?,size=?,fileIdentity=?,available=1,unplayable=0,listed=1,awaitingLocation=0 WHERE id=?',
        )
        .run(...values, row.size ?? null, row.identity ?? null, replacing ?? existing.id)
    else
      this.db
        .prepare(
          'INSERT INTO local_tracks(path_key,file,title,artist,album,duration,language,albumArtist,discNumber,trackNumber,id,observedAt,size,fileIdentity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(...values, 'local-' + randomUUID(), Date.now(), row.size ?? null, row.identity ?? null)
    this.changed?.()
    return !!(existing || replacing)
  }
  list() {
    const rows = this.db
      .prepare(
        `SELECT id,title,artist,album,discNumber,trackNumber,duration,available,listed,file,observedAt,lastHeardAt,hiddenFromRecent,size,favorite,
        (SELECT COUNT(*) FROM local_play_history h WHERE h.track=local_tracks.id) AS playCount,
        COALESCE((SELECT CASE MAX(v.automatic) WHEN 1 THEN 'daily' WHEN 0 THEN 'download' END FROM recording_copies v WHERE v.local=local_tracks.id),importedOrigin) AS origin,
        (SELECT source || ' · ' || quality FROM recording_copies v WHERE v.local=local_tracks.id AND v.automatic=1 LIMIT 1) AS recommendationSource FROM local_tracks ORDER BY title COLLATE NOCASE,artist,id`,
      )
      .all()
    const directories = new Map()
    const names = new Map()
    for (const row of rows) {
      if (!row.listed) continue
      const dir = path.dirname(row.file)
      const key = pathKey(dir)
      if (directories.has(key)) continue
      const name = path.basename(dir) || dir
      const folder = { id: folderKey(dir), name }
      directories.set(key, folder)
      const group = names.get(name.toLowerCase()) || []
      group.push({ dir, folder })
      names.set(name.toLowerCase(), group)
    }
    for (const group of names.values()) {
      if (group.length < 2) continue
      // Add the shortest unique path suffix, including the drive when necessary.
      const parts = group.map(({ dir }) => dir.split(path.sep))
      for (const [i, { folder }] of group.entries()) {
        for (let depth = 2; depth <= parts[i].length; depth++) {
          const suffix = parts[i].slice(-depth).join(path.sep)
          folder.name = suffix
          if (
            !parts.some(
              (other, j) =>
                j !== i &&
                other.slice(-depth).join(path.sep).toLowerCase() === suffix.toLowerCase(),
            )
          )
            break
        }
      }
    }
    return rows.map(({ file, ...row }) => ({
      ...row,
      folder: row.listed ? directories.get(pathKey(path.dirname(file))) : null,
    }))
  }
  folderMembers(id) {
    const members = this.db
      .prepare('SELECT id,file FROM local_tracks WHERE listed=1')
      .all()
      .filter((row) => folderKey(path.dirname(row.file)) === id)
    if (!members.length) throw Error('未找到文件夹')
    return members
  }
  playlists() {
    const lists = this.db
      .prepare('SELECT id,name,sort,descending FROM playlists ORDER BY rowid')
      .all()
    const byId = new Map(
      lists.map((list) => [
        list.id,
        { ...list, descending: !!list.descending, tracks: [], additions: [] },
      ]),
    )
    for (const row of this.db
      .prepare('SELECT playlist,track FROM playlist_tracks ORDER BY position,rowid')
      .all())
      byId.get(row.playlist).tracks.push(row.track)
    for (const row of this.db
      .prepare('SELECT playlist,track,addedAt FROM playlist_tracks ORDER BY addedAt,rowid')
      .all())
      byId.get(row.playlist).additions.push([row.track, row.addedAt])
    const members = this.db
      .prepare(
        'SELECT track,joinedAt FROM recommendation_playlist_members ORDER BY source,position',
      )
      .all()
    const current = new Set(members.map((row) => row.track))
    const systemOrder = this.store.get('recommendation-track-order')
    const systemTracks = systemOrder
      ? JSON.parse(systemOrder).filter((id) => current.delete(id))
      : []
    for (const track of current) systemTracks.push(track)
    return [
      ...(systemTracks.length ||
      this.db.prepare("SELECT 1 FROM state WHERE key='latest-daily-run'").get() ||
      this.db.prepare('SELECT 1 FROM removed_recommendation_members LIMIT 1').get()
        ? [
            {
              id: 'system-recommendations',
              name: '歌曲推荐',
              system: true,
              tracks: systemTracks,
              additions: members
                .sort((a, b) => a.joinedAt - b.joinedAt)
                .map((row) => [row.track, row.joinedAt]),
              sort: this.store.get('recommendation-track-sort') || 'custom',
              descending: this.store.get('recommendation-track-descending') === '1',
            },
          ]
        : []),
      ...byId.values(),
    ]
  }
  createPlaylist(name) {
    const id = randomUUID()
    if (
      !this.db
        .prepare('INSERT OR IGNORE INTO playlists(id,name) VALUES(?,?)')
        .run(id, playlistName(name)).changes
    )
      throw Error('已有同名歌单')
    return id
  }
  renamePlaylist(id, name) {
    if (
      !this.db
        .prepare('UPDATE OR IGNORE playlists SET name=? WHERE id=?')
        .run(playlistName(name), id).changes
    )
      throw Error('已有同名歌单或歌单已移除')
  }
  setPlaylistSort(id, sort, descending) {
    if (
      typeof id !== 'string' ||
      !['custom', 'added', 'title', 'artist'].includes(sort) ||
      typeof descending !== 'boolean'
    )
      throw Error('歌单排序无效')
    if (id === 'system-recommendations') {
      this.store.set('recommendation-track-sort', sort)
      this.store.set('recommendation-track-descending', Number(sort !== 'custom' && descending))
      return
    }
    if (
      !this.db
        .prepare('UPDATE playlists SET sort=?,descending=? WHERE id=?')
        .run(sort, Number(sort !== 'custom' && descending), id).changes
    )
      throw Error('请选择自建歌单')
  }
  movePlaylistTrack(id, track, target, after) {
    if (
      [id, track, target].some((key) => typeof key !== 'string') ||
      typeof after !== 'boolean' ||
      track === target
    )
      throw Error('歌单拖动无效')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const system =
        id === 'system-recommendations' ? this.playlists().find((p) => p.system) : undefined
      if (
        (system?.sort ?? this.db.prepare('SELECT sort FROM playlists WHERE id=?').get(id)?.sort) !==
        'custom'
      )
        throw Error('请切换到自定义顺序')
      const rows =
        system?.tracks ??
        this.db
          .prepare('SELECT track FROM playlist_tracks WHERE playlist=? ORDER BY position,rowid')
          .all(id)
          .map((row) => row.track)
      if (!rows.includes(track) || !rows.includes(target)) throw Error('歌曲已移除')
      rows.splice(rows.indexOf(track), 1)
      rows.splice(rows.indexOf(target) + Number(after), 0, track)
      if (system) this.store.set('recommendation-track-order', JSON.stringify(rows))
      else {
        const update = this.db.prepare(
          'UPDATE playlist_tracks SET position=? WHERE playlist=? AND track=?',
        )
        for (const [i, key] of rows.entries()) update.run(i, id, key)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  deletePlaylist(id) {
    if (!this.db.prepare('DELETE FROM playlists WHERE id=?').run(id).changes)
      throw Error('未找到歌单')
  }
  removeFolder(id) {
    if (this.worker) throw Error('请等待当前导入结束')
    const rows = this.folderMembers(id)
    const retained = new Set(this.playlists().flatMap((list) => list.tracks))
    for (const row of this.db.prepare('SELECT id FROM local_tracks WHERE favorite=1').all())
      retained.add(row.id)
    const detached = this.db.prepare('UPDATE local_tracks SET listed=0 WHERE id=?')
    const removed = []
    for (const row of rows) {
      if (retained.has(row.id)) detached.run(row.id)
      else {
        this.remove(row.id)
        removed.push(row.id)
      }
    }
    this.db.prepare('DELETE FROM music_roots WHERE dir=?').run(path.dirname(rows[0].file))
    return removed
  }
  rememberOnline({ id, title, artist, album, duration }) {
    if (
      !/^online-recording-[a-f0-9]{64}$/.test(id) ||
      [title, artist, album].some((s) => typeof s !== 'string' || s.length > 1024) ||
      !title.trim() ||
      !Number.isFinite(duration) ||
      duration < 0
    )
      throw Error('在线录音资料无效')
    this.db
      .prepare(`INSERT INTO online_tracks VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,artist=excluded.artist,album=excluded.album,duration=excluded.duration`)
      .run(id, title, artist, album, duration)
    return id
  }
  setMembership(playlist, tracks, added) {
    const ids = Array.isArray(tracks) ? tracks : [tracks]
    if (
      typeof playlist !== 'string' ||
      !ids.length ||
      ids.some((id) => typeof id !== 'string') ||
      typeof added !== 'boolean'
    )
      throw Error('歌单操作无效')
    const system = playlist === 'system-recommendations'
    if (system && added) throw Error('歌曲推荐歌单只接受推荐入库的歌曲')
    if (!system && !this.db.prepare('SELECT 1 FROM playlists WHERE id=?').get(playlist))
      throw Error('未找到歌单')
    const data = JSON.stringify(ids)
    let removal
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (
        this.db
          .prepare(
            'SELECT 1 FROM json_each(?) j LEFT JOIN playlist_recordings t ON t.id=j.value WHERE t.id IS NULL LIMIT 1',
          )
          .get(data)
      )
        throw Error('歌曲已移除')
      if (!added) {
        const list = this.playlists().find((row) => row.id === playlist)
        const selected = new Set(ids)
        const entries = system
          ? (list?.additions.filter(([id]) => selected.has(id)) ?? [])
          : this.db
              .prepare(
                'SELECT track,addedAt,rowid FROM playlist_tracks WHERE playlist=? AND track IN (SELECT value FROM json_each(?)) ORDER BY addedAt,rowid',
              )
              .all(playlist, data)
              .map(({ track, addedAt, rowid }) => [track, addedAt, rowid])
        if (entries.length)
          removal = {
            playlist,
            order: list.tracks,
            entries,
            run: this.store.get('latest-daily-run'),
            token: randomUUID(),
            expires: Date.now() + 10_000,
          }
      }
      if (system)
        this.db
          .prepare(
            'INSERT OR IGNORE INTO removed_recommendation_members SELECT track FROM recommendation_playlist_members WHERE track IN (SELECT value FROM json_each(?))',
          )
          .run(data)
      else if (added)
        this.db
          .prepare(
            'INSERT OR IGNORE INTO playlist_tracks(playlist,track,position,addedAt) SELECT ?, value, ? + key, ? FROM json_each(?) ORDER BY key',
          )
          .run(
            playlist,
            this.db
              .prepare(
                'SELECT COALESCE(MAX(position)+1,0) AS next FROM playlist_tracks WHERE playlist=?',
              )
              .get(playlist).next,
            Date.now(),
            data,
          )
      else
        this.db
          .prepare(
            'DELETE FROM playlist_tracks WHERE playlist=? AND track IN (SELECT value FROM json_each(?))',
          )
          .run(playlist, data)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.changed?.()
    if (removal) {
      this.lastRemoval = removal
      return { token: removal.token, count: removal.entries.length, expires: removal.expires }
    }
    return null
  }
  undoMembership(token) {
    const saved = this.lastRemoval
    if (!saved || saved.token !== token || Date.now() >= saved.expires) throw Error('撤销时间已过')
    const { playlist, entries } = saved
    const system = playlist === 'system-recommendations'
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.playlists().find((row) => row.id === playlist)?.tracks
      if (!current || (system && saved.run !== this.store.get('latest-daily-run')))
        throw Error('原歌单已更新')
      const present = new Set(current)
      const restored = new Set()
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO playlist_tracks(rowid,playlist,track,position,addedAt) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM playlist_tracks WHERE rowid=?) THEN ? END,?,id,0,? FROM playlist_recordings WHERE id=?',
      )
      const unhide = this.db.prepare('DELETE FROM removed_recommendation_members WHERE track=?')
      for (const [id, addedAt, originalRow] of entries) {
        if (present.has(id)) continue
        const result = system
          ? unhide.run(id)
          : insert.run(originalRow, originalRow, playlist, addedAt, id)
        if (result.changes) restored.add(id)
      }
      // Keep current members in their current order. Anchor each restored group
      // to its nearest surviving successor, or to the last surviving predecessor.
      const before = new Map()
      let pending = [],
        last
      for (const id of saved.order) {
        if (restored.has(id)) pending.push(id)
        else if (present.has(id)) {
          if (pending.length) before.set(id, pending)
          pending = []
          last = id
        }
      }
      const order = last ? [] : [...pending]
      for (const id of current) {
        for (const restoredId of before.get(id) ?? []) order.push(restoredId)
        order.push(id)
        if (id === last) for (const restoredId of pending) order.push(restoredId)
      }
      if (system) this.store.set('recommendation-track-order', JSON.stringify(order))
      else {
        const update = this.db.prepare(
          'UPDATE playlist_tracks SET position=? WHERE playlist=? AND track=?',
        )
        for (const [position, id] of order.entries()) update.run(position, playlist, id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.lastRemoval = null
    this.changed?.()
  }
  row(id) {
    const row = this.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(id)
    if (!row) throw Error('歌曲已移除')
    return row
  }
  async onlineCopy(id) {
    const rows = this.db
      .prepare(
        'SELECT t.* FROM online_local_copies c JOIN local_tracks t ON t.id=c.local WHERE c.online=? ORDER BY t.id',
      )
      .all(id)
    for (const row of rows) if (await this.verify(row)) return row
    return null
  }
  async verify(row) {
    if (row.awaitingLocation) return false
    const stat = await audioFileStat(row.file)
    const size = stat ? Number(stat.size) : null
    const identity = fileIdentity(stat)
    const ok = !row.unplayable && size !== null
    if (
      size === null &&
      (row.recommendationMember || (row.lastHeardAt != null && !row.hiddenFromRecent)) &&
      (await confirmedMissing(row.file))
    ) {
      if (row.recommendationMember)
        this.db
          .prepare(
            'INSERT OR IGNORE INTO removed_recommendation_members SELECT id FROM local_tracks WHERE id=? AND file=? AND awaitingLocation=0',
          )
          .run(row.id, row.file)
      if (row.lastHeardAt != null)
        this.db
          .prepare(
            'UPDATE local_tracks SET hiddenFromRecent=1 WHERE id=? AND file=? AND lastHeardAt=? AND awaitingLocation=0',
          )
          .run(row.id, row.file, row.lastHeardAt)
    }
    if (
      Number(ok) !== row.available ||
      size !== row.size ||
      (identity && identity !== row.fileIdentity)
    )
      this.db
        .prepare(
          'UPDATE local_tracks SET available=?,size=?,fileIdentity=COALESCE(?,fileIdentity) WHERE id=? AND file=?',
        )
        .run(Number(ok), size, identity, row.id, row.file)
    return ok
  }
  async refresh() {
    this.refreshing ??= (async () => {
      const rows = this.db
        .prepare(
          'SELECT id,file,fileIdentity,available,unplayable,size,awaitingLocation,lastHeardAt,hiddenFromRecent, m.track AS recommendationMember FROM local_tracks LEFT JOIN recommendation_playlist_members m ON m.track=local_tracks.id',
        )
        .all()
      for (let i = 0; i < rows.length; i += 16)
        await Promise.all(rows.slice(i, i + 16).map((r) => this.verify(r)))
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }
  remove(id) {
    this.db.prepare('DELETE FROM local_tracks WHERE id=?').run(id)
  }
  start(paths, folder, replacing) {
    if (this.worker) throw Error('导入正在进行')
    if (replacing) this.row(replacing)
    const worker = new Worker(new URL('./library-worker.mjs', import.meta.url), {
      workerData: { paths, folder },
    })
    if (folder)
      this.db
        .prepare('INSERT OR IGNORE INTO music_roots(dir) VALUES(?)')
        .run(path.resolve(paths[0]))
    this.worker = worker
    const job = {
      started: true,
      running: true,
      added: 0,
      duplicates: 0,
      failed: 0,
      cancelled: false,
    }
    this.job = job
    worker.on('message', ({ rows, failed }) => {
      if (job.cancelled) return
      job.failed += failed
      for (const row of rows) {
        try {
          if (this.upsert(row, replacing)) job.duplicates++
          else job.added++
        } catch {
          job.failed++
        }
      }
    })
    worker.on('error', () => {
      job.failed++
    })
    worker.on('exit', () => {
      job.running = false
      this.worker = null
    })
  }
  cancel() {
    if (this.worker) {
      this.job.cancelled = true
      void this.worker.terminate()
    }
  }
  scanFolder(dir) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./library-worker.mjs', import.meta.url), {
        workerData: { paths: [dir], folder: true },
      })
      const found = []
      worker.on('message', ({ rows }) => found.push(...rows))
      worker.once('error', reject)
      worker.once('exit', (code) => (code ? reject(Error('无法扫描所选目录')) : resolve(found)))
    })
  }
}
