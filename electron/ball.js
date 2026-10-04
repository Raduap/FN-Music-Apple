// 悬浮球窗口：透明、置顶、不出现在任务栏、不抢焦点
//
// - 窗口比球大，透明部分默认让鼠标穿透（Windows / macOS），鼠标移到球或展开的面板上时才接收点击
// - 拖动由主进程按鼠标的屏幕坐标移动窗口（不用 -webkit-app-region，否则球上的点击和悬停都会失效）：
//   拖动期间主进程以 60fps 读取光标位置跟随，甩得再快窗口也跟得上；松手的位置就是最终位置（只保证留在屏幕内）
// - 隐藏时直接销毁窗口，再显示时重新创建：Windows 上透明窗口隐藏再显示后，“穿透但转发鼠标移动”会失效，
//   页面收不到鼠标移动，就再也无法切换为可点击，按钮和拖动都没反应；页面记着的悬停状态也已过期
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
  let drag = null // { cursor, ball, follow: 截止时间, timer }
  let wanted = false

  const alive = () => win && !win.isDestroyed()
  const workAreaFor = (b) => screen.getDisplayMatching({ x: b.x, y: b.y, width: G.BALL, height: G.BALL }).workArea
  const send = (ch, data) => alive() && win.webContents.send(ch, data)

  function initialBall() {
    const saved = readPrefs().ball
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && G.isOnScreen(saved, areas)) return G.clampBall(saved, workAreaFor(saved))
    return G.defaultBall(screen.getPrimaryDisplay().workArea)
  }

  function layout() {
    anchor = G.anchorFor(ball, workAreaFor(ball))
    send('ball:layout', { anchor })
    if (alive()) win.setBounds(G.windowBounds(ball, anchor))
  }

  function create() {
    // 重新创建时沿用当前位置（已不在任何屏幕上时才回到保存的 / 默认位置）
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    ball = ball && G.isOnScreen(ball, areas) ? G.clampBall(ball, workAreaFor(ball)) : initialBall()
    anchor = G.anchorFor(ball, workAreaFor(ball))
    const w = win = new BrowserWindow({
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
    w.setAlwaysOnTop(true, 'floating')
    w.setVisibleOnAllWorkspaces?.(true)
    if (CAN_PASS_THROUGH) w.setIgnoreMouseEvents(true, { forward: true })
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.once('ready-to-show', () => { if (wanted && win === w) w.showInactive() }) // 页面准备好后再显示，避免闪一下白底
    w.on('closed', () => { if (win === w) win = null })
    load(w)
  }

  function destroy() {
    if (drag) endDrag()
    if (!alive()) return
    const w = win
    win = null
    w.hide()
    // 可能正在处理这个窗口自己发来的消息（例如点击圆球打开主窗口），下一轮再销毁
    setImmediate(() => { if (!w.isDestroyed()) w.destroy() })
  }

  // ---------- 拖动 ----------
  // 页面每收到一次 pointermove 就把“跟随”延长 400ms；期间主进程每 16ms 把窗口移到光标处。
  // 光标甩出窗口时页面收不到事件，但主进程仍在跟随，窗口很快追上；万一松手事件丢了，400ms 后自动停止，不会一直粘着鼠标
  function followCursor() {
    if (!drag || !alive()) return stopFollow()
    if (Date.now() > drag.follow) return stopFollow()
    const c = screen.getCursorScreenPoint()
    const next = { x: drag.ball.x + c.x - drag.cursor.x, y: drag.ball.y + c.y - drag.cursor.y }
    if (next.x !== ball.x || next.y !== ball.y) {
      ball = next
      win.setBounds(G.windowBounds(ball, anchor))
    }
  }
  function stopFollow() {
    if (drag?.timer) { clearInterval(drag.timer); drag.timer = null }
  }
  function endDrag() {
    if (!drag) return
    followCursor()
    stopFollow()
    drag = null
    ball = G.clampBall(ball, workAreaFor(ball))
    layout() // 球过了屏幕中线时，面板改向另一侧展开
    writePrefs({ ...readPrefs(), ball })
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
  // 按下时记录起点（光标与球的位置），移动超过阈值后才开始跟随，单击不会挪动
  ipcMain.on('ball:drag-start', (e) => {
    if (!fromBall(e)) return
    stopFollow()
    drag = { cursor: screen.getCursorScreenPoint(), ball: { ...ball }, follow: 0, timer: null }
  })
  ipcMain.on('ball:drag-move', (e) => {
    if (!fromBall(e) || !drag) return
    drag.follow = Date.now() + 400
    if (!drag.timer) drag.timer = setInterval(followCursor, 16)
    followCursor()
  })
  ipcMain.on('ball:drag-end', (e) => { if (fromBall(e)) endDrag() })

  // 显示器拔出或分辨率变化后，把球挪回可见区域
  const recheck = () => {
    if (!alive() || !ball) return
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    ball = G.isOnScreen(ball, areas) ? G.clampBall(ball, workAreaFor(ball)) : G.defaultBall(screen.getPrimaryDisplay().workArea)
    layout()
  }
  screen.on('display-removed', recheck)
  screen.on('display-metrics-changed', recheck)

  return {
    setVisible(v) {
      wanted = v
      if (!v) return destroy()
      if (!alive()) create()
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
