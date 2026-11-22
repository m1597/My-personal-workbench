import { readSelectionOrOcr } from './native.mjs'
import { complete } from './model.mjs'

// Windows OCR may group labels in adjacent nodes into a single text line.
async function locateText(image, signal) {
  const size = image.getSize()
  const scale = Math.min(2, 3000 / Math.max(size.width, size.height))
  const bitmap = image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    quality: 'best',
  })
  const measured = bitmap.getSize()
  const sx = size.width / measured.width,
    sy = size.height / measured.height
  const lines = JSON.parse(await readSelectionOrOcr(bitmap.toPNG(), undefined, signal, true))
  const blocks = []
  for (const line of lines) {
    let words = []
    const flush = () => {
      if (words.length)
        blocks.push({
          id: blocks.length,
          angle: line.angle,
          text: words.map((w) => w.text).join(' '),
          words,
        })
      words = []
    }
    for (const input of line.words) {
      const word = {
        text: input.text,
        x: input.x * sx,
        y: input.y * sy,
        w: input.w * sx,
        h: input.h * sy,
      }
      const prev = words.at(-1)
      if (
        prev &&
        (word.x - prev.x - prev.w > Math.max(word.h, prev.h) * 1.1 ||
          word.x < prev.x ||
          Math.abs(word.y - prev.y) > Math.max(prev.h, word.h) * 0.7)
      )
        flush()
      words.push(word)
    }
    flush()
  }
  if (!blocks.length) throw Error('选区没有识别到文字，请重新框选')
  return blocks
}
export async function translateImage(image, service, signal) {
  const blocks = await locateText(image, signal)
  for (let i = 0; i < blocks.length; i += 20) {
    const batch = blocks.slice(i, i + 20)
    const request = batch.map(({ id, text }) => ({ id, text }))
    const prompt =
      '把下面每项 text 翻译成简体中文。保持流程图标签简洁，保留术语和编号。只返回 JSON 数组，每项包含原 id 和译文 zh。\n' +
      JSON.stringify(request)
    const raw = await complete(service, service.key, [{ role: 'user', content: prompt }], signal)
    try {
      const rows = JSON.parse(
        raw
          .trim()
          .replace(/^\x60{3}(?:json)?\s*/i, '')
          .replace(/\s*\x60{3}$/, ''),
      )
      if (!Array.isArray(rows) || rows.length !== batch.length) throw Error()
      const translated = new Map(rows.map((r) => [r.id, r.zh]))
      for (const block of batch) {
        const value = translated.get(block.id)
        if (typeof value !== 'string' || !value.trim()) throw Error()
        block.zh = value.trim()
      }
    } catch {
      throw Error('翻译响应缺少对应文字块，请重试翻译')
    }
  }
  return blocks
}
