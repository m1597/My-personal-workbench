import {
  signInChatGPT,
  renewChatGPT,
  revokeChatGPT,
  planModels,
  inferPlan,
} from './chatgpt-plan.mjs'
import { sharedConnectionVault } from './connection-vault.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function connectionEndpoint(value) {
  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    throw Error('服务地址无效')
  }
  if (
    endpoint.protocol !== 'https:' &&
    !(
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    )
  )
    throw Error('请使用 HTTPS 或本地服务地址')
  if (endpoint.password || endpoint.username || endpoint.search || endpoint.hash)
    throw Error('服务地址不能包含凭据、查询参数或片段')
  return endpoint
}

export const apiUses = Object.freeze({
  default: { component: '工作台', purpose: '默认连接' },
  'prompts.model': { component: '提示词库', purpose: '模型' },
  'music.model': { component: 'Music', purpose: '模型与推荐' },
  'toolkit.translation': { component: '工具集', purpose: '翻译' },
  'toolkit.vision': { component: '工具集', purpose: '视觉模型' },
})

// Each process opens the same profile database. BEGIN IMMEDIATE serializes first
// import, rebinding and credential rotation across standalone and docked clients.
export function openConnections(profile, legacyVault, { request = fetch } = {}) {
  const vault = sharedConnectionVault(legacyVault)
  mkdirSync(profile, { recursive: true })
  const db = new DatabaseSync(path.join(profile, 'api-connections.sqlite'))
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL,model TEXT NOT NULL,secret BLOB,protocol TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inherited_uses(use TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS vision_connections(id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS bindings(use TEXT PRIMARY KEY,connection TEXT NOT NULL REFERENCES connections(id));`)
  db.exec(`CREATE TABLE IF NOT EXISTS plan_accounts(id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE, credential BLOB, identity BLOB, models TEXT NOT NULL, lease INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS plan_host(host TEXT PRIMARY KEY);`)
  const account = (id) => db.prepare('SELECT * FROM plan_accounts WHERE id=?').get(id)
  const seal = (value) => vault.encryptString(JSON.stringify(value))
  const unseal = (value) => JSON.parse(vault.decryptString(Buffer.from(value)))
  async function credentials(id) {
    const current = account(id)
    if (!current?.credential) throw Error('订阅已断开，请重新授权')
    const value = unseal(current.credential)
    if (value.expires > Date.now() + 30000) return value
    const lease = lockAccount(id, current)
    try {
      const next = await renewChatGPT(value, request)
      if (
        !db
          .prepare(
            'UPDATE plan_accounts SET credential=?,lease=0 WHERE id=? AND lease=? AND credential=?',
          )
          .run(seal(next), id, lease, current.credential).changes
      )
        throw Error('订阅授权已更新，请重试')
      return next
    } catch (err) {
      if (err.code === 'reauthorize')
        db.prepare(
          "UPDATE plan_accounts SET credential=NULL,models='[]' WHERE id=? AND lease=?",
        ).run(id, lease)
      throw err
    } finally {
      db.prepare('UPDATE plan_accounts SET lease=0 WHERE id=? AND lease=?').run(id, lease)
    }
  }
  function lockAccount(id, current) {
    const lease = Date.now() + 60000
    if (
      !db
        .prepare('UPDATE plan_accounts SET lease=? WHERE id=? AND credential=? AND lease<?')
        .run(lease, id, current.credential, Date.now()).changes
    )
      throw Error('授权正在更新，请重试')
    return lease
  }
  const row = (use) =>
    db
      .prepare('SELECT c.* FROM bindings b JOIN connections c ON c.id=b.connection WHERE b.use=?')
      .get(use)
  const visual = (id) => !!db.prepare('SELECT 1 FROM vision_connections WHERE id=?').get(id)
  function effective(use) {
    const direct = row(use)
    if (direct) return direct
    const fallback = row('default')
    return use !== 'toolkit.vision' || (fallback && visual(fallback.id)) ? fallback : null
  }
  function validateUse(use) {
    if (!Object.hasOwn(apiUses, use)) throw Error('未知配置用途')
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  function view(r) {
    const plan = r && account(r.id)
    return r
      ? {
          id: r.id,
          endpoint: r.endpoint,
          model: r.model,
          configured: plan ? Boolean(plan.credential && r.model) : Boolean(r.secret?.length),
          ...(plan && {
            authType: 'subscription',
            signedIn: Boolean(plan.credential),
            models: JSON.parse(plan.models),
          }),
          protocol: r.protocol,
          vision: visual(r.id),
        }
      : null
  }
  function write(use, input, legacy = false) {
    validateUse(use)
    if (
      !input ||
      typeof input !== 'object' ||
      (input.key !== undefined &&
        (typeof input.key !== 'string' || input.key.length > 4096 || /[\r\n]/.test(input.key)))
    )
      throw Error('连接参数无效')
    return transaction(() => {
      const direct = row(use)
      const old = legacy ? direct : effective(use)
      if (input.expectedId !== undefined && (old?.id ?? null) !== input.expectedId)
        throw Error('连接已由其他窗口更改，请重新选择用途后保存')
      if (legacy && (old || db.prepare('SELECT 1 FROM inherited_uses WHERE use=?').get(use)))
        return view(effective(use))
      if (input.inherit && use !== 'default') {
        db.prepare('INSERT OR IGNORE INTO inherited_uses VALUES(?)').run(use)
        db.prepare('DELETE FROM bindings WHERE use=?').run(use)
      } else if (input.reuse) {
        if (!db.prepare('SELECT id FROM connections WHERE id=?').get(input.reuse))
          throw Error('连接已不存在')
        if (use === 'toolkit.vision' && !visual(input.reuse))
          throw Error('请选择支持视觉输入的连接')
        db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?)').run(use, input.reuse)
      } else {
        const endpoint = connectionEndpoint(input.endpoint)
        const model = input.model?.trim()
        if (!model || model.length > 250) throw Error('请填写模型名称')
        if (direct && account(direct.id) && !input.separate) throw Error('请先选择单独配置 API Key')
        const id = direct && !input.separate ? direct.id : randomUUID()
        const protocol = input.protocol ?? old?.protocol ?? 'chat'
        if (!['chat', 'responses', 'claude', 'gemini'].includes(protocol))
          throw Error('模型协议无效')
        let secret = !input.clearKey && old?.endpoint === endpoint.href ? old.secret : null
        if (legacy)
          secret = input.encrypted?.length
            ? vault.encryptString(legacyVault.decryptString(Buffer.from(input.encrypted)))
            : null
        else if (input.key) {
          if (!vault.isEncryptionAvailable()) throw Error('系统凭据保护不可用')
          secret = vault.encryptString(input.key)
        }
        db.prepare(
          'INSERT INTO connections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,model=excluded.model,secret=excluded.secret,protocol=excluded.protocol',
        ).run(id, endpoint.href, model, secret, protocol)
        db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?)').run(use, id)
      }
      if (use === 'toolkit.vision' && !input.inherit && !account(row(use).id))
        db.prepare('INSERT OR IGNORE INTO vision_connections VALUES(?)').run(row(use).id)
      if (use === 'default' && typeof input.vision === 'boolean' && !account(row(use).id)) {
        const id = row(use).id
        if (input.vision) db.prepare('INSERT OR IGNORE INTO vision_connections VALUES(?)').run(id)
        else db.prepare('DELETE FROM vision_connections WHERE id=?').run(id)
      }
      db.exec(
        'DELETE FROM connections WHERE id NOT IN (SELECT connection FROM bindings) AND id NOT IN (SELECT id FROM plan_accounts)',
      )
      return view(effective(use))
    })
  }
  return {
    read(use) {
      validateUse(use)
      const r = effective(use)
      return r ? { ...view(r), source: row(use) ? 'dedicated' : 'default' } : null
    },
    direct(use) {
      validateUse(use)
      return view(row(use))
    },
    choices() {
      const bindings = db.prepare('SELECT use,connection FROM bindings ORDER BY use').all()
      return db
        .prepare('SELECT * FROM connections ORDER BY rowid')
        .all()
        .map((r) => ({
          ...view(r),
          owners: bindings
            .filter((b) => b.connection === r.id && Object.hasOwn(apiUses, b.use))
            .map((b) => apiUses[b.use].component + ' · ' + apiUses[b.use].purpose),
        }))
    },
    write: (use, input) => write(use, input),
    importLegacy: (use, input) => write(use, input, true),
    // Main-process consumers only. Public snapshots never contain decrypted keys.
    resolve(use) {
      validateUse(use)
      const r = effective(use)
      if (!r?.secret) return null
      try {
        return { ...view(r), key: vault.decryptString(Buffer.from(r.secret)) }
      } catch {
        throw Error('无法解密连接，请重新填写密钥')
      }
    },
    async authorizePlan(use, expectedId, openBrowser) {
      validateUse(use)
      if (!vault.isEncryptionAvailable()) throw Error('系统凭据保护不可用')
      const old = effective(use)
      if ((old?.id ?? null) !== expectedId) throw Error('连接已变化，请重试')
      const direct = row(use)
      const prior = direct && account(direct.id)
      const host = transaction(() => {
        const existing = db.prepare('SELECT host FROM plan_host LIMIT 1').get()
        if (existing) return existing.host
        const value = 'urn:uuid:' + randomUUID()
        db.prepare('INSERT INTO plan_host VALUES(?)').run(value)
        return value
      })
      const record = await signInChatGPT(
        host,
        openBrowser,
        prior?.identity ? unseal(prior.identity) : undefined,
        request,
      )
      const models = await planModels(record, request).catch(() => [])
      const chosen =
        models.find((m) => m.id === direct?.model && (use !== 'toolkit.vision' || m.vision)) ??
        models.find((m) => use !== 'toolkit.vision' || m.vision)
      return transaction(() => {
        if ((effective(use)?.id ?? null) !== expectedId) throw Error('连接已变化，请重试')
        const id = prior ? direct.id : randomUUID()
        db.prepare(
          "INSERT INTO connections VALUES(?,?,?,NULL,'responses') ON CONFLICT(id) DO UPDATE SET model=excluded.model",
        ).run(id, 'https://api.openai.com/v1', chosen?.id ?? '')
        db.prepare(
          'INSERT OR REPLACE INTO plan_accounts(id,credential,identity,models) VALUES(?,?,?,?)',
        ).run(
          id,
          seal(record),
          seal({ clientId: record.clientId, subject: record.subject }),
          JSON.stringify(models),
        )
        db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?)').run(use, id)
        db.prepare('DELETE FROM vision_connections WHERE id=?').run(id)
        if (chosen?.vision) db.prepare('INSERT INTO vision_connections VALUES(?)').run(id)
        return view(effective(use))
      })
    },
    async refreshPlanModels(use, id) {
      validateUse(use)
      if (effective(use)?.id !== id) throw Error('连接已变化')
      const record = await credentials(id)
      const models = await planModels(record, request)
      return transaction(() => {
        if (effective(use)?.id !== id || !account(id)?.credential) throw Error('连接已变化')
        db.prepare('UPDATE plan_accounts SET models=? WHERE id=?').run(JSON.stringify(models), id)
        const needVision = use === 'toolkit.vision' || row('toolkit.vision')?.id === id
        const compatible = models.filter((m) => !needVision || m.vision)
        const chosen = compatible.find((m) => m.id === effective(use)?.model) ?? compatible[0]
        db.prepare('UPDATE connections SET model=? WHERE id=?').run(chosen?.id ?? '', id)
        db.prepare('DELETE FROM vision_connections WHERE id=?').run(id)
        if (chosen?.vision) db.prepare('INSERT INTO vision_connections VALUES(?)').run(id)
        return view(effective(use))
      })
    },
    selectPlanModel(use, id, model) {
      validateUse(use)
      return transaction(() => {
        if (effective(use)?.id !== id) throw Error('连接已变化')
        const selected = JSON.parse(account(id)?.models ?? '[]').find((m) => m.id === model)
        if (
          !selected ||
          ((use === 'toolkit.vision' || row('toolkit.vision')?.id === id) && !selected.vision)
        )
          throw Error('模型不支持该用途')
        db.prepare('UPDATE connections SET model=? WHERE id=?').run(model, id)
        db.prepare('DELETE FROM vision_connections WHERE id=?').run(id)
        if (selected.vision) db.prepare('INSERT INTO vision_connections VALUES(?)').run(id)
        return view(effective(use))
      })
    },
    async revokePlan(use, id) {
      validateUse(use)
      if (effective(use)?.id !== id) throw Error('连接已变化')
      const value = account(id)
      if (!value?.credential) return
      const lease = lockAccount(id, value)
      try {
        await revokeChatGPT(unseal(value.credential), request)
        if (
          !db
            .prepare(
              "UPDATE plan_accounts SET credential=NULL,models='[]',lease=0 WHERE id=? AND lease=? AND credential=?",
            )
            .run(id, lease, value.credential).changes
        )
          throw Error('授权已变化，请重试')
      } finally {
        db.prepare('UPDATE plan_accounts SET lease=0 WHERE id=? AND lease=?').run(id, lease)
      }
    },
    async requestPlan(use, input) {
      validateUse(use)
      const r = effective(use)
      if (!r || !account(r.id)) throw Error('请选择订阅连接')
      const record = await credentials(r.id)
      if (!r.model) throw Error('已登录，套餐未提供适用模型')
      if (
        Array.isArray(input.input) &&
        input.input.some(
          (m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'input_image'),
        ) &&
        !visual(r.id)
      )
        throw Error('此模型不支持图像输入')
      return inferPlan(record, r.model, input, request)
    },
    close: () => db.close(),
  }
}
