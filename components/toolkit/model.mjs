export function modelEndpoint(input) {
  const url = new URL(input)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('API 地址需要 HTTPS，本机服务也可用 HTTP')
  const base = url.pathname.replace(/\/+$/, '')
  url.pathname = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  return url.href
}
export async function complete(config, key, messages, signal) {
  if (!config.model.trim()) throw Error('请先在工具集设置中填写模型名')
  const response = await fetch(modelEndpoint(config.endpoint), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(60000), signal]),
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
    },
    body: JSON.stringify({ model: config.model, messages }),
  }).catch(() => {
    throw Error('请求中断或超时，请检查 API 地址后重试')
  })
  if (!response.ok)
    throw Error('模型服务返回 HTTP ' + response.status + '，请检查密钥、模型及图片支持后重试')
  const answer = (await response.json()).choices?.[0]?.message?.content
  if (typeof answer !== 'string' || !answer.trim()) throw Error('模型响应没有可显示的文字')
  return answer
}
