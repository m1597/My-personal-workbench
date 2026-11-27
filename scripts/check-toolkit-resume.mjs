import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { resultBounds } from '../components/toolkit/result-placement.mjs'

for (const [area, expected] of [
  [
    { x: 0, y: 60, width: 1920, height: 1020 },
    { x: 685, y: 265, width: 550, height: 610, minWidth: 280 },
  ],
  [
    { x: -900, y: -120, width: 900, height: 600 },
    { x: -725, y: -120, width: 550, height: 600, minWidth: 280 },
  ],
  [
    { x: 1560, y: -620, width: 240, height: 180 },
    { x: 1560, y: -620, width: 240, height: 180, minWidth: 240 },
  ],
])
  assert.deepEqual(resultBounds(area), expected)

let ocrCalls = 0
const requests = []
mock.module('../components/toolkit/native.mjs', {
  namedExports: {
    readSelectionOrOcr: async () => {
      ocrCalls++
      return JSON.stringify(
        Array.from({ length: 21 }, (_, id) => ({
          angle: 0,
          words: [{ text: 'Label ' + id, x: 5, y: id * 18, w: 64, h: 16 }],
        })),
      )
    },
  },
})
mock.module('../components/toolkit/model.mjs', {
  namedExports: {
    complete: async (_service, _key, messages) => {
      const items = JSON.parse(messages[0].content.split('\n')[1])
      requests.push(items.map((item) => item.id))
      if (requests.length === 2) return '[]'
      return JSON.stringify(items.map(({ id }) => ({ id, zh: '标签' + id })))
    },
  },
})
const { translateImage } = await import('../components/toolkit/image-translation.mjs')
function image() {
  return {
    getSize: () => ({ width: 100, height: 400 }),
    resize() {
      return this
    },
    toPNG: () => Buffer.alloc(0),
  }
}
const a = image(),
  service = { id: 'alpha', model: 'text' }
await assert.rejects(translateImage(a, service), /缺少对应文字块/)
assert.equal((await translateImage(a, service)).length, 21)
assert.equal(ocrCalls, 1)
assert.deepEqual(
  requests.map((batch) => batch.length),
  [20, 1, 1],
)
assert.deepEqual(requests[2], [20])
await translateImage(a, { ...service, id: 'beta' })
await translateImage(image(), service)
assert.equal(ocrCalls, 3)
assert.deepEqual(
  requests.map((batch) => batch.length),
  [20, 1, 1, 20, 1, 20, 1],
)
console.log(
  'PASS result work areas and 21-block retry; OCR calls 1 before changes, 3 after; batch sizes 20,1,1,20,1,20,1',
)
