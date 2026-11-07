// 歌词加载与缓存：歌词面板、全屏播放页和悬浮球共用
import { api } from './api'
// 纯逻辑（LRC 解析 / 双语合并 / 字符对齐 / 候选择优 / 卡拉OK进度）统一放在
// electron/lyricsMerge.mjs，供渲染层与 dev 评测工具复用同一份实现。
import { toLines, hasTranslation, pickSyllableCandidate } from '../electron/lyricsMerge.mjs'
// 保持既有导出面：其它模块历史上从 ./lyrics 引入这些纯函数。
export { toLines, hasTranslation, mergeTranslations, mergeSyllableLines, pickSyllableCandidate, karaokeFills, smoothWordTimeline, textBagOverlap, sanitizeWordTimeline, predictWordTimings, predictKaraokeLines, normForMatch, SYLLABLE_QUALIFIED, SYLLABLE_EXCELLENT, syllableTierFor } from '../electron/lyricsMerge.mjs'

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

const hasLyricText = (line) => !!String(line?.text || '').trim()

/** 歌词里是否含译文（用于决定要不要显示翻译开关） */

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
export const peekTranslationMeta = (id) => translationMeta.get(id)

/**
 * 逐字歌词「流式 + 提前返回」：主进程按用户排序逐源抓取，达到合格线（90%）
 * 就先把当前最好的结果推回来让界面显示，达到优秀线（98%）停止后续来源；
 * 期间出现更好的结果会继续推送（静默替换）。这里只负责订阅与择优，
 * 阈值判定在主进程，覆盖率计算复用同一份 pickSyllableCandidate。
 *
 * @param {object} song
 * @param {Array} lines 本地 LRC 行（覆盖率的分母 / 合并基准）
 * @param {(merged: Array, meta: object) => void} onUpdate 每次拿到更好结果时回调
 * @returns {Promise<Array>} 最终合并结果（无候选时原样返回 lines）
 */
export async function loadSyllablesProgressive(song, lines, onUpdate) {
  const bridge = globalThis.window?.fn
  if (!bridge?.lyricsSyllables) return lines
  // requestId 必须按歌曲确定：播放页与悬浮窗可能并发请求同一首歌，
  // 主进程会合并成同一条抓取流并把进度广播给所有订阅者；
  // 若各用各的随机 id，后订阅的一方会把自己的进度事件过滤掉。
  const requestId = [
    'syl',
    song?.title || '',
    song?.artist || '',
    Math.round((Number(song?.duration) || 0) / 5) * 5,
  ].join('|')
  let best = lines
  let bestCoverage = -1
  const apply = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return
    const pick = pickSyllableCandidate(lines, candidates, { earlyBreak: false })
    if (!pick || pick.coverage <= bestCoverage + 1e-9) return
    best = pick.merged
    bestCoverage = pick.coverage
    try { onUpdate?.(best, { coverage: pick.coverage, source: pick.source, provider: pick.provider }) } catch {}
  }
  const off = bridge.onLyricsSyllablesProgress?.((d) => { if (d?.requestId === requestId) apply(d.candidates) })
  try {
    const r = await bridge.lyricsSyllables({
      title: song?.title, artist: song?.artist, duration: song?.duration || 0,
      localLines: lines.map((l) => ({ time: l.time, text: l.text })),
      requestId,
    })
    if (r?.ok) apply(r.candidates)
    return best
  } finally {
    off?.()
  }
}

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

/** 当前句的窗口右界：下一句真正有文本的行起点；没有下一句时用本行 end。 */
export function karaokeWindowEnd(lines, i) {
  if (!Array.isArray(lines) || i < 0) return null
  for (let k = i + 1; k < lines.length; k++) {
    if (String(lines[k]?.text || '').trim() && Number.isFinite(lines[k].time)) return lines[k].time
  }
  return Number.isFinite(lines[i]?.end) ? lines[i].end : null
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
    // 当前句的窗口右界（下一句起点）：扫色平滑据此限制「过慢化」不越过下一句。
    lyricEnd: Number.isFinite(next.line?.time) ? next.line.time : (Number.isFinite(cur?.end) ? cur.end : null),
  }
}
