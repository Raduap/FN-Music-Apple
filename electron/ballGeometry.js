// 悬浮球的几何计算（纯函数，便于单元测试）
//
// 窗口是透明的，比球大：球在窗口一侧，另一侧留给悬停时展开的胶囊面板，四周留出阴影空间。
// 球靠近屏幕右半边时，面板向左展开（anchor = 'right'），反之向右展开。
const BALL = 60 // 球的直径
const PAD = 24 // 窗口四周留给阴影的边距（阴影不能超出窗口，否则会被截断成一条硬边）
const PANEL = 336 // 展开后胶囊的宽度（含球）
const WIN_W = PANEL + PAD * 2
const WIN_H = BALL + PAD * 2
const EDGE = 4 // 与屏幕边缘至少留出的距离

/** 球心在工作区右半边时面板向左展开 */
function anchorFor(ball, workArea) {
  return ball.x + BALL / 2 > workArea.x + workArea.width / 2 ? 'right' : 'left'
}

/** 由球的位置算出窗口位置 */
function windowBounds(ball, anchor) {
  const x = anchor === 'left' ? ball.x - PAD : ball.x + BALL + PAD - WIN_W
  return { x: Math.round(x), y: Math.round(ball.y - PAD), width: WIN_W, height: WIN_H }
}

/** 自由放置：松手的位置就是最终位置，只保证整颗球留在工作区内（不会被拖到屏幕外或任务栏下面） */
function clampBall(ball, workArea) {
  const minX = workArea.x + EDGE, maxX = workArea.x + workArea.width - BALL - EDGE
  const minY = workArea.y + EDGE, maxY = workArea.y + workArea.height - BALL - EDGE
  return { x: Math.round(Math.min(maxX, Math.max(minX, ball.x))), y: Math.round(Math.min(maxY, Math.max(minY, ball.y))) }
}

/** 默认位置：主屏幕右侧、略低于中线 */
function defaultBall(workArea) {
  return { x: workArea.x + workArea.width - BALL - 16, y: Math.round(workArea.y + workArea.height * 0.62) }
}

/** 保存的位置是否仍在某个屏幕的工作区里（显示器可能已拔掉或分辨率变了） */
function isOnScreen(ball, workAreas) {
  const cx = ball.x + BALL / 2, cy = ball.y + BALL / 2
  return workAreas.some((w) => cx >= w.x && cx <= w.x + w.width && cy >= w.y && cy <= w.y + w.height)
}

module.exports = { BALL, PAD, PANEL, WIN_W, WIN_H, EDGE, anchorFor, windowBounds, clampBall, defaultBall, isOnScreen }
