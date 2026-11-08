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

  it('低文本重合的翻唱/错误版本不覆盖', () => {
    const cand = { source: 'qq', provider: 'qq-qrc', lines: local.map((_, i) => remoteLine(`X${i}-完全不同`, i * 5)) }
    const score = candidateStructureScore(local, cand)
    expect(isTrustedOverride(local, cand, score)).toBe(false)
    expect(overrideSyllableLines(local, cand)).toBe(null)
  })

  it('译文/音译按时间迁移，超过容错距离留空', () => {
    const target = [{ time: 10, text: 'A' }, { time: 100, text: 'B' }]
    const source = [{ time: 10.8, text: 'A', translation: '甲', roman: 'a' }, { time: 20, text: 'X', translation: '乙', roman: 'b' }]
    const out = remapEnhancementsByTime(target, source)
    expect(out[0].translation).toBe('甲')
    expect(out[0].roman).toBe('a')
    expect(out[1].translation || '').toBe('')
  })
})
