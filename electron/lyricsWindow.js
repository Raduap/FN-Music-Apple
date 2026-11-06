// 悬浮歌词窗口：透明、置顶、不出现在任务栏、不抢焦点
//
// 鼠标行为：
// - 普通模式：胶囊可拖动 / 缩放，按钮可点；控制条空白与按钮间隙保持穿透
// - 穿透（锁定）模式：整窗默认让鼠标穿透；光标进入胶囊只显示解锁按钮，移到按钮上才临时接收点击
// - 控制条显隐由主进程按光标位置驱动：光标进入胶囊显示，离开胶囊 / 按钮 3s 后隐藏
//
// 拖动：按住胶囊空白处移动；缩放：直接拉胶囊的四边 / 四角（八向）。
// 内部始终保存“胶囊左上角”的坐标，窗口只是胶囊的紧贴外框；这样胶囊四边才能真正贴屏幕边。
const { BrowserWindow, Menu, screen, ipcMain } = require('electron')
const G = require('./lyricsGeometry')
const I = require('./lyricsInteraction')

const CAN_PASS_THROUGH = process.platform === 'win32' || process.platform === 'darwin'

/**
 * @param {object} o
 * @param {string} o.preload
 * @param {(win: BrowserWindow) => void} o.load
 * @param {() => object} o.readPrefs
 * @param {(p: object) => void} o.writePrefs
 * @param {(cmd: string, arg?: any) => void} o.command 播放控制命令（上一首 / 暂停继续 / 下一首）
 * @param {() => Electron.MenuItemConstructorOptions[]} o.menu
 * @param {() => void} o.openSettings   打开主窗口里的歌词样式设置
 * @param {() => void} o.onClose        关闭悬浮歌词
 * @param {() => void} o.onStyleChanged 样式变化后刷新托盘等外部 UI
 */
function createLyrics({ preload, load, readPrefs, writePrefs, command, menu, openSettings, onClose, onStyleChanged }) {
  let win = null
  let capPos = null // 歌词胶囊左上角的屏幕坐标（持久化坐标）
  let flip = 'above' // 横排：控制条在胶囊上方 / 下方
  let side = 'right' // 竖排：控制条在胶囊左侧 / 右侧
  let edge = 'bottom' // 胶囊最贴近工作区的边，决定进度条贴哪条边
  let style = G.normalizeStyle(readPrefs().lyricsStyle)
  let state = {}
  let drag = null // { cursor, cap, follow, timer }
  let resize = null // { cursor, bounds, dir, extra }
  let pollTimer = null
  let hovered = false // 控制条是否处于显示状态（由主进程按时延迟隐藏）
  let capsuleHot = false // 光标是否在胶囊上（用于显示控制条）
  let controlHot = false // 光标是否在按钮上（用于临时接收点击）
  let hideTimer = null
  let wanted = false
  const HIDE_DELAY = 3000

  const alive = () => win && !win.isDestroyed()
  // 窗口尺寸按当前实际需要预留的行计算，与渲染端共用 lyricsGeometry.layoutFlags。
  // 译文行按“整首歌是否有译文”预留，伴奏 / 间奏句不会让胶囊突然收缩。
  const extra = () => G.layoutFlags(style, state)
  const capSize = () => G.capsuleSize(style, extra())
  // 竖排时限制的是胶囊外框：宽由字号与列数决定，高 = 设置里的长度 + 两端内边距 / 边框
  // 胶囊尺寸上下限：竖排高度（文字方向长度）同时受样式上限与屏幕工作区限制，
  // 横排宽度也限制在工作区宽度内，避免任何方向被拉到屏幕外。
  const limits = (area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) => {
    if (style.vertical) {
      const maxLen = G.maxVerticalLength(area)
      return { minW: G.minCapWidth(extra()), maxW: G.maxCapWidth(extra()), minH: G.MIN_W + G.V_CHROME, maxH: maxLen + G.V_CHROME }
    }
    const maxW = Math.max(G.MIN_W, Math.min(G.MAX_W, Math.round(area.width - G.PAD * 2)))
    return { minW: G.MIN_W, maxW, minH: G.minCapHeight(extra()), maxH: G.maxCapHeight(extra()) }
  }
  // 窗口的 min/max 必须跟随当前布局刷新：切到竖排后高度要能超过横排时的小上限
  function applyWindowLimits(area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) {
    if (!alive()) return
    const lim = limits(area)
    const vertical = style.vertical
    const minW = lim.minW + (vertical ? G.SIDE_W : 0)
    const maxW = lim.maxW + (vertical ? G.SIDE_W : 0)
    const minH = lim.minH + (vertical ? 0 : G.CONTROL_H)
    const maxH = lim.maxH + (vertical ? 0 : G.CONTROL_H)
    try {
      win.setMinimumSize(minW, minH)
      win.setMaximumSize(maxW, maxH)
    } catch {}
  }

  const capRect = (p = capPos) => ({ x: p.x, y: p.y, ...capSize() })
  const workAreaFor = (p = capPos) => screen.getDisplayMatching(capRect(p)).workArea
  const layoutPayload = (L) => ({
    flip: L.flip,
    side: L.side,
    edge: L.edge,
    cap: { width: L.cap.width, height: L.cap.height },
    css: {
      rowGap: G.ROW_GAP,
      subH: Math.round(G.subHeight(style.fontSize)),
      colExtra: G.columnExtra(style.fontSize),
    },
  })
  const send = (ch, data) => alive() && win.webContents.send(ch, data)

  // ---------- 鼠标穿透与光标轮询 ----------
  function clearHideTimer() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }
  let receiveMouse = null
  function applyMouseEvents() {
    if (!alive() || !CAN_PASS_THROUGH) return
    // 普通模式：胶囊与“已展开的按钮”接收鼠标，控制条空白 / 间隙穿透。
    // 穿透模式：胶囊始终穿透，只有光标在解锁按钮上时临时接收点击。
    // 拖动 / 缩放进行中时整窗保持接收，避免光标短暂离开胶囊导致操作中断。
    const busy = !!drag || !!resize
    const receive = busy || (style.clickThrough
      ? (hovered && controlHot)
      : (capsuleHot || (hovered && controlHot)))
    // 值未变化时不重复调用，避免 Windows 上光标样式来回横跳。
    if (receive === receiveMouse) return
    receiveMouse = receive
    win.setIgnoreMouseEvents(!receive, { forward: true })
  }

  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height

  // 每 60ms 读一次光标：驱动控制条显隐，并只放行按钮矩形，其余区域穿透。
  function poll() {
    if (!alive() || !win.isVisible() || !capPos) return
    const c = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    const regs = G.regions(style, flip, extra(), side)
    const onCapsule = inRect(c, { x: bounds.x + regs.capsule.x, y: bounds.y + regs.capsule.y, width: regs.capsule.width, height: regs.capsule.height })
    const onControl = G.controlButtons(style, flip, extra(), side).some((r) => inRect(c, { x: bounds.x + r.x, y: bounds.y + r.y, width: r.width, height: r.height }))
    const changed = onCapsule !== capsuleHot || onControl !== controlHot
    capsuleHot = onCapsule
    controlHot = onControl

    const keep = onCapsule || (hovered && onControl)
    if (keep) {
      clearHideTimer()
      if (!hovered) { hovered = true; send('lyrics:active', true) }
    } else if (hovered && !hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = null
        hovered = false
        send('lyrics:active', false)
        applyMouseEvents()
      }, HIDE_DELAY)
    }
    if (changed) applyMouseEvents()
  }
  function startPoll() {
    stopPoll()
    pollTimer = setInterval(poll, 60)
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    clearHideTimer()
    hovered = false
    capsuleHot = false
    controlHot = false
  }

  function initialPos() {
    const saved = readPrefs().lyrics
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && G.isOnScreen(saved, areas, style, extra())) {
      return G.clampCapsule(saved, screen.getDisplayMatching(capRect(saved)).workArea, style, extra())
    }
    return G.defaultCapsule(screen.getPrimaryDisplay().workArea, style, extra())
  }

  // 应用一次“胶囊坐标 -> 窗口外框”的完整布局，并把控制条方向同步给页面。
  // clamp=false 用于行数变化：保持当前原文顶部坐标不动，不把当前歌词顶上去。
  function applyBounds(notify = false, clamp = true) {
    if (!alive() || !capPos) return null
    const area = workAreaFor(capPos)
    if (clamp) capPos = G.clampCapsule(capPos, area, style, extra())
    applyWindowLimits(area)
    const next = G.layout(capPos, style, area, extra())
    flip = next.flip
    side = next.side || side
    win.setBounds(next.win)
    if (notify) send('lyrics:layout', layoutPayload(next))
    return next
  }

  function layout() {
    return applyBounds(true, true)
  }

  function create() {
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    const initArea = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea
    style = G.clampVerticalLength(style, initArea, extra())
    capPos = capPos && G.isOnScreen(capPos, areas, style, extra()) ? G.clampCapsule(capPos, workAreaFor(capPos), style, extra()) : initialPos()
    const first = G.layout(capPos, style, workAreaFor(capPos), extra())
    flip = first.flip
    side = first.side || side
    const w = win = new BrowserWindow({
      ...first.win,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      title: '飞牛音乐 · 悬浮歌词',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    w.setAlwaysOnTop(true, 'floating')
    w.setVisibleOnAllWorkspaces?.(true)
    applyWindowLimits(workAreaFor(capPos))
    applyMouseEvents()
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.once('ready-to-show', () => { if (wanted && win === w) w.showInactive() })
    w.on('closed', () => { if (win === w) win = null })
    load(w)
    startPoll()
  }

  function destroy() {
    if (drag) endDrag()
    if (resize) endResize()
    stopPoll()
    if (!alive()) return
    const w = win
    win = null
    w.hide()
    setImmediate(() => { if (!w.isDestroyed()) w.destroy() })
  }

  // 统一应用样式：写盘 + 内部状态 + 通知页面 + 刷新托盘等外部 UI
  function applyStyle(patch) {
    const prevCap = capSize()
    const wasVertical = style.vertical
    const area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea
    style = G.normalizeStyle({ ...style, ...patch })
    // 切换横 / 竖排时按新方向把长度 / 宽度限制在当前屏幕内，避免“横排很长 -> 切竖排就一定超出”
    style = G.clampStyleToArea(style, area, extra())
    const prefs = readPrefs()
    if (!alive()) {
      writePrefs({ ...prefs, lyricsStyle: style })
      onStyleChanged?.()
      return
    }
    // 竖排时原文是胶囊最右列：只向左伸缩，保持原文与右边缘位置不变
    if (wasVertical && style.vertical) capPos = G.anchorRightEdge(capPos, prevCap, capSize())
    applyWindowLimits(area)
    capPos = G.clampCapsule(capPos, area, style, extra())
    const next = G.layout(capPos, style, area, extra())
    flip = next.flip
    side = next.side || side
    win.setBounds(next.win)
    send('lyrics:layout', layoutPayload(next))
    send('lyrics:style', style)
    applyMouseEvents()
    writePrefs({ ...prefs, lyricsStyle: style, lyrics: { x: capPos.x, y: capPos.y } })
    onStyleChanged?.()
  }

  // ---------- 拖动 ----------
  function followCursor() {
    if (!drag || !alive()) return stopFollow()
    if (Date.now() > drag.follow) return stopFollow()
    const c = screen.getCursorScreenPoint()
    const next = I.nextDragPosition(drag, c)
    if (next.x !== capPos.x || next.y !== capPos.y) {
      capPos = next
      const L = G.layout(capPos, style, workAreaFor(capPos), extra())
      if (L.flip !== flip || (L.side && L.side !== side) || L.edge !== edge) {
        flip = L.flip
        side = L.side || side
        edge = L.edge
        send('lyrics:layout', layoutPayload(L))
      }
      win.setBounds(L.win)
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
    capPos = G.clampCapsule(capPos, workAreaFor(capPos), style, extra())
    layout()
    applyMouseEvents()
    writePrefs({ ...readPrefs(), lyrics: { x: capPos.x, y: capPos.y } })
  }

  // ---------- 缩放（八向：上下左右 + 四角；字号随胶囊高度等比变化） ----------
  function doResize() {
    if (!resize || !alive()) return
    const c = screen.getCursorScreenPoint()
    const lim = limits(resize.area)
    const resized = I.nextResizeStyle(style, resize.bounds, c, resize.cursor, resize.dir, lim, resize.area, resize.extra)
    style = resized.style
    const cap = capSize()
    // 用「拖动过程中不动的边」反推坐标，避免整体被顶走；随后再按工作区夹取兜底
    const anchor = I.anchoredResizePosition(resize.bounds, cap, resize.dir)
    const x = resize.dir.includes('e') ? resize.bounds.x : anchor.x
    const y = resize.dir.includes('s') ? resize.bounds.y : anchor.y
    applyWindowLimits(resize.area)
    capPos = G.clampCapsule({ x, y }, resize.area, style, extra())
    const L = G.layout(capPos, style, resize.area, extra())
    flip = L.flip
    side = L.side || side
    edge = L.edge
    win.setBounds(L.win)
    send('lyrics:layout', layoutPayload(L))
    send('lyrics:style', style)
  }
  function endResize() {
    if (!resize) return
    resize = null
    capPos = G.clampCapsule(capPos, workAreaFor(capPos), style, extra())
    layout()
    applyMouseEvents()
    writePrefs({ ...readPrefs(), lyricsStyle: style, lyrics: { x: capPos.x, y: capPos.y } })
    onStyleChanged?.()
  }

  const fromLyrics = (e) => alive() && e.sender === win.webContents
  ipcMain.on('lyrics:ready', (e) => {
    if (!fromLyrics(e)) return
    send('lyrics:style', style)
    send('lyrics:layout', layoutPayload(G.layout(capPos, style, workAreaFor(capPos), extra())))
    send('lyrics:state', state)
  })
  ipcMain.on('lyrics:menu', (e) => { if (fromLyrics(e)) Menu.buildFromTemplate(menu()).popup({ window: win }) })
  ipcMain.on('lyrics:settings', (e) => { if (fromLyrics(e)) openSettings() })
  ipcMain.on('lyrics:toggle-lock', (e) => { if (fromLyrics(e)) applyStyle({ clickThrough: !style.clickThrough }) })
  ipcMain.on('lyrics:prev', (e) => { if (fromLyrics(e)) command?.('prev') })
  ipcMain.on('lyrics:toggle', (e) => { if (fromLyrics(e)) command?.('toggle') })
  ipcMain.on('lyrics:next', (e) => { if (fromLyrics(e)) command?.('next') })
  ipcMain.on('lyrics:close', (e) => { if (fromLyrics(e)) onClose?.() })
  ipcMain.on('lyrics:drag-start', (e) => {
    if (!fromLyrics(e)) return
    stopFollow()
    drag = { cursor: screen.getCursorScreenPoint(), cap: { ...capPos }, follow: 0, timer: null }
  })
  ipcMain.on('lyrics:drag-move', (e) => {
    if (!fromLyrics(e) || !drag) return
    drag.follow = Date.now() + 400
    if (!drag.timer) drag.timer = setInterval(followCursor, 16)
    followCursor()
  })
  ipcMain.on('lyrics:drag-end', (e) => { if (fromLyrics(e)) endDrag() })
  ipcMain.on('lyrics:resize-start', (e, dir) => {
    if (!fromLyrics(e) || style.clickThrough) return
    const area = workAreaFor(capPos)
    resize = { cursor: screen.getCursorScreenPoint(), bounds: { x: capPos.x, y: capPos.y, ...capSize() }, dir: typeof dir === 'string' ? dir : 'se', extra: extra(), area }
  })
  ipcMain.on('lyrics:resize-move', (e) => { if (fromLyrics(e) && resize) doResize() })
  ipcMain.on('lyrics:resize-end', (e) => { if (fromLyrics(e)) endResize() })

  // 显示器拔出或分辨率变化后，把胶囊挪回可见区域
  const recheck = () => {
    if (!alive() || !capPos) return
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    if (!G.isOnScreen(capPos, areas, style, extra())) capPos = G.defaultCapsule(screen.getPrimaryDisplay().workArea, style, extra())
    // 屏幕变小后可能超出新的工作区，按当前屏幕重新裁剪样式尺寸
    style = G.clampStyleToArea(style, workAreaFor(capPos), extra())
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
      const prevCap = capSize()
      state = s || {}
      // 行数可能变化（例如某句没有译文 / 当前可显示下一句）。
      // 竖排时新增 / 减少的列向左侧展开，保持当前原文列位置不变。
      if (alive()) {
        // 竖排：新增 / 减少的列向左侧展开，保持最右列（原文）位置不变。
        if (style.vertical) {
          capPos = G.anchorRightEdge(capPos, prevCap, capSize())
          style = G.clampVerticalLength(style, workAreaFor(capPos), extra())
        }
        // 行预留已按“整首歌”计算，胶囊尺寸在一首歌内恒定，切句不会改变高度；
        // 这里可以安全夹取，避免贴边时因为窗口伸出屏幕而被裁掉。
        capPos = G.clampCapsule(capPos, workAreaFor(capPos), style, extra())
        applyBounds(true, false)
        writePrefs({ ...readPrefs(), lyrics: { x: capPos.x, y: capPos.y } })
      }
      if (alive() && win.isVisible()) send('lyrics:state', state)
    },
    setStyle(next) {
      applyStyle(next && typeof next === 'object' ? next : {})
    },
    resetStyle() {
      style = G.normalizeStyle({})
      writePrefs({ ...readPrefs(), lyricsStyle: style })
      if (alive()) { layout(); applyMouseEvents(); send('lyrics:style', style) }
      onStyleChanged?.()
    },
    resetPosition() {
      capPos = G.defaultCapsule(screen.getPrimaryDisplay().workArea, style, extra())
      layout()
      writePrefs({ ...readPrefs(), lyrics: { x: capPos.x, y: capPos.y } })
    },
    isVisible: () => alive() && win.isVisible(),
    window: () => (alive() ? win : null),
  }
}

module.exports = { createLyrics }
