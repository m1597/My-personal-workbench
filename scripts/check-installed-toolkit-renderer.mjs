import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron } from '@playwright/test'

const directory = path.join(process.argv[2], 'Toolkit')
const appDir = path.join(directory, 'resources/app')
const profile = await mkdtemp(path.join(process.env.RUNNER_TEMP, 'toolkit-render-'))
for (const name of ['ocr.ps1', 'image-translation.mjs', 'translated-diagram.js']) {
  assert.deepEqual(
    await readFile(path.join(appDir, name)),
    await readFile(path.join('components/toolkit', name)),
    name,
  )
}
const app = await _electron.launch({
  executablePath: path.join(directory, 'FitBay Toolkit.exe'),
  args: ['--workbench-profile=' + profile, '--user-data-dir=' + profile],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  const layers = await page.evaluate(async () => {
    const { layoutTranslation } = await import('./translated-diagram.js')
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 40
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 120, 40)
    ctx.fillStyle = 'black'
    ctx.fillText('Read', 8, 23)
    const output = await layoutTranslation(canvas.toDataURL(), [
      {
        text: 'Read',
        zh: '阅读',
        angle: 0,
        words: [{ text: 'Read', x: 8, y: 12, w: 38, h: 16 }],
      },
    ])
    return Array.from(output.querySelectorAll('g[data-mode]'), (layer) => ({
      mode: layer.dataset.mode,
      label: layer.querySelector('g[aria-label]')?.getAttribute('aria-label'),
    }))
  })
  assert.deepEqual(layers, [
    { mode: '仅中文', label: 'Read：阅读' },
    { mode: '双语', label: 'Read：阅读' },
  ])
  console.log(
    'PASS installed Toolkit contains the OCR scripts and renders translated text onto its original image',
  )
} finally {
  await app.close()
}
