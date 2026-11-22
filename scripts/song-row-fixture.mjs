import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

export async function selectSongRow(row, title) {
  await title.hover()
  const color = await row.evaluate((el) => {
    const background = () => getComputedStyle(el).backgroundColor
    el.addEventListener(
      'pointerdown',
      () => {
        el.observedRowColors = [background()]
        const sample = () => {
          el.observedRowColors.push(background())
          if (el.observedRowColors.length < 6) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },
      { once: true },
    )
    return background()
  })
  await title.click()
  await expect(row).toHaveAttribute('data-selected', 'true')
  await expect.poll(() => row.evaluate((el) => el.observedRowColors?.length)).toBe(6)
  const frames = await row.evaluate((el) => el.observedRowColors)
  assert.deepEqual([...new Set(frames)], [color])
  await expect(row).not.toHaveCSS('box-shadow', 'none')
}
