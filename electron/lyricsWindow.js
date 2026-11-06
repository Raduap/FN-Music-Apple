// 悬浮歌词窗口：透明、置顶、不出现在任务栏、不抢焦点
//
// 鼠标行为：
// - 普通模式：胶囊可拖动 / 缩放，按钮可点；控制条空白与按钮间隙保持穿透
// - 穿透（锁定）模式：整窗默认让鼠标穿透；光标进入胶囊只显示解锁按钮，移到按钮上才临时接收点击
// - 控制条显隐由主进程按光标位置驱动：光标进入胶囊显示，离开胶囊 / 按钮 3s 后隐藏
//
// 拖动：按住胶囊空白处移动；缩放：直接拉胶囊的四边 / 四角（八向）。
// 内部始终保存“胶囊左上角”的坐标，窗口只是胶囊的紧贴外框；这样胶囊四边才能真正贴屏幕边。
const path = require('path')
const { BrowserWindow, screen, ipcMain } = require('electron')
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
function createLyrics({ preload, menuPreload, load, readPrefs, writePrefs, command, menu, openSettings, onClose, onStyleChanged }) {
  let win = null
  let menuWin = null
  let menuItems = []
  const menuSenders = new Set()
  let capPos = null // 歌词胶囊左上角的屏幕坐标（持久化坐标）
  let flip = 'above' // 横排：控制条在胶囊上方 / 下方
  let side = 'right' // 竖排：控制条在胶囊左侧 / 右侧
  let edge = 'bottom' // 进度条贴哪条边；与按钮同源判断，永远在按钮的另一侧
  let style = G.normalizeStyle(readPrefs().lyricsStyle)
  let state = {}
  let layoutState = {}
  let resize = null // { cursor, bounds, dir, extra }
  let pollTimer = null
  let sentInset = null // 最近一次下发给渲染端的胶囊偏移（贴近屏幕边时会连续变化）
  let hovered = false // 控制条是否处于显示状态（由主进程按时延迟隐藏）
  let capsuleHot = false // 光标是否在胶囊上（用于显示控制条）
  let controlHot = false // 光标是否在按钮上（用于临时接收点击）
  let hideTimer = null
  let wanted = false
  const HIDE_DELAY = 3000

  const alive = () => win && !win.isDestroyed()
  // 窗口尺寸按当前实际需要预留的行计算，与渲染端共用 lyricsGeometry.layoutFlags。
  // 译文行按“整首歌是否有译文”预留，伴奏 / 间奏句不会让胶囊突然收缩。
  // 渲染状态始终是最新值；歌词未就绪时仅布局沿用上一首，避免胶囊先缩再扩。
  const extra = () => G.layoutFlags(style, layoutState)
  // 窗口预留行数：只看这首歌有没有译文 / 下一句，忽略用户当前开关。
  // 这样开关译文 / 下一句时窗口尺寸与位置不变，只有内部胶囊伸缩。
  const winExtra = () => ({ showTranslation: !!layoutState.hasTranslation, showNext: !!layoutState.hasNext })
  const capSize = () => G.capsuleSize(style, extra())
  // 竖排时限制的是胶囊外框：宽由字号与列数决定，高 = 设置里的长度 + 两端内边距 / 边框
  // 胶囊尺寸上下限：竖排高度（文字方向长度）同时受样式上限与屏幕工作区限制，
  // 横排宽度也限制在工作区宽度内，避免任何方向被拉到屏幕外。
  const limits = (area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) => {
    // 缩放上下限必须按「当前实际行数」算：拖动的就是现在这块胶囊，用预留行数（可能更多）
    // 会把下限抬高，导致拖不到设置里能设到的最小字号（例如只有一行时拖不到 16 号）。
    const e = extra()
    if (style.vertical) {
      const maxLen = G.maxVerticalLength(area)
      return { minW: G.minCapWidth(e), maxW: G.maxCapWidth(e), minH: G.MIN_W + G.V_CHROME, maxH: maxLen + G.V_CHROME }
    }
    const maxW = Math.max(G.MIN_W, Math.min(G.MAX_W, Math.round(area.width - G.PAD * 2)))
    return { minW: G.MIN_W, maxW, minH: G.minCapHeight(e), maxH: G.maxCapHeight(e) }
  }
  // 窗口自身的 min/max 要按「预留行数」算，否则窗口会小于为整首歌预留的固定尺寸，
  // 被 setMaximumSize 夹住后就装不下预留内容。
  const winLimits = (area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) => {
    const we = winExtra()
    if (style.vertical) {
      const maxLen = G.maxVerticalLength(area)
      return { minW: G.minCapWidth(we), maxW: G.maxCapWidth(we), minH: G.MIN_W + G.V_CHROME, maxH: maxLen + G.V_CHROME }
    }
    const maxW = Math.max(G.MIN_W, Math.min(G.MAX_W, Math.round(area.width - G.PAD * 2)))
    return { minW: G.MIN_W, maxW, minH: G.minCapHeight(we), maxH: G.maxCapHeight(we) }
  }
  // 窗口的 min/max 必须跟随当前布局刷新：切到竖排后高度要能超过横排时的小上限
  function applyWindowLimits(area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) {
    if (!alive()) return
    const lim = winLimits(area)
    const vertical = style.vertical
    // 胶囊两侧各预留一条控制条带，所以窗口尺寸 = 胶囊 + 2 条控制条
    const stripX = vertical ? G.SIDE_W * 2 : 0
    const stripY = vertical ? 0 : G.CONTROL_H * 2
    const minW = lim.minW + stripX
    const maxW = lim.maxW + stripX
    const minH = lim.minH + stripY
    const maxH = lim.maxH + stripY
    try {
      win.setMinimumSize(minW, minH)
      win.setMaximumSize(maxW, maxH)
    } catch {}
  }

  const capRect = (p = capPos) => ({ x: p.x, y: p.y, ...capSize() })
  const workAreaFor = (p = capPos) => screen.getDisplayMatching(capRect(p)).workArea
  const layoutPayload = (L, anim = null) => ({
    flip: L.flip,
    side: L.side,
    edge: L.edge,
    part: L.part || null,
    // 胶囊在窗口内的偏移：贴近屏幕上边 / 左边时会缩到 0（见 lyricsGeometry.capsuleInset）。
    // 渲染端用它决定胶囊与相邻控制条的位置，保证「窗口贴住屏幕边时胶囊仍贴住屏幕边」。
    inset: { x: L.inset.x, y: L.inset.y },
    cap: { width: L.cap.width, height: L.cap.height },
    // 窗口为该歌预留的胶囊尺寸：渲染端用它决定网格轨道（窗口内固定），
    // 用 cap 决定玻璃胶囊本身的大小。
    winCap: L.winCap ? { width: L.winCap.width, height: L.winCap.height } : { width: L.cap.width, height: L.cap.height },
    css: {
      rowGap: G.ROW_GAP,
      subH: Math.round(G.subHeight(style.fontSize)),
      colExtra: G.columnExtra(style.fontSize),
    },
    // 行 / 列数量变化时，渲染端用旧尺寸 + 位移做一段无闪现过渡。
    anim,
  })
  const send = (ch, data) => alive() && win.webContents.send(ch, data)

  // ---------- 鼠标穿透与光标轮询 ----------
  function clearHideTimer() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }
  let receiveMouse = null
  function applyMouseEvents() {
    if (!alive() || !CAN_PASS_THROUGH) return
    // 触控设备上 screen.getCursorScreenPoint() 拿到的仍是鼠标位置，手指点击 / 拖动时不会跟随，
    // 因此普通模式不再依赖光标轮询决定是否接收事件：整个窗口始终接收，保证触摸一定能命中胶囊。
    // 真正的鼠标穿透交给锁定模式；锁定模式下只有光标悬停在解锁按钮上时临时接收点击。
    // 拖动 / 缩放进行中整窗保持接收，避免指针短暂离开胶囊导致操作中断。
    const busy = !!resize
    const receive = busy || !style.clickThrough || (hovered && controlHot)
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
    // 命中区域必须用与当前窗口位置一致的偏移（贴顶时预留带已收掉），否则光标判定会偏移。
    const inset = G.capsuleInset(capPos, style, workAreaFor(capPos), capSize())
    const regs = G.regions(style, flip, extra(), side, winExtra(), inset)
    const onCapsule = inRect(c, { x: bounds.x + regs.capsule.x, y: bounds.y + regs.capsule.y, width: regs.capsule.width, height: regs.capsule.height })
    const onControl = G.controlButtons(style, flip, extra(), side, winExtra(), inset).some((r) => inRect(c, { x: bounds.x + r.x, y: bounds.y + r.y, width: r.width, height: r.height }))
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
  function applyBounds(notify = false, clamp = true, anim = null) {
    if (!alive() || !capPos) return null
    const area = workAreaFor(capPos)
    if (clamp) capPos = G.clampCapsule(capPos, area, style, extra())
    applyWindowLimits(area)
    const next = G.layout(capPos, style, area, extra(), winExtra())
    flip = next.flip
    side = next.side || side
    edge = next.edge
    sentInset = { x: Math.round(next.inset.x), y: Math.round(next.inset.y) }
    win.setBounds(next.win)
    if (notify) send('lyrics:layout', layoutPayload(next, anim))
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
    const first = G.layout(capPos, style, workAreaFor(capPos), extra(), winExtra())
    flip = first.flip
    side = first.side || side
    edge = first.edge
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
    // -webkit-app-region: drag 的区域被 Windows 当成标题栏：右键时系统先弹自己的
    // 窗口菜单。本窗口 focusable:false，系统菜单停不住，所以压掉它，改用自绘菜单窗。
    w.on('system-context-menu', (event) => {
      event.preventDefault()
      setTimeout(() => { if (alive()) openMenuWindow() }, 60)
    })
    // 原生拖动由 Windows 直接移动窗口（触控唯一跟手的方式）。
    //
    // 关键：贴近屏幕上边 / 左边时，窗口内那条朝外的预留带会连续收掉（capsuleInset），
    // 所以「窗口位置 → 胶囊位置」不是简单加固定偏移，必须用 capFromWindow 反算。
    // 这样窗口顶到屏幕边（y=0）时胶囊仍能继续贴到 y=0，而不是卡在 38px。
    function syncFromWindow() {
      if (!alive() || win !== w || resize) return null
      const area = workAreaFor(capPos)
      capPos = G.capFromWindow(w.getBounds(), style, area, capSize())
      capPos = G.clampCapsule(capPos, area, style, extra())
      // 越过控制条变换线时切换按钮方向（横排上 / 下、竖排左 / 右），进度条随之换边。
      const L = G.layout(capPos, style, area, extra(), winExtra())
      // 贴近屏幕上边 / 左边时 inset 会连续变化（窗口不动、胶囊在窗口内滑），必须同步给
      // 渲染端，否则胶囊会停在固定偏移处、看起来没贴到屏幕边。变化很小，用整数比较去抖。
      const nextInset = { x: Math.round(L.inset.x), y: Math.round(L.inset.y) }
      const insetChanged = !sentInset || sentInset.x !== nextInset.x || sentInset.y !== nextInset.y
      if (L.flip !== flip || (L.side && L.side !== side) || L.edge !== edge || insetChanged) {
        flip = L.flip
        side = L.side || side
        edge = L.edge
        sentInset = nextInset
        send('lyrics:layout', layoutPayload(L))
      }
      return L
    }
    w.on('move', () => { syncFromWindow() })
    w.on('moved', () => {
      const L = syncFromWindow()
      if (!L) return
      // 松手时把窗口贴回「胶囊位置对应的窗口位置」：拖动过程中窗口可能停在过渡区内的
      // 某个中间点，这一步保证窗口与胶囊严格对齐（也修掉取整误差）。
      win.setBounds(L.win)
      writePrefs({ ...readPrefs(), lyrics: { x: capPos.x, y: capPos.y } })
    })
    w.once('ready-to-show', () => { if (wanted && win === w) w.showInactive() })
    w.on('closed', () => { if (win === w) win = null })
    load(w)
    startPoll()
  }

  function destroy() {
    closeMenuWindow()
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
    const p = patch && typeof patch === 'object' ? patch : {}
    style = G.normalizeStyle({ ...style, ...p })
    // 切换横 / 竖排时按新方向把长度 / 宽度限制在当前屏幕内，避免“横排很长 -> 切竖排就一定超出”
    style = G.clampStyleToArea(style, area, extra())
    const nextCap = capSize()
    const prefs = readPrefs()
    if (!alive()) {
      writePrefs({ ...prefs, lyricsStyle: style })
      onStyleChanged?.()
      return
    }
    // 开关译文 / 下一句时，固定靠近屏幕边框的边，拉动远离边框的边。
    // 其它竖排尺寸变化仍固定右侧，避免原文列在缩放 / 改字号时跑到屏幕外。
    const lineToggle = ('showTranslation' in p) || ('showNext' in p)
    const sameOrientation = wasVertical === style.vertical
    const sizeChanged = nextCap.width !== prevCap.width || nextCap.height !== prevCap.height
    let anim = null
    if (sameOrientation && lineToggle && sizeChanged) {
      // 固定「贴屏的那条边」，向远离屏幕的方向生长（见 lyricsGeometry.capsuleGrowthShift）。
      // 窗口外框锚定同一条边，所以 capPos 补偿后窗口位置也随之不变。
      const opts = { vertical: style.vertical, side, flip }
      capPos = G.anchorCapsule(capPos, prevCap, nextCap, opts)
    } else if (wasVertical && !style.vertical) {
      // 竖排切横排：以旧竖排胶囊的底边为锚点，避免横排按左上角定位导致整体跳位。
      capPos = G.anchorVerticalToHorizontal(capPos, prevCap, nextCap)
    } else if (style.vertical) {
      capPos = G.anchorCapsule(capPos, prevCap, nextCap, { vertical: true, side })
    }
    applyWindowLimits(area)
    // 开关译文 / 下一句时不要重新夹取位置：胶囊在窗口内固定、窗口尺寸按整首歌预留，
    // clampCapsule 会因为 capSize 变化在贴边处把胶囊顶走（表现为开关行时整体跳一下）。
    if (!(sameOrientation && lineToggle)) capPos = G.clampCapsule(capPos, area, style, extra())
    const next = G.layout(capPos, style, area, extra(), winExtra())
    flip = next.flip
    side = next.side || side
    edge = next.edge
    win.setBounds(next.win)
    send('lyrics:layout', layoutPayload(next, anim))
    send('lyrics:style', style)
    applyMouseEvents()
    writePrefs({ ...prefs, lyricsStyle: style, lyrics: { x: capPos.x, y: capPos.y } })
    onStyleChanged?.()
  }

  // ---------- 拖动 ----------
  // 拖动由 CSS -webkit-app-region: drag 交给 Windows 原生处理，不再经 JS 移窗。

  // ---------- 右键菜单 ----------
  // 悬浮歌词窗口 focusable:false（不抢主窗口焦点），而 Windows 原生菜单必须有焦点窗口
  // 才能停留，Menu.popup 在这里必然一闪就消失。因此改为完全自绘：用一个独立的可聚焦
  // 小窗加载 lyricsMenu.html，点击 / 勾选 / 关闭全部由我们控制。
  function openMenuWindow() {
    if (!alive()) return
    if (menuWin && !menuWin.isDestroyed()) { menuWin.close(); menuWin = null }
    menuItems = menu() || []
    const p = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(p).workArea
    // 先以固定尺寸在目标位置创建但保持隐藏，等页面渲染完、量出真实尺寸后再一次性
    // 显形到位，避免“小窗 → 撑开”的跳变导致的掉帧观感。
    const mw = menuWin = new BrowserWindow({
      x: p.x, y: p.y, width: 220, height: 40,
      frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: true, show: false,
      webPreferences: { preload: menuPreload, contextIsolation: true, sandbox: true },
    })
    mw.setAlwaysOnTop(true, 'pop-up-menu')
    const mwContents = mw.webContents
    menuSenders.add(mwContents)
    mw.__area = area
    mw.__anchor = p
    mw.__placed = false
    mw.on('closed', () => {
      menuSenders.delete(mwContents)
      if (menuWin === mw) menuWin = null
    })
    mw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const hash = encodeURIComponent(JSON.stringify(menuItems.map((it) => ({
      type: it.type, label: it.label, checked: !!it.checked,
    }))))
    mw.loadFile(path.join(__dirname, 'lyricsMenu.html'), { hash })
    mw.webContents.once('did-finish-load', () => {
      if (mw.isDestroyed()) return
      // 页面已加载但先不显示：等它上报真实尺寸、窗口一次性摆好后，再 show。
      // 这样不会先看到 220×40 的小窗再被撑开，观感更稳。
      mw.__ready = true
      if (mw.__pendingSize) placeMenuWindow(mw, mw.__pendingSize)
      // 兜底：页面若没有上报尺寸，也要让菜单可见。
      setTimeout(() => {
        if (!mw.isDestroyed() && !mw.__placed) placeMenuWindow(mw, [220, 200])
      }, 200)
    })
  }

  // 把菜单窗一次性摆到锚点附近的正确尺寸并显示
  function placeMenuWindow(mw, size) {
    if (!mw || mw.isDestroyed()) return
    const area = mw.__area || screen.getDisplayNearestPoint(mw.__anchor || screen.getCursorScreenPoint()).workArea
    const anchor = mw.__anchor || screen.getCursorScreenPoint()
    const w = Math.max(1, Math.round(size[0]))
    const h = Math.max(1, Math.round(size[1]))
    const x = Math.min(anchor.x, area.x + area.width - w - 8)
    const y = Math.min(anchor.y, area.y + area.height - h - 8)
    mw.setBounds({ x: Math.max(area.x + 8, x), y: Math.max(area.y + 8, y), width: w, height: h })
    if (!mw.__placed) {
      mw.__placed = true
      mw.show()
      mw.focus()
    }
  }

  function closeMenuWindow() {
    const mw = menuWin
    menuWin = null
    if (mw && !mw.isDestroyed()) mw.close()
  }

  // ---------- 缩放（八向：上下左右 + 四角；字号随胶囊高度等比变化） ----------
  function doResize() {
    if (!resize || !alive()) return
    const lim = limits(resize.area)
    const resized = I.nextResizeStyle(style, resize.bounds, resize.cursor, resize.startCursor, resize.dir, lim, resize.area, resize.extra)
    style = resized.style
    const cap = capSize()
    // 用「拖动过程中不动的边」反推坐标，避免整体被顶走；随后再按工作区夹取兜底
    const anchor = I.anchoredResizePosition(resize.bounds, cap, resize.dir)
    const x = resize.dir.includes('e') ? resize.bounds.x : anchor.x
    const y = resize.dir.includes('s') ? resize.bounds.y : anchor.y
    applyWindowLimits(resize.area)
    capPos = G.clampCapsule({ x, y }, resize.area, style, extra())
    const L = G.layout(capPos, style, resize.area, extra(), winExtra())
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
    send('lyrics:layout', layoutPayload(G.layout(capPos, style, workAreaFor(capPos), extra(), winExtra())))
    send('lyrics:state', state)
  })
  // ⋯ 按钮与右键走同一套自绘菜单
  ipcMain.on('lyrics:menu', (e) => { if (fromLyrics(e)) openMenuWindow() })
  ipcMain.on('lyrics:settings', (e) => { if (fromLyrics(e)) openSettings() })
  ipcMain.on('lyrics:toggle-lock', (e) => { if (fromLyrics(e)) applyStyle({ clickThrough: !style.clickThrough }) })
  ipcMain.on('lyrics:prev', (e) => { if (fromLyrics(e)) command?.('prev') })
  ipcMain.on('lyrics:toggle', (e) => { if (fromLyrics(e)) command?.('toggle') })
  ipcMain.on('lyrics:next', (e) => { if (fromLyrics(e)) command?.('next') })
  ipcMain.on('lyrics:close', (e) => { if (fromLyrics(e)) onClose?.() })
  // 自绘菜单窗口：选择菜单项 / 调整尺寸 / 关闭。
  // 注意：菜单窗在失焦时会自行发 menu:close，可能与点击同帧到达，所以这里不要求
  // menuWin 仍然存在，只校验消息来自我们创建的菜单窗。
  const fromMenu = (e) => menuSenders.has(e.sender)
  ipcMain.on('menu:choose', (e, i) => {
    if (!fromMenu(e)) return
    const item = menuItems[i]
    // 先执行菜单项动作再关窗：有些动作会打开主窗口 / 设置面板，
    // 若先关窗可能连带动到焦点，导致动作看起来没生效。
    if (item && typeof item.click === 'function') {
      // 原生菜单会自动翻转 checkbox 的 checked 再触发 click；自绘菜单必须自己翻转，
      // 否则 toggle 类菜单项拿到的还是旧值，表现为“点了没反应”。
      const arg = item.type === 'checkbox' ? { ...item, checked: !item.checked } : item
      try { item.click(arg) } catch {}
    }
    closeMenuWindow()
  })
  ipcMain.on('menu:resize', (e, width, height) => {
    if (!fromMenu(e)) return
    const mw = menuWin
    if (!mw || mw.isDestroyed()) return
    mw.__pendingSize = [width, height]
    if (mw.__ready) placeMenuWindow(mw, mw.__pendingSize)
  })
  ipcMain.on('menu:close', (e) => { if (fromMenu(e)) closeMenuWindow() })
  ipcMain.on('lyrics:resize-start', (e, dir, x, y) => {
    if (!fromLyrics(e) || style.clickThrough) return
    const area = workAreaFor(capPos)
    const startCursor = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : screen.getCursorScreenPoint()
    resize = { cursor: startCursor, startCursor, bounds: { x: capPos.x, y: capPos.y, ...capSize() }, dir: typeof dir === 'string' ? dir : 'se', extra: extra(), area }
  })
  ipcMain.on('lyrics:resize-move', (e, x, y) => { if (fromLyrics(e) && resize && Number.isFinite(x) && Number.isFinite(y)) { resize.cursor = { x, y }; doResize() } })
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
      layoutState = G.resolveLayoutState(state, layoutState)
      // 行数可能变化（例如某句没有译文 / 当前可显示下一句）。
      // 按字幕所在部固定靠近边框的边，拉动远离边框的边；窗口先扩到最终外框，渲染端再平滑滑到位。
      let anim = null
      if (alive()) {
        if (style.vertical) style = G.clampVerticalLength(style, workAreaFor(capPos), extra())
        const nextCap = capSize()
        // 窗口按整首歌预留尺寸、胶囊在窗口内位置固定，因此行数变化只改胶囊自身大小，
        // capPos 不变，窗口也不移动。
        void prevCap; void nextCap
        // 行预留已按“整首歌”计算，胶囊尺寸在一首歌内恒定，切句不会改变高度；
        // 这里可以安全夹取，避免贴边时因为窗口伸出屏幕而被裁掉。
        capPos = G.clampCapsule(capPos, workAreaFor(capPos), style, extra())
        applyBounds(true, false, anim)
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
    // 自定义背景图片被更换 / 移除后通知页面重新拉取图片。
    // 不能只依赖样式里的 customImage：换图时该值不变，页面 effect 不会重跑，会显示旧图。
    notifyBackgroundChanged() {
      if (alive()) send('lyrics:background')
    },
    isVisible: () => alive() && win.isVisible(),
    window: () => (alive() ? win : null),
  }
}

module.exports = { createLyrics }
