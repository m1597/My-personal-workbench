function serviceUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw Error('服务地址无效')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('请使用不含凭据的 HTTPS 地址，本机服务也可用 HTTP')
  return url
}
export function modelEndpoint(input, protocol = 'chat', model = '') {
  const url = serviceUrl(input)
  const base = url.pathname.replace(/\/+$/, '')
  const suffix = { chat: '/chat/completions', responses: '/responses', claude: '/messages' }[
    protocol
  ]
  if (protocol === 'gemini') {
    const prefix = base.replace(/\/models(?:\/[^/]+:generateContent)?$/, '')
    url.pathname = prefix + '/models/' + encodeURIComponent(model) + ':generateContent'
  } else if (suffix) url.pathname = base.endsWith(suffix) ? base : base + suffix
  else throw Error('服务协议不受支持')
  return url.href
}
function formatParts(content, protocol) {
  if (typeof content === 'string') return protocol === 'gemini' ? [{ text: content }] : content
  return content.map((part) => {
    if (part.type === 'text')
      return protocol === 'gemini'
        ? { text: part.text }
        : protocol === 'responses'
          ? { type: 'input_text', text: part.text }
          : part
    const url = part.image_url.url
    if (protocol === 'responses') return { type: 'input_image', image_url: url }
    const data = url.slice('data:image/png;base64,'.length)
    return protocol === 'claude'
      ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
      : { inlineData: { mimeType: 'image/png', data } }
  })
}
function payload(protocol, model, messages) {
  if (protocol === 'chat') return { model, messages }
  if (protocol === 'gemini')
    return {
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: formatParts(m.content, protocol),
      })),
    }
  const input = messages.map((m) => ({ role: m.role, content: formatParts(m.content, protocol) }))
  return protocol === 'responses'
    ? { model, input, store: false }
    : { model, messages: input, max_tokens: 4096 }
}
function answerText(data, protocol) {
  if (protocol === 'chat') return data.choices?.[0]?.message?.content
  if (protocol === 'gemini')
    return data.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text)
      .join('')
  if (protocol === 'claude')
    return data.content
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('')
  return data.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content)
    .filter((p) => p.type === 'output_text')
    .map((p) => p.text)
    .join('')
}
export async function complete(config, key, messages, signal) {
  const { model, protocol = 'chat' } = config
  if (!model.trim()) throw Error('请先在工具集设置中填写模型名')
  const url = modelEndpoint(config.endpoint, protocol, model)
  const headers = { 'Content-Type': 'application/json' }
  if (protocol === 'claude') headers['anthropic-version'] = '2023-06-01'
  if (key) {
    if (protocol === 'claude') headers['x-api-key'] = key
    else if (protocol === 'gemini') headers['x-goog-api-key'] = key
    else headers.Authorization = 'Bearer ' + key
  }
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(60000), signal]),
    headers,
    body: JSON.stringify(payload(protocol, model, messages)),
  }).catch(() => {
    throw Error('请求中断或超时，请检查 API 地址后重试')
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw Error('模型服务返回 HTTP ' + response.status + '，请检查密钥、模型及图片支持后重试')
  }
  let answer
  try {
    answer = answerText(await response.json(), protocol)
  } catch {
    throw Error('模型响应格式无效')
  }
  if (typeof answer !== 'string' || !answer.trim()) throw Error('模型响应没有可显示的文字')
  return answer
}
