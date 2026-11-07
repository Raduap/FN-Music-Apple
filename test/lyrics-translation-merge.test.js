import { describe, expect, it } from 'vitest'
import { toLines, mergeTranslations, mergeSyllableLines, textBagOverlap } from '../src/lyrics.js'

const lrc = (...rows) => rows.join('\n')

describe('双语歌词合并：译文不丢', () => {
  it('同时间戳（含 30ms 取整差异）的原文 + 译文合并成一行', () => {
    const out = toLines(lrc(
      '[00:01.00]Hello',
      '[00:01.02]你好',
      '[00:02.00]World',
      '[00:02.02]世界',
      '[00:03.00]Foo',
      '[00:03.02]福',
    ))
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ text: 'Hello', translation: '你好' })
    expect(out[2]).toMatchObject({ text: 'Foo', translation: '福' })
  })

  it('译文比原文晚 <=1.5s 且无词级时间轴、且成规模出现时，回填成 translation', () => {
    const out = toLines(lrc(
      '[00:01.00]Hello world',
      '[00:01.80]你好世界',
      '[00:05.00]Second line',
      '[00:06.20]第二句',
      '[00:09.00]Third line',
      '[00:10.10]第三句',
    ))
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ text: 'Hello world', translation: '你好世界' })
    expect(out[1]).toMatchObject({ text: 'Second line', translation: '第二句' })
    expect(out[2]).toMatchObject({ text: 'Third line', translation: '第三句' })
  })

  it('偏移译文只出现 1~2 次时按普通歌词处理，不误并', () => {
    const out = toLines(lrc(
      '[00:01.00]Hello world',
      '[00:01.80]你好世界',
      '[00:05.00]Second line',
      '[00:06.20]第二句',
    ))
    expect(out).toHaveLength(4)
    expect(out.every((l) => !l.translation)).toBe(true)
  })

  it('两句同为中文时不回填，避免把正常歌词误并成译文', () => {
    const out = mergeTranslations([
      { time: 1, text: '第一句中文' },
      { time: 1.5, text: '第二句中文' },
      { time: 3, text: '第三句中文' },
      { time: 3.5, text: '第四句中文' },
      { time: 5, text: '第五句中文' },
      { time: 5.5, text: '第六句中文' },
    ])
    expect(out).toHaveLength(6)
    expect(out.every((l) => !l.translation)).toBe(true)
  })

  it('间隔超过 1.5s 不视为译文', () => {
    const out = mergeTranslations([
      { time: 1, text: 'Hello world' },
      { time: 4, text: '你好世界' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].translation).toBeUndefined()
  })

  it('第三条同时间行的文本不会被丢弃', () => {
    const out = mergeTranslations([
      { time: 1, text: 'Hello' },
      { time: 1, text: '你好' },
      { time: 1, text: 'Bonjour' },
      { time: 2, text: 'World' },
      { time: 2, text: '世界' },
      { time: 2, text: 'Monde' },
      { time: 3, text: 'Foo' },
      { time: 3, text: '福' },
      { time: 3, text: 'Bar' },
    ])
    const joined = out.map((l) => `${l.text}|${l.translation || ''}`).join(' ')
    expect(joined).toContain('Bonjour')
    expect(joined).toContain('Monde')
  })
})


describe('逐字合并 · 文本证据门控（防把不同歌配上）', () => {
  const remote = (text, t, parts) => ({ text, time: t, end: t + 2, words: parts.map((p, i) => ({ text: p, time: t + i, end: t + i + 0.9 })) })

  it('字符串袋重叠能区分「同曲异版」与「不同歌」', () => {
    // 同曲异版：字符构成高度相似
    expect(textBagOverlap('乌云在我们心里搁下一块阴影', '乌云在我们心里搁下一块阴影（Live）')).toBeGreaterThan(0.8)
    // 不同歌：即便歌名 / 时长相同，字符重合也很低
    expect(textBagOverlap('信劄拆封誰為難不過寥寥數行', '我在人民广场吃炸鸡喝啤酒')).toBeLessThan(0.5)
  })

  it('字符构成完全不同时，即使行数与时间跨度接近也不做硬配', () => {
    const local = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: '信劄拆封誰為難不過寥寥數行' }))
    // 候选行数、跨度都与本地一致，但文本是完全不同的歌
    const other = Array.from({ length: 10 }, (_, i) => remote('我在人民广场吃炸鸡喝啤酒', i * 10, ['我在人民广场吃炸鸡喝啤酒']))
    const merged = mergeSyllableLines(local, other)
    expect(merged.filter((l) => l.words?.length).length).toBe(0)
  })

  it('同曲异版（含 Live 标记）仍照常配对', () => {
    const local = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: '乌云在我们心里搁下一块阴影' }))
    const cand = Array.from({ length: 10 }, (_, i) => remote('乌云在我们心里搁下一块阴影', i * 10, ['乌云在我们心里搁下一块阴影']))
    const merged = mergeSyllableLines(local, cand)
    expect(merged.filter((l) => l.words?.length).length).toBe(10)
  })
})
