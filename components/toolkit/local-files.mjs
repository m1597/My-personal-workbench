import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import koffi from 'koffi'
import { promisify } from 'node:util'
import { BrowserWindow, clipboard, dialog } from 'electron'

const exec = promisify(execFile)
const formats = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  md: 'text/plain',
  txt: 'text/plain',
  docx: 'application/docx',
}
const ext = (file) => path.extname(file).slice(1).toLowerCase()
const base = (file) => path.parse(file).name
function validName(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32) ||
    value.length > 150 ||
    /[<>:"/\\|?*]/.test(value) ||
    /[ .]$/.test(value) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)
  )
    throw Error('名称包含 Windows 不支持的字符')
  return value
}
async function available(dir, name, save) {
  const { name: stem, ext: suffix } = path.parse(validName(name))
  for (let i = 0; i < 10000; i++) {
    const file = path.join(dir, i ? stem + ' (' + i + ')' + suffix : name)
    try {
      await save(file)
      return path.basename(file)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
  }
  throw Error('目标目录存在过多同名文件')
}
function imageBytes(data, format) {
  const mime = formats[format]
  const prefix = 'data:' + mime + ';base64,'
  if (
    !mime?.startsWith('image/') ||
    typeof data !== 'string' ||
    !data.startsWith(prefix) ||
    data.length > 160 * 1024 * 1024
  )
    throw Error('图片无效或过大')
  const bytes = Buffer.from(data.slice(prefix.length), 'base64')
  if (format === 'png' && !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw Error('PNG 格式无效')
  if (format === 'jpg' && !(bytes[0] === 255 && bytes[1] === 216)) throw Error('JPEG 格式无效')
  return bytes
}
async function exists(file) {
  try {
    await lstat(file)
    return true
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}
export function installLocalFiles(handle) {
  const register = (name, fn) => handle(name, ['home'], fn)
  function file(s, id) {
    const f = s.inputs?.get(id)
    if (!f) throw Error('请重新选择文件')
    return f
  }
  register('chooseFiles', async (s) => {
    const r = await dialog.showOpenDialog(s.win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片、提示词或 Word 文档', extensions: Object.keys(formats) }],
    })
    if (r.canceled) return null
    if (r.filePaths.length > 100) throw Error('每批最多 100 个文件')
    const inputs = new Map()
    for (const p of new Set(r.filePaths)) {
      const st = await lstat(p)
      if (!st.isFile() || !formats[ext(p)] || st.size > 64 * 1024 * 1024)
        throw Error('请选择 64 MiB 以内的支持格式文件')
      inputs.set(randomUUID(), p)
    }
    s.inputs = inputs
    s.renamePlan = null
    return [...inputs].map(([id, p]) => ({ id, name: path.basename(p), type: formats[ext(p)] }))
  })
  register('readText', async (s, id) => {
    const p = file(s, id),
      st = await lstat(p)
    if (!st.isFile() || formats[ext(p)] !== 'text/plain' || st.size > 4 * 1024 * 1024)
      throw Error('请选择 4 MiB 以内的 UTF-8 文本')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(p))
    } catch {
      throw Error('文本无法读取，请确认是 UTF-8 编码')
    }
  })
  register('readImage', async (s, id) => {
    const p = file(s, id),
      mime = formats[ext(p)]
    if (!mime.startsWith('image/')) throw Error('需要图片')
    const st = await lstat(p)
    if (!st.isFile() || st.size > 64 * 1024 * 1024) throw Error('文件已变化，请重新选择')
    return 'data:' + mime + ';base64,' + (await readFile(p)).toString('base64')
  })
  function output(s, batch) {
    const dir = s.outputs?.get(batch)
    if (!dir) throw Error('请重新选择输出目录')
    return dir
  }
  register('finishOutput', (s, batch) => s.outputs?.delete(batch))
  register('chooseOutput', async (s) => {
    const r = await dialog.showOpenDialog(s.win, {
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled) return null
    const batch = randomUUID()
    s.outputs ??= new Map()
    if (s.outputs.size >= 16) throw Error('请等待其他导出完成')
    s.outputs.set(batch, r.filePaths[0])
    return batch
  })
  register('writeImage', async (s, v) => {
    if (!['png', 'jpg'].includes(v.format)) throw Error('请选择输出目录')
    const src = v.id ? base(file(s, v.id)) : '长图'
    const bytes = imageBytes(v.data, v.format)
    return available(output(s, v.batch), src + '.' + v.format, (p) =>
      writeFile(p, bytes, { flag: 'wx' }),
    )
  })
  register('writeAlbumPdf', async (s, { ids, batch }) => {
    const destination = output(s, batch)
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100)
      throw Error('请选择至少两张图片与输出目录')
    const pages = []
    let total = 0
    for (const id of ids) {
      const p = file(s, id),
        mime = formats[ext(p)]
      const stat = await lstat(p)
      total += stat.size
      if (!stat.isFile() || !mime.startsWith('image/') || total > 80 * 1024 * 1024)
        throw Error('图片无效或本批 PDF 超过 80 MiB')
      pages.push(
        '<section><img src="data:' +
          mime +
          ';base64,' +
          (await readFile(p)).toString('base64') +
          '"></section>',
      )
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'fitbay-pdf-'))
    const print = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    })
    try {
      const doc = path.join(dir, 'album.html')
      await writeFile(
        doc,
        '<meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src ' +
          "'none'" +
          '; img-src data:; style-src ' +
          "'unsafe-inline'" +
          '"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0}section{height:296mm;width:210mm;break-after:page;display:grid;place-items:center}section:last-child{break-after:auto}img{max-width:100%;max-height:295mm}</style>' +
          pages.join(''),
      )
      await print.loadFile(doc)
      const pdf = await print.webContents.printToPDF({
        preferCSSPageSize: true,
        printBackground: true,
      })
      return await available(destination, '图片合集.pdf', (p) => writeFile(p, pdf, { flag: 'wx' }))
    } finally {
      print.destroy()
      await rm(dir, { recursive: true, force: true })
    }
  })
  register('clipboardSnapshot', (s) => {
    const text = clipboard.readText()
    const img = clipboard.readImage()
    if (text.length > 4e6) throw Error('剪贴板文字过长')
    s.clip = { text, image: img.isEmpty() ? null : img }
    return { text, html: clipboard.readHTML().slice(0, 4000000), image: !img.isEmpty() }
  })
  register('clipboardAction', async (s, { kind, markdown }) => {
    if (!s.clip) throw Error('请先读取剪贴板')
    if (kind === 'plain' && s.clip.text) {
      clipboard.writeText(s.clip.text)
      return '已复制纯文本'
    }
    if (kind === 'copy-markdown') {
      if (!s.clip.text || typeof markdown !== 'string' || markdown.length > 8000000)
        throw Error('没有可导出的 Markdown')
      clipboard.writeText(markdown)
      return '已复制 Markdown'
    }
    const suffix = kind === 'png' ? 'png' : 'md'
    if (
      !['png', 'markdown', 'prompt'].includes(kind) ||
      (kind === 'png' ? !s.clip.image : !s.clip.text)
    )
      throw Error('剪贴板没有此类内容')
    const r = await dialog.showSaveDialog(s.win, {
      title: kind === 'prompt' ? '将提示词保存到仓库目录' : '保存剪贴板内容',
      defaultPath: (kind === 'prompt' ? '提示词' : '剪贴板') + '.' + suffix,
      filters: [{ name: suffix, extensions: [suffix] }],
    })
    if (r.canceled) return '已取消'
    if (ext(r.filePath) !== suffix) throw Error('请选择正确的扩展名')
    if (kind === 'markdown' && (typeof markdown !== 'string' || markdown.length > 8000000))
      throw Error('Markdown 无效')
    await writeFile(
      r.filePath,
      kind === 'png' ? s.clip.image.toPNG() : kind === 'markdown' ? markdown : s.clip.text,
      { flag: 'wx' },
    ).catch((e) => {
      if (e.code === 'EEXIST') throw Error('文件已存在，请选择其他名称')
      throw e
    })
    return '已保存 ' + path.basename(r.filePath)
  })
  register('planRename', async (s, { prefix, pairs }) => {
    s.renamePlan = null
    validName(prefix)
    if (
      !Array.isArray(pairs) ||
      !pairs.length ||
      pairs.length > 50 ||
      pairs.length * 2 !== s.inputs?.size
    )
      throw Error('每张图需要一份提示词，请选择数量相同的图片与文本')
    const ids = new Set(),
      plan = [],
      rows = []
    for (const [i, pair] of pairs.entries()) {
      if (!Array.isArray(pair) || pair.length !== 2) throw Error('请先选择配对')
      const [image, text] = pair.map((id) => file(s, id))
      if (
        !formats[ext(image)].startsWith('image/') ||
        !['txt', 'md'].includes(ext(text)) ||
        pair.some((id) => ids.has(id))
      )
        throw Error('每张图片和每份提示词只能使用一次')
      for (const id of pair) ids.add(id)
      for (const p of [image, text]) {
        const name = validName(prefix + '-' + String(i + 1).padStart(3, '0') + path.extname(p))
        const to = path.join(path.dirname(p), name)
        const issue = (await exists(to)) ? '目标名称已存在' : ''
        rows.push({ from: path.basename(p), to: name, issue })
        plan.push({ p, to, stat: await lstat(p) })
      }
    }
    const token = randomUUID()
    if (!rows.some((r) => r.issue)) s.renamePlan = { token, plan }
    return { token, rows }
  })
  register('applyRename', async (s, token) => {
    if (!s.renamePlan || s.renamePlan.token !== token) throw Error('请重新预览并处理所有冲突')
    const { plan } = s.renamePlan
    s.renamePlan = null
    const moved = []
    const move = koffi.load('kernel32.dll').func('int32_t __stdcall MoveFileW(str16, str16)')
    try {
      for (const entry of plan) {
        const { p, to, stat } = entry,
          now = await lstat(p)
        if (
          !now.isFile() ||
          now.ino !== stat.ino ||
          now.mtimeMs !== stat.mtimeMs ||
          now.size !== stat.size
        )
          throw Error('源文件已变化')
        if (!move(p, to)) throw Error('目标被占用或目录不可写')
        moved.push(entry)
      }
    } catch (e) {
      let incomplete = false
      for (const { p, to, stat } of moved.reverse()) {
        const current = await lstat(to).catch(() => null)
        if (!current || current.ino !== stat.ino || !move(to, p)) incomplete = true
      }
      if (incomplete)
        throw Error('部分文件已改名，请按预览核对原名和目标名，再重新选择。已有文件已保留')
      throw Error(e.message + '，请重新预览')
    }
    s.inputs = new Map()
    return '已重命名 ' + plan.length + ' 个文件'
  })
  register('convertDoc', async (s, { id, batch }) => {
    const destination = output(s, batch)
    const src = file(s, id)
    if (ext(src) !== 'docx') throw Error('请选择 DOCX 与输出目录')
    const folder = await mkdtemp(path.join(tmpdir(), 'fitbay-doc-')),
      pdf = path.join(folder, base(src) + '.pdf')
    try {
      const office = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter(Boolean)
        .map((root) => path.join(root, 'LibreOffice/program/soffice.exe'))
      for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (path.isAbsolute(dir) && path.basename(dir).toLowerCase() === 'program')
          office.push(path.join(dir, 'soffice.exe'))
      }
      let lo
      for (const candidate of office)
        if (await exists(candidate)) {
          lo = candidate
          break
        }
      if (lo) {
        const { pathToFileURL } = await import('node:url')
        await exec(
          lo,
          [
            '-env:UserInstallation=' + pathToFileURL(path.join(folder, 'profile')).href,
            '--headless',
            '--convert-to',
            'pdf',
            '--outdir',
            folder,
            src,
          ],
          { windowsHide: true, timeout: 120000 },
        )
      } else
        await exec(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(import.meta.dirname, 'word-pdf.ps1'),
            src,
            pdf,
          ],
          { windowsHide: true, timeout: 120000 },
        )
      if (!(await lstat(pdf)).size) throw Error()
      return await available(destination, base(src) + '.pdf', (p) =>
        copyFile(pdf, p, constants.COPYFILE_EXCL),
      )
    } catch {
      throw Error('DOCX 转换失败，请确认已安装 Word 或 LibreOffice，且文档可正常打开')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
}
