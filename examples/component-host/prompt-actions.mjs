import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'

export const promptExtension = /\.(md|txt)$/i
export async function promptPath(root, relative) {
  if (
    !path.isAbsolute(root) ||
    typeof relative !== 'string' ||
    path.isAbsolute(relative) ||
    !promptExtension.test(relative) ||
    relative
      .split(/[\\/]/)
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.includes(':') ||
          part.includes(String.fromCharCode(0)),
      )
  )
    throw Error('FILE_UNAVAILABLE')
  const file = path.join(root, relative)
  if ((await realpath(file)) !== file) throw Error('FILE_UNAVAILABLE')
  return file
}
export async function readPrompt(root, relative) {
  const handle = await open(await promptPath(root, relative), 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('仅支持 4 MiB 以内的 UTF-8 文本')
    const bytes = await handle.readFile()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return {
      text,
      bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
      revision: createHash('sha256').update(bytes).digest('hex'),
    }
  } finally {
    await handle.close()
  }
}
export async function atomicWrite(file, contents, beforeReplace) {
  const temp = file + '.' + randomUUID() + '.tmp'
  await writeTemp()
  async function writeTemp() {
    const handle = await open(temp, 'wx')
    try {
      try {
        await handle.writeFile(contents)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await beforeReplace?.()
      await rename(temp, file)
    } finally {
      await unlink(temp).catch(() => {})
    }
  }
}
export function actionCatalogue(profile) {
  const file = path.join(profile, 'prompt-library', 'actions.json')
  async function load() {
    try {
      const rows = JSON.parse(await readFile(file, 'utf8'))
      if (
        !Array.isArray(rows) ||
        rows.some(
          (r) =>
            !r ||
            typeof r.id !== 'string' ||
            typeof r.displayName !== 'string' ||
            !['text', 'image'].includes(r.inputType) ||
            typeof r.root !== 'string' ||
            typeof r.relative !== 'string',
        )
      )
        throw Error()
      return rows
    } catch (e) {
      if (e.code === 'ENOENT') return []
      throw Error('INDEX_UNAVAILABLE')
    }
  }
  let pending = Promise.resolve()
  return {
    load,
    pin(root, relative, displayName, inputType) {
      const work = pending.then(async () => {
        if (
          typeof displayName !== 'string' ||
          !displayName.trim() ||
          displayName.length > 100 ||
          !['text', 'image'].includes(inputType)
        )
          throw Error('动作名称或输入类型无效')
        await readPrompt(root, relative)
        const rows = await load()
        const previous = rows.find((r) => r.root === root && r.relative === relative)
        if (previous) Object.assign(previous, { displayName: displayName.trim(), inputType })
        else
          rows.push({
            id: randomUUID(),
            displayName: displayName.trim(),
            inputType,
            root,
            relative,
          })
        await mkdir(path.dirname(file), { recursive: true })
        await atomicWrite(file, JSON.stringify(rows))
      })
      pending = work.catch(() => {})
      return work
    },
  }
}
export function createPromptActionReader({ profile, installed }) {
  const catalog = actionCatalogue(profile)
  const info = ({ id, displayName, inputType }) => ({ id, displayName, inputType })
  async function query(fn) {
    if (!(await installed())) return { ok: false, error: 'COMPONENT_ABSENT' }
    try {
      return await fn(await catalog.load())
    } catch (e) {
      return {
        ok: false,
        error: e.message === 'INDEX_UNAVAILABLE' ? e.message : 'FILE_UNAVAILABLE',
      }
    }
  }
  return {
    listActions: () => query((rows) => ({ ok: true, actions: rows.map(info) })),
    resolveAction: (id) =>
      query(async (rows) => {
        const row = rows.find((r) => r.id === id)
        if (!row) return { ok: false, error: 'ACTION_NOT_FOUND' }
        const { text: template } = await readPrompt(row.root, row.relative)
        return { ok: true, action: { ...info(row), template } }
      }),
  }
}
