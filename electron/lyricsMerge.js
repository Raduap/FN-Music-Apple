// 逐字歌词的纯逻辑：LRC 解析 -> 双语合并 -> 词级时间轴对齐 -> 候选择优 -> 卡拉OK进度。
// CJS、零依赖，供渲染层与 dev 评测工具共用同一份实现（单一事实来源）。
// 注意：这里只放纯函数，不引用 react / window / electron。
'use strict'

// ---------- LRC 解析 ----------
function parseLrc(text) {
  if (!text) return []
  const lines = []
  let offset = 0
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*(-?\d+)\]/i.exec(raw.trim())
    if (off) { offset = +off[1] / 1000; continue }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const content = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? +m[3] / Math.pow(10, m[3].length) : 0
      lines.push({ time: +m[1] * 60 + +m[2] + frac - offset, text: content })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}


// ---------- 双语合并 ----------
function toLines(text) {
  const lines = parseLrc(text)
  if (!lines.length) {
    if (!text) return []
    return text.split(/\r?\n/).map((t) => t.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).map((t) => ({ time: -1, text: t }))
  }
  return mergeTranslations(lines)
}

// 双语歌词的常见写法：原文与译文使用相同（或极接近）的时间戳。
// 容差取 30ms：不同数据源对同一句的原文/译文时间戳常有几十毫秒的取整差异，
// 直接用「完全相等」会漏合并，译文就会以普通行身份常驻，翻译开关也失效。
// 但仍需至少 3 个不同时间点出现同时间歌词组，才认定是双语格式，
// 避免普通重复副歌被误判成双语。
const SAME_TIME = 0.03
const hasText = (line) => !!String(line?.text || '').trim()
// 歌词里是否含译文（用于决定要不要显示翻译开关）
const hasTranslation = (lines) => lines.some((l) => l.translation)

// 汉字 / 假名 / 拉丁 / 韩文判定：仅用于「偏移译文回填」的保守启发式，
// 不参与同时间戳合并（同时间戳一律按 LRC 约定取第一行为原文）。
const RE_HAN = /[\u3400-\u9fff]/
const RE_KANA = /[\u3040-\u30ff]/
const RE_LATIN = /[A-Za-z]/
const RE_HANGUL = /[\uac00-\ud7af]/
const isHanOnly = (t) => RE_HAN.test(t) && !RE_KANA.test(t) && !RE_LATIN.test(t) && !RE_HANGUL.test(t)
const isForeign = (t) => RE_KANA.test(t) || RE_LATIN.test(t) || RE_HANGUL.test(t)

// 译文比原文晚一小段时间是常见写法（不是同时间戳）。这类行若不回填，
// 会作为独立歌词行显示：翻译开关失效、译文常驻。判断条件：
//   - 时间差严格大于同时间戳容差（gap=0 的同时间戳交给上面的分组逻辑，
//     那里有「至少 3 组」的证据门槛，不能绕过去）
//   - 不超过 1.5s
//   - 后一行是纯中文、前一行是外语、且后一行没有自己的词级时间轴
// 另外要求整首至少出现 3 次这种配对，才认定它是双语格式；否则按普通
// 歌词处理——与同时间戳合并的「证据不足不合并」保持同一套原则。
const OFFSET_TRANSLATION_MAX_GAP = 1.5
const OFFSET_TRANSLATION_MIN_PAIRS = 3
function isOffsetTranslationPair(prev, l) {
  if (!prev || !l) return false
  if (hasText({ text: prev.translation }) || l.translation) return false
  if (l.words && l.words.length) return false
  if (!hasText(prev) || !hasText(l)) return false
  if (!isHanOnly(String(l.text).trim()) || !isForeign(String(prev.text).trim())) return false
  const gap = Number(l.time) - Number(prev.time)
  return gap > SAME_TIME && gap <= OFFSET_TRANSLATION_MAX_GAP
}
function mergeOffsetTranslations(lines) {
  // 先数一遍配对数量：证据不足时完全不合并，避免把普通连续行误并。
  let pairs = 0
  for (let i = 1; i < lines.length; i++) {
    if (isOffsetTranslationPair(lines[i - 1], lines[i])) pairs++
  }
  if (pairs < OFFSET_TRANSLATION_MIN_PAIRS) return lines.map((l) => ({ ...l }))
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (isOffsetTranslationPair(prev, l)) {
      out[out.length - 1] = { ...prev, translation: String(l.text).trim() }
      continue
    }
    out.push({ ...l })
  }
  return out
}

function sameTimeGroups(lines) {
  const groups = []
  for (const l of lines) {
    const prev = groups[groups.length - 1]
    // 与上一组的「首个时间戳」比较，且要求时间单调不减，
    // 防止把相隔很近的两句正常歌词并成一组。
    if (prev && l.time >= prev.time - SAME_TIME && Math.abs(prev.time - l.time) <= SAME_TIME) prev.lines.push(l)
    else groups.push({ time: l.time, lines: [l] })
  }
  return groups
}
function mergeTranslations(lines) {
  const groups = sameTimeGroups(lines)
  const translationGroups = groups.filter((g) => g.lines.filter((l) => hasText(l)).length >= 2)
  let out
  if (translationGroups.length < 3) {
    out = lines.map((l) => ({ ...l }))
  } else {
    out = []
    for (const g of groups) {
      const [first, ...rest] = g.lines
      // 第三条及以上同时间行不再覆盖已有译文：拼进译文里保留下来，
      // 绝不丢弃（曾出现过「第二条把第一条译文顶掉」的问题）。
      const translation = rest.map((l) => l.text).filter((t) => String(t || '').trim()).join('\n')
      out.push(translation ? { ...first, translation } : { ...first })
    }
  }
  return mergeOffsetTranslations(out)
}


// ---------- 字符时间轴对齐 ----------
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


// ---------- 候选择优 / 行合并 ----------
function pickSyllableCandidate(localLines, candidates = []) {
  let best = null
  const singableLines = localLines.filter((l) => String(l?.text || '').trim()).length
  for (const cand of candidates) {
    if (!cand?.lines?.length) continue
    const merged = mergeSyllableLines(localLines, cand.lines)
    const hit = merged.filter((l) => l.words?.length).length
    const coverage = singableLines ? hit / singableLines : 0
    // 行数比例：远端行数与本地可唱行数越接近，分行结构越一致，逐字对齐越可靠。
    // 覆盖率相近（±2%）时优先选行数比例更接近 1 的候选。
    const ratio = Math.min(cand.lines.length / Math.max(1, singableLines), singableLines / Math.max(1, cand.lines.length))
    if (!best || coverage > best.coverage + 0.02 || (Math.abs(coverage - best.coverage) <= 0.02 && ratio > best.ratio)) {
      best = { ...cand, merged, coverage, ratio }
    }
    // 早退：覆盖率达标且行数比例健康（>=0.9）才锁定；
    // 碎行候选（比例 <0.9，分行结构差异大）即使覆盖率高也继续比较后续候选。
    if (coverage >= 0.85 && ratio >= 0.9) break
  }
  return best
}
function mergeSyllableLines(lines, syllables, debug = null) {
  const stats = { matched: 0, skippedText: 0, skippedTime: 0, textMismatches: [], timeMismatches: [] }
  if (!lines.length || !syllables?.length) {
    if (debug) debug(stats)
    return lines
  }
  const out = lines.map((l) => ({ ...l }))
  const used = new Array(syllables.length).fill(false)
  const norm = normForMatch
  // 空行（间奏 / 纯音乐段）没有可显示的文本，不参与逐字配对——
  // 把候选浪费在空行上会错位后续配对，还会拉低覆盖率。
  const singable = (l) => !!String(l?.text || '').trim()
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
    if (!t || !singable(out[li])) continue
    while (j < syllables.length && syllables[j].time < out[li].time - 3) j++
    for (let k = j; k < syllables.length && syllables[k].time <= out[li].time + 3; k++) {
      if (used[k]) continue
      if (norm(syllables[k].text) === t) { apply(li, k); break }
    }
  }
  stats.matchedPass1 = stats.matched

  // 结构一致性门控：候选与本地若是「不同版本 / 只有片段」，绝对时间就不可信。
  // 典型症状是候选被截断（时间跨度远小于本地）或来自翻唱版本（整体漂移），
  // 此时 Pass 2 的「按时间就近硬配」会把毫不相干的句子配成逐字，产出整段错位。
  // 门控不通过时只保留 Pass 1 的文本锚点匹配：宁可少配，也不产出假逐字。
  const span = (arr) => {
    const ts = arr.map((l) => Number(l?.time)).filter(Number.isFinite)
    return ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : 0
  }
  const singableLocal = lines.filter(singable).length
  const localSpan = span(out.filter(singable))
  const remoteSpan = span(syllables.filter(singable))
  const spanRatio = localSpan > 0 && remoteSpan > 0 ? Math.min(localSpan / remoteSpan, remoteSpan / localSpan) : 0
  const anchorRatio = singableLocal ? stats.matchedPass1 / singableLocal : 0
  // 行数太少时无法判断结构（跨度可能为 0），维持旧行为，避免误伤短片与单测。
  const pass2 = singableLocal < 4 || spanRatio >= 0.8 || anchorRatio >= 0.25
  stats.structure = { spanRatio: +spanRatio.toFixed(3), anchorRatio: +anchorRatio.toFixed(3), pass2 }

  // Pass 2：剩余行做单调顺序配对（双指针，±5s），文本不一致也算命中——
  // 不同来源对同一句的分行/标点常有差异，时间对上的词级时间轴照样可用。
  // 顺序约束避免「全局最近」把副歌重复段配错位。
  if (pass2) {
  let p = 0
  for (let li = 0; li < out.length; li++) {
    if (out[li].words || !singable(out[li])) continue
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
  }
  }
  if (debug) debug(stats)
  return out
}


// ---------- 卡拉OK进度 ----------
function karaokeFills(line, t) {
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

module.exports = {
  parseLrc,
  toLines,
  mergeTranslations,
  hasTranslation,
  alignCharTimeline,
  normForMatch,
  mergeSyllableLines,
  pickSyllableCandidate,
  karaokeFills,
}
