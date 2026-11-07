// 逐字歌词的纯逻辑：LRC 解析 -> 双语合并 -> 词级时间轴对齐 -> 候选择优 -> 卡拉OK进度。
// ESM、零依赖，供渲染层（src/，Vite）与 dev 审计工具（Node/Electron）共用同一份实现。
// 注意：这里只放纯函数，不引用 react / window / electron，也不要用 CJS 的 module.exports，
// 否则 Vite dev 直接以浏览器原生 ESM 加载时会报「does not provide an export named ...」。

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

// 全曲「字符袋」重叠：把两侧歌词各自拆成字符多重集，取交集 / 较小总量。
// 用于快速判断「本地歌词与候选是不是同一首歌」——同曲异版（Live / DJ / 重制）
// 的字符构成高度相似（实测 >=0.65），而完全不同的歌（哪怕歌名相同、时长相近）
// 重叠通常在 0.4 以下。它比逐行文本比对更耐受分行差异与标点差异。
function textBagOverlap(a, b) {
  const bag = (s) => {
    const m = new Map()
    for (const c of normForMatch(s)) m.set(c, (m.get(c) || 0) + 1)
    return m
  }
  const A = bag(a), B = bag(b)
  if (!A.size || !B.size) return 0
  let totalA = 0, totalB = 0, inter = 0
  for (const v of A.values()) totalA += v
  for (const v of B.values()) totalB += v
  for (const [c, v] of A) inter += Math.min(v, B.get(c) || 0)
  return inter / Math.max(1, Math.min(totalA, totalB))
}
// 低于此重叠视为「不同歌」，不做任何按时间的硬配（宁可少配，不产假逐字）。
const MIN_TEXT_OVERLAP = 0.5

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
 * 把远端逐字时间映射成本地行文本的词级时间轴：
 * 返回的 spans 拼接后与本地行文本完全一致（含空格），远端只贡献时间，
 * 显示内容一个字符都不改。空格归入其后的词首（无后词时归入前词尾）。
 *
 * 优先「按词对齐」：本地文本的空白分词数量与远端词数一致时，一一对应。
 * 这样 `Uh, uh huh uh huh` 这种句子不会被按字符比例切成 ` uh h` 半截词——
 * 半截词是扫色跳变、反复铺色褪色的直接来源之一。
 * 分词数量对不上（不同来源分行 / 断词差异）时，退回按字符比例映射。
 */
function localWhitespaceTokens(text) {
  const tokens = []
  let pending = ''
  for (const m of String(text || '').matchAll(/\S+|\s+/g)) {
    const chunk = m[0]
    if (!chunk.trim()) { pending += chunk; continue }
    tokens.push(pending + chunk)
    pending = ''
  }
  if (pending && tokens.length) tokens[tokens.length - 1] += pending
  return tokens
}

function alignCharTimeline(localText, remoteWords) {
  const text = String(localText || '')
  const chars = [...text]
  const n = remoteWords.length
  const solid = chars.filter((c) => /\S/.test(c)).length
  if (!solid || !n) return null
  const tokens = localWhitespaceTokens(text)
  if (tokens.length === n) {
    return tokens.map((t, i) => {
      const w = remoteWords[i] || {}
      return { text: t, time: w.time, end: w.end ?? w.time }
    })
  }
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

// 词级时间轴清洗：源数据里常有 0 时间戳 / 倒退 / 重叠 / 零时长（实测 APT. 一行 14 处），
// 直接用会让进度在帧与帧之间前后抖动，视觉上就是「铺色 → 褪色 → 再铺色」。
// 这里只修正时间，不动文本：时间戳只许往前走、每词至少给一点时长，保证进度随时间单调。
const MIN_WORD_DUR = 0.03
// rAF 每帧都会调用 karaokeFills；同一行 words 数组引用稳定，缓存清洗结果避免每帧重复分配。
const sanitizedCache = new WeakMap()
function sanitizeWordTimeline(words, { start = null, end = null } = {}) {
  if (!Array.isArray(words) || !words.length) return []
  const cached = sanitizedCache.get(words)
  if (cached && cached.start === start && cached.end === end) return cached.words
  const lineStart = Number.isFinite(start) ? Number(start) : null
  const lineEnd = Number.isFinite(end) ? Number(end) : null
  const out = []
  let prevEnd = null
  for (let i = 0; i < words.length; i++) {
    const w = words[i] || {}
    let t = Number(w.time)
    let e = Number(w.end)
    if (!Number.isFinite(t)) t = prevEnd ?? lineStart ?? 0
    // 首词时间戳是 0 / 负数，但整行明明在几十秒处：按行起点修正
    if (i === 0 && t <= 0 && lineStart != null && lineStart > 1) t = lineStart
    // 时间倒退 / 与前词重叠：顺延到前词结束，只许往前走
    if (prevEnd != null && t < prevEnd) t = prevEnd
    if (!Number.isFinite(e) || e < t) e = t + MIN_WORD_DUR
    if (e - t < MIN_WORD_DUR) e = t + MIN_WORD_DUR
    out.push({ ...w, time: t, end: e })
    prevEnd = e
  }
  // 末词越过行尾时收口（保留最小时长，避免二次清洗来回抖动）
  const last = out[out.length - 1]
  if (lineEnd != null && last.end > lineEnd && lineEnd - last.time >= MIN_WORD_DUR) last.end = lineEnd
  sanitizedCache.set(words, { start, end, words: out })
  return out
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
    if (timeline) out[li].words = sanitizeWordTimeline(timeline, { start: out[li].time, end: s.end })
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
  // 文本证据门控：本地与候选若是「同一首歌的不同版本」，字符构成高度相似；
  // 若歌名相同但其实是完全不同的歌（翻唱改名 / 同名词曲），字符重叠会很低。
  // 这种情况连时间跨度都可能接近，仅凭结构门控挡不住，必须额外看文本证据。
  const localText = out.filter(singable).map((l) => l.text).join('')
  const remoteText = syllables.filter(singable).map((l) => l.text).join('')
  const textOverlap = textBagOverlap(localText, remoteText)
  // 行数太少时无法判断结构（跨度可能为 0），维持旧行为，避免误伤短片与单测。
  const pass2 = singableLocal < 4 || (textOverlap >= MIN_TEXT_OVERLAP && (spanRatio >= 0.8 || anchorRatio >= 0.25))
  stats.structure = { spanRatio: +spanRatio.toFixed(3), anchorRatio: +anchorRatio.toFixed(3), textOverlap: +textOverlap.toFixed(3), pass2 }

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


// ---------- 智能逐字补全（无词级数据时的预测） ----------
// 参考 FeiNiuMusic 的 _generateWords：不是把整句时长按字符数平均，
// 而是按 token 权重分配，让英文单词、中文单字、标点和停顿各拿到更自然的时间比例。
// 只在用户显式开启「智能逐字补全」时使用；有真实词级时间的行永远优先用真实数据。
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const isAsciiAlnum = (ch) => ch >= '0' && ch <= '9' || ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z'
const isCjkChar = (ch) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(ch)
function isPunctChar(ch) {
  if (',.!?:;\'"()[]{}-'.includes(ch)) return true
  return '、。，．！？：；…—'.includes(ch)
}
function punctPauseWeight(ch) {
  if ('。！？!?'.includes(ch)) return 0.9
  if ('、，．,.;:；：'.includes(ch)) return 0.55
  if ('…—'.includes(ch)) return 0.8
  return 0.35
}
function latinTokenWeight(len) {
  if (len <= 0) return 0.6
  return clampNum(0.55 + 0.14 * len, 0.6, 2.8)
}
function charTokenWeight(ch) {
  if (isCjkChar(ch)) return 1
  if (isAsciiAlnum(ch)) return 0.55
  return 0.9
}
function tokenizeWithoutTiming(text) {
  const chars = Array.from(String(text || ''))
  const raw = []
  for (let i = 0; i < chars.length;) {
    const ch = chars[i]
    if (/\s/.test(ch)) { raw.push({ text: ch, weight: 0 }); i++; continue }
    if (isAsciiAlnum(ch)) {
      let word = ''
      while (i < chars.length && (isAsciiAlnum(chars[i]) || chars[i] === '\u0027' || chars[i] === '\u2019')) { word += chars[i]; i++ }
      raw.push({ text: word, weight: latinTokenWeight(word.length) })
      continue
    }
    raw.push({ text: ch, weight: charTokenWeight(ch) })
    i++
  }
  // 空白并入前一个 token（不单独占时间）；标点并入前一个 token 并追加停顿权重。
  // 行首空白先暂存，并到第一个 token 上，保证拼接后逐字符等于原文。
  const tokens = []
  let lead = ''
  for (const t of raw) {
    if (!t.text) continue
    if (/\s/.test(t.text[0])) {
      if (!tokens.length) { lead += t.text; continue }
      tokens[tokens.length - 1].text += t.text
      continue
    }
    if (lead) { t.text = lead + t.text; lead = '' }
    if (isPunctChar(t.text)) {
      if (!tokens.length) { tokens.push({ text: t.text, weight: Math.max(0.2, t.weight) }); continue }
      const last = tokens[tokens.length - 1]
      last.text += t.text
      last.weight += punctPauseWeight(t.text)
      continue
    }
    tokens.push({ ...t })
  }
  return tokens
}
/**
 * 按 token 权重把 [start, end] 分配给一句歌词，返回与原文逐字符一致的 words。
 * 单 token 时长做了 min/max 钳制，并做最多 8 轮再平衡，让总时长精确回到区间长度。
 */
function predictWordTimings(text, start, end) {
  const tokens = tokenizeWithoutTiming(text)
  if (!tokens.length) return null
  const t0 = Number.isFinite(start) ? Number(start) : 0
  let t1 = Number.isFinite(end) && end > t0 ? Number(end) : t0 + Math.max(0.6, String(text || '').length * 0.14)
  const totalMs = Math.max(1, Math.round((t1 - t0) * 1000))
  const count = tokens.length
  const weightSum = tokens.reduce((n, t) => n + (Number.isFinite(t.weight) ? t.weight : 0), 0)
  if (!(weightSum > 0)) return null
  const minMs = clampNum(Math.floor(totalMs / (count * 3)), 20, 80)
  const maxMs = Math.min(1600, Math.max(minMs, clampNum(Math.round(totalMs * 0.45), 120, 1600)))
  const durations = tokens.map((t) => clampNum(Math.round(totalMs * (t.weight / weightSum)), minMs, maxMs))
  let diff = totalMs - durations.reduce((n, d) => n + d, 0)
  for (let iter = 0; iter < 8 && diff !== 0; iter++) {
    if (diff > 0) {
      const cand = durations.map((d, i) => (d < maxMs ? i : -1)).filter((i) => i >= 0)
      const candWeight = cand.reduce((n, i) => n + tokens[i].weight, 0)
      if (!cand.length || candWeight <= 0) break
      for (const i of cand) {
        if (diff <= 0) break
        const add = Math.max(1, Math.floor(diff * (tokens[i].weight / candWeight)))
        const applied = Math.min(add, maxMs - durations[i])
        durations[i] += applied
        diff -= applied
      }
    } else {
      const cand = durations.map((d, i) => (d > minMs ? i : -1)).filter((i) => i >= 0)
      const candWeight = cand.reduce((n, i) => n + tokens[i].weight, 0)
      if (!cand.length || candWeight <= 0) break
      for (const i of cand) {
        if (diff >= 0) break
        const sub = Math.max(1, Math.floor(-diff * (tokens[i].weight / candWeight)))
        const applied = Math.min(sub, durations[i] - minMs)
        durations[i] -= applied
        diff += applied
      }
    }
  }
  if (diff !== 0) {
    for (let i = 0; i < count && diff !== 0; i++) {
      if (diff > 0 && durations[i] < maxMs) { durations[i]++; diff-- }
      else if (diff < 0 && durations[i] > minMs) { durations[i]--; diff++ }
    }
  }
  const words = []
  let accMs = 0
  for (let i = 0; i < count; i++) {
    const ws = t0 + accMs / 1000
    accMs += durations[i]
    // 末词不强行拉到句尾：长间奏 / 歌曲末句会把最后一个 token 拉成慢爬。
    // 提前扫完让高亮停在全亮即可，这也是正常卡拉OK的行为。
    const we = Math.min(t1, t0 + accMs / 1000)
    if (we > ws) words.push({ text: tokens[i].text, time: ws, end: we })
  }
  return words.length ? words : null
}
/**
 * 有真实词级时间的行原样保留，其余可唱行按 [本行起点, 下一句起点] 预测逐字时间轴。
 * 行尾按 FeiNiuMusic 的做法提前 clamp(行时长*8%, 60, 220)ms 收口，
 * 避免高亮扫到下一句已起唱之后。
 */
function predictKaraokeLines(lines, { duration = 0 } = {}) {
  if (!Array.isArray(lines) || !lines.length) return lines
  const singable = (l) => !!l && Number.isFinite(l.time) && l.time >= 0 && !!String(l.text || '').trim()
  const nextStart = new Array(lines.length).fill(null)
  let nxt = null
  for (let i = lines.length - 1; i >= 0; i--) {
    nextStart[i] = nxt
    if (singable(lines[i])) nxt = lines[i].time
  }
  return lines.map((line, i) => {
    if (!singable(line) || line.words?.length) return line
    const start = Number(line.time)
    const following = nextStart[i]
    let end = Number.isFinite(line.end) && line.end > start ? Number(line.end) : 0
    if (!(end > start)) end = following ?? (Number(duration) > start ? Number(duration) : start + 3)
    if (!(end > start)) end = start + 3
    if (following != null) {
      const buffer = clampNum(Math.round((end - start) * 1000 * 0.08), 60, 220) / 1000
      end = Math.max(start + 0.001, end - buffer)
    }
    const words = predictWordTimings(line.text, start, end)
    return words ? { ...line, words, end } : line
  })
}

// ---------- 卡拉OK进度 ----------
function karaokeFills(line, t) {
  // 防御性清洗：兼容历史 / 外部传入的脏时间轴，保证进度只随时间单调前进
  const words = sanitizeWordTimeline(line?.words || [], { start: line?.time, end: line?.end })
  const text = String(line?.text || '')
  const n = words.length
  if (!n) return null
  // 顺序定位每个词在整句文本中的字符区间（包含词间空格）。
  // 必须保证区间不重叠：早期版本用 indexOf 后 cursor 只 +1，一旦词文本与整句
  // 不能逐字对上（源数据半截词 / 预测分词差异），区间会重叠，pos 就会前后跳。
  const spans = []
  let cursor = 0
  let total = 0
  for (const w of words) {
    const wt = String(w.text ?? '')
    const len = Math.max(1, wt.length)
    const idx = wt ? text.indexOf(wt, cursor) : -1
    const start = idx >= 0 ? idx : cursor
    spans.push({ start, len })
    total = start + len
    cursor = total
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

export {
  parseLrc,
  toLines,
  mergeTranslations,
  hasTranslation,
  alignCharTimeline,
  sanitizeWordTimeline,
  normForMatch,
  mergeSyllableLines,
  pickSyllableCandidate,
  karaokeFills,
  predictWordTimings,
  predictKaraokeLines,
  textBagOverlap,
}





