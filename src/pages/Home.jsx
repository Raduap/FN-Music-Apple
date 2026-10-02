import { api } from '../api'
import { useUI } from '../store'
import { pickRandom, useAsync } from '../lib'
import { AlbumCard, ArtistCard, PlaylistCard, Shelf } from '../components/Cards'
import { ErrorBox, Loading, PageHeader } from '../components/common'

export default function Home() {
  const playlists = useUI((s) => s.playlists)
  const { data, loading, error } = useAsync(async () => {
    const [recent, pool, artists] = await Promise.all([
      api.albumsPage(24, 'newTrackAddedAt,desc'),
      api.albumsPage(200, 'name,asc'),
      api.artists().catch(() => []),
    ])
    return { recent, picks: pickRandom(pool, 18), artists: pickRandom(artists, 16) }
  }, [])

  const hour = new Date().getHours()
  const greet = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="page">
      <PageHeader title="主页" />
      <div className="greet">{greet}，来点音乐吧。</div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          {data.recent.length > 0 && (
            <Shelf title="最近添加" to="/recent">
              {data.recent.map((a, i) => <AlbumCard key={a.id} index={i} album={a} />)}
            </Shelf>
          )}
          {data.picks.length > 0 && (
            <Shelf title="为你推荐" to="/albums">
              {data.picks.map((a, i) => <AlbumCard key={a.id} index={i} album={a} />)}
            </Shelf>
          )}
          {playlists.length > 0 && (
            <Shelf title="我的播放列表">
              {playlists.map((p, i) => <PlaylistCard key={p.id} index={i} playlist={p} />)}
            </Shelf>
          )}
          {data.artists.length > 0 && (
            <Shelf title="艺人" to="/artists">
              {data.artists.map((a, i) => <ArtistCard key={a.id} index={i} artist={a} />)}
            </Shelf>
          )}
        </>
      )}
    </div>
  )
}
