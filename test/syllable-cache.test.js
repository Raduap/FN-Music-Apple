import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mod from '../electron/syllableCache.js'

const { createSyllableCache } = mod
const cand = [{ source: 'qq', provider: 'qq-qrc', lines: [{ time: 1, text: 'hi', words: [{ text: 'hi', time: 1, end: 2 }] }] }]

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'syl-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('逐字候选分级磁盘缓存', () => {
  it('永久档写入后可读回', async () => {
    const c = createSyllableCache({ dir })
    const key = c.key('A', 'B', 240, 'qq')
    await c.set(key, { source: 'qq', coverage: 1, tier: 'permanent', candidates: cand })
    const hit = await createSyllableCache({ dir }).get(key)
    expect(hit?.candidates?.[0]?.provider).toBe('qq-qrc')
    expect(hit?.tier).toBe('permanent')
  })

  it('90% 档 7 天后过期，永久档不过期', async () => {
    let t = 1000
    const now = () => t
    const c = createSyllableCache({ dir, now })
    const q = c.key('A', 'B', 240, 'kugou')
    const p = c.key('A', 'B', 240, 'qq')
    await c.set(q, { source: 'kugou', coverage: 0.95, tier: 'qualified', candidates: cand })
    await c.set(p, { source: 'qq', coverage: 1, tier: 'permanent', candidates: cand })
    t += 8 * 24 * 3600 * 1000
    expect(await c.get(q)).toBe(null)
    expect((await c.get(p))?.tier).toBe('permanent')
  })

  it('偏弱档 24 小时后过期', async () => {
    let t = 1000
    const c = createSyllableCache({ dir, now: () => t })
    const k = c.key('A', 'B', 240, 'netease')
    await c.set(k, { source: 'netease', coverage: 0.8, tier: 'weak', candidates: cand })
    expect((await c.get(k))?.tier).toBe('weak')
    t += 25 * 3600 * 1000
    expect(await c.get(k)).toBe(null)
  })

  it('memory 档不落盘，只在内存存活 30 分钟', async () => {
    let t = 1000
    const c = createSyllableCache({ dir, now: () => t })
    const k = c.key('A', 'B', 240, 'amll')
    await c.set(k, { source: 'amll', coverage: 0.4, tier: 'memory', candidates: cand })
    const c2 = createSyllableCache({ dir, now: () => t })
    expect(await c2.get(k)).toBe(null) // 新实例读不到 -> 没落盘
    expect((await c.get(k))?.tier).toBe('memory')
    t += 31 * 60 * 1000
    expect(await c.get(k)).toBe(null)
  })

  it('空候选不写入；clear 清空磁盘', async () => {
    const c = createSyllableCache({ dir })
    const k = c.key('A', 'B', 240, 'qq')
    await c.set(k, { source: 'qq', coverage: 1, tier: 'permanent', candidates: [] })
    expect(await c.get(k)).toBe(null)
    await c.set(k, { source: 'qq', coverage: 1, tier: 'permanent', candidates: cand })
    expect(await c.get(k)).not.toBe(null)
    await c.clear()
    expect(await c.get(k)).toBe(null)
  })
})
