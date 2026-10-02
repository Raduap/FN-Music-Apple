import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { favoritesSettled, useUI } from '../store'
import { useAsync } from '../lib'
import { AlbumCard, ArtistCard, PlaylistCard } from '../components/Cards'
import SongList from '../components/SongList'
import { Empty, ErrorBox, Loading, PageHeader, PlayButtons, Seg, useFavoriteSync, usePageTitle } from '../components/common'
import * as Icon from '../icons'

// 渐进加载全部分页
function useProgressive(loader, deps) {
  const [state, setState] = useState({ items: null, total: 0, done: false, error: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let dead = false
    setState({ items: null, total: 0, done: false, error: null })
    loader((items, total) => !dead && setState({ items, total, done: false, error: null }))
      .then((items) => !dead && setState((s) => ({ ...s, items, done: true })))
      .catch((error) => !dead && setState((s) => ({ ...s, error, done: true })))
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return [state, (fn) => setState((s) => ({ ...s, items: fn(s.items) })), () => setNonce((n) => n + 1)]
}

const coll = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function Albums({ recent = false }) {
  const [sort, setSort] = useState(recent ? 'newTrackAddedAt,desc' : 'name,asc')
  const [{ items, error, done, total }, , retry] = useProgressive((onPage) => (recent ? api.albumsPage(120, sort) : api.albums(sort, onPage)), [sort, recent])
  const [byArtist, setByArtist] = useState(false)
  const list = useMemo(() => (items && byArtist ? [...items].sort((a, b) => coll.compare(a.artist, b.artist)) : items), [items, byArtist])
  const mode = byArtist ? 'artist' : sort === 'newTrackAddedAt,desc' ? 'recent' : 'title'
  const pick = (m) => {
    setByArtist(m === 'artist')
    setSort(m === 'recent' ? 'newTrackAddedAt,desc' : 'name,asc')
  }

  return (
    <div className="page">
      <PageHeader title={recent ? '最近添加' : '专辑'}>
        {!recent && (
          <Seg small label="排序方式" value={mode} onChange={pick} options={[{ value: 'title', label: '标题' }, { value: 'artist', label: '艺人' }, { value: 'recent', label: '最近添加' }]} />
        )}
      </PageHeader>
      {!list && !error && <Loading />}
      {error && <ErrorBox error={error} onRetry={retry} />}
      {list && !list.length && done && <Empty title="还没有专辑" sub="在飞牛音乐中添加音乐文件夹后，专辑会显示在这里。" icon={Icon.AlbumIcon} />}
      {list && list.length > 0 && (
        <>
          {!recent && <div className="count-line">{total || list.length} 张专辑{!done && ' · 正在载入…'}</div>}
          <div className="grid">{list.map((a, i) => <AlbumCard key={a.id} index={i} album={a} />)}</div>
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
          <input aria-label="筛选艺人" placeholder="筛选" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} spellCheck={false} />
          {filter && <button className="sb-clear" onClick={() => setFilter('')} aria-label="清除筛选"><Icon.Close size={11} /></button>}
        </div>
      </PageHeader>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {list && !list.length && <Empty title={filter ? '没有匹配的艺人' : '还没有艺人'} sub={filter ? '换个关键词试试。' : undefined} icon={Icon.Mic} />}
      {list && list.length > 0 && <div className="grid artists">{list.map((a, i) => <ArtistCard key={a.id} index={i} artist={a} />)}</div>}
    </div>
  )
}

export function Songs() {
  const [{ items, error, done, total }, update, retry] = useProgressive((onPage) => api.songs(onPage), [])
  useFavoriteSync(update)
  return (
    <div className="page">
      <PageHeader title="歌曲">
        <PlayButtons songs={items} disabled={!done} />
      </PageHeader>
      {!items && !error && <Loading />}
      {error && <ErrorBox error={error} onRetry={retry} />}
      {items && !items.length && done && <Empty title="还没有歌曲" sub="在飞牛音乐中添加音乐文件夹后，歌曲会显示在这里。" />}
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
  usePageTitle('喜欢的歌曲')
  const [state, setState] = useState({ items: null, error: null })
  // 先等进行中的“喜欢”请求写入服务器，再读取列表
  const load = () => favoritesSettled().then(() => api.favorites()).then((items) => setState({ items, error: null })).catch((error) => setState({ items: null, error }))
  useEffect(() => { load() }, [])
  // 取消喜欢后从列表移除；新增喜欢则重新拉取
  useEffect(() => {
    const h = (e) => (e.detail.favorite ? load() : setState((s) => ({ ...s, items: s.items?.filter((x) => x.id !== e.detail.id) })))
    window.addEventListener('fn:favorite-changed', h)
    return () => window.removeEventListener('fn:favorite-changed', h)
  }, [])
  const { items, error } = state
  return (
    <div className="page">
      <div className="detail-head">
        <div className="detail-art fav-art"><Icon.HeartFill size={88} /></div>
        <div className="detail-info">
          <div className="detail-kind">播放列表</div>
          <h1 className="detail-title">喜欢的歌曲</h1>
          <div className="detail-meta">{items ? `${items.length} 首歌曲` : ' '}</div>
          <PlayButtons songs={items} />
        </div>
      </div>
      {!items && !error && <Loading />}
      {error && <ErrorBox error={error} onRetry={load} />}
      {items && !items.length && <Empty title="还没有喜欢的歌曲" sub="点按歌曲旁的 ♡ 即可添加到这里，也可以把歌曲拖到侧边栏的“喜欢的歌曲”。" icon={Icon.Heart} />}
      {items && items.length > 0 && <SongList songs={items} sortable />}
    </div>
  )
}

export function Playlists() {
  const playlists = useUI((s) => s.playlists)
  const create = () => useUI.getState().openDialog({ title: '新建播放列表', input: true, placeholder: '播放列表名称', confirmText: '创建', onConfirm: (name) => useUI.getState().createPlaylist(name) })
  return (
    <div className="page">
      <PageHeader title="播放列表">
        <button className="btn" onClick={create}><Icon.Plus size={15} /> 新建播放列表</button>
      </PageHeader>
      {!playlists.length ? (
        <Empty title="还没有播放列表" sub="点击右上角“新建播放列表”，或在任意歌曲上点按右键选择“添加到播放列表”。" icon={Icon.ListIcon} />
      ) : (
        <div className="grid">{playlists.map((p, i) => <PlaylistCard key={p.id} index={i} playlist={p} />)}</div>
      )}
    </div>
  )
}

const GENRE_HUES = [350, 20, 40, 160, 200, 230, 260, 290, 320, 180, 100, 0]
export function Genres() {
  const { data, loading, error } = useAsync(() => api.genres(), [])
  const navigate = useNavigate()
  return (
    <div className="page">
      <PageHeader title="流派" />
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !data.length && <Empty title="暂无流派信息" sub="歌曲的元数据中没有流派标签。" icon={Icon.Guitar} />}
      {data && data.length > 0 && (
        <div className="genre-grid">
          {data.map((g, i) => {
            const h = GENRE_HUES[i % GENRE_HUES.length]
            return (
              <button
                key={g.id + i}
                className="genre-tile"
                style={{ '--i': i, background: `linear-gradient(135deg, hsl(${h} 75% 58%), hsl(${(h + 35) % 360} 70% 42%))` }}
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
