import { useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useAuth, usePlayer, useUI, restorePlayer } from './store'
import { useViewport } from './lib'
import Sidebar from './components/Sidebar'
import { PlayerBar, SidePanel, FullPlayer } from './components/Player'
import { ContextMenu, Dialog, ScrollCtx, Spinner, Toast } from './components/common'
import * as Icon from './icons'
import Login from './pages/Login'
import Home from './pages/Home'
import Search from './pages/Search'
import { Albums, Artists, Favorites, GenreDetail, Genres, Playlists, Songs } from './pages/Library'
import { AlbumDetail, ArtistDetail, PlaylistDetail } from './pages/Detail'

export const RAIL_BREAKPOINT = 980 // 窗口宽度低于此值时侧边栏自动收成图标栏

// 标题栏按钮颜色跟随主题
function useThemeSync() {
  const theme = useUI((s) => s.theme)
  const full = useUI((s) => s.fullPlayer)
  useEffect(() => {
    window.fn.setTheme(theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => window.fn.setOverlay({ symbolColor: full || mq.matches ? '#ffffff' : '#1d1d1f' })
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, full])
}

// 窗口标题 / 任务栏悬停提示显示当前歌曲
function useDocumentTitle() {
  const title = usePlayer((s) => s.queue[s.index]?.title)
  const artist = usePlayer((s) => s.queue[s.index]?.artist)
  const playing = usePlayer((s) => s.playing)
  useEffect(() => {
    document.title = title ? `${playing ? '' : '⏸ '}${title} — ${artist}` : '飞牛音乐'
  }, [title, artist, playing])
}

// 当前焦点在可自行处理按键的控件上时，不触发全局快捷键
const isInteractive = (t) => !!t?.closest?.('input, textarea, select, button, a, [role="slider"], [role="menuitem"], [contenteditable="true"]')

function useShortcuts() {
  const navigate = useNavigate()
  useEffect(() => {
    const k = (e) => {
      const p = usePlayer.getState()
      const ui = useUI.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const input = document.querySelector('[data-search-input]')
        if (input) { input.focus(); input.select() } else navigate('/search', { state: { focus: true } })
        return
      }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return navigate(-1) }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return navigate(1) }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); return ui.toggleSidebar() }
      if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); return ui.togglePanel('lyrics') }
      if (mod && e.key === 'ArrowRight') { e.preventDefault(); return p.next() }
      if (mod && e.key === 'ArrowLeft') { e.preventDefault(); return p.prev() }
      if (mod && e.key === 'ArrowUp') { e.preventDefault(); return p.setVolume(p.volume + 0.05) }
      if (mod && e.key === 'ArrowDown') { e.preventDefault(); return p.setVolume(p.volume - 0.05) }
      if (e.code === 'Space' && !isInteractive(e.target)) { e.preventDefault(); p.toggle() }
    }
    window.addEventListener('keydown', k)
    const off = window.fn.onNav?.((d) => navigate(d))
    return () => { window.removeEventListener('keydown', k); off?.() }
  }, [navigate])
}

// 顶部导航条：收起侧栏 / 后退 / 前进，滚动后在中间淡入页面标题；右侧为 Windows 窗口控制按钮预留区域
function NavStrip({ canToggle }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const pageTitle = useUI((s) => s.pageTitle)
  const scrolled = useUI((s) => s.scrolled)
  const maxIdx = useRef(0)
  const idx = window.history.state?.idx ?? 0
  if (navType === 'PUSH') maxIdx.current = idx
  else maxIdx.current = Math.max(maxIdx.current, idx)
  const canBack = idx > 0
  const canFwd = idx < maxIdx.current
  void location

  return (
    <div className={`navstrip ${scrolled ? 'scrolled' : ''}`}>
      <div className="ns-left">
        {canToggle && (
          <button className="icon-btn" onClick={toggleSidebar} title={collapsed ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)'} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} aria-pressed={!collapsed}>
            <Icon.Sidebar size={18} />
          </button>
        )}
        <button className="icon-btn" onClick={() => navigate(-1)} disabled={!canBack} title="后退 (Alt+←)" aria-label="后退"><Icon.ChevronLeft size={19} /></button>
        <button className="icon-btn" onClick={() => navigate(1)} disabled={!canFwd} title="前进 (Alt+→)" aria-label="前进"><Icon.ChevronRight size={19} /></button>
      </div>
      <div className="ns-title" aria-hidden={!scrolled}>{pageTitle}</div>
    </div>
  )
}

function Main() {
  const scrollRef = useRef(null)
  const location = useLocation()
  const navType = useNavigationType()
  const [refresh, setRefresh] = useState(0)
  const positions = useRef(new Map()) // location.key -> scrollTop，用于后退时恢复位置
  const keyRef = useRef(location.key)
  keyRef.current = location.key // 渲染阶段更新：此后任何滚动事件都归属新页面
  const raf = useRef(0)

  // 进入页面：前进/新开页面回到顶部；后退时恢复位置（内容异步加载，故在内容撑够高度前持续重试）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    useUI.getState().closeMenu()
    el.scrollTop = 0
    useUI.getState().setScrolled(false)
    const target = navType === 'POP' ? positions.current.get(location.key) || 0 : 0
    if (!target) return
    const start = performance.now()
    let stop = false
    const cancel = () => { stop = true }
    el.addEventListener('wheel', cancel, { once: true, passive: true })
    el.addEventListener('pointerdown', cancel, { once: true })
    const tick = () => {
      if (stop) return
      if (el.scrollHeight - el.clientHeight >= target - 2) { el.scrollTop = target; return }
      if (performance.now() - start < 2000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  useEffect(() => {
    const h = () => setRefresh((n) => n + 1)
    window.addEventListener('fn:refresh', h)
    return () => window.removeEventListener('fn:refresh', h)
  }, [])

  const onScroll = (e) => {
    const el = e.currentTarget
    // 滚动过程中持续记录（不能等到离开页面时再读：那时新页面已渲染，scrollTop 已被截断）
    positions.current.set(keyRef.current, el.scrollTop)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => useUI.getState().setScrolled(el.scrollTop > 56))
  }

  return (
    <ScrollCtx.Provider value={scrollRef}>
      <main className="content" ref={scrollRef} onScroll={onScroll} tabIndex={-1}>
        <Routes key={refresh}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/recent" element={<Albums recent />} />
          <Route path="/albums" element={<Albums />} />
          <Route path="/artists" element={<Artists />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/genres" element={<Genres />} />
          <Route path="/genre/:id" element={<GenreDetail />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/album/:id" element={<AlbumDetail key={location.pathname} />} />
          <Route path="/artist/:id" element={<ArtistDetail key={location.pathname} />} />
          <Route path="/playlist/:id" element={<PlaylistDetail />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </ScrollCtx.Provider>
  )
}

function Shell() {
  useShortcuts()
  useDocumentTitle()
  const { w } = useViewport()
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const rail = w < RAIL_BREAKPOINT || collapsed
  useEffect(() => { useUI.setState({ rail }) }, [rail])
  useEffect(() => { restorePlayer() }, [])
  return (
    <div className={`app ${rail ? 'rail' : ''}`}>
      <Sidebar rail={rail} />
      <div className="main-col">
        <NavStrip canToggle={w >= RAIL_BREAKPOINT} />
        <div className="main-row">
          <Main />
          <SidePanel />
        </div>
      </div>
      <PlayerBar />
      <FullPlayer />
    </div>
  )
}

export default function App() {
  const status = useAuth((s) => s.status)
  const restore = useAuth((s) => s.restore)
  useThemeSync()

  useEffect(() => {
    restore()
    const lost = () => useAuth.setState({ status: 'out' })
    window.addEventListener('fn:auth-lost', lost)
    return () => window.removeEventListener('fn:auth-lost', lost)
  }, [restore])

  return (
    <HashRouter>
      <div className={`root platform-${window.fn?.platform}`}>
        {status === 'loading' && <div className="boot"><Spinner size={32} /></div>}
        {status === 'out' && <Login />}
        {status === 'in' && <Shell />}
        <ContextMenu />
        <Dialog />
        <Toast />
      </div>
    </HashRouter>
  )
}
