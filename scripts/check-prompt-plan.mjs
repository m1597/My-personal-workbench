import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { requestVisualModel } from '../examples/component-host/prompt-visuals.mjs'

const ref = process.argv[2]
if (!ref || !/^[0-9a-f]{7,40}$/.test(ref)) throw Error('需要平台订阅接口的固定提交')
await mkdir('tmp', { recursive: true })
const scratch = await mkdtemp(path.resolve('tmp/prompt-plan-'))
for (const name of ['api-connections.mjs', 'chatgpt-plan.mjs', 'connection-vault.mjs']) {
  await writeFile(
    path.join(scratch, name),
    execFileSync('git', ['show', ref + ':examples/component-host/' + name]),
  )
}
const { openConnections } = await import(pathToFileURL(path.join(scratch, 'api-connections.mjs')))
const { sharedConnectionVault } = await import(
  pathToFileURL(path.join(scratch, 'connection-vault.mjs'))
)
const models = []
const store = openConnections(scratch, undefined, {
  request: async (url, init) => {
    const body = JSON.parse(init.body)
    models.push(body.model)
    assert.equal(body.input[0].content, '文档数据')
    assert.equal(body.instructions, '原文依据')
    return new Response(
      'data: ' +
        JSON.stringify({ type: 'response.output_text.delta', delta: '已接收' }) +
        '\n\ndata: {"type":"response.completed"}\n\n',
    )
  },
})
try {
  const db = new DatabaseSync(path.join(scratch, 'api-connections.sqlite'))
  try {
    for (const use of ['default', 'prompts.model']) {
      const id = randomUUID(),
        model = use === 'default' ? 'default-fixture' : 'purpose-fixture'
      store.write(use, { separate: true, model, endpoint: 'http://localhost/v1' })
      const selected = store.read(use)
      const sealed = sharedConnectionVault().encryptString(
        JSON.stringify({
          scope: 'chatgpt.tokens.use.direct',
          access: id,
          expires: Date.now() + 60000,
        }),
      )
      db.prepare('INSERT INTO plan_accounts(id,credential,models) VALUES(?,?,?)').run(
        selected.id,
        sealed,
        '[]',
      )
      assert.equal(await requestVisualModel(store, '原文依据', '文档数据'), '已接收')
    }
  } finally {
    db.close()
  }
  assert.deepEqual(models, ['default-fixture', 'purpose-fixture'])
  console.log('PASS platform subscription without API Key, default and purpose-specific model', ref)
} finally {
  store.close()
}
