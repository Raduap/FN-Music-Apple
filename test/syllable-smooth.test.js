import { describe, expect, it } from 'vitest'
import { smoothWordTimeline, sanitizeWordTimeline } from '../src/lyrics.js'

const w = (text, time, end) => ({ text, time, end })
const speed = (x) => [...String(x.text)].length / (x.end - x.time)

// 扫色平滑：只封顶「过快」的一端，慢字（真实长音 / 拖音）一律不动。
describe('逐字扫色速度上限平滑（smoothWordTimeline）', () => {
  it('strict 模式不做任何改动（返回原数组）', () => {
    const words = [w('a', 1, 1.1), w('b', 1.1, 1.2)]
    expect(smoothWordTimeline(words, 'strict')).toBe(words)
  })

  it('只压过快字：异常快的字被压慢，慢字原样不动', () => {
    // 残響散歌式：よ 14 字/s、の 23 字/s 过快；轟 1.6 字/s 是真实长音
    const words = sanitizeWordTimeline([
      w('声', 0, 0.4), w('よ', 0.4, 0.44), w('轟', 0.44, 1.05), w('け', 1.05, 1.5),
      w('の', 1.5, 1.55), w('そ', 1.55, 1.9),
    ], { start: 0, end: 1.9 })
    const before = words.map(speed)
    const out = smoothWordTimeline(words, 'normal')
    const after = out.map(speed)
    // 快字被压：よ、の 速度下降
    expect(after[1]).toBeLessThan(before[1])
    expect(after[4]).toBeLessThan(before[4])
    // 慢字不动：声、轟、け、そ 速度保持不变（误差内）
    for (const i of [0, 2, 3, 5]) expect(after[i]).toBeCloseTo(before[i], 2)
  })

  it('词起唱点基本不动（被封顶字的位移很小）', () => {
    const words = sanitizeWordTimeline([
      w('あ', 10, 10.4), w('い', 10.4, 10.44), w('う', 10.44, 10.84), w('え', 10.84, 11.0),
    ], { start: 10, end: 11 })
    const out = smoothWordTimeline(words, 'normal')
    for (let i = 0; i < words.length; i++) {
      expect(Math.abs(out[i].time - words[i].time)).toBeLessThan(0.12)
    }
  })

  it('文本 / 词数不变，顺序保持单调', () => {
    const words = sanitizeWordTimeline([
      w('a', 0, 0.5), w('b', 0.5, 0.53), w('c', 0.53, 1.0), w('d', 1.0, 1.03), w('e', 1.03, 1.5),
    ], { start: 0, end: 1.5 })
    const out = smoothWordTimeline(words, 'strong')
    expect(out.map((x) => x.text).join('')).toBe('abcde')
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThanOrEqual(out[i - 1].end - 1e-9)
  })

  it('整句本就不快时三挡都原样返回（不误伤匀速歌词）', () => {
    const words = sanitizeWordTimeline([
      w('Said', 0, 0.4), w(' no', 0.4, 0.6), w(' more', 0.6, 0.9), w(' counting', 0.9, 1.5),
    ], { start: 0, end: 1.5 })
    for (const mode of ['mild', 'normal', 'strong']) {
      const out = smoothWordTimeline(words, mode)
      out.forEach((x, i) => expect(x.time).toBeCloseTo(words[i].time, 3))
    }
  })

  it('limit 约束：平滑后末词结束不超过窗口右界', () => {
    // 一句没救的「甲乙丙丁」全快字，窗口右界只给一点点余量
    const words = sanitizeWordTimeline([
      w('甲', 0, 0.05), w('乙', 0.05, 0.1), w('丙', 0.1, 0.15), w('丁', 0.15, 0.2),
    ], { start: 0, end: 0.2 })
    const out = smoothWordTimeline(words, 'strong', 0.25)
    expect(out[out.length - 1].end).toBeLessThanOrEqual(0.25 + 1e-6)
  })

  it('limit 已无余量时完全不延长（末词不越过窗口）', () => {
    const words = sanitizeWordTimeline([
      w('甲', 0, 0.05), w('乙', 0.05, 0.1), w('丙', 0.1, 0.15), w('丁', 0.15, 0.2),
    ], { start: 0, end: 0.2 })
    // 窗口右界正好等于原始末词结束 → 没有预算可延长
    const out = smoothWordTimeline(words, 'strong', 0.2)
    for (let i = 0; i < words.length; i++) {
      expect(out[i].time).toBeCloseTo(words[i].time, 6)
      expect(out[i].end).toBeCloseTo(words[i].end, 6)
    }
  })

  it('词数少于 2 或时间无效时原样返回', () => {
    expect(smoothWordTimeline([w('a', 0, 1)], 'strong')).toEqual([w('a', 0, 1)])
    expect(smoothWordTimeline([], 'normal')).toEqual([])
  })
})
