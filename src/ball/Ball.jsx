// 悬浮球：收起时是一颗带进度环的唱片封面，悬停时展开成胶囊形迷你播放器
//
// 交互
// - 悬停 120ms 后展开，离开 450ms 后收起（避免鼠标掠过时闪动）
// - 单击圆球：打开主窗口；按住圆球或面板空白处拖动：自由移动，松手停在原处
// - 滚轮：调节音量；右键：菜单
// - 窗口透明区域默认鼠标穿透，只有指针在胶囊上时才接收点击
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { acquireCover } from '../covers'
import { useCoverColor } from '../lib'
import * as Icon from '../icons'

const bridge = window.ball
const RING_R = 28
const RING_C = 2 * Math.PI * RING_R
const EMPTY = { title: '', artist: '', coverId: '', playing: false, loading: false, duration: 0, currentTime: 0, at: 0, favorite: false, volume: 1, lyric: '', motion: 'on' }

// ---------- 演示模式：在普通浏览器里打开 ball.html?demo 预览界面（无 Electron） ----------
const demo = bridge ? null : new URLSearchParams(location.search)
const DEMO_STATE = demo && {
  ...EMPTY,
  title: demo.get('title') ?? '晴天',
  artist: demo.get('artist') ?? '周杰伦',
  lyric: demo.get('lyric') ?? '刮风这天 我试过握着你手',
  playing: demo.get('playing') !== '0',
  loading: demo.get('loading') === '1',
  favorite: demo.get('favorite') === '1',
  duration: 269,
  currentTime: 96,
  at: Date.now(),
  volume: 0.6,
}

// 封面主色 → 用作进度环和光晕。太灰或太暗 / 太亮时调整，保证在浅色和深色背景上都看得见
function vivid([r, g, b]) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
  let h = 0
  const d = max - min
  if (d) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6
    else if (max === g / 255) h = (b - r) / 255 / d + 2
    else h = (r - g) / 255 / d + 4
    h *= 60
  }
  const l = (max + min) / 2
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  if (s < 0.18) return [250, 35, 59] // 接近灰色的封面：用品牌红
  const S = Math.max(0.55, s), L = Math.min(0.6, Math.max(0.48, l))
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [R, G, B].map((v) => Math.round((v + m) * 255))
}

function useBallState() {
  const [state, setState] = useState(DEMO_STATE || EMPTY)
  useEffect(() => {
    if (!bridge) return
    const off = bridge.onState((s) => setState({ ...EMPTY, ...s }))
    bridge.ready()
    return off
  }, [])
  return state
}

function useAnchor() {
  const [anchor, setAnchor] = useState(demo?.get('anchor') || 'right')
  useEffect(() => bridge?.onLayout((l) => setAnchor(l.anchor)), [])
  return anchor
}

// 当前封面（160px，经主进程磁盘缓存）；切歌时保留旧封面直到新封面就绪，用于交叉淡入
function useCoverUrl(coverId) {
  const [url, setUrl] = useState(demo?.get('cover') || '')
  useEffect(() => {
    if (demo || !coverId) { if (!demo) setUrl(''); return }
    const c = acquireCover(coverId, 160)
    let dead = false
    c.promise.then((u) => { if (!dead) setUrl(u) })
    return () => { dead = true; c.release() }
  }, [coverId])
  return url
}

// 进度环：直接写 SVG 属性，不触发 React 重渲染；播放中每 250ms 按时间推算一次
function useRing(ref, state) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = () => {
      const t = state.currentTime + (state.playing ? (Date.now() - state.at) / 1000 : 0)
      const p = state.duration > 0 ? Math.min(1, Math.max(0, t / state.duration)) : 0
      el.style.strokeDashoffset = String(RING_C * (1 - p))
    }
    draw()
    if (!state.playing) return
    const id = setInterval(draw, 250)
    return () => clearInterval(id)
  }, [ref, state.currentTime, state.at, state.playing, state.duration])
}

// 标题过长时，展开后来回滚动显示
function useMarquee(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const over = el.scrollWidth - el.parentElement.clientWidth
    el.style.setProperty('--shift', over > 2 ? `${-over}px` : '0px')
    el.style.setProperty('--dur', `${Math.max(6, over / 18 + 4)}s`)
    el.dataset.scroll = over > 2 ? '1' : '0'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export default function Ball() {
  const state = useBallState()
  const anchor = useAnchor()
  const cover = useCoverUrl(state.coverId)
  const color = useCoverColor(demo ? '' : state.coverId)
  const [r, g, b] = vivid(demo ? [64, 140, 220] : color)
  const has = !!state.title

  const [expanded, setExpanded] = useState(demo?.get('expanded') === '1')
  const [hud, setHud] = useState(false) // 滚轮调音量时显示音量
  const [dragging, setDragging] = useState(false)
  const timers = useRef({})
  const ring = useRef(null)
  const titleRef = useRef(null)
  const press = useRef(null)
  useRing(ring, state)
  useMarquee(titleRef, [state.title, expanded])

  const reduce = state.motion === 'off' || (state.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  const later = (key, fn, ms) => { clearTimeout(timers.current[key]); timers.current[key] = setTimeout(fn, ms) }
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  // 透明窗口默认鼠标穿透，Windows 只转发鼠标移动消息，所以用 mouse 事件（而不是 pointer 事件）判断悬停
  const interactive = useRef(false)
  const setInteractive = (on) => {
    if (interactive.current === on) return
    interactive.current = on
    bridge?.setInteractive(on)
  }
  const onEnter = () => {
    setInteractive(true)
    clearTimeout(timers.current.collapse)
    if (!expanded) later('expand', () => setExpanded(true), 120)
  }
  const onLeave = () => {
    if (press.current) return // 拖动中（指针被捕获）不收起
    setInteractive(false)
    clearTimeout(timers.current.expand)
    later('collapse', () => setExpanded(false), 450)
  }

  // 拖动：按下时通知主进程记录起点，移动超过 4px 才算拖动；没拖动就松手视为点击
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('.ctrl')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.screenX, y: e.screenY, moved: false, onOrb: !!e.target.closest('.orb') }
    bridge?.dragStart()
  }
  const onPointerMove = (e) => {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.hypot(e.screenX - p.x, e.screenY - p.y) < 4) return
    if (!p.moved) { p.moved = true; setDragging(true); setExpanded(false) }
    bridge?.dragMove()
  }
  const onPointerUp = (e) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.moved) {
      setDragging(false)
      bridge?.dragEnd()
      // 松手时光标可能已在面板外
      if (!e.currentTarget.matches(':hover')) onLeave()
    } else if (p.onOrb) bridge?.command('show-main')
  }

  const onWheel = (e) => {
    if (!has) return
    bridge?.command('volume', e.deltaY < 0 ? 0.05 : -0.05)
    setHud(true)
    setExpanded(true)
    later('hud', () => setHud(false), 1400)
  }

  const cmd = useCallback((c) => (e) => { e.stopPropagation(); bridge?.command(c) }, [])
  const vol = Math.round((state.volume ?? 1) * 100)
  const sub = hud ? null : state.lyric || state.artist

  return (
    <div
      className="stage"
      data-anchor={anchor}
      data-expanded={expanded || undefined}
      data-playing={state.playing || undefined}
      data-idle={!has || undefined}
      data-loading={(state.loading && state.playing) || undefined}
      data-dragging={dragging || undefined}
      data-motion={reduce ? 'reduce' : 'full'}
      data-palette={state.palette || 'red'}
      style={{ '--c': `${r} ${g} ${b}` }}
    >
      <div
        className="capsule"
        role="toolbar"
        aria-label="迷你播放器"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onMouseMove={() => setInteractive(true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => { e.preventDefault(); bridge?.menu() }}
      >
        <div className="glow" aria-hidden="true" />

        <button className="orb" title={has ? '打开飞牛音乐' : '飞牛音乐'} aria-label="打开飞牛音乐">
          <svg className="ring" viewBox="0 0 60 60" aria-hidden="true">
            <circle className="ring-track" cx="30" cy="30" r={RING_R} />
            <circle className="ring-progress" ref={ring} cx="30" cy="30" r={RING_R} strokeDasharray={RING_C} strokeDashoffset={RING_C} />
            <circle className="ring-spinner" cx="30" cy="30" r={RING_R} strokeDasharray={`${RING_C * 0.18} ${RING_C}`} />
          </svg>
          <span className={`disc ${has && cover ? '' : 'idle'}`}>
            {has && cover ? <img key={cover} src={cover} alt="" draggable={false} /> : <Icon.Note size={22} />}
          </span>
        </button>

        <div className="body" aria-hidden={!expanded}>
          <div className="meta">
            <div className="title">
              <span ref={titleRef}>{has ? state.title : '飞牛音乐'}</span>
            </div>
            <div className="sub">
              {hud ? (
                <span key="hud" className="hud">
                  {vol === 0 ? <Icon.Mute size={15} /> : <Icon.Volume size={15} />}
                  <i className="hud-bar"><i style={{ width: `${vol}%` }} /></i>
                  <em>{vol}%</em>
                </span>
              ) : (
                <span key={sub} className={has && state.lyric ? 'lyric' : ''}>{has ? sub : '未在播放 · 点击圆球打开'}</span>
              )}
            </div>
          </div>

          {has && (
            <div className="controls">
              <button className="ctrl" onClick={cmd('prev')} title="上一首" aria-label="上一首"><Icon.Prev size={15} /></button>
              <button className="ctrl main" onClick={cmd('toggle')} title={state.playing ? '暂停' : '播放'} aria-label={state.playing ? '暂停' : '播放'}>
                <span key={state.playing ? 'pause' : 'play'} className="swap">{state.playing ? <Icon.Pause size={15} /> : <Icon.Play size={15} style={{ marginLeft: 2 }} />}</span>
              </button>
              <button className="ctrl" onClick={cmd('next')} title="下一首" aria-label="下一首"><Icon.Next size={15} /></button>
              <button className={`ctrl fav ${state.favorite ? 'on' : ''}`} onClick={cmd('favorite')} title={state.favorite ? '取消喜欢' : '喜欢'} aria-label={state.favorite ? '取消喜欢' : '喜欢'} aria-pressed={state.favorite}>
                {state.favorite ? <Icon.HeartFill size={15} /> : <Icon.Heart size={15} />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
