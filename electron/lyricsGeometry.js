// 悬浮歌词窗口的几何计算（纯函数，便于单元测试）
//
// 核心：以“歌词胶囊”（那块深色背景）为基准做定位与夹取，窗口只是它的紧贴外框。
// 这样胶囊可以真正贴到屏幕的左 / 右 / 上 / 下边缘，透明边距也很小。
//
// 窗口结构（外框 = 胶囊 + 控制条）：
//   控制条在胶囊上方（flip = 'above'）或下方（flip = 'below'）
//   —— 胶囊在屏幕上方 2/3 时按钮放下方，避免贴顶时按钮被顶出屏幕；否则放上方
//
// 胶囊高度按“当前实际会显示的行数”计算：原文 + 可选译文 + 可选下一句。
// 这样视觉黑块、窗口外框和鼠标命中区域一致，切换翻译时不会在下方留下透明空白。
const SPEC = require('./lyricsVisualSpec.json')
const { geometry: GEO, fonts: FONTS, weights: WEIGHTS, aligns: ALIGNS, backgroundModes: MODES, defaultStyle: DEFAULT_STYLE } = SPEC

// 统一常量来源：lyricsVisualSpec.json。这样窗口布局、CSS 变量和设置面板不会各写一份。
const PAD = GEO.pad
const BORDER = GEO.border
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
    showTranslation: s.showTranslation !== false,
    showNext: !!s.showNext,
    clickThrough: !!s.clickThrough,
    vertical: !!s.vertical,
    width: Math.round(clamp(num(Number(s.width), DEFAULT_W), MIN_W, MAX_W)),
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
 * 竖排时开关译文 / 下一句只改变胶囊宽度：为了让原文（最右列）位置不动，
 * 需要固定胶囊右边缘，把新增 / 减少的宽度全部向左伸缩。
 */
function anchorRightEdge(capPos, prevCap, nextCap) {
  return {
    x: Math.round(capPos.x + prevCap.width - nextCap.width),
    y: Math.round(capPos.y),
  }
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

/** 由胶囊尺寸与位置算出窗口外框（含控制条与四周留白） */
function windowRect(capPos, capSize, flip) {
  const width = capSize.width + PAD * 2
  const height = capSize.height + PAD * 2 + CONTROL_H
  const x = capPos.x - PAD
  const y = flip === 'above' ? capPos.y - PAD - CONTROL_H : capPos.y - PAD
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** 竖排时窗口外框：胶囊 + 左侧 / 右侧的控制条 */
function sideWindowRect(capPos, capSize, side) {
  const width = capSize.width + PAD * 2 + SIDE_W
  const height = capSize.height + PAD * 2
  const x = side === 'left' ? capPos.x - PAD - SIDE_W : capPos.x - PAD
  const y = capPos.y - PAD
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** 胶囊与控制条在窗口内的矩形（窗口左上角为原点），供命中测试 / 布局用 */
function regions(style, flip, extra = {}, side = 'right') {
  const s = normalizeStyle(style)
  const cap = capsuleSize(s, extra)
  if (s.vertical) {
    // 竖排：控制条是胶囊左侧 / 右侧的一条竖向长条，整条都算控制区（与横排整条一致）
    return {
      capsule: { x: side === 'left' ? PAD + SIDE_W : PAD, y: PAD, width: cap.width, height: cap.height },
      control: { x: side === 'left' ? PAD : PAD + cap.width, y: PAD, width: SIDE_W, height: cap.height },
      window: { width: cap.width + PAD * 2 + SIDE_W, height: cap.height + PAD * 2 },
    }
  }
  const capY = flip === 'above' ? PAD + CONTROL_H : PAD
  return {
    capsule: { x: PAD, y: capY, width: cap.width, height: cap.height },
    control: { x: PAD, y: flip === 'above' ? PAD : PAD + cap.height, width: cap.width, height: CONTROL_H },
    window: { width: cap.width + PAD * 2, height: cap.height + PAD * 2 + CONTROL_H },
  }
}

/**
 * 控制按钮在窗口内的实际矩形，用于鼠标穿透判定。
 * 容器与按钮间空隙不属于按钮区域：主进程只放行这些矩形，其余控制条区域继续穿透。
 */
function controlButtons(style, flip, extra = {}, side = 'right') {
  const s = normalizeStyle(style)
  const control = regions(s, flip, extra, side).control
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

/** 计算完整布局：胶囊屏幕矩形、窗口屏幕矩形、控制条方向 / 侧边 */
function layout(capPos, style, workArea, extra = {}) {
  const s = normalizeStyle(style)
  const capSize = capsuleSize(s, extra)
  const edge = nearestEdge(capPos, capSize, workArea, s.vertical)
  if (s.vertical) {
    const side = controlSide(capPos, capSize, workArea)
    return {
      flip: null,
      side,
      edge,
      cap: { x: Math.round(capPos.x), y: Math.round(capPos.y), ...capSize },
      win: sideWindowRect(capPos, capSize, side),
    }
  }
  const flip = controlFlip(capPos, capSize, workArea)
  return {
    flip,
    side: null,
    edge,
    cap: { x: Math.round(capPos.x), y: Math.round(capPos.y), ...capSize },
    win: windowRect(capPos, capSize, flip),
  }
}

function windowSize(style, extra = {}) {
  const s = normalizeStyle(style)
  const cap = capsuleSize(s, extra)
  if (s.vertical) return { width: cap.width + PAD * 2 + SIDE_W, height: cap.height + PAD * 2 }
  return { width: cap.width + PAD * 2, height: cap.height + PAD * 2 + CONTROL_H }
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
  const maxLen = s.vertical
    ? maxVerticalLength(area)
    : Math.max(MIN_W, Math.min(MAX_W, Math.round(area.width - PAD * 2)))
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
  MIN_W, MAX_W, MIN_FONT, MAX_FONT, DEFAULT_W, DEFAULT_FONT, MIN_CAP_H, MAX_CAP_H,
  normalizeStyle, layoutFlags, lineHeight, subHeight, mainColumnWidth, subColumnWidth, columnExtra, visibleRows, capsuleSize, minCapHeight, maxCapHeight, minCapWidth, maxCapWidth, maxVerticalLength, anchorRightEdge, nearestEdge, controlFlip, controlSide, sideWindowRect, clampStyleToArea, clampVerticalLength, windowRect, regions, controlButtons, layout,
  windowSize, fontFromCapsuleHeight, fontFromCapsuleWidth, defaultCapsule, clampCapsule, isOnScreen, resizeCapsule,
}
