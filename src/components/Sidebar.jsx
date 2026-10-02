import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api, clearCache } from '../api'
import { useAuth, useUI } from '../store'
import { SONG_DRAG_TYPE, songDrag } from './common'
import { resetCovers } from '../covers'
import * as Icon from '../icons'

export default function Sidebar({ rail }) {
  const navigate = useNavigate()
  const location = useLocation()
  const playlists = useUI((s) => s.playlists)
  const { username, server, logout } = useAuth()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const inputRef = useRef(null)
  const timer = useRef(0)

  // 输入即搜索（防抖）
  const onSearch = (v) => {
    setQ(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (v.trim()) navigate(`/search?q=${encodeURIComponent(v.trim())}`, { replace: location.pathname === '/search' })
    }, 280)
  }

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (location.pathname !== '/search') setQ('')
  }, [location.pathname])

  const ui = useUI.getState
  const playlistMenu = (e, pl) => {
    e.preventDefault()
    ui().openMenu(e.clientX, e.clientY, [
      { label: '重命名', icon: Icon.Edit, onClick: () => renamePlaylist(pl) },
      { label: '删除播放列表', icon: Icon.Trash, danger: true, onClick: () => deletePlaylist(pl, navigate, location) },
    ])
  }

  const userMenu = async (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const theme = ui().theme
    const motion = ui().motion
    const [tray, coverCache] = await Promise.all([window.fn.trayInfo?.().catch(() => null), window.fn.coverCacheStats?.().catch(() => null)])
    const setCloseToTray = (on) => window.fn.setPrefs({ closeToTray: on }).then(() => ui().showToast(on ? '关闭窗口后将停留在系统托盘' : '关闭窗口将退出应用'))
    ui().openMenu(rail ? r.right + 8 : r.left, rail ? r.bottom : r.top - 8, [
      { label: `${username} @ ${server.replace(/^https?:\/\//, '').replace(/\/music$/, '')}`, disabled: true },
      '-',
      {
        label: '外观',
        children: [
          { label: '跟随系统', checked: theme === 'system', onClick: () => ui().setTheme('system') },
          { label: '浅色', checked: theme === 'light', onClick: () => ui().setTheme('light') },
          { label: '深色', checked: theme === 'dark', onClick: () => ui().setTheme('dark') },
        ],
      },
      {
        label: '动画效果',
        children: [
          { label: '开启', checked: motion === 'on', onClick: () => ui().setMotion('on') },
          { label: '跟随系统', checked: motion === 'system', onClick: () => ui().setMotion('system') },
          { label: '关闭', checked: motion === 'off', onClick: () => ui().setMotion('off') },
        ],
      },
      tray?.available && {
        label: '关闭窗口时',
        children: [
          { label: '最小化到托盘', checked: tray.closeToTray, onClick: () => setCloseToTray(true) },
          { label: '退出应用', checked: !tray.closeToTray, onClick: () => setCloseToTray(false) },
        ],
      },
      { label: '刷新资料库', onClick: () => { clearCache(); ui().loadPlaylists(); window.dispatchEvent(new CustomEvent('fn:refresh')) } },
      coverCache && { label: `清除封面缓存（${fmtBytes(coverCache.bytes)}）`, disabled: !coverCache.count, onClick: clearCovers },
      { label: '关于飞牛音乐', onClick: showAbout },
      '-',
      { label: '退出登录', icon: Icon.Logout, danger: true, onClick: () => ui().openDialog({ title: '退出登录？', message: '将清除本机保存的登录信息。', confirmText: '退出', danger: true, onConfirm: logout }) },
    ])
  }

  const newPlaylist = () => ui().openDialog({ title: '新建播放列表', input: true, placeholder: '播放列表名称', confirmText: '创建', onConfirm: (name) => ui().createPlaylist(name) })

  return (
    <nav className="sidebar" aria-label="主导航">
      <div className="sb-drag" />
      {rail ? (
        <button className="sb-rail-search" title="搜索 (Ctrl+F)" aria-label="搜索" onClick={() => navigate('/search', { state: { focus: true } })}>
          <Icon.Search size={17} />
        </button>
      ) : (
        <div className="sb-search">
          <Icon.Search size={15} />
          <input
            ref={inputRef}
            data-search-input
            aria-label="搜索资料库"
            placeholder="搜索"
            value={q}
            spellCheck={false}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
              if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() }
            }}
          />
          {q && <button className="sb-clear" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="清除搜索"><Icon.Close size={11} /></button>}
        </div>
      )}

      <div className="sb-scroll">
        <Item to="/" icon={Icon.Home} end rail={rail}>主页</Item>

        {rail ? <div className="sb-divider" /> : <div className="sb-section">资料库</div>}
        <Item to="/recent" icon={Icon.Clock} rail={rail}>最近添加</Item>
        <Item to="/artists" icon={Icon.Mic} rail={rail}>艺人</Item>
        <Item to="/albums" icon={Icon.AlbumIcon} rail={rail}>专辑</Item>
        <Item to="/songs" icon={Icon.Note} rail={rail}>歌曲</Item>
        <Item to="/genres" icon={Icon.Guitar} rail={rail}>流派</Item>

        {rail ? (
          <div className="sb-divider" />
        ) : (
          <div className="sb-section with-action">
            <span>播放列表</span>
            <button className="icon-btn sb-add" title="新建播放列表" aria-label="新建播放列表" onClick={newPlaylist}>
              <Icon.Plus size={15} />
            </button>
          </div>
        )}
        <Item to="/favorites" icon={Icon.HeartFill} accent rail={rail} onDropSongs={(songs) => ui().favoriteSongs(songs)}>喜欢的歌曲</Item>
        {rail ? (
          <Item to="/playlists" icon={Icon.ListIcon} rail>全部播放列表</Item>
        ) : (
          playlists.map((pl) => (
            <Item key={pl.id} to={`/playlist/${pl.id}`} icon={Icon.ListIcon} onContextMenu={(e) => playlistMenu(e, pl)} onDropSongs={(songs) => ui().addToPlaylist(pl, songs)}>
              {pl.name}
            </Item>
          ))
        )}
        {!rail && !playlists.length && <div className="sb-empty">暂无播放列表</div>}
      </div>

      <button className="sb-user" onClick={userMenu} title={rail ? username : undefined} aria-label="账户菜单" aria-haspopup="menu">
        <span className="sb-avatar">{(username || '?').slice(0, 1).toUpperCase()}</span>
        {!rail && <span className="sb-user-name">{username}</span>}
        {!rail && <Icon.More size={16} />}
      </button>
    </nav>
  )
}

function Item({ to, icon: Ic, children, end, accent, rail, onContextMenu, onDropSongs }) {
  const [over, setOver] = useState(false)
  const accepts = (e) => !!onDropSongs && [...(e.dataTransfer?.types || [])].includes(SONG_DRAG_TYPE)
  return (
    <NavLink
      to={to}
      end={end}
      draggable={false}
      title={rail ? children : undefined}
      aria-label={rail ? children : undefined}
      className={({ isActive }) => `sb-item ${isActive ? 'active' : ''} ${over ? 'drop' : ''}`}
      onContextMenu={onContextMenu}
      onDragEnter={(e) => accepts(e) && (e.preventDefault(), setOver(true))}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={(e) => { if (accepts(e)) { e.preventDefault(); setOver(false); onDropSongs(songDrag.songs) } }}
    >
      <Ic size={18} className={`sb-icon ${accent ? 'accent' : ''}`} />
      {!rail && <span className="sb-label">{children}</span>}
    </NavLink>
  )
}

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

async function clearCovers() {
  await window.fn.clearCoverCache()
  resetCovers()
  window.dispatchEvent(new CustomEvent('fn:refresh'))
  useUI.getState().showToast('已清除封面缓存')
}

async function showAbout() {
  const info = await window.fn.appInfo().catch(() => ({}))
  useUI.getState().openDialog({
    title: '飞牛音乐',
    message: `版本 ${info.version || '未知'}\nElectron ${info.electron || '-'} · Chromium ${info.chrome || '-'}\n\n适用于 fnOS 飞牛音乐的 Apple Music 风格桌面客户端。`,
    confirmText: '好',
    alert: true,
  })
}

export function renamePlaylist(pl) {
  const ui = useUI.getState()
  ui.openDialog({
    title: '重命名播放列表',
    input: true,
    defaultValue: pl.name,
    confirmText: '保存',
    onConfirm: async (name) => {
      await api.renamePlaylist(pl.id, name)
      await ui.loadPlaylists()
      window.dispatchEvent(new CustomEvent('fn:playlist-changed', { detail: pl.id }))
    },
  })
}

export function deletePlaylist(pl, navigate, location) {
  const ui = useUI.getState()
  ui.openDialog({
    title: `删除“${pl.name}”？`,
    message: '此操作无法撤销，歌曲文件本身不会被删除。',
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      await api.deletePlaylist(pl.id)
      await ui.loadPlaylists()
      if (location.pathname === `/playlist/${pl.id}`) navigate('/playlists')
      ui.showToast('已删除播放列表')
    },
  })
}
