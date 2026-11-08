// 翻译 / 音译最终结果的磁盘缓存（主进程专用）。
// 只缓存成功回填的结果；同一首歌按标题、艺人、时长分桶和原始歌词内容指纹区分版本。
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const DAY = 24 * 3600 * 1000
const TTL = 3 * DAY
const VERSION = 1
const FILE_RE = /^([0-9a-f]{40})\.json$/

function hashLines(lines) {
  let h = 5381
  for (const line of lines || []) {
    const text = String(line?.text || '')
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
    h = (h ^ Math.round((Number(line?.time) || 0) * 10)) >>> 0
  }
  return h.toString(36)
}

function cacheKey(song, lines, mode) {
  const title = String(song?.title || '').trim()
  const artist = String(song?.artist || '').trim()
  const id = String(song?.id || '').trim()
  const duration = Math.round((Number(song?.duration) || 0) / 5) * 5
  return crypto.createHash('sha1').update([id, title, artist, duration, hashLines(lines), mode || ''].join('\u0000')).digest('hex')
}

function createLyricsEnhancementCache({ dir, maxBytes = 40 * 1024 * 1024, now = Date.now } = {}) {
  const index = new Map()
  const memory = new Map()
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
    })().catch((e) => console.error('[lyrics-cache] 初始化失败：', e.message))
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
    for (const [key] of [...index.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (total <= maxBytes * 0.9) break
      removeDisk(key)
    }
  }

  function fresh(entry, t = now()) {
    return entry && Number(entry.at) > 0 && t - Number(entry.at) <= TTL
  }

  async function get(key) {
    const mem = memory.get(key)
    if (mem) {
      if (fresh(mem)) return mem.value
      memory.delete(key)
    }
    await init()
    const hit = index.get(key)
    if (!hit) return null
    let parsed
    try { parsed = JSON.parse(await fsp.readFile(hit.file, 'utf8')) } catch { removeDisk(key); return null }
    if (parsed?.v !== VERSION || !fresh(parsed)) { removeDisk(key); return null }
    hit.at = parsed.at
    return parsed.value || null
  }

  async function set(key, value) {
    if (!value || typeof value !== 'object') return
    const t = now()
    if (!dir) { memory.set(key, { at: t, value }); return }
    await init()
    const payload = JSON.stringify({ v: VERSION, at: t, value })
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
      console.error('[lyrics-cache] 写入失败：', e.message)
    }
  }

  async function clear() {
    memory.clear()
    await init()
    for (const key of [...index.keys()]) removeDisk(key)
  }

  return { init, get, set, clear, key: cacheKey, stats: () => ({ count: index.size, bytes: total, memory: memory.size }) }
}

module.exports = { createLyricsEnhancementCache, cacheKey, TTL, hashLines }
