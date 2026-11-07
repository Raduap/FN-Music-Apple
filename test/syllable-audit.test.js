import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { detectLang, lyricsTextOf, stratifiedSample } = require('../dev/syllable-audit/sample.js')
const { parseName } = require('../dev/syllable-audit/library.js')
const { scoreSource } = await import('../dev/syllable-audit/score.mjs')

describe('审计 · 语言分层', () => {
  it('按假名 / 韩文 / 汉字占比判定语言', () => {
    expect(detectLang('残酷な天使のテーゼ')).toBe('ja')
    expect(detectLang('사랑해요')).toBe('ko')
    expect(detectLang('我们都一样')).toBe('zh')
    expect(detectLang('Counting Stars')).toBe('latin')
    expect(detectLang('')).toBe('unknown')
  })

  it('lyricsTextOf 跳过元数据行', () => {
    const t = lyricsTextOf('[ti:x]\n[ar:y]\n[00:01.00]你好世界')
    expect(t).toBe('你好世界')
  })
})

describe('审计 · 确定性抽样', () => {
  it('同一 seed 产出同一结果', () => {
    const tracks = Array.from({ length: 40 }, (_, i) => ({ title: 't' + i, artist: 'a', lrcText: '[00:01]你好' }))
    const a = stratifiedSample(tracks, { seed: 42, total: 10 }).picked.map((t) => t.title)
    const b = stratifiedSample(tracks, { seed: 42, total: 10 }).picked.map((t) => t.title)
    expect(a).toEqual(b)
  })

  it('小分层（<= stratumMin）全量取，避免样本不足', () => {
    const tracks = [
      ...Array.from({ length: 20 }, () => ({ title: 'zh', artist: 'a', lrcText: '[00:01]你好' })),
      ...Array.from({ length: 3 }, (_, i) => ({ title: 'ko' + i, artist: 'a', lrcText: '[00:01]사랑' })),
    ]
    const { picked, strata } = stratifiedSample(tracks, { seed: 1, total: 10, stratumMin: 10 })
    expect(strata.ko).toBe(3)
    expect(picked.filter((t) => t.title.startsWith('ko')).length).toBe(3)
  })

  it('total 不足时从剩余池补齐，且不超量', () => {
    const tracks = Array.from({ length: 100 }, (_, i) => ({ title: 't' + i, artist: 'a', lrcText: '[00:01]hello' }))
    const { picked } = stratifiedSample(tracks, { seed: 3, total: 25 })
    expect(picked.length).toBe(25)
  })
})

describe('审计 · 文件名解析', () => {
  it('按第一个 " - " 拆艺人/标题', () => {
    expect(parseName('周杰伦 - 反方向的钟')).toEqual({ artist: '周杰伦', title: '反方向的钟' })
    expect(parseName('A - B - C')).toEqual({ artist: 'A', title: 'B - C' })
    expect(parseName('无分隔符')).toEqual({ artist: '', title: '无分隔符' })
  })
})

describe('审计 · 打分指标', () => {
  const local = [
    { time: 1, text: '你好世界' },
    { time: 5, text: '第二句歌词' },
  ]

  it('无候选时覆盖率为 0', () => {
    const s = scoreSource(local, [])
    expect(s.totalSingable).toBe(2)
    expect(s.picked).toBe(null)
  })

  it('完全命中时覆盖率 100%、文本吻合 100%', () => {
    const cand = {
      source: 'x', provider: 'p',
      lines: [
        { time: 1, text: '你好世界', words: [{ text: '你好', time: 1, end: 1.5 }, { text: '世界', time: 1.5, end: 2 }] },
        { time: 5, text: '第二句歌词', words: [{ text: '第二句歌词', time: 5, end: 6 }] },
      ],
    }
    const s = scoreSource(local, [cand])
    expect(s.picked.coverage).toBe(1)
    expect(s.picked.textAgreeRate).toBe(1)
    expect(s.picked.outOfRange).toBe(0)
  })

  it('时间错位过大时计入 outOfRange', () => {
    const cand = {
      source: 'x', provider: 'p',
      lines: [{ time: 1, text: '你好世界', words: [{ text: '你好世界', time: 40, end: 41 }] }],
    }
    // 本地第一行 time=1，词时间 40 远超 ±5s：行时间对上了，但词时间错位，应被计入
    const s = scoreSource(local, [cand])
    expect(s.perCand[0].outOfRange).toBe(1)
  })
})
