import { describe, expect, it } from 'vitest'
import mod from '../electron/syllables.js'

const { runStreamSources } = mod
const w = (text, t, e) => ({ text, time: t, end: e })
const line = (text, t) => ({ text, time: t, end: t + 2, words: [w(text, t, t + 1)] })
const mkCand = (source, texts, t0 = 10) => ({ source, provider: source + '-p', lines: texts.map((tx, i) => line(tx, t0 + i * 5)) })
const mkLocal = (texts, t0 = 10) => texts.map((tx, i) => ({ time: t0 + i * 5, text: tx }))

// 覆盖率：命中前 m 句
const texts = (n, p) => Array.from({ length: n }, (_, i) => p + i)

describe('逐源串行抓取：90% 先显示 / 98% 提前停止', () => {
  it('第一个源就 ≥98% -> 只抓这一个源，且推送一次', async () => {
    const local = mkLocal(texts(50, 'L'))
    const calls = []
    const emitted = []
    const r = await runStreamSources({
      order: ['a', 'b', 'c'],
      localLines: local,
      emit: (d) => emitted.push(d),
      fetchSource: (id) => { calls.push(id); return id === 'a' ? [mkCand('a', texts(50, 'L'))] : [mkCand(id, texts(50, 'L'))] },
    })
    expect(calls).toEqual(['a'])            // 后面两个源没抓
    expect(r.lines.length).toBe(50)
    expect(emitted.filter((d) => !d.done).length).toBe(1) // 只推一次合格结果
  })

  it('第一个源 <90% -> 继续；第二个源 ≥98% -> 停止；推送更好结果', async () => {
    const local = mkLocal(texts(10, 'L'))
    const calls = []
    const emitted = []
    await runStreamSources({
      order: ['a', 'b', 'c'],
      localLines: local,
      emit: (d) => emitted.push(d),
      fetchSource: (id) => {
        calls.push(id)
        if (id === 'a') return [mkCand('a', texts(7, 'L'))]   // 70%
        if (id === 'b') return [mkCand('b', texts(10, 'L'))]  // 100%
        return [mkCand(id, texts(10, 'L'))]
      },
    })
    expect(calls).toEqual(['a', 'b'])
    expect(emitted.some((d) => d.source === 'b' && !d.done)).toBe(true)
    expect(emitted[emitted.length - 1].done).toBe(true)
  })

  it('第一个源 90%~98% -> 先推一版（不合格线以上），继续抓后面的源', async () => {
    const local = mkLocal(texts(100, 'L'))
    const calls = []
    const emitted = []
    await runStreamSources({
      order: ['a', 'b'],
      localLines: local,
      emit: (d) => emitted.push(d),
      fetchSource: (id) => {
        calls.push(id)
        if (id === 'a') return [mkCand('a', texts(90, 'L'))]  // 90%
        return [mkCand('b', texts(100, 'L'))]                 // 100%
      },
    })
    expect(calls).toEqual(['a', 'b']) // 90% 不停止，继续抓 b
    const progress = emitted.filter((d) => !d.done)
    expect(progress.length).toBe(2)   // a 推一次，b 更好再推一次（静默替换）
    expect(progress[0].source).toBe('a')
    expect(progress[1].source).toBe('b')
  })

  it('所有源都 <90% -> 不提前推送，只给最终最高者', async () => {
    const local = mkLocal(texts(10, 'L'))
    const emitted = []
    await runStreamSources({
      order: ['a', 'b'],
      localLines: local,
      emit: (d) => emitted.push(d),
      fetchSource: (id) => [mkCand(id, texts(id === 'a' ? 5 : 8, 'L'))],
    })
    expect(emitted.filter((d) => !d.done).length).toBe(0)
    const last = emitted[emitted.length - 1]
    expect(last.done).toBe(true)
    expect(last.coverage).toBeCloseTo(0.8, 5)
  })

  it('缓存命中时不调用网络，且写入按覆盖率分档', async () => {
    const local = mkLocal(texts(50, 'L'))
    const forced = []
    const store = new Map()
    const cache = {
      key: (t, a, d, s) => s,
      get: async (k) => store.get(k) || null,
      set: async (k, v) => { store.set(k, v) },
    }
    await runStreamSources({
      order: ['a'],
      localLines: local,
      cache,
      cacheKeyFor: (id) => id,
      fetchSource: () => { forced.push('net'); return [mkCand('a', texts(50, 'L'))] },
      emit: () => {},
    })
    expect(forced).toEqual(['net'])
    expect(store.get('a').tier).toBe('permanent') // 100% -> 永久档
  })
})
