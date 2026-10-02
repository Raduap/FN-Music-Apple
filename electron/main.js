const { app, BrowserWindow, ipcMain, protocol, net, session, safeStorage, nativeTheme, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const isDev = process.env.NODE_ENV === 'development'

// 自定义协议：渲染进程所有请求（接口 / 封面 / 音频流）都经 fnm://srv/... 转发到飞牛，
// 由主进程统一附带 music-token Cookie，渲染进程永远拿不到凭证。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fnm',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
  },
])

// ---------- 会话状态 ----------
const state = {
  base: '', // 例如 http://192.168.1.10:5666/music
  token: '',
  deviceId: '',
  username: '',
  password: '',
  insecure: true,
}

const storeFile = () => path.join(app.getPath('userData'), 'session.bin')
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')

function normalizeBase(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  url = url.replace(/\/+$/, '')
  if (!/\/music$/i.test(url)) url += '/music'
  return url
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const newDeviceId = () => crypto.randomBytes(16).toString('hex')

function saveSession() {
  try {
    const payload = JSON.stringify({
      base: state.base,
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
    return true
  } catch {
    return false
  }
}

function clearSession() {
  state.token = ''
  state.password = ''
  try { fs.unlinkSync(storeFile()) } catch {}
}

function readPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) } catch { return {} }
}
function writePrefs(p) {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(p)) } catch {}
}

// ---------- 登录 ----------
async function passwordLogin(base, username, password, deviceId) {
  const res = await net.fetch(base + '/api/v1/user/password-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: sha256(password), deviceId }),
  })
  let body
  try { body = await res.json() } catch { throw new Error(`服务器响应异常（HTTP ${res.status}），请确认地址是否正确`) }
  if (body.code !== 0) throw new Error(body.msg || '用户名或密码错误')
  const token = body.data && body.data.userToken
  if (!token) throw new Error('登录失败：服务器未返回凭证')
  return { token, deviceId: (body.data && body.data.deviceId) || deviceId }
}

let reloginInFlight = null
function relogin() {
  if (!state.password) return Promise.reject(new Error('无已保存的密码'))
  if (!reloginInFlight) {
    reloginInFlight = passwordLogin(state.base, state.username, state.password, state.deviceId || newDeviceId())
      .then((r) => {
        state.token = r.token
        state.deviceId = r.deviceId
        saveSession()
        return true
      })
      .finally(() => { reloginInFlight = null })
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
    if (state.token) headers.set('Cookie', `music-token=${state.token}`)
    let upstream
    try {
      upstream = await net.fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
        bypassCustomProtocolHandlers: true,
      })
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
    try {
      const res = await net.fetch(state.base + '/api/v1/user/me', { headers: { Cookie: `music-token=${state.token}` } })
      const body = await res.json()
      if (body.code === 0) return { ok: true, username: state.username, server: state.base }
      await relogin()
      return { ok: true, username: state.username, server: state.base }
    } catch (e) {
      // 网络暂时不可达时仍进入应用，由界面显示错误
      return { ok: !!state.token, username: state.username, server: state.base, offline: true, error: e.message }
    }
  })

  ipcMain.handle('auth:login', async (_e, { server, username, password }) => {
    try {
      const base = normalizeBase(server)
      if (!base) throw new Error('请输入服务器地址')
      if (!username) throw new Error('请输入用户名')
      const r = await passwordLogin(base, username, password, newDeviceId())
      Object.assign(state, { base, username, password, token: r.token, deviceId: r.deviceId })
      saveSession()
      return { ok: true, username, server: base }
    } catch (e) {
      let msg = e.message || String(e)
      if (/ERR_CONNECTION|ERR_NAME|ERR_ADDRESS|ERR_TIMED|fetch failed/i.test(msg)) msg = '无法连接到服务器，请检查地址与网络'
      if (/CERT/i.test(msg)) msg = 'HTTPS 证书不受信任'
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('auth:relogin', async () => {
    try { await relogin(); return { ok: true } } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('auth:logout', () => {
    clearSession()
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
    // NAS 常用自签名证书：允许 net 请求访问任意证书（仅本应用的会话）
    session.defaultSession.setCertificateVerifyProc((_req, cb) => cb(0))
    registerProxy()
    registerIpc()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
