import { channel } from 'node:diagnostics_channel'
const playbackEvents = channel('fitbay.music.playback')
import { randomUUID } from 'node:crypto'
import { titleMatch, recordingDisplayTitle } from './music-discovery.mjs'
import { chooseQuality } from './music-preferences.mjs'

const normalized = (v) =>
  String(v ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
const excerpt = (r) => Boolean(r.trial || r.isPreview || r.freeTrialInfo)
export function playlistPlayback({
  store,
  search,
  identify,
  qualities,
  availableSources,
  address,
  preferred,
  refresh,
}) {
  const choices = new Map(),
    overrides = new Map()
  const sourceRows = () =>
    store()
      .db.prepare("SELECT id,payload FROM music_sources WHERE disabled='' ORDER BY rowid")
      .all()
      .map((r) => ({ id: r.id, source: JSON.parse(r.payload) }))
  function list(id) {
    return [...(choices.get(id)?.values() || [])].map((v) => ({
      key: v.key,
      title: recordingDisplayTitle(v.row),
      artist: v.row.singer || '',
      source: v.src.name,
    }))
  }
  function choose(id, key) {
    const pick = choices.get(id)?.get(key)
    if (!pick) throw Error('版本选择已过期，请重新播放')
    overrides.set(id, pick)
    choices.delete(id)
  }
  function open(id, original, cached, scope) {
    const saved = JSON.parse(original.identifiers),
      variants = new Map()
    const originalDefinition = sourceRows().find(
      (provider) => provider.id === original.source,
    )?.source
    const nativeCatalog =
      saved.nativeCatalog ?? originalDefinition?.platforms?.[original.platform]?.search === false
    const selected = overrides.get(id)
    let winner = selected,
      refreshed = false
    overrides.delete(id)
    choices.delete(id)
    async function trySource(provider, signal) {
      const src = provider.src
      let row
      const originalSource = provider.id === original.source && src.platform === original.platform
      if (!originalSource && excerpt(saved)) throw Error('原录音仅供片段试听')
      if (originalSource && cached) row = cached
      else if (src.platform === original.platform && !src.search && nativeCatalog) row = saved
      else {
        const lookup = originalSource
          ? JSON.parse(original.query)
          : { title: saved.name, artist: saved.singer }
        const { rows } = await search(
          src,
          lookup,
          signal,
          originalSource ? original.recording : undefined,
        )
        for (const found of rows) {
          const hasId = identify(src, found)
          if (!hasId) continue
          if (
            originalSource &&
            hasId === original.recording &&
            titleMatch({ title: recordingDisplayTitle(saved), artist: saved.singer }, found) ===
              'exact' &&
            (excerpt(saved) || !excerpt(found))
          ) {
            row = found
            break
          }
          if (excerpt(found)) continue
          const samePlatformId = src.platform === original.platform && hasId === original.recording
          const match = titleMatch(
            { title: recordingDisplayTitle(saved), artist: saved.singer },
            found,
          )
          const duration = Number(found.durationSeconds),
            stored = Number(saved.durationSeconds)
          const closeLength = duration > 0 && stored > 0 && Math.abs(duration - stored) <= 2
          const isrc = normalized(saved.isrc),
            equalISRC = /^[a-z0-9]{12}$/.test(isrc) && isrc === normalized(found.isrc)
          if (
            match === 'exact' &&
            ((samePlatformId && closeLength) || equalISRC) &&
            (!(duration && stored) || closeLength)
          ) {
            row = found
            break
          }
          if (match || normalized(found.name) === normalized(saved.name)) {
            const label = [found.name, found.singer, found.albumName].map(normalized).join('\0')
            if (variants.size < 20 && !variants.has(label))
              variants.set(label, { key: randomUUID(), src, row: found })
          }
        }
      }
      if (!row || (!originalSource && excerpt(row))) throw Error('未找到同一完整录音')
      playbackEvents.publish({
        stage: 'address-start',
        id,
        source: src.name,
        platform: src.platform,
      })
      const url = await resolve(src, row, signal)
      playbackEvents.publish({ stage: 'address', id, source: src.name, platform: src.platform })
      return { url, src, row }
    }
    async function resolve(src, row, signal) {
      const quality = chooseQuality(qualities(src, row), preferred())
      if (!quality) throw Error('录音没有可用音质')
      return address(src, row, quality, signal)
    }
    return {
      async connect(signal, connect) {
        // A renewed URL can be necessary for a range seek after a signed URL expires.
        if (winner) {
          try {
            return await connect(await resolve(winner.src, winner.row, signal), signal)
          } catch (error) {
            signal.throwIfAborted()
            if (selected) throw error
            winner = undefined
          }
        }
        const reasons = new Set(),
          attempted = new Set()
        for (let round = 0; round < 2; round++) {
          const sources = sourceRows().flatMap(({ id, source }) =>
            Object.values(source.platforms ?? { [source.platform]: source })
              .filter((p) => p.platform === original.platform || (p.search && !excerpt(saved)))
              .map((platform) => ({ id, src: { ...source, ...platform } })),
          )
          const pending = sources
            .filter(({ src }) => !attempted.has(src.platform + '\0' + src.code))
            .sort((a, b) => Number(b.id === original.source) - Number(a.id === original.source))
          const probe = (provider, work) =>
            trySource(provider, AbortSignal.any([work, AbortSignal.timeout(6500)]))
          for await (const attempt of availableSources(pending, probe, signal, 3)) {
            if (attempt.error) {
              playbackEvents.publish({
                stage: 'rejected',
                source: attempt.src.src.name,
                reason: attempt.error.message,
              })
              reasons.add(attempt.error.message)
              continue
            }
            try {
              const response = await connect(attempt.candidate.url, signal)
              playbackEvents.publish({ stage: 'headers', id, source: attempt.candidate.src.name })
              winner = attempt.candidate
              choices.delete(id)
              return response
            } catch (e) {
              signal.throwIfAborted()
              playbackEvents.publish({
                stage: 'rejected',
                source: attempt.src.src.name,
                reason: e.message,
              })
              reasons.add(e.message)
            }
          }
          for (const { src } of pending) attempted.add(src.platform + '\0' + src.code)
          if (refreshed) break
          refreshed = true
          await refresh(scope)
          signal.throwIfAborted()
        }
        if (choices.size >= 50) choices.delete(choices.keys().next().value)
        if (variants.size) choices.set(id, new Map([...variants.values()].map((v) => [v.key, v])))
        throw Error(
          (variants.size ? '仅找到其他版本，请选择试听。' : '未找到可播放的同一完整录音。') +
            [...reasons].slice(0, 2).join('；'),
        )
      },
    }
  }
  return {
    open,
    list,
    choose,
    clear() {
      choices.clear()
      overrides.clear()
    },
  }
}
