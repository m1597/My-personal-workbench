const headers = { 'User-Agent': 'FitBay/0.1 (https://github.com/m1597/My-personal-workbench)' }
async function request(url) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  })
  if (!response.ok) throw Error('照片服务暂时不可用')
  return response
}
export async function loadArtistPortrait(id, metadata, nativeImage) {
  const artist = await metadata('artist/' + id, { inc: 'url-rels' })
  const relations = artist.relations ?? []
  let file
  for (const r of relations) {
    const direct =
      r.type === 'image' &&
      /^https:\/\/commons\.wikimedia\.org\/wiki\/File:(.+)$/i.exec(r.url?.resource)
    if (direct) {
      file = decodeURIComponent(direct[1])
      break
    }
  }
  if (!file) {
    const entity = relations
      .map(
        (r) =>
          r.type === 'wikidata' &&
          /^https:\/\/www\.wikidata\.org\/(?:wiki|entity)\/(Q\d+)$/.exec(r.url?.resource)?.[1],
      )
      .find(Boolean)
    if (!entity) return null
    const data = await (
      await request('https://www.wikidata.org/wiki/Special:EntityData/' + entity + '.json')
    ).json()
    const claim = data.entities?.[entity]?.claims?.P18?.find(
      (x) => x.rank !== 'deprecated' && x.mainsnak?.datavalue?.type === 'string',
    )
    file = claim?.mainsnak.datavalue.value
  }
  if (typeof file !== 'string' || !file || file.length > 512) return null
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: 'File:' + file,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '200',
  })
  const data = await (await request(url)).json()
  const source = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0]
  const link = source?.thumburl || source?.url
  if (!link || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(link)) return null
  const response = await request(link)
  if (!/^image\/(jpeg|png|webp)\b/i.test(response.headers.get('content-type') || '')) return null
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > 2 * 1024 * 1024) return null
    chunks.push(chunk)
  }
  const image = nativeImage.createFromBuffer(Buffer.concat(chunks))
  return image.isEmpty()
    ? null
    : 'data:image/jpeg;base64,' + image.resize({ width: 160 }).toJPEG(84).toString('base64')
}
