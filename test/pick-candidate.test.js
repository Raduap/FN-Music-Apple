import { describe, expect, it } from 'vitest'
import { pickSyllableCandidate } from '../src/lyrics.js'

describe('pickSyllableCandidate（按覆盖率选源）', () => {
  const mk = (text, time, words) => ({ text, time, words })
  const w = (text, t, e) => ({ text, time: t, end: e })

  it('覆盖率 ≥85% 的候选直接采纳（先到先得）', () => {
    const local = [{ time: 10, text: 'hello world' }, { time: 20, text: 'goodbye' }]
    const good = { source: 'a', provider: 'p1', lines: [mk('hello world', 10, [w('hello', 10, 10.5), w('world', 10.5, 11)]), mk('goodbye', 20, [w('goodbye', 20, 21)])] }
    const pick = pickSyllableCandidate(local, [good])
    expect(pick.coverage).toBe(1)
    expect(pick.provider).toBe('p1')
  })

  it('无候选达 85% 时选覆盖率最高者', () => {
    const local = [{ time: 10, text: 'one' }, { time: 20, text: 'two' }, { time: 30, text: 'three' }]
    const half = { source: 'a', provider: 'p1', lines: [mk('one', 10, [w('one', 10, 10.5)])] }
    const better = { source: 'b', provider: 'p2', lines: [mk('one', 10, [w('one', 10, 10.5)]), mk('two', 20, [w('two', 20, 20.5)])] }
    const pick = pickSyllableCandidate(local, [half, better])
    expect(pick.provider).toBe('p2')
    expect(pick.coverage).toBeCloseTo(2 / 3)
  })

  it('空候选返回 null', () => {
    expect(pickSyllableCandidate([{ time: 1, text: 'x' }], [])).toBe(null)
  })
})
