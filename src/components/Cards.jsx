import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { usePlayer, useUI } from '../store'
import { Cover, useSongMenu } from './common'
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

export function AlbumCard({ album, sub }) {
  const navigate = useNavigate()
  const songMenu = useSongMenu()
  const onMenu = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX: x, clientY: y } = e
    const ui = useUI.getState()
    const lazy = async (fn) => { const s = await api.albumSongs(album.id); fn(s) }
    // 专辑菜单：前几项直接执行，添加到歌单需要先取歌曲
    const base = songMenu([{ id: '', albumId: album.id, artistId: album.artistId }])
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
      '-',
      ...base.filter((it) => it && it.label === '前往艺人'),
    ])
  }
  return (
    <div className="card" onClick={() => navigate(`/album/${album.id}`)} onContextMenu={onMenu}>
      <div className="card-art">
        <Cover coverId={album.coverId} alt={album.name} />
        <div className="card-hover">
          <button className="card-play" title="播放" onClick={(e) => { e.stopPropagation(); playAlbum(album.id) }}>
            <Icon.Play size={18} />
          </button>
          <button className="card-more" title="更多" onClick={onMenu}>
            <Icon.More size={16} />
          </button>
        </div>
      </div>
      <div className="card-title" title={album.name}>{album.name}</div>
      <div className="card-sub">
        {sub ?? (album.artistId ? (
          <Link to={`/artist/${album.artistId}`} onClick={(e) => e.stopPropagation()}>{album.artist}</Link>
        ) : album.artist)}
      </div>
    </div>
  )
}

export function ArtistCard({ artist }) {
  const navigate = useNavigate()
  return (
    <div className="card artist-card" onClick={() => navigate(`/artist/${artist.id}`)}>
      <div className="card-art round">
        <Cover coverId={artist.coverId} round icon="person" alt={artist.name} />
      </div>
      <div className="card-title center" title={artist.name}>{artist.name}</div>
    </div>
  )
}

export function PlaylistCard({ playlist }) {
  const navigate = useNavigate()
  const [coverId, setCoverId] = useState(playlist.coverId)
  useEffect(() => {
    let dead = false
    if (!playlist.coverId) api.playlistCover(playlist.id).then((c) => !dead && setCoverId(c)).catch(() => {})
    return () => { dead = true }
  }, [playlist.id, playlist.coverId])
  return (
    <div className="card" onClick={() => navigate(`/playlist/${playlist.id}`)}>
      <div className="card-art">
        <Cover coverId={coverId} icon="note" />
        <div className="card-hover">
          <button
            className="card-play"
            title="播放"
            onClick={async (e) => {
              e.stopPropagation()
              const s = await api.playlistSongs(playlist.id)
              if (s.length) usePlayer.getState().play(s, 0, { shuffle: false })
            }}
          >
            <Icon.Play size={18} />
          </button>
        </div>
      </div>
      <div className="card-title">{playlist.name}</div>
      <div className="card-sub">{playlist.trackCount} 首歌曲</div>
    </div>
  )
}

// 横向滚动货架（带左右翻页按钮）
export function Shelf({ title, to, children }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: true, r: false })
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
  const page = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: 'smooth' })
  return (
    <section className="shelf">
      <div className="shelf-head">
        {to ? <Link to={to} className="shelf-title link">{title}<Icon.ChevronRight size={18} /></Link> : <h2 className="shelf-title">{title}</h2>}
      </div>
      <div className="shelf-wrap">
        <button className={`shelf-nav left ${edge.l ? 'hide' : ''}`} onClick={() => page(-1)}><Icon.ChevronLeft size={22} /></button>
        <div className="shelf-row" ref={ref} onScroll={update}>{children}</div>
        <button className={`shelf-nav right ${edge.r ? 'hide' : ''}`} onClick={() => page(1)}><Icon.ChevronRight size={22} /></button>
      </div>
    </section>
  )
}
