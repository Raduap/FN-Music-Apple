// 逐字歌词抓取（实验性）：纯逻辑模块，便于单测与主进程复用。
// 数据源：AMLL TTML DB（社区人工逐字库）→ LiriQo 聚合接口。
const { net } = require('electron')
const opencc = require('opencc-js')

const INDEX_URL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/metadata/raw-lyrics-index.jsonl'
const RAW_URL = (file) => 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/raw-lyrics/' + encodeURIComponent(file)
const LIRIQO = 'https://api.liriqo-alfarrizi.my.id/v1'

const SYLLABLE_UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'application/json, text/xml, text/plain, */*',
}
const SYLLABLE_TIMEOUT = 15000
const throttle = { last: 0 }
async function throttled() {
  const wait = 400 - (Date.now() - throttle.last)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  throttle.last = Date.now()
}
const allowed = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /^(raw\.githubusercontent\.com|api\.liriqo-alfarrizi\.my\.id)$/.test(u.hostname)
  } catch { return false }
}
async function fetchText(url) {
  if (!allowed(url)) throw new Error('不允许的来源')
  await throttled()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SYLLABLE_TIMEOUT)
  try {
    const res = await net.fetch(url, { headers: SYLLABLE_UA, signal: ctl.signal, bypassCustomProtocolHandlers: true })
    if (!res.ok) return ''
    return await res.text()
  } finally { clearTimeout(timer) }
}

let s2t = null
function toSimplified(text) {
  try {
    s2t ||= opencc.Converter({ from: 't', to: 'cn' })
    return s2t(String(text || ''))
  } catch { return text }
}

const norm = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const parseTime = (s) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(s || '').trim())
  return m ? +m[1] * 60 + +m[2] : NaN
}

function parseTtml(xml) {
  const spans = []
  const pRe = /<p\b[^>]*begin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g
  let pm
  while ((pm = pRe.exec(xml))) {
    const begin = parseTime(pm[1])
    if (!Number.isFinite(begin)) continue
    const endAttr = /end="([^"]+)"/.exec(pm[0])
    const end = endAttr ? parseTime(endAttr[1]) : NaN
    const words = []
    let text = ''
    let pos = 0
    const sRe = /<span\b([^>]*)>([\s\S]*?)<\/span>/g
    let sm
    while ((sm = sRe.exec(pm[2]))) {
      const attrs = sm[1]
      const gap = pm[2].slice(pos, sm.index)
      if (gap) text += gap.replace(/<[^>]*>/g, '')
      pos = sRe.lastIndex
      if (/ttm:role="[^"]*(translation|roman)/.test(attrs)) continue
      const t = sm[2].replace(/<[^>]*>/g, '')
      if (!t) continue
      text += t
      const b = /begin="([^"]+)"/.exec(attrs)
      const e = /end="([^"]+)"/.exec(attrs)
      const s = b ? parseTime(b[1]) : NaN
      const en = e ? parseTime(e[1]) : NaN
      if (Number.isFinite(s)) words.push({ text: t, time: s, end: Number.isFinite(en) ? en : undefined })
    }
    if (!text.trim()) continue
    spans.push({
      time: begin,
      end: Number.isFinite(end) ? end : undefined,
      text: toSimplified(text.trim()),
      words: words.map((w) => ({ ...w, text: toSimplified(w.text) })),
    })
  }
  return spans.length ? spans : null
}

async function fetchSyllables({ title, artist, debug: wantDebug = false } = {}) {
  title = String(title || '').trim()
  if (!title) return { ok: false, error: '缺少歌曲名' }
  const candidates = []
  const debug = wantDebug ? { providers: [] } : null
  // 1) AMLL TTML DB：社区人工逐字，质量最高
  try {
    const index = await fetchText(INDEX_URL)
    const q = norm(title)
    const qa = norm(artist)
    if (index && q) {
      const found = []
      for (const line of index.split('\n')) {
        if (!line.trim()) continue
        let j
        try { j = JSON.parse(line) } catch { continue }
        const md = {}
        for (const [k, v] of j.metadata || []) md[k] = Array.isArray(v) ? v : [v]
        const name = norm(md.musicName?.[0])
        if (!name) continue
        const bidir = name.includes(q) || q.includes(name)
        const fuzzy = name.slice(0, 6) === q.slice(0, 6)
        if (!bidir && !fuzzy) continue
        const artists = (md.artists || []).map(norm).join('/')
        const artistHit = qa && artists.includes(qa)
        const score = (name === q ? 4 : bidir ? 2 : 0) + (artistHit ? 2 : 0)
        found.push({ file: j.rawLyricFile, name: md.musicName?.[0] || '', artists: (md.artists || []).join('/'), score })
      }
      found.sort((a, b) => b.score - a.score)
      if (debug) debug.amll = { query: title, candidates: found.slice(0, 5) }
      const best = found.find((c) => c.score >= 3)
      if (best) {
        const xml = await fetchText(RAW_URL(best.file))
        const lines = xml ? parseTtml(xml) : null
        if (lines) {
          candidates.push({ source: 'amll', provider: 'amll-ttml-db', lines })
          if (debug) debug.amll.picked = best
        }
      }
    }
  } catch {}
  // 2) LiriQo：把每个「带词级时间轴」的 provider 都作为独立候选（petitlyrics / apple / qq / …）
  try {
    const u = new URL(LIRIQO + '/lyrics')
    u.searchParams.set('title', title)
    if (artist) u.searchParams.set('artist', String(artist))
    const raw = await fetchText(String(u))
    const json = raw ? JSON.parse(raw) : null
    const timed = (json?.tracks || []).filter((t) => Array.isArray(t?.timed) && t.timed.some((l) => l.words?.length))
    for (const track of timed) {
      const out = []
      for (const l of track.timed) {
        const words = (l.words || [])
          .filter((w) => String(w.text || '').trim() && Number.isFinite(+w.start) && +w.start > 0)
          .map((w) => ({ text: toSimplified(String(w.text)), time: +w.start / 1000, end: Number.isFinite(+w.end) && +w.end > 0 ? +w.end / 1000 : undefined }))
        if (!words.length) continue
        out.push({
          time: words[0].time,
          end: Number.isFinite(+l.end) && +l.end > 0 ? +l.end / 1000 : undefined,
          text: toSimplified(String(l.text || '').trim()),
          words,
        })
      }
      if (out.length >= 2) {
        candidates.push({ source: 'liriqo', provider: track.provider || 'unknown', lines: out })
      }
    }
    if (debug) debug.liriqo = { providers: timed.slice(0, 5).map((t) => `${t.provider}:${t.syncLevel || t.granularity || 'word'}`) }
  } catch {}
  if (debug) debug.candidateCount = candidates.length
  // 兼容旧字段：lines/source 取第一个候选；完整候选列表交给渲染层按本地 LRC 命中率择优
  const first = candidates[0] || null
  return { ok: true, lines: first?.lines || null, source: first?.source || '', candidates, debug }
}
module.exports = { fetchSyllables, parseTtml, toSimplified, norm, parseTime }