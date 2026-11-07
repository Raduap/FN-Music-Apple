import { describe, expect, it } from 'vitest'
import { SYLLABLE_QUALIFIED, SYLLABLE_EXCELLENT, syllableTierFor, pickSyllableCandidate } from '../src/lyrics.js'
import { cacheKey, TTL, MEMORY_TTL } from '../electron/syllableCache.js'

const w = (text, t, e) => ({ text, time: t, end: e })
const line = (text, t, parts) => ({ text, time: t, end: t + 3, words: parts.map((p, i) => w(p, t + i * 0.5, t + (i + 1) * 0.5)) })

function scenario(hit, total) {
  const local = Array.from({ length: total }, (_, i) => ({ time: 10 + i * 5, text: '第' + (i + 1) + '句' }))
  const cand = { source: 's', provider: 'p', lines: local.slice(0, hit).map((l) => line(l.text, l.time, [l.text])) }
  return { local, cand }
}

describe('逐字阈值与缓存分档', () => {
  it('合格线 90%、优秀线 98%', () => {
    expect(SYLLABLE_QUALIFIED).toBe(0.90)
    expect(SYLLABLE_EXCELLENT).toBe(0.98)
  })

  it('覆盖率映射到缓存档位', () => {
    expect(syllableTierFor(1)).toBe('permanent')
    expect(syllableTierFor(0.98)).toBe('permanent')
    expect(syllableTierFor(0.979)).toBe('qualified')
    expect(syllableTierFor(0.90)).toBe('qualified')
    expect(syllableTierFor(0.899)).toBe('weak')
    expect(syllableTierFor(0.70)).toBe('weak')
    expect(syllableTierFor(0.699)).toBe('memory')
    expect(syllableTierFor(0)).toBe('memory')
    expect(syllableTierFor(NaN)).toBe('memory')
  })

  it('缓存时效：优秀永久 / 合格 7 天 / 偏弱 24 小时 / 差 30 分钟内存', () => {
    expect(TTL.permanent).toBe(Infinity)
    expect(TTL.qualified).toBe(7 * 24 * 3600 * 1000)
    expect(TTL.weak).toBe(24 * 3600 * 1000)
    expect(MEMORY_TTL).toBe(30 * 60 * 1000)
  })

  it('cacheKey 按歌名/艺人/时长分桶/源区分，时长微差同键', () => {
    expect(cacheKey('A', 'B', 240, 'qq')).toBe(cacheKey('A', 'B', 242, 'qq'))
    expect(cacheKey('A', 'B', 240, 'qq')).not.toBe(cacheKey('A', 'B', 400, 'qq'))
    expect(cacheKey('A', 'B', 240, 'qq')).not.toBe(cacheKey('A', 'B', 240, 'kugou'))
  })
})

describe('pickSyllableCandidate 流式模式（earlyBreak=false）', () => {
  it('默认模式在覆盖率 ≥85% 时提前锁定，不评估后面的候选', () => {
    const local = Array.from({ length: 4 }, (_, i) => ({ time: 10 + i * 5, text: '第' + (i + 1) + '句' }))
    const first = { source: 's1', provider: 'p1', lines: local.map((l) => line(l.text, l.time, [l.text])) }
    const second = { source: 's2', provider: 'p2', lines: local.map((l) => line(l.text, l.time, [l.text])) }
    expect(pickSyllableCandidate(local, [first, second]).provider).toBe('p1')
  })

  it('流式模式评估全部候选，能拿到后面更好的结果', () => {
    const local = Array.from({ length: 4 }, (_, i) => ({ time: 10 + i * 5, text: '第' + (i + 1) + '句' }))
    const first = { source: 's1', provider: 'p1', lines: local.slice(0, 1).map((l) => line(l.text, l.time, [l.text])) }
    const second = { source: 's2', provider: 'p2', lines: local.map((l) => line(l.text, l.time, [l.text])) }
    const best = pickSyllableCandidate(local, [first, second], { earlyBreak: false })
    expect(best.provider).toBe('p2')
    expect(best.coverage).toBe(1)
  })

  it('90% 覆盖率判为合格，98%+ 判为优秀', () => {
    const q = scenario(9, 10)
    const qp = pickSyllableCandidate(q.local, [q.cand], { earlyBreak: false })
    expect(qp.coverage).toBeCloseTo(0.9, 5)
    expect(syllableTierFor(qp.coverage)).toBe('qualified')
    const e = scenario(49, 50)
    const ep = pickSyllableCandidate(e.local, [e.cand], { earlyBreak: false })
    expect(ep.coverage).toBeCloseTo(0.98, 5)
    expect(syllableTierFor(ep.coverage)).toBe('permanent')
  })
})
