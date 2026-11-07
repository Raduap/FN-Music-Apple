// 逐字歌词抓取（实验性）：纯逻辑模块，便于单测与主进程复用。
// 数据源：AMLL TTML DB（社区人工逐字库）→ LiriQo 聚合 → 酷狗 KRC / 网易云 YRC / QQ 音乐 QRC 直连。
const { net } = require('electron')
const opencc = require('opencc-js')
const { decryptQrc, parseQrc } = require('./qrc')

const INDEX_URL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/metadata/raw-lyrics-index.jsonl'
const RAW_URL = (file) => 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/raw-lyrics/' + encodeURIComponent(file)
const LIRIQO = 'https://api.liriqo-alfarrizi.my.id/v1'
const KUGOU_SEARCH = 'https://songsearch.kugou.com/song_search_v2'
const KUGOU_LYRICS = 'https://lyrics.kugou.com'
// 酷狗 KRC 解密：base64 -> 丢前 4 字节 -> 按固定 key 逐字节 XOR -> zlib inflate
const KRC_KEY = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])
// 网易云：搜索走 cloudsearch/pc，歌词走 EAPI（params = AES-128-ECB，响应为明文 JSON）。
const NETEASE_SEARCH = 'https://music.163.com/api/cloudsearch/pc'
const NETEASE_EAPI = 'https://interface3.music.163.com/eapi/song/lyric/v1'
const NETEASE_EAPI_PATH = '/api/song/lyric/v1'
const NETEASE_EAPI_KEY = 'e82ckenh8dichen8'
// QQ 音乐：soso 搜索拿 songid，lyric_download.fcg 取加密 QRC（自定义 DES，见 qrc.js）。
const QQ_SEARCH = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const QQ_LYRIC = 'https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg'

// 逐字数据源清单（顺序即默认优先级，设置面板可调整 / 开关）。
// - amll：AMLL TTML DB，社区人工校准，质量最高
// - liriqo：聚合接口（Apple / 酷狗 / 网易 / 千千等）
// - kugou：酷狗 KRC 直连（两步搜索 + 解密），中文逐字覆盖最好
// - netease：网易云 YRC 直连（EAPI），中日英覆盖均衡
// - qq：QQ 音乐 QRC 直连（自定义 DES 解密），中文流行覆盖好
const SYLLABLE_SOURCES = ['amll', 'liriqo', 'kugou', 'netease', 'qq']

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
    return u.protocol === 'https:' && /^(raw\.githubusercontent\.com|api\.liriqo-alfarrizi\.my\.id|songsearch\.kugou\.com|lyrics\.kugou\.com|music\.163\.com|interface3\.music\.163\.com|c\.y\.qq\.com)$/.test(u.hostname)
  } catch { return false }
}
async function fetchRaw(url, init = {}) {
  if (!allowed(url)) throw new Error('不允许的来源')
  await throttled()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SYLLABLE_TIMEOUT)
  try {
    const res = await net.fetch(url, { ...init, signal: ctl.signal, bypassCustomProtocolHandlers: true })
    if (!res.ok) return ''
    return await res.text()
  } finally { clearTimeout(timer) }
}
async function fetchText(url) {
  return fetchRaw(url, { headers: SYLLABLE_UA })
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

// 酷狗 KRC：`[offset:ms]` 行 + `[行起始,行时长]<词偏移,词时长,0>词...`。
// 词绝对时间 = 行起始 + 词偏移（毫秒）。
function parseKrc(text) {
  const lines = []
  let offset = 0
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const off = /^\[offset:\s*(-?\d+)\]$/i.exec(line)
    if (off) { offset = +off[1] / 1000; continue }
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!m) continue
    const lineStart = +m[1] / 1000 + offset
    const lineDur = +m[2] / 1000
    const rest = m[3]
    const words = []
    let text = ''
    const wRe = /<(\d+),(\d+),(\d+)>([^<]*)/g
    let wm
    while ((wm = wRe.exec(rest))) {
      const wText = wm[4]
      if (!wText) continue
      const wStart = lineStart + +wm[1] / 1000
      const wEnd = wStart + +wm[2] / 1000
      text += wText
      words.push({ text: wText, time: wStart, end: wEnd })
    }
    if (!words.length || !text.trim()) continue
    lines.push({ time: lineStart, end: lineStart + lineDur, text: toSimplified(text), words: words.map((w) => ({ ...w, text: toSimplified(w.text) })) })
  }
  return lines
}

// 酷狗：两步搜索（song_search_v2 拿 FileHash -> lyrics.kugou.com 查 KRC -> 下载解密）。
// 命中后返回单个候选；失败静默返回 []。
async function fetchKugouLines(title, artist) {
  const kw = [title, artist].filter(Boolean).join(' ')
  const su = new URL(KUGOU_SEARCH)
  su.searchParams.set('keyword', kw)
  su.searchParams.set('page', '1')
  su.searchParams.set('pagesize', '5')
  const sRaw = await fetchText(String(su))
  const sJson = sRaw ? JSON.parse(sRaw) : null
  const lists = sJson?.data?.lists || []
  if (!lists.length) return []
  // 挑最像的：歌名归一化后完全匹配优先，其次第一条
  const q = norm(title)
  const best = lists.find((x) => norm(x.SongName) === q) || lists[0]
  if (!best?.FileHash) return []
  const lu = new URL(KUGOU_LYRICS + '/search')
  lu.searchParams.set('ver', '1')
  lu.searchParams.set('man', 'yes')
  lu.searchParams.set('client', 'pc')
  lu.searchParams.set('hash', best.FileHash)
  if (best.Duration) lu.searchParams.set('duration', String(best.Duration * 1000))
  const lRaw = await fetchText(String(lu))
  const lJson = lRaw ? JSON.parse(lRaw) : null
  const cand = (lJson?.candidates || [])[0]
  if (!cand?.id || !cand?.accesskey) return []
  const du = new URL(KUGOU_LYRICS + '/download')
  du.searchParams.set('ver', '1')
  du.searchParams.set('client', 'pc')
  du.searchParams.set('id', String(cand.id))
  du.searchParams.set('accesskey', String(cand.accesskey))
  du.searchParams.set('fmt', 'krc')
  du.searchParams.set('charset', 'utf8')
  const dRaw = await fetchText(String(du))
  const dJson = dRaw ? JSON.parse(dRaw) : null
  if (!dJson?.content) return []
  const buf = Buffer.from(String(dJson.content), 'base64').subarray(4)
  for (let i = 0; i < buf.length; i++) buf[i] ^= KRC_KEY[i % KRC_KEY.length]
  let krc
  try { krc = require('zlib').inflateSync(buf).toString('utf8') } catch { return [] }
  const lines = parseKrc(krc)
  if (lines.length < 2) return []
  return [{ source: 'kugou', provider: 'kugou-krc', lines, track: best.SongName || '', artist: best.SingerName || '' }]
}

// 网易云 YRC：每行两种形态——
//   JSON 元数据行 {"t":毫秒,"c":[{"tx":"词"}]}（作词/作曲等，跳过）
//   歌词行 [行起始,行时长](词起始,词时长,0)词...
// 与酷狗 KRC 不同：词的开始时间是绝对毫秒，且词文本紧跟在自己的时间戳之后。
function parseYrc(text) {
  const lines = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!m) continue
    const lineStart = +m[1] / 1000
    const lineDur = +m[2] / 1000
    const rest = m[3]
    // 记录每个 (起始,时长,0) token：at = token 起点，from = token 之后文本起点。
    // 词文本 = 本 token 之后直到下一个 token 起点的内容（末尾词直到行尾）。
    const toks = []
    const tokenRe = /\((\d+),(\d+),\d+\)/g
    let tm
    while ((tm = tokenRe.exec(rest))) toks.push({ start: +tm[1], dur: +tm[2], at: tm.index, from: tokenRe.lastIndex })
    const words = []
    let text = ''
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      const piece = rest.slice(t.from, i + 1 < toks.length ? toks[i + 1].at : rest.length)
      if (!piece) continue
      text += piece
      words.push({ text: piece, time: t.start / 1000, end: t.start / 1000 + t.dur / 1000 })
    }
    if (!words.length || !text.trim()) continue
    lines.push({ time: lineStart, end: lineStart + lineDur, text: toSimplified(text), words: words.map((w) => ({ ...w, text: toSimplified(w.text) })) })
  }
  return lines
}

// 网易云：cloudsearch/pc 搜歌 -> EAPI 取 YRC（params 走 AES-128-ECB + md5 摘要）。
// 歌名命中、且已知艺人时必须艺人命中才采用，避免抓到无版权歌曲的翻唱。
async function fetchNeteaseLines(title, artist) {
  const crypto = require('crypto')
  const body = new URLSearchParams({ s: [title, artist].filter(Boolean).join(' '), type: '1', limit: '10', offset: '0' })
  const sRaw = await fetchRaw(NETEASE_SEARCH, {
    method: 'POST',
    headers: { ...SYLLABLE_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    body: String(body),
  })
  const songs = (sRaw ? JSON.parse(sRaw) : null)?.result?.songs || []
  const q = norm(title)
  const qa = norm(artist)
  const BAD = /(cover|翻唱|伴奏|钢琴|纯音乐|童声|dj|remix|beat|karaoke|instrumental|live|demo)/i
  let best = null
  for (const s of songs) {
    const name = norm(s.name)
    const nameEq = name === q
    if (!(nameEq || name.includes(q) || q.includes(name))) continue
    const artistHit = qa && (s.ar || []).some((a) => artistMatches(qa, norm(a.name)))
    // 已知艺人却对不上：多半是翻唱 / 改编，直接跳过
    if (qa && !artistHit) continue
    let score = (nameEq ? 4 : 2) + (artistHit ? 3 : 0)
    if (BAD.test(s.name)) score -= 3
    if (!best || score > best.score) best = { id: s.id, name: s.name, artists: (s.ar || []).map((a) => a.name).join(','), score }
  }
  if (!best || best.score < 2) return []
  const data = { id: String(best.id), cp: false, lv: 0, tv: 0, rv: 0, kv: 1, yv: 1, ytv: 0, yrv: 0 }
  const text = JSON.stringify(data)
  const digest = crypto.createHash('md5').update('nobody' + NETEASE_EAPI_PATH + 'use' + text + 'md5forencrypt').digest('hex')
  const cipher = crypto.createCipheriv('aes-128-ecb', NETEASE_EAPI_KEY, null)
  const params = Buffer.concat([cipher.update(Buffer.from(NETEASE_EAPI_PATH + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest, 'utf8')), cipher.final()]).toString('hex').toUpperCase()
  const lRaw = await fetchRaw(NETEASE_EAPI, {
    method: 'POST',
    headers: { ...SYLLABLE_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/', Origin: 'https://music.163.com' },
    body: 'params=' + params,
  })
  const json = lRaw ? JSON.parse(lRaw) : null
  const lines = parseYrc(json?.yrc?.lyric || json?.klyric?.lyric || '')
  if (lines.length < 2) return []
  return [{ source: 'netease', provider: 'netease-yrc', lines, track: best.name, artist: best.artists }]
}

// AMLL TTML DB：本地索引匹配后再拉取 TTML。
async function fetchAmllCandidates(title, artist, debug) {
  const out = []
  const index = await fetchText(INDEX_URL)
  const q = norm(title)
  const qa = norm(artist)
  if (!index || !q) return out
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
  if (!best) return out
  const xml = await fetchText(RAW_URL(best.file))
  const lines = xml ? parseTtml(xml) : null
  if (lines) {
    out.push({ source: 'amll', provider: 'amll-ttml-db', lines })
    if (debug) debug.amll.picked = best
  }
  return out
}

// LiriQo：把每个「带词级时间轴」的 provider 都作为独立候选（petitlyrics / apple / qq / …）
async function fetchLiriqoCandidates(title, artist, debug) {
  const out = []
  const u = new URL(LIRIQO + '/lyrics')
  u.searchParams.set('title', title)
  if (artist) u.searchParams.set('artist', String(artist))
  const raw = await fetchText(String(u))
  const json = raw ? JSON.parse(raw) : null
  const timed = (json?.tracks || []).filter((t) => Array.isArray(t?.timed) && t.timed.some((l) => l.words?.length))
  for (const track of timed) {
    const lines = []
    for (const l of track.timed) {
      const words = (l.words || [])
        .filter((w) => String(w.text || '').trim() && Number.isFinite(+w.start) && +w.start > 0)
        .map((w) => ({ text: toSimplified(String(w.text)), time: +w.start / 1000, end: Number.isFinite(+w.end) && +w.end > 0 ? +w.end / 1000 : undefined }))
      if (!words.length) continue
      lines.push({
        time: words[0].time,
        end: Number.isFinite(+l.end) && +l.end > 0 ? +l.end / 1000 : undefined,
        text: toSimplified(String(l.text || '').trim()),
        words,
      })
    }
    if (lines.length >= 2) out.push({ source: 'liriqo', provider: track.provider || 'unknown', lines })
  }
  if (debug) debug.liriqo = { providers: timed.slice(0, 5).map((t) => `${t.provider}:${t.syncLevel || t.granularity || 'word'}`) }
  return out
}

async function fetchKugouCandidates(title, artist, debug) {
  const tracks = await fetchKugouLines(title, artist)
  if (debug) debug.kugou = { tracks: tracks.length }
  return tracks.map((t) => ({ source: 'kugou', provider: 'kugou-krc', lines: t.lines }))
}

async function fetchQqCandidates(title, artist, debug) {
  const tracks = await fetchQqLines(title, artist)
  if (debug) debug.qq = { tracks: tracks.length }
  return tracks.map((t) => ({ source: 'qq', provider: 'qq-qrc', lines: t.lines }))
}

async function fetchNeteaseCandidates(title, artist, debug) {
  const tracks = await fetchNeteaseLines(title, artist)
  if (debug) debug.netease = { tracks: tracks.length }
  return tracks.map((t) => ({ source: 'netease', provider: 'netease-yrc', lines: t.lines }))
}

// QQ 音乐：soso 搜索 -> lyric_download.fcg 取加密 QRC -> 自定义 DES 解密 -> 解析。
// 歌名命中、且已知艺人时必须艺人命中才采用，避免抓到翻唱 / 伴奏。
// 判断一批词级行是否像「真歌词」：真歌词会铺开在整首歌上；
// 只有开头几秒的都只是制作人 / credit 名单，应丢弃并回退下一个候选。
function looksLikeLyricLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return false
  let max = 0
  for (const l of lines) {
    const t = Number(l?.time)
    if (Number.isFinite(t) && t > max) max = t
  }
  return max >= 5
}

// 拉取指定 QQ songid 的加密 QRC 并解密解析；失败返回 null。
async function downloadQqQrc(songid) {
  const body = new URLSearchParams({ version: '15', miniversion: '100', lrctype: '4', musicid: String(songid) })
  const xml = await fetchRaw(QQ_LYRIC, {
    method: 'POST',
    headers: { ...SYLLABLE_UA, Referer: 'https://c.y.qq.com/', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(body),
  })
  const m = /<content[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml || '')
  if (!m) return null
  const decrypted = decryptQrc(m[1])
  if (!decrypted) return null
  // 与其他源保持一致：QRC 里的繁体直接转简体，词时间轴不受影响。
  const lines = parseQrc(decrypted).map((l) => ({
    ...l,
    text: toSimplified(l.text),
    words: l.words.map((w) => ({ ...w, text: toSimplified(w.text) })),
  }))
  return lines.length >= 2 ? lines : null
}

// 两个艺人名是否算同一人：完全包含即通过；再退一步，共享 >=2 个汉字前缀
// 也算通过（应对「宇多田ヒカル」vs「宇多田光」这类同一歌手的异名写法）。
function artistMatches(local, candidate) {
  if (!local || !candidate) return false
  if (local === candidate || candidate.includes(local) || local.includes(candidate)) return true
  let n = 0
  while (n < local.length && n < candidate.length && local[n] === candidate[n] && /[\u4e00-\u9fff]/.test(local[n])) n++
  return n >= 2
}

// QQ 音乐：soso 搜索 -> 按分数逐条尝试 lyric_download.fcg，取第一条「真歌词」。
// 有些版本（如仅 credit 信息的单曲页）解密出来只有制作人名单、时间轴全挤在开头，
// 需要靠时间跨度识别并回退到下一个候选。
async function fetchQqLines(title, artist) {
  const su = new URL(QQ_SEARCH)
  su.searchParams.set('w', [title, artist].filter(Boolean).join(' '))
  su.searchParams.set('p', '1')
  su.searchParams.set('n', '10')
  su.searchParams.set('format', 'json')
  su.searchParams.set('new_json', '1')
  const sRaw = await fetchRaw(String(su), { headers: { ...SYLLABLE_UA, Referer: 'https://y.qq.com/' } })
  const songs = (sRaw ? JSON.parse(sRaw) : null)?.data?.song?.list || []
  const q = norm(title)
  const qa = norm(artist)
  const BAD = /(cover|翻唱|伴奏|钢琴|纯音乐|童声|dj|remix|beat|karaoke|instrumental|live|demo|片段|铃声)/i
  const ranked = []
  for (const s of songs) {
    // new_json=1 时字段是 id/name，旧格式是 songid/songname，两种都兼容
    const sid = s.songid ?? s.id
    const sname = String(s.songname ?? s.name ?? '')
    if (!sid || !sname) continue
    const name = norm(sname)
    const nameEq = name === q
    if (!(nameEq || name.includes(q) || q.includes(name))) continue
    const singers = (s.singer || []).map((x) => norm(x.name))
    const artistHit = qa && singers.some((n) => artistMatches(qa, n))
    // 已知艺人却对不上：多半是翻唱 / 改编，直接跳过
    if (qa && !artistHit) continue
    let score = (nameEq ? 4 : 2) + (artistHit ? 3 : 0)
    if (BAD.test(sname)) score -= 3
    if (score < 2) continue
    ranked.push({ id: sid, name: sname, artists: (s.singer || []).map((x) => x.name).join(','), score })
  }
  ranked.sort((a, b) => b.score - a.score)
  for (const cand of ranked.slice(0, 4)) {
    const lines = await downloadQqQrc(cand.id)
    if (!lines) continue
    if (!looksLikeLyricLines(lines)) continue
    return [{ source: 'qq', provider: 'qq-qrc', lines, track: cand.name, artist: cand.artists }]
  }
  return []
}

const SOURCE_FETCHERS = {
  amll: fetchAmllCandidates,
  liriqo: fetchLiriqoCandidates,
  kugou: fetchKugouCandidates,
  netease: fetchNeteaseCandidates,
  qq: fetchQqCandidates,
}

async function fetchSyllables({ title, artist, sources, debug: wantDebug = false } = {}) {
  title = String(title || '').trim()
  if (!title) return { ok: false, error: '缺少歌曲名' }
  const debug = wantDebug ? { providers: [] } : null
  // sources：有序数据源（设置面板可开关 / 排序）；未列出 = 关闭该源，缺省或空数组 = 全开。
  const order = (Array.isArray(sources) && sources.length ? sources : SYLLABLE_SOURCES)
    .filter((id, i, arr) => SYLLABLE_SOURCES.includes(id) && arr.indexOf(id) === i)
  const candidates = []
  // 严格按用户排序串行抓取：渲染层按候选择优时会优先看到排在前面的源。
  for (const id of order) {
    const fetcher = SOURCE_FETCHERS[id]
    if (!fetcher) continue
    try {
      candidates.push(...(await fetcher(title, artist, debug)))
    } catch {}
  }
  if (debug) debug.candidateCount = candidates.length
  // 兼容旧字段：lines/source 取第一个候选；完整候选列表交给渲染层按本地 LRC 命中率择优
  const first = candidates[0] || null
  return { ok: true, lines: first?.lines || null, source: first?.source || '', candidates, debug }
}

module.exports = { fetchSyllables, parseTtml, parseKrc, parseYrc, toSimplified, norm, parseTime, artistMatches, looksLikeLyricLines, SYLLABLE_SOURCES }