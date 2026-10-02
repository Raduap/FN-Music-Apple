import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync } from '../lib'
import { AlbumCard, ArtistCard, Shelf } from '../components/Cards'
import SongList from '../components/SongList'
import { Empty, ErrorBox, Loading, PageHeader, useFavoriteSync } from '../components/common'
import * as Icon from '../icons'

export default function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') || ''
  const [songs, setSongs] = useState([])
  const { data, loading, error } = useAsync(async () => {
    if (!q) return null
    const r = await api.search(q)
    setSongs(r.songs)
    return r
  }, [q])
  useFavoriteSync(setSongs)

  return (
    <div className="page">
      <PageHeader title={q ? `“${q}”的搜索结果` : '搜索'} />
      {!q && <Empty title="搜索你的资料库" sub="输入歌曲、专辑或艺人名称。" icon={Icon.Search} />}
      {q && loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !data.artists.length && !data.albums.length && !songs.length && <Empty title="没有结果" sub="试试其他关键词。" icon={Icon.Search} />}
      {data && (
        <>
          {data.artists.length > 0 && (
            <Shelf title="艺人">{data.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</Shelf>
          )}
          {data.albums.length > 0 && (
            <Shelf title="专辑">{data.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Shelf>
          )}
          {songs.length > 0 && (
            <section className="section">
              <div className="shelf-head"><h2 className="shelf-title">歌曲</h2></div>
              <SongList songs={songs} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
