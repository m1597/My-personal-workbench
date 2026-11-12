import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { describeFailure } from '../examples/component-host/music-download-diagnosis.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/music-failure-ui-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const failures = [
  ['夜航', 'unknown', 'wy', '匹配录音：未声明永久保存许可'],
  ['晨光', 'network', 'tx', '平台目录返回业务码 2001'],
  ['归途', 'storage', '', 'ENOSPC'],
  ['旧版记录', 'preview', 'kg', '匹配录音：只提供试听片段'],
]
const batch = store.saveSuggestions(
  '隔离界面验收',
  failures.map(([title]) => ({ title, artist: '测试艺人', reason: '测试用推荐' })),
  '待处理',
)
for (const [title, kind, platform, message] of failures) {
  const { id } = store.db
    .prepare('SELECT id FROM items WHERE batch=? AND title=?')
    .get(batch, title)
  const { summary, detail } = describeFailure([
    { platform, source: '测试源', kinds: [kind], message },
  ])
  store.db
    .prepare('UPDATE recommended_items SET error=?,summary=?,diagnosis=? WHERE item=?')
    .run(detail, title === '旧版记录' ? '' : summary, kind, id)
  store.status(id, '待重试')
}
store.db.close()
const sourceFile = path.join(root, 'source.js')
await writeFile(
  sourceFile,
  `// @name 测试源
lx.on('request',({action})=>action==='search'?[{name:'夜航',singer:'测试艺人',id:'night'}]:null);
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  const page = await app.firstWindow()
  const audition = page.getByRole('tab', { name: '每日推荐' })
  const row = (name) =>
    page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) })
  const unknown = row('夜航'),
    network = row('晨光'),
    storage = row('归途'),
    legacy = row('旧版记录')
  const retry = (row) => row.getByRole('button', { name: '重试', exact: true })
  const change = unknown.getByRole('button', { name: '更换音乐源' })
  await audition.click()
  await expect(page.getByText('待重试', { exact: true })).toHaveCount(0)
  await expect(change).toBeVisible()
  await expect(retry(unknown)).toHaveCount(0)
  await expect(retry(network)).toBeVisible()
  await expect(legacy.getByText('当前来源仅提供试听', { exact: true })).toBeVisible()
  await expect(retry(legacy)).toHaveCount(0)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
    document.documentElement.style.backgroundColor = getComputedStyle(
      document.documentElement,
    ).getPropertyValue('--base')
  })
  for (const [item, label, summary, detail] of [
    [
      unknown,
      '许可未声明',
      '已找到这首歌，当前来源未声明是否允许保存',
      '网易云音乐 · 测试源 · 匹配录音：未声明永久保存许可',
    ],
    [
      network,
      '平台失败',
      '暂时无法获取QQ 音乐的结果，可稍后重试',
      'QQ 音乐 · 测试源 · 平台目录返回业务码 2001',
    ],
  ]) {
    await expect(item.getByText(summary, { exact: true })).toBeVisible()
    await expect(item.getByText(detail, { exact: true })).toBeHidden()
    await item.screenshot({ path: path.join(root, label + '-默认.png') })
    await item.getByText('查看详情', { exact: true }).click()
    await expect(item.getByText(detail, { exact: true })).toBeVisible()
    await item.screenshot({ path: path.join(root, label + '-展开.png') })
    await item.getByText('查看详情', { exact: true }).click()
  }
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, root)
  await storage.getByRole('button', { name: '选择下载目录' }).click()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).prefs.recommendDir))
    .toBe(root)
  await change.click()
  await audition.click()
  await expect(retry(unknown)).toHaveCount(0)
  await change.click()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, sourceFile)
  await page.getByRole('button', { name: '本地导入', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '当前音乐源' })).toContainText('测试源')
  await audition.click()
  await retry(unknown).click()
  await expect(
    unknown.getByText('已找到这首歌，当前来源未声明是否允许保存', { exact: true }),
  ).toBeVisible()
  await expect(retry(unknown)).toHaveCount(0)
  const recorded = await page.evaluate(async () => {
    const row = (await window.music.state()).items.find((r) => r.title === '夜航')
    return [row.attemptSources, (await window.music.lxSources()).configuration]
  })
  expect(recorded[0]).toMatch(/^[a-f0-9]{64}$/)
  expect(recorded[0]).toBe(recorded[1])
  await app.close()
  app = await launch()
  const restarted = await app.firstWindow()
  await restarted.getByRole('tab', { name: '设置', exact: true }).click()
  const sources = restarted.getByRole('button', { name: '音乐源', exact: true })
  if (!(await sources.isVisible()))
    await restarted.getByRole('button', { name: '设置分类' }).click()
  await sources.click()
  await writeFile(
    sourceFile,
    `// @name 第二个测试源
lx.on('request',({action})=>action==='search'?[{name:'夜航',singer:'测试艺人',id:'new-night'}]:null);
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, sourceFile)
  await restarted.getByRole('button', { name: '本地导入', exact: true }).click()
  await expect(restarted.getByRole('combobox', { name: '当前音乐源' })).toContainText(
    '第二个测试源',
  )
  await app.close()
  app = await launch()
  const reopened = await app.firstWindow()
  await reopened.getByRole('tab', { name: '每日推荐' }).click()
  const reopenedRow = reopened
    .getByRole('listitem')
    .filter({ has: reopened.getByText('夜航', { exact: true }) })
  await expect(retry(reopenedRow)).toBeVisible()
  await retry(reopenedRow).click()
  await expect(retry(reopenedRow)).toHaveCount(0)
  console.log('PASS 重启后首次查看推荐前换源，再重启仍能重试；失败按新源配置重新判断')
  console.log(
    'PASS 默认与展开的许可/网络提示、旧记录、目录选择、实际换源后重试及重试后重新判断',
    root,
  )
} finally {
  await app.close()
}
