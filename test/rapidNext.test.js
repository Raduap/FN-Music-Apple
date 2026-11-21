import { describe, expect, it } from 'vitest'
import { advanceIndex, RAPID_NEXT_DELAY } from '../src/rapidNext.js'

describe('快速连点下一首', () => {
  it('合并窗口为 140ms', () => {
    expect(RAPID_NEXT_DELAY).toBe(140)
  })

  it('连续点击按次数前进', () => {
    let i = 3
    for (let n = 0; n < 5; n++) i = advanceIndex(i, 10)
    expect(i).toBe(8)
  })

  it('到队尾后手动下一首回到第一首', () => {
    expect(advanceIndex(9, 10)).toBe(0)
    expect(advanceIndex(9, 10, { wrap: false })).toBe(-1)
  })

  it('没有有效队列时返回 -1', () => {
    expect(advanceIndex(-1, 0)).toBe(-1)
    expect(advanceIndex(-1, 5)).toBe(0)
  })
})
