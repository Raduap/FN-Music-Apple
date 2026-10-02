import { useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth, usePlayer, useUI, restorePlayer } from './store'
import Sidebar from './components/Sidebar'
import { TopBar, SidePanel, FullPlayer } from './components/Player'
import { ContextMenu, Dialog, ScrollCtx, Spinner, Toast } from './components/common'
import Login from './pages/Login'
import Home from './pages/Home'
import Search from './pages/Search'
import { Albums, Artists, Favorites, GenreDetail, Genres, Songs } from './pages/Library'
import { AlbumDetail, ArtistDetail, PlaylistDetail } from './pages/Detail'

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

// 全局快捷键
function useShortcuts() {
  useEffect(() => {
    const k = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const p = usePlayer.getState()
      if (e.code === 'Space') { e.preventDefault(); p.toggle() }
      else if (e.ctrlKey && e.key === 'ArrowRight') p.next()
      else if (e.ctrlKey && e.key === 'ArrowLeft') p.prev()
      else if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); p.setVolume(p.volume + 0.05) }
      else if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); p.setVolume(p.volume - 0.05) }
      else if (e.ctrlKey && e.key.toLowerCase() === 'l') useUI.getState().togglePanel('lyrics')
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
}

function Main() {
  const scrollRef = useRef(null)
  const location = useLocation()
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
    useUI.getState().closeMenu()
  }, [location.pathname, location.search])
  useEffect(() => {
    const h = () => setRefresh((n) => n + 1)
    window.addEventListener('fn:refresh', h)
    return () => window.removeEventListener('fn:refresh', h)
  }, [])

  return (
    <ScrollCtx.Provider value={scrollRef}>
      <main className="content" ref={scrollRef}>
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
          <Route path="/album/:id" element={<AlbumDetail key={location.pathname} />} />
          <Route path="/artist/:id" element={<ArtistDetail key={location.pathname} />} />
          <Route path="/playlist/:id" element={<PlaylistDetail />} />
        </Routes>
      </main>
    </ScrollCtx.Provider>
  )
}

function Shell() {
  useShortcuts()
  useEffect(() => { restorePlayer() }, [])
  return (
    <div className="app">
      <Sidebar />
      <div className="main-col">
        <TopBar />
        <div className="main-row">
          <Main />
          <SidePanel />
        </div>
      </div>
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
