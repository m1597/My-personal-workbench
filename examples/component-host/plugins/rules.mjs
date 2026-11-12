import { randomUUID } from 'node:crypto'

export function register(bind, getStore) {
  const rules = () => {
    const { db } = getStore()
    db.exec(
      'CREATE TABLE IF NOT EXISTS smart_playlists(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, source TEXT NOT NULL, days INTEGER, comparison TEXT, plays INTEGER NOT NULL)',
    )
    return db
  }
  bind('list', () => rules().prepare('SELECT * FROM smart_playlists ORDER BY rowid').all())
  bind('save', (rule) => {
    if (!rule || typeof rule !== 'object') throw Error('请输入歌单规则')
    const { source, days, comparison, plays } = rule
    const name = typeof rule.name === 'string' ? rule.name.trim() : ''
    if (
      !name ||
      name.length > 100 ||
      !['any', 'daily', 'download', 'local'].includes(source) ||
      (days !== null && (!Number.isSafeInteger(days) || days < 1 || days > 36500)) ||
      !['any', 'eq', 'gte', 'lte'].includes(comparison) ||
      !Number.isSafeInteger(plays) ||
      plays < 0 ||
      plays > 10000000
    )
      throw Error('请检查歌单名称、天数与播放次数')
    const db = rules()
    if (
      rule.id !== null &&
      (typeof rule.id !== 'string' ||
        !db.prepare('SELECT 1 FROM smart_playlists WHERE id=?').get(rule.id))
    )
      throw Error('歌单已移除')
    const id = rule.id ?? randomUUID()
    if (db.prepare('SELECT 1 FROM smart_playlists WHERE name=? AND id<>?').get(name, id))
      throw Error('此歌单名称已使用')
    db.prepare(
      'INSERT INTO smart_playlists VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,source=excluded.source,days=excluded.days,comparison=excluded.comparison,plays=excluded.plays',
    ).run(id, name, source, days, comparison, plays)
    return id
  })
  bind('remove', (id) => {
    if (typeof id !== 'string') throw Error('歌单无效')
    rules().prepare('DELETE FROM smart_playlists WHERE id=?').run(id)
  })
}
