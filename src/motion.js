import { flushSync } from 'react-dom'
import { useUI } from './store'

// 动画开关：'on' 始终开启（默认）｜'system' 跟随系统“减少动效”｜'off' 关闭。
// 默认不跟随系统：很多电脑为了省电/远程桌面会关掉 Windows 的“显示动画效果”，
// Chromium 会据此报告 prefers-reduced-motion，导致应用里完全没有动画。
const MQ = window.matchMedia('(prefers-reduced-motion: reduce)')
let motionMode = 'on'
export function applyMotion(mode = motionMode) {
  motionMode = mode
  const reduce = mode === 'off' || (mode === 'system' && MQ.matches)
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full'
}
MQ.addEventListener?.('change', () => applyMotion())
export const reduced = () => document.documentElement.dataset.motion === 'reduce'
const CLASSES = ['vt-np', 'vt-old-bar', 'vt-new-full', 'vt-old-full', 'vt-new-bar']

/**
 * 打开 / 关闭全屏播放页。
 * 支持 View Transitions 时：播放栏里的小封面与全屏大封面共享同一个元素名（np-art），
 * 浏览器会自动把它从一个位置平滑变形到另一个位置（Apple Music 的展开效果）；
 * 不支持或开启“减少动效”时，直接切换状态，由 CSS 完成滑入/滑出。
 */
function toggleFull(open) {
  const ui = useUI.getState()
  if (ui.fullPlayer === open) return
  const root = document.documentElement
  if (!document.startViewTransition || reduced()) return ui.setFullPlayer(open)

  const clear = () => root.classList.remove(...CLASSES)
  clear()
  root.classList.add('vt-np', open ? 'vt-old-bar' : 'vt-old-full')
  try {
    const t = document.startViewTransition(() => {
      flushSync(() => useUI.getState().setFullPlayer(open))
      root.classList.remove('vt-old-bar', 'vt-old-full')
      root.classList.add(open ? 'vt-new-full' : 'vt-new-bar')
    })
    t.finished.catch(() => {}).finally(clear)
  } catch {
    clear()
    ui.setFullPlayer(open)
  }
}

export const openFullPlayer = () => toggleFull(true)
export const closeFullPlayer = () => toggleFull(false)
