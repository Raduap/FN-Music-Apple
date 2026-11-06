// 悬浮歌词逐字（卡拉OK）渲染的纯函数层。
// 渲染层结构只来自这里生成的 words；进度计算复用 src/lyrics.js 的 karaokeFills，
// 保证侧栏 / 全屏页 / 悬浮窗三处扫色语义完全一致。
import { karaokeFills } from './lyrics'

const WORD_RE = /\S+|\s+/g

/**
 * 把普通文本按空白切成卡拉OK span。
 * 空白并入前一个词（行首空白并入后一个词），保证 spans 拼接后与原文逐字符一致。
 * words 里只有 spans[i].text（text/time/end 在 fillWords 时按整句时间均分补齐）。
 */
export function splitKaraokeSpans(text) {
  const source = String(text || '')
  const spans = []
  let pending = ''
  for (const m of source.matchAll(WORD_RE)) {
    const chunk = m[0]
    if (!chunk.trim()) {
      if (spans.length) spans[spans.length - 1].text += chunk
      else pending += chunk
      continue
    }
    spans.push({ text: pending + chunk })
    pending = ''
  }
  if (pending) {
    if (spans.length) spans[spans.length - 1].text += pending
    else spans.push({ text: pending })
  }
  return spans
}

/**
 * 给整句 words 补时间：有真实词级时间就用真实时间（首词起点 / 末词终点），
 * 否则按字符长度在整句 [time, end || time+0.5] 区间内线性分配。
 * 逐词切分不改变文本内容——words[].text 拼接后仍等于 line.text。
 */
export function fillWordTimes(line) {
  const text = String(line?.text || '')
  const spans = splitKaraokeSpans(text)
  if (!spans.length) return null
  const t0 = Number.isFinite(line?.time) && line.time >= 0 ? line.time : 0
  const t1 = Number.isFinite(line?.end) && line.end > t0 ? line.end : t0 + Math.max(0.6, text.length * 0.14)
  const solid = spans.reduce((n, s) => n + s.text.trim().length, 0)
  let at = t0
  const words = spans.map((s) => {
    const solidLen = s.text.trim().length
    const dur = solidLen
      ? (t1 - t0) * (solidLen / solid)
      : 0
    const time = at
    at += dur
    return { text: s.text, time, end: at }
  })

  // 兜底：浮点累加误差导致最后一个 end 略小于 t1 时贴齐
  if (words.length) {
    const last = words[words.length - 1]
    if (last.end < t1) last.end = t1
  }
  return words
}


/** 渲染层需要的最小结构：words + 整句文本；没有可显示文本时返回 null */
export function karaokeWords(line) {
  if (!line || !String(line.text || '').trim()) return null
  const words = line.words?.length ? line.words : fillWordTimes(line)
  if (!words?.length) return null
  return { text: String(line.text || ''), words }
}

/** 悬浮窗 rAF 用：按「上次同步时间 + 本地流逝」推算当前播放时间（暂停时冻结） */
export function karaokeClock({ currentTime = 0, at = 0, playing = false } = {}, now = Date.now()) {
  const drift = playing && at ? (now - at) / 1000 : 0
  return (Number(currentTime) || 0) + Math.max(0, drift)
}

/** 把 karaokeFills 的连续进度边折算成每个词的铺色宽度（0..1） */
export function karaokeProgress(line, t) {
  return karaokeFills(line, t)?.fills || null
}

