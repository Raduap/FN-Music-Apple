import { Component, createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { coverUrl } from '../api'
import { useUI, usePlayer } from '../store'
import * as Icon from '../icons'

export const ScrollCtx = createContext({ current: null })
export const useScrollEl = () => useContext(ScrollCtx)

// 拖拽歌曲到侧边栏播放列表时的载荷（dataTransfer 只能在 drop 时读取，这里用模块变量传递对象）
export const songDrag = { songs: [] }
export const SONG_DRAG_TYPE = 'application/x-fnmusic-songs'

// ---------- 封面 ----------
// 封面经限流队列加载（同时最多 3 张）、失败自动重试，并缓存为 blob URL。
// 首页一次会请求几十张封面，不限流时 NAS 现场生成缩略图容易被拖慢甚至拒绝。
const covers = new Map() // `${coverId}@${size}` -> { id, size, refs, status: idle|queued|loading|done|fail, url, subs }
const coverQueue = []
let coverActive = 0
// 注意：浏览器/Chromium 对同一主机最多 6 个并发连接，封面只占 3 个，给接口请求和音频流留出余量
const COVER_CONCURRENCY = 3
const COVER_CACHE_MAX = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const coverKey = (id, size) => `${id}@${size}`
function coverEntry(id, size) {
  const k = coverKey(id, size)
  let e = covers.get(k)
  if (!e) covers.set(k, (e = { id, size, refs: 0, status: 'idle', url: '', subs: new Set() }))
  return e
}
function pumpCovers() {
  while (coverActive < COVER_CONCURRENCY && coverQueue.length) {
    const e = coverQueue.shift()
    if (e.refs === 0) { e.status = 'idle'; continue } // 已滚出屏幕，放弃
    coverActive++
    loadCover(e).finally(() => { coverActive--; pumpCovers() })
  }
}
async function loadCover(e) {
  e.status = 'loading'
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(coverUrl(e.id, e.size))
      if (r.status >= 400 && r.status < 500) { e.status = 'fail'; e.subs.forEach((f) => f()); return } // 封面不存在/ID 无效，重试也没用
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const blob = await r.blob()
      if (!blob.size) throw new Error('empty')
      e.url = URL.createObjectURL(blob)
      e.status = 'done'
      evictCovers()
      e.subs.forEach((f) => f())
      return
    } catch {
      if (i < 2) await sleep(700 * (i + 1))
    }
  }
  e.status = 'fail'
  e.subs.forEach((f) => f())
}
function evictCovers() {
  if (covers.size <= COVER_CACHE_MAX) return
  for (const [k, e] of covers) {
    if (covers.size <= COVER_CACHE_MAX) break
    if (e.refs === 0 && e.status === 'done') { URL.revokeObjectURL(e.url); covers.delete(k) }
  }
}

function useCoverImage(coverId, size, wanted) {
  const [, force] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    if (!coverId || !wanted) return
    const e = coverEntry(coverId, size)
    e.refs++
    e.subs.add(force)
    if (e.status === 'fail') e.status = 'idle'
    if (e.status === 'idle') { e.status = 'queued'; coverQueue.push(e); pumpCovers() }
    force()
    return () => { e.refs--; e.subs.delete(force) }
  }, [coverId, size, wanted])
  const e = coverId ? covers.get(coverKey(coverId, size)) : null
  return e ? { status: e.status, url: e.url } : { status: coverId && wanted ? 'queued' : 'idle', url: '' }
}

// size：显示尺寸（px，用于布局）；px：向服务器请求的图片尺寸（160 / 600 / 1024），列表小图用 160 可大幅减少流量
export function Cover({ coverId, size, px = 600, round, className = '', alt = '', icon = 'note' }) {
  const ref = useRef(null)
  const [near, setNear] = useState(false)
  const { status, url } = useCoverImage(coverId, px, near)
  const [shown, setShown] = useState(false)
  useEffect(() => setShown(false), [url])

  // 只加载屏幕附近的封面，滚远了未开始的请求会被放弃
  useEffect(() => {
    if (!coverId || !ref.current) return
    const io = new IntersectionObserver(([en]) => setNear(en.isIntersecting), { rootMargin: '400px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [coverId])

  const Fallback = icon === 'person' ? Icon.Person : Icon.Note
  const failed = !coverId || status === 'fail'
  return (
    <div ref={ref} className={`cover ${round ? 'round' : ''} ${className}`} style={size ? { width: size, height: size } : undefined}>
      {failed && (
        <div className="cover-fallback">
          <Fallback size={size ? Math.max(14, Math.round(size * 0.4)) : 44} />
        </div>
      )}
      {!failed && !shown && <div className="cover-skeleton" />}
      {status === 'done' && url && (
        <img src={url} alt={alt} decoding="async" draggable={false} className={shown ? 'loaded' : ''} onLoad={() => setShown(true)} />
      )}
    </div>
  )
}

// ---------- 加载 / 错误 / 空 ----------
export const Spinner = ({ size = 28 }) => (
  <div className="spinner" style={{ width: size, height: size }} role="status" aria-label="加载中">
    {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 45}deg)`, animationDelay: `${i * 0.1 - 0.8}s` }} />)}
  </div>
)
export const Loading = () => <div className="state-box"><Spinner /></div>
export const ErrorBox = ({ error, onRetry }) => (
  <div className="state-box" role="alert">
    <Icon.Close size={40} className="state-icon" />
    <div className="state-title">无法载入内容</div>
    <div className="state-sub selectable">{error?.message || String(error)}</div>
    {onRetry && <button className="btn" onClick={onRetry}>重试</button>}
  </div>
)
// 页面渲染出错时只替换内容区，侧边栏和播放器照常可用；resetKey 变化（切换页面）时自动复位
export class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[页面渲染出错]', error, info?.componentStack) }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return <ErrorBox error={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

export const Empty = ({ title, sub, icon: Ic = Icon.Note }) => (
  <div className="state-box">
    <Ic size={44} className="state-icon" />
    <div className="state-title">{title}</div>
    {sub && <div className="state-sub">{sub}</div>}
  </div>
)

// ---------- 页面标题（滚动后同步显示到顶部导航条） ----------
export function usePageTitle(title) {
  useEffect(() => {
    useUI.getState().setPageTitle(title || '')
    return () => useUI.getState().setPageTitle('')
  }, [title])
}

export function PageHeader({ title, children }) {
  usePageTitle(title)
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {children && <div className="page-header-actions">{children}</div>}
    </div>
  )
}

// ---------- 红心：点亮时弹出并扩散一圈光环 ----------
export function HeartIcon({ on, size = 16 }) {
  const prev = useRef(on)
  const [pop, setPop] = useState(false)
  useEffect(() => {
    let t
    if (on && !prev.current) { setPop(true); t = setTimeout(() => setPop(false), 700) }
    prev.current = on
    return () => clearTimeout(t)
  }, [on])
  return <span className={`heart ${pop ? 'pop' : ''}`}>{on ? <Icon.HeartFill size={size} /> : <Icon.Heart size={size} />}</span>
}

// ---------- 分段控件：高亮块带弹簧滑动到所选项 ----------
export function Seg({ options, value, onChange, small, tabs, label, className = '' }) {
  const ref = useRef(null)
  const [thumb, setThumb] = useState(null)
  const [ready, setReady] = useState(false)
  const measure = () => {
    const el = ref.current?.querySelector('button.on')
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth })
  }
  useLayoutEffect(measure, [value, options.length])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    const t = setTimeout(() => setReady(true), 60) // 首次定位不做动画
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [])
  return (
    <div ref={ref} className={`seg ${small ? 'small' : ''} ${ready ? 'ready' : ''} ${className}`} role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {thumb && <i className="seg-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {options.map((o) => (
        <button
          key={o.value}
          role={tabs ? 'tab' : undefined}
          aria-selected={tabs ? value === o.value : undefined}
          aria-pressed={tabs ? undefined : value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- 播放 / 随机按钮 ----------
export function PlayButtons({ songs, disabled }) {
  const play = usePlayer((s) => s.play)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const off = disabled || !songs?.length
  return (
    <div className="play-buttons">
      <button className="btn btn-accent" disabled={off} onClick={() => play(songs, 0, { shuffle: false })}>
        <Icon.Play size={14} /> 播放
      </button>
      <button className="btn btn-accent-soft" disabled={off} onClick={() => playShuffled(songs)}>
        <Icon.Shuffle size={15} /> 随机播放
      </button>
    </div>
  )
}

// ---------- 右键菜单（支持键盘：↑↓ 选择、→ 打开子菜单、← 返回、Enter 执行、Esc 关闭） ----------
const selectable = (it) => it && it !== '-' && !it.disabled
function nextIndex(list, from, dir) {
  const n = list.length
  if (!list.some(selectable)) return -1
  let i = from
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n
    if (selectable(list[i])) return i
  }
  return from
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu)
  const close = useUI((s) => s.closeMenu)
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const [path, setPath] = useState([]) // 每一级当前高亮的下标；长度 > 层级 + 1 表示该层的子菜单已展开

  useEffect(() => setPath([]), [menu])

  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null)
    // 用 offsetWidth/Height：不受弹出动画里 scale 的影响
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight
    const flipX = menu.x + w > window.innerWidth - 8
    const flipY = menu.y + h > window.innerHeight - 8
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8))
    const y = flipY ? Math.max(8, menu.y - h) : menu.y
    setPos({ x, y, origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}` })
  }, [menu])

  const levels = (items, p) => {
    const out = [items.filter(Boolean)]
    for (let d = 0; d < p.length - 1; d++) {
      const parent = out[d][p[d]]
      if (parent?.children) out.push(parent.children.filter(Boolean))
    }
    return out
  }

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close() }
    const onKey = (e) => {
      const lv = levels(menu.items, path)
      const d = path.length ? path.length - 1 : 0
      const list = lv[Math.min(d, lv.length - 1)] || []
      const cur = path.length ? path[path.length - 1] : -1
      const set = (i) => setPath(path.length ? [...path.slice(0, -1), i] : [i])
      if (e.key === 'Escape') { e.preventDefault(); path.length > 1 ? setPath(path.slice(0, -1)) : close() }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = nextIndex(list, cur === -1 ? (e.key === 'ArrowDown' ? -1 : 0) : cur, e.key === 'ArrowDown' ? 1 : -1); if (i >= 0) set(i) }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const i = e.key === 'Home' ? nextIndex(list, -1, 1) : nextIndex(list, 0, -1); if (i >= 0) set(i) }
      else if (e.key === 'ArrowRight') {
        const it = list[cur]
        if (it?.children) { e.preventDefault(); setPath([...path, nextIndex(it.children.filter(Boolean), -1, 1)]) }
      } else if (e.key === 'ArrowLeft') { if (path.length > 1) { e.preventDefault(); setPath(path.slice(0, -1)) } }
      else if (e.key === 'Enter' || e.key === ' ') {
        const it = list[cur]
        if (!selectable(it)) return
        e.preventDefault()
        if (it.children) setPath([...path, nextIndex(it.children.filter(Boolean), -1, 1)])
        else { close(); it.onClick?.() }
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    document.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('wheel', close)
    }
     
  }, [menu, path, close])

  if (!menu) return null
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden', transformOrigin: pos?.origin }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} depth={0} path={path} setPath={setPath} close={close} />
    </div>
  )
}

function MenuList({ items, depth, path, setPath, close }) {
  const list = items.filter(Boolean)
  return list.map((it, i) => {
    if (it === '-') return <div key={i} className="menu-sep" role="separator" />
    const Ic = it.icon
    const expanded = !!it.children && path[depth] === i && path.length > depth + 1
    const highlighted = path[depth] === i && (path.length - 1 === depth || expanded)
    return (
      <div
        key={i}
        role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={it.checked}
        aria-disabled={it.disabled || undefined}
        aria-haspopup={it.children ? 'menu' : undefined}
        className={`menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''} ${highlighted ? 'active' : ''}`}
        onMouseEnter={() => !it.disabled && setPath(it.children ? [...path.slice(0, depth), i, -1] : [...path.slice(0, depth), i])}
        onClick={() => {
          if (it.disabled) return
          if (it.children) return setPath([...path.slice(0, depth), i, -1])
          close()
          it.onClick?.()
        }}
      >
        <span className="menu-label">{it.label}</span>
        {it.children ? <Icon.ChevronRight size={14} /> : Ic ? <Ic size={16} /> : it.checked ? <Icon.Check size={16} /> : null}
        {expanded && (
          <Submenu>
            <MenuList items={it.children} depth={depth + 1} path={path} setPath={setPath} close={close} />
          </Submenu>
        )}
      </div>
    )
  })
}

// 子菜单：默认在右侧展开，空间不够时翻到左侧，并保证不超出窗口上下边界
function Submenu({ children }) {
  const ref = useRef(null)
  const [place, setPlace] = useState({ flip: false, dy: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    const par = el?.offsetParent // 触发它的菜单项（position: relative）
    if (!el || !par) return
    const pr = par.getBoundingClientRect()
    const w = el.offsetWidth, h = el.offsetHeight
    const flip = pr.right - 4 + w > window.innerWidth - 8
    const top = pr.top - 5
    let dy = 0
    if (top + h > window.innerHeight - 8) dy = -(top + h - window.innerHeight + 8)
    if (top + dy < 8) dy = 8 - top
    setPlace({ flip, dy })
  }, [])
  return (
    <div ref={ref} className="menu submenu" role="menu" style={{ top: -5 + place.dy, transformOrigin: place.flip ? 'top right' : 'top left', ...(place.flip ? { right: 'calc(100% - 4px)', left: 'auto' } : null) }}>
      {children}
    </div>
  )
}

// ---------- 对话框（输入名称 / 确认） ----------
export function Dialog() {
  const current = useUI((s) => s.dialog)
  const close = useUI((s) => s.closeDialog)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const okRef = useRef(null)
  const lastFocus = useRef(null)
  // 关闭时先播放退出动画（约 180ms）再卸载：shown 保留最后一个对话框内容
  const [shown, setShown] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const dialog = shown

  useEffect(() => {
    if (current) {
      setShown(current)
      setLeaving(false)
      return
    }
    if (!shown) return
    setLeaving(true)
    const t = setTimeout(() => { setShown(null); setLeaving(false) }, 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  useEffect(() => {
    if (current) {
      lastFocus.current = document.activeElement
      setValue(current.defaultValue || '')
      setBusy(false)
      setTimeout(() => (current.input ? inputRef.current?.select() : okRef.current?.focus()), 30)
    } else if (lastFocus.current instanceof HTMLElement) {
      lastFocus.current.focus?.() // 关闭后把焦点还给触发它的元素
    }
  }, [current])

  if (!dialog) return null
  const submit = async () => {
    if (busy || (dialog.input && !value.trim())) return
    setBusy(true)
    try {
      await dialog.onConfirm?.(value.trim())
      close()
    } catch (e) {
      useUI.getState().showToast(e.message)
      setBusy(false)
    }
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') submit()
    else if (e.key === 'Tab') {
      // 焦点限制在对话框内
      const els = [...e.currentTarget.querySelectorAll('input, button:not(:disabled)')]
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
  return (
    <div className={`dialog-mask ${leaving ? 'leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onKeyDown={onKeyDown}>
        <div className="dialog-title">{dialog.title}</div>
        {dialog.message && <div className="dialog-msg">{dialog.message}</div>}
        {dialog.input && (
          <input ref={inputRef} className="input" value={value} maxLength={64} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} />
        )}
        <div className="dialog-actions">
          {!dialog.alert && <button className="btn" onClick={close}>取消</button>}
          <button ref={okRef} className={`btn ${dialog.danger ? 'btn-danger' : 'btn-accent'}`} disabled={busy || (dialog.input && !value.trim())} onClick={submit}>
            {dialog.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast() {
  const toast = useUI((s) => s.toast)
  return <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast?.text}</div>
}

// ---------- 歌曲菜单 ----------
export function useSongMenu() {
  const navigate = useNavigate()
  return (songs, { extra = [] } = {}) => {
    const ui = useUI.getState()
    const p = usePlayer.getState()
    const one = songs.length === 1 ? songs[0] : null
    const pls = ui.playlists
    const many = songs.length > 1
    return [
      many && { label: `已选择 ${songs.length} 首歌曲`, disabled: true },
      many && '-',
      { label: '播放下一首', icon: Icon.PlayNext, onClick: () => p.playNext(songs) },
      { label: '稍后播放', icon: Icon.PlayLater, onClick: () => p.addToQueue(songs) },
      '-',
      {
        label: '添加到播放列表',
        children: [
          {
            label: '新建播放列表…',
            icon: Icon.Plus,
            onClick: () => ui.openDialog({ title: '新建播放列表', input: true, placeholder: '播放列表名称', confirmText: '创建', onConfirm: (name) => ui.createPlaylist(name, songs) }),
          },
          pls.length ? '-' : null,
          ...pls.map((pl) => ({ label: pl.name, onClick: () => ui.addToPlaylist(pl, songs) })),
        ],
      },
      one && { label: one.favorite ? '取消喜欢' : '喜欢', icon: one.favorite ? Icon.HeartFill : Icon.Heart, onClick: () => p.toggleFavorite(one) },
      many && { label: '喜欢', icon: Icon.Heart, onClick: () => ui.favoriteSongs(songs) },
      '-',
      one?.albumId && { label: '前往专辑', icon: Icon.AlbumIcon, onClick: () => navigate(`/album/${one.albumId}`) },
      one?.artistId && { label: '前往艺人', icon: Icon.Mic, onClick: () => navigate(`/artist/${one.artistId}`) },
      ...(extra.length ? ['-', ...extra] : []),
    ]
  }
}

// 同步“喜欢”状态到本地列表
export function useFavoriteSync(setList) {
  useEffect(() => {
    const h = (e) => setList((list) => list && list.map((s) => (s.id === e.detail.id ? { ...s, favorite: e.detail.favorite } : s)))
    window.addEventListener('fn:favorite-changed', h)
    return () => window.removeEventListener('fn:favorite-changed', h)
  }, [setList])
}
