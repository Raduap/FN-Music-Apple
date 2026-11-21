import { describe, expect, it } from 'vitest'
import { mergeSyllableLines, pickSyllableCandidate } from '../src/lyrics.js'

describe('逐字合并：间奏空行', () => {
  const local = [
    { time: 1, text: '第一句' },
    { time: 5, text: '' }, // 间奏空行
    { time: 9, text: '第二句' },
  ]
  const remote = [
    { time: 1, text: '第一句', words: [{ text: '第', time: 1, end: 2 }, { text: '一句', time: 2, end: 3 }] },
    { time: 5, text: '间奏假词', words: [{ text: '间奏假词', time: 5, end: 6 }] },
    { time: 9, text: '第二句', words: [{ text: '第', time: 9, end: 10 }, { text: '二句', time: 10, end: 11 }] },
  ]

  it('空行不配词，也不占用远端候选', () => {
    const merged = mergeSyllableLines(local, remote)
    expect(merged[0].words?.length).toBe(2)
    expect(merged[1].words).toBeUndefined() // 空行不配词
    expect(merged[2].words?.length).toBe(2)
  })

  it('覆盖率按可唱行计算，空行不拉低分数', () => {
    const pick = pickSyllableCandidate(local, [{ source: 'test', provider: 't', lines: remote }])
    expect(pick.coverage).toBe(1) // 2/2 可唱行全命中
  })

  it('覆盖率相近时优先选行数比例接近 1 的候选', () => {
    // 候选A：2行恰好对应2句；候选B：6行（分行碎）覆盖率相同
    const a = [
      { time: 1, text: '第一句', words: [{ text: '第一句', time: 1, end: 3 }] },
      { time: 9, text: '第二句', words: [{ text: '第二句', time: 9, end: 11 }] },
    ]
    const b = [
      { time: 1, text: '第一句', words: [{ text: '第一句', time: 1, end: 3 }] },
      { time: 9, text: '第二句', words: [{ text: '第二句', time: 9, end: 11 }] },
      { time: 20, text: '多余一', words: [{ text: '多余一', time: 20, end: 21 }] },
      { time: 25, text: '多余二', words: [{ text: '多余二', time: 25, end: 26 }] },
      { time: 30, text: '多余三', words: [{ text: '多余三', time: 30, end: 31 }] },
    ]
    const pick = pickSyllableCandidate(local, [
      { source: 'b', provider: 'b', lines: b },
      { source: 'a', provider: 'a', lines: a },
    ])
    expect(pick.source).toBe('a')
  })
})

