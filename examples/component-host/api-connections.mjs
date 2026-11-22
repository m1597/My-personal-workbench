import { sharedConnectionVault } from './connection-vault.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const apiUses = Object.freeze({
  'prompts.model': { component: '提示词库', purpose: '模型' },
  'music.model': { component: 'Music', purpose: '模型与推荐' },
  'toolkit.translation': { component: '工具集', purpose: '翻译' },
  'toolkit.vision': { component: '工具集', purpose: '视觉模型' },
})

// Each process opens the same profile database. BEGIN IMMEDIATE serializes first
// import, rebinding and credential rotation across standalone and docked clients.
export function openConnections(profile, legacyVault) {
  const vault = sharedConnectionVault(legacyVault)
  mkdirSync(profile, { recursive: true })
  const db = new DatabaseSync(path.join(profile, 'api-connections.sqlite'))
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL,model TEXT NOT NULL,secret BLOB,protocol TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bindings(use TEXT PRIMARY KEY,connection TEXT NOT NULL REFERENCES connections(id));`)
  const row = (use) =>
    db
      .prepare('SELECT c.* FROM bindings b JOIN connections c ON c.id=b.connection WHERE b.use=?')
      .get(use)
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
    return r
      ? {
          id: r.id,
          endpoint: r.endpoint,
          model: r.model,
          configured: Boolean(r.secret?.length),
          protocol: r.protocol,
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
      const old = row(use)
      if (input.expectedId !== undefined && (old?.id ?? null) !== input.expectedId)
        throw Error('连接已由其他窗口更改，请重新选择用途后保存')
      if (legacy && old) return view(old)
      if (input.reuse) {
        if (!db.prepare('SELECT id FROM connections WHERE id=?').get(input.reuse))
          throw Error('连接已不存在')
        db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?)').run(use, input.reuse)
      } else {
        let endpoint
        try {
          endpoint = new URL(input.endpoint)
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
        const model = input.model?.trim()
        if (!model || model.length > 250) throw Error('请填写模型名称')
        const id = old && !input.separate ? old.id : randomUUID()
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
      db.exec('DELETE FROM connections WHERE id NOT IN (SELECT connection FROM bindings)')
      return view(row(use))
    })
  }
  return {
    read(use) {
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
      const r = row(use)
      if (!r?.secret) return null
      try {
        return { ...view(r), key: vault.decryptString(Buffer.from(r.secret)) }
      } catch {
        throw Error('无法解密连接，请重新填写密钥')
      }
    },
    close: () => db.close(),
  }
}
