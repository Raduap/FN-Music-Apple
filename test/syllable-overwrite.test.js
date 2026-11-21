import { describe, expect, it } from 'vitest'
import { candidateStructureScore, isTrustedOverride, overrideSyllableLines, remapEnhancementsByTime } from '../src/lyrics.js'

const word = (text, time, end) => ({ text, time, end })
const remoteLine = (text, time, translation = '', roman = '') => ({
  time,
  end: time + 2,
  text,
  translation,
  roman,
  words: [word(text.slice(0, 1), time, time + 0.5), word(text.slice(1), time + 0.5, time + 1.5)],
})
const local = ['A1', 'B2', 'C3', 'D4', 'E5'].map((text, i) => ({ time: i * 5, text, translation: `译${text}` }))

describe('逐字覆盖歌词', () => {
  it('可信候选覆盖正文、words 和 end，且保持同一来源', () => {
    const cand = { source: 'qq', provider: 'qq-qrc', lines: local.map((l, i) => remoteLine(l.text, l.time, `源译${i}`)) }
    const result = overrideSyllableLines(local, cand)
    expect(result).not.toBe(null)
    expect(result.source).toBe('qq')
    expect(result.lines.map((l) => l.text)).toEqual(local.map((l) => l.text))
    expect(result.lines.every((l) => l.words?.length === 2)).toBe(true)
    expect(result.lines[0].end).toBe(2)
  })

  it('覆盖行保留正文空格，逐字拼接与原文一致', () => {
    const lines = ['Hello world', 'Look at the sky', 'One more time', 'Sing it loud', 'Here we go'].map((text, i) => ({ time: i * 5, text }))
    const cand = {
      source: 'qq',
      provider: 'qq-qrc',
      lines: lines.map((l, i) => ({
        time: l.time,
        end: l.time + 3,
        text: l.text,
        words: l.text.split(' ').map((textPart, wi) => ({ text: textPart, time: l.time + wi * 0.5, end: l.time + wi * 0.5 + 0.4 })),
      })),
    }
    const result = overrideSyllableLines(lines, cand)
    expect(result).not.toBe(null)
    expect(result.lines[0].words.map((w) => w.text).join('')).toBe('Hello world')
    expect(result.lines[1].words.map((w) => w.text).join('')).toBe('Look at the sky')
  })

  it('低文本重合的翻唱/错误版本不覆盖', () => {
    const cand = { source: 'qq', provider: 'qq-qrc', lines: local.map((_, i) => remoteLine(`X${i}-完全不同`, i * 5)) }
    const score = candidateStructureScore(local, cand)
    expect(isTrustedOverride(local, cand, score)).toBe(false)
    expect(overrideSyllableLines(local, cand)).toBe(null)
  })

  it('翻译/音译正常时间匹配，超距音译不跟随上一句兜底', () => {
    const target = [{ time: 10, text: 'A' }, { time: 100, text: 'B' }]
    const source = [{ time: 10.8, text: 'A', translation: '甲', roman: 'a' }, { time: 20, text: 'X', translation: '乙', roman: 'b' }]
    const out = remapEnhancementsByTime(target, source)
    expect(out[0].translation).toBe('甲')
    expect(out[0].roman).toBe('a')
    expect(out[1].translation).toBe('甲')
    expect(out[1].roman || '').toBe('')
  })

  it('超出原匹配距离仍缺译文时沿用紧邻上一句', () => {
    const target = [{ time: 10, text: '拆行 1' }, { time: 15, text: '拆行 2' }, { time: 20, text: '拆行 3' }, { time: 30, text: '下一句' }]
    const source = [{ time: 10.8, text: '原句一', translation: '译文一' }, { time: 30.2, text: '原句二', translation: '译文二' }]
    const out = remapEnhancementsByTime(target, source)
    expect(out.map((l) => l.translation)).toEqual(['译文一', '译文一', '译文一', '译文二'])
  })

  it('首句没有命中时不凭空生成译文', () => {
    const out = remapEnhancementsByTime([{ time: 10, text: 'A' }], [{ time: 20, text: 'B', translation: '乙' }])
    expect(out[0].translation || '').toBe('')
  })
})
