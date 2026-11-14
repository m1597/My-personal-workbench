type Language = 'zh-CN' | 'en'
export function playbackReason(reason: string, language: Language, online: boolean) {
  const t = (zh: string, en: string) => (language === 'en' ? en : zh)
  if (/401|403|forbidden|unauthori[sz]ed|拒绝访问/i.test(reason))
    return t(
      '音源拒绝访问此录音，请切换音源后重试。',
      'The source denied access to this recording. Try a different source.',
    )
  if (/404|410|not found|ENOENT|不可用|文件缺失|找不到/i.test(reason))
    return online
      ? t(
          '音源找不到此录音，请选择其他版本。',
          'This recording is unavailable from the source. Choose another version.',
        )
      : t(
          '找不到音乐文件，请重新定位或连接所在磁盘。',
          'The music file is unavailable. Locate it again or reconnect the drive.',
        )
  if (/timed? ?out|超时|timeout/i.test(reason))
    return t('音源响应超时，请重试或切换音源。', 'The source timed out. Retry or switch sources.')
  if (/network|fetch|连接|网络|传输|HTTP|ECONN/i.test(reason))
    return t(
      '音频传输失败，请检查网络连接或切换音源。',
      'The audio could not be transferred. Check your connection or switch sources.',
    )
  if (/NotAllowedError|permission|权限/i.test(reason))
    return t(
      '播放被阻止，请检查访问权限后再次点击播放。',
      'Playback was blocked. Check access permissions and press Play again.',
    )
  if (
    /NotSupportedError|supported source|decode|解码|编码|格式|media_err_src_not_supported/i.test(
      reason,
    )
  )
    return online
      ? t(
          '无法解码音源返回的音频，请尝试其他版本或音源。',
          'The audio from this source could not be decoded. Try another version or source.',
        )
      : t(
          '无法解码此文件，可能是格式不受支持或文件已损坏。',
          'This file could not be decoded. Its format may be unsupported or the file may be damaged.',
        )
  if (/音源|source|录音版本|录音地址/i.test(reason))
    return t(
      '音源未能提供该录音，请切换音源或选择其他版本。',
      'The source could not provide this recording. Choose a different source or version.',
    )
  return t('无法播放这首歌，请重试。', 'This track could not be played. Please try again.')
}
export function userMessage(raw: string, language: Language) {
  const text = raw
    .replace(/^.*?Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(?:Error:\s*)+/, '')
    .trim()
  if (!text) return ''
  if (/NotSupportedError|no supported source|NotAllowedError|NetworkError/i.test(text))
    return playbackReason(text, language, false)
  if (language === 'zh-CN' && /[㐀-鿿]/.test(text)) return text
  if (/权限|permission|EACCES/i.test(text))
    return language === 'en'
      ? 'Access was denied. Check the file and folder permissions.'
      : '无法访问，请检查文件和文件夹权限。'
  if (/数据库|存储|磁盘|storage|SQLITE|ENOSPC/i.test(text))
    return language === 'en'
      ? 'Storage is unavailable. Check disk space and directory permissions.'
      : '存储不可用，请检查磁盘空间和目录权限。'
  if (/网络|请求|连接|离线|超时|network|fetch|timeout/i.test(text))
    return language === 'en'
      ? 'The service could not be reached. Check your connection and retry.'
      : '无法连接服务，请检查网络后重试。'
  return language === 'en'
    ? 'The operation could not be completed. Please try again.'
    : '操作未完成，请重试。'
}
