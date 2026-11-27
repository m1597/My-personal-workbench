import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { referenceMetadata, resolveReferences } from './music-references.mjs'

// The profile text and the exact set of incorporated signals are published together.
export class MusicTaste {
  constructor(store, root, request) {
    this.store = store
    this.file = path.join(root, 'music-taste.json')
    this.request = request
    this.pending = null
    this.controller = null
    this.error = ''
    this.referenceCache = new Map()
  }
  exclusions() {
    return JSON.parse(this.store.get('taste-exclusions') || '[]')
  }
  references(selection) {
    return resolveReferences(this.store, selection, this.exclusions())
  }
  async referenceProfile(groups, signal) {
    signal.throwIfAborted()
    const consented = () => this.store.get('taste-consent') === '1'
    if (!groups.length || !consented()) return ''
    const connection = () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            this.store.connections?.resolve('music.model') ??
              this.store.connections?.read?.('music.model') ??
              this.store.get('recommendation-providers') ??
              '',
          ),
        )
        .digest('hex')
    const account = connection()
    const check = () => {
      signal.throwIfAborted()
      if (!consented()) throw Error('已撤回审美资料授权')
      if (account !== connection()) throw Error('模型连接已更改，请重新提交')
    }
    const seen = new Set()
    const summaries = []
    for (const group of groups) {
      if (!group.tracks.size) continue
      check()
      const unique = []
      for (const [id, metadata] of group.tracks) {
        if (!seen.has(id)) unique.push(metadata)
        seen.add(id)
      }
      const collection = { name: group.name, kind: group.kind }
      const fingerprint = createHash('sha256')
        .update(account)
        .update(JSON.stringify([collection, unique]))
        .digest('hex')
      let profile = this.referenceCache.get(group.id)?.get(fingerprint)
      if (profile === undefined) {
        profile = ''
        for (let i = 0; i < unique.length; i += 50) {
          check()
          profile = (
            await this.request(
              { collection, previous: profile, changes: unique.slice(i, i + 50) },
              signal,
            )
          ).slice(0, 240)
          check()
        }
        // Keep both a source's standalone summary and recent overlap variants.
        const variants = this.referenceCache.get(group.id) ?? new Map()
        if (variants.size >= 4) variants.delete(variants.keys().next().value)
        variants.set(fingerprint, profile)
        this.referenceCache.set(group.id, variants)
        if (this.referenceCache.size > 256)
          this.referenceCache.delete(this.referenceCache.keys().next().value)
      }
      summaries.push({
        ...collection,
        count: group.tracks.size,
        uniqueRecordings: unique.length,
        profile,
      })
    }
    if (!summaries.length) return ''
    // Keep ordinary selections verbatim. For very large selections, fold groups in bounded
    // chunks so every selected collection contributes, including those beyond the first chunk.
    let level = summaries
    while (JSON.stringify(level).length > 12000) {
      const next = []
      for (let start = 0; start < level.length; start += 12) {
        check()
        const collections = level.slice(start, start + 12)
        const profile = await this.request({ collections }, signal)
        check()
        next.push({
          name: '所选集合摘要',
          kind: 'combined',
          profile: profile.slice(0, 240),
          uniqueRecordings: collections.reduce((sum, group) => sum + group.uniqueRecordings, 0),
        })
      }
      level = next
    }
    return JSON.stringify(level)
  }
  setExcluded(kind, id, excluded) {
    if (
      !['folder', 'playlist'].includes(kind) ||
      typeof id !== 'string' ||
      id.length > 120 ||
      typeof excluded !== 'boolean'
    )
      throw Error('无效的推荐偏好设置')
    const current = this.exclusions()
    const next = current.filter((row) => row.kind !== kind || row.id !== id)
    const alreadyExcluded = next.length !== current.length
    if (excluded === alreadyExcluded) return
    if (excluded) {
      const name =
        kind === 'folder'
          ? this.store.library.list().find((t) => t.folder?.id === id)?.folder.name
          : this.store.db.prepare('SELECT name FROM playlists WHERE id=?').get(id)?.name
      if (!name) throw Error('找不到要排除的文件夹或歌单')
      next.push({ kind, id, name })
    }
    this.store.set('taste-exclusions', JSON.stringify(next))
    this.controller?.abort()
  }
  policy() {
    return this.exclusions()
      .map(({ id }) => id)
      .sort()
      .join(',')
  }
  document() {
    const restored = this.store.get('restored-taste-document')
    if (restored) return JSON.parse(restored)
    if (!existsSync(this.file))
      return { text: this.store.get('taste-profile'), updatedAt: '', incorporated: [] }
    const doc = JSON.parse(readFileSync(this.file, 'utf8'))
    if (doc.version !== 1 || typeof doc.text !== 'string' || !Array.isArray(doc.incorporated))
      throw Error('审美文档无法读取')
    return doc
  }
  // Fingerprints are local only. Identical metadata across duplicate files contributes once.
  delta(doc) {
    const excluded = this.exclusions()
    const folders = new Set(excluded.filter((row) => row.kind === 'folder').map((row) => row.id))
    const playlists = excluded.filter((row) => row.kind === 'playlist').map((row) => row.id)
    const seen = new Set(doc.incorporated)
    const pending = []
    const tracks = this.store.db
      .prepare(`SELECT t.title,t.artist,t.album,t.favorite,t.file,
      EXISTS(SELECT 1 FROM playlist_tracks p WHERE p.track=t.id OR p.track IN (SELECT online FROM online_local_copies WHERE local=t.id)) AS liked,
      EXISTS(SELECT 1 FROM playlist_tracks p WHERE (p.track=t.id OR p.track IN (SELECT online FROM online_local_copies WHERE local=t.id)) AND p.playlist IN (SELECT value FROM json_each(?))) AS excluded,
      (t.importedOrigin='daily' OR EXISTS(SELECT 1 FROM recording_copies v WHERE v.local=t.id AND v.automatic=1)) AS automatic
      FROM local_tracks t ORDER BY t.rowid`)
      .all(JSON.stringify(playlists))
    for (const track of tracks) {
      const meta = referenceMetadata(track)
      if (!meta) continue
      const suppressed =
        track.excluded || (folders.size && folders.has(this.store.library.folderId(track.file)))
      for (const signal of [
        ...(!suppressed && !track.automatic ? ['曲库新增'] : []),
        ...(!suppressed && track.liked ? ['主动加入自建歌单'] : []),
        ...(track.favorite ? ['主动收藏'] : []),
      ]) {
        const data = { ...meta, signal }
        const key = createHash('sha256').update(JSON.stringify(data)).digest('hex')
        if (!seen.has(key)) {
          seen.add(key)
          pending.push({ key, data })
        }
      }
    }
    return pending
  }
  changes() {
    const doc = this.document()
    const policy = this.policy()
    if (!policy && !doc.policy) return { doc, delta: this.delta(doc), rebuild: false }
    const all = this.delta({ incorporated: [] })
    const keys = new Set(all.map((entry) => entry.key))
    const rebuild = policy !== (doc.policy || '') || doc.incorporated.some((key) => !keys.has(key))
    const seen = new Set(doc.incorporated)
    return rebuild
      ? { doc: { text: '', updatedAt: '', incorporated: [], policy }, delta: all, rebuild }
      : { doc, delta: all.filter((entry) => !seen.has(entry.key)), rebuild }
  }
  status() {
    const consented = this.store.get('taste-consent') === '1'
    const playlists = this.store.db.prepare('SELECT name FROM playlists WHERE id=?')
    const exclusions = this.exclusions().flatMap((entry) => {
      if (entry.kind === 'folder') return [entry]
      const list = playlists.get(entry.id)
      return list ? [{ ...entry, name: list.name }] : []
    })
    try {
      const { doc, delta } = consented ? this.changes() : { doc: this.document(), delta: [] }
      const pending = delta.length
      return {
        exclusions,
        consented,
        updatedAt: doc.updatedAt,
        pending,
        error: this.error,
        status: !consented
          ? '未授权'
          : this.pending
            ? '更新中'
            : this.error
              ? '待重试'
              : pending
                ? '待更新'
                : doc.text
                  ? '已更新'
                  : '等待曲库歌曲',
      }
    } catch {
      return {
        exclusions,
        consented,
        updatedAt: '',
        pending: 0,
        error: '审美文档无法读取',
        status: '待重试',
      }
    }
  }
  consent(value) {
    if (typeof value !== 'boolean') throw Error('授权状态无效')
    this.store.set('taste-consent', value ? '1' : '0')
    if (!value) {
      this.referenceCache = new Map()
      this.controller?.abort()
    }
  }
  async refresh(signal) {
    signal?.throwIfAborted()
    if (this.store.get('taste-consent') !== '1') return ''
    if (this.pending) {
      if (!signal) return this.pending
      // Cancelling a recommendation stops its wait, leaving an existing background refresh alone.
      const waiter = new AbortController()
      try {
        return await Promise.race([
          this.pending,
          once(signal, 'abort', { signal: waiter.signal }).then(() => signal.throwIfAborted()),
        ])
      } finally {
        waiter.abort()
      }
    }
    const controller = new AbortController()
    this.controller = controller
    this.pending = this.update(
      signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    ).finally(() => {
      this.controller = null
      this.pending = null
    })
    return this.pending
  }
  async update(signal) {
    const changes = this.changes()
    let doc = changes.doc
    const { delta, rebuild } = changes
    try {
      for (let i = 0; i < delta.length; i += 50) {
        const chunk = delta.slice(i, i + 50)
        const text = await this.request(
          { previous: doc.text, changes: chunk.map((x) => x.data) },
          signal,
        )
        signal.throwIfAborted()
        doc = {
          version: 1,
          policy: doc.policy,
          text,
          updatedAt: new Date().toISOString(),
          incorporated: [...doc.incorporated, ...chunk.map((x) => x.key)],
        }
      }
      if (delta.length || rebuild) {
        signal.throwIfAborted()
        if (!delta.length) doc = { ...doc, version: 1, updatedAt: new Date().toISOString() }
        const temp = this.file + '.' + randomUUID() + '.tmp'
        try {
          writeFileSync(temp, JSON.stringify(doc), { flag: 'wx' })
          renameSync(temp, this.file)
          this.store.set('restored-taste-document', '')
        } finally {
          rmSync(temp, { force: true })
        }
      }
      this.error = ''
      return doc.text
    } catch (e) {
      if (signal.aborted) return ''
      this.error = String(e.message || '更新失败')
      return rebuild ? '' : this.document().text
    }
  }
}
