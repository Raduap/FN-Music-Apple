import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api, clearCache } from '../api'
import { useAuth, useUI } from '../store'
import * as Icon from '../icons'

export default function Sidebar() {
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

  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

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

  const userMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const theme = ui().theme
    ui().openMenu(r.left, r.top - 8, [
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
      { label: '刷新资料库', onClick: () => { clearCache(); ui().loadPlaylists(); window.dispatchEvent(new CustomEvent('fn:refresh')) } },
      '-',
      { label: '退出登录', icon: Icon.Logout, danger: true, onClick: () => ui().openDialog({ title: '退出登录？', message: '将清除本机保存的登录信息。', confirmText: '退出', danger: true, onConfirm: logout }) },
    ])
  }

  return (
    <nav className="sidebar">
      <div className="sb-drag" />
      <div className="sb-search">
        <Icon.Search size={15} />
        <input
          ref={inputRef}
          placeholder="搜索"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
            if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() }
          }}
        />
        {q && <button className="sb-clear" onClick={() => setQ('')}><Icon.Close size={12} /></button>}
      </div>

      <div className="sb-scroll">
        <Item to="/" icon={Icon.Home} end>主页</Item>
        <Item to="/genres" icon={Icon.Grid}>浏览</Item>

        <div className="sb-section">资料库</div>
        <Item to="/recent" icon={Icon.Clock}>最近添加</Item>
        <Item to="/artists" icon={Icon.Mic}>艺人</Item>
        <Item to="/albums" icon={Icon.AlbumIcon}>专辑</Item>
        <Item to="/songs" icon={Icon.Note}>歌曲</Item>
        <Item to="/genres" icon={Icon.Guitar} end={false} alias>流派</Item>

        <div className="sb-section with-action">
          <span>播放列表</span>
          <button
            className="icon-btn sb-add"
            title="新建播放列表"
            onClick={() => ui().openDialog({ title: '新建播放列表', input: true, placeholder: '播放列表名称', confirmText: '创建', onConfirm: (name) => ui().createPlaylist(name) })}
          >
            <Icon.Plus size={15} />
          </button>
        </div>
        <Item to="/favorites" icon={Icon.HeartFill} accent>喜欢的歌曲</Item>
        {playlists.map((pl) => (
          <Item key={pl.id} to={`/playlist/${pl.id}`} icon={Icon.ListIcon} onContextMenu={(e) => playlistMenu(e, pl)}>
            {pl.name}
          </Item>
        ))}
      </div>

      <button className="sb-user" onClick={userMenu}>
        <span className="sb-avatar">{(username || '?').slice(0, 1).toUpperCase()}</span>
        <span className="sb-user-name">{username}</span>
        <Icon.More size={16} />
      </button>
    </nav>
  )
}

function Item({ to, icon: Ic, children, end, accent, alias, onContextMenu }) {
  // “浏览”与“流派”都指向 /genres，仅让“浏览”高亮
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sb-item ${isActive && !alias ? 'active' : ''}`} onContextMenu={onContextMenu} draggable={false}>
      <Ic size={18} className={`sb-icon ${accent ? 'accent' : ''}`} />
      <span className="sb-label">{children}</span>
    </NavLink>
  )
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
      if (location.pathname === `/playlist/${pl.id}`) navigate('/')
      ui.showToast('已删除播放列表')
    },
  })
}
