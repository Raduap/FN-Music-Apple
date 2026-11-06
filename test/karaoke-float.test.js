import { describe, expect, it } from 'vitest'
import { fillWordTimes, karaokeClock, karaokeProgress, karaokeWords, splitKaraokeSpans } from '../src/karaoke'

describe('karaoke 悬浮窗纯函数', () => {
  it('spans 拼接后逐字符等于原文（含空格）', () => {
    const text = '  Look at  the sky!'
    const spans = splitKaraokeSpans(text)
    expect(spans.map((s) => s.text).join('')).toBe(text)
    expect(spans[0].text).toBe('  Look ')
    expect(spans[spans.length - 1].text).toContain('sky!')
  })

  it('无词级数据时按字符长度均分整句时间', () => {
    const words = fillWordTimes({ time: 10, end: 12, text: 'a b' })
    expect(words.map((w) => w.text).join('')).toBe('a b')
    expect(words[0].time).toBe(10)
    expect(words[words.length - 1].end).toBe(12)
    const p = karaokeProgress({ text: 'a b', words }, 11)
    expect(p[0]).toBeGreaterThan(0)
    expect(p[p.length - 1]).toBeLessThan(1)
  })

  it('有词级数据时直接透传（不重新分配时间）', () => {
    const words = [{ text: 'a', time: 1, end: 1.2 }, { text: ' b', time: 1.2, end: 1.4 }]
    const out = karaokeWords({ time: 0, end: 9, text: 'a b', words }).words
    expect(out[0].time).toBe(1)
    expect(out[1].end).toBe(1.4)
  })

  it('karaokeWords：有 words / 无 words / 空行三种情况', () => {
    expect(karaokeWords({ text: 'hi', words: [{ text: 'hi', time: 1, end: 2 }] }).words.length).toBe(1)
    expect(karaokeWords({ text: 'hi', time: 1, end: 2 }).words[0].text).toBe('hi')
    expect(karaokeWords({ text: '' })).toBe(null)
  })

  it('karaokeClock：播放中按 at 推算，暂停冻结', () => {
    const now = 1000
    expect(karaokeClock({ currentTime: 5, at: 400, playing: true }, now)).toBeCloseTo(5.6, 5)
    expect(karaokeClock({ currentTime: 5, at: 400, playing: false }, now)).toBe(5)
    expect(karaokeClock({ currentTime: 5, at: 0, playing: true }, now)).toBe(5)
  })

  it('连续进度：词间间隙也推进（与 karaokeFills 同语义）', () => {
    const line = { text: 'a b', words: [{ text: 'a', time: 1, end: 1.1 }, { text: 'b', time: 1.3, end: 1.5 }] }
    const a = karaokeProgress(line, 1.05)
    const b = karaokeProgress(line, 1.2)
    const c = karaokeProgress(line, 1.4)
    const pos = (f) => f[0] + f[1]
    expect(pos(b)).toBeGreaterThan(pos(a))
    expect(pos(c)).toBeGreaterThan(pos(b))
  })
})

