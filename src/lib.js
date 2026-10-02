import { useEffect, useRef, useState } from 'react'
import { coverUrl } from './api'

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
export function parseLrc(text) {
  if (!text) return []
  const lines = []
  let offset = 0
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*(-?\d+)\]/i.exec(raw.trim())
    if (off) { offset = +off[1] / 1000; continue }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const content = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? +m[3] / Math.pow(10, m[3].length) : 0
      lines.push({ time: +m[1] * 60 + +m[2] + frac - offset, text: content })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

// ---------- 封面主色（用于全屏播放页背景） ----------
const colorCache = new Map()
export function useCoverColor(coverId) {
  const [color, setColor] = useState(() => colorCache.get(coverId) || [90, 90, 100])
  useEffect(() => {
    if (!coverId) return
    if (colorCache.has(coverId)) { setColor(colorCache.get(coverId)); return }
    let dead = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
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
    img.src = coverUrl(coverId, 160)
    return () => { dead = true }
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

export function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const pickRandom = (arr, count) => shuffled(arr).slice(0, count)
