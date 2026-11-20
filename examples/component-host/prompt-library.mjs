import path from 'node:path'
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { watch, watchFile, unwatchFile } from 'node:fs'
import {
  actionCatalogue,
  atomicWrite,
  promptExtension,
  promptPath,
  readPrompt,
} from './prompt-actions.mjs'

export async function promptLibrary(profile, changed) {
  const file = path.join(profile, 'prompt-library', 'preferences.json')
  await mkdir(path.dirname(file), { recursive: true })
  let prefs = { defaultRoot: '', shortcut: 'Control+Alt+Shift+P' }
  let preferenceError = ''
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'))
    if (
      typeof stored.defaultRoot !== 'string' ||
      (stored.defaultRoot && !path.isAbsolute(stored.defaultRoot)) ||
      typeof stored.shortcut !== 'string'
    )
      throw Error('invalid preferences')
    prefs = { defaultRoot: stored.defaultRoot, shortcut: stored.shortcut }
  } catch (e) {
    if (e.code !== 'ENOENT') preferenceError = '配置不可用，请重新选择默认目录或快捷键'
  }
  let root = prefs.defaultRoot,
    watcher,
    timer
  let pending = Promise.resolve()
  let saving = Promise.resolve(),
    searchId = 0
  const catalog = actionCatalogue(profile)
  function refresh() {
    clearTimeout(timer)
    timer = setTimeout(changed, 120)
  }
  let watchedRoot
  function rootChanged(current, previous) {
    if (current.ino !== previous.ino || current.nlink !== previous.nlink) {
      watchContents()
      refresh()
    }
  }
  function monitor() {
    if (watchedRoot) unwatchFile(watchedRoot, rootChanged)
    watchedRoot = root
    if (root) watchFile(root, { interval: 550, persistent: false, bigint: true }, rootChanged)
    watchContents()
  }
  function watchContents() {
    watcher?.close()
    if (!root) return
    try {
      watcher = watch(root, { recursive: true }, refresh)
      watcher.on('error', refresh)
    } catch {
      refresh()
    }
  }
  monitor()
  function preference(key, value) {
    const work = pending.then(async () => {
      const next = { ...prefs, [key]: value }
      await atomicWrite(file, JSON.stringify(next))
      preferenceError = ''
      prefs = next
    })
    pending = work.catch(() => {})
    return work
  }
  async function files(folder) {
    const results = []
    async function walk(dir) {
      const entries = await readdir(dir, { withFileTypes: true }).catch((e) => {
        if (dir === folder) {
          if (folder === root) {
            clearTimeout(timer)
            timer = setTimeout(() => {
              watchContents()
              changed()
            }, 850)
          }
          throw e
        }
        return []
      })
      for (const e of entries) {
        if (e.isSymbolicLink()) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else if (e.isFile() && promptExtension.test(e.name))
          results.push(path.relative(folder, full))
      }
    }
    if (folder) await walk(folder)
    return results.sort((a, b) => a.localeCompare(b))
  }
  function assertRoot(expected) {
    if (!root || root !== expected) throw Error('目录已切换，请刷新')
  }
  return {
    state: () => ({ root, ...prefs, preferenceError }),
    async select(folder, remember) {
      const next = await realpath(folder)
      if (!(await stat(next)).isDirectory()) throw Error('目录不可用')
      if (remember) await preference('defaultRoot', next)
      root = next
      monitor()
      refresh()
    },
    shortcut: (value) => preference('shortcut', value),
    files: () => files(root),
    read: (expected, name) => {
      assertRoot(expected)
      return readPrompt(expected, name)
    },
    save(expected, name, revision, text) {
      const operation = saving.then(async () => {
        assertRoot(expected)
        if (typeof text !== 'string' || Buffer.byteLength(text) > 4 * 1024 * 1024)
          throw Error('文本过大')
        const check = async () => {
          assertRoot(expected)
          const old = await readPrompt(expected, name)
          if (old.revision !== revision) throw Error('文件已在外部修改，请重新加载或复制草稿')
          return old
        }
        const { bom } = await check()
        await atomicWrite(await promptPath(expected, name), (bom ? '\ufeff' : '') + text, check)
        refresh()
        return readPrompt(expected, name)
      })
      saving = operation.catch(() => {})
      return operation
    },
    pin: (expected, ...args) => {
      assertRoot(expected)
      return catalog.pin(expected, ...args)
    },
    async search(query) {
      if (typeof query !== 'string' || query.length > 400) throw Error('搜索词过长')
      const request = ++searchId
      const folder = prefs.defaultRoot || root
      const needle = query.trim().toLocaleLowerCase(),
        hits = []
      for (const name of await files(folder)) {
        if (request !== searchId) return []
        try {
          const { text } = await readPrompt(folder, name)
          const index = text.toLocaleLowerCase().indexOf(needle)
          if (index < 0 && !name.toLocaleLowerCase().includes(needle)) continue
          const start = Math.max(0, index - 65)
          hits.push({ name, snippet: text.slice(start, start + 200), folder })
          if (hits.length === 80) break
        } catch {
          /* A deleted or unsupported document does not prevent other matches. */
        }
      }
      return hits
    },
    async selection(folder, name) {
      if (!folder || folder !== (prefs.defaultRoot || root)) throw Error('提示词目录已改变')
      return (await readPrompt(folder, name)).text
    },
    close() {
      if (watchedRoot) unwatchFile(watchedRoot, rootChanged)
      watcher?.close()
      clearTimeout(timer)
    },
  }
}
