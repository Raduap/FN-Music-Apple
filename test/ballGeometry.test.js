import { describe, expect, it } from 'vitest'
import G from '../electron/ballGeometry.js'

const { BALL, PAD, WIN_W, WIN_H, EDGE, anchorFor, windowBounds, clampBall, defaultBall, isOnScreen } = G
const wa = { x: 0, y: 0, width: 1920, height: 1040 } // 主屏工作区（去掉任务栏）
const second = { x: 1920, y: 0, width: 1280, height: 984 } // 右侧第二块屏幕

describe('悬浮球几何', () => {
  it('球在屏幕右半边时面板向左展开', () => {
    expect(anchorFor({ x: 1800, y: 500 }, wa)).toBe('right')
    expect(anchorFor({ x: 100, y: 500 }, wa)).toBe('left')
    expect(anchorFor({ x: 2000, y: 500 }, second)).toBe('left')
  })

  it('窗口位置：球始终在窗口的锚定一侧，四周留出阴影边距', () => {
    expect(windowBounds({ x: 100, y: 500 }, 'left')).toEqual({ x: 100 - PAD, y: 500 - PAD, width: WIN_W, height: WIN_H })
    const r = windowBounds({ x: 1800, y: 500 }, 'right')
    expect(r.x + r.width - PAD - BALL).toBe(1800) // 球紧贴窗口右侧边距
  })

  it('自由放置：屏幕内任意位置松手都停在原处，靠近边缘也不吸附', () => {
    expect(clampBall({ x: 900, y: 400 }, wa)).toEqual({ x: 900, y: 400 })
    expect(clampBall({ x: 30, y: 400 }, wa)).toEqual({ x: 30, y: 400 })
    expect(clampBall({ x: 1920 - BALL - 40, y: 970 }, wa)).toEqual({ x: 1920 - BALL - 40, y: 970 })
    expect(clampBall({ x: 2100.6, y: 300.4 }, second)).toEqual({ x: 2101, y: 300 }) // 第二块屏幕，坐标取整
  })

  it('拖出屏幕时整颗球留在工作区内（不会被挡在任务栏下面）', () => {
    expect(clampBall({ x: -200, y: -50 }, wa)).toEqual({ x: EDGE, y: EDGE })
    expect(clampBall({ x: 900, y: 5000 }, wa)).toEqual({ x: 900, y: 1040 - BALL - EDGE })
    expect(clampBall({ x: 5000, y: 300 }, second)).toEqual({ x: 1920 + 1280 - BALL - EDGE, y: 300 })
  })

  it('默认位置在主屏右侧', () => {
    const b = defaultBall(wa)
    expect(b.x).toBe(1920 - BALL - 16)
    expect(isOnScreen(b, [wa])).toBe(true)
  })

  it('显示器拔掉后，保存的位置不再有效', () => {
    const onSecond = { x: 2500, y: 400 }
    expect(isOnScreen(onSecond, [wa, second])).toBe(true)
    expect(isOnScreen(onSecond, [wa])).toBe(false)
  })
})
