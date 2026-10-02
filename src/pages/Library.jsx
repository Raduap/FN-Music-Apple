import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAsync } from '../lib'
import { AlbumCard, ArtistCard } from '../components/Cards'
import SongList from '../components/SongList'
import { Empty, ErrorBox, Loading, PageHeader, PlayButtons, useFavoriteSync } from '../components/common'
import * as Icon from '../icons'

// 渐进加载全部分页
function useProgressive(loader, deps) {
  const [state, setState] = useState({ items: null, total: 0, done: false, error: null })
  useEffect(() => {
    let dead = false
    setState({ items: null, total: 0, done: false, error: null })
    loader((items, total) => !dead && setState({ items, total, done: false, error: null }))
      .then((items) => !dead && setState((s) => ({ ...s, items, done: true })))
      .catch((error) => !dead && setState((s) => ({ ...s, error, done: true })))
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [state, (fn) => setState((s) => ({ ...s, items: fn(s.items) }))]
}

const coll = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function Albums({ recent = false }) {
  const [sort, setSort] = useState(recent ? 'newTrackAddedAt,desc' : 'name,asc')
  const [{ items, error, done, total }] = useProgressive((onPage) => (recent ? api.albumsPage(120, sort) : api.albums(sort, onPage)), [sort, recent])
  const [byArtist, setByArtist] = useState(false)
  const list = useMemo(() => (items && byArtist ? [...items].sort((a, b) => coll.compare(a.artist, b.artist)) : items), [items, byArtist])

  return (
    <div className="page">
      <PageHeader title={recent ? '最近添加' : '专辑'}>
        {!recent && (
          <div className="seg small">
            <button className={sort === 'name,asc' && !byArtist ? 'on' : ''} onClick={() => { setSort('name,asc'); setByArtist(false) }}>标题</button>
            <button className={byArtist ? 'on' : ''} onClick={() => { setSort('name,asc'); setByArtist(true) }}>艺人</button>
            <button className={sort === 'newTrackAddedAt,desc' ? 'on' : ''} onClick={() => { setSort('newTrackAddedAt,desc'); setByArtist(false) }}>最近添加</button>
          </div>
        )}
      </PageHeader>
      {!list && !error && <Loading />}
      {error && <ErrorBox error={error} />}
      {list && !list.length && done && <Empty title="还没有专辑" sub="在飞牛音乐中添加音乐文件夹后，专辑会显示在这里。" icon={Icon.AlbumIcon} />}
      {list && list.length > 0 && (
        <>
          {!recent && <div className="count-line">{total || list.length} 张专辑{!done && ' · 正在载入…'}</div>}
          <div className="grid">{list.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
        </>
      )}
    </div>
  )
}

export function Artists() {
  const { data, loading, error } = useAsync(() => api.artists(), [])
  const [filter, setFilter] = useState('')
  const list = useMemo(() => {
    if (!data) return null
    const f = filter.trim().toLowerCase()
    return [...data].filter((a) => !f || a.name.toLowerCase().includes(f)).sort((a, b) => coll.compare(a.name, b.name))
  }, [data, filter])
  return (
    <div className="page">
      <PageHeader title="艺人">
        <div className="filter-input">
          <Icon.Search size={14} />
          <input placeholder="筛选" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </PageHeader>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {list && !list.length && <Empty title={filter ? '没有匹配的艺人' : '还没有艺人'} icon={Icon.Mic} />}
      {list && list.length > 0 && <div className="grid artists">{list.map((a) => <ArtistCard key={a.id} artist={a} />)}</div>}
    </div>
  )
}

export function Songs() {
  const [{ items, error, done, total }, update] = useProgressive((onPage) => api.songs(onPage), [])
  useFavoriteSync(update)
  return (
    <div className="page">
      <PageHeader title="歌曲">
        <PlayButtons songs={items} disabled={!done} />
      </PageHeader>
      {!items && !error && <Loading />}
      {error && <ErrorBox error={error} />}
      {items && !items.length && done && <Empty title="还没有歌曲" />}
      {items && items.length > 0 && (
        <>
          <div className="count-line">{total || items.length} 首歌曲{!done && ` · 已载入 ${items.length}`}</div>
          <SongList songs={items} sortable />
        </>
      )}
    </div>
  )
}

export function Favorites() {
  const [state, setState] = useState({ items: null, error: null })
  const load = () => api.favorites().then((items) => setState({ items, error: null })).catch((error) => setState({ items: null, error }))
  useEffect(() => { load() }, [])
  // 取消喜欢后从列表移除；新增喜欢则重新拉取
  useEffect(() => {
    const h = (e) => (e.detail.favorite ? setTimeout(load, 400) : setState((s) => ({ ...s, items: s.items?.filter((x) => x.id !== e.detail.id) })))
    window.addEventListener('fn:favorite-changed', h)
    return () => window.removeEventListener('fn:favorite-changed', h)
  }, [])
  const { items, error } = state
  return (
    <div className="page">
      <div className="detail-head">
        <div className="detail-art fav-art"><Icon.HeartFill size={96} /></div>
        <div className="detail-info">
          <div className="detail-kind">播放列表</div>
          <h1 className="detail-title">喜欢的歌曲</h1>
          <div className="detail-meta">{items ? `${items.length} 首歌曲` : ''}</div>
          <PlayButtons songs={items} />
        </div>
      </div>
      {!items && !error && <Loading />}
      {error && <ErrorBox error={error} onRetry={load} />}
      {items && !items.length && <Empty title="还没有喜欢的歌曲" sub="点按歌曲旁的 ♡ 即可添加到这里。" icon={Icon.Heart} />}
      {items && items.length > 0 && <SongList songs={items} sortable />}
    </div>
  )
}

const GENRE_HUES = [350, 20, 40, 160, 200, 230, 260, 290, 320, 180, 100, 0]
export function Genres() {
  const { data, loading, error } = useAsync(() => api.genres(), [])
  const navigate = useNavigate()
  return (
    <div className="page">
      <PageHeader title="浏览" />
      <h2 className="sub-title">流派</h2>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !data.length && <Empty title="暂无流派信息" icon={Icon.Guitar} />}
      {data && data.length > 0 && (
        <div className="genre-grid">
          {data.map((g, i) => {
            const h = GENRE_HUES[i % GENRE_HUES.length]
            return (
              <button
                key={g.id + i}
                className="genre-tile"
                style={{ background: `linear-gradient(135deg, hsl(${h} 75% 58%), hsl(${(h + 35) % 360} 70% 42%))` }}
                onClick={() => navigate(`/genre/${encodeURIComponent(g.id)}?name=${encodeURIComponent(g.name)}`)}
              >
                <span className="gt-name">{g.name || '未知'}</span>
                <span className="gt-count">{g.trackCount} 首</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function GenreDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const name = params.get('name') || id
  const [songs, setSongs] = useState(null)
  const { error, loading } = useAsync(() => api.genreSongs(id, name).then(setSongs), [id])
  useFavoriteSync(setSongs)
  return (
    <div className="page">
      <PageHeader title={name}>
        <PlayButtons songs={songs} />
      </PageHeader>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {songs && !songs.length && <Empty title="该流派下没有歌曲" />}
      {songs && songs.length > 0 && <SongList songs={songs} sortable />}
    </div>
  )
}
