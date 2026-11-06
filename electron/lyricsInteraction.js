// 悬浮歌词拖动 / 缩放的纯计算：不触碰 Electron，便于测试与复用。
const G = require('./lyricsGeometry')

function nextDragPosition(drag, cursor) {
  return {
    x: drag.cap.x + cursor.x - drag.cursor.x,
    y: drag.cap.y + cursor.y - drag.cursor.y,
  }
}

function nextResizeStyle(style, bounds, cursor, startCursor, dir, limits, area, extra) {
  const next = G.resizeCapsule(bounds, cursor.x - startCursor.x, cursor.y - startCursor.y, dir, limits, area)
  const fontSize = style.vertical ? G.fontFromCapsuleWidth(next.width, extra) : G.fontFromCapsuleHeight(next.height, extra)
  const resized = G.normalizeStyle({ ...style, fontSize, width: style.vertical ? next.height - G.V_CHROME : next.width })
  return { bounds: next, style: G.clampStyleToArea(resized, area, extra) }
}

function anchoredResizePosition(bounds, cap, dir) {
  let x = bounds.x
  let y = bounds.y
  if (dir.includes('w')) x = bounds.x + bounds.width - cap.width
  if (dir.includes('n')) y = bounds.y + bounds.height - cap.height
  return { x, y }
}

module.exports = { nextDragPosition, nextResizeStyle, anchoredResizePosition }
