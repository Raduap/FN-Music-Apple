const { app, BrowserWindow, ipcMain, protocol, net, session, safeStorage, nativeTheme, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const isDev = process.env.NODE_ENV === 'development'

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
const OAUTH_PARTITION = 'persist:fnos-oauth'

function normalizeBase(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  url = url.replace(/\/+$/, '')
  if (!/\/music$/i.test(url)) url += '/music'
  return url
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')
const newDeviceId = () => crypto.randomBytes(16).toString('hex')

// ---------- authx 签名（与飞牛音乐网页端一致） ----------
const SIGN_PREFIX = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh'
const SIGN_KEY = '6D5602D4-A342-4799-A0F0-BB795E7167D0'

function authx(method, url, body) {
  const u = new URL(url)
  let payload
  if (method.toUpperCase() === 'GET') {
    const sorted = new URLSearchParams()
    for (const k of [...new Set(u.searchParams.keys())].sort()) {
      for (const v of u.searchParams.getAll(k)) if (v !== 'undefined' && v !== 'null') sorted.append(k, v)
    }
    const encoded = sorted.toString().replace(/\+/g, '%20')
    try { payload = md5(decodeURIComponent(encoded.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'))) } catch { payload = md5(encoded) }
  } else {
    payload = md5(body ? Buffer.from(body).toString('utf8') : '')
  }
  const nonce = String(Math.floor(Math.random() * 9e5) + 1e5)
  const ts = String(Date.now())
  return `nonce=${nonce}&timestamp=${ts}&sign=${md5([SIGN_PREFIX, u.pathname, nonce, ts, payload, SIGN_KEY].join('_'))}`
}

// 带签名的 JSON 请求（主进程内部使用）
async function apiFetch(base, apiPath, { method = 'GET', body, token } = {}) {
  const url = base + apiPath
  const raw = body === undefined ? undefined : JSON.stringify(body)
  const headers = { Accept: 'application/json', authx: authx(method, url, raw) }
  if (raw !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Cookie = `music-token=${token}`
  const res = await net.fetch(url, { method, headers, body: raw })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' }
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

function friendlyError(e) {
  let msg = (e && e.message) || String(e)
  if (/ERR_CONNECTION|ERR_NAME|ERR_ADDRESS|ERR_TIMED|ERR_INTERNET|fetch failed/i.test(msg)) msg = '无法连接到服务器，请检查地址与网络'
  else if (/CERT/i.test(msg)) msg = 'HTTPS 证书不受信任'
  return msg
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

// ---------- fnm:// 协议代理 ----------
function registerProxy() {
  protocol.handle('fnm', async (request) => {
    if (!state.base) return new Response('not configured', { status: 503 })
    const u = new URL(request.url)
    const target = state.base + u.pathname + u.search
    const headers = new Headers()
    for (const h of ['range', 'content-type', 'accept', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(h)
      if (v) headers.set(h, v)
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const body = hasBody ? await request.arrayBuffer() : undefined
    headers.set('authx', authx(request.method, target, body && new Uint8Array(body)))
    if (state.token) headers.set('Cookie', `music-token=${state.token}`)
    let upstream
    try {
      upstream = await net.fetch(target, { method: request.method, headers, body, bypassCustomProtocolHandlers: true })
    } catch (e) {
      return new Response(JSON.stringify({ code: -1, msg: '无法连接服务器：' + e.message }), {
        status: 502,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      })
    }
    const out = new Headers(upstream.headers)
    out.set('access-control-allow-origin', '*')
    out.delete('content-encoding')
    if (u.pathname.includes('/static/cover') && upstream.ok) out.set('cache-control', 'public, max-age=604800')
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
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

  ipcMain.handle('prefs:get', () => readPrefs())
  ipcMain.handle('prefs:set', (_e, p) => { writePrefs({ ...readPrefs(), ...p }); return true })

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
  if (prefs.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const persist = () => {
    if (win.isDestroyed()) return
    const p = readPrefs()
    p.maximized = win.isMaximized()
    if (!win.isMaximized() && !win.isMinimized()) p.bounds = win.getBounds()
    writePrefs(p)
  }
  win.on('close', persist)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) win.loadURL('http://localhost:5173')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) { if (w.isMinimized()) w.restore(); w.focus() }
  })
  app.whenReady().then(() => {
    // NAS 常用自签名证书：本应用的请求与 fnOS 登录页均放行自签名证书
    session.defaultSession.setCertificateVerifyProc((_req, cb) => cb(0))
    session.fromPartition(OAUTH_PARTITION).setCertificateVerifyProc((_req, cb) => cb(0))
    session.defaultSession.setUserAgent(app.userAgentFallback)
    session.fromPartition(OAUTH_PARTITION).setUserAgent(app.userAgentFallback)
    registerProxy()
    registerIpc()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
