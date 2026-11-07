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
// 限流 / 瞬时故障的退避重试：优先尊重 Retry-After，否则指数退避（800ms 起，封顶 8s）。
// 单个源连续失败不该拖垮整首歌，重试仍有上限。
const RETRY_LIMIT = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function retryDelay(res, attempt) {
  const ra = res && res.headers && res.headers.get ? res.headers.get('retry-after') : null
  if (ra) {
    const sec = Number(ra)
    if (Number.isFinite(sec)) return Math.min(8000, Math.max(0, sec) * 1000)
    const when = Date.parse(ra)
    if (Number.isFinite(when)) return Math.min(8000, Math.max(0, when - Date.now()))
  }
  return Math.min(8000, 800 * 2 ** attempt)
}
async function fetchRaw(url, init = {}) {
  if (!allowed(url)) throw new Error('不允许的来源')
  for (let attempt = 0; ; attempt++) {
    await throttled()
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), SYLLABLE_TIMEOUT)
    try {
      const res = await net.fetch(url, { ...init, signal: ctl.signal, bypassCustomProtocolHandlers: true })
      // 429 限流（LiriQo 常见）与 5xx 瞬时故障：等待后重试
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_LIMIT) {
        await sleep(retryDelay(res, attempt))
        continue
      }
      if (!res.ok) return ''
      return await res.text()
    } finally { clearTimeout(timer) }
  }
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
// 下载并解密单个酷狗 KRC，失败返回 null（供多候选循环复用）。
async function downloadKugouKrc(track) {
  if (!track?.FileHash) return null
  const lu = new URL(KUGOU_LYRICS + '/search')
  lu.searchParams.set('ver', '1')
  lu.searchParams.set('man', 'yes')
  lu.searchParams.set('client', 'pc')
  lu.searchParams.set('hash', track.FileHash)
  if (track.Duration) lu.searchParams.set('duration', String(track.Duration * 1000))
  const lRaw = await fetchText(String(lu))
  const lJson = lRaw ? JSON.parse(lRaw) : null
  const cand = (lJson?.candidates || [])[0]
  if (!cand?.id || !cand?.accesskey) return null
  const du = new URL(KUGOU_LYRICS + '/download')
  du.searchParams.set('ver', '1')
  du.searchParams.set('client', 'pc')
  du.searchParams.set('id', String(cand.id))
  du.searchParams.set('accesskey', String(cand.accesskey))
  du.searchParams.set('fmt', 'krc')
  du.searchParams.set('charset', 'utf8')
  const dRaw = await fetchText(String(du))
  const dJson = dRaw ? JSON.parse(dRaw) : null
  if (!dJson?.content) return null
  const buf = Buffer.from(String(dJson.content), 'base64').subarray(4)
  for (let i = 0; i < buf.length; i++) buf[i] ^= KRC_KEY[i % KRC_KEY.length]
  let krc
  try { krc = require('zlib').inflateSync(buf).toString('utf8') } catch { return null }
  const lines = parseKrc(krc)
  return lines.length >= 2 ? lines : null
}

// 酷狗：搜索 -> 按「歌名 / 艺人 / 时长 / 版本标记」排序 -> 取前几个版本各出一个候选。
// 同名歌曲常有现场版、DJ 版、裁剪版，只取第一条会把逐字配到错误版本上；
// 多返回几个候选，交给渲染层的覆盖率和行数结构择优挑选。
async function fetchKugouLines(title, artist, duration) {
  const kw = [title, artist].filter(Boolean).join(' ')
  const su = new URL(KUGOU_SEARCH)
  su.searchParams.set('keyword', kw)
  su.searchParams.set('page', '1')
  su.searchParams.set('pagesize', '10')
  const sRaw = await fetchText(String(su))
  const sJson = sRaw ? JSON.parse(sRaw) : null
  const lists = sJson?.data?.lists || []
  if (!lists.length) return []
  const ranked = []
  for (const x of lists) {
    const score = scoreVersion({
      name: x.SongName, candArtist: x.SingerName, candDuration: x.Duration,
      title, artist, duration,
    })
    if (score < 0 || !x.FileHash) continue
    ranked.push({ track: x, score })
  }
  ranked.sort((a, b) => b.score - a.score)
  // 取前若干「同名」候选各下一份 KRC：名次只代表元数据相似度，真正取舍
  // 交给合并层按文本覆盖率决定（版本标记只是排序信号，不再淘汰候选）。
  const out = []
  const seen = new Set()
  for (const { track } of ranked.slice(0, 5)) {
    const key = track.FileHash || track.SongName
    if (seen.has(key)) continue
    const lines = await downloadKugouKrc(track)
    if (!lines) continue
    seen.add(key)
    out.push({ source: 'kugou', provider: 'kugou-krc', lines, track: track.SongName || '', artist: track.SingerName || '' })
  }
  return out
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
async function fetchNeteaseLines(title, artist, duration) {
  const crypto = require('crypto')
  const body = new URLSearchParams({ s: [title, artist].filter(Boolean).join(' '), type: '1', limit: '10', offset: '0' })
  const sRaw = await fetchRaw(NETEASE_SEARCH, {
    method: 'POST',
    headers: { ...SYLLABLE_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    body: String(body),
  })
  const songs = (sRaw ? JSON.parse(sRaw) : null)?.result?.songs || []
  const ranked = []
  for (const s of songs) {
    const artists = (s.ar || []).map((a) => a.name)
    // 与酷狗 / QQ 共用同一套版本打分，避免三处各自维护正则而漏筛。
    const score = scoreVersion({
      name: s.name, candArtist: artists.join(','), candDuration: Number(s.dt) / 1000,
      title, artist, duration,
    })
    if (score < 0 || !s.id) continue
    ranked.push({ id: s.id, name: s.name, artists: artists.join(','), score })
  }
  ranked.sort((a, b) => b.score - a.score)
  // 逐个尝试前几个同名版本：同名歌曲常有现场版 / 重制版，时间轴对不上，
  // 交给渲染层按本地 LRC 覆盖率择优，避免在抓取层武断锁定第一条。
  const out = []
  for (const best of ranked.slice(0, 2)) {
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
    if (lines.length < 2) continue
    out.push({ source: 'netease', provider: 'netease-yrc', lines, track: best.name, artist: best.artists })
  }
  return out
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

async function fetchKugouCandidates(title, artist, debug, duration) {
  const tracks = await fetchKugouLines(title, artist, duration)
  if (debug) debug.kugou = { tracks: tracks.length }
  return tracks
}

async function fetchQqCandidates(title, artist, debug, duration) {
  const tracks = await fetchQqLines(title, artist, duration)
  if (debug) debug.qq = { tracks: tracks.length }
  return tracks
}

async function fetchNeteaseCandidates(title, artist, debug, duration) {
  const tracks = await fetchNeteaseLines(title, artist, duration)
  if (debug) debug.netease = { tracks: tracks.length }
  return tracks
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

// 版本标记（翻唱 / 伴奏 / 现场 / 环绕 / DJ 等）只参与「同名候选之间」的轻量排序。
// 经验：第三方上传的「3D环绕版 / DJ版 / 现场版」经常直接复用原版的歌词与时间轴，
// 罚分过重会把唯一携带正确逐字的候选打负分淘汰（曾导致《无人之岛》《告白气球》整首丢失）。
// 因此这里只做最多 2 分的排序罚分，真正的取舍交给合并层的文本覆盖率。
const BAD_VERSION = /(cover|翻唱|伴奏|钢琴|纯音乐|童声|dj|remix|beat|karaoke|instrumental|demo|片段|铃声|女声|男声|改编|抖音|8d|环绕|加速|慢速|降调|升调)/i
// 现场类标记单独一组：本地曲目本身就是现场版时不该被罚。
const LIVE_VERSION = /(live|现场|演唱会|音乐汇|巡演|音乐会)/i

// 版本罚分：本地标题已带同类标记时豁免（如本地就是 (Live) 版，候选也是 Live 版）。
function versionPenalty(name, title) {
  const n = String(name || ''), t = String(title || '')
  let p = 0
  if (LIVE_VERSION.test(n) && !LIVE_VERSION.test(t)) p++
  if (BAD_VERSION.test(n) && !BAD_VERSION.test(t)) p++
  return Math.min(p, 2)
}

// 时长接近度（秒）：完全一致返 1，差 >=45s 返 0，缺失返 0.5（不奖不罚）。
// 逐字时间轴与音频时长强相关，用它区分同名的电台版 / 片段 / 现场版。
function durationScore(localSec, candSec) {
  const a = Number(localSec), b = Number(candSec)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return 0.5
  const d = Math.abs(a - b)
  if (d <= 3) return 1
  if (d >= 45) return 0
  return 1 - (d - 3) / 42
}

// 同名候选打分：歌名命中 + 艺人命中 + 时长接近 − 轻量版本罚分。
// 返回值语义：-1 表示「歌名都匹配不上」，由调用方淘汰；其余一律 >= 0.5，
// 保证同名候选不会被罚分打到负分而遭硬过滤（淘汰只由合并层覆盖率决定）。
function scoreVersion({ name, candArtist, candDuration, title, artist, duration }) {
  const nm = norm(name), q = norm(title)
  if (!nm || !q) return -1
  if (!(nm === q || nm.includes(q) || q.includes(nm))) return -1
  let score = nm === q ? 4 : 2
  const qa = norm(artist)
  if (qa && artistMatches(qa, norm(candArtist))) score += 3
  score += durationScore(duration, candDuration) * 2
  score -= versionPenalty(name, title)
  return Math.max(0.5, score)
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
async function fetchQqLines(title, artist, duration) {
  const su = new URL(QQ_SEARCH)
  su.searchParams.set('w', [title, artist].filter(Boolean).join(' '))
  su.searchParams.set('p', '1')
  su.searchParams.set('n', '10')
  su.searchParams.set('format', 'json')
  su.searchParams.set('new_json', '1')
  const sRaw = await fetchRaw(String(su), { headers: { ...SYLLABLE_UA, Referer: 'https://y.qq.com/' } })
  const songs = (sRaw ? JSON.parse(sRaw) : null)?.data?.song?.list || []
  const ranked = []
  for (const s of songs) {
    // new_json=1 时字段是 id/name，旧格式是 songid/songname，两种都兼容
    const sid = s.songid ?? s.id
    const sname = String(s.songname ?? s.name ?? '')
    if (!sid || !sname) continue
    const singers = (s.singer || []).map((x) => x.name)
    // 与酷狗 / 网易云共用同一套版本打分（QQ 的 interval 字段是秒级时长）
    const score = scoreVersion({
      name: sname, candArtist: singers.join(','), candDuration: s.interval,
      title, artist, duration,
    })
    if (score < 0) continue
    ranked.push({ id: sid, name: sname, artists: singers.join(','), score })
  }
  ranked.sort((a, b) => b.score - a.score)
  // 多返回几个候选：同名歌曲的电台版 / 现场版时间轴对不上，
  // 由渲染层按本地 LRC 覆盖率和行数结构择优，不在抓取层武断锁定第一条。
  const out = []
  for (const cand of ranked.slice(0, 4)) {
    const lines = await downloadQqQrc(cand.id)
    if (!lines) continue
    if (!looksLikeLyricLines(lines)) continue
    out.push({ source: 'qq', provider: 'qq-qrc', lines, track: cand.name, artist: cand.artists })
    if (out.length >= 2) break
  }
  return out
}

const SOURCE_FETCHERS = {
  amll: fetchAmllCandidates,
  liriqo: fetchLiriqoCandidates,
  kugou: fetchKugouCandidates,
  netease: fetchNeteaseCandidates,
  qq: fetchQqCandidates,
}

// ---------- 抓取：按用户顺序串行，90% 先显示 / 98% 提前停止 ----------
// 阈值与缓存分档的唯一事实来源在 electron/lyricsMerge.mjs（渲染层与主进程共用）。
// 这里动态 import：syllables.js 是 CJS，而合并逻辑是浏览器原生 ESM（历史 bug 6f9144a）。
let mergeModPromise = null
function loadMerge() {
  mergeModPromise ||= import('./lyricsMerge.mjs')
  return mergeModPromise
}

// 分级磁盘缓存由 main.js 注入（userData/syllables）；单测 / 审计工具没注入时
// 退化为「内存 only」，不落盘、不污染开发机。
let syllableCachePort = null
function setSyllableCache(port) { syllableCachePort = port || null }

function hashLines(lines) {
  let h = 5381
  for (const l of lines) {
    const t = String(l?.text || '')
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0
    h = (h ^ Math.round((Number(l?.time) || 0) * 10)) >>> 0
  }
  return h.toString(36)
}

// 同一首歌（同一份本地 LRC、同一数据源顺序）的并发请求只抓一次：
// 播放页与悬浮窗会同时来取，不合并就会把每个源各打两遍，LiriQo 很容易 429。
const inflightStreams = new Map()
function shareStream(key, factory) {
  const existing = inflightStreams.get(key)
  if (existing) return existing
  const entry = { emitters: new Set(), promise: null }
  entry.promise = Promise.resolve()
    .then(() => factory((data) => { for (const fn of entry.emitters) { try { fn(data) } catch {} } }))
    .finally(() => inflightStreams.delete(key))
  inflightStreams.set(key, entry)
  return entry
}

function normalizeOrder(sources) {
  return (Array.isArray(sources) && sources.length ? sources : SYLLABLE_SOURCES)
    .filter((id, i, arr) => SYLLABLE_SOURCES.includes(id) && arr.indexOf(id) === i)
}

/**
 * 逐源串行抓取 + 阈值判定的核心循环（与网络解耦，便于单测）。
 * - 每个源先查缓存，未命中再调 fetchSource(id)
 * - 抓完一个源就用本地 LRC 重算覆盖率
 * - ≥90%（合格）先把当前最好结果 emit 给界面显示，不阻塞后续源
 * - ≥98%（优秀）直接停止后续源
 * - 期间出现更好结果继续 emit，由界面静默替换
 */
async function runStreamSources({ order, localLines, debug = null, requestId = '', emit, fetchSource, cacheKeyFor = null, cache = null, title = '', artist = '', duration = 0 }) {
  const merge = await loadMerge()
  const collected = []
  let picked = null
  let bestCoverage = -1
  let stoppedAt = ''
  const streamDebug = debug ? { order, sources: [], cacheHits: 0, bestCoverage: 0, stoppedAt: '', emitted: 0 } : null
  const fire = typeof emit === 'function' ? emit : () => {}

  for (const id of order) {
    let candidates = []
    let fromCache = false
    const key = cache && cacheKeyFor ? cacheKeyFor(id) : ''
    if (key) {
      const hit = await cache.get(key)
      if (hit?.candidates?.length) { candidates = hit.candidates; fromCache = true; if (streamDebug) streamDebug.cacheHits++ }
    }
    if (!candidates.length) {
      try { candidates = await fetchSource(id) } catch { candidates = [] }
      if (candidates.length && key) {
        // 覆盖率只用本地 LRC 算，是缓存分档的依据。
        const cov = merge.pickSyllableCandidate(localLines, candidates, { earlyBreak: false })?.coverage ?? 0
        await cache.set(key, { source: id, coverage: cov, tier: merge.syllableTierFor(cov), candidates })
      }
    }
    if (streamDebug) streamDebug.sources.push({ id, candidates: candidates.length, cached: fromCache })
    if (!candidates.length) continue
    collected.push(...candidates)

    const next = merge.pickSyllableCandidate(localLines, collected, { earlyBreak: false })
    const improved = next && next.coverage > bestCoverage + 1e-9
    if (improved) { picked = next; bestCoverage = next.coverage }
    // 合格（≥90%）：先把这份结果交给界面显示，不阻塞后面的源。
    // 后续源出现更好结果时再次推送，由界面静默替换。
    if (improved && bestCoverage >= merge.SYLLABLE_QUALIFIED) {
      if (streamDebug) streamDebug.emitted++
      fire({ requestId, candidates: collected, coverage: bestCoverage, source: next.source, provider: next.provider, done: false })
    }
    // 优秀（≥98%）：够可靠了，直接停掉后面的源。
    if (bestCoverage >= merge.SYLLABLE_EXCELLENT) { stoppedAt = id; break }
  }

  if (streamDebug) {
    streamDebug.bestCoverage = +Math.max(0, bestCoverage).toFixed(4)
    streamDebug.stoppedAt = stoppedAt
    debug.stream = streamDebug
  }
  if (debug) debug.candidateCount = collected.length
  const bestLines = picked?.lines || collected[0]?.lines || null
  const bestSource = picked?.source || collected[0]?.source || ''
  fire({ requestId, candidates: collected, coverage: Math.max(0, bestCoverage), source: bestSource, provider: picked?.provider || '', done: true })
  return { ok: true, lines: bestLines, source: bestSource, candidates: collected, debug }
}

// 抓取阶段只管「按顺序拿候选」；覆盖率由 runStreamSources 用本地 LRC 计算。
// localLines 缺失（审计工具 / 单源直取）时保持旧行为：全量抓完再返回。
async function fetchSyllables({ title, artist, duration, sources, debug: wantDebug = false, localLines = null, onProgress = null, requestId = '' } = {}) {
  title = String(title || '').trim()
  if (!title) return { ok: false, error: '缺少歌曲名' }
  const debug = wantDebug ? { providers: [] } : null
  // sources：有序数据源（设置面板可开关 / 排序）；未列出 = 关闭该源，缺省或空数组 = 全开。
  const order = normalizeOrder(sources)
  const hasLocal = Array.isArray(localLines) && localLines.length > 0

  // 没有本地歌词可对照时，退化为旧的全量抓取（审计工具依赖这个确定性行为）。
  if (!hasLocal) {
    const candidates = []
    for (const id of order) {
      const fetcher = SOURCE_FETCHERS[id]
      if (!fetcher) continue
      try { candidates.push(...(await fetcher(title, artist, debug, duration))) } catch {}
    }
    if (debug) debug.candidateCount = candidates.length
    const first = candidates[0] || null
    return { ok: true, lines: first?.lines || null, source: first?.source || '', candidates, debug }
  }

  const streamKey = [title, artist, Math.round((Number(duration) || 0) / 5) * 5, order.join(','), hashLines(localLines)].join('\u0000')
  const entry = shareStream(streamKey, (emit) => runStreamSources({
    order,
    localLines,
    debug,
    requestId,
    emit,
    fetchSource: (id) => SOURCE_FETCHERS[id](title, artist, debug, duration),
    cache: syllableCachePort,
    cacheKeyFor: syllableCachePort ? (id) => syllableCachePort.key(title, artist, duration, id) : null,
  }))
  if (typeof onProgress === 'function') entry.emitters.add(onProgress)
  try {
    return await entry.promise
  } finally {
    if (typeof onProgress === 'function') entry.emitters.delete(onProgress)
  }
}

function clearSyllableCache() {
  inflightStreams.clear()
  return syllableCachePort?.clear?.()
}

module.exports = { fetchSyllables, clearSyllableCache, setSyllableCache, runStreamSources, parseTtml, parseKrc, parseYrc, toSimplified, norm, parseTime, artistMatches, looksLikeLyricLines, durationScore, scoreVersion, SYLLABLE_SOURCES }
