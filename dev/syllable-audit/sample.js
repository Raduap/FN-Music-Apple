// 逐字歌词审计：分层随机抽样。
// 输入曲库清单（每项含 title/artist/path/lrcText），按语言分层后按固定种子随机抽取，
// 保证同一 seed + 同一曲库 => 同一批样本（可复现）。纯函数，便于单测。
'use strict'

const KANA = /[\u3040-\u30ff]/
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/
const KANJI = /[\u3400-\u9fff]/g
const CYRILLIC = /[\u0400-\u04ff]/g
const LATIN = /[A-Za-z]/g

// 语言判定：只用于分层，与 src/lyrics.js 的 detectLyricLang 保持同一套规则。
function detectLang(text) {
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

// 取“有实际歌词文本”的行来判语言（跳过 [ti:]/[ar:] 等元数据行）。
function lyricsTextOf(lrcText) {
  const out = []
  for (const raw of String(lrcText || '').split(/\r?\n/)) {
    const s = raw.trim()
    if (!s) continue
    if (/^\[[a-z]+:/i.test(s)) continue
    const body = s.replace(/\[[^\]]*\]/g, '').trim()
    if (body) out.push(body)
  }
  return out.join(' ')
}

// 确定性 PRNG（mulberry32）：同一 seed 产出同一序列。
function makeRng(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(arr, rng) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 分层随机抽样。
 * @param tracks 曲库清单 [{ title, artist, lrcText, ... }]
 * @param opts { seed, total, stratumMin, quotas }
 *   - 小分层（<= stratumMin，默认 10）全量取，避免样本不足（如韩语 3 首）
 *   - 其余按 quotas 的目标比例在层内随机抽，再按需从大层补齐到 total
 * @returns { strata, picked } —— picked 顺序打乱，避免按层聚集
 */
function stratifiedSample(tracks, { seed = 1, total = 60, stratumMin = 10, quotas = { zh: 0.58, ja: 0.25 } } = {}) {
  const rng = makeRng(seed)
  const byLang = new Map()
  for (const t of tracks) {
    const lang = detectLang(lyricsTextOf(t.lrcText))
    if (!byLang.has(lang)) byLang.set(lang, [])
    byLang.get(lang).push(t)
  }
  const strata = {}
  for (const [lang, arr] of byLang) strata[lang] = arr.length

  const picked = []
  const leftOvers = []
  // 第一轮：小层全取；大层按配额抽
  for (const [lang, arr] of byLang) {
    const shuffledArr = shuffled(arr, rng)
    if (arr.length <= stratumMin) {
      picked.push(...shuffledArr)
    } else {
      const want = Math.min(arr.length, Math.max(1, Math.round(total * (quotas[lang] || 0))))
      picked.push(...shuffledArr.slice(0, want))
      leftOvers.push(...shuffledArr.slice(want))
    }
  }
  // 第二轮：不足 total 时从剩余池补齐
  if (picked.length < total && leftOvers.length) {
    picked.push(...shuffled(leftOvers, rng).slice(0, total - picked.length))
  }
  return { strata, picked: shuffled(picked.slice(0, total), rng) }
}

module.exports = { detectLang, lyricsTextOf, makeRng, shuffled, stratifiedSample }
