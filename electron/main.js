const { app, BrowserWindow, ipcMain, protocol, net, session, safeStorage, nativeTheme, shell, nativeImage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { sha256, newDeviceId, normalizeBase, hostOf, authx, abortAfter, streamWithIdle, friendlyError } = require('./util')
const { createTray, BALL_MODES } = require('./tray')
const { createBall } = require('./ball')
const { createLyrics } = require('./lyricsWindow')
const { createCoverCache, coverKey } = require('./coverCache')
const { fetchSyllables, setSyllableCache } = require('./syllables')
const { createSyllableCache } = require('./syllableCache')

const isDev = process.env.NODE_ENV === 'development'
// 自定义数据目录（自动化测试用，让每次测试都从干净的状态开始）
if (process.env.FNM_USER_DATA) app.setPath('userData', path.resolve(process.env.FNM_USER_DATA))

// 默认 User-Agent 含应用名「飞牛音乐」（中文），飞牛 NAS 的网关遇到非 ASCII 请求头会直接返回 HTTP 500，
// 因此必须在 ready 之前改成纯 ASCII。
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36 FNMusic/${app.getVersion()}`

// 自定义协议：渲染进程所有请求（接口 / 封面 / 音频流）都经 fnm://srv/... 转发到飞牛，
// 由主进程统一附带 music-token Cookie，渲染进程永远拿不到凭证。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fnm',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
  },
])

// ---------- 会话状态 ----------
// mode: 'nas'  —— fnOS 系统账号，经 OAuth 授权登录（/user/auth-login）
//       'password' —— 飞牛音乐独立账号，用户名密码登录（/user/password-login）
const state = {
  base: '', // 例如 http://192.168.1.10:5666/music
  mode: 'nas',
  token: '',
  deviceId: '',
  username: '',
  password: '',
}

const storeFile = () => path.join(app.getPath('userData'), 'session.bin')
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
const experimentalKeyFile = () => path.join(app.getPath('userData'), 'experimental-key.bin')
const OAUTH_PARTITION = 'persist:fnos-oauth'

// NAS 常用自签名证书。只对用户填写的服务器（以及它的 fnOS 登录页）放行，其他网站照常校验证书
const trustedHosts = new Set()
const trustHost = (url) => { const h = hostOf(url); if (h) trustedHosts.add(h) }
const verifyCert = (req, cb) => cb(trustedHosts.has(String(req.hostname).toLowerCase().replace(/^\[(.*)\]$/, '$1')) ? 0 : -3)

// 各类请求的超时（毫秒）。服务器卡住时必须主动中止，否则会一直占用
// Chromium 对同一主机的连接池（HTTP/1.1 约 6 条），把其它无关请求也拖垮。
const TIMEOUT = {
  api: 15000,   // 普通 JSON 接口：覆盖到响应体读取完成
  cover: 30000, // 封面（NAS 现场生成缩略图可能较慢）
  stream: 30000,     // 音频流：仅覆盖到响应头返回
  streamIdle: 15000, // 音频流响应体的数据空闲上限：卡住不传就中止，释放连接
}

// 带签名的 JSON 请求（主进程内部使用）
async function apiFetch(base, apiPath, { method = 'GET', body, token } = {}) {
  const url = base + apiPath
  const raw = body === undefined ? undefined : JSON.stringify(body)
  const headers = { Accept: 'application/json', authx: authx(method, url, raw) }
  if (raw !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Cookie = `music-token=${token}`
  const { signal, clear } = abortAfter(TIMEOUT.api)
  try {
    const res = await net.fetch(url, { method, headers, body: raw, signal })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, type: res.headers.get('content-type') || '' }
  } finally {
    clear()
  }
}

function saveSession() {
  try {
    const payload = JSON.stringify({
      base: state.base,
      mode: state.mode,
      token: state.token,
      deviceId: state.deviceId,
      username: state.username,
      password: state.password,
    })
    const buf = safeStorage.isEncryptionAvailable()
      ? Buffer.concat([Buffer.from('E1'), safeStorage.encryptString(payload)])
      : Buffer.concat([Buffer.from('P0'), Buffer.from(payload, 'utf8')])
    fs.writeFileSync(storeFile(), buf)
  } catch (e) {
    console.error('saveSession failed', e)
  }
}

function loadSession() {
  try {
    const buf = fs.readFileSync(storeFile())
    const tag = buf.subarray(0, 2).toString()
    const body = buf.subarray(2)
    const json = tag === 'E1' ? safeStorage.decryptString(body) : body.toString('utf8')
    Object.assign(state, JSON.parse(json))
    trustHost(state.base)
    if (!state.mode) state.mode = state.password ? 'password' : 'nas'
    return true
  } catch {
    return false
  }
}

async function clearSession() {
  state.token = ''
  state.password = ''
  try { fs.unlinkSync(storeFile()) } catch {}
  // 同时清除 fnOS 登录页的 Cookie，下次需重新输入账号
  try { await session.fromPartition(OAUTH_PARTITION).clearStorageData() } catch {}
}

function readPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) } catch { return {} }
}
function writePrefs(p) {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(p)) } catch {}
}

function readExperimentalKey() {
  try {
    const buf = fs.readFileSync(experimentalKeyFile())
    const tag = buf.subarray(0, 2).toString()
    if (tag !== 'E1') return ''
    return safeStorage.decryptString(buf.subarray(2))
  } catch { return '' }
}

function writeExperimentalKey(key) {
  try {
    if (!key) { fs.rmSync(experimentalKeyFile(), { force: true }); return }
    if (!safeStorage.isEncryptionAvailable()) return
    fs.writeFileSync(experimentalKeyFile(), Buffer.concat([Buffer.from('E1'), safeStorage.encryptString(String(key))]))
  } catch {}
}

// 逐字数据源白名单：删除某个源后（如历史版本的 lrclib），
// 老用户 prefs 里的残留 id 不能带进设置面板，否则序号错乱 / 出现幽灵源。
const SYLLABLE_SOURCE_IDS = ['amll', 'liriqo', 'kugou', 'netease', 'qq']
const cleanSyllableSources = (list) => {
  const out = Array.isArray(list) ? list.filter((s) => SYLLABLE_SOURCE_IDS.includes(s)) : []
  return out.length ? out : [...SYLLABLE_SOURCE_IDS]
}

// 速度带挡位白名单：与 electron/lyricsMerge.mjs 的 SMOOTH_SPREAD 保持一致。
const SYLLABLE_SMOOTH_IDS = ['mild', 'normal', 'strong']
const cleanSyllableSmooth = (v) => (SYLLABLE_SMOOTH_IDS.includes(v) ? v : 'normal')

const experimentalDefaults = () => ({
  enabled: false,
  sourceEnabled: true,
  aiFallback: true,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  hasKey: false,
  syllables: false,
  syllablePredict: false,
  syllableSources: ['amll', 'liriqo', 'kugou', 'netease', 'qq'],
  // 严格匹配：默认关闭。关闭时对逐字时间轴做速度带平滑（视觉匀速），开启时逐字严格照抄源时间戳。
  syllableStrict: false,
  // 速度带挡位（仅在非严格时生效）：mild 宽松 / normal 适中 / strong 更匀。
  syllableSmooth: 'normal',
})

function experimentalRead() {
  const p = readPrefs()
  const e = { ...experimentalDefaults(), ...(p.experimental || {}) }
  return {
    enabled: !!e.enabled,
    sourceEnabled: e.sourceEnabled !== false,
    aiFallback: e.aiFallback !== false,
    baseUrl: e.baseUrl || 'https://api.deepseek.com/v1',
    model: e.model || 'deepseek-chat',
    hasKey: !!readExperimentalKey(),
    syllables: !!e.syllables,
    syllablePredict: !!e.syllablePredict,
    syllableSources: cleanSyllableSources(e.syllableSources),
    syllableStrict: !!e.syllableStrict,
    syllableSmooth: cleanSyllableSmooth(e.syllableSmooth),
  }
}

function experimentalWrite(patch) {
  const cur = experimentalRead()
  const next = {
    enabled: patch.enabled === undefined ? cur.enabled : !!patch.enabled,
    sourceEnabled: patch.sourceEnabled === undefined ? cur.sourceEnabled : !!patch.sourceEnabled,
    aiFallback: patch.aiFallback === undefined ? cur.aiFallback : !!patch.aiFallback,
    baseUrl: String(patch.baseUrl ?? cur.baseUrl ?? '').trim(),
    model: String(patch.model ?? cur.model ?? '').trim(),
    syllables: patch.syllables === undefined ? cur.syllables : !!patch.syllables,
    syllablePredict: patch.syllablePredict === undefined ? cur.syllablePredict : !!patch.syllablePredict,
    syllableSources: patch.syllableSources === undefined ? cur.syllableSources : cleanSyllableSources(patch.syllableSources),
    syllableStrict: patch.syllableStrict === undefined ? cur.syllableStrict : !!patch.syllableStrict,
    syllableSmooth: patch.syllableSmooth === undefined ? cur.syllableSmooth : cleanSyllableSmooth(patch.syllableSmooth),
  }
  if (patch.apiKey !== undefined) writeExperimentalKey(String(patch.apiKey || '').trim())
  writePrefs({ ...readPrefs(), experimental: next })
  return experimentalRead()
}

// ---------- 源站译词（网易云） ----------
// 与 fnlrc 一致：源站已有 tlyric 时优先使用；只把缺失译文交给 AI 补。
const NE_LYRICS_UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Referer: 'https://music.163.com/',
}
const NE_LYRICS_SEARCH_URLS = [
  'https://music.163.com/api/search/get',
  'https://music.163.com/api/search/get/web',
]
const NE_LYRICS_TIMEOUT = 12000
const NE_LYRICS_DURATION_TOLERANCE = 10
const NE_LYRICS_SEARCH_LIMIT = 8
let neLastRequestAt = 0

const normalizeText = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const baseTitle = (title) => {
  let s = String(title || '').trim()
  const noise = [
    /(?:\s*[([（【][^)\]）】]{0,24}?(?:\bsize\b|\bver\b\.?|\bversion\b|\bedit\b\.?|\bmix\b|\bcut\b|\bremaster(?:ed)?\b(?:\s*\d{4})?)\s*[)\]）】])/gi,
    /(?:\s*[-–—]\s*(?:remaster(?:ed)?(?:\s*\d{4})?|(?:short|tv|original)\s*(?:ver\.?|version|size|mix))\s*$)/gi,
  ]
  for (let i = 0; i < 3; i++) {
    const before = s
    for (const re of noise) s = s.replace(re, '').trim()
    s = s.replace(/^[\s\-–—_:·]+|[\s\-–—_:·]+$/g, '')
    if (s === before) break
  }
  return s || String(title || '').trim()
}
const textSimilarity = (a, b) => {
  a = normalizeText(a)
  b = normalizeText(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) {
    const short = a.length <= b.length ? a : b
    const long = a.length <= b.length ? b : a
    return 0.75 + 0.25 * (short.length / long.length)
  }
  const max = Math.max(a.length, b.length)
  const seen = new Array(b.length + 1)
  for (let i = 0; i <= a.length; i++) {
    let prev = i
    for (let j = 0; j <= b.length; j++) {
      const old = seen[j] ?? j
      if (i && j) seen[j] = a[i - 1] === b[j - 1] ? seen[j - 1] : Math.min(seen[j - 1], prev, old) + 1
      else seen[j] = i || j
      prev = old
    }
  }
  return Math.max(0, 1 - (seen[b.length] || 0) / Math.max(max, 1))
}
const titleSimilarity = (query, candidate) => {
  const q = normalizeText(baseTitle(query))
  const c = normalizeText(baseTitle(candidate))
  if (!q || !c) return 0
  if (q === c) return 1
  if (q.includes(c) || c.includes(q)) {
    const short = q.length <= c.length ? q : c
    const long = q.length <= c.length ? c : q
    return short.length < 4 ? 0 : 0.75 + 0.25 * (short.length / long.length)
  }
  if (q.length < 4 || c.length < 4) return 0
  return textSimilarity(q, c)
}
const artistSimilarity = (a, b) => textSimilarity(a, b)
const versionPenalty = (query, candidate) => {
  const qm = new Set((String(query || '').match(/live|cover(?:ed)?|remix|acoustic|unplugged|instrumental|off ?vocal|piano ?version|karaoke|カラオケ|伴奏|纯音乐|纯音|演奏|翻唱|翻自/gi) || []).map((x) => x.toLowerCase()))
  const cm = new Set((String(candidate || '').match(/live|cover(?:ed)?|remix|acoustic|unplugged|instrumental|off ?vocal|piano ?version|karaoke|カラオケ|伴奏|纯音乐|纯音|演奏|翻唱|翻自/gi) || []).map((x) => x.toLowerCase()))
  return [...cm].some((x) => !qm.has(x)) ? -2.5 : 0
}
const durationOk = (candidateMs, duration) => !candidateMs || !duration || Math.abs(candidateMs / 1000 - duration) <= NE_LYRICS_DURATION_TOLERANCE
const songScore = (candidate, title, artist, duration) => {
  const candTitle = candidate?.name || ''
  const artists = Array.isArray(candidate?.artists) ? candidate.artists.map((a) => a?.name || '').join('/') : ''
  const durMs = Number(candidate?.duration || candidate?.dt || 0)
  let score = 3 * titleSimilarity(title, candTitle) + 2 * artistSimilarity(artists, artist)
  if (durMs && duration) {
    const diff = Math.abs(durMs / 1000 - duration)
    score += diff <= 3 ? 3 : diff <= 8 ? 1.5 : -1.5
  }
  return { score: score + versionPenalty(title, candTitle), artists, durMs }
}
const CREDIT_RE = /^(作词|作曲|编曲|制作人|混音|母带|录音|和声|监制|出品|企划|翻译|校对|字幕|歌词|伴奏|吉他|贝斯|鼓|键盘|弦乐|制作|词曲|produced by|written by|composed by|lyrics by|music by|arranged by|mixed by|mastered by|recorded by|vocal|guitar|bass|drum|piano|strings|engineer|studio|op :|sp :|ed :)/i
const parseTimestamp = (m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number((m[3] + '000').slice(0, 3)) / 1000 : 0)
function parseLrcEntries(text) {
  const out = []
  for (const raw of String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const content = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim().replace(/^[|｜]+|[|｜]+$/g, '').trim()
    if (!content || CREDIT_RE.test(content)) continue
    for (const m of stamps) out.push({ ms: Math.round(parseTimestamp(m) * 1000), text: content })
  }
  const seen = new Set()
  return out.filter((x) => {
    const key = `${x.ms}\u0000${x.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.ms - b.ms)
}
const detectTextLang = (text) => {
  const s = String(text || '')
  if (/[\u3040-\u30ff]/.test(s)) return 'ja'
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(s)) return 'ko'
  const letters = [...s].filter((c) => /\p{L}/u.test(c))
  if (!letters.length) return 'unknown'
  const n = letters.length
  if ((s.match(/[\u3400-\u9fff]/g) || []).length / n > 0.5) return 'zh'
  if ((s.match(/[\u0400-\u04ff]/g) || []).length / n > 0.3) return 'ru'
  if ((s.match(/[A-Za-z]/g) || []).length / n > 0.5) return 'latin'
  return 'other'
}
async function neThrottle() {
  const wait = 350 - (Date.now() - neLastRequestAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  neLastRequestAt = Date.now()
}
async function neJson(url, { method = 'GET', data } = {}) {
  await neThrottle()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), NE_LYRICS_TIMEOUT)
  try {
    const res = await net.fetch(url, {
      method,
      headers: data ? { ...NE_LYRICS_UA, 'Content-Type': 'application/x-www-form-urlencoded' } : NE_LYRICS_UA,
      body: data ? new URLSearchParams(data).toString() : undefined,
      signal: ctl.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
async function neSearch(query) {
  for (const url of NE_LYRICS_SEARCH_URLS) {
    const d = await neJson(url, { method: 'POST', data: { s: query, type: 1, offset: 0, limit: NE_LYRICS_SEARCH_LIMIT } })
    const songs = d?.result?.songs
    if (Array.isArray(songs) && songs.length) return songs
  }
  return []
}
async function neLyric(songId) {
  const d = await neJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=1&rv=1`)
  return {
    lrc: d?.lrc?.lyric || '',
    tlyric: d?.tlyric?.lyric || '',
    romalrc: d?.romalrc?.lyric || '',
    nolyric: !!d?.nolyric,
  }
}
function pickTranslation(candidates, original) {
  const pool = (candidates || []).filter((x) => String(x || '').trim() && normalizeText(x) !== normalizeText(original))
  if (!pool.length) return ''
  const origLang = detectTextLang(original)
  const score = (text) => {
    const lang = detectTextLang(text)
    const roman = origLang !== 'latin' && lang === 'latin'
    const sameLang = lang === origLang
    return (roman ? 10 : 0) + (sameLang ? 2 : 0) - Math.min(String(text).length, 80) / 1000
  }
  return pool.sort((a, b) => score(a) - score(b))[0]
}
async function fetchNeteaseTranslation({ title, artist, album, duration }) {
  title = String(title || '').trim()
  artist = String(artist || '').trim()
  if (!title) return { ok: false, error: '缺少歌曲名' }
  const base = baseTitle(title)
  const queries = [`${title} ${artist}`.trim(), title, `${artist} ${title}`.trim()]
  if (base && normalizeText(base) !== normalizeText(title)) queries.push(artist ? `${base} ${artist}` : base)
  const seen = new Set()
  const candidates = []
  for (const q of queries) {
    if (!q) continue
    const songs = await neSearch(q)
    for (const song of songs) {
      const id = song?.id
      if (!id || seen.has(id)) continue
      seen.add(id)
      const meta = songScore(song, title, artist, duration)
      if (durationOk(meta.durMs, duration)) candidates.push({ song, ...meta })
    }
    if (candidates.some((x) => x.score >= 6.5)) break
  }
  candidates.sort((a, b) => b.score - a.score)
  if (!candidates.length) return { ok: false, error: '网易云没有找到匹配歌曲' }
  let best = null
  for (const cand of candidates.slice(0, 5)) {
    if (cand.score < 4) break
    const lyric = await neLyric(cand.song.id)
    if (!lyric.lrc || lyric.nolyric) continue
    const originals = parseLrcEntries(lyric.lrc)
    if (!originals.length) continue
    const translations = parseLrcEntries(lyric.tlyric)
    const romans = parseLrcEntries(lyric.romalrc)
    const assigned = new Set()
    const trustedTranslations = translations.map((row) => ({ ...row, owner: -1, delta: Infinity }))
    originals.forEach((orig, i) => {
      let best = null
      trustedTranslations.forEach((trans, j) => {
        if (assigned.has(j)) return
        const d = Math.abs(trans.ms - orig.ms)
        if (d <= 500 && (!best || d < best.d)) best = { d, j }
      })
      if (best) {
        assigned.add(best.j)
        trustedTranslations[best.j].owner = i
        trustedTranslations[best.j].delta = best.d
      }
    })
    const byMs = new Map()
    trustedTranslations.forEach((row) => {
      const key = row.owner >= 0 ? originals[row.owner].ms : row.ms
      if (!byMs.has(key)) byMs.set(key, [])
      byMs.get(key).push(row.text)
    })
    const romanByMs = new Map()
    for (const row of romans) if (!romanByMs.has(row.ms)) romanByMs.set(row.ms, row.text)
    const lines = originals.map((row) => {
      const exact = byMs.get(row.ms)
      let candidates = exact || []
      if (!exact?.length) {
        let near = null
        for (const [ms, vals] of byMs) {
          const d = Math.abs(ms - row.ms)
          if (d <= 300 && (!near || d < near.d)) near = { d, vals }
        }
        candidates = near?.vals || []
      }
      return { ms: row.ms, text: row.text, translation: pickTranslation(candidates, row.text), roman: romanByMs.get(row.ms) || '' }
    })
    const hasTranslation = lines.some((x) => x.translation)
    const info = {
      source: 'netease',
      matched: `${cand.song.name || ''} / ${cand.artists}`.trim(),
      score: Number(cand.score.toFixed(2)),
      songId: cand.song.id,
      lyricLang: detectTextLang(lines.map((x) => x.text).join(' ')),
      hasTranslation,
      lines,
    }
    if (!best || (hasTranslation && !best.hasTranslation) || ((hasTranslation === best.hasTranslation) && info.score > best.score)) best = info
    if (hasTranslation && cand.score >= 6.5) break
  }
  return best ? { ok: true, ...best } : { ok: false, error: '网易云找到了歌曲，但没有可用歌词或译文' }
}

const REMOTE_ERR = {
  400: '请求被拒绝（模型名或参数不对）',
  401: 'API key 无效或已过期',
  402: '账户余额不足',
  403: '无权访问该模型',
  404: 'Base URL 或模型名不存在',
  429: '触发限流，请稍后重试',
}


function remoteUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写 Base URL')
  return base.endsWith('/chat/completions') ? base : base + '/chat/completions'
}

function parseNumbered(text) {
  const out = {}
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*[*\-\s]*(\d{1,4})\s*[|｜:：.)、]\s*(.*?)\s*$/.exec(raw)
    if (!m) continue
    const text = m[2].trim().replace(/^[|｜]+|[|｜]+$/g, '')
    if (text) out[+m[1]] = text
  }
  return out
}

function buildTranslatePrompt({ title, artist, body, context }) {
  return `你是专业的歌词翻译，把下面每一行歌词翻译成简体中文。\n${title ? `歌曲：${title}\n` : ''}${artist ? `艺人：${artist}\n` : ''}规则：\n1. 先把整段当成连贯的歌词语境来理解，再逐行输出。输入有多少行，输出就必须有多少行，编号一一对应，不要合并或拆分。\n2. 连续几行可能是同一句话：请按整句理解，再把译文拆回对应的每一行，保证每行都有内容、句意连贯。\n3. 只输出 "编号|译文"，不要输出原文、解释或任何多余的内容。\n4. 不要增译：译文里不能出现原文没有的词句。宁可简短，也不许自己加戏。\n5. 拟声词、语气词、无实义的重复保留原文或音译，不要硬翻成中文。\n6. 译文要符合歌词语气：口语、自然、简短，尽量能唱。人名/专有名词用常见译法。\n${context ? `整首歌的完整歌词如下，仅供你理解语境；要翻译的只是最后的输入：\n${context}\n\n` : ''}输入：\n${body}`
}

async function remoteTranslate(lines, settings, deadlineMs = 180000) {
  const { baseUrl, model } = settings
  const key = settings.useApiKeyOverride && settings.apiKey !== undefined ? String(settings.apiKey || '') : readExperimentalKey()
  if (!baseUrl || !model) return { ok: false, error: '还没填 Base URL 或模型名' }
  const url = remoteUrl(baseUrl)
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = 'Bearer ' + key
  const out = {}
  let firstErr = ''
  const chunk = 30
  const deadline = Date.now() + deadlineMs
  const deepSeek = /(^|\.)deepseek\./i.test(new URL(baseUrl).hostname)
  for (let start = 0; start < lines.length; start += chunk) {
    if (Date.now() >= deadline) { firstErr ||= '翻译超出单曲时限（未翻完）'; break }
    const part = lines.slice(start, start + chunk)
    const body = part.map((v, i) => `${i + 1}|${v}`).join('\n')
    const payload = {
      model,
      messages: [{ role: 'user', content: buildTranslatePrompt({ title: settings.title, artist: settings.artist, body, context: settings.context }) }],
      temperature: 0.1,
      stream: false,
      max_tokens: 4096,
      ...(deepSeek ? { thinking: { type: 'disabled' } } : {}),
    }
    let blockErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() >= deadline) break
      try {
        const res = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
        const text = await res.text()
        let json = null
        try { json = JSON.parse(text) } catch {}
        if (res.status >= 200 && res.status < 300) {
          const content = json?.choices?.[0]?.message?.content || ''
          Object.assign(out, Object.fromEntries(Object.entries(parseNumbered(content)).filter(([i]) => +i >= 1 && +i <= part.length).map(([i, v]) => [start + +i, v])))
          blockErr = null
          break
        }
        const detail = json?.error?.message || json?.message || text.slice(0, 160)
        blockErr = `${REMOTE_ERR[res.status] || `服务端返回 HTTP ${res.status}`}${detail ? '｜' + detail : ''}`
        if ([400, 401, 402, 403, 404].includes(res.status)) break
      } catch (e) {
        blockErr = `连不上翻译端点：${e.message}`
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
    if (blockErr) { firstErr ||= blockErr; if (/API key|无权|余额|Base URL|模型名/.test(blockErr)) break }
  }
  const translations = lines.map((_, i) => out[i + 1] || '')
  return Object.keys(out).length ? { ok: true, translations } : { ok: false, error: firstErr || '模型没有返回可解析的译文' }
}

// ---------- 主窗口、托盘与悬浮球 ----------
let mainWindow = null
let tray = null
let ball = null
let lyricsWin = null
let mainHidden = false // 主窗口被用户隐藏到托盘或最小化（启动时窗口还没显示出来不算）
let quitting = false // 为 true 时关闭窗口即退出，不再最小化到托盘

// 关闭窗口时最小化到托盘：Windows 默认开启，可在账户菜单或托盘菜单中关闭
const closeToTray = () => readPrefs().closeToTray ?? process.platform === 'win32'

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { mainWindow = createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function quitApp() {
  quitting = true
  app.quit()
}

// 播放控制命令统一由主窗口的渲染进程执行（播放器在那里）
const playerCommand = (cmd, arg) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('player:command', cmd, arg)

// 悬浮球显示方式：always 始终显示｜hidden 主窗口隐藏或最小化时显示（默认）｜off 关闭
const ballMode = () => (BALL_MODES.some(([m]) => m === readPrefs().ballMode) ? readPrefs().ballMode : 'hidden')
function setBallMode(mode) {
  writePrefs({ ...readPrefs(), ballMode: mode })
  syncBall()
  tray?.refresh()
}
function syncBall() {
  if (!ball) return
  const mode = ballMode()
  ball.setVisible(!quitting && (mode === 'always' || (mode === 'hidden' && mainHidden)))
}

// 打开主窗口里的“悬浮歌词样式”面板。主窗口可能是刚重建的，页面还没就绪，
// 所以幂等重发几次（重复打开是幂等的，不会闪烁或叠加）。
function openLyricsSettings() {
  showMainWindow()
  const send = () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('lyrics:open-settings')
  send()
  setTimeout(send, 400)
  setTimeout(send, 1200)
}

// 悬浮歌词：开关状态持久化在 prefs.lyricsOn；样式存在 prefs.lyricsStyle，位置存在 prefs.lyrics
const lyricsOn = () => readPrefs().lyricsOn === true
function setLyricsOn(on) {
  writePrefs({ ...readPrefs(), lyricsOn: !!on })
  syncLyrics()
  tray?.refresh()
  // 通知主窗口渲染进程：悬浮歌词可能在浮窗 / 托盘 / 右键菜单里被开关，播放栏按钮需要同步状态
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lyrics:on-changed', !!on)
}
function syncLyrics() {
  if (!lyricsWin) return
  lyricsWin.setVisible(!quitting && lyricsOn())
}
// 托盘菜单里显示的当前歌曲封面（从封面磁盘缓存读取）
async function coverImage(coverId) {
  if (!covers || !state.base) return null
  const r = await covers.get(coverKey(state.base, coverId, 160), `${state.base}/api/v1/static/cover?coverId=${encodeURIComponent(coverId)}&size=160`)
  if (r.status !== 200) return null
  const src = nativeImage.createFromBuffer(r.body) // SVG 等格式无法解码时为空
  if (src.isEmpty()) return null
  const img = src.resize({ width: 16, height: 16, quality: 'best' })
  img.addRepresentation({ scaleFactor: 2, width: 16, height: 16, buffer: src.resize({ width: 32, height: 32, quality: 'best' }).toPNG() })
  return img
}

function loadPage(win, page) {
  if (isDev) win.loadURL(`http://localhost:5173/${page}`)
  else win.loadFile(path.join(__dirname, '..', 'dist', page))
}

function setupBall() {
  ball = createBall({
    preload: path.join(__dirname, 'ballPreload.js'),
    load: (win) => loadPage(win, 'ball.html'),
    readPrefs,
    writePrefs,
    command: playerCommand,
    showMain: showMainWindow,
    menu: () => [
      { label: '显示飞牛音乐', click: showMainWindow },
      { type: 'separator' },
      { label: '悬浮球', submenu: BALL_MODES.map(([mode, label]) => ({ label, type: 'radio', checked: ballMode() === mode, click: () => setBallMode(mode) })) },
      { label: '隐藏悬浮球', click: () => setBallMode('off') },
      { type: 'separator' },
      { label: '退出', click: quitApp },
    ],
  })
  syncBall()
}

function setupLyrics() {
  lyricsWin = createLyrics({
    preload: path.join(__dirname, 'lyricsPreload.js'),
    menuPreload: path.join(__dirname, 'lyricsMenuPreload.js'),
    load: (win) => loadPage(win, 'lyrics.html'),
    readPrefs,
    writePrefs,
    command: playerCommand,
    openSettings: openLyricsSettings,
    onClose: () => setLyricsOn(false),
    onStyleChanged: () => tray?.refresh(),
    menu: () => {
      const s = readPrefs().lyricsStyle || {}
      return [
        // 这个菜单本来就挂在悬浮歌词窗口上，不需要再放“显示悬浮歌词”开关。
        { label: '竖排显示', type: 'checkbox', checked: !!s.vertical, click: (it) => setLyricsStyle({ vertical: it.checked }) },
        { label: '显示翻译', type: 'checkbox', checked: s.showTranslation !== false, click: (it) => setLyricsStyle({ showTranslation: it.checked }) },
        { label: '显示下一句', type: 'checkbox', checked: !!s.showNext, click: (it) => setLyricsStyle({ showNext: it.checked }) },
        { label: '鼠标穿透', type: 'checkbox', checked: !!s.clickThrough, click: (it) => setLyricsStyle({ clickThrough: it.checked }) },
        { type: 'separator' },
        { label: '歌词样式…', click: openLyricsSettings },
        { label: '重置位置', click: () => lyricsWin?.resetPosition() },
        { type: 'separator' },
        { label: '关闭悬浮歌词', click: () => setLyricsOn(false) },
      ]
    },
  })
  syncLyrics()
}

// 更新悬浮歌词样式（浅合并）；点击穿透等变化即时生效
// 窗口实例负责规范化并写盘，写完后通过 onStyleChanged 刷新托盘
function setLyricsStyle(patch) {
  const merged = { ...(readPrefs().lyricsStyle || {}), ...patch }
  if (lyricsWin) lyricsWin.setStyle(merged)
  else {
    writePrefs({ ...readPrefs(), lyricsStyle: merged })
    tray?.refresh()
  }
}
function setupTray() {
  try {
    tray = createTray({
      show: showMainWindow,
      command: playerCommand,
      getCloseToTray: closeToTray,
      setCloseToTray: (on) => writePrefs({ ...readPrefs(), closeToTray: on }),
      getBallMode: ballMode,
      setBallMode,
      getLyricsOn: lyricsOn,
      setLyricsOn,
      openLyricsSettings,
      coverImage,
      quit: quitApp,
    })
  } catch (e) {
    // 某些 Linux 桌面没有托盘区域，此时关闭窗口就直接退出
    console.error('[tray] 创建失败：', e.message)
  }
}

// ---------- 独立账号：用户名密码登录 ----------
async function passwordLogin(base, username, password, deviceId) {
  const { status, json } = await apiFetch(base, '/api/v1/user/password-login', {
    method: 'POST',
    body: { username, password: sha256(password), deviceId },
  })
  if (!json) {
    if (status >= 500) throw new Error('服务器拒绝了密码登录。fnOS 系统账号请改用「使用 NAS 账号登录」')
    throw new Error(`服务器响应异常（HTTP ${status}），请确认地址是否正确`)
  }
  if (json.code !== 0) throw new Error(json.msg && !/please login again/i.test(json.msg) ? json.msg : '用户名或密码错误。fnOS 系统账号请改用「使用 NAS 账号登录」')
  const token = json.data && json.data.userToken
  if (!token) throw new Error('登录失败：服务器未返回凭证')
  return { token, deviceId: (json.data && json.data.deviceId) || deviceId }
}

// ---------- NAS 账号：OAuth 授权登录 ----------
async function getOAuthUrl(base) {
  const { json } = await apiFetch(base, '/api/v1/sys/config')
  if (!json || json.code !== 0) throw new Error('无法读取服务器配置，请确认地址是否为飞牛 NAS')
  const cfg = json.data || {}
  const clientId = cfg.nasOAuth && cfg.nasOAuth.clientId
  if (!clientId) throw new Error('该服务器未开启 NAS 账号登录，请使用飞牛音乐独立账号')
  const origin = new URL(base).origin
  const signinBase = ((cfg.nasOAuth && cfg.nasOAuth.url) || origin).replace(/\/+$/, '')
  trustHost(signinBase)
  const redirect = base + '/oauth/result'
  const url = `${signinBase}/signin?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&app_name=${encodeURIComponent('飞牛音乐')}`
  return { url, redirect, serverName: cfg.serverName || '' }
}

/**
 * 打开 fnOS 官方登录页，等待其重定向到 redirect 并截获授权码。
 * silent=true 时窗口不显示，仅在 fnOS 仍处于登录状态（Cookie 有效）时能自动完成，用于 token 过期后的静默续期。
 */
function runOAuthWindow(url, redirect, { parent, silent = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent: silent ? undefined : parent,
      modal: !silent && !!parent,
      show: false,
      width: 460,
      height: 640,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: '登录 fnOS',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
      webPreferences: { partition: OAUTH_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    let done = false
    let timer = null
    const finish = (err, code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      err ? reject(err) : resolve(code)
    }
    const check = (e, target) => {
      if (!target || !target.startsWith(redirect)) return
      e?.preventDefault?.()
      const q = new URL(target).searchParams
      if (q.get('error')) finish(new Error('授权被拒绝或失败：' + q.get('error')))
      else if (q.get('code')) finish(null, q.get('code'))
      else finish(new Error('授权未返回授权码'))
    }
    const wc = win.webContents
    wc.on('will-redirect', (e, u) => check(e, u))
    wc.on('will-navigate', (e, u) => check(e, u))
    wc.on('did-navigate', (_e, u) => check(null, u))
    wc.on('did-redirect-navigation', (_e, u) => check(null, u))
    wc.setWindowOpenHandler(({ url: u }) => {
      if (/^https?:/i.test(u)) shell.openExternal(u)
      return { action: 'deny' }
    })
    // 静默模式：登录页已加载完却迟迟没有跳转，说明 fnOS 需要重新输入账号，尽快放弃
    if (silent) {
      wc.on('did-finish-load', () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(new Error('fnOS 登录已过期')), 6000)
      })
    }
    wc.on('did-fail-load', (_e, codeNum, desc, failedUrl, isMain) => {
      if (isMain && !failedUrl.startsWith(redirect) && codeNum !== -3) finish(new Error('无法打开 fnOS 登录页：' + desc))
    })
    win.on('closed', () => finish(new Error('已取消登录')))
    if (!silent) win.once('ready-to-show', () => !done && win.show())
    if (timeout) timer = setTimeout(() => finish(new Error('授权超时')), timeout)
    win.loadURL(url).catch(() => {})
  })
}

async function exchangeCode(base, code, deviceId) {
  const { status, json } = await apiFetch(base, '/api/v1/user/auth-login', { method: 'POST', body: { code, deviceId } })
  if (!json) throw new Error(`授权登录失败（HTTP ${status}）`)
  if (json.code !== 0) throw new Error(json.msg || '授权登录失败')
  const data = json.data || {}
  if (!data.userToken) throw new Error('授权登录失败：服务器未返回凭证')
  const user = data.user || {}
  return { token: data.userToken, username: user.username || user.nickname || user.name || 'NAS 用户' }
}

async function nasLogin(base, deviceId, opts) {
  const { url, redirect } = await getOAuthUrl(base)
  const code = await runOAuthWindow(url, redirect, opts)
  return exchangeCode(base, code, deviceId)
}

// token 失效时的静默续期，并发请求共享同一次
let reloginInFlight = null
function relogin() {
  if (!reloginInFlight) {
    const run = async () => {
      if (!state.deviceId) state.deviceId = newDeviceId()
      if (state.mode === 'password') {
        if (!state.password) throw new Error('无已保存的密码')
        const r = await passwordLogin(state.base, state.username, state.password, state.deviceId)
        state.token = r.token
        state.deviceId = r.deviceId
      } else {
        const r = await nasLogin(state.base, state.deviceId, { silent: true, timeout: 15000 })
        state.token = r.token
        state.username = r.username
      }
      saveSession()
      return true
    }
    reloginInFlight = run().finally(() => { reloginInFlight = null })
  }
  return reloginInFlight
}

// ---------- 自定义图片（壁纸 / 悬浮歌词背景） ----------
// 选中的图片复制到 userData/<目录>/，原图被移动或删除也不影响；渲染进程通过 IPC 取回字节生成 blob URL。
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' }
const IMAGE_MAX = 40 * 1024 * 1024
const imageDir = (name) => path.join(app.getPath('userData'), name)
function imageFile(name, basename) {
  try {
    const dir = imageDir(name)
    const file = fs.readdirSync(dir).find((f) => new RegExp(`^${basename}\\.\\w+$`).test(f))
    return file ? path.join(dir, file) : null
  } catch { return null }
}
async function chooseImage(win, { title, dir, basename }) {
  const r = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: Object.keys(IMAGE_TYPES) }],
  })
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true }
  const src = r.filePaths[0]
  const ext = path.extname(src).slice(1).toLowerCase()
  if (!IMAGE_TYPES[ext]) return { ok: false, error: '不支持的图片格式' }
  if (fs.statSync(src).size > IMAGE_MAX) return { ok: false, error: '图片太大（超过 40 MB）' }
  const target = imageDir(dir)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  fs.copyFileSync(src, path.join(target, `${basename}.${ext}`))
  return { ok: true }
}
function readImage(name, basename) {
  const f = imageFile(name, basename)
  if (!f) return null
  try { return { data: fs.readFileSync(f), type: IMAGE_TYPES[path.extname(f).slice(1).toLowerCase()] } } catch { return null }
}
const wallpaperDir = () => imageDir('wallpaper')
const lyricsBackgroundDir = () => imageDir('lyrics-background')
const chooseWallpaper = (win) => chooseImage(win, { title: '选择壁纸', dir: 'wallpaper', basename: 'wallpaper' })
const chooseLyricsBackground = (win) => chooseImage(win, { title: '选择悬浮歌词背景图片', dir: 'lyrics-background', basename: 'background' })

// ---------- 封面磁盘缓存 ----------
let covers = null
let syllableCache = null
const signedGet = async (url) => {
  const headers = { authx: authx('GET', url) }
  if (state.token) headers.Cookie = `music-token=${state.token}`
  // 封面体积小，读完整包再返回，超时覆盖响应头 + 响应体；卡住的请求会被中止，释放连接槽
  const { signal, clear } = abortAfter(TIMEOUT.cover)
  try {
    const res = await net.fetch(url, { headers, bypassCustomProtocolHandlers: true, signal })
    const body = Buffer.from(await res.arrayBuffer())
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  } finally {
    clear()
  }
}
const proxyError = (e) => new Response(JSON.stringify({ code: -1, msg: '无法连接服务器：' + e.message }), {
  status: 502,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
})

async function serveCover(u, target) {
  try {
    const q = u.searchParams
    const r = await covers.get(coverKey(state.base, q.get('coverId') || '', q.get('size') || ''), target)
    const headers = { 'content-type': r.type || 'application/octet-stream', 'access-control-allow-origin': '*', 'x-fnm-cache': r.source }
    if (r.status === 200) headers['cache-control'] = 'public, max-age=604800'
    return new Response(r.body, { status: r.status, headers })
  } catch (e) {
    return proxyError(e)
  }
}

// ---------- fnm:// 协议代理 ----------
function registerProxy() {
  protocol.handle('fnm', async (request) => {
    if (!state.base) return new Response('not configured', { status: 503 })
    const u = new URL(request.url)
    const target = state.base + u.pathname + u.search
    if (covers && request.method === 'GET' && u.pathname === '/api/v1/static/cover') return serveCover(u, target)
    const headers = new Headers()
    for (const h of ['range', 'content-type', 'accept', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(h)
      if (v) headers.set(h, v)
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const body = hasBody ? await request.arrayBuffer() : undefined
    headers.set('authx', authx(request.method, target, body && new Uint8Array(body)))
    if (state.token) headers.set('Cookie', `music-token=${state.token}`)
    // 普通接口：超时覆盖到读完整包。音频流特殊处理——响应头阶段超时；拿到响应头后
    // 改为“数据空闲超时”，并把下游取消（切歌 / 换源）传播给上游，避免失效歌曲的死流
    // 永久占住 Chromium 对同一主机的连接池，拖垮其它所有请求。
    const isStream = u.pathname === '/api/v1/track/stream'
    if (isStream) {
      const controller = new AbortController()
      const headerTimer = setTimeout(() => controller.abort(new Error('音频流响应超时')), TIMEOUT.stream)
      try {
        const upstream = await net.fetch(target, { method: request.method, headers, body, bypassCustomProtocolHandlers: true, signal: controller.signal })
        clearTimeout(headerTimer)
        const out = new Headers(upstream.headers)
        out.set('access-control-allow-origin', '*')
        out.delete('content-encoding')
        const stream = streamWithIdle(upstream.body, { idleMs: TIMEOUT.streamIdle, abort: (reason) => controller.abort(reason) })
        return new Response(stream, { status: upstream.status, statusText: upstream.statusText, headers: out })
      } catch (e) {
        clearTimeout(headerTimer)
        return proxyError(e)
      }
    }
    const { signal, clear } = abortAfter(TIMEOUT.api)
    try {
      const upstream = await net.fetch(target, { method: request.method, headers, body, bypassCustomProtocolHandlers: true, signal })
      const out = new Headers(upstream.headers)
      out.set('access-control-allow-origin', '*')
      out.delete('content-encoding')
      const buf = Buffer.from(await upstream.arrayBuffer())
      return new Response(buf, { status: upstream.status, statusText: upstream.statusText, headers: out })
    } catch (e) {
      return proxyError(e)
    } finally {
      clear()
    }
  })
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('auth:restore', async () => {
    if (!loadSession() || !state.base || !state.token) return { ok: false }
    const ok = { ok: true, username: state.username, server: state.base, mode: state.mode }
    try {
      const { json } = await apiFetch(state.base, '/api/v1/user/me', { token: state.token })
      if (json && json.code === 0) return ok
      await relogin()
      return { ...ok, username: state.username }
    } catch (e) {
      console.error('[auth:restore] 续期失败：', e.message)
      // 续期失败（例如 fnOS 登录已过期）→ 回到登录页；网络不可达时仍进入应用
      if (/ERR_|fetch failed/i.test(e.message)) return { ...ok, offline: true, error: e.message }
      return { ok: false, error: '登录已过期，请重新登录' }
    }
  })

  ipcMain.handle('auth:server-info', async (_e, { server }) => {
    try {
      const base = normalizeBase(server)
      if (!base) throw new Error('请输入服务器地址')
      trustHost(base)
      const { json, status, text, type } = await apiFetch(base, '/api/v1/sys/config')
      if (!json || json.code !== 0) {
        console.error('[auth:server-info]', base, status, type, text.slice(0, 200))
        throw new Error(`该地址不是飞牛音乐服务（HTTP ${status}，${type || '无类型'}：${text.slice(0, 80).replace(/\s+/g, ' ')}）`)
      }
      const d = json.data || {}
      return { ok: true, serverName: d.serverName || '', version: d.serverVersion || '', nasLogin: !!(d.nasOAuth && d.nasOAuth.clientId) }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })

  ipcMain.handle('auth:login', async (e, { server, username, password, mode }) => {
    try {
      const base = normalizeBase(server)
      if (!base) throw new Error('请输入服务器地址')
      trustHost(base)
      const deviceId = newDeviceId()
      if (mode === 'password') {
        if (!username) throw new Error('请输入用户名')
        const r = await passwordLogin(base, username, password, deviceId)
        Object.assign(state, { base, mode: 'password', username, password, token: r.token, deviceId: r.deviceId })
      } else {
        const r = await nasLogin(base, deviceId, { parent: BrowserWindow.fromWebContents(e.sender) })
        Object.assign(state, { base, mode: 'nas', username: r.username, password: '', token: r.token, deviceId })
      }
      saveSession()
      return { ok: true, username: state.username, server: base, mode: state.mode }
    } catch (err) {
      return { ok: false, error: friendlyError(err), cancelled: err.message === '已取消登录' }
    }
  })

  ipcMain.handle('auth:relogin', async () => {
    try { await relogin(); return { ok: true } } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('auth:logout', async () => {
    try { if (state.base && state.token) await apiFetch(state.base, '/api/v1/user/logout', { method: 'POST', body: {}, token: state.token }) } catch {}
    await clearSession()
    return true
  })

  ipcMain.handle('covers:stats', () => covers?.init().then(() => covers.stats()) ?? { count: 0, bytes: 0 })
  ipcMain.handle('covers:clear', async () => { await covers?.clear(); return true })
  ipcMain.handle('wallpaper:choose', (e) => chooseWallpaper(BrowserWindow.fromWebContents(e.sender)).catch((err) => ({ ok: false, error: err.message })))
  ipcMain.handle('wallpaper:get', () => readImage('wallpaper', 'wallpaper'))
  ipcMain.handle('wallpaper:clear', () => { fs.rmSync(wallpaperDir(), { recursive: true, force: true }); return true })
  ipcMain.handle('lyrics:choose-background', async (e) => {
    const r = await chooseLyricsBackground(BrowserWindow.fromWebContents(e.sender)).catch((err) => ({ ok: false, error: err.message }))
    // 换图后风格里的 customImage 不一定变化，主动通知浮窗重拉背景
    if (r?.ok) lyricsWin?.notifyBackgroundChanged?.()
    return r
  })
  ipcMain.handle('lyrics:get-background', () => readImage('lyrics-background', 'background'))
  ipcMain.handle('lyrics:clear-background', () => { fs.rmSync(lyricsBackgroundDir(), { recursive: true, force: true }); lyricsWin?.notifyBackgroundChanged?.(); return true })
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }))
  ipcMain.handle('prefs:get', () => readPrefs())
  ipcMain.handle('experimental:get', () => experimentalRead())
  ipcMain.handle('experimental:set', (_e, patch) => ({ ok: true, settings: experimentalWrite(patch || {}) }))
  ipcMain.handle('experimental:test', async (_e, patch) => {
    try {
      const settings = { ...experimentalRead(), ...(patch || {}), useApiKeyOverride: true }
      const r = await remoteTranslate(['テスト'], { ...settings, title: '', artist: '', context: '' }, 20000)
      return r.ok ? { ok: true, message: `${settings.model} 返回了译文` } : r
    } catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('lyrics:translate', async (_e, payload) => {
    try {
      const settings = experimentalRead()
      if (!settings.enabled) return { ok: false, error: '实验性歌词翻译未开启' }
      const song = payload?.song || {}
      const source = settings.sourceEnabled ? await fetchNeteaseTranslation(song) : { ok: false, error: '源站译词未开启' }
      const sourceLines = source.ok && Array.isArray(source.lines) ? source.lines : []
      const local = Array.isArray(payload?.localLines) ? payload.localLines : []
      const lines = local.map((x) => String(x?.text || '')).filter(Boolean)
      const findSourceLine = (localMs, text) => {
        if (localMs) {
          let exactTranslated = null
          let exactAny = null
          let nearestTranslated = null
          let nearestAny = null
          for (const row of sourceLines) {
            const d = Math.abs(Number(row.ms || 0) - localMs)
            const hasTr = !!String(row.translation || '').trim()
            if (d === 0) {
              if (hasTr && !exactTranslated) exactTranslated = row
              if (!exactAny) exactAny = row
            }
            if (d <= 900) {
              if (hasTr && (!nearestTranslated || d < nearestTranslated.d)) nearestTranslated = { d, row }
              if (!nearestAny || d < nearestAny.d) nearestAny = { d, row }
            }
          }
          if (exactTranslated) return exactTranslated
          if (nearestTranslated) return nearestTranslated.row
          if (exactAny) return exactAny
          if (nearestAny) return nearestAny.row
        }
        if (!text) return null
        let bestTranslated = null
        let bestAny = null
        for (const row of sourceLines) {
          const sim = textSimilarity(text, row.text || '')
          if (sim < 0.62) continue
          const hasTr = !!String(row.translation || '').trim()
          if (hasTr && (!bestTranslated || sim > bestTranslated.sim)) bestTranslated = { sim, row }
          if (!bestAny || sim > bestAny.sim) bestAny = { sim, row }
        }
        return (bestTranslated || bestAny)?.row || null
      }
      const translations = []
      const missing = []
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i]
        const localLine = local[i] || {}
        const hit = findSourceLine(Number(localLine.ms || 0), text)
        const tr = String(hit?.translation || '').trim()
        translations[i] = tr
        if (!tr) missing.push({ i, text })
      }
      let ai = { ok: false, translations: [], error: '' }
      if (missing.length && settings.aiFallback) {
        ai = await remoteTranslate(missing.map((x) => x.text), { ...settings, title: song.title || '', artist: song.artist || '', context: payload?.context || '' })
        if (ai.ok) missing.forEach((x, j) => { translations[x.i] = ai.translations[j] || '' })
      }
      const sourceCount = translations.filter(Boolean).length - (ai.ok ? ai.translations.filter(Boolean).length : 0)
      return {
        ok: true,
        translations,
        source: source.ok ? source.source : 'none',
        matched: source.ok ? source.matched : '',
        sourceCount: Math.max(0, sourceCount),
        aiCount: ai.ok ? ai.translations.filter(Boolean).length : 0,
        warning: !source.ok ? source.error : (missing.length && !settings.aiFallback ? '源站没有译文的行未补译（AI 补译已关闭）' : (missing.length && !ai.ok ? ai.error : '')),
      }
    } catch (e) { return { ok: false, error: e.message } }
  })
    ipcMain.handle('lyrics:syllables', (e, payload = {}) => {
      // 流式：主进程按用户排序逐源抓取，覆盖率用渲染层传来的本地 LRC 计算。
      // 达到合格线先推一版给界面显示，达到优秀线停止后续来源；期间出现更好结果继续推。
      const sender = e.sender
      return fetchSyllables({
        ...payload,
        sources: readPrefs().experimental?.syllableSources,
        debug: true,
        onProgress: (data) => { if (sender && !sender.isDestroyed()) sender.send('lyrics:syllables-progress', data) },
      })
    })
  if (isDev) ipcMain.handle('dev:set-session', (_e, { base, token } = {}) => { Object.assign(state, { base, token, mode: 'dev', username: 'dev' }); return { ok: true } })
  ipcMain.handle('prefs:set', (_e, p) => { writePrefs({ ...readPrefs(), ...p }); syncBall(); syncLyrics(); if (p && p.lyricsStyle) lyricsWin?.setStyle(readPrefs().lyricsStyle); tray?.refresh(); return true })
  ipcMain.handle('tray:info', () => ({ available: !!tray, closeToTray: closeToTray(), ballMode: ballMode(), lyricsOn: lyricsOn() }))
  ipcMain.handle('lyrics:get', () => ({ on: lyricsOn(), style: { ...(readPrefs().lyricsStyle || {}) } }))
  ipcMain.handle('lyrics:set-on', (_e, on) => { setLyricsOn(on); return lyricsOn() })
  ipcMain.handle('lyrics:set-style', (_e, patch) => { setLyricsStyle(patch || {}); return readPrefs().lyricsStyle || {} })
  ipcMain.handle('lyrics:reset-style', () => { if (lyricsWin) lyricsWin.resetStyle(); else writePrefs({ ...readPrefs(), lyricsStyle: {} }); return readPrefs().lyricsStyle || {} })
  ipcMain.on('lyrics:reset-position', () => lyricsWin?.resetPosition())
  ipcMain.on('player:state', (_e, s) => { tray?.setPlayer(s); ball?.setState(s); lyricsWin?.setState(s) })

  ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('win:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('theme:set', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system' })
  ipcMain.on('overlay:set', (e, o) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && process.platform === 'win32') {
      try { w.setTitleBarOverlay({ color: '#00000000', symbolColor: o.symbolColor, height: 52 }) } catch {}
    }
  })
}

// ---------- 窗口 ----------
function createWindow() {
  const prefs = readPrefs()
  const b = prefs.bounds || {}
  const win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 820,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#00000000',
    title: '飞牛音乐',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1d1d1f', height: 52 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  if (isDev) { // 开发模式允许按 F12 手动打开 DevTools（生产构建不受影响）；不再自动弹出
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' })
      }
    })
  }
  if (prefs.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const persist = () => {
    if (win.isDestroyed()) return
    const p = readPrefs()
    p.maximized = win.isMaximized()
    if (!win.isMaximized() && !win.isMinimized()) p.bounds = win.getBounds()
    writePrefs(p)
  }
  win.on('close', (e) => {
    persist()
    if (quitting || !tray || !closeToTray()) return
    // 最小化到托盘：隐藏窗口，音乐继续播放
    e.preventDefault()
    win.hide()
    const p = readPrefs()
    if (!p.trayHinted) {
      tray.balloon('飞牛音乐仍在运行', '音乐会继续播放。单击托盘图标打开窗口，右键菜单可以退出。')
      writePrefs({ ...p, trayHinted: true })
    }
  })
  // Windows 注销 / 关机时直接退出，不能拦着
  win.on('session-end', () => { quitting = true })
  // 主窗口隐藏 / 最小化时按设置显示悬浮球
  for (const [ev, hidden] of [['hide', true], ['minimize', true], ['show', false], ['restore', false]]) {
    win.on(ev, () => { mainHidden = hidden && !quitting; syncBall() })
  }
  // 主窗口真正关闭（未最小化到托盘）时退出应用；悬浮球窗口不应让应用继续留在后台
  win.on('closed', () => { if (mainWindow === win) app.quit() })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 禁止窗口被导航走（例如把音频/图片文件拖进窗口会被当作页面打开），保留应用自身页面与开发服务器
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('http://localhost:5173') || url.startsWith('file:') && url.includes('/dist/index.html')) return
    e.preventDefault()
  })
  // 渲染进程意外崩溃（显卡驱动、内存不足等）时自动重新载入，而不是留下一个空白窗口
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('[render-process-gone]', d.reason, d.exitCode)
    if (d.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.webContents.reload(), 500)
  })
  // 鼠标侧键 / 键盘“浏览器后退/前进”键 → 渲染进程的路由前进后退
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win.webContents.send('nav', -1)
    else if (cmd === 'browser-forward') win.webContents.send('nav', 1)
  })

  loadPage(win, 'index.html')
  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 再次启动（例如双击桌面图标）时，把已在托盘中运行的窗口调出来
  app.on('second-instance', () => app.isReady() && showMainWindow())
  app.on('before-quit', () => { quitting = true })
  app.whenReady().then(() => {
    session.defaultSession.setCertificateVerifyProc(verifyCert)
    session.fromPartition(OAUTH_PARTITION).setCertificateVerifyProc(verifyCert)
    session.defaultSession.setUserAgent(app.userAgentFallback)
    session.fromPartition(OAUTH_PARTITION).setUserAgent(app.userAgentFallback)
    covers = createCoverCache({ dir: path.join(app.getPath('userData'), 'covers'), fetchUpstream: signedGet })
    syllableCache = createSyllableCache({ dir: path.join(app.getPath('userData'), 'syllables') })
    setSyllableCache(syllableCache)
    syllableCache.init()
    covers.init()
    registerProxy()
    registerIpc()
    mainWindow = createWindow()
    setupTray()
    setupBall()
    setupLyrics()
    app.on('activate', showMainWindow)
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
