import { describe, expect, it } from 'vitest'
import { toLines, mergeTranslations } from '../src/lyrics.js'

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
