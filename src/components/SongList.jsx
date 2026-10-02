import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from 'react-router-dom'
import { usePlayer, useUI } from '../store'
import { fmtTime } from '../lib'
import { Cover, HeartIcon, SONG_DRAG_TYPE, songDrag, useScrollEl, useSongMenu } from './common'
import * as Icon from '../icons'

const ROW = 52
const HEAD = 34

/**
 * 歌曲列表（虚拟滚动）
 * - 单击选中，Ctrl/⌘ 多选，Shift 连选；↑↓/Home/End 移动，Enter 播放，Ctrl+A 全选
 * - 右键对已选歌曲操作；可把已选歌曲拖到侧栏的播放列表 / 喜欢
 * - variant: 'default' 带封面/艺人/专辑列；'album' 显示曲目号
 * - 列随容器宽度收起（容器查询，不依赖窗口宽度，因此与侧边面板是否展开无关）
 */
export default function SongList({ songs, variant = 'default', extraMenu, sortable = false, albumArtist }) {
  const scrollRef = useScrollEl()
  const wrapRef = useRef(null)
  const [margin, setMargin] = useState(0)
  const [sel, setSel] = useState(() => new Set())
  const [sort, setSort] = useState(null) // { key, dir }
  const anchor = useRef(0)
  const cursor = useRef(-1)
  const play = usePlayer((s) => s.play)
  const currentId = usePlayer((s) => s.queue[s.index]?.id)
  const playing = usePlayer((s) => s.playing)
  const songMenu = useSongMenu()
  // 菜单构造函数、extraMenu 每次渲染都是新函数，用 ref 保持回调引用稳定，避免所有行跟着重新渲染
  const songMenuRef = useRef(songMenu)
  songMenuRef.current = songMenu
  const extraRef = useRef(extraMenu)
  extraRef.current = extraMenu

  const view = useMemo(() => (sort ? sortSongs(songs, sort) : songs), [songs, sort])
  const viewRef = useRef(view)
  viewRef.current = view
  const selRef = useRef(sel)
  selRef.current = sel

  useLayoutEffect(() => {
    const el = wrapRef.current, sc = scrollRef.current
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
    scrollPaddingStart: HEAD + 8,
    scrollPaddingEnd: 8,
  })

  const onPlay = useCallback((i) => play(viewRef.current, i, { shuffle: false }), [play])

  const selectRange = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const s = new Set()
    for (let i = lo; i <= hi; i++) s.add(i)
    return s
  }

  const onSelect = useCallback((i, e) => {
    wrapRef.current?.focus({ preventScroll: true })
    if (e.shiftKey) setSel(selectRange(anchor.current, i))
    else if (e.ctrlKey || e.metaKey) setSel((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n })
    else { setSel(new Set([i])); anchor.current = i }
    cursor.current = i
  }, [])

  const picked = () => [...selRef.current].sort((a, b) => a - b).map((i) => viewRef.current[i]).filter(Boolean)

  const onMenu = useCallback((e, i) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selRef.current.has(i)) { setSel(new Set([i])); anchor.current = i; cursor.current = i }
    const songsPicked = selRef.current.has(i) ? picked() : [viewRef.current[i]]
    useUI.getState().openMenu(e.clientX, e.clientY, songMenuRef.current(songsPicked, { extra: extraRef.current ? extraRef.current(songsPicked) : [] }))
     
  }, [])

  const onDragStart = useCallback((e, i) => {
    let list
    if (selRef.current.has(i)) list = picked()
    else { list = [viewRef.current[i]]; setSel(new Set([i])); anchor.current = i }
    songDrag.songs = list
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(SONG_DRAG_TYPE, String(list.length))
    e.dataTransfer.setData('text/plain', list.map((s) => s.title).join('\n'))
    const g = document.createElement('div')
    g.className = 'drag-ghost'
    g.textContent = list.length > 1 ? `${list.length} 首歌曲` : list[0].title
    document.body.appendChild(g)
    e.dataTransfer.setDragImage(g, 12, 14)
    setTimeout(() => g.remove(), 0)
     
  }, [])

  const onKeyDown = (e) => {
    const n = view.length
    if (!n) return
    const k = e.key
    const move = (i) => {
      i = Math.min(n - 1, Math.max(0, i))
      if (e.shiftKey) setSel(selectRange(anchor.current, i))
      else { setSel(new Set([i])); anchor.current = i }
      cursor.current = i
      virt.scrollToIndex(i, { align: 'auto' })
    }
    const c = cursor.current
    if (k === 'ArrowDown') { e.preventDefault(); move(c < 0 ? 0 : c + 1) }
    else if (k === 'ArrowUp') { e.preventDefault(); move(c < 0 ? n - 1 : c - 1) }
    else if (k === 'PageDown') { e.preventDefault(); move((c < 0 ? 0 : c) + 8) }
    else if (k === 'PageUp') { e.preventDefault(); move((c < 0 ? 0 : c) - 8) }
    else if (k === 'Home') { e.preventDefault(); move(0) }
    else if (k === 'End') { e.preventDefault(); move(n - 1) }
    else if (k === 'Enter' && c >= 0) { e.preventDefault(); onPlay(c) }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); setSel(selectRange(0, n - 1)) }
    else if (k === 'Escape' && sel.size) { setSel(new Set()) }
    else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
      e.preventDefault()
      const i = c < 0 ? 0 : c
      const el = wrapRef.current?.querySelector(`[data-i="${i}"]`)
      const r = el?.getBoundingClientRect() || wrapRef.current.getBoundingClientRect()
      onMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left + 80, clientY: r.bottom }, i)
    }
  }

  const toggleSort = (key) => {
    if (!sortable) return
    setSel(new Set())
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  }
  const sortProps = (key) => ({
    className: `${sortable ? 'sortable' : ''} ${sort?.key === key ? 'sorted' : ''}`,
    onClick: () => toggleSort(key),
    'aria-sort': sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined,
  })
  const arrow = (key) => (sort?.key === key ? <Icon.ChevronDown size={12} className={`sort-arrow ${sort.dir === 1 ? 'up' : ''}`} /> : null)

  return (
    <div
      ref={wrapRef}
      className={`songlist v-${variant}`}
      role="grid"
      aria-label="歌曲列表"
      aria-rowcount={view.length}
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('song-space')) setSel(new Set()) }}
    >
      <div className="song-row song-head" role="row">
        {variant === 'album' ? <div className="c-num" role="columnheader">#</div> : null}
        <div role="columnheader" {...sortProps('title')} data-col="title">歌曲 {arrow('title')}</div>
        {variant === 'default' && <div role="columnheader" {...sortProps('artist')} data-col="artist">艺人 {arrow('artist')}</div>}
        {variant === 'default' && <div role="columnheader" {...sortProps('album')} data-col="album">专辑 {arrow('album')}</div>}
        <div className="c-fav" aria-hidden="true" />
        <div role="columnheader" {...sortProps('duration')} data-col="time" style={{ textAlign: 'right' }}>时长 {arrow('duration')}</div>
        <div className="c-more" aria-hidden="true" />
      </div>
      <div className="song-space" style={{ height: virt.getTotalSize(), position: 'relative' }}>
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
              selected={sel.has(v.index)}
              onSelect={onSelect}
              onPlay={onPlay}
              onMenu={onMenu}
              onDragStart={onDragStart}
            />
          )
        })}
      </div>
    </div>
  )
}

const Row = memo(function Row({ song, index, top, variant, albumArtist, isCurrent, playing, selected, onSelect, onPlay, onMenu, onDragStart }) {
  const toggleFavorite = usePlayer((s) => s.toggleFavorite)
  const toggle = usePlayer((s) => s.toggle)
  const showArtist = variant === 'album' && albumArtist && song.artist !== albumArtist

  const playBtn = (
    <button
      className="row-play"
      tabIndex={-1}
      onClick={(e) => { e.stopPropagation(); isCurrent ? toggle() : onPlay(index) }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={isCurrent && playing ? '暂停' : '播放'}
      aria-label={isCurrent && playing ? `暂停 ${song.title}` : `播放 ${song.title}`}
    >
      {isCurrent && playing ? <Icon.Pause size={14} /> : <Icon.Play size={14} />}
    </button>
  )

  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-i={index}
      draggable
      className={`song-row ${index % 2 ? 'odd' : ''} ${isCurrent ? 'current' : ''} ${selected ? 'selected' : ''} ${index < 18 ? 'enter' : ''}`}
      style={{ transform: `translateY(${top}px)`, '--i': index }}
      onClick={(e) => onSelect(index, e)}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => onMenu(e, index)}
      onDragStart={(e) => onDragStart(e, index)}
    >
      {variant === 'album' ? (
        <div className="c-num" role="gridcell">
          <span className="num-text">{isCurrent ? <Icon.Bars playing={playing} /> : song.trackNo || index + 1}</span>
          {playBtn}
        </div>
      ) : null}
      <div className="c-title" role="gridcell">
        {variant !== 'album' && (
          <div className="row-cover">
            <Cover coverId={song.coverId} size={38} px={160} />
            <div className={`row-cover-overlay ${isCurrent ? 'show' : ''}`}>
              {isCurrent && <span className="eq-wrap"><Icon.Bars playing={playing} /></span>}
              {playBtn}
            </div>
          </div>
        )}
        <div className="title-text">
          <div className="t1" title={song.title}>{song.title}</div>
          {variant === 'default' && <div className="t2 narrow-only">{song.artist}</div>}
          {showArtist && <div className="t2">{song.artist}</div>}
        </div>
      </div>
      {variant === 'default' && (
        <div className="c-artist" role="gridcell" title={song.artist}>{song.artistId ? <Link to={`/artist/${song.artistId}`} draggable={false} onClick={(e) => e.stopPropagation()}>{song.artist}</Link> : song.artist}</div>
      )}
      {variant === 'default' && (
        <div className="c-album" role="gridcell" title={song.album}>{song.albumId ? <Link to={`/album/${song.albumId}`} draggable={false} onClick={(e) => e.stopPropagation()}>{song.album}</Link> : song.album}</div>
      )}
      <div className="c-fav" role="gridcell">
        <button
          className={`icon-btn fav ${song.favorite ? 'on' : ''}`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(song) }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={song.favorite ? '取消喜欢' : '喜欢'}
          aria-label={song.favorite ? '取消喜欢' : '喜欢'}
          aria-pressed={song.favorite}
        >
          <HeartIcon on={song.favorite} size={15} />
        </button>
      </div>
      <div className="c-time" role="gridcell">{fmtTime(song.duration)}</div>
      <div className="c-more" role="gridcell">
        <button
          className="icon-btn more"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onMenu(e, index) }}
          onDoubleClick={(e) => e.stopPropagation()}
          title="更多"
          aria-label="更多"
        >
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
