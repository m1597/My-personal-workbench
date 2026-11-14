import path from 'node:path'

// Called only on the SQLite backup, before the host opens it or runs recovery.
export function isolateRecommendationProfile(db, directory) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map((r) => r.name),
  )
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(local_tracks)')
      .all()
      .map((r) => r.name),
  )
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const table of [
      'saves',
      'library',
      'music_roots',
      'daily_downloads',
      'pending_trash',
      'favorite_moves',
      'cleanup_renames',
      'favorite_sort_pending',
      'lyric_files',
    ]) {
      if (tables.has(table)) db.exec(`DELETE FROM ${table}`)
    }
    db.exec(`DELETE FROM state WHERE key IN ('root','music-manual-dir','music-recommend-dir','music-category-root')
      OR key LIKE 'shortcut-%';`)
    // Preserve titles, history and playlist IDs for exclusion and count checks. Never
    // carry original file identities or migrate ownership for these metadata-only rows.
    if (!columns.has('awaitingLocation'))
      db.exec('ALTER TABLE local_tracks ADD COLUMN awaitingLocation INTEGER NOT NULL DEFAULT 0')
    const update =
      db.prepare(`UPDATE local_tracks SET file=?,path_key=?,available=0,awaitingLocation=1
      ${columns.has('fileIdentity') ? ',fileIdentity=NULL' : ''} WHERE rowid=?`)
    for (const { rowid } of db.prepare('SELECT rowid FROM local_tracks').all()) {
      const file = path.join(directory, 'metadata-only', rowid + '.mp3')
      update.run(file, file.toLowerCase(), rowid)
    }
    db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)').run('daily-ownership-v1', '1')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
