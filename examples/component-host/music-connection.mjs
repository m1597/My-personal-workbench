import { connectionEndpoint } from './api-connections.mjs'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { sharedConnectionVault } from './connection-vault.mjs'

export const providers = {
  deepseek: {
    label: 'DeepSeek',
    model: 'deepseek-flash',
    url: 'https://api.deepseek.com/chat/completions',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-5-mini',
    url: 'https://api.openai.com/v1/responses',
  },
  claude: {
    label: 'Claude',
    model: 'claude-haiku-5-5',
    url: 'https://api.anthropic.com/v1/messages',
  },
  gemini: {
    label: 'Gemini',
    model: 'gemini-3.5-flash',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/',
  },
}
export const setting = 'recommendation-providers'
export function config(store) {
  let value
  try {
    value = JSON.parse(store.get(setting) || 'null')
  } catch {
    // A damaged optional model setting must not prevent opening the local library.
  }
  return {
    active:
      typeof value?.active === 'string' && Object.hasOwn(providers, value.active)
        ? value.active
        : 'deepseek',
    accounts: value?.accounts && typeof value.accounts === 'object' ? value.accounts : {},
  }
}
export const protocols = {
  deepseek: 'chat',
  openai: 'responses',
  claude: 'claude',
  gemini: 'gemini',
}
export function legacyRoute(provider, account = {}) {
  const preset = providers[provider]
  // Older preset accounts omitted the URL. A stored custom URL belongs to
  // this account's ciphertext and must never be replaced by a preset address.
  const endpoint = Object.hasOwn(account, 'endpoint')
    ? account.endpoint
    : Object.hasOwn(account, 'url')
      ? account.url
      : preset.url
  if (
    typeof endpoint !== 'string' ||
    !endpoint.trim() ||
    (Object.hasOwn(account, 'endpoint') &&
      Object.hasOwn(account, 'url') &&
      account.endpoint !== account.url)
  )
    throw Error('旧模型连接的地址无法确认')
  const protocol = account.protocol ?? protocols[provider]
  if (!Object.values(protocols).includes(protocol)) throw Error('旧模型协议无法确认')
  return {
    endpoint: connectionEndpoint(endpoint).href,
    model: account.model || preset.model,
    protocol,
  }
}

export function importMusicConnection(store, connections) {
  const state = config(store),
    account = state.accounts[state.active]
  if (!account || (!account.secret && connections.read('music.model')?.source === 'default')) return
  const connection = connections.importLegacy('music.model', {
    ...legacyRoute(state.active, account),
    encrypted: account.secret ? Buffer.from(account.secret, 'base64') : null,
  })
  if (store.set && account.secret) {
    delete account.secret
    store.set(setting, JSON.stringify(state))
  }
  return connection
}

export function importInstalledMusicConnection(profile, connections) {
  if (connections.direct('music.model')) return
  const file = path.join(profile, 'fitbay-music', 'music.sqlite')
  if (!existsSync(file)) return
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    importMusicConnection(
      { get: (key) => db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value },
      connections,
    )
  } finally {
    db.close()
  }
}

// The user selects a profile. Read only the two Music-owned settings and keep
// the destination binding when it has already been configured independently.
export function recoverMusicProfile(store, profile, legacyVault) {
  const file = path.join(profile, 'fitbay-music', 'music.sqlite')
  if (!existsSync(file)) throw Error('请选择包含 fitbay-music 的旧资料目录')
  const db = new DatabaseSync(file, { readOnly: true })
  let artists, legacy
  try {
    const read = (key) => db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value
    artists = JSON.parse(read('followed-musicbrainz-artists') || '[]')
    legacy = config({ get: read })
    if (
      !Array.isArray(artists) ||
      artists.some(
        (a) =>
          typeof a?.id !== 'string' ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(a.id) ||
          typeof a.name !== 'string' ||
          (a.aliases !== undefined &&
            (!Array.isArray(a.aliases) || a.aliases.some((alias) => typeof alias !== 'string'))) ||
          (a.detail !== undefined && typeof a.detail !== 'string'),
      )
    )
      throw Error()
  } catch {
    throw Error('旧资料中的关注歌手无法读取')
  } finally {
    db.close()
  }
  const setting = 'followed-musicbrainz-artists'
  let added = 0
  store.db.exec('BEGIN IMMEDIATE')
  try {
    const current = JSON.parse(store.get(setting) || '[]')
    const ids = new Set(current.map((a) => a.id))
    for (const artist of artists) {
      if (ids.has(artist.id)) continue
      ids.add(artist.id)
      current.push(artist)
      added++
    }
    if (added) store.set(setting, JSON.stringify(current))
    store.db.exec('COMMIT')
  } catch (error) {
    store.db.exec('ROLLBACK')
    throw error
  }
  const current = store.connections.read('music.model')
  if (current && current.source !== 'default' && current.configured)
    return { added, model: '已保留当前专用连接' }
  const shared = path.join(profile, 'api-connections.sqlite')
  try {
    let record
    if (existsSync(shared)) {
      const source = new DatabaseSync(shared, { readOnly: true })
      try {
        record = source
          .prepare(
            'SELECT endpoint,model,protocol,secret FROM connections JOIN bindings ON connection=id WHERE use=?',
          )
          .get('music.model')
      } finally {
        source.close()
      }
    }
    const account = legacy.accounts[legacy.active]
    if (!record && account?.secret)
      record = {
        ...legacyRoute(legacy.active, account),
        secret: Buffer.from(account.secret, 'base64'),
      }
    if (!record?.secret?.length) return { added, model: '旧资料中没有配置专用密钥' }
    const key = sharedConnectionVault(legacyVault).decryptString(Buffer.from(record.secret))
    if (typeof key !== 'string' || !key.trim()) throw Error('旧连接凭据为空')
    store.connections.write('music.model', {
      expectedId: current?.id ?? null,
      separate: true,
      endpoint: record.endpoint,
      model: record.model,
      protocol: record.protocol,
      key,
    })
    return { added, model: '已恢复专用模型连接' }
  } catch {
    return { added, model: '连接恢复失败，请在音乐设置的模型与推荐中检查连接或重新填写密钥' }
  }
}
