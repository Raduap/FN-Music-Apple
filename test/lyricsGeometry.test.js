import { describe, expect, it } from 'vitest'
import G from '../electron/lyricsGeometry.js'
import I from '../electron/lyricsInteraction.js'

const wa = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 984 }
const oneRow = { showTranslation: false, showNext: false }
const twoRows = { showTranslation: true, showNext: false }
const threeRows = { showTranslation: true, showNext: true }

describe('悬浮歌词几何与样式', () => {
  it('默认样式：深色玻璃 + 白字 + 显示边框和译文、不显示下一句、不穿透、不竖排', () => {
    const s = G.normalizeStyle({})
    expect(s).toMatchObject({ fontSize: 30, backgroundMode: 'dark', textColor: '#ffffff', textColorCustom: false, customImage: false, showBorder: true, showProgress: true, frost: 18, showTranslation: true, showNext: false, clickThrough: false, vertical: false, karaoke: true, width: 760 })
  })

  it('逐字扫色开关：默认开启，显式 false 保留', () => {
    expect(G.normalizeStyle({}).karaoke).toBe(true)
    expect(G.normalizeStyle({ karaoke: false }).karaoke).toBe(false)
    expect(G.normalizeStyle({ karaoke: 'x' }).karaoke).toBe(true)
  })

  it('非法输入被夹到合法范围并补全，背景不透明度允许 100%', () => {
    const s = G.normalizeStyle({ fontSize: 999, width: 10, opacity: 5, weight: 123, align: 'x', backgroundMode: 'nope', textColor: 'red', showBorder: false, frost: 99 })
    expect(s.fontSize).toBe(G.MAX_FONT)
    expect(s.width).toBe(G.MIN_W)
    expect(s.opacity).toBe(1)
    expect(s.weight).toBe(600)
    expect(s.align).toBe('center')
    expect(s.backgroundMode).toBe('dark')
    expect(s.textColor).toBe('#ffffff')
    expect(s.showBorder).toBe(false)
    expect(s.frost).toBe(48)
  })

  it('兼容旧自定义文字颜色配置，不把它误当背景色模式', () => {
    const s = G.normalizeStyle({ colorMode: 'custom', customColor: '#123456', blur: 20 })
    expect(s.backgroundMode).toBe('dark')
    expect(s.textColor).toBe('#123456')
    expect(s.textColorCustom).toBe(true)
    expect(s.frost).toBe(20)
  })

  it('横排窗口尺寸只由样式与当前行数决定：字号越大、行数越多高度越大', () => {
    const small = G.windowSize({ fontSize: 18, width: 500 }, oneRow)
    const big = G.windowSize({ fontSize: 60, width: 500 }, oneRow)
    expect(big.height).toBeGreaterThan(small.height)
    expect(small.width).toBe(500 + G.PAD * 2 + G.EDGE_BLEED * 2)
    expect(G.windowSize({ fontSize: 30 }).height).toBeGreaterThan(0)
    expect(G.PAD).toBe(0)
  })

  it('layoutFlags：双语歌曲始终预留译文行，伴奏句也保持胶囊尺寸恒定', () => {
    const style = { fontSize: 30, width: 760, showTranslation: true, showNext: false }
    // 歌曲级 hasTranslation=true：即使当前句没有译文，也预留译文行。
    const normal = G.layoutFlags(style, { lyric: 'Life goes on', lyricTrans: '生活继续', hasTranslation: true, nextLyric: 'Next', nextNextLyric: 'After' })
    const instrumental = G.layoutFlags(style, { lyric: '', lyricTrans: '', nextLyric: 'Next', nextLyricTrans: '', hasTranslation: true, nextNextLyric: 'After' })
    expect(normal.showTranslation).toBe(true)
    expect(instrumental.showTranslation).toBe(true)
    expect(G.capsuleSize(style, normal).height).toBe(G.capsuleSize(style, instrumental).height)
  })

  it('layoutFlags：开启下一句时，整首歌恒定预留下一句行', () => {
    const style = { fontSize: 30, width: 760, showTranslation: false, showNext: true }
    const withNext = G.layoutFlags(style, { lyric: 'A', nextLyric: 'B', hasNext: true })
    const lastLine = G.layoutFlags(style, { lyric: 'Z', nextLyric: '', hasNext: true })
    expect(withNext.showNext).toBe(true)
    expect(lastLine.showNext).toBe(true)
    expect(G.capsuleSize(style, withNext).height).toBe(G.capsuleSize(style, lastLine).height)
  })

  it('横排胶囊高度与当前实际显示行数一致，不再为隐藏行预留空白', () => {
    const one = G.capsuleSize({ fontSize: 30, width: 760 }, oneRow)
    const two = G.capsuleSize({ fontSize: 30, width: 760 }, twoRows)
    const three = G.capsuleSize({ fontSize: 30, width: 760 }, threeRows)
    expect(one.height).toBeLessThan(two.height)
    expect(two.height).toBeLessThan(three.height)
    expect(G.windowSize({ fontSize: 30 }, oneRow).height).toBe(one.height + G.CONTROL_H * 2)
    expect(G.windowSize({ fontSize: 30 }, threeRows).height).toBe(three.height + G.CONTROL_H * 2)
  })

  it('横排切换译文 / 下一句只扩展胶囊高度，原文顶部位置不变', () => {
    const pos = { x: 120, y: 80 }
    const before = G.layout(pos, { showTranslation: false, showNext: false }, wa, oneRow)
    const after = G.layout(pos, { showTranslation: true, showNext: true }, wa, threeRows)
    expect(before.cap.y).toBe(pos.y)
    expect(after.cap.y).toBe(pos.y)
    expect(after.cap.height).toBeGreaterThan(before.cap.height)
    expect(before.cap.y).toBe(after.cap.y)
  })

  it('竖排窗口尺寸：列数越多宽度越大，长度由设置值决定', () => {
    const one = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, oneRow)
    const two = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, twoRows)
    const three = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, threeRows)
    expect(one.width).toBeLessThan(two.width)
    expect(two.width).toBeLessThan(three.width)
    expect(one.height).toBe(760 + G.V_CHROME)
    expect(three.height).toBe(760 + G.V_CHROME)
  })

  it('竖排切换译文 / 下一句：字幕在左部向右长，字幕在右部向左长', () => {
    const pos = { x: 120, y: 80 }
    const style = { vertical: true, showTranslation: false, showNext: false, width: 760 }
    const before = G.capsuleSize(style, oneRow)
    const next = G.capsuleSize({ ...style, showTranslation: true, showNext: true }, threeRows)
    expect(next.width).toBeGreaterThan(before.width)

    const leftPart = G.anchorCapsule(pos, before, next, { vertical: true, side: 'right' })
    expect(leftPart.x).toBe(pos.x)
    expect(leftPart.y).toBe(pos.y)

    const rightPart = G.anchorCapsule(pos, before, next, { vertical: true, side: 'left' })
    expect(rightPart.x + next.width).toBe(pos.x + before.width)
    expect(rightPart.y).toBe(pos.y)

    const shrinkRightPart = G.anchorCapsule(rightPart, next, before, { vertical: true, side: 'left' })
    expect(shrinkRightPart.x + before.width).toBe(rightPart.x + next.width)
  })

  it('竖排锚定后再布局，窗口移动使保持不动的边在屏幕上位置不变', () => {
    const pos = { x: 120, y: 80 }
    const v = { vertical: true, showTranslation: false, showNext: false, width: 760 }
    const before = G.capsuleSize(v, oneRow)
    const nextStyle = { ...v, showTranslation: true, showNext: true }
    const next = G.capsuleSize(nextStyle, threeRows)

    const anchored = G.anchorCapsule(pos, before, next, { vertical: true, side: 'left' })
    const L1 = G.layout(pos, v, wa, oneRow)
    const L2 = G.layout(anchored, nextStyle, wa, threeRows)
    expect(L2.cap.x + L2.cap.width).toBe(L1.cap.x + L1.cap.width)

    const leftAnchored = G.anchorCapsule(pos, before, next, { vertical: true, side: 'right' })
    const L3 = G.layout(leftAnchored, nextStyle, wa, threeRows)
    expect(L3.cap.x).toBe(G.layout(pos, v, wa, oneRow).cap.x)
  })

  it('横排切换译文 / 下一句：字幕在底部向上长，字幕在顶部向下长', () => {
    const pos = { x: 120, y: 80 }
    const style = { width: 760, fontSize: 30, showTranslation: false, showNext: false }
    const before = G.capsuleSize(style, oneRow)
    const next = G.capsuleSize({ ...style, showTranslation: true, showNext: true }, threeRows)
    expect(next.height).toBeGreaterThan(before.height)

    const bottomPart = G.anchorCapsule(pos, before, next, { vertical: false, flip: 'above' })
    expect(bottomPart.y + next.height).toBe(pos.y + before.height)
    expect(bottomPart.x).toBe(pos.x)

    const topPart = G.anchorCapsule(pos, before, next, { vertical: false, flip: 'below' })
    expect(topPart.y).toBe(pos.y)
    expect(topPart.x).toBe(pos.x)

    const shrinkBottomPart = G.anchorCapsule(bottomPart, next, before, { vertical: false, flip: 'above' })
    expect(shrinkBottomPart.y + before.height).toBe(bottomPart.y + next.height)
  })

  it('切歌歌词未就绪时：渲染可置空，但布局继续沿用上一首尺寸', () => {
    const style = { fontSize: 30, width: 760, showTranslation: true, showNext: true }
    const prev = { hasTranslation: true, hasNext: true, lyricsReady: true }
    const pending = { lyric: '', hasTranslation: false, hasNext: false, lyricsReady: false }

    const layout = G.resolveLayoutState(pending, prev)
    expect(layout).toBe(prev)
    expect(G.layoutFlags(style, layout)).toMatchObject({ showTranslation: true, showNext: true })
    expect(G.capsuleSize(style, G.layoutFlags(style, layout))).toEqual(G.capsuleSize(style, G.layoutFlags(style, prev)))

    const ready = { lyric: '下一首', hasTranslation: false, hasNext: false, lyricsReady: true }
    expect(G.layoutFlags(style, G.resolveLayoutState(ready, prev))).toMatchObject({ showTranslation: false, showNext: false })
  })

  it('竖排切横排：横排胶囊底边保持旧竖排胶囊底边 y', () => {
    const pos = { x: 120, y: 80 }
    const oldStyle = { vertical: true, width: 760, fontSize: 30 }
    const newStyle = { ...oldStyle, vertical: false, width: 520 }
    const oldCap = G.capsuleSize(oldStyle, oneRow)
    const newCap = G.capsuleSize(newStyle, oneRow)

    const anchored = G.anchorVerticalToHorizontal(pos, oldCap, newCap)
    expect(anchored.x).toBe(pos.x)
    expect(anchored.y + newCap.height).toBe(pos.y + oldCap.height)

    const L = G.layout(anchored, newStyle, wa, oneRow)
    expect(L.cap.y + L.cap.height).toBe(pos.y + oldCap.height)
  })

  it('竖排：胶囊在桌面左半边时控制条在右，右半边时在左', () => {
    const v = { vertical: true, fontSize: 30, width: 760 }
    const cap = G.capsuleSize(v, twoRows)
    expect(G.controlSide({ x: 0, y: 0 }, cap, wa)).toBe('right')
    expect(G.controlSide({ x: wa.width - cap.width, y: 0 }, cap, wa)).toBe('left')
    expect(G.controlSide({ x: wa.width / 2 - cap.width / 2, y: 0 }, cap, wa)).toBe('right')

    const right = G.layout({ x: 0, y: 100 }, v, wa, twoRows)
    expect(right.side).toBe('right')
    expect(right.flip).toBe(null)
    // 胶囊贴到工作区左边：朝外那条预留带收掉（否则原生拖动下窗口进不了负坐标、
    // 胶囊就永远差一条带贴不到边）。窗口停在 x=0，胶囊仍在 x=0。
    expect(right.win.x).toBe(0)
    expect(right.win.x + right.inset.x).toBe(0)
    expect(right.win.width).toBe(cap.width + G.SIDE_W * 2)
    expect(right.win.height).toBe(cap.height + G.EDGE_BLEED * 2)

    const left = G.layout({ x: wa.width - cap.width, y: 100 }, v, wa, twoRows)
    expect(left.side).toBe('left')
    expect(left.inset.x).toBe(G.PAD + G.SIDE_W)
    expect(left.win.x + left.inset.x).toBe(wa.width - cap.width)
    expect(left.win.width).toBe(cap.width + G.SIDE_W * 2)
  })

  it('竖排命中区域：控制条贴胶囊侧边，胶囊屏幕位置不随侧边改变', () => {
    const v = { vertical: true, fontSize: 30, width: 760 }
    const pos = { x: 400, y: 100 }
    const cap = G.capsuleSize(v, twoRows)

    // 胶囊在窗口内恒占中间列（x = PAD + SIDE_W），长度轴上下各留安全边。
    const capY = G.PAD + G.EDGE_BLEED
    const right = G.regions(v, null, twoRows, 'right')
    expect(right.capsule).toEqual({ x: G.PAD + G.SIDE_W, y: capY, width: cap.width, height: cap.height })
    expect(right.control).toEqual({ x: G.PAD + G.SIDE_W + cap.width, y: capY, width: G.SIDE_W, height: cap.height })

    const left = G.regions(v, null, twoRows, 'left')
    expect(left.capsule).toEqual({ x: G.PAD + G.SIDE_W, y: capY, width: cap.width, height: cap.height })
    expect(left.control).toEqual({ x: G.PAD, y: capY, width: G.SIDE_W, height: cap.height })

    const L1 = G.layout(pos, v, wa, twoRows)
    const L2 = G.layout(pos, v, wa, twoRows)
    expect(L1.cap.x).toBe(L2.cap.x)
    expect(L1.cap.y).toBe(L2.cap.y)
    expect(L1.win.x + G.regions(v, null, twoRows, L1.side).capsule.x).toBe(pos.x)
  })

  it('竖排窗口尺寸包含侧边控制条宽度', () => {
    const cap = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, twoRows)
    const size = G.windowSize({ vertical: true, fontSize: 30, width: 760 }, twoRows)
    expect(size.width).toBe(cap.width + G.SIDE_W * 2)
    expect(size.height).toBe(cap.height + G.EDGE_BLEED * 2)
  })

  it('竖排长度被限制在工作区高度内，不会超出屏幕', () => {
    const shortScreen = { x: 0, y: 0, width: 1920, height: 500 }
    const s = G.clampVerticalLength({ vertical: true, width: 1400, fontSize: 30 }, shortScreen, oneRow)
    const cap = G.capsuleSize(s, oneRow)
    expect(cap.height).toBeLessThanOrEqual(shortScreen.height)
    expect(s.width).toBe(shortScreen.height - G.V_CHROME)

    const tallScreen = { x: 0, y: 0, width: 1920, height: 2000 }
    const s2 = G.clampVerticalLength({ vertical: true, width: 1400, fontSize: 30 }, tallScreen, oneRow)
    expect(s2.width).toBe(1400)

    const horizontal = G.clampVerticalLength({ width: 1400, fontSize: 30 }, shortScreen, oneRow)
    expect(horizontal.width).toBe(1400)
  })

  it('竖排缩放时按住下边缘：到达工作区底部即停，不把胶囊顶走', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1000 }
    const limits = { minW: 100, maxW: 400, minH: 260, maxH: 2000 }
    const start = { x: 800, y: 200, width: 180, height: 400 }
    // 向下拖很远：高度顶到 area 底部 (1000 - 200) 为止，y 不动
    const grown = G.resizeCapsule(start, 0, 5000, 's', limits, area)
    expect(grown.y).toBe(200)
    expect(grown.height).toBe(800)
    expect(grown.y + grown.height).toBe(area.y + area.height)
    // 向上拖：y 跟随移动，底边固定
    const up = G.resizeCapsule(start, 0, -50, 'n', limits, area)
    expect(up.y).toBe(150)
    expect(up.y + up.height).toBe(start.y + start.height)
  })

  it('横排缩放到工作区边界时停住，不再超界', () => {
    const area = { x: 0, y: 0, width: 800, height: 1000 }
    const limits = { minW: 100, maxW: 5000, minH: 40, maxH: 60 }
    const start = { x: 100, y: 100, width: 300, height: 50 }
    const wide = G.resizeCapsule(start, 5000, 0, 'e', limits, area)
    expect(wide.width).toBe(700)
    expect(wide.x + wide.width).toBe(area.x + area.width)
    const tall = G.resizeCapsule(start, 0, 5000, 's', limits, area)
    expect(tall.height).toBe(60)
  })

  it('切换横竖排时按新方向裁剪到屏幕内，避免一定超出', () => {
    const area = { x: 0, y: 0, width: 2560, height: 1440 }
    // 横排很宽(2400)切竖排：竖排长度受屏幕高度限制
    const toVertical = G.clampStyleToArea({ vertical: true, width: 2400, fontSize: 30 }, area, oneRow)
    expect(toVertical.width).toBe(G.maxVerticalLength(area))
    expect(G.capsuleSize(toVertical, oneRow).height).toBeLessThanOrEqual(area.height)
    // 竖排很长切回横排：横排长度不再受屏幕宽度 / MAX_W 限制
    const toHorizontal = G.clampStyleToArea({ vertical: false, width: 4000, fontSize: 30 }, area, oneRow)
    expect(toHorizontal.width).toBe(4000)
  })

  it('进度条贴边方向随模式限制在对应轴上：横排选上/下，竖排选左/右', () => {
    const cap = { width: 300, height: 80 }
    // 横排：只在上 / 下之间选（即使贴左边也不返回 left）
    expect(G.nearestEdge({ x: 700, y: 900 }, cap, wa, false)).toBe('bottom')
    expect(G.nearestEdge({ x: 700, y: 5 }, cap, wa, false)).toBe('top')
    expect(G.nearestEdge({ x: 3, y: 900 }, cap, wa, false)).toBe('bottom') // 左近但横排不看左右
    // 竖排：只在左 / 右之间选（即使贴顶也不返回 top）
    expect(G.nearestEdge({ x: 3, y: 400 }, cap, wa, true)).toBe('left')
    expect(G.nearestEdge({ x: 1920 - 303, y: 400 }, cap, wa, true)).toBe('right')
    expect(G.nearestEdge({ x: 1917, y: 5 }, cap, wa, true)).toBe('right') // 上近但竖排不看上下
    // layout 结果里也带 edge，且遵循模式轴向
    expect(G.layout({ x: 700, y: 5 }, { width: 300, fontSize: 30 }, wa, oneRow).edge).toBe('top')
    expect(G.layout({ x: 3, y: 900 }, { width: 300, fontSize: 30 }, wa, oneRow).edge).toBe('bottom')
    expect(G.layout({ x: 3, y: 400 }, { vertical: true, width: 300, fontSize: 30 }, wa, oneRow).edge).toBe('left')
    expect(G.layout({ x: 1920 - 303, y: 5 }, { vertical: true, width: 300, fontSize: 30 }, wa, oneRow).edge).toBe('right')
  })

  it('默认位置：胶囊在主屏底部居中、离底边 16px', () => {
    const cap = G.capsuleSize({}, twoRows)
    const p = G.defaultCapsule(wa, {}, twoRows)
    expect(Math.round(p.x + cap.width / 2)).toBe(960)
    expect(p.y + cap.height).toBe(1040 - 16)
    expect(G.isOnScreen(p, [wa], {}, twoRows)).toBe(true)
  })

  it('胶囊可以真正贴到工作区四条边', () => {
    const style = { width: 600, fontSize: 24 }
    const cap = G.capsuleSize(style, twoRows)
    expect(G.clampCapsule({ x: -99999, y: 0 }, wa, style, twoRows)).toEqual({ x: 0, y: 0 })
    expect(G.clampCapsule({ x: 99999, y: 0 }, wa, style, twoRows)).toEqual({ x: 1920 - cap.width, y: 0 })
    expect(G.clampCapsule({ x: 0, y: -99999 }, wa, style, twoRows)).toEqual({ x: 0, y: 0 })
    expect(G.clampCapsule({ x: 0, y: 99999 }, wa, style, twoRows)).toEqual({ x: 0, y: 1040 - cap.height })
  })

  it('当胶囊中心在屏幕上方 1/3 区域时控制条放到下方，否则放到上方', () => {
    const style = { fontSize: 30, width: 760 }
    const cap = G.capsuleSize(style, twoRows)
    const high = { x: 0, y: 0 }
    const low = { x: 0, y: wa.height - cap.height }
    expect(G.controlFlip(high, cap, wa)).toBe('below')
    expect(G.controlFlip(low, cap, wa)).toBe('above')
    // 分界线在屏幕上方 1/3 处：中心略高于 1/3 放下方，略低于 1/3 放上方。
    const line = wa.y + wa.height / 3
    const justAbove = { x: 0, y: Math.round(line - cap.height / 2) - 1 }
    const justBelow = { x: 0, y: Math.round(line - cap.height / 2) + 1 }
    expect(G.controlFlip(justAbove, cap, wa)).toBe('below')
    expect(G.controlFlip(justBelow, cap, wa)).toBe('above')

    const aboveWindow = G.layout(low, style, wa, twoRows)
    expect(aboveWindow.flip).toBe('above')
    expect(aboveWindow.win.y + aboveWindow.win.height).toBe(low.y + cap.height + G.PAD + G.CONTROL_H)

    const belowWindow = G.layout(high, style, wa, twoRows)
    expect(belowWindow.flip).toBe('below')
    // 胶囊贴顶（y=0）：上方预留带收掉，窗口停在 y=0 而不是 -38，
    // 这样原生拖动（不能进负坐标）也能让胶囊真正贴上屏幕顶。
    expect(belowWindow.win.y).toBe(0)
    expect(belowWindow.win.y + belowWindow.inset.y).toBe(high.y)
  })

  it('控制按钮命中区域：普通模式 7 个、锁定模式仅 1 个解锁按钮，且与容器居中', () => {
    const style = { width: 600, fontSize: 24 }
    const two = G.regions(style, 'above', twoRows)
    const normal = G.controlButtons(style, 'above', twoRows)
    expect(normal).toHaveLength(G.CONTROL_BTN_COUNT)
    for (const r of normal) {
      expect(r.width).toBe(G.CONTROL_BTN_W)
      expect(r.height).toBe(G.CONTROL_BTN_H)
      expect(r.y).toBe(two.control.y + Math.round((two.control.height - G.CONTROL_BTN_H) / 2))
    }
    // 按钮按顺序水平排列，间隙未被任何按钮覆盖（间隙可穿透）
    const gap = normal[1].x - (normal[0].x + normal[0].width)
    expect(gap).toBe(G.CONTROL_BTN_GAP)
    // 整组按钮在控制条内水平居中
    const firstX = normal[0].x
    const lastRight = normal[normal.length - 1].x + G.CONTROL_BTN_W
    expect(Math.abs((firstX - two.control.x) - (two.control.x + two.control.width - lastRight))).toBeLessThanOrEqual(2)

    const locked = G.controlButtons({ ...style, clickThrough: true }, 'above', twoRows)
    expect(locked).toHaveLength(G.CONTROL_BTN_COUNT_LOCKED)
    expect(locked[0].x).toBe(two.control.x + Math.round((two.control.width - G.CONTROL_BTN_W) / 2))
  })

  it('控制按钮命中区域：竖排模式纵向排列并居中在侧边控制条内', () => {
    const style = { vertical: true, width: 760, fontSize: 30 }
    const reg = G.regions(style, null, twoRows, 'right')
    const btns = G.controlButtons(style, null, twoRows, 'right')
    expect(btns).toHaveLength(G.CONTROL_BTN_COUNT)
    for (const r of btns) {
      expect(r.x).toBe(reg.control.x + Math.round((reg.control.width - G.CONTROL_BTN_W) / 2))
    }
    const gap = btns[1].y - (btns[0].y + btns[0].height)
    expect(gap).toBe(G.CONTROL_BTN_GAP)
  })

  it('窗口外框与内部区域：胶囊不随 flip 变化，仅控制条在上 / 下预留带间切换', () => {
    const style = { width: 600, fontSize: 24 }
    const cap = G.capsuleSize(style, twoRows)
    // 胶囊位置与 flip 无关；长度轴（横向）两侧各留安全边，避免边框被窗口边缘裁掉。
    const capX = G.PAD + G.EDGE_BLEED
    const above = G.regions(style, 'above', twoRows)
    expect(above.capsule).toEqual({ x: capX, y: G.PAD + G.CONTROL_H, width: cap.width, height: cap.height })
    expect(above.control).toEqual({ x: capX, y: G.PAD, width: cap.width, height: G.CONTROL_H })

    const below = G.regions(style, 'below', twoRows)
    expect(below.capsule).toEqual({ x: capX, y: G.PAD + G.CONTROL_H, width: cap.width, height: cap.height })
    expect(below.control).toEqual({ x: capX, y: G.PAD + G.CONTROL_H + cap.height, width: cap.width, height: G.CONTROL_H })
  })

  it('resizeCapsule 支持八向缩放，并夹在最小 / 最大范围内', () => {
    const start = { x: 100, y: 100, width: 800, height: 200 }
    const limits = { minW: 240, maxW: 1440, minH: 98, maxH: 265 }
    expect(G.resizeCapsule(start, 50, 0, 'e', limits)).toEqual({ x: 100, y: 100, width: 850, height: 200 })
    expect(G.resizeCapsule(start, 0, 40, 's', limits)).toEqual({ x: 100, y: 100, width: 800, height: 240 })
    expect(G.resizeCapsule(start, -50, -20, 'nw', limits)).toEqual({ x: 50, y: 80, width: 850, height: 220 })
    const tiny = G.resizeCapsule(start, -9999, -9999, 'se', limits)
    expect(tiny.width).toBe(limits.minW)
    expect(tiny.height).toBe(limits.minH)
    const huge = G.resizeCapsule(start, 9999, 9999, 'se', limits)
    expect(huge.width).toBe(limits.maxW)
    expect(huge.height).toBe(limits.maxH)
  })

  it('由胶囊高度反推字号：按当前显示行数匹配，且夹在 MIN/MAX 之间', () => {
    expect(G.fontFromCapsuleHeight(G.capsuleSize({}, twoRows).height, twoRows)).toBe(G.DEFAULT_FONT)
    expect(G.fontFromCapsuleHeight(G.minCapHeight(oneRow), oneRow)).toBeGreaterThanOrEqual(G.MIN_FONT)
    expect(G.fontFromCapsuleHeight(G.maxCapHeight(oneRow), oneRow)).toBeLessThanOrEqual(G.MAX_FONT)
    expect(G.fontFromCapsuleHeight(0, oneRow)).toBe(G.MIN_FONT)
    expect(G.fontFromCapsuleHeight(99999, oneRow)).toBe(G.MAX_FONT)
  })

  it('竖排由胶囊宽度反推字号：按当前列数匹配，且夹在 MIN/MAX 之间', () => {
    const vertical = { vertical: true }
    expect(G.fontFromCapsuleWidth(G.capsuleSize(vertical, twoRows).width, twoRows)).toBe(G.DEFAULT_FONT)
    expect(G.fontFromCapsuleWidth(G.minCapWidth(oneRow), oneRow)).toBeGreaterThanOrEqual(G.MIN_FONT)
    expect(G.fontFromCapsuleWidth(G.maxCapWidth(oneRow), oneRow)).toBeLessThanOrEqual(G.MAX_FONT)
    expect(G.fontFromCapsuleWidth(0, oneRow)).toBe(G.MIN_FONT)
    expect(G.fontFromCapsuleWidth(99999, oneRow)).toBe(G.MAX_FONT)
  })

  it('竖排列宽包含安全余量，避免文字升降部被裁切', () => {
    expect(G.mainColumnWidth(30)).toBeGreaterThan(G.lineHeight(30))
    expect(G.subColumnWidth(30)).toBeGreaterThan(G.subHeight(30))
    const one = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, oneRow)
    const three = G.capsuleSize({ vertical: true, fontSize: 30, width: 760 }, threeRows)
    const expected = Math.round(G.ROW_GAP + G.subColumnWidth(30)) * 2
    expect(Math.abs(three.width - one.width - expected)).toBeLessThanOrEqual(2)
  })

  it('胶囊可缩放范围由字号上下限决定', () => {
    expect(G.minCapHeight(oneRow)).toBeLessThan(G.capsuleSize({}, oneRow).height)
    expect(G.maxCapHeight(oneRow)).toBeGreaterThan(G.capsuleSize({}, oneRow).height)
    expect(G.minCapWidth(oneRow)).toBeLessThan(G.capsuleSize({ vertical: true, width: 760 }, oneRow).width)
    expect(G.maxCapWidth(oneRow)).toBeGreaterThan(G.capsuleSize({ vertical: true, width: 760 }, oneRow).width)
    expect(G.MIN_W).toBeLessThan(G.DEFAULT_W)
    expect(G.MAX_W).toBeGreaterThan(G.DEFAULT_W)
  })

  it('显示器拔掉后保存的位置不再有效', () => {
    const onSecond = { x: 2500, y: 400 }
    expect(G.isOnScreen(onSecond, [wa, second], {}, twoRows)).toBe(true)
    expect(G.isOnScreen(onSecond, [wa], {}, twoRows)).toBe(false)
  })

  it('多屏工作区并集：拼接处的缝不算边界，浮窗可跨在两块屏之间', () => {
    // wa=1920×1040，second 紧贴其右侧（x=1920）。
    const union = G.unionWorkArea([wa, second])
    expect(union).toEqual({ x: 0, y: 0, width: 1920 + 1280, height: 1040 })
    // 单块屏（getDisplayMatching）会把跨屏位置夹回一块屏内；并集则允许停在拼接处。
    const straddling = { x: 1800, y: 900 } // 胶囊横跨 x=1920 拼缝
    const style = { fontSize: 30, width: 760 }
    const cap = G.capsuleSize(style, oneRow)
    const single = G.clampCapsule(straddling, wa, style, oneRow)
    const unioned = G.clampCapsule(straddling, union, style, oneRow)
    expect(single.x).toBe(1920 - cap.width) // 被单屏夹回，不能跨缝
    expect(unioned.x).toBe(straddling.x)    // 并集下保持跨屏
    expect(G.unionWorkArea([])).toBeNull()
  })

  it('拖动/缩放纯计算：位置按指针偏移，缩放保持未拖动边且更新样式', () => {
    expect(I.nextDragPosition({ cap: { x: 100, y: 80 }, cursor: { x: 10, y: 20 } }, { x: 35, y: 12 })).toEqual({ x: 125, y: 72 })
    const bounds = { x: 100, y: 100, width: 800, height: 200 }
    const limits = { minW: 240, maxW: 1440, minH: 98, maxH: 265 }
    const style = G.normalizeStyle({ width: 800, fontSize: 30, showTranslation: false, showNext: false })
    const moved = I.nextResizeStyle(style, bounds, { x: 850, y: 100 }, { x: 800, y: 100 }, 'e', limits, wa, oneRow)
    expect(moved.bounds.width).toBe(850)
    expect(moved.style.width).toBe(850)
    expect(I.anchoredResizePosition(bounds, { width: 750, height: 180 }, 'nw')).toEqual({ x: 150, y: 120 })
  })

  describe('增减行：固定贴屏边、向远离屏幕方向生长', () => {
    // 一行的胶囊 vs 三行的胶囊（预留区按三行算）
    const style = { fontSize: 30, width: 760 }
    const cap1 = G.capsuleSize(style, oneRow)
    const cap3 = G.capsuleSize(style, threeRows)

    it('横排字幕在底部：固定下边，向上长高', () => {
      const pos = { x: 400, y: 900 }
      const part = G.capsulePart({ vertical: false, flip: 'above' })
      expect(part).toBe('bottom')
      // 从三行收到一行：capPos 应下移 (cap3.height - cap1.height)，保持底边不动
      const next = G.anchorCapsule(pos, cap3, cap1, { vertical: false, flip: 'above' })
      expect(next.y + cap1.height).toBe(pos.y + cap3.height)
      expect(next.x).toBe(pos.x)
    })

    it('横排字幕在顶部：固定上边，向下长高', () => {
      const pos = { x: 400, y: 60 }
      expect(G.capsulePart({ vertical: false, flip: 'below' })).toBe('top')
      const next = G.anchorCapsule(pos, cap1, cap3, { vertical: false, flip: 'below' })
      expect(next.y).toBe(pos.y) // 上边不动
    })

    it('竖排字幕在左部：固定左边，向右长宽', () => {
      const v = { fontSize: 30, width: 620, vertical: true }
      const v1 = G.capsuleSize(v, oneRow)
      const v3 = G.capsuleSize(v, threeRows)
      const pos = { x: 60, y: 200 }
      expect(G.capsulePart({ vertical: true, side: 'right' })).toBe('left')
      const next = G.anchorCapsule(pos, v1, v3, { vertical: true, side: 'right' })
      expect(next.x).toBe(pos.x) // 左边不动
    })

    it('竖排字幕在右部：固定右边，向左长宽', () => {
      const v = { fontSize: 30, width: 620, vertical: true }
      const v1 = G.capsuleSize(v, oneRow)
      const v3 = G.capsuleSize(v, threeRows)
      const pos = { x: 1600, y: 200 }
      expect(G.capsulePart({ vertical: true, side: 'left' })).toBe('right')
      const next = G.anchorCapsule(pos, v1, v3, { vertical: true, side: 'left' })
      expect(next.x + v3.width).toBe(pos.x + v1.width) // 右边不动
    })

    it('窗口按预留行数固定，增减行时窗口外框不变', () => {
      const pos = { x: 400, y: 900 }
      const win1 = G.layout(pos, style, wa, oneRow, threeRows).win
      const p3 = G.anchorCapsuleDocked(pos, cap1, cap3, style, wa)
      const win3 = G.layout(p3, style, wa, threeRows, threeRows).win
      expect(win1.width).toBe(win3.width)
      expect(win1.height).toBe(win3.height)
      expect(win1.x).toBe(win3.x)
      // 窗口为整首歌预留尺寸，未用到的行余量补在贴屏边一侧（见 capsuleInset 的 slack 项）。
      // 因此增减行时窗口位置与尺寸都完全不变 —— 透明窗不需要重新合成，也就不会抖。
      expect(win3.y).toBe(win1.y)
    })
  })

  describe('进度条与按钮同源判断', () => {
    const style = { fontSize: 30, width: 760 }
    it('横排：按钮在上时进度条贴下边，按钮在下时贴上边', () => {
      const upper = G.layout({ x: 400, y: 60 }, style, wa, oneRow)   // 靠上 → 按钮在下
      expect(upper.flip).toBe('below')
      expect(upper.edge).toBe('top')
      const lower = G.layout({ x: 400, y: 900 }, style, wa, oneRow)  // 靠下 → 按钮在上
      expect(lower.flip).toBe('above')
      expect(lower.edge).toBe('bottom')
    })
    it('竖排：按钮在右时进度条贴左边，按钮在左时贴右边', () => {
      const v = { fontSize: 30, width: 620, vertical: true }
      const left = G.layout({ x: 60, y: 200 }, v, wa, oneRow)
      expect(left.side).toBe('right')
      expect(left.edge).toBe('left')
      const right = G.layout({ x: 1600, y: 200 }, v, wa, oneRow)
      expect(right.side).toBe('left')
      expect(right.edge).toBe('right')
    })
  })

  it('缩放下限按当前行数算：只有一行时能拖到最小字号', () => {
    const style = G.normalizeStyle({ fontSize: 30 })
    const curLimits = { minW: G.MIN_W, maxW: G.MAX_W, minH: G.minCapHeight(oneRow), maxH: G.maxCapHeight(oneRow) }
    const bounds = { x: 400, y: 800, width: style.width, height: G.capsuleSize(style, oneRow).height }
    // 向下狠拖，应能到最小字号（16），而不是被「预留两行」的下限卡在 30
    const r = I.nextResizeStyle(style, bounds, { x: 0, y: -9999 }, { x: 0, y: 0 }, 's', curLimits, wa, oneRow)
    expect(r.style.fontSize).toBe(G.MIN_FONT)
    expect(G.capsuleSize(r.style, oneRow).height).toBe(G.minCapHeight(oneRow))
  })

  describe('拖动越界：胶囊相对鼠标不跳', () => {
    const style = { fontSize: 30, width: 760 }
    const one = oneRow
    const two = twoRows

    // 复制主进程的 move 处理：原生拖动只给出窗口位置，胶囊位置由 capFromWindow 反算
    // （贴近屏幕边时预留带会收掉，所以不能用「加固定偏移」的旧模型）。
    function drag(win0, cap0, delta) {
      const capSize = G.capsuleSize(style, one)
      const win = { ...win0, y: win0.y + delta }
      const capPos = G.capFromWindow(win, style, wa, capSize, G.capsuleSize(style, two))
      const L = G.layout(capPos, style, wa, one, two)
      return { capPos, win: { ...L.win }, flip: L.flip, capScreenY: L.win.y + L.inset.y }
    }

    it('横排越过控制条变换线时，胶囊屏幕坐标继续跟随 capPos（无 31px 跳变）', () => {
      let capPos = { x: 400, y: 600 }
      let win = { ...G.layout(capPos, style, wa, one, two).win }
      let crossed = false
      for (let i = 0; i < 12; i++) {
        const r = drag(win, capPos, 10)
        capPos = r.capPos
        win = r.win
        // 窗口位置取整，胶囊屏幕 y 与 capPos.y 允许 1px 取整误差；关键是任何时候都不跳变。
        expect(Math.abs(r.capScreenY - capPos.y)).toBeLessThanOrEqual(1)
        if (r.flip === 'above') crossed = true
      }
      expect(crossed).toBe(true) // 确认确实越过了变换线
    })

    it('越界时窗口外框不变（只切换按钮侧）', () => {
      const capPos = { x: 400, y: 600 }
      const before = G.layout(capPos, style, wa, one, two).win
      const after = G.layout(capPos, style, wa, one, two).win
      // 同一 capPos 下窗口位置与尺寸都只由 capPos 决定，与 flip 无关
      expect(after).toEqual(before)
    })
  })

  describe('贴近屏幕边：收掉朝外预留带，让胶囊真正贴边', () => {
    const style = { fontSize: 30, width: 760 }
    const one = oneRow

    it('胶囊贴到工作区顶：窗口停在 y=0，胶囊也在 y=0（不再差 38px）', () => {
      const L = G.layout({ x: 400, y: wa.y }, style, wa, one)
      expect(L.inset.y).toBe(0)
      expect(L.win.y).toBe(0)
      expect(L.win.y + L.inset.y).toBe(wa.y)
    })

    it('远离屏幕边时预留带恢复满宽，胶囊位置与改动前一致', () => {
      const capPos = { x: 400, y: 600 }
      const L = G.layout(capPos, style, wa, one)
      expect(L.inset.y).toBe(G.PAD + G.CONTROL_H)
      expect(L.win.y).toBe(capPos.y - G.PAD - G.CONTROL_H)
    })

    it('窗口位置与胶囊位置在过渡区内严格互逆（拖动不漂移、不卡住）', () => {
      const cap = G.capsuleSize(style, one)
      for (let y = 0; y <= 400; y += 7) {
        const L = G.layout({ x: 400, y }, style, wa, one)
        const back = G.capFromWindow(L.win, style, wa, cap)
        // 允许 1px 取整误差
        expect(Math.abs(back.y - y)).toBeLessThanOrEqual(1)
      }
    })

    it('原生拖动可以一路把胶囊贴到顶：窗口顶到 0 后胶囊继续走到 y=0', () => {
      const cap = G.capsuleSize(style, one)
      // 模拟用户向上拖窗口：窗口 y 从起始值一路减到 0（Windows 不允许窗口再往上）。
      const startWinY = G.layout({ x: 400, y: 600 }, style, wa, one).win.y
      let capPos = null
      for (let wy = startWinY; wy >= 0; wy -= 1) {
        capPos = G.capFromWindow({ x: 400, y: wy, width: 0, height: 0 }, style, wa, cap)
      }
      expect(capPos.y).toBe(wa.y) // 窗口顶到 0 时，胶囊也真正贴到屏幕顶部
    })
  })
})

