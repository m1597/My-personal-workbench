import { createHash } from 'node:crypto'
import path from 'node:path'
import { parseStream } from 'music-metadata'
import { audioFileStat, audioTypes, openAudio } from './local-files.mjs'

const positive = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null)
export function albumTags(common) {
  return {
    artistCredits: (common.artists?.length
      ? common.artists
      : common.artist
        ? [common.artist]
        : []
    ).map((name, i) => ({
      name,
      id:
        common.musicbrainz_artistid?.length === (common.artists?.length || 1)
          ? common.musicbrainz_artistid[i]
          : undefined,
    })),
    albumArtist: common.albumartist?.trim().slice(0, 2048) || '',
    discNumber: positive(common.disk?.no),
    trackNumber: positive(common.track?.no),
  }
}

function localFile(file) {
  // Network shares (including extended UNC paths) are outside local artwork lookup.
  return !file.startsWith('\\\\') && !file.startsWith('//')
}
async function readTags(file, skipCovers) {
  if (!localFile(file)) return null
  const handle = await openAudio(file)
  let stream
  try {
    const { size } = await handle.stat()
    stream = handle.createReadStream({ autoClose: false })
    const info = { path: file, size, mimeType: audioTypes[path.extname(file).toLowerCase()] }
    return await parseStream(stream, info, { skipCovers })
  } finally {
    stream?.destroy()
    await handle.close()
  }
}

export async function readCommon(file, skipCovers) {
  return (await readTags(file, skipCovers))?.common
}

const normalized = (value) => value.trim().normalize().toLowerCase()
function albumId(row) {
  const key = [normalized(row.album), normalized(row.albumArtist || row.artist)]
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}
const collate = new Intl.Collator('zh-CN', { numeric: true })
function trackOrder(a, b) {
  return (
    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
    (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity) ||
    collate.compare(a.title, b.title) ||
    a.id.localeCompare(b.id)
  )
}

export class AlbumLibrary {
  constructor(db) {
    this.db = db
    this.groups = new Map()
    this.coverCache = new Map()
    this.noCover = new Map()
    db.function('fitbay_album_name', { deterministic: true }, normalized)
    db.exec(`CREATE TEMP TABLE album_revision(value INTEGER NOT NULL);
      INSERT INTO album_revision VALUES(0);
      CREATE TEMP TRIGGER album_insert AFTER INSERT ON main.local_tracks BEGIN
        UPDATE album_revision SET value=value+1; END;
      CREATE TEMP TRIGGER album_delete AFTER DELETE ON main.local_tracks BEGIN
        UPDATE album_revision SET value=value+1; END;
      CREATE TEMP TRIGGER album_update AFTER UPDATE OF file,title,artist,album,albumArtist,discNumber,
        trackNumber,listed,available,awaitingLocation,size,fileIdentity ON main.local_tracks BEGIN
        UPDATE album_revision SET value=value+1; END;`)
    this.getRevision = db.prepare('SELECT value FROM album_revision')
  }
  get revision() {
    return this.getRevision.get().value
  }
  syncGroups() {
    const revision = this.revision
    if (this.groupRevision !== revision) {
      this.groups.clear()
      this.groupRevision = revision
    }
  }
  async fill(row) {
    if (row.albumArtist !== null || !row.available || row.awaitingLocation) return
    const common = await readCommon(row.file, true).catch(() => null)
    if (!common) return
    const tags = albumTags(common)
    this.db
      .prepare(
        'UPDATE local_tracks SET albumArtist=?,discNumber=?,trackNumber=? WHERE id=? AND file=? AND albumArtist IS NULL',
      )
      .run(tags.albumArtist, tags.discNumber, tags.trackNumber, row.id, row.file)
  }
  async list() {
    this.filling ??= (async () => {
      const rows = this.db
        .prepare(
          'SELECT id,file,available,awaitingLocation,albumArtist FROM local_tracks WHERE listed=1 AND albumArtist IS NULL AND available=1 AND awaitingLocation=0',
        )
        .all()
      for (let i = 0; i < rows.length; i += 4)
        await Promise.all(rows.slice(i, i + 4).map((row) => this.fill(row)))
    })().finally(() => {
      this.filling = null
    })
    await this.filling
    const groups = new Map()
    const rows = this.db
      .prepare(
        'SELECT id,title,artist,album,albumArtist,discNumber,trackNumber FROM local_tracks WHERE listed=1 ORDER BY rowid',
      )
      .all()
    for (const row of rows) {
      const id = albumId(row)
      if (!groups.has(id))
        groups.set(id, {
          id,
          title: row.album || '未知专辑',
          artist: row.albumArtist || row.artist,
          tracks: [],
        })
      groups.get(id).tracks.push(row)
    }
    const albums = [...groups.values()]
      .map((group) => ({
        ...group,
        tracks: group.tracks.sort(trackOrder).map((row) => row.id),
      }))
      .sort((a, b) => collate.compare(a.title, b.title) || collate.compare(a.artist, b.artist))
    this.syncGroups()
    for (const album of albums) this.groups.set(album.id, album.tracks)
    return albums
  }
  async songTags(row) {
    if (!row?.available || row.awaitingLocation) return {}
    const tags = await readTags(row.file, true).catch(() => null)
    if (!tags) return {}
    const { common, native } = tags,
      people = []
    function add(role, name) {
      if (
        typeof name === 'string' &&
        name.trim() &&
        !people.some((p) => p.name === name.trim() && p.role === role)
      )
        people.push({ id: null, role, name: name.trim() })
    }
    for (const [field, role] of Object.entries({
      composer: '作曲',
      arranger: '编曲',
      lyricist: '作词',
      conductor: '指挥',
      producer: '制作',
    }))
      for (const person of common[field] ?? []) add(role, person)
    for (const tag of Object.values(native).flat()) {
      if (tag.id === 'TMCL' || tag.id === 'IPLS' || tag.id === 'TIPL') {
        for (const [role, names] of Object.entries(tag.value ?? {})) {
          if (!Array.isArray(names)) continue
          const title =
            { arranger: '编曲', composer: '作曲', producer: '制作', vocals: '演唱' }[
              role.toLowerCase()
            ] ?? (tag.id === 'TMCL' ? '演奏 · ' + role : role)
          for (const person of names) add(title, person)
        }
      }
      if (tag.id.toUpperCase() === 'PERFORMER' && typeof tag.value === 'string') {
        const m = tag.value.match(/^(.+?)\s*\(([^()]+)\)\s*$/u)
        add(m ? '演奏 · ' + m[2] : '演奏', m?.[1] ?? tag.value)
      }
    }
    return { people, recording: common.musicbrainz_recordingid, work: common.musicbrainz_workid }
  }
  async artistPortrait(artist, nativeImage) {
    const rows = this.db
      .prepare(
        'SELECT * FROM local_tracks WHERE listed=1 AND available=1 AND awaitingLocation=0 AND fitbay_album_name(artist)=? ORDER BY rowid',
      )
      .all(normalized(artist))
    for (const row of rows) {
      const portrait = await this.picture(row, nativeImage, true)
      if (portrait) return portrait
    }
    return null
  }
  async picture(row, nativeImage, portrait = false) {
    if (!row?.available || row.awaitingLocation || !localFile(row.file)) return null
    const stat = await audioFileStat(row.file)
    if (!stat) return null
    const stamp = [row.file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
    const key = portrait ? 'portrait:' + row.id : row.id
    if (this.noCover.get(key) === stamp) return null
    this.noCover.delete(key)
    const cached = this.coverCache.get(key)
    if (cached?.stamp === stamp) return cached.result
    const result = this.readPicture(row, nativeImage, portrait)
    this.coverCache.set(key, { stamp, result })
    if (this.coverCache.size > 32) this.coverCache.delete(this.coverCache.keys().next().value)
    if (!(await result) && this.coverCache.get(key)?.stamp === stamp) {
      this.coverCache.delete(key)
      this.noCover.set(key, stamp)
      if (this.noCover.size > 4096) this.noCover.delete(this.noCover.keys().next().value)
    }
    return result
  }
  async readPicture(row, nativeImage, portrait) {
    const common = await readCommon(row.file, false).catch(() => null)
    const pictures = (common?.picture ?? []).filter(
      (p) =>
        !portrait ||
        ['Lead artist/lead performer/soloist', 'Artist/performer', 'Band/Orchestra'].includes(
          p.type,
        ),
    )
    for (const picture of [...pictures].sort(
      (a, b) => Number(b.type === 'Cover (front)') - Number(a.type === 'Cover (front)'),
    )) {
      if (!picture.data.length || picture.data.length > 8 * 1024 * 1024) continue
      const source = nativeImage.createFromBuffer(Buffer.from(picture.data))
      if (source.isEmpty()) continue
      const { width, height } = source.getSize()
      const scale = Math.min(1, 256 / Math.max(width, height))
      return source
        .resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        })
        .toDataURL()
    }
    return null
  }
  async cover(id, nativeImage, exclude) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null
    this.syncGroups()
    if (!this.groups.has(id)) await this.list()
    const byId = this.db.prepare('SELECT * FROM local_tracks WHERE id=?')
    for (const track of this.groups.get(id) ?? []) {
      if (track === exclude) continue
      const row = byId.get(track)
      if (!row?.listed || albumId(row) !== id) continue
      const result = await this.picture(row, nativeImage)
      if (result) return result
    }
    return null
  }
  async trackCover(track, nativeImage) {
    if (typeof track !== 'string' || track.length > 128) return null
    const byId = this.db.prepare('SELECT * FROM local_tracks WHERE id=?')
    const row = byId.get(track)
    if (!row) return null
    const own = await this.picture(row, nativeImage)
    if (own) return own
    await this.fill(row)
    const current = byId.get(track)
    if (!current) return null
    const id = albumId(current)
    this.syncGroups()
    if (!this.groups.has(id)) {
      const byAlbum = this.db.prepare(
        'SELECT * FROM local_tracks WHERE listed=1 AND fitbay_album_name(album)=?',
      )
      const name = normalized(current.album)
      const siblings = byAlbum.all(name)
      for (const sibling of siblings) await this.fill(sibling)
      const rows = byAlbum.all(name)
      this.syncGroups()
      this.groups.set(
        id,
        rows
          .filter((r) => albumId(r) === id)
          .sort(trackOrder)
          .map((r) => r.id),
      )
    }
    return this.cover(id, nativeImage, track)
  }
}
