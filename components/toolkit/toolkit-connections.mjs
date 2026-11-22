import { watch } from 'node:fs'
import { modelEndpoint } from './model.mjs'

const routes = ['translation', 'vision']
function use(route) {
  if (!routes.includes(route)) throw Error('未知工具集用途')
  return 'toolkit.' + route
}
export function toolkitConnections({
  shared,
  packaged,
  safeStorage,
  legacy,
  onMigrated,
  onChange,
}) {
  let opening,
    db,
    uses,
    watcher,
    timer,
    closed = false
  const pendingLegacy = new Set()
  function finishMigration() {
    if (!pendingLegacy.size) onMigrated()
  }
  async function open() {
    if (!opening)
      opening = (async () => {
        const path = packaged
          ? './api-connections.mjs'
          : '../../examples/component-host/api-connections.mjs'
        const { openConnections, apiUses } = await import(path)
        uses = apiUses
        db = openConnections(shared, safeStorage)
        if (legacy.model && legacy.endpoint) {
          const input = {
            endpoint: legacy.endpoint,
            model: legacy.model,
            encrypted: legacy.secret ? Buffer.from(legacy.secret, 'base64') : null,
            protocol: 'chat',
          }
          for (const route of routes) {
            try {
              db.importLegacy(use(route), input)
            } catch {
              pendingLegacy.add(route)
            }
          }
          finishMigration()
        }
        watcher = watch(shared, { persistent: false }, (_type, file) => {
          if (!file?.startsWith('api-connections.sqlite')) return
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (!closed) onChange()
          }, 75)
        })
        watcher.on('error', () => {})
        return db
      })().catch(() => {
        db?.close()
        db = undefined
        opening = undefined
        throw Error('无法读取受保护的连接配置，请检查当前用户及资料目录')
      })
    return opening
  }
  return {
    async snapshot() {
      const db = await open()
      const bindings = Object.entries(uses)
        .map(([id, label]) => ({ id, label, value: db.read(id) }))
        .filter((b) => b.value)
      function describe(value) {
        if (!value) return null
        const owners = bindings.filter(
          (b) => b.value.id === value.id && b.value.source !== 'default',
        )
        return {
          id: value.id,
          source: value.source,
          vision: value.vision,
          endpoint: value.endpoint,
          model: value.model,
          protocol: value.protocol,
          hasKey: value.configured,
          private: owners.length <= 1,
          name:
            owners.map((b) => b.label.component + ' · ' + b.label.purpose).join(' / ') +
            ' — ' +
            value.model,
        }
      }
      return {
        defaultConnection: uses.default ? describe(db.read('default')) : null,
        migrationPending: [...pendingLegacy],
        routes: Object.fromEntries(routes.map((route) => [route, describe(db.read(use(route)))])),
        connections: db.choices().map(describe),
      }
    },
    async save(value) {
      const id = use(value?.route),
        db = await open()
      if (typeof value.connection !== 'string') throw Error('请选择连接')
      if (value.connection === 'inherit') {
        db.write(id, { inherit: true, expectedId: value.expectedId })
      } else if (value.connection !== 'private' && value.connection !== 'edit') {
        db.write(id, { reuse: value.connection, expectedId: value.expectedId })
      } else {
        if (
          typeof value.endpoint !== 'string' ||
          typeof value.model !== 'string' ||
          typeof value.key !== 'string' ||
          value.key.length > 4096 ||
          /[\r\n]/.test(value.key)
        )
          throw Error('连接参数无效')
        modelEndpoint(value.endpoint)
        db.write(id, {
          expectedId: value.expectedId,
          endpoint: value.endpoint,
          model: value.model,
          key: value.key,
          protocol: value.protocol || 'chat',
          separate: value.connection === 'private',
        })
      }
      if (pendingLegacy.delete(value.route)) finishMigration()
      onChange()
    },
    async resolve(route) {
      const id = use(route),
        db = await open(),
        binding = db.read(id)
      if (!binding) throw Error('TOOLKIT_CONFIG_' + route)
      if (
        !binding.configured &&
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(binding.endpoint).hostname)
      )
        throw Error('TOOLKIT_CONFIG_' + route)
      try {
        return db.resolve(id) || { ...binding, key: '' }
      } catch {
        throw Error('TOOLKIT_CONFIG_' + route)
      }
    },
    close() {
      closed = true
      clearTimeout(timer)
      watcher?.close()
      db?.close()
    },
  }
}
