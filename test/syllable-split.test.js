import { describe, expect, it } from 'vitest'
import { mergeSyllableLines } from '../src/lyrics.js'

const w = (text, t, e) => ({ text, time: t, end: e })

// 复现回归：酷狗 / QQ 把相邻两句并成一行，导致第二句落到时间硬配、
// 之后整段错位一行，表现为大段「永远不会铺色」。
// 真实样本：OneRepublic - Counting Stars。
describe('逐字合并：远端一行覆盖本地连续多句（分行差异）', () => {
  // 远端把「I see this life」和「Like a swinging vine」并成一行
  const remote = [
    { time: 37.7, end: 40.3, text: 'I see this life like a swinging vine', words: [
      w('I', 37.7, 38.0), w(' see', 38.0, 38.4), w(' this', 38.4, 38.8), w(' life', 38.8, 39.0),
      w(' like', 39.0, 39.3), w(' a', 39.3, 39.5), w(' swinging', 39.5, 39.9), w(' vine', 39.9, 40.3),
    ] },
    { time: 40.7, end: 42.4, text: 'Swing my heart across the line', words: [w('Swing my heart across the line', 40.7, 42.4)] },
    { time: 42.6, end: 44.5, text: 'In my face is flashing signs', words: [w('In my face is flashing signs', 42.6, 44.5)] },
    { time: 44.6, end: 46.4, text: "Seek it out and ye' shall find", words: [w("Seek it out and ye' shall find", 44.6, 46.4)] },
  ]
  const local = [
    { time: 37.72, text: 'I see this life' },
    { time: 39.03, text: 'Like a swinging vine' },
    { time: 40.34, text: 'Swing my heart across the line' },
    { time: 42.09, text: 'And in my face is flashing signs' },
    { time: 43.97, text: "Seek it out and ye' shall find" },
  ]

  it('拆分后每句都拿到不越界的真实时间轴', () => {
    let stats = null
    const merged = mergeSyllableLines(local, remote, (s) => { stats = s })
    for (const l of merged) expect(l.words?.map((x) => x.text).join('')).toBe(l.text)
    // 必须真的走了「分行拆合」层，否则回归可能只是碰巧通过
    expect(stats.matchedSplit).toBeGreaterThanOrEqual(2)
  })

  it('不再产生「首词起点晚于下一句起点」的错位行', () => {
    const merged = mergeSyllableLines(local, remote)
    for (let i = 0; i < merged.length; i++) {
      const l = merged[i]
      if (!l.words?.length) continue
      const next = merged[i + 1]
      if (!next) continue
      expect(l.words[0].time).toBeLessThan(next.time)
    }
  })

  it('拆分只按整行可拼合触发，不相干的行不会被硬拆', () => {
    const other = [{ time: 10, text: '完全不相干的另一首歌的句子在这里', words: [w('完全不相干的另一首歌的句子在这里', 10, 12)] }]
    const lines = [{ time: 10, text: '本地第一句' }, { time: 12, text: '本地第二句' }]
    const merged = mergeSyllableLines(lines, other)
    expect(merged[0].words?.map((x) => x.text).join('')).not.toBe('本地第一句本地第二句')
  })
})

describe('逐字合并：词时间轴越界收口', () => {
  it('首词起点跑到下一句之后时按本句窗口重铺，窗口内一定有进度', () => {
    // 本地句 10s~20s（下一句 20s），远端词却从 25s 才开始
    const local = [{ time: 10, text: '第一句' }, { time: 20, text: '第二句' }]
    const remote = [
      { time: 10, text: '第一句', words: [w('第一句', 25, 26)] },
      { time: 20, text: '第二句', words: [w('第二句', 20, 22)] },
    ]
    const merged = mergeSyllableLines(local, remote)
    const l = merged[0]
    expect(l.words[0].time).toBeLessThan(20)
    expect(l.words[l.words.length - 1].end ?? l.words[l.words.length - 1].time).toBeGreaterThan(10)
  })

  it('偏离过大（不是版本漂移）时原样保留，交给审计判为 outOfRange', () => {
    const local = [{ time: 1, text: '你好世界' }, { time: 5, text: '第二句歌词' }]
    const remote = [{ time: 1, text: '你好世界', words: [w('你好世界', 40, 41)] }]
    const merged = mergeSyllableLines(local, remote)
    expect(merged[0].words[0].time).toBe(40)
  })
})
