// Other hostnames retain the original resolver so the audio and platform fixtures still run.
export async function offlineSourceRepository(app) {
  await app.evaluate(({ net }) => {
    const fetch = net.fetch.bind(net)
    net.fetch = (url, options) =>
      ['raw.githubusercontent.com', 'api.github.com'].includes(new URL(url).hostname)
        ? Promise.reject(Error('离线仓库夹具'))
        : fetch(url, options)
    const dns = process.getBuiltinModule('node:dns/promises')
    const lookup = dns.lookup.bind(dns)
    dns.lookup = (host, options) =>
      ['raw.githubusercontent.com', 'api.github.com', 'gh-proxy.org'].includes(host)
        ? Promise.reject(Error('离线仓库夹具'))
        : lookup(host, options)
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
  })
}
