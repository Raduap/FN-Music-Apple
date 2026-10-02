// 飞牛音乐 API 模拟服务器（仅用于开发/演示，无需真实 NAS）
// 启动：npm run mock   →  服务器地址填 127.0.0.1:5666 ，用户名 demo ，密码 demo
const http = require('http')
const crypto = require('crypto')

const PORT = process.env.PORT || 5666
// 模拟较慢的 NAS：写请求（POST）延迟这么多毫秒再处理，用于测试乐观更新与读写竞态
const WRITE_DELAY = +process.env.MOCK_WRITE_DELAY || 0
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const USER = { username: 'demo', password: sha('demo') }
const TOKEN = crypto.randomBytes(16).toString('hex')
const codes = new Set()

// 与真实接口一致的封面 ID：album_<hex> / artist_<hex>
const hex = (n) => n.toString(16).padStart(8, '0')
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

// ---------- 数据 ----------
const ARTIST_NAMES = ['周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '五月天', '李荣浩', '薛之谦', '王菲', 'Taylor Swift', 'Ed Sheeran', 'Adele', 'Coldplay']
const WORDS = ['夜曲', '晴天', '稻香', '七里香', '星空', '海阔天空', '光年之外', '浮夸', '十年', '后来', '告白气球', '最长的电影', '彩虹', '背对背拥抱', '江南', '修炼爱情', '那些年', '小幸运', '成都', '平凡之路', 'Blank Space', 'Shape of You', 'Hello', 'Yellow', 'Fix You', 'Viva la Vida', 'Love Story', 'Someone Like You']
const GENRES = ['流行', '摇滚', '民谣', 'R&B', '电子', '古典']

const artists = ARTIST_NAMES.map((name, i) => ({
  guid: 'ar' + i, name, coverId: 'artist_' + hex(i), albumCount: 0, trackCount: 0,
}))
const albums = []
const tracks = []
let n = 0
artists.forEach((ar, ai) => {
  const cnt = 2 + (ai % 3)
  for (let k = 0; k < cnt; k++) {
    const alb = {
      guid: 'al' + albums.length, name: WORDS[(ai * 3 + k * 5) % WORDS.length] + (k ? ' ' + (k + 1) : ''),
      coverId: 'album_' + hex(albums.length), artists: [{ guid: ar.guid, name: ar.name }],
      releaseDate: `${2005 + ((ai + k * 3) % 19)}-0${1 + (k % 9)}-15`, trackCount: 0,
      newTrackAddedAt: 1700000000 + albums.length * 86400,
    }
    albums.push(alb)
    const tc = 8 + ((ai + k) % 5)
    for (let t = 0; t < tc; t++) {
      const title = WORDS[(ai * 7 + k * 3 + t * 11) % WORDS.length] + (t >= 6 ? ' (Live)' : '')
      tracks.push({
        guid: 'tr' + n++, title, coverId: alb.coverId,
        album: { guid: alb.guid, name: alb.name, coverId: alb.coverId },
        artists: [{ guid: ar.guid, name: ar.name }],
        duration: (150 + ((hash(title) + t * 13) % 120)) * 1000,
        year: parseInt(alb.releaseDate), trackNo: t + 1, discNo: 1,
        genre: GENRES[(ai + t) % GENRES.length],
        isFavorite: false, createdAt: alb.newTrackAddedAt + t,
        audioSpec: { codec: t % 3 === 0 ? 'flac' : 'mp3', bitrate: t % 3 === 0 ? 920000 : 320000, sampleRate: t % 3 === 0 ? 96000 : 44100, bitDepth: t % 3 === 0 ? 24 : 16, size: 9000000 + t * 100000, path: `/vol1/music/${ar.name}/${alb.name}/${t + 1} ${title}.${t % 3 === 0 ? 'flac' : 'mp3'}` },
      })
      alb.trackCount++; ar.trackCount++
    }
    ar.albumCount++
  }
})
// 与真实接口一致：歌单自带的 coverId 是无效的裸 GUID，客户端会改用第一首歌的封面
const playlists = [
  { guid: 'pl0', name: '通勤路上', trackCount: 0, coverId: crypto.randomBytes(16).toString('hex'), trackIds: tracks.slice(0, 12).map((t) => t.guid) },
  { guid: 'pl1', name: '深夜单曲循环', trackCount: 0, coverId: crypto.randomBytes(16).toString('hex'), trackIds: tracks.slice(30, 40).map((t) => t.guid) },
]
const syncPl = () => playlists.forEach((p) => (p.trackCount = p.trackIds.length))
syncPl()

// ---------- 工具 ----------
const ok = (data) => ({ code: 0, msg: 'ok', data })
const page = (list, q, extra) => {
  const p = Math.max(1, +q.get('page') || 1), s = Math.max(1, +q.get('size') || 50)
  return ok({ list: list.slice((p - 1) * s, p * s), total: list.length, page: p, size: s, ...extra })
}
const sortBy = (list, q) => {
  const [f, d] = (q.get('sort') || '').split(',')
  if (!f) return list
  const out = [...list].sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0))
  return d === 'desc' ? out.reverse() : out
}
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')) } catch { r({}) } }) })

function cover(id) {
  const h = hash(id) % 360
  const label = id.startsWith('artist_') ? '♪' : String(parseInt(id.split('_')[1], 16) || 0)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,58%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},75%,38%)"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/><circle cx="420" cy="180" r="150" fill="hsla(${(h + 30) % 360},90%,75%,.25)"/>
<text x="300" y="360" font-family="Segoe UI,sans-serif" font-size="200" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`
}

// 音频：按曲目生成一段 WAV 简单旋律（8kHz 单声道，足够演示播放/拖动/Range）
function wav(track) {
  const rate = 8000, secs = Math.min(90, Math.round(track.duration / 1000))
  const total = rate * secs
  const buf = Buffer.alloc(44 + total * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(total * 2, 40)
  const scale = [0, 2, 4, 7, 9, 12, 9, 7], base = 220 * Math.pow(2, (hash(track.guid) % 7) / 12)
  for (let i = 0; i < total; i++) {
    const t = i / rate, step = Math.floor(t * 2.5), f = base * Math.pow(2, scale[(step + hash(track.guid)) % 8] / 12)
    const env = Math.max(0, 1 - ((t * 2.5) % 1) * 0.9)
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * 9000 * env), 44 + i * 2)
  }
  return buf
}
const wavCache = new Map()

function lyric(track) {
  const lines = ['(前奏)', `${track.title}`, `作词：${track.artists[0].name}`, '这是演示用的歌词', '用来展示逐行滚动', '当前行会高亮放大', '其余行淡出模糊', '就像 Apple Music 一样', '你可以点击任意一行跳转', '继续往下听', '让旋律慢慢流淌', '夜色温柔地落下', '星光洒在窗台上', '把所有的烦恼都忘掉', '只剩下音乐和你', '(间奏)', '再唱一遍', '这一刻刚刚好', '感谢你的聆听', '— 终 —']
  const dur = Math.min(90, track.duration / 1000)
  const step = (dur - 4) / lines.length
  return lines.map((l, i) => {
    const t = 2 + i * step
    const m = Math.floor(t / 60), s = (t % 60).toFixed(2).padStart(5, '0')
    return `[${String(m).padStart(2, '0')}:${s}]${l}`
  }).join('\n')
}

// ---------- 路由 ----------
const coverLog = [] // 收到的封面请求（coverId@size），供端到端测试检查缓存是否生效

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname.replace(/^\/music/, ''), q = u.searchParams
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)) }

  // ---- 测试用：查看 / 清空封面请求记录 ----
  if (u.pathname === '/__mock/covers') {
    if (req.method === 'DELETE') coverLog.length = 0
    return json(coverLog)
  }

  // ---- 模拟 fnOS 官方登录页（OAuth）----
  if (u.pathname === '/signin') {
    const redirect = q.get('redirect_uri') || ''
    // 已登录过 fnOS（有会话 Cookie）时直接带授权码跳回，用于测试静默续期
    if ((req.headers.cookie || '').includes('fnos_session=1')) {
      const code = crypto.randomBytes(8).toString('hex'); codes.add(code)
      res.writeHead(302, { location: redirect + '?code=' + code }); return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(`<!doctype html><meta charset="utf-8"><title>fnOS</title><body style="font-family:sans-serif;display:grid;place-items:center;height:90vh">
<form action="/signin/submit" method="post"><h2>fnOS 登录（模拟）</h2><input type="hidden" name="r" value="${redirect.replace(/"/g, '')}">
<p><input name="u" placeholder="用户名"></p><p><input name="p" type="password" placeholder="密码"></p><button id="ok">登录</button></form>`)
  }
  if (u.pathname === '/signin/submit' && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c
    const f = new URLSearchParams(raw), code = crypto.randomBytes(8).toString('hex'); codes.add(code)
    // 与真实 fnOS 登录页一致：先写入会话，再由页面脚本跳转回调地址
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'fnos_session=1; Path=/; Max-Age=2592000' })
    return res.end(`<!doctype html><script>location.replace(${JSON.stringify(f.get('r') + '?code=' + code)})</script>`)
  }
  if (p === '/api/v1/sys/config') return json(ok({ nasOAuth: { clientId: 'MOCKCLIENT' }, serverName: 'MOCK-NAS', serverVersion: '1.0.10' }))
  if (p === '/api/v1/initialization/state') return json(ok({ initialized: true }))
  if (p === '/api/v1/user/auth-login' && req.method === 'POST') {
    const b = await body(req)
    if (!codes.delete(b.code)) return json({ code: 120002, msg: 'invalid code' })
    return json(ok({ userToken: TOKEN, user: { username: 'nas-admin' } }))
  }
  if (p === '/api/v1/user/logout') return json(ok({}))

  if (p === '/api/v1/user/password-login' && req.method === 'POST') {
    const b = await body(req)
    // 真实 NAS 上用 fnOS 系统账号走密码登录会返回 HTTP 500
    if (b.username === 'admin') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('Internal Server Error') }
    if (b.username === USER.username && b.password === USER.password) return json(ok({ userToken: TOKEN, deviceId: b.deviceId }))
    return json({ code: 10001, msg: '用户名或密码错误' })
  }
  const cookie = req.headers.cookie || ''
  if (!cookie.includes('music-token=' + TOKEN)) return json({ code: 99999, msg: 'token 失效' })
  if (req.method === 'POST' && WRITE_DELAY) await new Promise((r) => setTimeout(r, WRITE_DELAY))

  const T = tracks
  switch (p) {
    case '/api/v1/user/me': return json(ok({ username: 'demo' }))
    case '/api/v1/album/list': return json(page(sortBy(albums, q), q))
    case '/api/v1/album/detail': return json(ok(albums.find((a) => a.guid === q.get('albumGUID')) || {}))
    case '/api/v1/album/artist-detail/list': return json(page(albums.filter((a) => a.artists[0].guid === q.get('artistGUID')), q))
    case '/api/v1/track/list': return json(page(sortBy(T, q), q))
    case '/api/v1/track/album-detail/list': return json(page(T.filter((t) => t.album.guid === q.get('albumGUID')), q))
    case '/api/v1/track/artist-detail/list': return json(page(T.filter((t) => t.artists[0].guid === q.get('artistGUID')), q))
    case '/api/v1/track/genre-detail/list': return json(page(T.filter((t) => t.genre === q.get('genreGUID')), q))
    case '/api/v1/track/playlist-detail/list': {
      const pl = playlists.find((x) => x.guid === q.get('playlistGUID'))
      return json(page(pl ? pl.trackIds.map((id) => T.find((t) => t.guid === id)).filter(Boolean) : [], q))
    }
    case '/api/v1/artist/list': return json(page(artists, q))
    case '/api/v1/genre/list': return json(page(GENRES.map((g) => ({ guid: g, name: g, trackCount: T.filter((t) => t.genre === g).length })), q))
    case '/api/v1/playlist/list': syncPl(); return json(page(playlists, q))
    case '/api/v1/favorite-track/list': return json(page(T.filter((t) => t.isFavorite), q))
    case '/api/v1/favorite-track/create': { const b = await body(req); const t = T.find((x) => x.guid === b.trackGUID); if (t) t.isFavorite = true; return json(ok({})) }
    case '/api/v1/favorite-track/delete': { const b = await body(req); const t = T.find((x) => x.guid === b.trackGUID); if (t) t.isFavorite = false; return json(ok({})) }
    case '/api/v1/playlist/create': { const b = await body(req); playlists.push({ guid: 'pl' + Date.now(), name: b.name, trackCount: 0, coverId: '', trackIds: [] }); return json(ok({})) }
    case '/api/v1/playlist/delete': { const b = await body(req); const i = playlists.findIndex((x) => x.guid === b.guid); if (i >= 0) playlists.splice(i, 1); return json(ok({})) }
    case '/api/v1/playlist/update': { const b = await body(req); const pl = playlists.find((x) => x.guid === b.guid); if (pl) pl.name = b.name; return json(ok({})) }
    case '/api/v1/playlist/add-track': { const b = await body(req); const pl = playlists.find((x) => x.guid === b.guid); if (pl) b.trackGUIDs.forEach((id) => !pl.trackIds.includes(id) && pl.trackIds.push(id)); return json(ok({})) }
    case '/api/v1/playlist/remove-track': { const b = await body(req); const pl = playlists.find((x) => x.guid === b.guid); if (pl) pl.trackIds = pl.trackIds.filter((id) => !b.trackGUIDs.includes(id)); return json(ok({})) }
    case '/api/v1/search/track': { const k = q.get('q').toLowerCase(); return json(page(T.filter((t) => (t.title + t.artists[0].name + t.album.name).toLowerCase().includes(k)), q)) }
    case '/api/v1/search/album': { const k = q.get('q').toLowerCase(); return json(page(albums.filter((a) => (a.name + a.artists[0].name).toLowerCase().includes(k)), q)) }
    case '/api/v1/search/artist': { const k = q.get('q').toLowerCase(); return json(page(artists.filter((a) => a.name.toLowerCase().includes(k)), q)) }
    case '/api/v1/lyric/list': { const t = T.find((x) => x.guid === q.get('trackGUID')); return json(ok({ list: t ? [{ content: lyric(t) }] : [] })) }
    case '/api/v1/static/cover': { coverLog.push(`${q.get('coverId')}@${q.get('size') || ''}`); res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(cover(q.get('coverId') || '')) }
    case '/api/v1/track/stream': {
      const t = T.find((x) => x.guid === q.get('guid'))
      if (!t) return json({ code: 404, msg: 'not found' }, 404)
      if (!wavCache.has(t.guid)) wavCache.set(t.guid, wav(t))
      const buf = wavCache.get(t.guid), m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
      if (m) {
        const s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1
        res.writeHead(206, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${buf.length}`, 'content-length': e - s + 1 })
        return res.end(buf.subarray(s, e + 1))
      }
      res.writeHead(200, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': buf.length })
      return res.end(buf)
    }
  }
  json({ code: 404, msg: 'not found: ' + p }, 404)
})
server.listen(PORT, () => console.log(`飞牛音乐 mock 服务已启动  http://127.0.0.1:${PORT}/music   用户 demo / 密码 demo`))
