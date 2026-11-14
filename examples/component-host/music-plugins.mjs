import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, lstat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ids = ['wave', 'tags', 'rules', 'path']
export function musicPlugins(profile, getStore, dialog, nativeImage) {
  const root = path.join(profile, 'fitbay-music', 'plugins')
  let entries
  const list = () =>
    (entries ??= JSON.parse(
      readFileSync(new URL('./plugin-catalog.json', import.meta.url), 'utf8'),
    ))
  const byId = (id) => {
    if (!ids.includes(id)) throw Error('未知插件')
    const item = list().find((x) => x.id === id)
    if (!item) throw Error('当前版本缺少此插件')
    return item
  }
  const key = (id) => 'music-plugin-install-' + id
  const active = (item) => getStore().get(key(item.id)) === item.digest
  const folder = (item) => path.join(root, item.id + '-' + item.digest)
  async function prune(id, keep) {
    const files = await readdir(root, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return []
      throw e
    })
    for (const file of files) {
      if (!file.isDirectory() || !file.name.startsWith(id + '-')) continue
      const digest = file.name.slice(id.length + 1)
      if (/^[a-f0-9]{64}$/.test(digest) && digest !== keep)
        await rm(path.join(root, file.name), { recursive: true, force: true })
    }
  }
  const handlers = new Map()
  const queues = new Map()
  const serial = (id, job) => {
    const next = (queues.get(id) || Promise.resolve()).then(job)
    queues.set(
      id,
      next.catch(() => {}),
    )
    return next
  }
  async function verified(item, name) {
    if (!Object.hasOwn(item.files, name)) throw Error('插件资源无效')
    const file = path.join(folder(item), name)
    if (!(await lstat(file)).isFile()) throw Error('插件资源异常，请重新安装')
    const bytes = await readFile(file)
    if (hash(bytes) !== item.files[name]) throw Error('插件文件已变化，请重新安装')
    return bytes
  }
  async function install(item) {
    const choice = await dialog.showOpenDialog({
      title: '选择' + item.title + '插件文件',
      properties: ['openFile'],
      filters: [{ name: 'FitBay Music 插件', extensions: ['fitbayplugin'] }],
    })
    if (choice.canceled) return false
    const file = choice.filePaths[0]
    if ((await stat(file)).size !== item.bytes) throw Error('安装包大小与当前版本不符')
    const data = await readFile(file)
    if (hash(data) !== item.digest) throw Error('安装包内容与当前版本不符')
    const pack = JSON.parse(data.toString())
    const target = folder(item)
    await mkdir(root, { recursive: true })
    const stage = path.join(root, '.stage-' + randomUUID())
    await mkdir(stage)
    try {
      for (const name of Object.keys(item.files))
        await writeFile(path.join(stage, name), pack.files[name], { flag: 'wx' })
      // The old registration stays live if fetching or checking the replacement failed.
      const rollback = path.join(root, '.previous-' + randomUUID())
      const existed = await rename(target, rollback)
        .then(() => true)
        .catch((e) => {
          if (e.code === 'ENOENT') return false
          throw e
        })
      try {
        await rename(stage, target)
      } catch (e) {
        if (existed) await rename(rollback, target)
        throw e
      }
      if (existed) await rm(rollback, { recursive: true, force: true })
      getStore().set(key(item.id), item.digest)
      handlers.delete(item.id)
      await prune(item.id, item.digest)
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
    return true
  }
  return {
    list() {
      return list().map(({ id, title, description, bytes, digest }) => ({
        id,
        title,
        description,
        bytes,
        installed: active(byId(id)),
        outdated: !!getStore().get(key(id)) && !active(byId(id)),
        version: digest.slice(0, 12),
      }))
    },
    install(id) {
      const item = byId(id)
      return serial(id, () => install(item))
    },
    remove(id) {
      const item = byId(id)
      return serial(id, async () => {
        getStore().set(key(id), '')
        handlers.delete(id)
        await prune(item.id, null)
      })
    },
    async resource(req) {
      try {
        const u = new URL(req.url)
        const item = byId(u.hostname)
        const name = u.pathname.slice(1)
        if (!active(item) || !['panel.js', 'panel.css'].includes(name))
          return new Response(null, { status: 404 })
        return new Response(await verified(item, name), {
          headers: {
            'Content-Type': name.endsWith('.js') ? 'application/javascript' : 'text/css',
            'Cache-Control': 'no-store',
          },
        })
      } catch {
        return new Response(null, { status: 404 })
      }
    },
    call(id, action, args) {
      const item = byId(id)
      return serial(id, async () => {
        if (!active(item)) throw Error('请先安装此插件')
        if (!handlers.has(id)) {
          for (const name of Object.keys(item.files).filter((n) => n.endsWith('.mjs')))
            await verified(item, name)
          const moduleURL = pathToFileURL(path.join(folder(item), 'host.mjs')).href
          const plugin = await import(moduleURL)
          const api = new Map()
          plugin.register((name, fn) => api.set(name, fn), getStore, {
            dialog,
            moduleURL,
            nativeImage,
          })
          handlers.set(id, api)
        }
        const fn = handlers.get(id).get(action)
        if (!fn || !Array.isArray(args) || args.length > 12) throw Error('无效插件操作')
        return fn(...args)
      })
    },
  }
}
