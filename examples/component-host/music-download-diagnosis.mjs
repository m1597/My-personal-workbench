// Network and DOM errors also carry codes (TimeoutError is numeric 23).
const fileCodes = new Set([
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EDQUOT',
  'EROFS',
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENAMETOOLONG',
  'EBUSY',
  'EXDEV',
])
export function isStorageError(error) {
  return (
    error?.kind === 'storage' ||
    fileCodes.has(error?.code) ||
    error?.code === 'ERR_SQLITE_ERROR' ||
    (typeof error?.code === 'string' && error.code.startsWith('SQLITE_'))
  )
}
export function serviceErrorMessage(error) {
  if (isStorageError(error)) return '存储操作失败，请检查空间和目录权限后重试'
  if (error.name === 'TimeoutError') return '请求超时，请稍后重试'
  if (error.code) return '请求未完成，请检查服务连接后重试'
  return String(error.message)
}
const platforms = {
  wy: '网易云音乐',
  tx: 'QQ 音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
}
const messages = {
  unknown: '已找到这首歌，当前来源未声明是否允许保存',
  denied: '已找到这首歌，当前来源明确禁止保存',
  preview: '已找到这首歌，当前来源仅提供试听',
  missing: '当前来源没有找到匹配的录音版本',
  quality: '已找到这首歌，当前来源没有可下载的完整音质',
  source: '请先在设置中导入音乐源',
  storage: '保存文件失败，请检查下载目录和可用空间',
  cancelled: '本次下载已取消，可以重新开始',
  address: '已找到这首歌，音乐源未能解析可用的音频地址',
  download: '已找到这首歌，下载未完成，可稍后重试',
  unusable: '已找到这首歌，当前来源没有返回可保存的完整音频',
  'source-request': '音乐源暂未返回可用结果，可稍后重试',
  other: '本次下载未完成，请查看详情',
}
export function describeFailure(attempts) {
  const kinds = new Set(attempts.flatMap((a) => a.kinds))
  const network = attempts.filter((a) =>
    a.kinds.some((k) => k === 'network' || k === 'source-request'),
  )
  const names = [...new Set(network.map((a) => platforms[a.platform]).filter(Boolean))]
  let kind
  let summary
  const permissionPhrases = {
    unknown: '未声明保存许可',
    preview: '仅提供试听',
    denied: '明确禁止保存',
  }
  const rights = Object.keys(permissionPhrases).filter((k) => kinds.has(k))
  if (network.length) {
    kind = 'network'
    const target = names.length === 1 ? names[0] : '部分音乐平台'
    summary =
      kinds.size === 1
        ? '暂时无法获取' + target + '的结果，可稍后重试'
        : target +
          '暂未返回结果，' +
          (rights.length === 1 ? '另有来源' + permissionPhrases[rights[0]] : '其他来源也未能保存') +
          '，可稍后重试'
  } else if (kinds.has('download')) {
    kind = 'download'
    summary = messages.download
  } else {
    const matched = [...kinds].filter((k) => !['missing', 'ignored'].includes(k))
    kind = matched.length === 1 ? matched[0] : kinds.size === 1 ? [...kinds][0] : 'mixed'
    summary =
      messages[kind] ??
      (rights.length > 1
        ? '已找到这首歌，匹配的来源分别' + rights.map((k) => permissionPhrases[k]).join('、')
        : '各来源的结果不同，暂未找到可保存的完整录音')
  }
  const groups = new Map()
  for (const attempt of attempts) {
    const platform = platforms[attempt.platform] || attempt.platform || ''
    const group = groups.get(platform) ?? new Map()
    groups.set(platform, group)
    const sources = group.get(attempt.message) ?? new Set()
    if (attempt.source) sources.add(attempt.source)
    group.set(attempt.message, sources)
  }
  const detail = [...groups]
    .map(([platform, group]) => {
      const messages = [...group].map(([reason, sources]) =>
        [reason, [...sources].join('、')].filter(Boolean).join(' · '),
      )
      return [platform, messages.join('；')].filter(Boolean).join(' · ')
    })
    .join('\n')
  return { kind, summary, detail }
}
