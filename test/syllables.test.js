import { describe, expect, it } from 'vitest'
import { karaokeFills, mergeSyllableLines } from '../src/lyrics.js'

describe('逐字歌词（实验性）', () => {
  const words = [
    { text: 'Look', time: 10, end: 10.4 },
    { text: 'at', time: 10.4, end: 10.7 },
    { text: 'the', time: 10.7, end: 11 },
  ]

  it('karaokeFills 命中当前正在唱的词进度', () => {
    const line = { text: words.map((w) => w.text).join(' '), words }
    const k = karaokeFills(line, 10.5)
    expect(k.fills[0]).toBe(1)      // Look 已唱完（end 10.4）
    expect(k.fills[1]).toBeGreaterThan(0) // at 正在唱
    expect(k.fills[2]).toBe(0)
    expect(karaokeFills(line, 9.9).fills.every((f) => f === 0)).toBe(true)
    expect(karaokeFills(line, 11.5).fills.every((f) => f === 1)).toBe(true)
  })

  it('mergeSyllableLines 按行起点就近合并词级时间轴', () => {
    const lines = [
      { time: 10, text: 'Look at the' },
      { time: 14, text: 'Stars' },
    ]
    const syllables = [
      { time: 10.01, end: 11.2, text: 'Look at the', words },
      { time: 14.02, end: 15, text: 'Stars', words: [{ text: 'Stars', time: 14.02, end: 15 }] },
    ]
    const merged = mergeSyllableLines(lines, syllables)
    expect(merged[0].words.map((w) => w.text).join('')).toBe('Look at the')
    expect(merged[0].end).toBe(11.2)
    expect(merged[1].words?.length).toBe(1)
  })

  it('文本对不上但时间接近时，仍按时间对齐挂词级时间轴（不同来源分行差异）', () => {
    const lines = [{ time: 10, text: 'Completely different text' }]
    const merged = mergeSyllableLines(lines, [{ time: 10.1, text: 'Look at the', words }])
    expect(merged[0].words?.length).toBe(words.length)
    expect(merged[0].text).toBe('Completely different text')
  })

  it('空数据直接返回原行', () => {
    const lines = [{ time: 1, text: 'x' }]
    expect(mergeSyllableLines(lines, null)).toEqual(lines)
    expect(mergeSyllableLines([], [])).toEqual([])
  })
})

  it('mergeSyllableLines 调试统计：时间锚点命中 / 文本对不上但时间对齐 / 真的没数据', () => {
    const lines = [
      { time: 10, text: 'Look at the' },
      { time: 14, text: 'Stars' },
      { time: 18, text: 'Far away line' },
    ]
    const syllables = [
      { time: 10.01, text: 'Look at the', words: [{ text: 'Look', time: 10, end: 10.4 }] },
      { time: 14.02, text: 'Totally Different', words: [{ text: 'Totally', time: 14, end: 15 }] },
      { time: 99, text: 'Out of sync', words: [{ text: 'Out', time: 99, end: 100 }] },
    ]
    let stats = null
    mergeSyllableLines(lines, syllables, (s) => { stats = s })
    expect(stats.matched).toBe(2) // 文本锚点 + 时间对齐
    expect(stats.skippedText).toBe(1)
    expect(stats.skippedTime).toBe(1)
  })