import { describe, expect, it } from 'vitest'
import { karaokeFills } from '../src/lyrics.js'

describe('karaokeFills（连续逐字进度）', () => {
  const line = {
    text: 'Look at the',
    words: [
      { text: 'Look', time: 10, end: 10.5 },
      { text: 'at', time: 11, end: 11.4 }, // 词间有 0.5s 间隙
      { text: 'the', time: 11.4, end: 12 },
    ],
  }

  it('进度边单调连续，词间间隙线性推进', () => {
    const a = karaokeFills(line, 10.25) // Look 唱到一半
    const b = karaokeFills(line, 10.75) // 间隙中段
    const c = karaokeFills(line, 11.2)  // at 唱到一半
    const pos = (k) => k.fills.reduce((s, f, i) => s + f * [4, 2, 3][i], 0)
    expect(a.fills[0]).toBeCloseTo(0.5, 5)
    expect(pos(b)).toBeGreaterThan(pos(a)) // 间隙也在推进
    expect(pos(c)).toBeGreaterThan(pos(b))
  })

  it('句首之前全 0，句尾之后全 1', () => {
    expect(karaokeFills(line, 9).fills.every((f) => f === 0)).toBe(true)
    expect(karaokeFills(line, 99).fills.every((f) => f === 1)).toBe(true)
  })

  it('快唱短词不会出现 fill 回退', () => {
    const fast = { text: 'a b', words: [{ text: 'a', time: 1, end: 1.05 }, { text: 'b', time: 1.1, end: 1.2 }] }
    const f1 = karaokeFills(fast, 1.04)
    const f2 = karaokeFills(fast, 1.15)
    const pos = (k) => k.fills.reduce((s, f) => s + f, 0)
    expect(pos(f2)).toBeGreaterThan(pos(f1))
  })

  it('无词数据返回 null', () => {
    expect(karaokeFills({ text: 'x' }, 1)).toBe(null)
    expect(karaokeFills(null, 1)).toBe(null)
  })
})
