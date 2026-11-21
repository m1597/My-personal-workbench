import path from 'node:path'
import { readdir, realpath, stat, open } from 'node:fs/promises'
import { checkedDiskPath as checked, promptExtension, readPrompt } from './prompt-actions.mjs'

const mime = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}
const typeOf = (name) =>
  mime[path.extname(name).toLowerCase()] ? 'image' : promptExtension.test(name) ? 'text' : 'file'
export function fileBrowser(authorized, favorites, recent) {
  let generation = 0
  async function entries(root, dir) {
    const items = await readdir(await checked(root, dir), { withFileTypes: true })
    return items
      .filter((e) => !e.isSymbolicLink() && (e.isDirectory() || e.isFile()))
      .map((e) => ({
        root,
        name: path.join(dir, e.name),
        label: e.name,
        type: e.isDirectory() ? 'dir' : typeOf(e.name),
      }))
      .sort(
        (a, b) =>
          Number(b.type === 'dir') - Number(a.type === 'dir') ||
          a.label.localeCompare(b.label, 'zh-CN', { numeric: true }),
      )
  }
  async function identityOf(root, name) {
    if (!authorized(root)) throw Error('目录不可用')
    const item = await stat(await checked(root, name), { bigint: true })
    return item.isFile() ? String(item.dev) + '/' + String(item.ino) : ''
  }
  return {
    identity: identityOf,
    async locate(root, name, identity) {
      if (!authorized(root)) return null
      const make = (folder, relative) => ({
        root: folder,
        name: relative,
        label: path.basename(relative),
        type: typeOf(relative),
      })
      try {
        await checked(root, name)
        return make(root, name)
      } catch (error) {
        if (error.code === 'EACCES' || error.code === 'EPERM') return make(root, name)
      }
      if (!identity) return null
      const suffixes = name.split(/[\\/]/)
      for (const hint of recent()) {
        if (!authorized(hint.root)) continue
        try {
          const disk = await checked(hint.root, hint.name)
          const item = await stat(disk, { bigint: true })
          if (item.isFile() && String(item.dev) + '/' + String(item.ino) === identity)
            return make(hint.root, hint.name)
          if (item.isDirectory())
            for (let i = 0; i < suffixes.length; i++) {
              const candidate = path.join(hint.name, ...suffixes.slice(i))
              try {
                if ((await identityOf(hint.root, candidate)) === identity)
                  return make(hint.root, candidate)
              } catch {
                /* unrelated directory */
              }
            }
        } catch {
          /* A second notification can arrive after the path has disappeared. */
        }
      }
      return null
    },
    async browse(root, dir, query, all) {
      const turn = ++generation
      if (
        !authorized(root) ||
        typeof dir !== 'string' ||
        typeof query !== 'string' ||
        query.length > 400 ||
        typeof all !== 'boolean'
      )
        throw Error('目录不可用')
      const locations = all && query.trim() ? favorites() : [root]
      const tree = [],
        rows = [],
        unavailable = []
      let truncated = false
      const needle = query.trim().toLocaleLowerCase()
      async function search(folder, rel) {
        let items
        try {
          items = await entries(folder, rel)
        } catch {
          unavailable.push(path.join(folder, rel))
          return
        }
        for (const item of items) {
          if (turn !== generation || truncated) return
          if (rows.length >= 500) {
            truncated = true
            return
          }
          if (item.label.toLocaleLowerCase().includes(needle)) rows.push(item)
          else if (item.type === 'text') {
            try {
              const { text } = await readPrompt(folder, item.name)
              const index = text.toLocaleLowerCase().indexOf(needle)
              if (index >= 0)
                rows.push({ ...item, snippet: text.slice(Math.max(0, index - 36), index + 88) })
            } catch {
              /* An unreadable document can still be found by filename. */
            }
          }
          if (item.type === 'dir') await search(folder, item.name)
        }
      }
      // Only expand the active branch. Large unrelated asset directories stay on disk.
      let part = ''
      for (const segment of ['', ...dir.split(/[\\/]/).filter(Boolean)]) {
        part = segment ? path.join(part, segment) : ''
        try {
          const children = await entries(root, part)
          tree.push(...children.filter((e) => e.type === 'dir'))
          if (part === dir && !needle) rows.push(...children)
        } catch {
          unavailable.push(path.join(root, part))
          break
        }
      }
      if (needle) {
        const roots = locations.filter(
          (folder) =>
            !all ||
            !locations.some(
              (parent) =>
                parent !== folder &&
                folder.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep),
            ),
        )
        for (const location of roots) await search(location, all ? '' : dir)
      }
      return { tree, rows, unavailable, truncated }
    },
    async image(root, name, thumbnail) {
      if (!authorized(root) || typeOf(name) !== 'image' || typeof thumbnail !== 'boolean')
        throw Error('无法预览此文件')
      const handle = await open(await checked(root, name), 'r')
      try {
        const meta = await handle.stat()
        if (!meta.isFile() || meta.size > 48 * 1024 * 1024) throw Error('仅预览 48 MiB 以内的图片')
        if (thumbnail) {
          const { nativeImage } = await import('electron')
          const ext = path.extname(name).toLowerCase()
          const img = ['.png', '.jpg', '.jpeg'].includes(ext)
            ? nativeImage.createFromBuffer(await handle.readFile())
            : await nativeImage.createThumbnailFromPath(await checked(root, name), {
                width: 144,
                height: 110,
              })
          if (img.isEmpty()) throw Error('缩略图暂不可用')
          const { width, height } = img.getSize()
          const scale = Math.min(1, 144 / width, 110 / height)
          return img
            .resize({
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
            })
            .toDataURL()
        }
        const bytes = await handle.readFile()
        return (
          'data:' + mime[path.extname(name).toLowerCase()] + ';base64,' + bytes.toString('base64')
        )
      } finally {
        await handle.close()
      }
    },
    async companion(root, name) {
      if (!authorized(root) || typeOf(name) !== 'image') throw Error('目录不可用')
      const txt = path.join(path.dirname(name), path.parse(name).name + '.txt')
      try {
        const file = await realpath(await checked(root, name))
        const candidate = await realpath(path.join(path.dirname(file), path.basename(txt)))
        if (
          path.dirname(candidate) !== path.dirname(file) ||
          path.basename(candidate).toLowerCase() !== path.basename(txt).toLowerCase() ||
          !(await stat(candidate)).isFile()
        )
          return ''
        return path.relative(await realpath(root), candidate)
      } catch {
        return ''
      }
    },
  }
}
