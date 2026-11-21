import { describe, expect, it } from 'vitest'
import { karaokeFills, predictKaraokeLines, predictWordTimings, sanitizeWordTimeline } from '../src/lyrics.js'
import { smoothFills } from '../src/karaoke.js'

describe('逐字时间轴清洗（消除反复铺色 / 褪色）', () => {
  it('时间倒退 / 重叠 / 零时长都会被拉直，时间只许往前走', () => {
    const words = sanitizeWordTimeline([
      { text: 'Just', time: 148.01, end: 148.2 },
      { text: ' meet', time: 146.82, end: 148.5 }, // 倒退
      { text: ' me', time: 147.5, end: 147.5 },     // 重叠 + 零时长
    ], { start: 147, end: 149 })
    for (let i = 1; i < words.length; i++) expect(words[i].time).toBeGreaterThanOrEqual(words[i - 1].end - 1e-9)
    for (const w of words) expect(w.end).toBeGreaterThan(w.time)
  })

  it('首词时间戳为 0 的行按行起点修正，不再瞬间回退到句首', () => {
    const words = sanitizeWordTimeline([
      { text: 'Uh,', time: 0, end: 0.4 },
      { text: ' uh', time: 0.4, end: 0.8 },
    ], { start: 11.47, end: 13.116 })
    expect(words[0].time).toBeCloseTo(11.47, 3)
  })

  it('脏时间轴在整曲逐帧采样下进度不再回退', () => {
    const line = {
      text: 'Uh, uh huh uh huh',
      words: [
        { text: 'Uh,', time: 11.501, end: 12.086 },
        { text: ' uh h', time: 12.086, end: 12.263 },
        { text: 'uh', time: 12.263, end: 12.446 },
        { text: ' uh h', time: 12.446, end: 12.668 },
        { text: 'uh', time: 12.668, end: 13.116 },
      ],
    }
    let prev = -1
    for (let t = 11.4; t <= 13.2; t += 0.016) {
      const pos = karaokeFills(line, t).pos
      expect(pos).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = pos
    }
  })
})

describe('智能逐字补全（无词级数据时的预测）', () => {
  it('预测结果拼接后逐字符等于原文', () => {
    const text = "  Look at the stars tonight!"
    const words = predictWordTimings(text, 10, 13)
    expect(words.map((w) => w.text).join('')).toBe(text)
  })

  it('token 时长有界且首尾落在区间内', () => {
    const words = predictWordTimings('Happy birthday to you', 5, 8)
    expect(words[0].time).toBeGreaterThanOrEqual(5)
    expect(words[words.length - 1].end).toBeLessThanOrEqual(8 + 1e-9)
    for (const w of words) expect(w.end).toBeGreaterThan(w.time)
  })

  it('有真实词级时间的行原样保留，其余行补预测', () => {
    const real = [{ text: 'real', time: 1, end: 1.5 }]
    const lines = [
      { time: 1, end: 1.5, text: 'real', words: real },
      { time: 2, text: 'predicted line' },
    ]
    const out = predictKaraokeLines(lines, { duration: 30 })
    expect(out[0].words).toBe(real)
    expect(out[1].words.map((w) => w.text).join('')).toBe('predicted line')
  })

  it('预测不会把最后一个词拖到长间奏末尾', () => {
    const out = predictKaraokeLines([{ time: 0, text: 'last line' }], { duration: 300 })
    const last = out[0].words[out[0].words.length - 1]
    expect(last.end).toBeLessThan(60)
  })
})

describe('逐帧平滑（只增不减 + seek 可回退）', () => {
  it('正常前进时宽度绝不倒着退', () => {
    const shown = smoothFills([0.5, 0.0], [0.3, 0.0])
    expect(shown[0]).toBe(0.5)
  })

  it('回退由调用方重置 prev（seek 时传 null 贴齐目标），smoothFills 本身不回退', () => {
    // 调用方检测到时间回退会传 null，此时直接采用目标。
    expect(smoothFills(null, [0, 0, 0])).toEqual([0, 0, 0])
    // 不重置时，宽度只增不减（脏数据导致目标变小也不会褪色）。
    expect(smoothFills([1, 1, 1], [0.4, 0.4, 0.4])).toEqual([1, 1, 1])
  })

  it('缓动逼近目标而不是瞬间硬跳', () => {
    const shown = smoothFills([0, 0], [1, 0])
    expect(shown[0]).toBeGreaterThan(0)
    expect(shown[0]).toBeLessThan(1)
  })

  it('长度变化（切句 / 换歌）时直接采用目标', () => {
    expect(smoothFills([0.4], [0, 0.5])).toEqual([0, 0.5])
  })
})

describe('karaokeFills 区间不重叠（词文本对不上时也不能跳）', () => {
  it('词与整句无法逐字对上时，区间仍顺序推进、进度单调', () => {
    // 本地句比词级数据多出内容（不同来源断词差异），旧实现会让区间重叠 -> pos 跳回
    const line = {
      text: 'Look at the stars tonight',
      words: [
        { text: 'Look', time: 1, end: 1.4 },
        { text: 'at', time: 1.4, end: 1.7 },
        { text: 'the stars tonight', time: 1.7, end: 2.5 },
      ],
    }
    const k = karaokeFills(line, 2.0)
    for (let i = 1; i < k.starts.length; i++) {
      expect(k.starts[i]).toBeGreaterThanOrEqual(k.starts[i - 1] + k.spans[i - 1])
    }
    let prev = -1
    for (let tt = 0.9; tt <= 2.6; tt += 0.016) {
      const pos = karaokeFills(line, tt).pos
      expect(pos).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = pos
    }
  })
})
