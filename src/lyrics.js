// 歌词加载与缓存：歌词面板、全屏播放页和悬浮球共用
import { api } from './api'
import { parseLrc } from './lib'

const MAX = 200
const done = new Map() // id -> lines（已加载）
const pending = new Map() // id -> Promise<lines>
const translated = new Set() // id -> 已成功翻译，避免重复请求
const translationMeta = new Map() // id -> { source, matched, sourceCount, aiCount, warning }

const KANA = /[\u3040-\u30ff]/
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/
const KANJI = /[\u3400-\u9fff]/g
const CYRILLIC = /[\u0400-\u04ff]/g
const LATIN = /[A-Za-z]/g

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

const hasLyricText = (line) => !!String(line?.text || '').trim()

/** 歌词里是否含译文（用于决定要不要显示翻译开关） */
export const hasTranslation = (lines) => lines.some((l) => l.translation)

/** 是否存在“下一句”（用于让胶囊尺寸在一首歌内保持恒定，避免伴奏句跳变） */
export function hasNextLyric(lines) {
  let found = false
  for (const line of lines) {
    if (!hasLyricText(line)) continue
    if (found) return true
    found = true
  }
  return false
}

export const peekLyrics = (id) => done.get(id)
export const peekTranslationMeta = (id) => translationMeta.get(id)
export function clearLyricsTranslation(id) {
  if (!id) return
  done.delete(id)
  pending.delete(id)
  translated.delete(id)
  translationMeta.delete(id)
}

export function detectLyricLang(text) {
  const s = String(text || '')
  if (KANA.test(s)) return 'ja'
  if (HANGUL.test(s)) return 'ko'
  const letters = [...s].filter((c) => /\p{L}/u.test(c))
  if (!letters.length) return 'unknown'
  const n = letters.length
  if ((s.match(KANJI) || []).length / n > 0.5) return 'zh'
  if ((s.match(CYRILLIC) || []).length / n > 0.3) return 'ru'
  if ((s.match(LATIN) || []).length / n > 0.5) return 'latin'
  return 'other'
}

export function translationTargets(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const text = String(line?.text || '').trim()
    if (!text || line.translation) continue
    out.push({ index: i, text })
  }
  return out
}

function isForeignLyrics(targets) {
  const all = targets.map((x) => x.text).join(' ')
  const lang = detectLyricLang(all)
  return !!(all && lang !== 'zh' && lang !== 'unknown')
}

async function translateLines(id, lines, song) {
  if (!lines.length || translated.has(id)) return lines
  const targets = translationTargets(lines)
  if (!targets.length || !isForeignLyrics(targets)) return lines
  const bridge = globalThis.window?.fn
  if (!bridge?.lyricsTranslate) return lines
  translated.add(id)
  try {
    const context = lines.map((l) => String(l?.text || '').trim()).filter(Boolean).join('\n')
    const r = await bridge.lyricsTranslate({
      song: { title: song?.title || '', artist: song?.artist || '', album: song?.album || '', duration: song?.duration || 0 },
      lines: targets.map((x) => x.text),
      localLines: targets.map((x) => ({ ms: (Number(lines[x.index]?.time) || 0) * 1000, text: x.text })),
      context,
    })
    if (!r?.ok || !r.translations?.length) {
      translated.delete(id)
      return lines
    }
    const out = lines.map((l) => ({ ...l }))
    let filled = 0
    targets.forEach((t, i) => {
      const text = String(r.translations[i] || '').trim()
      if (text) { out[t.index].translation = text; filled++ }
    })
    if (!filled) {
      translated.delete(id)
      return lines
    }
    translationMeta.set(id, {
      source: r.source || 'none',
      matched: r.matched || '',
      sourceCount: Number(r.sourceCount) || 0,
      aiCount: Number(r.aiCount) || 0,
      warning: r.warning || '',
    })
    done.set(id, out)
    return out
  } catch {
    translated.delete(id)
    return lines
  }
}

export function loadLyrics(id, song = null, { translate = false } = {}) {
  if (done.has(id)) {
    const cached = done.get(id)
    if (translate) return translateLines(id, cached, song)
    return Promise.resolve(cached)
  }
  if (!pending.has(id)) {
    pending.set(id, api.lyric(id).then(async (text) => {
      let lines = toLines(text)
      if (translate) lines = await translateLines(id, lines, song)
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

/** 从 from 之后找下一句真正有文本的歌词，跳过纯伴奏 / 间隔空行 */
function nextLyricLine(lines, from) {
  for (let i = from + 1; i < lines.length; i++) {
    if (hasLyricText(lines[i])) return { line: lines[i], index: i }
  }
  return { line: null, index: -1 }
}

/**
 * 悬浮歌词没有当前句 / 下一句时的兜底文案。
 * 关键点：歌词未加载完不能当作“纯音乐”；只有确实加载完且没有歌词时才显示纯音乐。
 */
export function lyricPlaceholder({ lyric, nextLyric, lyricsReady, hasLyrics, title } = {}) {
  if (lyric || nextLyric) return ''
  if (lyricsReady === true && !hasLyrics && title) return '纯音乐，请欣赏'
  return title || '未在播放'
}

/**
 * 悬浮歌词用的“一帧”：当前句原文 + 译文 + 下一句原文。
 * “下一句”会跳过伴奏 / 间隔空行；前奏时把首句作为“待播放”预告返回。
 * 同时带下一句的再下一句，方便伴奏期间仍显示真正的后续歌词而不是空行。
 * 纯函数，便于单测；当前句下标沿用 lineAt 的语义。
 */
export function lyricFrame(lines, t) {
  const i = lineAt(lines, t)
  const cur = i >= 0 ? lines[i] : null
  const next = nextLyricLine(lines, i)
  const afterNext = next.index >= 0 ? nextLyricLine(lines, next.index) : { line: null }
  return {
    index: i,
    lyric: cur?.text || '',
    lyricTrans: cur?.translation || '',
    nextLyric: next.line?.text || '',
    nextLyricTrans: next.line?.translation || '',
    nextNextLyric: afterNext.line?.text || '',
    nextNextLyricTrans: afterNext.line?.translation || '',
  }
}
