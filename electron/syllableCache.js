// 逐字歌词候选的分级磁盘缓存（主进程专用；不依赖 Electron，便于单测）
//
// 为什么分级：逐字数据是「抓一次、反复用」的资源，但不同覆盖率的数据可信度差别很大。
// 全量永久缓存会把一次低质量的错误时间轴永久锁死，所以按覆盖率分档：
//   优秀 ≥98%  → permanent  永久（已经几乎不可能再变好）
//   合格 90–98% → qualified  7 天（够用；源站偶有修正，定期重取即可）
//   偏弱 70–90% → weak       24 小时（可能只是这个源不行，短期复用避免反复打源站）
//   很差 <70%   → memory     不落盘，仅进程内存 30 分钟（避免把错误数据长期留在磁盘）
// 分档边界由 electron/lyricsMerge.mjs 的 syllableTierFor 计算后传入，这里只负责
// 「档位 -> 存活时间 / 是否落盘」的存储策略，避免阈值出现第二份。
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000
const MEMORY_TTL = 30 * 60 * 1000
const TTL = { permanent: Infinity, qualified: 7 * DAY, weak: 24 * HOUR }
const VERSION = 1
const FILE_RE = /^([0-9a-f]{40})\.json$/

// 缓存键：同一首歌的同一个源一条记录。时长按 5s 分桶，容忍播放前后拿到的时长微差。
function cacheKey(title, artist, duration, source) {
  const bucket = Math.round((Number(duration) || 0) / 5) * 5
  return crypto.createHash('sha1').update([title, artist, bucket, source].join('\u0000')).digest('hex')
}

function createSyllableCache({ dir, maxBytes = 60 * 1024 * 1024, now = Date.now } = {}) {
  const index = new Map() // key -> { file, bytes, at }
  const memory = new Map() // key -> { value, expiresAt }
  let total = 0
  let ready = null

  const fileOf = (key) => path.join(dir, `${key}.json`)

  function init() {
    if (!dir) return Promise.resolve()
    ready ||= (async () => {
      await fsp.mkdir(dir, { recursive: true })
      for (const name of await fsp.readdir(dir)) {
        const m = FILE_RE.exec(name)
        if (!m) { if (name.endsWith('.tmp')) fsp.unlink(path.join(dir, name)).catch(() => {}); continue }
        try {
          const full = path.join(dir, name)
          const st = await fsp.stat(full)
          index.set(m[1], { file: full, bytes: st.size, at: st.mtimeMs })
          total += st.size
        } catch {}
      }
    })().catch((e) => console.error('[syllables] 缓存初始化失败：', e.message))
    return ready
  }

  function removeDisk(key) {
    const hit = index.get(key)
    if (!hit) return
    index.delete(key)
    total -= hit.bytes
    fsp.unlink(hit.file).catch(() => {})
  }

  function evict() {
    if (total <= maxBytes) return
    const entries = [...index.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [key] of entries) {
      if (total <= maxBytes * 0.9) break
      removeDisk(key)
    }
  }

  function expired(entry, t) {
    const ttl = TTL[entry?.tier]
    if (ttl === undefined) return true
    if (ttl === Infinity) return false
    return t - Number(entry.at || 0) > ttl
  }

  /** 读缓存：命中返回 { source, coverage, tier, candidates }，过期返回 null */
  async function get(key) {
    const mem = memory.get(key)
    if (mem) {
      if (mem.expiresAt > now()) return mem.value
      memory.delete(key)
    }
    await init()
    const hit = index.get(key)
    if (!hit) return null
    let parsed
    try {
      parsed = JSON.parse(await fsp.readFile(hit.file, 'utf8'))
    } catch {
      removeDisk(key) // 文件损坏 / 被外部删掉，当作未缓存
      return null
    }
    if (parsed?.v !== VERSION || expired(parsed, now())) {
      removeDisk(key)
      return null
    }
    hit.at = now()
    return { source: parsed.source, coverage: parsed.coverage, tier: parsed.tier, candidates: parsed.candidates || [] }
  }

  /** 写缓存：tier='memory' 只进进程内存；其余落盘。空候选不写。 */
  async function set(key, { source, coverage, tier, candidates } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) return
    const t = now()
    if (tier === 'memory') {
      memory.set(key, { value: { source, coverage, tier, candidates }, expiresAt: t + MEMORY_TTL })
      while (memory.size > 400) memory.delete(memory.keys().next().value)
      return
    }
    if (!dir || !(tier in TTL)) return
    await init()
    const payload = JSON.stringify({ v: VERSION, source, coverage, tier, at: t, candidates })
    const tmp = `${fileOf(key)}.${process.pid}.tmp`
    try {
      await fsp.writeFile(tmp, payload)
      await fsp.rename(tmp, fileOf(key))
      const old = index.get(key)
      if (old) total -= old.bytes
      const bytes = Buffer.byteLength(payload)
      index.set(key, { file: fileOf(key), bytes, at: t })
      total += bytes
      evict()
    } catch (e) {
      fsp.unlink(tmp).catch(() => {})
      console.error('[syllables] 缓存写入失败：', e.message)
    }
  }

  /** 清空磁盘 + 内存缓存 */
  async function clear() {
    memory.clear()
    await init()
    for (const key of [...index.keys()]) removeDisk(key)
  }

  return { init, get, set, clear, key: cacheKey, stats: () => ({ count: index.size, bytes: total, memory: memory.size }) }
}

module.exports = { createSyllableCache, cacheKey, TTL, MEMORY_TTL }
