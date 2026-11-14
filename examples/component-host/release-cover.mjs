export async function fetchReleaseCover(id, nativeImage, edition = false) {
  let url = new URL(
    'https://coverartarchive.org/' + (edition ? 'release/' : 'release-group/') + id + '/front-250',
  )
  const signal = AbortSignal.timeout(8000)
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url, { signal, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) return null
      url = new URL(location, url)
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.port ||
        url.username ||
        url.password ||
        !/^(?:coverartarchive\.org|(?:[\w-]+\.)*archive\.org)$/i.test(url.hostname)
      )
        return null
      url.protocol = 'https:'
      continue
    }
    if (
      !response.ok ||
      !/^image\/(jpeg|png|webp)\b/i.test(response.headers.get('content-type') || '')
    ) {
      await response.body?.cancel()
      return null
    }
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 2 * 1024 * 1024) return null
      chunks.push(chunk)
    }
    const image = nativeImage.createFromBuffer(Buffer.concat(chunks))
    return image.isEmpty()
      ? null
      : 'data:image/jpeg;base64,' + image.resize({ width: 250 }).toJPEG(85).toString('base64')
  }
  return null
}
