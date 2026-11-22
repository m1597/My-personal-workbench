import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

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
export function importMusicConnection(store, connections) {
  const state = config(store),
    account = state.accounts[state.active]
  if (!account) return
  const connection = connections.importLegacy('music.model', {
    endpoint: providers[state.active].url,
    model: account.model,
    protocol: protocols[state.active],
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
