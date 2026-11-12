import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

// The profile text and the exact set of incorporated signals are published together.
export class MusicTaste {
  constructor(store, root, request) {
    this.store = store
    this.file = path.join(root, 'music-taste.json')
    this.request = request
    this.pending = null
    this.controller = null
    this.error = ''
  }
  document() {
    if (!existsSync(this.file))
      return { text: this.store.get('taste-profile'), updatedAt: '', incorporated: [] }
    const doc = JSON.parse(readFileSync(this.file, 'utf8'))
    if (doc.version !== 1 || typeof doc.text !== 'string' || !Array.isArray(doc.incorporated))
      throw Error('审美文档无法读取')
    return doc
  }
  // Fingerprints are local only. Identical metadata across duplicate files contributes once.
  delta(doc) {
    const seen = new Set(doc.incorporated)
    const pending = []
    const tracks = this.store.db
      .prepare(`SELECT t.title,t.artist,t.album,
      EXISTS(SELECT 1 FROM playlist_tracks p WHERE p.track=t.id) AS liked,
      EXISTS(SELECT 1 FROM recording_copies v WHERE v.local=t.id AND v.automatic=1) AS automatic
      FROM local_tracks t ORDER BY t.rowid`)
      .all()
    for (const track of tracks) {
      const clean = (value) =>
        String(value ?? '')
          .replace(/\p{Cc}/gu, ' ')
          .slice(0, 160)
          .trim()
      const meta = {
        title: clean(track.title),
        artist: clean(track.artist),
        album: clean(track.album),
      }
      if (
        !meta.title ||
        Object.values(meta).some((value) => /([a-z]:[\\/]|\\\\|https?:\/\/|^\/)/i.test(value))
      )
        continue
      for (const signal of [
        ...(track.automatic ? [] : ['曲库新增']),
        ...(track.liked ? ['主动加入自建歌单'] : []),
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
  status() {
    const consented = this.store.get('taste-consent') === '1'
    try {
      const doc = this.document()
      const pending = consented ? this.delta(doc).length : 0
      return {
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
      return { consented, updatedAt: '', pending: 0, error: '审美文档无法读取', status: '待重试' }
    }
  }
  consent(value) {
    if (typeof value !== 'boolean') throw Error('授权状态无效')
    this.store.set('taste-consent', value ? '1' : '0')
    if (!value) this.controller?.abort()
  }
  async refresh() {
    if (this.store.get('taste-consent') !== '1') return ''
    if (this.pending) return this.pending
    const controller = new AbortController()
    this.controller = controller
    this.pending = this.update(controller.signal).finally(() => {
      this.controller = null
      this.pending = null
    })
    return this.pending
  }
  async update(signal) {
    let doc = this.document()
    try {
      const delta = this.delta(doc)
      for (let i = 0; i < delta.length; i += 50) {
        const chunk = delta.slice(i, i + 50)
        const text = await this.request(
          { previous: doc.text, changes: chunk.map((x) => x.data) },
          signal,
        )
        signal.throwIfAborted()
        doc = {
          version: 1,
          text,
          updatedAt: new Date().toISOString(),
          incorporated: [...doc.incorporated, ...chunk.map((x) => x.key)],
        }
      }
      if (delta.length) {
        const temp = this.file + '.' + randomUUID() + '.tmp'
        try {
          writeFileSync(temp, JSON.stringify(doc), { flag: 'wx' })
          renameSync(temp, this.file)
        } finally {
          rmSync(temp, { force: true })
        }
      }
      this.error = ''
      return doc.text
    } catch (e) {
      if (signal.aborted) return ''
      this.error = String(e.message || '更新失败')
      return this.document().text
    }
  }
}
