import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useUI } from '../store'
import { useAsync } from '../lib'
import { AlbumCard, ArtistCard, Shelf } from '../components/Cards'
import SongList from '../components/SongList'
import { Empty, ErrorBox, Loading, PageHeader, useFavoriteSync } from '../components/common'
import * as Icon from '../icons'

export default function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') || ''
  const rail = useUI((s) => s.rail)
  const location = useLocation()
  const navigate = useNavigate()
  const [songs, setSongs] = useState([])
  const [text, setText] = useState(q)
  const inputRef = useRef(null)
  const timer = useRef(0)

  const { data, loading, error } = useAsync(async () => {
    if (!q) return null
    const r = await api.search(q)
    setSongs(r.songs)
    return r
  }, [q])
  useFavoriteSync(setSongs)

  // 侧边栏收成图标栏时没有搜索框，页面内自带一个
  useEffect(() => { setText(q) }, [q])
  useEffect(() => { if (rail && (location.state?.focus || !q)) inputRef.current?.focus() }, [rail, location.state, q])
  useEffect(() => () => clearTimeout(timer.current), [])
  const onChange = (v) => {
    setText(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => v.trim() && navigate(`/search?q=${encodeURIComponent(v.trim())}`, { replace: true }), 280)
  }

  const none = data && !data.artists.length && !data.albums.length && !songs.length
  return (
    <div className="page">
      <PageHeader title={q ? `“${q}”的搜索结果` : '搜索'} />
      {rail && (
        <div className="search-box">
          <Icon.Search size={16} />
          <input ref={inputRef} data-search-input aria-label="搜索资料库" placeholder="搜索歌曲、专辑或艺人" value={text} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
          {text && <button className="sb-clear" onClick={() => { setText(''); inputRef.current?.focus() }} aria-label="清除搜索"><Icon.Close size={11} /></button>}
        </div>
      )}
      {!q && <Empty title="搜索你的资料库" sub="输入歌曲、专辑或艺人名称。" icon={Icon.Search} />}
      {q && loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {none && <Empty title="没有结果" sub={`没有找到与“${q}”相关的内容，试试其他关键词。`} icon={Icon.Search} />}
      {data && !none && (
        <>
          {data.artists.length > 0 && (
            <Shelf title="艺人">{data.artists.map((a, i) => <ArtistCard key={a.id} index={i} artist={a} />)}</Shelf>
          )}
          {data.albums.length > 0 && (
            <Shelf title="专辑">{data.albums.map((a, i) => <AlbumCard key={a.id} index={i} album={a} />)}</Shelf>
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
