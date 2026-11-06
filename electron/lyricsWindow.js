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
  // 窗口按 winExtra（整首歌可能出现的最大行数）预留尺寸；它的差值会补到贴屏边一侧，
  // 使开关译文 / 下一句时窗口位置不变（见 lyricsGeometry.capsuleInset）。
  const winCapSize = () => G.capsuleSize(style, winExtra())
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
    // 横排长度不限制上限（只给一个很大的防呆值），缩放可以拉到任意长。
    return { minW: G.MIN_W, maxW: G.MAX_LEN, minH: G.minCapHeight(e), maxH: G.maxCapHeight(e) }
  }
  // 窗口自身的 min/max 要按「预留行数」算，否则窗口会小于为整首歌预留的固定尺寸，
  // 被 setMaximumSize 夹住后就装不下预留内容。
  const winLimits = (area = capPos ? workAreaFor(capPos) : screen.getPrimaryDisplay().workArea) => {
    const we = winExtra()
    if (style.vertical) {
      const maxLen = G.maxVerticalLength(area)
      return { minW: G.minCapWidth(we), maxW: G.maxCapWidth(we), minH: G.MIN_W + G.V_CHROME, maxH: maxLen + G.V_CHROME }
    }
    return { minW: G.MIN_W, maxW: G.MAX_LEN, minH: G.minCapHeight(we), maxH: G.maxCapHeight(we) }
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

  // 选中胶囊中心所在的那块屏（按「点」判定，不用「矩形交集面积」）。
  // 为什么必须按点：窗口矩形（含上下控制条，比胶囊高得多）与胶囊矩形尺寸差很大，
  // 用 getDisplayMatching 按交集面积选屏时，两者在多屏拼接 / 错位屏上可能各选到不同的屏，
  // 导致「窗口位置 → 胶囊位置」的反算自相矛盾：will-move 会误判越界并取消移动（拖不动、
  // 表现为穿透），内容更新 / 缩放也会按另一块屏重排（弹回）。按点判定只有唯一答案。
  const capCenter = (p = capPos) => { const c = capSize(); return { x: p.x + c.width / 2, y: p.y + c.height / 2 } }
  const workAreaFor = (p = capPos) => screen.getDisplayNearestPoint(capCenter(p)).workArea
  // 拖动边界用「所有屏幕工作区的并集」，而不是光标所在那一块屏：两块屏拼接处的缝不算墙，
  // 浮窗可以跨在两者之间；只有整个桌面真正的最外边界才会挡住它。
  const boundaryArea = () => G.unionWorkArea(screen.getAllDisplays().map((d) => d.workArea)) || workAreaFor(capPos)
  // 贴边过渡（inset）是相对「胶囊中心所在那块屏」算的，不能用所有屏的并集（L 形桌面上并集的
  // x / y 基准会错）。选屏规则与 layout / poll 完全一致，所以「窗口位置 -> 胶囊位置」的反算
  // 与正向布局严格自洽，跨屏拖动不会被误判越界。
  const capFromWindowBounds = (bounds) => {
    // 先用窗口中心估一个胶囊位置来选屏，再用该屏反算；两处都按「点」选屏，结果稳定不震荡。
    const probe = G.capFromWindow(bounds, style, screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }).workArea, capSize(), winCapSize())
    const area = workAreaFor(probe)
    return G.capFromWindow(bounds, style, area, capSize(), winCapSize())
  }
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
    // 按光标所在区域决定是否接收鼠标事件，让空白预留区（未使用的控制条带、控制条两侧、
    // 按钮间隙）能穿透到下层窗口：
    // - 普通模式：只有光标在胶囊上、或在已显示的控制条按钮上时接收；
    // - 锁定模式：只有光标在解锁按钮上时临时接收；
    // - 拖动 / 缩放进行中整窗接收，避免指针移出胶囊导致操作中断。
    // 不接收时用 forward:true，窗口仍能拿到鼠标移动，控制条显隐照常。
    const busy = !!resize
    // 浮窗横跨多块屏时整窗接收：跨（尤其不同缩放的）屏时 Windows 对命中区域的判定不可靠，
    // 若继续按区域穿透，就会出现「另一半拖不动 / 被穿透」。牺牲一点空白区穿透来保证可拖动。
    const spanning = displayCountFor(win.getBounds()) > 1
    const receive = busy || spanning || (style.clickThrough ? (hovered && controlHot) : (capsuleHot || (hovered && controlHot)))
    // 值未变化时不重复调用，避免 Windows 上光标样式来回横跳。
    if (receive === receiveMouse) return
    receiveMouse = receive
    win.setIgnoreMouseEvents(!receive, { forward: true })
  }

  // 窗口矩形与几块屏相交。横跨两块屏（尤其是缩放不同的屏）时，Windows 对跨屏窗口的
  // 命中判定不可靠：光标在「非窗口中心那块屏」的一侧时，既可能收不到鼠标事件（拖不动），
  // 也可能被 setIgnoreMouseEvents 直接穿透。此时不细分命中区域，整窗接收事件来保证可拖动。
  function displayCountFor(rect) {
    let n = 0
    for (const d of screen.getAllDisplays()) {
      const b = d.bounds
      if (rect.x < b.x + b.width && rect.x + rect.width > b.x && rect.y < b.y + b.height && rect.y + rect.height > b.y) n++
    }
    return n
  }

  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height

  // 每 60ms 读一次光标：驱动控制条显隐，并只放行胶囊 / 按钮矩形，其余区域穿透。
  // 命中判定用「胶囊的屏幕坐标 capPos」：窗口摆放时就保证「窗口 bounds + inset = capPos」，
  // 所以 capPos 就是胶囊真实屏幕位置，跨屏 / 贴边过渡时都能对得上。
  function poll() {
    if (!alive() || !win.isVisible() || !capPos) return
    const c = screen.getCursorScreenPoint()
    const cap = capSize()
    const onCapsule = inRect(c, { x: capPos.x, y: capPos.y, width: cap.width, height: cap.height })
    // 按钮位置相对胶囊（inset 在相减中抵消），同样固定在胶囊坐标系里。
    const inset = G.capsuleInset(capPos, style, workAreaFor(capPos), cap, winCapSize())
    const regs = G.regions(style, flip, extra(), side, winExtra(), inset)
    const onControl = G.controlButtons(style, flip, extra(), side, winExtra(), inset).some((r) => inRect(c, {
      x: capPos.x + (r.x - regs.capsule.x),
      y: capPos.y + (r.y - regs.capsule.y),
      width: r.width,
      height: r.height,
    }))
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
      return G.clampCapsule(saved, G.unionWorkArea(areas) || workAreaFor(saved), style, extra())
    }
    return G.defaultCapsule(screen.getPrimaryDisplay().workArea, style, extra())
  }

  // 应用一次“胶囊坐标 -> 窗口外框”的完整布局，并把控制条方向同步给页面。
  // clamp=false 用于行数变化：保持当前原文顶部坐标不动，不把当前歌词顶上去。
  function applyBounds(notify = false, clamp = true, anim = null) {
    if (!alive() || !capPos) return null
    const area = workAreaFor(capPos)
    // 夹取用所有屏的并集，允许胶囊跨在两块屏之间；inset / flip 仍按所在屏（area）算。
    if (clamp) capPos = G.clampCapsule(capPos, boundaryArea(), style, extra())
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
    capPos = capPos && G.isOnScreen(capPos, areas, style, extra()) ? G.clampCapsule(capPos, boundaryArea(), style, extra()) : initialPos()
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
      const bounds = w.getBounds()
      // 位置反算与 layout / poll 用同一套选屏规则（都以「胶囊所在屏」为准，见 capFromWindowBounds）；
      // 边界夹取按所有屏的并集算，允许跨屏但不越出整个桌面。
      capPos = capFromWindowBounds(bounds)
      capPos = G.clampCapsule(capPos, boundaryArea(), style, extra())
      const area = workAreaFor(capPos)
      // 越过控制条变换线时切换按钮方向（横排上 / 下、竖排左 / 右），进度条随之换边。
      const L = G.layout(capPos, style, area, extra(), winExtra())
      // 贴近屏幕上边 / 左边时 inset 会连续变化（窗口不动、胶囊在窗口内滑），必须同步给
      // 渲染端，否则胶囊会停在固定偏移处、看起来没贴到屏幕边。变化很小，用整数比较去抖。
      const nextInset = { x: Math.round(L.inset.x), y: Math.round(L.inset.y) }
      const insetChanged = !sentInset || sentInset.x !== nextInset.x || sentInset.y !== nextInset.y
      // 窗口拖动后可能从「单屏内」变成「横跨多屏」（或反之），穿透策略要立即重算。
      applyMouseEvents()
      if (L.flip !== flip || (L.side && L.side !== side) || L.edge !== edge || insetChanged) {
        flip = L.flip
        side = L.side || side
        edge = L.edge
        sentInset = nextInset
        send('lyrics:layout', layoutPayload(L))
      }
      return L
    }
    // 原生拖动越界拦截：在窗口真正移动「之前」判断，越界就直接 preventDefault 取消这一次移动。
    // 不能像之前那样等 move 之后再 setBounds 回推 —— 那时系统已按光标把窗口拖出去，回推会与
    // 系统拖动来回拉扯，表现为「闪到墙边又接着原位置往前」。提前取消则窗口停在最后一次合法
    // 位置，不闪、也不越界。setBounds 不会触发 will-move，所以这里只取消不主动移窗。
    w.on('will-move', (event, newBounds) => {
      if (!alive() || win !== w || resize) return
      const raw = capFromWindowBounds(newBounds)
      const clamped = G.clampCapsule(raw, boundaryArea(), style, extra())
      if (clamped.x !== raw.x || clamped.y !== raw.y) event.preventDefault()
    })
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
    destroyMenuWindow()
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
      // 固定「贴屏的那条边」，向远离屏幕的方向生长。窗口为整首歌预留尺寸，多出的余量补在
      // 贴屏边一侧（见 lyricsGeometry.capsuleInset），所以用 anchorCapsuleDocked 补偿后
      // 窗口位置前后完全不变 —— 开关译文 / 下一句时不再移动透明窗，也就不会抖。
      capPos = G.anchorCapsuleDocked(capPos, prevCap, nextCap, style, area)
    } else if (wasVertical && !style.vertical) {
      // 竖排切横排：以旧竖排胶囊的底边为锚点，避免横排按左上角定位导致整体跳位。
      capPos = G.anchorVerticalToHorizontal(capPos, prevCap, nextCap)
    } else if (style.vertical) {
      capPos = G.anchorCapsule(capPos, prevCap, nextCap, { vertical: true, side })
    }
    applyWindowLimits(area)
    // 开关译文 / 下一句时不要重新夹取位置：胶囊在窗口内固定、窗口尺寸按整首歌预留，
    // clampCapsule 会因为 capSize 变化在贴边处把胶囊顶走（表现为开关行时整体跳一下）。
    if (!(sameOrientation && lineToggle)) capPos = G.clampCapsule(capPos, boundaryArea(), style, extra())
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
  //
  // 菜单窗常驻复用（预加载）而不是每次新建：新建 + loadFile 实测约 190ms，点开有明显等待；
  // 复用后再次打开只需 show()，几乎瞬时，观感利落（不依赖任何 CSS 动画）。
  //
  // 「关闭」不调用 hide()，而是把窗口移到所有屏幕之外（视觉等同关闭）：透明窗 hide 后再 show
  // 会经历一次隐藏/显示转换，表现为菜单先消失再出现；常驻 shown 状态则不存在该转换。
  // 每块屏一个 1×1 的"收纳点"：窗口关闭时不跨屏移动（跨 DPI 移动会触发内容重缩放，
  // 表现为菜单内容被缩放裁切一下再恢复），而是原地缩小到 1×1 并保持不透明 —— 视觉不可见。
  // 下次打开前若光标所在屏与窗口当前屏缩放不同，直接销毁重建（新窗口创建时就在目标屏）。
  const menuParkPoint = (disp) => ({ x: disp.workArea.x + disp.workArea.width - 1, y: disp.workArea.y + disp.workArea.height - 1 })
  function ensureMenuWindow(disp) {
    if (menuWin && !menuWin.isDestroyed()) return menuWin
    const park = menuParkPoint(disp || screen.getPrimaryDisplay())
    const mw = menuWin = new BrowserWindow({
      x: park.x, y: park.y, width: 1, height: 1,
      frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true,
      // 先隐藏创建，加载完成后原地 park（不抢焦点）常驻显示；
      // 打开 / 关闭都不跨屏移动，避免 DPI 重缩放闪动。
      alwaysOnTop: true, focusable: true, show: false,
      webPreferences: { preload: menuPreload, contextIsolation: true, sandbox: true },
    })
    mw.setAlwaysOnTop(true, 'pop-up-menu')
    const mwContents = mw.webContents
    menuSenders.add(mwContents)
    mw.__ready = false
    mw.on('closed', () => {
      menuSenders.delete(mwContents)
      if (menuWin === mw) menuWin = null
    })
    mwContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mw.loadFile(path.join(__dirname, 'lyricsMenu.html'))
    mwContents.once('did-finish-load', () => {
      mw.__ready = true
      // 常驻显示在屏幕外：后续打开只是把它移回光标处，不存在隐藏/显示转换。
      if (!mw.isDestroyed()) {
        mw.setBounds({ ...menuParkPoint(disp || screen.getPrimaryDisplay()), width: 1, height: 1 })
        mw.showInactive(); mw.__shown = true
      }
    })
    return mw
  }

  async function openMenuWindow() {
    if (!alive()) return
    // 去重：右键会同时触发渲染端 onContextMenu 与 Windows 的 system-context-menu（后者延迟 60ms），
    // 两条路径各调一次本函数；若不去重，第二次会把刚显示的菜单先藏再显示（表现为「消失一下再出现」）。
    // 用时间窗把这一对调用合并成一次。
    const now = Date.now()
    if (openMenuWindow.__at && now - openMenuWindow.__at < 400) return
    openMenuWindow.__at = now
    menuItems = menu() || []
    const p = screen.getCursorScreenPoint()
    const dstDisplay = screen.getDisplayNearestPoint(p)
    // 光标所在屏与菜单窗当前屏缩放不同（如 1.25 vs 1.5）时，直接销毁重建：
    // 新窗口创建时就在目标屏，从未跨屏，不存在 DPI 重缩放闪动。
    const curDisplay = menuWin && !menuWin.isDestroyed()
      ? screen.getDisplayNearestPoint(menuWin.getBounds().x < 0 || menuWin.getBounds().y < 0
        ? { x: menuWin.getBounds().x, y: menuWin.getBounds().y }
        : { x: menuWin.getBounds().x + Math.round(menuWin.getBounds().width / 2), y: menuWin.getBounds().y + Math.round(menuWin.getBounds().height / 2) })
      : null
    if (curDisplay && curDisplay.scaleFactor !== dstDisplay.scaleFactor) destroyMenuWindow()
    const mw = ensureMenuWindow(dstDisplay)
    if (mw.isDestroyed()) return
    mw.__area = screen.getDisplayNearestPoint(p).workArea
    mw.__anchor = p
    // 打开期间先解除「失焦即关闭」：show / focus 过程中可能出现瞬时失焦，若此时已武装会
    // 立刻把菜单关掉（表现为「闪一下又出现」）。等窗口显示、焦点稳定后再武装。
    mw.webContents.send('menu:disarm')
    const payload = menuItems.map((it) => ({ type: it.type, label: it.label, checked: !!it.checked }))
    // 等页面加载完成（仅首次），再由主进程主动调用渲染端重建列表并同步取回尺寸，
    // 一次性摆位并显示。不依赖 rAF（隐藏窗口的 rAF 会停），也不依赖任何动画。
    if (!mw.__ready) await new Promise((resolve) => { mw.webContents.once('did-finish-load', () => resolve()) })
    if (mw.isDestroyed() || menuWin !== mw) return
    let size
    try { size = await mw.webContents.executeJavaScript(`window.__renderMenu(${JSON.stringify(payload)})`, true) } catch { size = null }
    if (mw.isDestroyed() || menuWin !== mw) return
    if (!Array.isArray(size) || !(size[0] > 0) || !(size[1] > 0)) size = [220, 200]
    placeMenuWindow(mw, size)
  }

  // 把菜单窗摆到锚点附近。
  //
  // 窗口常驻显示，若直接 setBounds（位置 + 尺寸一起改），Windows 会先按「旧尺寸」把窗口
  // 画到新位置，随后尺寸才生效 —— 观感就是「先放大/缩小一下再回正常尺寸」的闪动。
  // 这里把整个摆放过程用「完全透明」遮住：调整尺寸、移到目标位置全部在 opacity=0 下完成，
  // 最后一步才恢复不透明，因此任何中间态都不会被看到。
  function placeMenuWindow(mw, size) {
    if (!mw || mw.isDestroyed()) return
    const area = mw.__area || screen.getDisplayNearestPoint(mw.__anchor || screen.getCursorScreenPoint()).workArea
    const anchor = mw.__anchor || screen.getCursorScreenPoint()
    const w = Math.max(1, Math.round(size[0]))
    const h = Math.max(1, Math.round(size[1]))
    const x = Math.max(area.x + 8, Math.min(anchor.x, area.x + area.width - w - 8))
    const y = Math.max(area.y + 8, Math.min(anchor.y, area.y + area.height - h - 8))
    const token = (mw.__placeToken = (mw.__placeToken || 0) + 1)
    mw.setOpacity(0)
    mw.setBounds({ x, y, width: w, height: h })
    if (!mw.__shown) { mw.showInactive(); mw.__shown = true }
    mw.setIgnoreMouseEvents(false)
    setTimeout(() => {
      if (!mw || mw.isDestroyed() || mw.__placeToken !== token) return
      // 尺寸 / 位置已就位（上面那次 setBounds 在 opacity=0 下已完成），恢复不透明并聚焦。
      mw.setOpacity(1)
      mw.focus()
      // 延迟武装「失焦即关闭」：避开 show / focus 期间可能的瞬时失焦。
      if (mw.__armTimer) clearTimeout(mw.__armTimer)
      mw.__armTimer = setTimeout(() => {
        mw.__armTimer = null
        if (!mw || mw.isDestroyed() || !mw.isVisible()) return
        if (!mw.isFocused()) { closeMenuWindow(); return }
        mw.webContents.send('menu:arm')
      }, 220)
    }, 0)
  }

  function closeMenuWindow() {
    // 关闭 = 原地缩小到 1×1 并保持不透明（视觉不可见），不跨屏移动、不 hide。
    // 跨 DPI 屏移动会触发内容重缩放（菜单内容被缩放裁切一下再恢复）；hide→show 有闪现转换。
    // 原地收纳既不跨屏也不隐藏，两种问题都避开。下次打开若光标在另一缩放屏则直接重建。
    const mw = menuWin
    if (!mw || mw.isDestroyed()) return
    if (mw.__armTimer) { clearTimeout(mw.__armTimer); mw.__armTimer = null }
    mw.__placeToken = (mw.__placeToken || 0) + 1 // 取消未完成的摆放回调
    mw.setOpacity(1)                             // 复位透明度，避免残留全透明
    mw.webContents.send('menu:disarm')
    const d = screen.getDisplayNearestPoint({ x: mw.getBounds().x, y: mw.getBounds().y })
    mw.setBounds({ ...menuParkPoint(d), width: 1, height: 1 })
    mw.setIgnoreMouseEvents(true, { forward: false })
  }

  // 真正销毁（歌词窗口关闭 / 应用退出时）
  function destroyMenuWindow() {
    const mw = menuWin
    menuWin = null
    if (mw && mw.__armTimer) { clearTimeout(mw.__armTimer); mw.__armTimer = null }
    if (mw && !mw.isDestroyed()) mw.destroy()
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
    // 位置夹取用所有屏的并集：跨屏的浮窗缩放时不能被单块屏工作区拉回中心所在屏。
    capPos = G.clampCapsule({ x, y }, boundaryArea(), style, extra())
    const L = G.layout(capPos, style, workAreaFor(capPos), extra(), winExtra())
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
    capPos = G.clampCapsule(capPos, boundaryArea(), style, extra())
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
  ipcMain.on('menu:close', (e) => { if (fromMenu(e)) closeMenuWindow() })
  ipcMain.on('lyrics:resize-start', (e, dir, x, y) => {
    if (!fromLyrics(e) || style.clickThrough) return
    // 尺寸上限 / 位置夹取都用所有屏的并集：跨屏浮窗缩放时不被单块屏限制或拉回。
    const area = boundaryArea()
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
        // 夹取用所有屏的并集：跨屏的浮窗不能被单屏工作区拉回某一侧（否则内容一更新就弹回去）。
        capPos = G.clampCapsule(capPos, boundaryArea(), style, extra())
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
