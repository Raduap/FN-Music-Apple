// 歌词加载与缓存：歌词面板、全屏播放页和悬浮球共用
import { api } from './api'
import { parseLrc } from './lib'

const MAX = 200
const done = new Map() // id -> lines（已加载）
const pending = new Map() // id -> Promise<lines>

// LRC 解析；没有时间戳的纯文本歌词也保留（time = -1，不滚动）
export function toLines(text) {
  const lines = parseLrc(text)
  if (lines.length || !text) return lines
  return text.split(/\r?\n/).map((t) => t.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).map((t) => ({ time: -1, text: t }))
}

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
