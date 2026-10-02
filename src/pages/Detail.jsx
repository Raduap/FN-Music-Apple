import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { api } from '../api'
import { usePlayer, useUI } from '../store'
import { fmtTotal, useAsync } from '../lib'
import { AlbumCard, Shelf } from '../components/Cards'
import SongList from '../components/SongList'
import { Cover, Empty, ErrorBox, Loading, PlayButtons, useFavoriteSync, usePageTitle, useSongMenu } from '../components/common'
import { deletePlaylist, renamePlaylist } from '../components/Sidebar'
import * as Icon from '../icons'

const totalSec = (songs) => songs.reduce((t, s) => t + (s.duration || 0), 0)

export function AlbumDetail() {
  const { id } = useParams()
  const [songs, setSongs] = useState(null)
  const songMenu = useSongMenu()
  const { data: album, loading, error } = useAsync(async () => {
    const [album, list] = await Promise.all([api.album(id).catch(() => null), api.albumSongs(id)])
    const sorted = [...list].sort((a, b) => (a.discNo - b.discNo) || (a.trackNo - b.trackNo))
    setSongs(sorted)
    const s0 = sorted[0]
    return album?.id ? album : { id, name: s0?.album || '专辑', artist: s0?.artist || '', artistId: s0?.artistId, coverId: s0?.coverId, year: s0?.year }
  }, [id])
  useFavoriteSync(setSongs)
  usePageTitle(album?.name)

  if (loading && !album) return <div className="page"><Loading /></div>
  if (error) return <div className="page"><ErrorBox error={error} /></div>
  if (!album) return null
  const codecs = [...new Set((songs || []).map((s) => s.codec).filter(Boolean))]
  const lossless = codecs.some((c) => ['FLAC', 'ALAC', 'WAV', 'APE'].includes(c))

  return (
    <div className="page">
      <div className="detail-head">
        <Cover coverId={album.coverId} className="detail-art" />
        <div className="detail-info">
          <h1 className="detail-title">{album.name}</h1>
          <div className="detail-artist">
            {album.artistId ? <Link to={`/artist/${album.artistId}`}>{album.artist}</Link> : album.artist}
          </div>
          <div className="detail-meta">
            {[album.year || null, lossless ? '无损' : codecs[0]].filter(Boolean).join(' · ')}
          </div>
          <div className="detail-actions">
            <PlayButtons songs={songs} />
            <button
              className="icon-btn round-more"
              aria-label="更多"
              title="更多"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                useUI.getState().openMenu(r.left, r.bottom + 6, songMenu(songs || []).filter((x) => x && !String(x.label).startsWith('前往专辑') && !String(x.label).startsWith('已选择')))
              }}
            >
              <Icon.More size={18} />
            </button>
          </div>
        </div>
      </div>
      {songs && songs.length > 0 ? (
        <>
          <SongList songs={songs} variant="album" albumArtist={album.artist} />
          <div className="detail-foot">{songs.length} 首歌曲，{fmtTotal(totalSec(songs))}</div>
        </>
      ) : (
        <Empty title="这张专辑没有歌曲" />
      )}
    </div>
  )
}

export function ArtistDetail() {
  const { id } = useParams()
  const [songs, setSongs] = useState(null)
  const { data, loading, error } = useAsync(async () => {
    const [albums, top, artists] = await Promise.all([api.artistAlbums(id), api.artistSongs(id, 300), api.artists().catch(() => [])])
    setSongs(top)
    const artist = artists.find((a) => a.id === id) || { id, name: top[0]?.artist || albums[0]?.artist || '艺人', coverId: albums[0]?.coverId }
    albums.sort((a, b) => (b.year || 0) - (a.year || 0))
    return { artist, albums }
  }, [id])
  useFavoriteSync(setSongs)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [id])
  usePageTitle(data?.artist?.name)

  if (loading && !data) return <div className="page"><Loading /></div>
  if (error) return <div className="page"><ErrorBox error={error} /></div>
  if (!data) return null
  const { artist, albums } = data
  const coverId = artist.coverId || albums[0]?.coverId

  return (
    <div className="page artist-page">
      <div className="artist-hero">
        <div className="artist-hero-bg"><Cover coverId={coverId} px={160} /></div>
        <div className="artist-hero-inner">
          <Cover coverId={coverId} round icon="person" className="artist-avatar" />
          <div>
            <h1 className="artist-name">{artist.name}</h1>
            <div className="detail-meta light">{albums.length} 张专辑 · {songs?.length || 0} 首歌曲</div>
            <PlayButtons songs={songs} />
          </div>
        </div>
      </div>
      {songs && songs.length > 0 && (
        <section className="section">
          <div className="shelf-head">
            <h2 className="shelf-title">歌曲</h2>
            {songs.length > 10 && <button className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? '收起' : `全部 ${songs.length} 首`}</button>}
          </div>
          <SongList songs={showAll ? songs : songs.slice(0, 10)} />
        </section>
      )}
      {albums.length > 0 && (
        <Shelf title="专辑">
          {albums.map((a) => <AlbumCard key={a.id} album={a} sub={a.year ? String(a.year) : ''} />)}
        </Shelf>
      )}
    </div>
  )
}

export function PlaylistDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const playlists = useUI((s) => s.playlists)
  const pl = playlists.find((p) => p.id === id)
  const [songs, setSongs] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api.playlistSongs(id).then((s) => { setSongs(s); setError(null) }).catch(setError)

  useEffect(() => { setSongs(null); load() }, [id])
  useEffect(() => {
    const h = (e) => e.detail === id && load()
    window.addEventListener('fn:playlist-changed', h)
    return () => window.removeEventListener('fn:playlist-changed', h)
  }, [id])
  useFavoriteSync(setSongs)
  usePageTitle(pl?.name)

  const remove = async (list) => {
    const ids = new Set(list.map((x) => x.id))
    try {
      await api.removeFromPlaylist(id, [...ids])
      setSongs((s) => s.filter((x) => !ids.has(x.id)))
      useUI.getState().loadPlaylists()
    } catch (e) {
      useUI.getState().showToast('移除失败：' + e.message)
    }
  }

  const coverId = songs?.find((x) => x.coverId)?.coverId
  const covers = [...new Set((songs || []).map((s) => s.coverId).filter(Boolean))].slice(0, 4)

  return (
    <div className="page">
      <div className="detail-head">
        {covers.length >= 4 ? (
          <div className="detail-art mosaic">{covers.map((c) => <Cover key={c} coverId={c} />)}</div>
        ) : (
          <Cover coverId={coverId} className="detail-art" />
        )}
        <div className="detail-info">
          <div className="detail-kind">播放列表</div>
          <h1 className="detail-title">{pl?.name || '播放列表'}</h1>
          <div className="detail-meta">{songs ? `${songs.length} 首歌曲${songs.length ? ` · ${fmtTotal(totalSec(songs))}` : ''}` : ' '}</div>
          <div className="detail-actions">
            <PlayButtons songs={songs} />
            {pl && (
              <button
                className="icon-btn round-more"
                aria-label="更多"
                title="更多"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  useUI.getState().openMenu(r.left, r.bottom + 6, [
                    { label: '播放下一首', icon: Icon.PlayNext, disabled: !songs?.length, onClick: () => usePlayer.getState().playNext(songs) },
                    { label: '稍后播放', icon: Icon.PlayLater, disabled: !songs?.length, onClick: () => usePlayer.getState().addToQueue(songs) },
                    '-',
                    { label: '重命名', icon: Icon.Edit, onClick: () => renamePlaylist(pl) },
                    { label: '删除播放列表', icon: Icon.Trash, danger: true, onClick: () => deletePlaylist(pl, navigate, location) },
                  ])
                }}
              >
                <Icon.More size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      {!songs && !error && <Loading />}
      {error && <ErrorBox error={error} onRetry={load} />}
      {songs && !songs.length && <Empty title="这个播放列表是空的" sub="在任意歌曲上点按右键，选择“添加到播放列表”。" icon={Icon.ListIcon} />}
      {songs && songs.length > 0 && (
        <SongList songs={songs} extraMenu={(picked) => [{ label: '从播放列表中移除', icon: Icon.Trash, danger: true, onClick: () => remove(picked) }]} />
      )}
    </div>
  )
}
