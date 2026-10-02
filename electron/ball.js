// 悬浮球窗口：透明、置顶、不出现在任务栏、不抢焦点
//
// - 窗口比球大，透明部分默认让鼠标穿透（Windows / macOS），鼠标移到球或展开的面板上时才接收点击
// - 拖动由主进程根据鼠标的屏幕坐标移动窗口（不用 -webkit-app-region，否则球上的点击和悬停都会失效）
// - 松手后吸附到屏幕边缘（带缓动动画），位置写入偏好设置
const { BrowserWindow, Menu, screen, ipcMain } = require('electron')
const G = require('./ballGeometry')

// 只有 Windows 和 macOS 支持“穿透但转发鼠标移动”，其他平台整块窗口都接收鼠标
const CAN_PASS_THROUGH = process.platform === 'win32' || process.platform === 'darwin'

/**
 * @param {object} o
 * @param {string} o.preload
 * @param {(win: BrowserWindow) => void} o.load        加载悬浮球页面
 * @param {() => object} o.readPrefs
 * @param {(p: object) => void} o.writePrefs
 * @param {(cmd: string, arg?: any) => void} o.command 播放控制命令（转发给主窗口）
 * @param {() => void} o.showMain
 * @param {() => Electron.MenuItemConstructorOptions[]} o.menu  右键菜单
 */
function createBall({ preload, load, readPrefs, writePrefs, command, showMain, menu }) {
  let win = null
  let ball = null // 球左上角的屏幕坐标
  let anchor = 'right'
  let state = {}
  let drag = null
  let anim = null
  let wanted = false

  const alive = () => win && !win.isDestroyed()
  const workAreaFor = (b) => screen.getDisplayMatching({ x: b.x, y: b.y, width: G.BALL, height: G.BALL }).workArea
  const send = (ch, data) => alive() && win.webContents.send(ch, data)

  function initialBall() {
    const saved = readPrefs().ball
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && G.isOnScreen(saved, areas)) return G.snapBall(saved, workAreaFor(saved))
    return G.defaultBall(screen.getPrimaryDisplay().workArea)
  }

  function layout() {
    anchor = G.anchorFor(ball, workAreaFor(ball))
    send('ball:layout', { anchor })
    if (alive()) win.setBounds(G.windowBounds(ball, anchor))
  }

  function create() {
    ball = initialBall()
    anchor = G.anchorFor(ball, workAreaFor(ball))
    win = new BrowserWindow({
      ...G.windowBounds(ball, anchor),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false, // 阴影由页面自己画
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false, // 点击不抢走当前程序的焦点
      show: false,
      title: '飞牛音乐 · 悬浮球',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces?.(true)
    if (CAN_PASS_THROUGH) win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.once('ready-to-show', () => { if (wanted) win.showInactive() })
    win.on('closed', () => { win = null })
    load(win)
  }

  // 缓动移动到目标位置（Windows 上 setBounds 没有动画）
  function animateTo(target, done) {
    clearInterval(anim)
    const from = { ...ball }
    const t0 = Date.now()
    const dur = 240
    anim = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      ball = { x: Math.round(from.x + (target.x - from.x) * e), y: Math.round(from.y + (target.y - from.y) * e) }
      if (alive()) win.setBounds(G.windowBounds(ball, anchor))
      if (t === 1) { clearInterval(anim); anim = null; done?.() }
    }, 16)
  }

  const fromBall = (e) => alive() && e.sender === win.webContents
  ipcMain.on('ball:ready', (e) => { if (!fromBall(e)) return; send('ball:layout', { anchor }); send('ball:state', state) })
  ipcMain.on('ball:interactive', (e, on) => { if (fromBall(e) && CAN_PASS_THROUGH) win.setIgnoreMouseEvents(!on, { forward: true }) })
  ipcMain.on('ball:command', (e, cmd, arg) => {
    if (!fromBall(e)) return
    if (cmd === 'show-main') showMain()
    else command(cmd, arg)
  })
  ipcMain.on('ball:menu', (e) => { if (fromBall(e)) Menu.buildFromTemplate(menu()).popup({ window: win }) })
  ipcMain.on('ball:drag-start', (e) => {
    if (!fromBall(e)) return
    clearInterval(anim)
    drag = { cursor: screen.getCursorScreenPoint(), ball: { ...ball } }
  })
  ipcMain.on('ball:drag-move', (e) => {
    if (!fromBall(e) || !drag) return
    const c = screen.getCursorScreenPoint()
    ball = { x: drag.ball.x + c.x - drag.cursor.x, y: drag.ball.y + c.y - drag.cursor.y }
    win.setBounds(G.windowBounds(ball, anchor))
  })
  ipcMain.on('ball:drag-end', (e) => {
    if (!fromBall(e) || !drag) return
    drag = null
    animateTo(G.snapBall(ball, workAreaFor(ball)), () => {
      layout()
      writePrefs({ ...readPrefs(), ball })
    })
  })

  // 显示器拔出或分辨率变化后，把球挪回可见区域
  const recheck = () => {
    if (!alive() || !ball) return
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    ball = G.isOnScreen(ball, areas) ? G.snapBall(ball, workAreaFor(ball)) : G.defaultBall(screen.getPrimaryDisplay().workArea)
    layout()
  }
  screen.on('display-removed', recheck)
  screen.on('display-metrics-changed', recheck)

  return {
    setVisible(v) {
      wanted = v
      if (!v) { if (alive()) win.hide(); return }
      if (!alive()) return create() // 页面准备好后再显示，避免闪一下白底
      if (!win.isVisible()) { win.showInactive(); send('ball:state', state) }
    },
    setState(s) {
      state = s || {}
      if (alive() && win.isVisible()) send('ball:state', state)
    },
    isVisible: () => alive() && win.isVisible(),
    window: () => (alive() ? win : null),
  }
}

module.exports = { createBall }
