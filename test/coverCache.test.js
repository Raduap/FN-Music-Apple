import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mod from '../electron/coverCache.js'

const { createCoverCache, coverKey, limiter } = mod
const png = (n = 10) => Buffer.alloc(n, 1)

// 模拟 NAS：记录请求次数，可按 URL 指定响应，可让请求挂起以测试并发
function fakeNas() {
  const calls = []
  const routes = new Map()
  let gate = null
  const nas = async (url) => {
    calls.push(url)
    if (gate) await gate.promise
    const r = routes.get(url) || { status: 200, type: 'image/png', body: png() }
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.type } })
  }
  nas.calls = calls
  nas.route = (url, r) => routes.set(url, r)
  nas.hold = () => { let release; gate = { promise: new Promise((r) => (release = r)) }; return () => { gate = null; release() } }
  return nas
}

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'covers-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('coverKey', () => {
  it('同一服务器 / 封面 / 尺寸得到同一个键，任一不同则不同', () => {
    const k = coverKey('http://a/music', 'album_1', 160)
    expect(k).toMatch(/^[0-9a-f]{40}$/)
    expect(coverKey('http://a/music', 'album_1', 160)).toBe(k)
    expect(coverKey('http://b/music', 'album_1', 160)).not.toBe(k)
    expect(coverKey('http://a/music', 'album_1', 600)).not.toBe(k)
  })
})

describe('封面磁盘缓存', () => {
  it('首次从 NAS 获取并写盘，之后直接读盘', async () => {
    const nas = fakeNas()
    const c = createCoverCache({ dir, fetchUpstream: nas })
    const a = await c.get('a'.repeat(40), 'u1')
    expect(a).toMatchObject({ status: 200, type: 'image/png', source: 'net' })
    const b = await c.get('a'.repeat(40), 'u1')
    expect(b.source).toBe('disk')
    expect(b.body.equals(png())).toBe(true)
    expect(nas.calls).toEqual(['u1'])
    expect(readdirSync(dir)).toEqual(['a'.repeat(40) + '.png'])
  })

  it('重启（新实例）后从磁盘恢复索引', async () => {
    const nas = fakeNas()
    await createCoverCache({ dir, fetchUpstream: nas }).get('b'.repeat(40), 'u')
    const c2 = createCoverCache({ dir, fetchUpstream: nas })
    expect((await c2.get('b'.repeat(40), 'u')).source).toBe('disk')
    expect(c2.stats()).toMatchObject({ count: 1, bytes: 10 })
    expect(nas.calls).toHaveLength(1)
  })

  it('同一张封面的并发请求只向 NAS 发一次', async () => {
    const nas = fakeNas()
    const release = nas.hold()
    const c = createCoverCache({ dir, fetchUpstream: nas })
    const ps = [1, 2, 3].map(() => c.get('c'.repeat(40), 'u'))
    await new Promise((r) => setTimeout(r, 10))
    release()
    const rs = await Promise.all(ps)
    expect(rs.every((r) => r.status === 200)).toBe(true)
    expect(nas.calls).toHaveLength(1)
  })

  it('限制同时向 NAS 请求的数量', async () => {
    const nas = fakeNas()
    const release = nas.hold()
    const c = createCoverCache({ dir, fetchUpstream: nas, concurrency: 2 })
    const ps = ['1', '2', '3', '4', '5'].map((n) => c.get(n.repeat(40), 'u' + n))
    await new Promise((r) => setTimeout(r, 10))
    expect(nas.calls).toHaveLength(2)
    expect(c.stats()).toMatchObject({ active: 2, waiting: 3 })
    release()
    await Promise.all(ps)
    expect(nas.calls).toHaveLength(5)
  })

  it('封面不存在（400/404）本次运行内不再请求', async () => {
    const nas = fakeNas()
    nas.route('bad', { status: 400, type: 'application/json', body: '{}' })
    const c = createCoverCache({ dir, fetchUpstream: nas })
    expect((await c.get('d'.repeat(40), 'bad')).status).toBe(400)
    expect(await c.get('d'.repeat(40), 'bad')).toMatchObject({ status: 404, source: 'missing' })
    expect(nas.calls).toHaveLength(1)
    expect(readdirSync(dir)).toEqual([])
  })

  it('服务器错误、非图片响应、空响应不缓存，下次重新请求', async () => {
    const nas = fakeNas()
    nas.route('e500', { status: 500, type: 'text/plain', body: 'err' })
    nas.route('json', { status: 200, type: 'application/json', body: '{"code":99999}' })
    nas.route('empty', { status: 200, type: 'image/png', body: '' })
    const c = createCoverCache({ dir, fetchUpstream: nas })
    for (const [i, u] of ['e500', 'json', 'empty'].entries()) {
      await c.get(String(i).repeat(40), u)
      await c.get(String(i).repeat(40), u)
    }
    expect(nas.calls).toEqual(['e500', 'e500', 'json', 'json', 'empty', 'empty'])
    expect(readdirSync(dir)).toEqual([])
  })

  it('过期后先返回旧图，并在后台重新拉取', async () => {
    let t = 1000
    const nas = fakeNas()
    const c = createCoverCache({ dir, fetchUpstream: nas, ttl: 100, now: () => t })
    await c.get('e'.repeat(40), 'u')
    t += 50
    expect((await c.get('e'.repeat(40), 'u')).source).toBe('disk')
    expect(nas.calls).toHaveLength(1)
    t += 100
    nas.route('u', { status: 200, type: 'image/png', body: png(20) })
    const stale = await c.get('e'.repeat(40), 'u')
    expect(stale.source).toBe('disk')
    expect(stale.body.length).toBe(10)
    await new Promise((r) => setTimeout(r, 20))
    expect(nas.calls).toHaveLength(2)
    expect((await c.get('e'.repeat(40), 'u')).body.length).toBe(20)
  })

  it('超过大小上限时淘汰最久未使用的封面', async () => {
    let t = 0
    const nas = fakeNas()
    const c = createCoverCache({ dir, fetchUpstream: nas, maxBytes: 25, now: () => ++t })
    await c.get('1'.repeat(40), 'a') // 10 字节
    await c.get('2'.repeat(40), 'b')
    await c.get('1'.repeat(40), 'a') // 读一次，1 比 2 更近使用
    await c.get('3'.repeat(40), 'c') // 总 30 > 25，淘汰到 22.5 以下：去掉最久未用的 2
    expect(c.stats()).toMatchObject({ count: 2, bytes: 20 })
    expect(readdirSync(dir).sort()).toEqual(['1'.repeat(40) + '.png', '3'.repeat(40) + '.png'])
  })

  it('文件被外部删除时重新请求', async () => {
    const nas = fakeNas()
    const c = createCoverCache({ dir, fetchUpstream: nas })
    await c.get('f'.repeat(40), 'u')
    rmSync(join(dir, 'f'.repeat(40) + '.png'))
    expect((await c.get('f'.repeat(40), 'u')).source).toBe('net')
    expect(nas.calls).toHaveLength(2)
  })

  it('初始化时忽略无关文件、清理残留的临时文件', async () => {
    writeFileSync(join(dir, 'readme.txt'), 'x')
    writeFileSync(join(dir, 'a'.repeat(40) + '.png.123.tmp'), 'x')
    const c = createCoverCache({ dir, fetchUpstream: fakeNas() })
    await c.init()
    await new Promise((r) => setTimeout(r, 10))
    expect(c.stats().count).toBe(0)
    expect(readdirSync(dir)).toEqual(['readme.txt'])
  })

  it('clear 清空磁盘与“不存在”记录', async () => {
    const nas = fakeNas()
    nas.route('bad', { status: 404, type: 'text/plain', body: '' })
    const c = createCoverCache({ dir, fetchUpstream: nas })
    await c.get('a'.repeat(40), 'u')
    await c.get('b'.repeat(40), 'bad')
    await c.clear()
    await new Promise((r) => setTimeout(r, 10))
    expect(c.stats()).toMatchObject({ count: 0, bytes: 0 })
    expect(readdirSync(dir)).toEqual([])
    await c.get('b'.repeat(40), 'bad')
    expect(nas.calls.filter((u) => u === 'bad')).toHaveLength(2)
  })
})

describe('limiter', () => {
  it('任务出错不影响后续任务', async () => {
    const run = limiter(1)
    await expect(run(() => { throw new Error('x') })).rejects.toThrow('x')
    await expect(run(() => 2)).resolves.toBe(2)
  })
})
