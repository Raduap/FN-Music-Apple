import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { coverUrl } from '../api'
import { useUI, usePlayer } from '../store'
import * as Icon from '../icons'

export const ScrollCtx = createContext({ current: null })
export const useScrollEl = () => useContext(ScrollCtx)

// ---------- 封面 ----------
export function Cover({ coverId, size, round, className = '', alt = '', icon = 'note' }) {
  const [state, setState] = useState(coverId ? 'loading' : 'none')
  useEffect(() => setState(coverId ? 'loading' : 'none'), [coverId])
  const Fallback = icon === 'person' ? Icon.Person : Icon.Note
  return (
    <div className={`cover ${round ? 'round' : ''} ${className}`} style={size ? { width: size, height: size } : undefined}>
      {state !== 'ok' && (
        <div className="cover-fallback">
          <Fallback size={size ? Math.max(16, size * 0.36) : 48} />
        </div>
      )}
      {coverId && state !== 'error' && (
        <img
          src={coverUrl(coverId)}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={state === 'ok' ? 'loaded' : ''}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
    </div>
  )
}

// ---------- 加载 / 错误 / 空 ----------
export const Spinner = ({ size = 28 }) => (
  <div className="spinner" style={{ width: size, height: size }}>
    {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 45}deg)`, animationDelay: `${i * 0.1 - 0.8}s` }} />)}
  </div>
)
export const Loading = () => <div className="state-box"><Spinner /></div>
export const ErrorBox = ({ error, onRetry }) => (
  <div className="state-box">
    <div className="state-title">无法载入内容</div>
    <div className="state-sub">{error?.message || String(error)}</div>
    {onRetry && <button className="btn" onClick={onRetry}>重试</button>}
  </div>
)
export const Empty = ({ title, sub, icon: Ic = Icon.Note }) => (
  <div className="state-box">
    <Ic size={48} className="state-icon" />
    <div className="state-title">{title}</div>
    {sub && <div className="state-sub">{sub}</div>}
  </div>
)

// ---------- 页面标题 ----------
export const PageHeader = ({ title, children }) => (
  <div className="page-header">
    <h1>{title}</h1>
    <div className="page-header-actions">{children}</div>
  </div>
)

// ---------- 播放 / 随机按钮 ----------
export function PlayButtons({ songs, disabled }) {
  const play = usePlayer((s) => s.play)
  const playShuffled = usePlayer((s) => s.playShuffled)
  const off = disabled || !songs?.length
  return (
    <div className="play-buttons">
      <button className="btn btn-accent" disabled={off} onClick={() => play(songs, 0, { shuffle: false })}>
        <Icon.Play size={15} /> 播放
      </button>
      <button className="btn btn-accent-soft" disabled={off} onClick={() => playShuffled(songs)}>
        <Icon.Shuffle size={16} /> 随机播放
      </button>
    </div>
  )
}

// ---------- 右键菜单 ----------
export function ContextMenu() {
  const menu = useUI((s) => s.menu)
  const close = useUI((s) => s.closeMenu)
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - r.width - 8)
    const y = menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y
    setPos({ x, y })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close() }
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    document.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('wheel', close)
    }
  }, [menu, close])

  if (!menu) return null
  return (
    <div ref={ref} className="menu" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}>
      <MenuItems items={menu.items} close={close} />
    </div>
  )
}

function MenuItems({ items, close }) {
  const [sub, setSub] = useState(-1)
  return items.filter(Boolean).map((it, i) => {
    if (it === '-') return <div key={i} className="menu-sep" />
    const Ic = it.icon
    return (
      <div
        key={i}
        className={`menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''} ${sub === i ? 'active' : ''}`}
        onMouseEnter={() => setSub(it.children ? i : -1)}
        onClick={() => {
          if (it.disabled || it.children) return
          close()
          it.onClick?.()
        }}
      >
        <span className="menu-label">{it.label}</span>
        {it.children ? <Icon.ChevronRight size={14} /> : Ic ? <Ic size={16} /> : it.checked ? <Icon.Check size={16} /> : null}
        {it.children && sub === i && (
          <div className="menu submenu">
            <MenuItems items={it.children} close={close} />
          </div>
        )}
      </div>
    )
  })
}

// ---------- 对话框（输入名称 / 确认） ----------
export function Dialog() {
  const dialog = useUI((s) => s.dialog)
  const close = useUI((s) => s.closeDialog)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (dialog) {
      setValue(dialog.defaultValue || '')
      setBusy(false)
      setTimeout(() => inputRef.current?.select(), 30)
    }
  }, [dialog])

  if (!dialog) return null
  const submit = async () => {
    if (dialog.input && !value.trim()) return
    setBusy(true)
    try {
      await dialog.onConfirm?.(value.trim())
      close()
    } catch (e) {
      useUI.getState().showToast(e.message)
      setBusy(false)
    }
  }
  return (
    <div className="dialog-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" onKeyDown={(e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') submit() }}>
        <div className="dialog-title">{dialog.title}</div>
        {dialog.message && <div className="dialog-msg">{dialog.message}</div>}
        {dialog.input && (
          <input ref={inputRef} className="input" value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={close}>取消</button>
          <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-accent'}`} disabled={busy || (dialog.input && !value.trim())} onClick={submit}>
            {dialog.confirmText || '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast() {
  const toast = useUI((s) => s.toast)
  return <div className={`toast ${toast ? 'show' : ''}`}>{toast?.text}</div>
}

// ---------- 歌曲菜单 ----------
export function useSongMenu() {
  const navigate = useNavigate()
  return (songs, { extra = [] } = {}) => {
    const ui = useUI.getState()
    const p = usePlayer.getState()
    const one = songs.length === 1 ? songs[0] : null
    const pls = ui.playlists
    return [
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
      one && '-',
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
