import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from 'react-router-dom'
import { usePlayer, useUI } from '../store'
import { fmtTime } from '../lib'
import { Cover, useScrollEl, useSongMenu } from './common'
import * as Icon from '../icons'

const ROW = 52

/**
 * 歌曲列表（虚拟滚动）
 * variant: 'default' 带封面/艺人/专辑列；'album' 显示曲目号，不显示专辑列
 * sortable: 列头可点击排序
 */
export default function SongList({ songs, variant = 'default', extraMenu, sortable = false, albumArtist }) {
  const scrollRef = useScrollEl()
  const listRef = useRef(null)
  const [margin, setMargin] = useState(0)
  const [selected, setSelected] = useState(null)
  const [sort, setSort] = useState(null) // { key, dir }
  const play = usePlayer((s) => s.play)
  const currentId = usePlayer((s) => s.queue[s.index]?.id)
  const playing = usePlayer((s) => s.playing)
  const songMenu = useSongMenu()

  const view = sort ? sortSongs(songs, sort) : songs

  useLayoutEffect(() => {
    const el = listRef.current, sc = scrollRef.current
    if (!el || !sc) return
    const measure = () => setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sc.firstElementChild || sc)
    return () => ro.disconnect()
  }, [scrollRef])

  const virt = useVirtualizer({
    count: view.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 10,
    scrollMargin: margin,
  })

  const onPlay = useCallback((i) => play(view, i, { shuffle: false }), [play, view])
  const onMenu = useCallback(
    (e, song, i) => {
      e.preventDefault()
      e.stopPropagation()
      setSelected(song.id)
      useUI.getState().openMenu(e.clientX, e.clientY, songMenu([song], { extra: extraMenu ? extraMenu(song, i) : [] }))
    },
    [songMenu, extraMenu]
  )

  const toggleSort = (key) => {
    if (!sortable) return
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  }
  const arrow = (key) => (sort?.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')

  return (
    <div className={`songlist v-${variant}`} ref={listRef}>
      <div className="song-row song-head">
        {variant === 'album' ? <div className="c-num">#</div> : null}
        <div className={`c-title ${sortable ? 'sortable' : ''}`} onClick={() => toggleSort('title')}>歌曲{arrow('title')}</div>
        {variant === 'default' && <div className={`c-artist ${sortable ? 'sortable' : ''}`} onClick={() => toggleSort('artist')}>艺人{arrow('artist')}</div>}
        {variant === 'default' && <div className={`c-album ${sortable ? 'sortable' : ''}`} onClick={() => toggleSort('album')}>专辑{arrow('album')}</div>}
        <div className="c-fav" />
        <div className={`c-time ${sortable ? 'sortable' : ''}`} onClick={() => toggleSort('duration')}>时长{arrow('duration')}</div>
        <div className="c-more" />
      </div>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((v) => {
          const song = view[v.index]
          return (
            <Row
              key={song.id + ':' + v.index}
              song={song}
              index={v.index}
              top={v.start - margin}
              variant={variant}
              albumArtist={albumArtist}
              isCurrent={song.id === currentId}
              playing={playing}
              selected={selected === song.id}
              onSelect={setSelected}
              onPlay={onPlay}
              onMenu={onMenu}
            />
          )
        })}
      </div>
    </div>
  )
}

const Row = memo(function Row({ song, index, top, variant, albumArtist, isCurrent, playing, selected, onSelect, onPlay, onMenu }) {
  const toggleFavorite = usePlayer((s) => s.toggleFavorite)
  const toggle = usePlayer((s) => s.toggle)
  const showArtist = variant === 'album' && albumArtist && song.artist !== albumArtist

  const playBtn = (
    <button
      className="row-play"
      onClick={(e) => { e.stopPropagation(); isCurrent ? toggle() : onPlay(index) }}
      title={isCurrent && playing ? '暂停' : '播放'}
    >
      {isCurrent && playing ? <Icon.Pause size={14} /> : <Icon.Play size={14} />}
    </button>
  )

  return (
    <div
      className={`song-row ${index % 2 ? 'odd' : ''} ${isCurrent ? 'current' : ''} ${selected ? 'selected' : ''}`}
      style={{ transform: `translateY(${top}px)` }}
      onClick={() => onSelect(song.id)}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => onMenu(e, song, index)}
    >
      {variant === 'album' ? (
        <div className="c-num">
          <span className="num-text">{isCurrent ? <Icon.Bars playing={playing} /> : song.trackNo || index + 1}</span>
          {playBtn}
        </div>
      ) : null}
      <div className="c-title">
        {variant !== 'album' && (
          <div className="row-cover">
            <Cover coverId={song.coverId} size={38} />
            <div className={`row-cover-overlay ${isCurrent ? 'show' : ''}`}>
              {isCurrent && <span className="eq-wrap"><Icon.Bars playing={playing} /></span>}
              {playBtn}
            </div>
          </div>
        )}
        <div className="title-text">
          <div className="t1">{song.title}</div>
          {showArtist && <div className="t2">{song.artist}</div>}
        </div>
      </div>
      {variant === 'default' && (
        <div className="c-artist">{song.artistId ? <Link to={`/artist/${song.artistId}`} onClick={(e) => e.stopPropagation()}>{song.artist}</Link> : song.artist}</div>
      )}
      {variant === 'default' && (
        <div className="c-album">{song.albumId ? <Link to={`/album/${song.albumId}`} onClick={(e) => e.stopPropagation()}>{song.album}</Link> : song.album}</div>
      )}
      <div className="c-fav">
        <button className={`icon-btn fav ${song.favorite ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(song) }} title={song.favorite ? '取消喜欢' : '喜欢'}>
          {song.favorite ? <Icon.HeartFill size={15} /> : <Icon.Heart size={15} />}
        </button>
      </div>
      <div className="c-time">{fmtTime(song.duration)}</div>
      <div className="c-more">
        <button className="icon-btn more" onClick={(e) => onMenu(e, song, index)} title="更多">
          <Icon.More size={16} />
        </button>
      </div>
    </div>
  )
})

function sortSongs(songs, { key, dir }) {
  const coll = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  return [...songs].sort((a, b) => (key === 'duration' ? a.duration - b.duration : coll.compare(a[key] || '', b[key] || '')) * dir)
}
