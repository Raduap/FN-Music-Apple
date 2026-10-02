// 封面加载（渲染进程）
//
// - 每张图（coverId + 尺寸）只请求一次，结果缓存为 blob URL；主进程另有磁盘缓存，重启后不必再找 NAS 要
// - 排队加载，屏幕内的封面优先于预加载（屏幕外 400px 内）的封面；已滚出范围、无人等待的请求直接放弃
// - 内存里已有同一封面更大的尺寸时直接用它；只有更小的尺寸时先拿来垫底，清晰版加载完再替换
// - 封面不存在（4xx）本次运行内不再请求；网络错误重试两次，之后有组件重新挂载时再试
import { useEffect, useReducer, useRef, useState } from 'react'
import { coverUrl } from './api'

const CONCURRENCY = 6 // 主进程会把同时访问 NAS 的封面请求限制在 3 个，这里多出的部分多为磁盘缓存命中
const MAX_ENTRIES = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sizeOf = (size) => size || Infinity // 不传尺寸 = 原图

const entries = new Map() // `${id}@${size}` -> entry
const byId = new Map() // id -> Set<entry>，按封面查找各尺寸
const queue = new Set()
let active = 0
let seq = 0

/** entry: { id, size, refs, vis, seq, status: idle|queued|loading|done|fail|missing, url, subs } */
function entryOf(id, size) {
  const k = `${id}@${size || ''}`
  let e = entries.get(k)
  if (!e) {
    entries.set(k, (e = { k, id, size, refs: 0, vis: 0, seq: 0, status: 'idle', url: '', subs: new Set() }))
    if (!byId.has(id)) byId.set(id, new Set())
    byId.get(id).add(e)
  }
  return e
}
function drop(e) {
  if (e.url) URL.revokeObjectURL(e.url)
  entries.delete(e.k)
  const set = byId.get(e.id)
  set?.delete(e)
  if (set && !set.size) byId.delete(e.id)
}

// 内存中已加载好的、尺寸不小于 size 的同一封面（取最小的那个）
function doneAtLeast(id, size) {
  let best = null
  for (const e of byId.get(id) || []) {
    if (e.status === 'done' && sizeOf(e.size) >= sizeOf(size) && (!best || sizeOf(e.size) < sizeOf(best.size))) best = e
  }
  return best
}
// 内存中已加载好的、比 size 小的同一封面（取最大的那个），用作垫底
function doneSmaller(id, size) {
  let best = null
  for (const e of byId.get(id) || []) {
    if (e.status === 'done' && sizeOf(e.size) < sizeOf(size) && (!best || sizeOf(e.size) > sizeOf(best.size))) best = e
  }
  return best
}

const notify = (e) => e.subs.forEach((f) => f())

function request(e) {
  if (e.status === 'fail') e.status = 'idle'
  if (e.status !== 'idle') return
  e.status = 'queued'
  e.seq = ++seq
  queue.add(e)
  pump()
}

// 取下一个：屏幕内的优先，其次按请求先后
function pump() {
  while (active < CONCURRENCY && queue.size) {
    let best = null
    for (const e of queue) {
      if (e.refs === 0) { queue.delete(e); e.status = 'idle'; continue } // 已无人等待，放弃
      if (!best || (e.vis > 0 && best.vis === 0) || ((e.vis > 0) === (best.vis > 0) && e.seq < best.seq)) best = e
    }
    if (!best) return
    queue.delete(best)
    active++
    load(best).finally(() => { active--; pump() })
  }
}

async function load(e) {
  e.status = 'loading' // 重试期间保持 loading，避免别处再发起一次
  let result = 'fail'
  for (let i = 0; i < 3 && result === 'fail'; i++) {
    if (i) await sleep(700 * i)
    try {
      const r = await fetch(coverUrl(e.id, e.size))
      if (r.status >= 400 && r.status < 500) { result = 'missing'; break } // 封面不存在 / ID 无效，重试也没用
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const blob = await r.blob()
      // 登录失效时服务器可能返回 JSON 错误，不能当成图片
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('not an image')
      e.url = URL.createObjectURL(blob)
      result = 'done'
    } catch {}
  }
  e.status = result
  if (result === 'done') evict()
  notify(e)
}

// 超过上限时淘汰无人使用的条目（Map 按插入顺序，最早的先淘汰；使用时会移到末尾）
function evict() {
  if (entries.size <= MAX_ENTRIES) return
  for (const e of [...entries.values()]) {
    if (entries.size <= MAX_ENTRIES * 0.9) break
    if (e.refs > 0 || e.status === 'queued' || e.status === 'loading') continue
    drop(e)
  }
}
const touch = (e) => { entries.delete(e.k); entries.set(e.k, e) }

/**
 * 加载封面并占用它，返回 { url, release }；url 为空串表示没有封面。
 * 用完调用 release()，之后 url 可能被回收。
 */
export function acquireCover(id, size) {
  if (!id) return { promise: Promise.resolve(''), release() {} }
  const ready = doneAtLeast(id, size)
  const e = ready || entryOf(id, size)
  e.refs++
  e.vis++ // 主动请求的封面（当前歌曲等）按屏幕内处理，优先加载
  let released = false
  const release = () => { if (!released) { released = true; e.refs--; e.vis--; e.subs.delete(check) } }
  let resolve
  const promise = new Promise((r) => (resolve = r))
  const check = () => {
    if (e.status === 'done') { touch(e); resolve(e.url) }
    else if (e.status === 'missing' || e.status === 'fail') resolve('')
    else return
    e.subs.delete(check)
  }
  e.subs.add(check)
  request(e)
  check()
  return { promise, release }
}

// 预加载：拉到内存与磁盘缓存即可，不占用
export function prefetchCover(id, size) {
  const { promise, release } = acquireCover(id, size)
  promise.finally(release)
}

// ---------- 可视区域检测：所有封面共用两个 IntersectionObserver ----------
const observers = new Map()
function observe(el, rootMargin, cb) {
  let o = observers.get(rootMargin)
  if (!o) {
    const cbs = new WeakMap()
    o = { cbs, io: new IntersectionObserver((list) => list.forEach((en) => cbs.get(en.target)?.(en.isIntersecting)), { rootMargin }) }
    observers.set(rootMargin, o)
  }
  o.cbs.set(el, cb)
  o.io.observe(el)
  return () => { o.io.unobserve(el); o.cbs.delete(el) }
}

/**
 * 供 <Cover> 使用：只在元素接近屏幕时加载，屏幕内的优先。
 * 返回 { status, url, placeholder }；placeholder 是内存中已有的较小尺寸，可先显示。
 */
export function useCover(ref, coverId, size) {
  const [, force] = useReducer((n) => n + 1, 0)
  const [near, setNear] = useState(false)
  const [visible, setVisible] = useState(false)
  const plan = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!coverId || !el) return
    const offNear = observe(el, '400px', setNear)
    const offVis = observe(el, '0px', setVisible)
    return () => { offNear(); offVis() }
  }, [ref, coverId])

  useEffect(() => {
    if (!coverId || !near) return
    const target = doneAtLeast(coverId, size) || entryOf(coverId, size)
    const ph = target.status === 'done' ? null : doneSmaller(coverId, size)
    const held = ph ? [target, ph] : [target]
    held.forEach((e) => { e.refs++; touch(e) })
    target.subs.add(force)
    plan.current = { target, ph }
    request(target)
    force()
    return () => {
      held.forEach((e) => e.refs--)
      target.subs.delete(force)
      plan.current = null
    }
  }, [coverId, size, near])

  useEffect(() => {
    const t = plan.current?.target
    if (!t || !visible) return
    t.vis++
    return () => { t.vis-- }
  }, [coverId, size, near, visible])

  if (!coverId) return { status: 'none', url: '', placeholder: '' }
  const p = plan.current
  if (p) return { status: p.target.status, url: p.target.status === 'done' ? p.target.url : '', placeholder: p.ph?.url || '' }
  // 尚未进入可视范围（首次渲染）：内存里已有就直接显示（例如返回上一页），只有较小尺寸时先拿来垫底。
  // 打开全屏播放页时，过渡动画在首次渲染就截图；这里若显示骨架屏，展开动画会闪一下
  const ready = doneAtLeast(coverId, size)
  if (ready) return { status: 'done', url: ready.url, placeholder: '' }
  const e = entries.get(`${coverId}@${size || ''}`)
  return { status: e?.status === 'missing' ? 'missing' : 'idle', url: '', placeholder: doneSmaller(coverId, size)?.url || '' }
}

// 刷新资料库时调用：清空内存缓存（磁盘缓存由主进程处理）
export function resetCovers() {
  for (const e of [...entries.values()]) if (e.refs === 0 && e.status !== 'loading' && e.status !== 'queued') drop(e)
}

export const coverStats = () => ({ entries: entries.size, queued: queue.size, active })
