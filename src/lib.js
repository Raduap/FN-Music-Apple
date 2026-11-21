import { useEffect, useRef, useState } from 'react'
import { acquireCover } from './covers'

// ---------- 时间 ----------
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtTotal(sec) {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`
}

// ---------- LRC 解析 ----------
// 实现统一在 electron/lyricsMerge.mjs（纯逻辑零依赖），这里仅做再导出，
// 保证既有 import 路径与测试不变。
export { parseLrc } from '../electron/lyricsMerge.mjs'

// ---------- 封面主色（用于全屏播放页背景） ----------
const colorCache = new Map()
export function useCoverColor(coverId) {
  const [color, setColor] = useState(() => colorCache.get(coverId) || [90, 90, 100])
  useEffect(() => {
    if (!coverId) return
    if (colorCache.has(coverId)) { setColor(colorCache.get(coverId)); return }
    let dead = false
    // 与界面上的封面共用缓存（播放栏已经加载过 160 尺寸，通常无需再请求）
    const cover = acquireCover(coverId, 160)
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 16
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, 16, 16)
        const d = ctx.getImageData(0, 0, 16, 16).data
        let r = 0, g = 0, b = 0, w = 0
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2])
          const sat = mx === 0 ? 0 : (mx - mn) / mx
          const wt = 0.15 + sat * sat * 2 // 偏向饱和度高的像素，避免灰蒙蒙
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt
        }
        const col = [Math.round(r / w), Math.round(g / w), Math.round(b / w)]
        colorCache.set(coverId, col)
        if (!dead) setColor(col)
      } catch {}
    }
    cover.promise.then((url) => { if (url && !dead) img.src = url })
    return () => { dead = true; img.onload = null; cover.release() }
  }, [coverId])
  return color
}

// ---------- 视口尺寸（短定时器节流；不用 rAF，窗口被遮挡/后台时 rAF 会被暂停，状态会滞后） ----------
export function useViewport() {
  const [v, setV] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    let t = 0
    const f = () => {
      clearTimeout(t)
      t = setTimeout(() => setV((o) => (o.w === window.innerWidth && o.h === window.innerHeight ? o : { w: window.innerWidth, h: window.innerHeight })), 30)
    }
    window.addEventListener('resize', f)
    return () => { window.removeEventListener('resize', f); clearTimeout(t) }
  }, [])
  return v
}

// ---------- 异步数据 ----------
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(fn)
      .then((data) => id === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => id === seq.current && setState({ data: null, loading: false, error }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

// 拖动排序：把 arr 中 from 位置的元素移动到 to 位置（to 为落点索引，允许等于末尾）。
// 返回新数组，不改原数组；越界或原地移动时返回等价副本，便于调用方无脑 setState。
export function moveItem(arr, from, to) {
  const a = Array.isArray(arr) ? [...arr] : []
  if (a.length < 2) return a
  if (!Number.isInteger(from) || !Number.isInteger(to)) return a
  if (from < 0 || from >= a.length) return a
  const dst = Math.max(0, Math.min(a.length - 1, to))
  if (dst === from) return a
  const [item] = a.splice(from, 1)
  a.splice(dst, 0, item)
  return a
}

export function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const pickRandom = (arr, count) => shuffled(arr).slice(0, count)
