// 逐字歌词审计：单曲 × 单源 的评测指标。
// 复用生产实现 electron/lyricsMerge.js（LRC 解析 / 合并 / 择优），保证指标与界面所见一致。
'use strict'

const L = require('../../electron/lyricsMerge.js')

const singable = (l) => !!String(l?.text || '').trim()

/**
 * 对一首歌 + 一个源的候选做合并与打分。
 * @param localLines 本地 LRC 解析后的行（toLines 输出，含双语合并）
 * @param candidates 该源的候选 [{ source, provider, lines, track, artist }]
 * @returns 指标对象；无候选时 coverage=0
 */
function scoreSource(localLines, candidates = []) {
  const total = localLines.filter(singable).length
  // 文本归一化，用于判断“命中行是否真的对应同一句”（而不是时间凑巧）
  const norm = (v) => L.normForMatch(String(v || '')).toLowerCase()
  const localTexts = localLines.filter(singable).map((l) => norm(l.text))

  const perCand = []
  for (const cand of candidates) {
    const merged = L.mergeSyllableLines(localLines, cand.lines)
    const hitLines = merged.filter((l) => l.words?.length)
    const coverage = total ? hitLines.length / total : 0

    // 时间合理性：命中行的词时间应落在该行附近；统计异常数
    let outOfRange = 0
    let nonMonotonic = 0
    let zeroSpan = 0
    for (const l of merged) {
      const ws = l.words
      if (!ws?.length) continue
      const first = ws[0].time
      const last = ws[ws.length - 1].end ?? ws[ws.length - 1].time
      // 合并窗口是 ±5s（Pass 2），超出才视为对齐可疑
      if (!Number.isFinite(first) || first < l.time - 5 || first > l.time + 5) outOfRange++
      if (last < first) nonMonotonic++
      if (last - first <= 0 && ws.length > 1) zeroSpan++
    }

    // 真命中率：命中行里，远端原始句子与本地句子相近的比例（防“时间凑巧配错行”）。
    // 注意：不能拿 l.words 拼接后再和 l.text 比——alignCharTimeline 的输出本来就
    // 恒等于本地文本，那样比出来永远是 100%，等于没测。这里回到候选原始行，
    // 用命中行首个词的绝对时间去候选里找回对应行，再比文本。
    let textAgree = 0
    for (const l of merged) {
      if (!l.words?.length) continue
      const firstWordTime = Number(l.words[0]?.time)
      let remote = null
      let bestD = Infinity
      for (const c of cand.lines) {
        const t = Number(c.words?.[0]?.time ?? c.time)
        if (!Number.isFinite(t)) continue
        const d = Math.abs(t - firstWordTime)
        if (d < bestD) { bestD = d; remote = c }
      }
      if (!remote) continue
      const joined = norm(remote.text)
      const local = norm(l.text)
      if (joined === local || joined.includes(local) || local.includes(joined)) textAgree++
    }

    perCand.push({
      source: cand.source,
      provider: cand.provider,
      candLines: cand.lines.length,
      candWords: cand.lines.reduce((n, l) => n + (l.words?.length || 0), 0),
      hitLines: hitLines.length,
      coverage,
      ratio: Math.min(cand.lines.length / Math.max(1, total), total / Math.max(1, cand.lines.length)),
      textAgreeRate: hitLines.length ? textAgree / hitLines.length : 0,
      outOfRange,
      nonMonotonic,
      zeroSpan,
      track: cand.track || '',
      artist: cand.artist || '',
      merged,
    })
  }

  // 择优：逐条复刻生产 pickSyllableCandidate 的判定与早退条件
  // （注意早退看的是“当前候选”，不是“当前最佳”），保证指标与界面一致。
  let pickedIdx = -1
  for (let i = 0; i < perCand.length; i++) {
    const c = perCand[i]
    const b = pickedIdx >= 0 ? perCand[pickedIdx] : null
    if (!b || c.coverage > b.coverage + 0.02 || (Math.abs(c.coverage - b.coverage) <= 0.02 && c.ratio > b.ratio)) {
      pickedIdx = i
    }
    if (c.coverage >= 0.85 && c.ratio >= 0.9) break
  }

  return { totalSingable: total, localTexts, perCand, pickedIdx, picked: pickedIdx >= 0 ? perCand[pickedIdx] : null }
}

module.exports = { scoreSource, singable }
