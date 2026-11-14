import { createHash } from 'node:crypto'
import { fetchSource, inspectSource } from './lx-source-catalog.mjs'

function repositoryURL(input) {
  const url = new URL(input)
  if (
    !/^https?:$/.test(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    input.length > 2048
  )
    throw Error('请输入公网目录清单 URL')
  return url.href
}
export function playbackRepositories(store, bank) {
  const read = () =>
    JSON.parse(store.get('lx-backup-repositories') || '{"configured":[],"discovered":[]}')
  const save = (value) => store.set('lx-backup-repositories', JSON.stringify(value))
  const configure = (input, enabled) => {
    const url = repositoryURL(input),
      settings = read()
    if (typeof enabled !== 'boolean') throw Error('无效的目录设置')
    settings.configured = settings.configured.filter((item) => item !== url)
    if (enabled) {
      if (settings.configured.length >= 12) throw Error('最多配置 12 个备用目录')
      settings.configured.push(url)
    }
    settings.discovered = settings.discovered.filter((item) => item !== url)
    save(settings)
  }
  async function refresh(signal) {
    for (const url of read().configured) {
      signal.throwIfAborted()
      try {
        const doc = JSON.parse(await fetchSource(url, signal))
        if (!Array.isArray(doc.sources) || doc.sources.length > 40) continue
        const settings = read()
        if (!settings.configured.includes(url)) continue
        for (const link of Array.isArray(doc.repositories) ? doc.repositories.slice(0, 20) : []) {
          try {
            const candidate = repositoryURL(new URL(link, url).href)
            if (
              !settings.configured.includes(candidate) &&
              !settings.discovered.includes(candidate) &&
              settings.discovered.length < 40
            )
              settings.discovered.push(candidate)
          } catch {}
        }
        save(settings)
        for (const entry of doc.sources) {
          signal.throwIfAborted()
          try {
            if (typeof entry?.url !== 'string') continue
            const script = repositoryURL(new URL(entry.url, url).href)
            const code = await fetchSource(script, signal)
            const source = await inspectSource(code, signal)
            signal.throwIfAborted()
            if (!read().configured.includes(url)) break
            const identity = createHash('sha256')
              .update(url + '\0' + script)
              .digest('hex')
            bank.install(source, 'backup-' + identity, false)
          } catch {
            signal.throwIfAborted()
          }
        }
      } catch {
        signal.throwIfAborted()
      }
    }
  }
  return { read, configure, refresh }
}
