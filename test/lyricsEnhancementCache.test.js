import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import cacheMod from '../electron/lyricsEnhancementCache.js'

const { createLyricsEnhancementCache, TTL } = cacheMod
const lines = [{ time: 1, text: '君の名は' }]
const value = { translations: ['你的名字'], romans: ['kimi no na wa'], source: 'netease', sourceCount: 1, aiCount: 0 }

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lyr-cache-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('翻译 / 音译磁盘缓存', () => {
  it('TTL 为三天，写入后重启实例仍可读回', async () => {
    expect(TTL).toBe(3 * 24 * 3600 * 1000)
    const c = createLyricsEnhancementCache({ dir })
    const key = c.key({ id: '1', title: 'Lemon', artist: '米津玄師', duration: 255 }, lines, 'translate')
    await c.set(key, value)
    const hit = await createLyricsEnhancementCache({ dir }).get(key)
    expect(hit.translations[0]).toBe('你的名字')
    expect(hit.romans[0]).toBe('kimi no na wa')
  })

  it('三天内有效，超过三天过期', async () => {
    let t = 1000
    const c = createLyricsEnhancementCache({ dir, now: () => t })
    const key = c.key({ id: '1', title: 'Lemon', artist: '米津玄師', duration: 255 }, lines, 'translate')
    await c.set(key, value)
    t += TTL - 1
    expect(await c.get(key)).not.toBe(null)
    t += 2
    expect(await c.get(key)).toBe(null)
  })

  it('歌词内容变化或翻译模式不同不会误命中', async () => {
    const c = createLyricsEnhancementCache({ dir })
    const song = { id: '1', title: 'Lemon', artist: '米津玄師', duration: 255 }
    const key = c.key(song, lines, 'translate')
    await c.set(key, value)
    expect(await c.get(c.key(song, [{ time: 2, text: 'new' }], 'translate'))).toBe(null)
    expect(await c.get(c.key(song, lines, 'roman'))).toBe(null)
  })

  it('clear 清空磁盘缓存', async () => {
    const c = createLyricsEnhancementCache({ dir })
    const key = c.key({ id: '1', title: 'Lemon' }, lines, 'translate')
    await c.set(key, value)
    await c.clear()
    expect(await c.get(key)).toBe(null)
  })
})
