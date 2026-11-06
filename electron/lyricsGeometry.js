// 悬浮歌词窗口的几何计算（纯函数，便于单元测试）
//
// 核心：以“歌词胶囊”（那块深色背景）为基准做定位与夹取，窗口只是它的紧贴外框。
// 这样胶囊可以真正贴到屏幕的左 / 右 / 上 / 下边缘，透明边距也很小。
//
// 窗口结构（外框 = 胶囊 + 控制条）：
//   控制条在胶囊上方（flip = 'above'）或下方（flip = 'below'）
//   —— 胶囊在屏幕上 1/3 区域时按钮放下方，避免贴顶时按钮被顶出屏幕；否则放上方
//
// 胶囊高度按“当前实际会显示的行数”计算：原文 + 可选译文 + 可选下一句。
// 这样视觉黑块、窗口外框和鼠标命中区域一致，切换翻译时不会在下方留下透明空白。
const SPEC = require('./lyricsVisualSpec.json')
const { geometry: GEO, fonts: FONTS, weights: WEIGHTS, aligns: ALIGNS, backgroundModes: MODES, defaultStyle: DEFAULT_STYLE } = SPEC

// 统一常量来源：lyricsVisualSpec.json。这样窗口布局、CSS 变量和设置面板不会各写一份。
const PAD = GEO.pad
const BORDER = GEO.border
// 长度轴（横排的左右 / 竖排的上下）两侧留出的透明安全边：
// 横排时胶囊宽度与窗口等宽，边框正好压在窗口最外一列像素；在非整数 DPI（如 125%）下
// 最外那半像素会被合成取整丢掉，表现为右边框被吃掉。两侧各留 EDGE_BLEED 后，边框不再
// 落在窗口最外缘。（带控制条带的那条轴本来就有 38px 余量，不受影响。）
const EDGE_BLEED = GEO.edgeBleed
const V_PAD = GEO.vPad
const H_PAD = GEO.hPad
const V_CHROME = V_PAD * 2 + BORDER
const ROW_GAP = GEO.rowGap
const COLUMN_EXTRA_RATIO = GEO.columnExtraRatio
const LINE_RATIO = GEO.lineRatio
const SUB_RATIO = GEO.subRatio
const CONTROL_H = GEO.controlH
const SIDE_W = CONTROL_H
const CONTROL_BTN_W = GEO.controlBtnW
const CONTROL_BTN_H = GEO.controlBtnH
const CONTROL_BTN_GAP = GEO.controlBtnGap
const CONTROL_BTN_COUNT = GEO.controlBtnCount
const CONTROL_BTN_COUNT_LOCKED = GEO.controlBtnCountLocked
const MIN_W = GEO.minW
const MAX_W = GEO.maxW
// 横排长度不再受 MAX_W 限制（用户要求「不限制横排长度」）。这里给一个很大的上限，
// 仅用于防止极端输入产生非法尺寸；竖向长度仍按 MAX_W 与实际屏幕高度限制。
const MAX_LEN = 20000
const MIN_FONT = GEO.minFont
const MAX_FONT = GEO.maxFont
const DEFAULT_W = GEO.defaultW
const DEFAULT_FONT = GEO.defaultFont
const FLIP_RATIO = GEO.flipRatio


const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, d) => (Number.isFinite(v) ? v : d)
const pick = (v, list, d) => (list.includes(v) ? v : d)

/** 把任意输入整理成合法、完整的样式对象（缺省值 = 深色玻璃 / 白字 / 显示译文） */
function normalizeStyle(input) {
  const s = input && typeof input === 'object' ? input : {}
  const weight = Number(s.weight)
  return {
    fontSize: Math.round(clamp(num(Number(s.fontSize), DEFAULT_FONT), MIN_FONT, MAX_FONT)),
    fontFamily: pick(s.fontFamily, FONTS, DEFAULT_STYLE.fontFamily),
    weight: WEIGHTS.includes(weight) ? weight : DEFAULT_STYLE.weight,
    align: pick(s.align, ALIGNS, DEFAULT_STYLE.align),
    backgroundMode: pick(s.backgroundMode, MODES, s.colorMode === 'custom' ? DEFAULT_STYLE.backgroundMode : pick(s.colorMode, MODES, DEFAULT_STYLE.backgroundMode)),
    textColor: /^#[0-9a-f]{6}$/i.test(String(s.textColor || s.customColor || '')) ? String(s.textColor || s.customColor) : DEFAULT_STYLE.textColor,
    textColorCustom: s.textColorCustom !== undefined ? !!s.textColorCustom : s.colorMode === 'custom',
    customImage: !!s.customImage,
    opacity: Math.round(clamp(num(Number(s.opacity), DEFAULT_STYLE.opacity), 0, 1) * 100) / 100,
    frost: Math.round(clamp(num(Number(s.frost), num(Number(s.blur), DEFAULT_STYLE.frost)), 0, 48)),
    showBorder: s.showBorder !== false,
    showProgress: s.showProgress !== false,
    showTranslation: s.showTranslation !== false,
    showNext: !!s.showNext,
    clickThrough: !!s.clickThrough,
    vertical: !!s.vertical,
    // 逐字（卡拉OK）扫色开关；没有词级数据时渲染层自动退回普通文本
    karaoke: s.karaoke !== false,
    // 横排长度不限制上限（用户要求）；竖排长度仍受 MAX_W 限制（见 clampVerticalLength）。
    width: Math.round(clamp(num(Number(s.width), DEFAULT_W), MIN_W, MAX_LEN)),
  }
}

const lineHeight = (fontSize) => fontSize * LINE_RATIO
const subHeight = (fontSize) => lineHeight(fontSize) * SUB_RATIO
// 竖排时文字沿列宽排版：列宽取文字行高（横排时的高度）再加一点安全余量
const columnExtra = (fontSize) => Math.max(2, fontSize * COLUMN_EXTRA_RATIO)
const mainColumnWidth = (fontSize) => lineHeight(fontSize) + columnExtra(fontSize)
const subColumnWidth = (fontSize) => subHeight(fontSize) + columnExtra(fontSize)

/**
 * 由“样式 + 当前歌词帧”推出实际需要预留的布局行。
 *
 * 关键：译文行按“整首歌是否有译文”预留，而不是按当前句是否有译文。
 * 双语歌曲里的伴奏 / 间奏句往往没有译文，如果按当前句判断，
 * 胶囊会一会儿 1 行、一会儿 2 行，在贴近屏幕边缘时来回移动 / 被裁。
 */
function layoutFlags(style, state = {}) {
  const s = normalizeStyle(style)
  const st = state || {}
  // 行预留按“整首歌”判断（由 store 计算 hasTranslation / hasNext），
  // 这样一首歌从开始到结束行数恒定，伴奏 / 间奏句不会让胶囊尺寸变化，
  // 也就不会出现移动、歌词偏移或被窗口裁掉。
  return {
    showTranslation: !!s.showTranslation && !!st.hasTranslation,
    showNext: !!s.showNext && !!st.hasNext,
  }
}

/**
 * 计算当前胶囊真实需要的行数。
 * extra.showTranslation / extra.showNext 表示当前数据里确实有译文 / 下一句。
 */
function visibleRows(style, extra = {}) {
  const s = normalizeStyle(style)
  let rows = 1
  const showTranslation = extra.showTranslation === undefined ? s.showTranslation : !!extra.showTranslation
  const showNext = extra.showNext === undefined ? s.showNext : !!extra.showNext
  if (showTranslation) rows += 1
  if (showNext) rows += 1
  return rows
}

// 胶囊尺寸：横排时按行数算高、宽度由设置决定；竖排时反过来，按列数算宽、长度由设置决定。
// 开关译文 / 下一句时只沿对应方向伸缩，原文位置保持不动。
function capsuleSize(style, extra = {}) {
  const s = normalizeStyle(style)
  const lines = visibleRows(s, extra)
  if (s.vertical) {
    // style.width 是竖排文字方向上的内容长度，胶囊还要加上两端内边距与边框，避免文字到底部被裁掉。
    // 每列宽度都必须按列宽公式来算，CSS 会使用完全相同的 calc，确保视觉与命中区域一致。
    const textSpan = mainColumnWidth(s.fontSize) + Math.max(0, lines - 1) * (ROW_GAP + subColumnWidth(s.fontSize))
    const width = Math.round(H_PAD * 2 + BORDER + textSpan)
    return { width, height: s.width + V_CHROME }
  }
  const height = Math.round(V_PAD * 2 + BORDER + lineHeight(s.fontSize) + Math.max(0, lines - 1) * (ROW_GAP + Math.round(subHeight(s.fontSize))))
  return { width: s.width, height }
}

/**
 * 判断字幕当前在屏幕的哪个部。判断口径与按钮位置一致：
 * - 横排按钮在上，说明字幕在底部；按钮在下，说明字幕在顶部。
 * - 竖排按钮在右，说明字幕在左部；按钮在左，说明字幕在右部。
 */
function capsulePart(opts = {}) {
  if (opts.vertical) return opts.side === 'right' ? 'left' : 'right'
  return opts.flip === 'above' ? 'bottom' : 'top'
}

/**
 * 开关译文 / 下一句时，固定靠近边框的边，拉动远离边框的边：
 * - 字幕在底部：固定下边，向上长高。
 * - 字幕在顶部：固定上边，向下长高。
 * - 字幕在左部：固定左边，向右长宽。
 * - 字幕在右部：固定右边，向左长宽。
 *
 * 返回的位移表示：窗口已经移到最终外框后，渲染端要让胶囊先从旧位置滑到新位置。
 * 行减少时 next - prev 为负，反向滑回即可。
 */
function capsuleGrowthShift(prevCap, nextCap, opts = {}) {
  const part = opts.part || capsulePart(opts)
  if (part === 'bottom') return { x: 0, y: Math.round(nextCap.height - prevCap.height) }
  if (part === 'right') return { x: Math.round(nextCap.width - prevCap.width), y: 0 }
  return { x: 0, y: 0 }
}

function anchorCapsule(capPos, prevCap, nextCap, opts = {}) {
  const grow = capsuleGrowthShift(prevCap, nextCap, opts)
  return {
    x: Math.round(capPos.x - grow.x),
    y: Math.round(capPos.y - grow.y),
  }
}

/**
 * 与 anchorCapsule 相同，但把「贴屏边一侧补回的预留余量」也考虑进去（见 dockBlend）。
 *
 * 开关译文 / 下一句时，只有到达贴屏边（横排贴底、竖排贴右）才需要完整固定那条边；
 * 在控制条变换线附近只有一部分边被固定，这样窗口位置（capsuleInset 的 slack 项同样按比例）
 * 前后完全一致，不会因为透明窗移动而抖。远离变换线时 t=1，退化为原来的完整锚定。
 */
function anchorCapsuleDocked(capPos, prevCap, nextCap, style, workArea) {
  const s = normalizeStyle(style)
  if (s.vertical) {
    const t = dockBlend(capPos, prevCap, workArea, true)
    return { x: Math.round(capPos.x - (nextCap.width - prevCap.width) * t), y: Math.round(capPos.y) }
  }
  const t = dockBlend(capPos, prevCap, workArea, false)
  return { x: Math.round(capPos.x), y: Math.round(capPos.y - (nextCap.height - prevCap.height) * t) }
}

/**
 * 竖排切横排：横排胶囊保持旧竖排胶囊的底边 y 坐标不变。
 * 横排高度通常小于竖排胶囊高度，因此需要向上移动，避免整体跳到左上角。
 */
function anchorVerticalToHorizontal(capPos, prevCap, nextCap) {
  return {
    x: Math.round(capPos.x),
    y: Math.round(capPos.y + prevCap.height - nextCap.height),
  }
}

/**
 * 切歌时下一首歌词尚未加载完成，先用上一首的歌曲级布局状态维持胶囊尺寸。
 * 页面仍会收到空歌词状态，避免显示上一首内容；等 lyricsReady=true 后再切换尺寸。
 */
function resolveLayoutState(next, prev) {
  return next?.lyricsReady === false ? (prev || {}) : (next || {})
}

/**
 * 进度条贴向胶囊最靠近屏幕的那条边（与按钮朝屏幕中心相反）。
 * 方向必须跟随文字排版模式：横排只在上 / 下之间选（进度条是横线），
 * 竖排只在左 / 右之间选（进度条是竖线），避免出现方向不对的进度条。
 */
function nearestEdge(capPos, capSize, workArea, vertical = false) {
  const candidates = vertical ? ['left', 'right'] : ['top', 'bottom']
  const dist = {
    top: capPos.y - workArea.y,
    bottom: (workArea.y + workArea.height) - (capPos.y + capSize.height),
    left: capPos.x - workArea.x,
    right: (workArea.x + workArea.width) - (capPos.x + capSize.width),
  }
  let best = candidates[0]
  for (const k of candidates) if (dist[k] < dist[best]) best = k
  return best
}

/** 横排：控制条放在上方还是下方 */
function controlFlip(capPos, capSize, workArea) {
  return capPos.y + capSize.height / 2 <= workArea.y + workArea.height * FLIP_RATIO ? 'below' : 'above'
}

/** 竖排：胶囊在桌面左半边时控制条放右侧，否则放左侧（总是朝向屏幕中央） */
function controlSide(capPos, capSize, workArea) {
  return capPos.x + capSize.width / 2 <= workArea.x + workArea.width / 2 ? 'right' : 'left'
}

/**
 * 收掉预留带的「过渡距离」：在这段距离内，朝屏幕外那条控制条带线性收掉。
 *
 * 目的是让胶囊能真正贴到工作区上边 / 左边，而不只是贴到窗口的预留带内侧。
 *
 * 约束：过渡区必须完全落在「控制条不在该侧」的区间内，否则收掉预留带会把控制条裁掉。
 */
function blendDistance(capSize, workArea, vertical) {
  const margin = vertical ? SIDE_W : CONTROL_H
  // 横排的翻转线在上方 1/3 处、竖排在 1/2 处，各留 20% 余量作为上限。
  const axis = vertical ? workArea.width : workArea.height
  const extent = vertical ? capSize.width : capSize.height
  const ratio = vertical ? 0.5 : FLIP_RATIO
  const flipLimit = Math.max(margin * 1.5, axis * ratio - extent / 2)
  // 取 6 倍预留带宽：反算斜率 = 1 - 1/6 ≈ 0.83，胶囊最多比手指快约 1.2 倍，几乎察觉不到；
  // 同时把影响范围限制在贴边后的 228px 内，正常位置仍是原来的固定偏移。
  const desired = margin * 6
  return Math.max(margin * 1.5, Math.min(desired, flipLimit * 0.8))
}

/**
 * 「窗口为整首歌预留的尺寸」比「胶囊实际尺寸」多出来的余量，应该补到贴屏边一侧。
 *
 * 为什么：a49efc6 之后窗口位置 = 胶囊位置 - inset。这样越过控制条变换线（flip / side）
 * 时窗口不动，但「开关译文 / 下一句」时胶囊要沿贴屏边生长，capPos 会移动，窗口也就跟着
 * 移动 —— 透明置顶窗每次移动都会被 Windows 重新合成，在 125% 这类非整数 DPI 下表现为
 * 胶囊抖动。要消除它，就得让这部分「预留余量」落在贴屏边一侧：胶囊越长，窗口内偏移越小
 * （朝贴屏边收），少显示了几行，就在对应侧补回多少像素，于是窗口位置在开关行前后完全不变。
 *
 * 但这只在该侧确实是贴屏边时成立。控制条变换线附近还没有明确的贴屏边，余量必须随位置
 * 连续地 0 -> 1 过渡，否则拖动过线时窗口位置会突变（正是 a49efc6 修掉的跳变）。这里用与
 * 贴边收带相同尺度的过渡带（见 blendDistance），保证窗口位置始终是胶囊位置的连续函数。
 */
function dockBlend(capPos, size, workArea, vertical, band) {
  const center = vertical ? capPos.x + size.width / 2 : capPos.y + size.height / 2
  const flipLine = vertical ? workArea.x + workArea.width / 2 : workArea.y + workArea.height * FLIP_RATIO
  const span = band || blendDistance(size, workArea, vertical)
  if (span <= 0) return center >= flipLine ? 1 : 0
  return clamp((center - flipLine) / span + 0.5, 0, 1)
}

/**
 * 胶囊在窗口内的偏移（窗口左上角为原点）。
 *
 * 正常是「朝屏幕外那一侧控制条带的宽度」：横排取上方 CONTROL_H，竖排取左侧 SIDE_W。
 * 窗口两侧各留一条带，这样切换按钮方向（flip / side）时胶囊屏幕位置完全不动，不会抖。
 *
 * 但原生拖动（-webkit-app-region: drag，触控唯一跟手的方式）不允许窗口越过工作区的
 * 上边 / 左边。窗口被那条预留带顶住，胶囊就永远差一条带贴不到屏幕边（表现为顶部一片
 * 空白拉不上去）。而贴近屏幕边时朝外那条带本来就是空的——此时控制条必然在另一侧。
 *
 * 所以贴近屏幕边时把这条带按比例收掉：窗口停在屏幕边上，胶囊自己走完最后一段。
 * 收掉的比例与「离屏幕边的距离」成正比（见 blendDistance），保证 窗口位置 ←→ 胶囊位置
 * 严格互逆（见 capFromWindow）：过渡区内胶囊位移略快于手指，越过后回到 1:1。
 *
 * 偏移里还包含「窗口为整首歌预留的余量」补到贴屏边一侧的部分（见 dockBlend）：窗口尺寸
 * 按 winCap 算、胶囊按当前尺寸算，二者之差 slack 在贴屏边一侧补回。这样开关译文 / 下一句
 * 时窗口位置不变，只有胶囊在窗口内滑动，避免透明窗重新合成导致的抖动。
 */
function capsuleInset(capPos, style, workArea, capSize, winCap) {
  const s = normalizeStyle(style)
  const size = capSize || capsuleSize(s, {})
  const win = winCap || size
  if (s.vertical) {
    const d = Math.max(0, capPos.x - workArea.x)
    const blend = blendDistance(size, workArea, true)
    const slack = Math.max(0, win.width - size.width)
    // y 是长度轴方向的安全边（竖排长度轴为纵向）：固定留出，避免下边框压在窗口最外缘。
    return { x: PAD + SIDE_W * clamp(d / blend, 0, 1) + slack * dockBlend(capPos, size, workArea, true, blend), y: PAD + EDGE_BLEED }
  }
  const d = Math.max(0, capPos.y - workArea.y)
  const blend = blendDistance(size, workArea, false)
  const slack = Math.max(0, win.height - size.height)
  // x 是长度轴方向的安全边（横排长度轴为横向）：固定留出，避免右边框压在窗口最外缘。
  return { x: PAD + EDGE_BLEED, y: PAD + CONTROL_H * clamp(d / blend, 0, 1) + slack * dockBlend(capPos, size, workArea, false, blend) }
}

/**
 * 横排窗口外框。
 *
 * 窗口尺寸恒为「这首歌预留的最大行数 + 上下各一条控制条带」，位置 = 胶囊位置 - 偏移。
 * 偏移由 capsuleInset 决定：正常为 CONTROL_H（与 flip 无关，所以越过变换线不抖），
 * 贴近工作区上边时连续收小到 0，让窗口能停在屏幕边上。
 */
function windowRect(capPos, capSize, winCap = capSize, inset = null) {
  const capTop = inset ? inset.y : PAD + CONTROL_H
  // 长度轴（横向）两侧各留 EDGE_BLEED，避免胶囊边框落在窗口最外一列像素被裁。
  const width = winCap.width + PAD * 2 + EDGE_BLEED * 2
  // 高度按「这首歌预留的最多行数」算：窗口在一首歌内保持不变。
  const height = winCap.height + PAD * 2 + CONTROL_H * 2
  const x = capPos.x - PAD - EDGE_BLEED
  // 窗口位置只由 capPos 与偏移决定，与 flip / side 无关。
  //
  // 为什么不用「按贴屏边锚定」：那种写法下越过控制条变换线要同时改窗口位置与渲染端的
  // 按钮侧，而窗口位移走原生同步调用、按钮侧走异步 IPC，两者必然差一帧，表现为越界
  // 瞬间胶囊跳一下（实测 41px）。改成窗口只跟 capPos 走之后，越界只需要切换按钮渲染在
  // 哪一侧，窗口与胶囊都不动。贴屏边的生长改由 capPos 体现（见 anchorCapsule）。
  const y = capPos.y - capTop
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/**
 * 竖排窗口外框。
 * 与横排同理：左右各预留一条控制条宽度，胶囊在窗口内的 x 恒为 PAD + SIDE_W，
 * side 只改变控制条画在哪一侧，窗口外框不变 -> 胶囊不会抖。
 */
function sideWindowRect(capPos, capSize, side, winCap = capSize, inset = null) {
  const capLeft = inset ? inset.x : PAD + SIDE_W
  const width = winCap.width + PAD * 2 + SIDE_W * 2
  // 长度轴（纵向）两侧各留 EDGE_BLEED，避免胶囊边框落在窗口最外一行像素被裁。
  const height = winCap.height + PAD * 2 + EDGE_BLEED * 2
  // 与横排同理：窗口位置只由 capPos 与偏移决定，与 side 无关。
  const x = capPos.x - capLeft
  const y = capPos.y - PAD - EDGE_BLEED
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/**
 * windowRect / sideWindowRect 的反向计算：由原生拖动后的窗口位置反推胶囊左上角。
 * 必须是 capsuleInset 的严格逆运算，否则拖动时胶囊会漂移或卡在离屏幕边一条带的位置。
 *
 * 过渡区内 window = capPos - margin * (capPos / blend)，反解得 capPos = window / (1 - margin/blend)；
 * 过渡区外 window = capPos - margin，直接加回 margin 即可。
 *
 * 贴屏边一侧还会补回预留余量（见 capsuleInset 的 slack 项），它同样依赖 capPos，无法直接
 * 反解。但这部分斜率很小（收带 + 补回的总斜率 < 1），用不动点迭代即可稳定收敛；一次拖动
 * 内尺寸不变，因此迭代几步就足够精确（见下方 solveInset）。
 */
function capFromWindow(win, style, workArea, capSize, winCap) {
  const s = normalizeStyle(style)
  const size = capSize || capsuleSize(s, {})
  const win2 = winCap || size
  if (s.vertical) {
    const slack = Math.max(0, win2.width - size.width)
    let x
    if (slack === 0) {
      const blend = blendDistance(size, workArea, true)
      const slope = 1 - SIDE_W / blend
      const w = win.x - workArea.x
      const d = w >= blend * slope ? w + SIDE_W : w / slope
      x = workArea.x + d
    } else {
      x = win.x + PAD + SIDE_W
      for (let i = 0; i < 40; i++) x = win.x + capsuleInset({ x, y: win.y }, s, workArea, size, win2).x
    }
    return { x: Math.round(x), y: Math.round(win.y + PAD + EDGE_BLEED) }
  }
  const slack = Math.max(0, win2.height - size.height)
  let y
  if (slack === 0) {
    const blend = blendDistance(size, workArea, false)
    const slope = 1 - CONTROL_H / blend
    const w = win.y - workArea.y
    const d = w >= blend * slope ? w + CONTROL_H : w / slope
    y = workArea.y + d
  } else {
    y = win.y + PAD + CONTROL_H
    for (let i = 0; i < 40; i++) y = win.y + capsuleInset({ x: win.x, y }, s, workArea, size, win2).y
  }
  return { x: Math.round(win.x + PAD + EDGE_BLEED), y: Math.round(y) }
}

/**
 * 胶囊与控制条在窗口内的矩形（窗口左上角为原点），供布局与命中测试用。
 *
 * 布局规则（对应「固定贴屏边、向远离屏幕方向生长」）：
 *
 * - 横排字幕在底部：胶囊下边固定，向上长高；
 * - 横排字幕在顶部：胶囊上边固定，向下长高；
 * - 竖排字幕在左部：胶囊左边固定，向右长宽；
 * - 竖排字幕在右部：胶囊右边固定，向左长宽。
 *
 * 同时保证：
 * 1. 控制条紧贴胶囊（在胶囊朝屏幕中心的一侧），胶囊变矮时不会留出空白；
 * 2. 窗口按 winExtra（这首歌可能出现的最大行数）预留，多出的空间永远落在
 *    「远离贴屏边」的一侧，既不夹在按钮与胶囊之间，也仍在窗口内可点击。
 */
function regions(style, flip, extra = {}, side = 'right', winExtra = extra, inset = null) {
  const s = normalizeStyle(style)
  const cap = capsuleSize(s, extra)
  const winCap = capsuleSize(s, winExtra)
  if (s.vertical) {
    const winW = winCap.width + PAD * 2 + SIDE_W * 2
    const winH = winCap.height + PAD * 2 + EDGE_BLEED * 2
    // 胶囊在窗口内的偏移与 side / 行数无关；贴近屏幕左边时会收小（见 capsuleInset），
    // 让窗口能停在屏幕边上、胶囊仍然贴住屏幕边。
    const capX = inset ? inset.x : PAD + SIDE_W
    // 长度轴（纵向）固定留出安全边，避免下边框压在窗口最外缘。
    const capY = inset ? inset.y : PAD + EDGE_BLEED
    return {
      capsule: { x: capX, y: capY, width: cap.width, height: cap.height },
      control: {
        x: side === 'left' ? capX - SIDE_W : capX + cap.width,
        y: capY, width: SIDE_W, height: cap.height,
      },
      window: { width: winW, height: winH },
    }
  }
  const winH = winCap.height + PAD * 2 + CONTROL_H * 2
  const winW = winCap.width + PAD * 2 + EDGE_BLEED * 2
  // 胶囊在窗口内的偏移与 flip / 行数无关；贴近屏幕上边时会收小（见 capsuleInset）。
  const capY = inset ? inset.y : PAD + CONTROL_H
  // 长度轴（横向）固定留出安全边，避免右边框压在窗口最外缘。
  const capX = inset ? inset.x : PAD + EDGE_BLEED
  return {
    capsule: { x: capX, y: capY, width: cap.width, height: cap.height },
    control: {
      x: capX, y: flip === 'above' ? capY - CONTROL_H : capY + cap.height,
      width: cap.width, height: CONTROL_H,
    },
    window: { width: winW, height: winH },
  }
}

/**
 * 控制按钮在窗口内的实际矩形，用于鼠标穿透判定。
 * 容器与按钮间空隙不属于按钮区域：主进程只放行这些矩形，其余控制条区域继续穿透。
 */
function controlButtons(style, flip, extra = {}, side = 'right', winExtra = extra, inset = null) {
  const s = normalizeStyle(style)
  const control = regions(s, flip, extra, side, winExtra, inset).control
  const count = s.clickThrough ? CONTROL_BTN_COUNT_LOCKED : CONTROL_BTN_COUNT
  const rects = []
  if (s.vertical) {
    const rowH = count * CONTROL_BTN_H + Math.max(0, count - 1) * CONTROL_BTN_GAP
    const x = Math.round(control.x + (control.width - CONTROL_BTN_W) / 2)
    const y0 = Math.round(control.y + (control.height - rowH) / 2)
    for (let i = 0; i < count; i++) rects.push({ x, y: y0 + i * (CONTROL_BTN_H + CONTROL_BTN_GAP), width: CONTROL_BTN_W, height: CONTROL_BTN_H })
  } else {
    const rowW = count * CONTROL_BTN_W + Math.max(0, count - 1) * CONTROL_BTN_GAP
    const x0 = Math.round(control.x + (control.width - rowW) / 2)
    const y = Math.round(control.y + (control.height - CONTROL_BTN_H) / 2)
    for (let i = 0; i < count; i++) rects.push({ x: x0 + i * (CONTROL_BTN_W + CONTROL_BTN_GAP), y, width: CONTROL_BTN_W, height: CONTROL_BTN_H })
  }
  return rects
}

/**
 * 计算完整布局：胶囊屏幕矩形、窗口屏幕矩形、控制条方向 / 侧边。
 * winExtra 传「窗口预留行数」时窗口按该尺寸固定；省略时退化为窗口贴合胶囊。
 */
function layout(capPos, style, workArea, extra = {}, winExtra = extra) {
  const s = normalizeStyle(style)
  const capSize = capsuleSize(s, extra)
  const winCap = capsuleSize(s, winExtra)
  const inset = capsuleInset(capPos, s, workArea, capSize, winCap)
  if (s.vertical) {
    const side = controlSide(capPos, capSize, workArea)
    const part = capsulePart({ vertical: true, side })
    // 进度条与按钮用同一套判断，且永远在按钮的另一侧：
    // 按钮在右（side=right）→ 进度条贴左边；按钮在左 → 贴右边。
    // 竖排进度条是竖线，所以只取 left / right。
    const edge = side === 'right' ? 'left' : 'right'
    return {
      flip: null,
      side,
      edge,
      cap: { x: Math.round(capPos.x), y: Math.round(capPos.y), ...capSize },
      winCap,
      part,
      inset,
      win: sideWindowRect(capPos, capSize, side, winCap, inset),
    }
  }
  const flip = controlFlip(capPos, capSize, workArea)
  const part = capsulePart({ vertical: false, flip })
  // 进度条与按钮用同一套判断，且永远在按钮的另一侧：
  // 按钮在上（flip=above）→ 进度条贴下边；按钮在下 → 贴上边。
  // 横排进度条是横线，所以只取 top / bottom。
  const edge = flip === 'above' ? 'bottom' : 'top'
  return {
    flip,
    side: null,
    edge,
    cap: { x: Math.round(capPos.x), y: Math.round(capPos.y), ...capSize },
    winCap,
    part,
    inset,
    win: windowRect(capPos, capSize, winCap, inset),
  }
}

function windowSize(style, extra = {}) {
  const s = normalizeStyle(style)
  const cap = capsuleSize(s, extra)
  if (s.vertical) return { width: cap.width + PAD * 2 + SIDE_W * 2, height: cap.height + PAD * 2 + EDGE_BLEED * 2 }
  return { width: cap.width + PAD * 2 + EDGE_BLEED * 2, height: cap.height + PAD * 2 + CONTROL_H * 2 }
}

const MIN_CAP_H = capsuleSize({ fontSize: MIN_FONT }).height
const MAX_CAP_H = capsuleSize({ fontSize: MAX_FONT }).height

/** 由胶囊高度反推字号：逐个字号比较，保证与 capsuleSize 完全自洽 */
function fontFromCapsuleHeight(height, extra = {}) {
  const target = num(Number(height), capsuleSize({}, extra).height)
  let best = DEFAULT_FONT
  let bestDiff = Infinity
  for (let f = MIN_FONT; f <= MAX_FONT; f++) {
    const d = Math.abs(capsuleSize({ fontSize: f }, extra).height - target)
    if (d < bestDiff) { bestDiff = d; best = f }
  }
  return best
}

/** 竖排时由胶囊宽度反推字号：宽度由列数、字号和列间距决定。 */
function fontFromCapsuleWidth(width, extra = {}) {
  const target = num(Number(width), capsuleSize({ vertical: true }, extra).width)
  let best = DEFAULT_FONT
  let bestDiff = Infinity
  for (let f = MIN_FONT; f <= MAX_FONT; f++) {
    const d = Math.abs(capsuleSize({ fontSize: f, vertical: true }, extra).width - target)
    if (d < bestDiff) { bestDiff = d; best = f }
  }
  return best
}

/** 竖排长度上限：同时受 MAX_W 与当前工作区高度限制 */
const maxVerticalLength = (workArea) => Math.max(MIN_W, Math.min(MAX_W, Math.round(workArea.height - V_CHROME - PAD * 2)))

const minCapHeight = (extra = {}) => capsuleSize({ fontSize: MIN_FONT }, extra).height
const maxCapHeight = (extra = {}) => capsuleSize({ fontSize: MAX_FONT }, extra).height
const minCapWidth = (extra = {}) => capsuleSize({ fontSize: MIN_FONT, vertical: true }, extra).width
const maxCapWidth = (extra = {}) => capsuleSize({ fontSize: MAX_FONT, vertical: true }, extra).width

/** 把样式限制在当前工作区内：竖排限制长度，横排限制宽度 */
function clampStyleToArea(style, area, extra = {}) {
  const s = normalizeStyle(style)
  // 横排长度不限制（用户要求），不做工作区裁剪；竖排仍限制在屏幕高度内。
  if (!s.vertical) return s
  const maxLen = maxVerticalLength(area)
  if (s.width <= maxLen) return s
  return normalizeStyle({ ...s, width: maxLen })
}

/** 竖排时把胶囊长度限制在工作区高度内（至少保留 MIN_W），避免超出屏幕 */
function clampVerticalLength(style, workArea, extra = {}) {
  const s = normalizeStyle(style)
  if (!s.vertical) return s
  const maxLen = maxVerticalLength(workArea)
  if (s.width <= maxLen) return s
  return normalizeStyle({ ...s, width: maxLen })
}

/** 默认位置：胶囊在主屏底部居中、离底边 16px */
function defaultCapsule(workArea, style, extra = {}) {
  const cap = capsuleSize(style, extra)
  return {
    x: Math.round(workArea.x + (workArea.width - cap.width) / 2),
    y: Math.round(workArea.y + workArea.height - cap.height - 16),
  }
}

/** 把胶囊夹在工作区内：允许真正贴到四条边 */
function clampCapsule(capPos, workArea, style, extra = {}) {
  const cap = capsuleSize(style, extra)
  const maxX = workArea.x + Math.max(0, workArea.width - cap.width)
  const maxY = workArea.y + Math.max(0, workArea.height - cap.height)
  return {
    x: Math.round(clamp(capPos.x, workArea.x, maxX)),
    y: Math.round(clamp(capPos.y, workArea.y, maxY)),
  }
}

/** 保存的胶囊位置是否还落在某个屏幕的工作区里（显示器可能已拔掉或改变分辨率） */
function isOnScreen(capPos, workAreas, style, extra = {}) {
  const cap = capsuleSize(style, extra)
  const cx = capPos.x + cap.width / 2
  const cy = capPos.y + cap.height / 2
  return workAreas.some((w) => cx >= w.x && cx <= w.x + w.width && cy >= w.y && cy <= w.y + w.height)
}

/**
 * 多显示器的「虚拟工作区」：所有工作区的并集外框。
 *
 * 拖动边界必须用它而不是「光标所在那一块屏」的工作区，否则两块屏拼接处的缝会被当成墙，
 * 浮窗跨屏时会被弹回单块屏内。并集外框只去掉真正的桌面外边界，屏幕之间的缝保持可跨越。
 */
function unionWorkArea(workAreas) {
  const list = (workAreas || []).filter((a) => a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.width) && Number.isFinite(a.height))
  if (!list.length) return null
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const a of list) {
    left = Math.min(left, a.x)
    top = Math.min(top, a.y)
    right = Math.max(right, a.x + a.width)
    bottom = Math.max(bottom, a.y + a.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 按拖动方向缩放胶囊（纯函数）。
 * dir 由 n/s/e/w 组合，例如 'se'（右下角）、'n'（上边）、'w'（左边）。
 *
 * 传入 area 时，会按「未被拖动的那条边保持不动」进一步限制尺寸，
 * 使胶囊到达工作区（含任务栏上方的下边界）时停住，而不是先超出再把整体顶回去。
 */
function resizeCapsule(start, dx, dy, dir, limits, area) {
  const has = (ch) => dir.includes(ch)
  let width = start.width + (has('e') ? dx : 0) + (has('w') ? -dx : 0)
  let height = start.height + (has('s') ? dy : 0) + (has('n') ? -dy : 0)
  width = clamp(width, limits.minW, limits.maxW)
  height = clamp(height, limits.minH, limits.maxH)
  if (area) {
    if (has('w')) width = Math.min(width, start.x + start.width - area.x)
    else if (has('e')) width = Math.min(width, area.x + area.width - start.x)
    if (has('n')) height = Math.min(height, start.y + start.height - area.y)
    else if (has('s')) height = Math.min(height, area.y + area.height - start.y)
    width = Math.max(limits.minW, width)
    height = Math.max(limits.minH, height)
  }
  const x = has('w') ? start.x + start.width - width : start.x
  const y = has('n') ? start.y + start.height - height : start.y
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

module.exports = {
  SPEC, SPEC_GEOMETRY: GEO, DEFAULT_STYLE,
  PAD, BORDER, V_PAD, H_PAD, V_CHROME, ROW_GAP, COLUMN_EXTRA_RATIO, CONTROL_H, SIDE_W, CONTROL_BTN_W, CONTROL_BTN_H, CONTROL_BTN_GAP, CONTROL_BTN_COUNT, CONTROL_BTN_COUNT_LOCKED, FLIP_RATIO,
  MIN_W, MAX_W, MAX_LEN, EDGE_BLEED, MIN_FONT, MAX_FONT, DEFAULT_W, DEFAULT_FONT, MIN_CAP_H, MAX_CAP_H,
  normalizeStyle, layoutFlags, resolveLayoutState, lineHeight, subHeight, mainColumnWidth, subColumnWidth, columnExtra, visibleRows, capsuleSize, minCapHeight, maxCapHeight, minCapWidth, maxCapWidth, maxVerticalLength, capsulePart, anchorCapsule, anchorCapsuleDocked, anchorVerticalToHorizontal, capsuleGrowthShift, nearestEdge, controlFlip, controlSide, sideWindowRect, capFromWindow, clampStyleToArea, clampVerticalLength, windowRect, regions, controlButtons, layout,
  windowSize, fontFromCapsuleHeight, fontFromCapsuleWidth, defaultCapsule, clampCapsule, isOnScreen, unionWorkArea, resizeCapsule, capsuleInset, blendDistance,
}

