// 歌词加载与缓存：歌词面板、全屏播放页和悬浮球共用
import { api } from './api'
import { parseLrc } from './lib'

const MAX = 200
const raw = new Map() // id -> 原始歌词（始终保留，关闭翻译时返回这一份）
const done = new Map() // id -> lines（当前显示用，可能带译文）
const pending = new Map() // id -> Promise<lines>
const translating = new Map() // id -> 正在进行的翻译 Promise，避免侧栏/全屏重复请求
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

// 把逐字（词 / 字 / 音节）时间轴合并进 LRC 行：按行起点就近匹配，文本不一致时退回 LRC 原文。
// 歌词行本身不做改动，只在命中行上挂 words，供歌词视图做逐字高亮。
// 逐字比对用的文本归一化：去空白 + 繁简残留字符统一（妳→你 等）。
// 数据源偶尔会漏掉个别异体字（妳 / 麽 / 著），逐字层面做等价映射，
// 避免整行因一两个字对不上而被丢弃。
const CHAR_EQUIV = { '妳': '你', '麽': '么', '裏': '里', '著': '着', '為': '为', '於': '于', '後': '后', '發': '发', '颱': '台' }
const normForMatch = (v) => String(v || '').replace(/\s+/g, '').replace(/[妳麽裏著為於後發颱]/g, (c) => CHAR_EQUIV[c] || c)

/**
 * 把远端逐字时间映射到本地行文本：显示内容永远来自本地 LRC 的字，
 * 远端只贡献时间轴。字数一致时按位替换；不一致时按比例取位，
 * 每个远端时间槽都能对应到本地文本的某个字符（不足时重复填充）。
 */
/**
 * 把远端逐字时间映射成本地行文本的「逐字符时间轴」：
 * 返回的 spans 拼接后与本地行文本完全一致（含空格与标点），
 * 远端只贡献时间，显示内容一个字符都不改。
 * 映射方式：按本地文本（去空白）的字符序号比例对应远端词序号。
 */
/**
 * 把远端逐字时间映射成本地行文本的「逐字符时间轴」：
 * 返回的 spans 拼接后与本地行文本完全一致（含空格），远端只贡献时间，
 * 显示内容一个字符都不改。空格归入其后的词首（无后词时归入前词尾）。
 */
function alignCharTimeline(localText, remoteWords) {
  const chars = [...String(localText || '')]
  const n = remoteWords.length
  const solid = chars.filter((c) => /\S/.test(c)).length
  if (!solid || !n) return null
  let solidIdx = 0
  const wordIndexOf = chars.map((c) => (/\S/.test(c) ? Math.min(n - 1, Math.floor((solidIdx++ * n) / solid)) : -1))
  // 每个远端词收集自己的字符（把紧随其后的空格带上）
  const buckets = Array.from({ length: n }, () => [])
  chars.forEach((c, i) => {
    let wi = wordIndexOf[i]
    if (wi < 0) {
      // 空格：交给下一个非空格字符所属的词；行尾空格归最后一个词
      let k = i + 1
      while (k < chars.length && wordIndexOf[k] < 0) k++
      wi = k < chars.length ? wordIndexOf[k] : n - 1
    }
    buckets[wi].push(c)
  })
  return buckets
    .map((chars2, wi) => ({ text: chars2.join(''), w: remoteWords[wi] }))
    .filter((s) => s.text)
    .map(({ text, w }) => ({ text, time: w.time, end: w.end ?? w.time }))
}

/**
 * 从多个来源候选中挑选与本地 LRC 最匹配的逐字数据：
 * 逐个试合并，覆盖率（命中行 / 本地行）≥ 0.85 即采纳（先到先得，AMLL 优先级最高）；
 * 都达不到 85% 时选覆盖率最高的那个。candidates 顺序即来源优先级。
 */
export function pickSyllableCandidate(localLines, candidates = []) {
  let best = null
  for (const cand of candidates) {
    if (!cand?.lines?.length) continue
    const merged = mergeSyllableLines(localLines, cand.lines)
    const hit = merged.filter((l) => l.words?.length).length
    const coverage = localLines.length ? hit / localLines.length : 0
    if (!best || coverage > best.coverage) best = { ...cand, merged, coverage }
    if (coverage >= 0.85) break
  }
  return best
}
export function mergeSyllableLines(lines, syllables, debug = null) {
  const stats = { matched: 0, skippedText: 0, skippedTime: 0, textMismatches: [], timeMismatches: [] }
  if (!lines.length || !syllables?.length) {
    if (debug) debug(stats)
    return lines
  }
  const out = lines.map((l) => ({ ...l }))
  const used = new Array(syllables.length).fill(false)
  const norm = normForMatch
  const apply = (li, si) => {
    const s = syllables[si]
    if (!s.words?.length) return false
    const timeline = alignCharTimeline(out[li].text, s.words)
    if (timeline) out[li].words = timeline
    if (Number.isFinite(s.end) && !Number.isFinite(out[li].end)) out[li].end = s.end
    used[si] = true
    stats.matched++
    return true
  }
  // Pass 1：按顺序做「文本相同」锚点匹配（时间窗放宽到 3s，允许版本间整体漂移）
  let j = 0
  for (let li = 0; li < out.length; li++) {
    const t = norm(out[li].text)
    if (!t) continue
    while (j < syllables.length && syllables[j].time < out[li].time - 3) j++
    for (let k = j; k < syllables.length && syllables[k].time <= out[li].time + 3; k++) {
      if (used[k]) continue
      if (norm(syllables[k].text) === t) { apply(li, k); break }
    }
  }
  // Pass 2：剩余行做单调顺序配对（双指针，±5s），文本不一致也算命中——
  // 不同来源对同一句的分行/标点常有差异，时间对上的词级时间轴照样可用。
  // 顺序约束避免「全局最近」把副歌重复段配错位。
  let p = 0
  for (let li = 0; li < out.length; li++) {
    if (out[li].words) continue
    while (p < syllables.length && (used[p] || syllables[p].time < out[li].time - 5)) p++
    let best = -1
    let bestD = Infinity
    for (let k = p; k < syllables.length && syllables[k].time <= out[li].time + 5; k++) {
      if (used[k]) continue
      const d = Math.abs(syllables[k].time - out[li].time)
      if (d < bestD) { bestD = d; best = k }
    }
    if (best >= 0 && bestD <= 5) {
      apply(li, best)
      if (p <= best) p = best + 1
      if (norm(syllables[best].text) !== norm(out[li].text)) stats.skippedText++
    } else {
      stats.skippedTime++
      if (stats.timeMismatches.length < 3) stats.timeMismatches.push({ local: { time: out[li].time, text: out[li].text }, remote: syllables[best] ? { time: syllables[best].time, text: syllables[best].text } : null })
    }
  }  if (debug) debug(stats)
  return out
}
export const peekTranslationMeta = (id) => translationMeta.get(id)
export function clearLyricsTranslation(id) {
  if (!id) return
  raw.delete(id)
  done.delete(id)
  pending.delete(id)
  translating.delete(id)
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
  if (!lines.length) return lines
  const cached = done.get(id)
  if (cached && hasTranslation(cached)) return cached
  const targets = translationTargets(lines)
  if (!targets.length || !isForeignLyrics(targets)) return lines
  if (translating.has(id)) return translating.get(id)
  const bridge = globalThis.window?.fn
  if (!bridge?.lyricsTranslate) return lines
  const run = (async () => {
    try {
      const context = lines.map((l) => String(l?.text || '').trim()).filter(Boolean).join('\n')
      const r = await bridge.lyricsTranslate({
        song: { title: song?.title || '', artist: song?.artist || '', album: song?.album || '', duration: song?.duration || 0 },
        lines: targets.map((x) => x.text),
        localLines: targets.map((x) => ({ ms: (Number(lines[x.index]?.time) || 0) * 1000, text: x.text })),
        context,
      })
      if (!r?.ok || !r.translations?.length) return lines
      const out = lines.map((l) => ({ ...l }))
      let filled = 0
      targets.forEach((t, i) => {
        const text = String(r.translations[i] || '').trim()
        if (text) { out[t.index].translation = text; filled++ }
      })
      if (!filled) return lines
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
      return lines
    }
  })()
  translating.set(id, run)
  try {
    return await run
  } finally {
    translating.delete(id)
  }
}

export function loadLyrics(id, song = null, { translate = false } = {}) {
  const cached = done.get(id)
  if (done.has(id) || raw.has(id)) {
    const original = raw.get(id) || cached
    if (translate) {
      if (cached && hasTranslation(cached)) return Promise.resolve(cached)
      return translateLines(id, original, song)
    }
    return Promise.resolve(original)
  }
  // 首个请求可能是不带翻译的（悬浮歌词切歌要先立即显示原词）；
  // 此时晚到的翻译请求不能直接复用原词 Promise 就完事，要在它完成后补翻译。
  // translateLines 内部用 translating Map 去重，多个并发翻译请求只会真正翻译一次。
  if (pending.has(id)) {
    const base = pending.get(id)
    if (!translate) return base
    return base.then((lines) => translateLines(id, lines, song))
  }
  pending.set(id, api.lyric(id).then(async (text) => {
    const lines = toLines(text)
    raw.set(id, lines)
    let out = lines
    if (translate) out = await translateLines(id, lines, song)
    done.set(id, out)
    if (done.size > MAX) {
      const oldest = done.keys().next().value
      done.delete(oldest)
      raw.delete(oldest)
    }
    return out
  }).catch(() => []).finally(() => pending.delete(id)))
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
    // 逐字时间轴（合并过 syllables 的行才有 words）：悬浮歌词按 lyricIndex 对齐，
    // 只带当前句与下一句，避免整首歌的词级数据随每次广播序列化。
    lyricWords: cur?.words?.length ? cur.words : null,
    nextLyricWords: next.line?.words?.length ? next.line.words : null,
  }
}

/**
 * 逐字卡拉OK：把整句看成一条连续的“唱到第几个字”进度边。
 * 在词内按词时长线性推进；词与词的间隙也线性推进到下一个词的起点，
 * 因此进度边单调连续——快唱 / 词速不均 / 停顿都只是扫速变化，不会跳变。
 * 返回每个词的 fill（0..1）与字符区间，渲染层直接铺色。
 */
export function karaokeFills(line, t) {
  const words = line?.words || []
  const text = String(line?.text || '')
  const n = words.length
  if (!n) return null
  // 顺序定位每个词在整句文本中的字符区间（包含词间空格）
  const spans = []
  let cursor = 0
  let total = 0
  for (const w of words) {
    const idx = text.indexOf(w.text, cursor)
    const start = idx >= 0 ? idx : total
    spans.push({ start, len: Math.max(1, String(w.text).length) })
    total = start + spans[spans.length - 1].len
    cursor = start + 1
  }
  const t0 = words[0].time
  const lastEnd = words[n - 1].end ?? (words[n - 1].time + 0.5)
  const edge = (i, t) => spans[i].start + Math.min(1, Math.max(0, (t - words[i].time) / Math.max(0.08, (words[i].end ?? words[i + 1]?.time ?? t0 + 0.5) - words[i].time))) * spans[i].len
  let pos = 0
  if (t <= t0) pos = 0
  else if (t >= lastEnd) pos = total
  else {
    // 找到当前所在区间：词内或词间间隙
    let i = 0
    while (i < n && t >= (words[i].end ?? words[i + 1]?.time ?? lastEnd)) i++
    const w = words[i]
    const endT = w.end ?? words[i + 1]?.time ?? lastEnd
    if (t < endT) {
      pos = edge(i, t)
    } else if (i + 1 < n) {
      // 词间间隙：从本词末尾线性推进到下一个词起点
      const nextStartT = words[i + 1].time
      const gapT = Math.max(0.001, nextStartT - endT)
      const p = Math.min(1, Math.max(0, (t - endT) / gapT))
      pos = spans[i].start + spans[i].len + p * Math.max(0, spans[i + 1].start - (spans[i].start + spans[i].len))
    }
  }
  const fills = spans.map((s) => Math.min(1, Math.max(0, (pos - s.start) / s.len)))
  return { fills, starts: spans.map((s) => s.start), spans: spans.map((s) => s.len), total, pos }
}




