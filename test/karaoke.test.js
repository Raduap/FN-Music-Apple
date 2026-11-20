import { describe, expect, it } from 'vitest'
import { karaokeFills, smoothWordTimeline } from '../src/lyrics.js'

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

  it('limit 会传给平滑预算，避免扫色越过下一句起点', () => {
    // 6 个 0.4s 正常词 + 1 个 0.02s 短词：strong 平滑会把句尾从 2.42s 拉到 2.635s，
    // limit 2.5 必须把它压回 2.5；若 limit 没透传，bounded 与 unlimited 会一模一样。
    let start = 0
    const words = []
    for (let i = 0; i < 6; i++) { words.push({ text: 'a', time: start, end: start + 0.4 }); start += 0.4 }
    words.push({ text: 'b', time: start, end: start + 0.02 })
    const long = { text: 'a a a a a a b', words }
    const limit = 2.5
    // 平滑后的句尾从 2.42s 被拉到约 2.635s；取「限位点」与「平滑句尾」的中点采样，
    // 这样即使以后调平滑参数，只要能越过下一句起点，断言依然成立。
    const smoothedEnd = smoothWordTimeline(words, 'strong').at(-1).end
    expect(smoothedEnd).toBeGreaterThan(limit)
    const t = (limit + smoothedEnd) / 2
    const unlimited = karaokeFills(long, t, { smooth: 'strong' })
    const bounded = karaokeFills(long, t, { smooth: 'strong', limit })
    expect(bounded.fills.every((f) => f === 1)).toBe(true) // limit 生效：此刻必须已经铺满
    expect(unlimited.fills.some((f) => f < 1)).toBe(true) // 对照：不限位时还没铺满，断言才有区分度
  })

  it('无词数据返回 null', () => {
    expect(karaokeFills({ text: 'x' }, 1)).toBe(null)
    expect(karaokeFills(null, 1)).toBe(null)
  })
})
