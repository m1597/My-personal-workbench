// This bootstrap runs inside QuickJS, with no Node or desktop objects.
const handlers = new Map()
const callbacks = new Map()
let sequence = 0
let capabilities
function schedule(kind, callback, args) {
  const id = ++sequence
  callbacks.set(id, callback)
  fitbayEmit(JSON.stringify({ kind, id, ...args }))
  return id
}
globalThis.setTimeout = (callback, ms, ...args) =>
  schedule('timer', () => callback(...args), { ms })
globalThis.clearTimeout = (id) => callbacks.delete(id)
globalThis.console = { log() {}, warn() {}, error() {}, info() {} }
globalThis.lx = {
  env: 'desktop',
  version: '2.12.6',
  EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
  on: (name, handler) => handlers.set(name, handler),
  send: (name, data) => {
    if (name === 'inited') capabilities = data.sources
  },
  request: (url, options, callback) => {
    const id = schedule('http', callback, { url, options })
    return () => callbacks.delete(id)
  },
}
globalThis.fitbayReply = (id, error, value) => {
  const callback = callbacks.get(id)
  callbacks.delete(id)
  if (callback) callback(error ? new Error(error) : null, value)
}
globalThis.fitbayRun = (payload) => {
  if (!capabilities || !handlers.has('request')) return false
  Promise.resolve(payload ? handlers.get('request')(payload) : capabilities).then(
    (value) => fitbayEmit(JSON.stringify({ kind: 'done', value })),
    () => fitbayEmit(JSON.stringify({ kind: 'failed' })),
  )
  return true
}
