import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { usePlayer, useUI } from '../store'
import { Cover } from './common'
import * as Icon from '../icons'

async function playAlbum(id, shuffle = false) {
  try {
    const songs = await api.albumSongs(id)
    if (!songs.length) return useUI.getState().showToast('这张专辑没有歌曲')
    usePlayer.getState().play(songs, 0, { shuffle })
  } catch (e) {
    useUI.getState().showToast('播放失败：' + e.message)
  }
}

// 卡片可用键盘操作：Tab 聚焦，Enter 打开，Shift+F10 / 菜单键打开菜单
const cardKeys = (open, menu) => (e) => {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter') { e.preventDefault(); open() }
  else if (menu && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    menu({ preventDefault() {}, stopPropagation() {}, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })
  }
}

export function AlbumCard({ album, sub, index = 0 }) {
  const navigate = useNavigate()
  const onMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX: x, clientY: y } = e
    const ui = useUI.getState()
    const lazy = async (fn) => {
      try { fn(await api.albumSongs(album.id)) } catch (err) { ui.showToast('操作失败：' + err.message) }
    }
    ui.openMenu(x, y, [
      { label: '播放', icon: Icon.Play, onClick: () => playAlbum(album.id) },
      { label: '随机播放', icon: Icon.Shuffle, onClick: () => playAlbum(album.id, true) },
      '-',
      { label: '播放下一首', icon: Icon.PlayNext, onClick: () => lazy((s) => usePlayer.getState().playNext(s)) },
      { label: '稍后播放', icon: Icon.PlayLater, onClick: () => lazy((s) => usePlayer.getState().addToQueue(s)) },
      {
        label: '添加到播放列表',
        children: [
          {
            label: '新建播放列表…', icon: Icon.Plus,
            onClick: () => ui.openDialog({ title: '新建播放列表', input: true, defaultValue: album.name, confirmText: '创建', onConfirm: async (name) => ui.createPlaylist(name, await api.albumSongs(album.id)) }),
          },
          ui.playlists.length ? '-' : null,
          ...ui.playlists.map((pl) => ({ label: pl.name, onClick: () => lazy((s) => ui.addToPlaylist(pl, s)) })),
        ],
      },
      album.artistId && '-',
      album.artistId && { label: '前往艺人', icon: Icon.Mic, onClick: () => navigate(`/artist/${album.artistId}`) },
    ])
  }
  const open = () => navigate(`/album/${album.id}`)
  return (
    <div className="card" style={{ '--i': index }} role="link" tabIndex={0} aria-label={`${album.name}，${album.artist}`} onClick={open} onKeyDown={cardKeys(open, onMenu)} onContextMenu={onMenu}>
      <div className="card-art">
        <Cover coverId={album.coverId} alt="" />
        <div className="card-hover">
          <button className="card-play" tabIndex={-1} title="播放" aria-label={`播放 ${album.name}`} onClick={(e) => { e.stopPropagation(); playAlbum(album.id) }}>
            <Icon.Play size={16} />
          </button>
          <button className="card-more" tabIndex={-1} title="更多" aria-label="更多" onClick={onMenu}>
            <Icon.More size={16} />
          </button>
        </div>
      </div>
      <div className="card-title" title={album.name}>{album.name}</div>
      <div className="card-sub">
        {sub ?? (album.artistId ? (
          <Link to={`/artist/${album.artistId}`} tabIndex={-1} onClick={(e) => e.stopPropagation()}>{album.artist}</Link>
        ) : album.artist)}
      </div>
    </div>
  )
}

export function ArtistCard({ artist, index = 0 }) {
  const navigate = useNavigate()
  const open = () => navigate(`/artist/${artist.id}`)
  return (
    <div className="card artist-card" style={{ '--i': index }} role="link" tabIndex={0} aria-label={artist.name} onClick={open} onKeyDown={cardKeys(open)}>
      <div className="card-art round">
        <Cover coverId={artist.coverId} round icon="person" alt="" />
      </div>
      <div className="card-title center" title={artist.name}>{artist.name}</div>
    </div>
  )
}

export function PlaylistCard({ playlist, index = 0 }) {
  const navigate = useNavigate()
  const [coverId, setCoverId] = useState(playlist.coverId)
  useEffect(() => {
    let dead = false
    setCoverId(playlist.coverId)
    if (!playlist.coverId) api.playlistCover(playlist.id).then((c) => !dead && setCoverId(c)).catch(() => {})
    return () => { dead = true }
  }, [playlist.id, playlist.coverId])
  const open = () => navigate(`/playlist/${playlist.id}`)
  return (
    <div className="card" style={{ '--i': index }} role="link" tabIndex={0} aria-label={`${playlist.name}，${playlist.trackCount} 首歌曲`} onClick={open} onKeyDown={cardKeys(open)}>
      <div className="card-art">
        <Cover coverId={coverId} icon="note" />
        <div className="card-hover">
          <button
            className="card-play"
            tabIndex={-1}
            title="播放"
            aria-label={`播放 ${playlist.name}`}
            onClick={async (e) => {
              e.stopPropagation()
              try {
                const s = await api.playlistSongs(playlist.id)
                if (s.length) usePlayer.getState().play(s, 0, { shuffle: false })
                else useUI.getState().showToast('这个播放列表是空的')
              } catch (err) { useUI.getState().showToast('播放失败：' + err.message) }
            }}
          >
            <Icon.Play size={16} />
          </button>
        </div>
      </div>
      <div className="card-title" title={playlist.name}>{playlist.name}</div>
      <div className="card-sub">{playlist.trackCount} 首歌曲</div>
    </div>
  )
}

// 横向滚动货架（带左右翻页按钮；内容不足一屏时自动隐藏按钮）
export function Shelf({ title, to, children }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: true, r: true })
  const update = () => {
    const el = ref.current
    if (!el) return
    setEdge({ l: el.scrollLeft < 4, r: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }
  useEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [children])
  const page = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        {to ? <Link to={to} className="shelf-title link">{title}<Icon.ChevronRight size={18} /></Link> : <h2 className="shelf-title">{title}</h2>}
        <div className="shelf-pager">
          <button className="icon-btn" disabled={edge.l} onClick={() => page(-1)} aria-label="向左翻页" tabIndex={-1}><Icon.ChevronLeft size={18} /></button>
          <button className="icon-btn" disabled={edge.r} onClick={() => page(1)} aria-label="向右翻页" tabIndex={-1}><Icon.ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="shelf-row" ref={ref} onScroll={update}>{children}</div>
    </section>
  )
}
