// 翻译 / 音译调试提示：把加载阶段的结果元信息压成一句适合 Toast 的中文摘要。
const SOURCE_LABEL = {
  netease: '网易云',
  none: '无源站结果',
}

export function translationDebugMessage(song, meta, { translate = true, romanize = false } = {}) {
  const title = String(song?.title || '').trim()
  const prefix = `翻译调试 · ${title || '当前歌曲'}`
  if (!meta) {
    const wanted = [translate && '译文', romanize && '音译'].filter(Boolean).join(' / ') || '翻译'
    return `${prefix}：没有可用的${wanted}结果，已保留原文`
  }
  if (meta.skipped) return `${prefix}：未发起翻译，${String(meta.warning || '当前歌词不需要增强')}`
  const source = SOURCE_LABEL[meta.source] || meta.source || '未知来源'
  const matched = String(meta.matched || '').trim()
  const sourceCount = Math.max(0, Number(meta.sourceCount) || 0)
  const aiCount = Math.max(0, Number(meta.aiCount) || 0)
  const warning = String(meta.warning || '').trim()
  const visibleWarning = /cancel/i.test(warning) ? '' : warning
  const parts = [`来源 ${source}`]
  if (matched) parts.push(`匹配 ${matched}`)
  if (translate) parts.push(`源站译文 ${sourceCount} 行`)
  if (aiCount) parts.push(`AI 补译 ${aiCount} 行`)
  if (!translate && romanize) parts.push('仅取同源音译')
  if (visibleWarning) parts.push(visibleWarning)
  return `${prefix}：${parts.join(' · ')}`
}
