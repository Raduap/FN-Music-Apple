// 封面磁盘缓存（主进程）
//
// 自定义协议 fnm:// 的响应不进 Chromium 的 HTTP 缓存，原来每次启动都要重新向 NAS 请求全部封面，
// 而 NAS 现场生成缩略图很慢。这里把封面按「服务器 + coverId + 尺寸」存到 userData/covers/：
// - 命中直接读盘，不占用 NAS 连接；过期（默认 30 天）的照常返回，同时在后台重新拉取
// - 同一张封面的并发请求只向 NAS 发一次；同时向 NAS 请求封面的数量受限，给接口和音频流留出连接
// - 封面不存在（400/404）在本次运行中记住，不再重复请求
// - 总大小超过上限时按最近使用时间淘汰
// 不依赖 Electron，便于单元测试。
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const DAY = 24 * 3600 * 1000
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }
const TYPE_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]))
const MISSING = new Set([400, 404, 410])
const FILE_RE = /^([0-9a-f]{40})\.([a-z]+)$/

// 缓存键：不同 NAS 上的 coverId 可能相同，所以带上服务器地址
function coverKey(base, coverId, size) {
  return crypto.createHash('sha1').update(`${base}|${coverId}|${size || ''}`).digest('hex')
}

// 简单的并发限制
function limiter(max) {
  let active = 0
  const waiting = []
  const next = () => {
    if (active >= max || !waiting.length) return
    active++
    const { fn, resolve, reject } = waiting.shift()
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next() })
  }
  const run = (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next() })
  run.stats = () => ({ active, waiting: waiting.length })
  return run
}

/**
 * @param {object} o
 * @param {string} o.dir                      缓存目录
 * @param {(url: string) => Promise<Response>} o.fetchUpstream  向 NAS 请求（调用方负责签名与凭证）
 * @param {number} [o.maxBytes]               缓存总大小上限
 * @param {number} [o.ttl]                    多久之后在后台重新拉取
 * @param {number} [o.concurrency]            同时向 NAS 请求封面的数量
 */
function createCoverCache({ dir, fetchUpstream, maxBytes = 400 * 1024 * 1024, ttl = 30 * DAY, concurrency = 3, now = Date.now }) {
  const index = new Map() // key -> { ext, size, fetched, used }
  const missing = new Set()
  const inflight = new Map() // key -> Promise<result>
  const limit = limiter(concurrency)
  let total = 0
  let ready = null

  const file = (key, ext) => path.join(dir, `${key}.${ext}`)

  function init() {
    ready ||= (async () => {
      await fsp.mkdir(dir, { recursive: true })
      for (const name of await fsp.readdir(dir)) {
        const m = FILE_RE.exec(name)
        if (!m || !TYPE_BY_EXT[m[2]]) { if (name.endsWith('.tmp')) fsp.unlink(path.join(dir, name)).catch(() => {}); continue }
        try {
          const st = await fsp.stat(path.join(dir, name))
          index.set(m[1], { ext: m[2], size: st.size, fetched: st.mtimeMs, used: st.mtimeMs })
          total += st.size
        } catch {}
      }
    })().catch((e) => { console.error('[covers] 初始化失败：', e.message) })
    return ready
  }

  function remove(key) {
    const hit = index.get(key)
    if (!hit) return
    index.delete(key)
    total -= hit.size
    fsp.unlink(file(key, hit.ext)).catch(() => {})
  }

  // 超过上限时淘汰最久未使用的，降到上限的 90%，避免每写一张就淘汰一次
  function evict() {
    if (total <= maxBytes) return
    const entries = [...index.entries()].sort((a, b) => a[1].used - b[1].used)
    for (const [key] of entries) {
      if (total <= maxBytes * 0.9) break
      remove(key)
    }
  }

  async function store(key, type, buf) {
    const ext = EXT_BY_TYPE[type]
    if (!ext) return
    const tmp = file(key, ext) + '.' + process.pid + '.tmp'
    try {
      await fsp.writeFile(tmp, buf)
      await fsp.rename(tmp, file(key, ext))
      const old = index.get(key)
      if (old) { total -= old.size; if (old.ext !== ext) fsp.unlink(file(key, old.ext)).catch(() => {}) }
      const t = now()
      index.set(key, { ext, size: buf.length, fetched: t, used: t })
      total += buf.length
      evict()
    } catch (e) {
      fsp.unlink(tmp).catch(() => {})
      console.error('[covers] 写入失败：', e.message)
    }
  }

  // 向 NAS 拉取（同一张封面并发只拉一次），成功的图片写入磁盘
  function fetchAndStore(key, url) {
    if (inflight.has(key)) return inflight.get(key)
    const p = limit(async () => {
      const res = await fetchUpstream(url)
      const body = Buffer.from(await res.arrayBuffer())
      return { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body }
    })
      .then(async (r) => {
        if (r.status === 200 && r.body.length && EXT_BY_TYPE[r.type]) {
          missing.delete(key)
          await store(key, r.type, r.body)
          return { ...r, source: 'net' }
        }
        if (MISSING.has(r.status)) missing.add(key)
        return { ...r, source: 'net' }
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  /** @returns {Promise<{ status: number, type: string, body: Buffer, source: 'disk' | 'net' | 'missing' }>} */
  async function get(key, url) {
    await init()
    const hit = index.get(key)
    if (hit) {
      try {
        const body = await fsp.readFile(file(key, hit.ext))
        hit.used = now()
        if (now() - hit.fetched > ttl) fetchAndStore(key, url).catch(() => {}) // 过期：先返回旧图，后台更新
        return { status: 200, type: TYPE_BY_EXT[hit.ext], body, source: 'disk' }
      } catch {
        remove(key) // 文件被删或损坏，当作未缓存
      }
    }
    if (missing.has(key)) return { status: 404, type: 'text/plain', body: Buffer.alloc(0), source: 'missing' }
    return fetchAndStore(key, url)
  }

  async function clear() {
    await init()
    await Promise.allSettled([...inflight.values()])
    for (const key of [...index.keys()]) remove(key)
    missing.clear()
  }

  return {
    init,
    get,
    clear,
    stats: () => ({ count: index.size, bytes: total, ...limit.stats() }),
  }
}

module.exports = { createCoverCache, coverKey, limiter }
