import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { MusicStore } from '../components/music/store.mjs'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/music-models-')),
  profile = path.join(root, 'profile')
const fixtureStore = new MusicStore(path.join(profile, 'fitbay-music'))
fixtureStore.library.upsert({
  title: '已同意的摘要',
  artist: '测试艺人',
  album: '私人专辑',
  duration: 4,
  file: path.resolve('tests/fixtures/local-music/tone.mp3'),
})
fixtureStore.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const app = await launch()
try {
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByLabel('今天想听什么').fill('雨天的爵士乐')
  await page.getByRole('button', { name: '生成推荐' }).click()
  await expect(page.getByLabel('服务商', { exact: true })).toHaveText('DeepSeek')
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'settings.png') })
  await app.evaluate(() => {
    globalThis.modelCalls = []
    globalThis.fetch = async (url, req) => {
      const body = JSON.parse(req.body)
      const id = new URL(url).hostname.split('.')[1]
      globalThis.modelCalls.push({ id, body, headers: req.headers, url })
      if (globalThis.failMode === 'auth') return new Response('{}', { status: 401 })
      if (globalThis.failMode === 'cancel')
        return new Promise((_, reject) =>
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }),
        )
      const songs = Array.from({ length: 5 }, (_, i) => ({
        title: '样例歌曲' + i,
        artist: i === 0 ? 'AC/DC' : '测试艺人',
        reason: '适合雨天',
      }))
      const result = JSON.stringify(body).includes('可复用的中文音乐品味资料')
        ? { profile: '偏爱氛围音乐与柔和节奏' }
        : { songs }
      const content = globalThis.failMode === 'invalid' ? '{}' : JSON.stringify(result)
      let data
      if (id === 'openai')
        data = { output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
      else if (id === 'anthropic') data = { content: [{ type: 'text', text: content }] }
      else if (id === 'googleapis')
        data = { candidates: [{ content: { parts: [{ text: content }] } }] }
      else data = { choices: [{ message: { content } }] }
      return Response.json(data)
    }
  })
  for (const [index, id] of ['deepseek', 'openai', 'claude', 'gemini'].entries()) {
    if (index) await page.getByRole('button', { name: '模型设置' }).click()
    await page.getByRole('combobox', { name: '服务商' }).click()
    await page
      .getByRole('option', {
        name: { deepseek: 'DeepSeek', openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini' }[id],
        exact: true,
      })
      .click()
    await page.getByLabel('API Key').fill('fixture-' + id)
    await page.getByRole('button', { name: '保存设置' }).click()
    await page.getByRole('button', { name: '生成推荐' }).click()
    await expect
      .poll(() => page.evaluate(async () => (await window.music.state()).batches.length))
      .toBe(index + 1)
    const call = await app.evaluate(() => globalThis.modelCalls.at(-1))
    assert.ok(
      call.url.startsWith(
        {
          deepseek: 'https://api.deepseek.com/',
          openai: 'https://api.openai.com/',
          claude: 'https://api.anthropic.com/',
          gemini: 'https://generativelanguage.googleapis.com/',
        }[id],
      ),
    )
    assert.equal(
      call.headers.Authorization ?? call.headers['x-api-key'] ?? call.headers['x-goog-api-key'],
      (['openai', 'deepseek'].includes(id) ? 'Bearer ' : '') + 'fixture-' + id,
    )
    assert.ok(JSON.stringify(call.body).includes('雨天的爵士乐'))
    assert.ok(!JSON.stringify(call.body).includes('summary'))
  }
  const state = await page.evaluate(() => window.music.state())
  assert.equal(state.items.filter((r) => r.status === '模型推荐').length, 20)
  assert.ok(!JSON.stringify(state).includes('fixture-'))
  const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
  const saved = db
    .prepare("select value from state where key='recommendation-providers'")
    .get().value
  assert.ok(!saved.includes('fixture-'))
  assert.equal(Object.keys(JSON.parse(saved).accounts).length, 4)
  db.close()
  for (const mode of ['auth', 'invalid', 'cancel']) {
    await app.evaluate((_e, m) => {
      globalThis.failMode = m
    }, mode)
    const callCount = await app.evaluate(() => globalThis.modelCalls.length)
    const gen = page.evaluate(() =>
      window.music.generate('测试失败路径').then(
        () => '',
        (e) => e.message,
      ),
    )
    if (mode === 'cancel') {
      await expect.poll(() => app.evaluate(() => globalThis.modelCalls.length)).toBe(callCount + 1)
      await page.evaluate(() => window.music.stopGeneration())
    }
    assert.match(await gen, mode === 'auth' ? /401/ : mode === 'invalid' ? /五首/ : /取消/)
    assert.equal(await page.evaluate(async () => (await window.music.state()).batches.length), 4)
  }
  const source = path.join(root, 'source.js')
  await fs.writeFile(
    source,
    "// @name 推荐测试源\nlx.on('request',({info})=>[{name:info.keyword,singer:'测试艺人',id:'1'}]);lx.send('inited',{sources:{wy:{actions:['musicUrl','search'],qualitys:['320k']}}})",
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
  await page.evaluate(() => window.music.lxImport())
  await page.getByRole('button', { name: '查找在线版本' }).first().click()
  await expect(
    page
      .getByRole('region', { name: '在线版本' })
      .getByRole('button', { name: '下载', exact: true }),
  ).toBeVisible()
  await app.evaluate(() => {
    globalThis.failMode = ''
  })
  const edit = page.getByRole('button', { name: /生成或更新偏好资料/ })
  await edit.click()
  await page.getByLabel('长期音乐偏好自述').fill('喜欢器乐')
  await page.getByLabel('本次附加以上摘要').check()
  await page.getByRole('button', { name: '发送并生成资料' }).click()
  await expect(page.getByText('偏爱氛围音乐与柔和节奏', { exact: true })).toBeVisible()
  const sent = await app.evaluate(() => JSON.stringify(globalThis.modelCalls.at(-1).body))
  assert.ok(
    sent.includes('喜欢器乐') &&
      sent.includes('测试艺人') &&
      !sent.includes('私人专辑') &&
      !sent.includes('tone.mp3'),
  )
  const reopened = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  assert.equal(
    reopened.prepare("SELECT value FROM state WHERE key='taste-profile'").get().value,
    '偏爱氛围音乐与柔和节奏',
  )
  reopened.close()
  await page.reload()
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByLabel('今天想听什么').fill('')
  await page.getByRole('button', { name: '用已有资料推荐' }).click()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).batches.length))
    .toBe(5)
  const reuse = await app.evaluate(() => JSON.stringify(globalThis.modelCalls.at(-1).body))
  assert.ok(
    reuse.includes('偏爱氛围音乐与柔和节奏') &&
      !reuse.includes('测试艺人') &&
      !reuse.includes('喜欢器乐'),
  )
  await edit.click()
  await page.getByLabel('本次附加以上摘要').check()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await page.getByRole('button', { name: '从曲库移除已同意的摘要' }).click()
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByRole('button', { name: '发送并生成资料' }).click()
  await expect(page.getByText(/摘要已变更/)).toBeVisible()
  assert.equal(
    await page.evaluate(async () => (await window.music.state()).profile),
    '偏爱氛围音乐与柔和节奏',
  )
  console.log('PASS 四家协议、配置隔离、取消、错误和推荐到洛雪匹配。截图目录 ' + root)
} finally {
  await app.close()
}

const restarted = await launch()
try {
  const page = await restarted.firstWindow()
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await expect(page.getByText('偏爱氛围音乐与柔和节奏', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '用已有资料推荐' })).toBeEnabled()
  const batch = await page.evaluate(async () => {
    const profile = (await window.music.state()).profile
    await window.music.configureModel('offline', '', '', false)
    return window.music.generate('', profile)
  })
  assert.equal(
    await page.evaluate(
      async (batch) => (await window.music.state()).items.find((i) => i.batch === batch).title,
      batch,
    ),
    '夜航',
  )
} finally {
  await restarted.close()
}
