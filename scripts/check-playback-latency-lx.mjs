import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const root = await fs.mkdtemp(path.resolve('tmp/lx-compare-')),
  dir = path.join(root, 'LxDatas')
await fs.mkdir(dir)
const db = new DatabaseSync(process.env.FITBAY_TEST_LIVE_LIBRARY, { readOnly: true })
const src = JSON.parse(
  db.prepare("SELECT payload FROM music_sources WHERE id='pdone:helloworld'").get().payload,
)
db.close()
const existing = JSON.parse(
  await fs.readFile(
    path.join(process.env.APPDATA, 'lx-music-desktop/LxDatas/config_v2.json'),
    'utf8',
  ),
)
if (!existing.setting['common.isAgreePact']) throw Error('原实例尚未接受协议')
const id = 'user_api_test_1794632432000'
await fs.writeFile(
  path.join(dir, 'config_v2.json'),
  JSON.stringify({
    version: existing.version,
    setting: {
      version: existing.setting.version,
      'common.isAgreePact': existing.setting['common.isAgreePact'],
      'common.apiSource': id,
      'common.tryAutoUpdate': false,
      'player.startupAutoPlay': false,
      'player.volume': 0,
      'player.playQuality': '128k',
      'openAPI.enable': false,
      'tray.enable': false,
    },
  }),
)
await fs.writeFile(
  path.join(dir, 'user_api.json'),
  JSON.stringify({
    userApis: [{ id, name: src.name, script: src.code, allowShowUpdateAlert: false, version: '1' }],
  }),
)
await fs.writeFile(
  path.join(dir, 'data.json'),
  JSON.stringify({
    lastStartInfo: '2.12.6',
    searchSetting: { source: 'tx', temp_source: 'tx', type: 'music' },
  }),
)
console.log(root)
const ctx = await electron.launch({
  executablePath: process.env.FITBAY_LX_PLAYER,
  args: [
    '--user-data-dir=' + root,
    '--mute-audio',
    '-dhmkh',
    '-search=Monkeys Spinning Monkeys Kevin MacLeod',
  ],
  timeout: 25000,
})
try {
  await new Promise((r) => setTimeout(r, 4000))
  const page = ctx.windows()[0]

  const row = page
    .locator('.list-item')
    .filter({ has: page.locator('.name[aria-label="Monkeys Spinning Monkeys"]') })
    .filter({ hasText: 'Kevin MacLeod' })
    .first()
  for (let n = 0; n < 7 && !(await row.count()); n++) {
    await page.getByText('小蜗音乐', { exact: true }).dispatchEvent('click')
    await page.getByText('小秋音乐', { exact: true }).dispatchEvent('click')
    await page.locator('input[placeholder]').fill('Monkeys Spinning Monkeys Kevin MacLeod')
    await page.locator('input[placeholder]').press('Enter')
    await new Promise((r) => setTimeout(r, 2700))
  }
  await row.waitFor({ timeout: 6000 })
  await page.evaluate(() => {
    globalThis.data = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) {
      const el = this
      globalThis.sound = el
      el.addEventListener(
        'playing',
        () => globalThis.data.push(['playing', Date.now(), el.duration]),
        { once: true },
      )
      return play.apply(el, args)
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  const requests = new Map(),
    events = []
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.type === 'Media') {
      requests.set(e.requestId, true)
      events.push(['address', Date.now()])
    }
  })
  cdp.on('Network.dataReceived', (e) => {
    if (requests.get(e.requestId) === true) {
      requests.set(e.requestId, false)
      events.push(['first-bytes', Date.now()])
    }
  })
  await cdp.send('Runtime.enable')
  const proto = await cdp.send('Runtime.evaluate', { expression: 'HTMLMediaElement.prototype' })
  const objects = await cdp.send('Runtime.queryObjects', {
    prototypeObjectId: proto.result.objectId,
  })
  await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId,
    functionDeclaration:
      "function(){for(const el of this)if(el instanceof HTMLAudioElement){globalThis.sound=el;el.addEventListener('playing',()=>globalThis.data.push(['playing',Date.now(),el.duration]),{once:true})}}",
  })
  const at = Date.now()
  await row.dispatchEvent('click')
  await row.dispatchEvent('click')
  await row.dispatchEvent('dblclick')
  try {
    await page.waitForFunction(() => globalThis.data.some((e) => e[2] > 120 && e[2] < 130), null, {
      timeout: 25000,
    })
  } catch (e) {
    console.log(
      events,
      await page.evaluate(() => [
        globalThis.data,
        globalThis.sound?.currentTime,
        document.body.textContent.slice(-400),
      ]),
    )
    throw e
  }
  const frame = await page.evaluate(() => ({
    playing: globalThis.data.find((e) => e[2] > 120 && e[2] < 130)[1],
    duration: globalThis.data.find((e) => e[2] > 120 && e[2] < 130)[2],
  }))
  const evidence = {
    source: src.name,
    quality: '128k',
    operation: 'QQ 搜索首播',
    trigger: at,
    events: [...events, ['playing', frame.playing]].map(([stage, t]) => ({ stage, ms: t - at })),
    ...frame,
  }
  console.log(evidence)
  await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
} finally {
  await ctx.close()
}
