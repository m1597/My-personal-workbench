import path from 'node:path'
import { fileBrowser } from './file-browser.mjs'
import { mkdir, opendir, writeFile, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { watch, watchFile, unwatchFile } from 'node:fs'
import {
  actionCatalogue,
  atomicWrite,
  checkedDiskPath,
  promptExtension,
  promptPath,
  readPrompt,
} from './prompt-actions.mjs'

export async function promptLibrary(profile, changed) {
  async function assertWritableFolder(folder) {
    let parent = await realpath(folder)
    for (;;) {
      try {
        if ((await stat(path.join(parent, 'SKILL.md'))).isFile()) throw Error('Skill 目录只读')
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      const next = path.dirname(parent)
      if (next === parent) return
      parent = next
    }
  }
  async function selectedDirectory(folder) {
    const resolved = await realpath(folder)
    if (!(await stat(resolved)).isDirectory()) throw Error('目录不可用')
    try {
      return await checkedDiskPath(path.resolve(folder), '')
    } catch {
      return resolved
    }
  }
  const file = path.join(profile, 'prompt-library', 'catalogue-preferences.json')
  await mkdir(path.dirname(file), { recursive: true })
  let prefs = { defaultRoot: '', shortcut: 'Control+Alt+Shift+P', favorites: [], paletteRoot: '' }
  let preferenceError = ''
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'))
    if (
      typeof stored.defaultRoot !== 'string' ||
      (stored.defaultRoot && !path.isAbsolute(stored.defaultRoot)) ||
      typeof stored.shortcut !== 'string'
    )
      throw Error('invalid preferences')
    prefs = {
      defaultRoot: stored.defaultRoot,
      shortcut: stored.shortcut,
      favorites: Array.isArray(stored.favorites)
        ? stored.favorites.filter((p) => typeof p === 'string' && path.isAbsolute(p))
        : [],
      paletteRoot:
        typeof stored.paletteRoot === 'string' && path.isAbsolute(stored.paletteRoot)
          ? stored.paletteRoot
          : '',
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      try {
        const legacy = JSON.parse(
          await readFile(path.join(path.dirname(file), 'preferences.json'), 'utf8'),
        )
        if (typeof legacy.shortcut === 'string') prefs.shortcut = legacy.shortcut
      } catch {
        /* No prior preferences on first install. */
      }
    } else preferenceError = '配置不可用，请重新选择默认目录或快捷键'
  }
  let root = prefs.defaultRoot,
    timer
  let pending = Promise.resolve()
  let saving = Promise.resolve(),
    searchId = 0
  const catalog = actionCatalogue(profile)
  function refresh() {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(changed, 120)
  }
  const watches = new Map()
  let probeTimer,
    probeGeneration = 0,
    closed = false
  function watchUnavailable(paths) {
    const generation = ++probeGeneration
    clearTimeout(probeTimer)
    if (!paths.length || closed) return
    async function probe() {
      for (const unavailable of paths) {
        if (closed || generation !== probeGeneration) return
        const folder = [root, ...favorites()].filter(Boolean).find((f) => {
          const rel = path.relative(f, unavailable)
          return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)
        })
        if (!folder) continue
        try {
          const dir = await opendir(
            await checkedDiskPath(folder, path.relative(folder, unavailable)),
          )
          await dir.close()
        } catch {
          continue
        }
        if (closed || generation !== probeGeneration) return
        watches.get(folder)?.()
        watches.delete(folder)
        monitor()
        refresh()
        return
      }
      if (!closed && generation === probeGeneration)
        probeTimer = setTimeout(() => void probe(), 1200)
    }
    probeTimer = setTimeout(() => void probe(), 1200)
  }
  const favorites = () => [...new Set([prefs.defaultRoot, ...prefs.favorites].filter(Boolean))]
  const authorized = (folder) =>
    Boolean(folder && (folder === root || favorites().includes(folder)))
  const recent = new Map()
  let browseSequence = 0
  const browser = fileBrowser(authorized, favorites, () => [...recent.values()].reverse())
  function monitor() {
    const roots = new Set([...favorites(), root, prefs.paletteRoot].filter(Boolean))
    for (const [folder, stop] of watches)
      if (!roots.has(folder)) {
        stop()
        watches.delete(folder)
      }
    for (const folder of roots) {
      if (watches.has(folder)) continue
      let watcher
      function attach() {
        watcher?.close()
        watcher = undefined
        try {
          watcher = watch(folder, { recursive: true }, (_, name) => {
            if (name) {
              const key = path.join(folder, name)
              recent.delete(key)
              recent.set(key, { root: folder, name })
              if (recent.size > 256) recent.delete(recent.keys().next().value)
            }
            refresh()
          })
          watcher.on('error', () => {
            watcher?.close()
            watcher = undefined
            refresh()
          })
        } catch {
          /* Retry on root polling once the directory is reachable. */
        }
      }
      attach()
      function poll(current, previous) {
        if (
          current.ino !== previous.ino ||
          current.nlink !== previous.nlink ||
          (!watcher && current.nlink)
        ) {
          attach()
          refresh()
        }
      }
      watchFile(folder, { interval: 650, persistent: false, bigint: true }, poll)
      watches.set(folder, () => {
        unwatchFile(folder, poll)
        watcher?.close()
      })
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
          throw e
        }
        return []
      })
      const manifest = entries.find((entry) => entry.isFile() && entry.name === 'SKILL.md')
      if (manifest) {
        results.push(path.relative(folder, path.join(dir, manifest.name)))
        return
      }
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
    if (!authorized(expected)) throw Error('目录已切换，请刷新')
  }
  return {
    ...browser,
    async browse(folder, ...args) {
      const seq = ++browseSequence
      const listing = await browser.browse(folder, ...args)
      if (seq === browseSequence) watchUnavailable(listing.unavailable)
      return listing
    },
    state: () => ({ root, ...prefs, favorites: favorites(), preferenceError }),
    async favorite(folder, add) {
      if (!authorized(folder) || typeof add !== 'boolean') throw Error('目录不可用')
      if (!add && folder === prefs.defaultRoot) throw Error('默认目录始终显示在常用位置')
      await preference(
        'favorites',
        add
          ? [...new Set([...prefs.favorites, folder])]
          : prefs.favorites.filter((f) => f !== folder),
      )
      monitor()
      refresh()
    },
    async activate(folder) {
      if (!favorites().includes(folder)) throw Error('目录不可用')
      root = folder
      monitor()
      refresh()
    },
    async paletteFolder(folder) {
      const next = await selectedDirectory(folder)
      await preference('paletteRoot', next)
      monitor()
      refresh()
    },
    async select(folder, remember) {
      const next = await selectedDirectory(folder)
      if (remember) await preference('defaultRoot', next)
      if (!remember || !root) root = next
      monitor()
      refresh()
    },
    shortcut: (value) => preference('shortcut', value),
    files: () => files(root),
    async catalogue(query = '') {
      if (typeof query !== 'string' || query.length > 4096) throw Error('搜索文字过长')
      const needle = query.trim().toLocaleLowerCase()
      const folder = root
      const cards = []
      for (const name of await files(folder)) {
        try {
          const { text } = await readPrompt(folder, name)
          const skill = path.basename(name) === 'SKILL.md'
          const title =
            text.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
            (skill
              ? path.basename(path.resolve(folder, path.dirname(name)))
              : path.parse(name).name)
          const parts = name.split(path.sep)
          const category = parts.length > (skill ? 2 : 1) ? parts[0] : '未分类'
          cards.push({
            name,
            title,
            category,
            skill,
            match: [name, title, category, text].some((v) =>
              v.toLocaleLowerCase().includes(needle),
            ),
          })
        } catch {
          /* Files removed during scanning disappear on reconciliation. */
        }
      }
      return cards
    },
    read: (expected, name) => {
      assertRoot(expected)
      return readPrompt(expected, name)
    },
    async saveOrganized(expected, text) {
      if (
        !expected ||
        expected !== root ||
        typeof text !== 'string' ||
        !text.trim() ||
        Buffer.byteLength(text) > 4 * 1024 * 1024
      )
        throw Error('无法保存整理结果')
      const dest = await checkedDiskPath(root, '')
      await assertWritableFolder(dest)
      const name = '整理-' + crypto.randomUUID() + '.md'
      await writeFile(path.join(dest, name), text, { flag: 'wx' })
      refresh()
      return name
    },
    save(expected, name, revision, text) {
      const operation = saving.then(async () => {
        assertRoot(expected)
        if (typeof text !== 'string' || Buffer.byteLength(text) > 4 * 1024 * 1024)
          throw Error('文本过大')
        const check = async () => {
          assertRoot(expected)
          await assertWritableFolder(path.dirname(await promptPath(expected, name)))
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
      const folder = prefs.paletteRoot || prefs.defaultRoot
      if (!folder) throw Error('请在文件库的全局快捷键中设置调用目录')
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
      if (!folder || folder !== (prefs.paletteRoot || prefs.defaultRoot))
        throw Error('提示词目录已改变')
      return (await readPrompt(folder, name)).text
    },
    close() {
      closed = true
      clearTimeout(probeTimer)
      for (const stop of watches.values()) stop()
      watches.clear()
      clearTimeout(timer)
    },
  }
}
