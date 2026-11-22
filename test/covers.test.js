import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 渲染进程封面队列：不启动 React，只测排队逻辑（acquireCover / prefetchCover）
let mod
let createObjectURL

beforeEach(async () => {
  vi.resetModules()
  createObjectURL = vi.fn(() => 'blob:' + Math.random().toString(16).slice(2))
  globalThis.URL.createObjectURL = createObjectURL
  globalThis.URL.revokeObjectURL = vi.fn()
  mod = await import('../src/covers.js')
})
afterEach(() => { vi.unstubAllGlobals() })

// 可控的 fetch：每次调用记录下来，手动放行
function fakeFetch() {
  const calls = []
  let gate = null
  const impl = (url) => {
    calls.push(String(url))
    const p = gate ? gate.promise : Promise.resolve()
    return p.then(() => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }), { status: 200, headers: { 'content-type': 'image/png' } }))
  }
  impl.calls = calls
  impl.hold = () => { let release; gate = { promise: new Promise((r) => (release = r)) }; return () => { gate = null; release() } }
  return impl
}
const query = (url) => new URL('http:' + String(url).slice(4)).searchParams

describe('封面排队优先级', () => {
  it('当前歌曲（prio）排到屏幕内封面之前', async () => {
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)
    const release = f.hold()
    // 6 个普通封面先占满并发位，再排 2 个普通 + 1 个 prio
    const held = []
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { promise, release: rel } = mod.acquireCover(id, 160)
      held.push({ promise, rel })
    }
    const hot = mod.acquireCover('cur', 160, true)
    await vi.waitFor(() => expect(f.calls).toHaveLength(6))
    release()
    await Promise.all([...held.map((x) => x.promise), hot.promise])
    expect(f.calls.map((u) => query(u).get('coverId'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'cur', 'g', 'h'])
    held.forEach((x) => x.rel())
    hot.release()
  })

  it('prio 请求带上给主进程的排队标记', async () => {
    const seen = []
    const impl = (url, opt) => { seen.push({ prio: opt?.headers?.['x-fnm-prio'], size: Number(query(url).get('size')) }); return Promise.resolve(new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 })) }
    vi.stubGlobal('fetch', impl)
    mod.prefetchCover('p1', 600)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ prio: undefined, size: 600 })
    const hot = mod.acquireCover('p2', 160, true)
    await hot.promise
    expect(seen[1]).toEqual({ prio: '1', size: 160 })
    hot.release()
  })
})

describe('错误分类', () => {
  it('401 不当作封面不存在：凭证恢复后重新请求就能显示', async () => {
    vi.useFakeTimers()
    let status = 401
    const relogin = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('window', { fn: { relogin } })
    vi.stubGlobal('fetch', () => Promise.resolve(status === 401
      ? new Response('{"code":99999}', { status: 401, headers: { 'content-type': 'application/json' } })
      : new Response(new Blob(['img'], { type: 'image/png' }), { status: 200, headers: { 'content-type': 'image/png' } })))
    const a = mod.acquireCover('auth401', 160, true)
    await vi.advanceTimersByTimeAsync(5000) // 等它走完重登 + 重试，判定失败
    expect(relogin).toHaveBeenCalledTimes(1) // 每次加载只重登一次，不会反复打登录接口
    expect(await a.promise).toBe('')
    a.release()
    status = 200
    const b = mod.acquireCover('auth401', 160, true)
    expect(await b.promise).toMatch(/^blob:/) // 没有被记成 missing，能重新请求
    b.release()
    vi.useRealTimers()
  })

  it('404 记为不存在，同一张封面不再请求', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('', { status: 404 })))
    vi.stubGlobal('fetch', f)
    const a = mod.acquireCover('gone404', 160)
    expect(await a.promise).toBe('')
    a.release()
    const b = mod.acquireCover('gone404', 160)
    expect(await b.promise).toBe('')
    b.release()
    expect(f).toHaveBeenCalledTimes(1)
  })
})
