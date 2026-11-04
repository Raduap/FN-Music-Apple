// 歌词加载与缓存：歌词面板、全屏播放页和悬浮球共用
import { api } from './api'
import { parseLrc } from './lib'

const MAX = 200
const done = new Map() // id -> lines（已加载）
const pending = new Map() // id -> Promise<lines>

// LRC 解析；没有时间戳的纯文本歌词也保留（time = -1，不滚动）
export function toLines(text) {
  const lines = parseLrc(text)
  if (!lines.length) {
    if (!text) return []
    return text.split(/\r?\n/).map((t) => t.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).map((t) => ({ time: -1, text: t }))
  }
  return mergeTranslations(lines)
}

// 双语歌词的常见写法：原文与译文使用相同的时间戳（连续两行）。
// 只有至少 3 个不同时间点都出现同时间歌词组时，才按该格式合并；
// 避免普通重复歌词被误判成双语。
const SAME_TIME = 0.005
const hasText = (line) => !!String(line?.text || '').trim()
function sameTimeGroups(lines) {
  const groups = []
  for (const l of lines) {
    const prev = groups[groups.length - 1]
    if (prev && Math.abs(prev.time - l.time) < SAME_TIME) prev.lines.push(l)
    else groups.push({ time: l.time, lines: [l] })
  }
  return groups
}
function mergeTranslations(lines) {
  const groups = sameTimeGroups(lines)
  const translationGroups = groups.filter((g) => g.lines.filter(hasText).length >= 2)
  if (translationGroups.length < 3) return lines.map((l) => ({ ...l }))
  const out = []
  for (const g of groups) {
    const [first, ...rest] = g.lines
    const translation = rest.map((l) => l.text).filter((t) => String(t || '').trim()).join('\n')
    out.push(translation ? { ...first, translation } : { ...first })
  }
  return out
}

/** 歌词里是否含译文（用于决定要不要显示翻译开关） */
export const hasTranslation = (lines) => lines.some((l) => l.translation)

export const peekLyrics = (id) => done.get(id)

export function loadLyrics(id) {
  if (done.has(id)) return Promise.resolve(done.get(id))
  if (!pending.has(id)) {
    pending.set(id, api.lyric(id).then((text) => {
      const lines = toLines(text)
      done.set(id, lines)
      if (done.size > MAX) done.delete(done.keys().next().value)
      return lines
    }).catch(() => []).finally(() => pending.delete(id)))
  }
  return pending.get(id)
}

/** 时间 t（秒）对应的歌词行下标；没有同步歌词时返回 -1 */
export function lineAt(lines, t) {
  if (!lines.length || lines[0].time < 0) return -1
  let lo = 0, hi = lines.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}
