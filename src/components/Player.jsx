import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useShallow } from 'zustand/react/shallow'
import { usePlayer, useUI, useCurrent } from '../store'
import { fmtTime, parseLrc, useCoverColor } from '../lib'
import { Cover, Spinner, useSongMenu } from './common'
import * as Icon from '../icons'

// ---------- 滑块（进度 / 音量） ----------
export function Slider({ value, max = 1, onChange, onCommit, className = '', disabled }) {
  const ref = useRef(null)
  const [drag, setDrag] = useState(null)
  const pct = max > 0 ? Math.min(1, Math.max(0, (drag ?? value) / max)) : 0
  const at = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max
  }
  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const v = at(e)
        setDrag(v)
        onChange?.(v)
      }}
      onPointerUp={(e) => {
        if (drag === null) return
        const v = at(e)
        setDrag(null)
        onCommit?.(v)
      }}
      onPointerCancel={() => setDrag(null)}
      onWheel={(e) => {
        if (disabled || !onCommit) return
        onCommit(Math.min(max, Math.max(0, (drag ?? value) - Math.sign(e.deltaY) * max * 0.05)))
      }}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${pct * 100}%` }} />
    </div>
  )
}

function useScrub() {
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const seek = usePlayer((s) => s.seek)
  const [scrub, setScrub] = useState(null)
  return {
    shown: scrub ?? currentTime,
    duration,
    onChange: setScrub,
    onCommit: (v) => { seek(v); setScrub(null) },
  }
}

// ---------- 播放控制按钮组 ----------
export function Transport({ big = false }) {
  const { playing, loading, shuffle, repeat, toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer(
    useShallow((s) => ({ playing: s.playing, loading: s.loading, shuffle: s.shuffle, repeat: s.repeat, toggle: s.toggle, next: s.next, prev: s.prev, toggleShuffle: s.toggleShuffle, cycleRepeat: s.cycleRepeat }))
  )
  const has = usePlayer((s) => s.queue.length > 0)
  const sz = big ? 1.5 : 1
  return (
    <div className={`transport ${big ? 'big' : ''}`}>
      <button className={`icon-btn tbtn toggle ${shuffle ? 'on' : ''}`} onClick={toggleShuffle} title="随机播放">
        <Icon.Shuffle size={16 * sz} />
      </button>
      <button className="icon-btn tbtn" onClick={prev} disabled={!has} title="上一首">
        <Icon.Prev size={20 * sz} />
      </button>
      <button className="icon-btn tbtn main" onClick={toggle} disabled={!has} title={playing ? '暂停' : '播放'}>
        {loading && playing ? <Spinner size={18 * sz} /> : playing ? <Icon.Pause size={24 * sz} /> : <Icon.Play size={24 * sz} />}
      </button>
      <button className="icon-btn tbtn" onClick={() => next()} disabled={!has} title="下一首">
        <Icon.Next size={20 * sz} />
      </button>
      <button className={`icon-btn tbtn toggle ${repeat !== 'off' ? 'on' : ''}`} onClick={cycleRepeat} title={{ off: '重复：关', all: '重复：全部', one: '重复：单曲' }[repeat]}>
        {repeat === 'one' ? <Icon.RepeatOne size={16 * sz} /> : <Icon.Repeat size={16 * sz} />}
      </button>
    </div>
  )
}

export function VolumeControl() {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const setVolume = usePlayer((s) => s.setVolume)
  const toggleMute = usePlayer((s) => s.toggleMute)
  const v = muted ? 0 : volume
  return (
    <div className="volume">
      <button className="icon-btn" onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
        {v === 0 ? <Icon.Mute size={17} /> : v < 0.5 ? <Icon.VolumeLow size={17} /> : <Icon.Volume size={17} />}
      </button>
      <Slider className="vol-slider" value={v} max={1} onChange={setVolume} onCommit={setVolume} />
    </div>
  )
}

function qualityLabel(song) {
  if (!song) return ''
  const lossless = ['FLAC', 'ALAC', 'WAV', 'APE', 'AIFF', 'DSD', 'DSF', 'DFF'].includes(song.codec)
  if (lossless && song.bitDepth && song.sampleRate) {
    const hi = song.bitDepth > 16 || song.sampleRate > 48000
    return `${hi ? '高解析度无损' : '无损'} · ${song.bitDepth}-bit/${(song.sampleRate / 1000).toFixed(song.sampleRate % 1000 ? 1 : 0)} kHz`
  }
  if (lossless) return '无损'
  return [song.codec, song.bitrate ? song.bitrate + ' kbps' : ''].filter(Boolean).join(' · ')
}

// ---------- 顶部栏 ----------
export function TopBar() {
  const song = useCurrent()
  const panel = useUI((s) => s.panel)
  const togglePanel = useUI((s) => s.togglePanel)
  const setFull = useUI((s) => s.setFullPlayer)
  const scrub = useScrub()
  const songMenu = useSongMenu()

  return (
    <header className="topbar">
      <Transport />
      <div className={`lozenge ${song ? '' : 'empty'}`}>
        {song ? (
          <>
            <button className="loz-cover" onClick={() => setFull(true)} title="打开全屏播放器">
              <Cover coverId={song.coverId} size={44} px={160} />
              <span className="loz-expand"><Icon.Expand size={16} /></span>
            </button>
            <div className="loz-info">
              <div className="loz-title">{song.title}</div>
              <div className="loz-sub">
                {song.artistId ? <Link to={`/artist/${song.artistId}`}>{song.artist}</Link> : song.artist}
                {song.album && <> — {song.albumId ? <Link to={`/album/${song.albumId}`}>{song.album}</Link> : song.album}</>}
              </div>
              <div className="loz-progress">
                <span className="loz-time">{fmtTime(scrub.shown)}</span>
                <Slider className="loz-slider" value={scrub.shown} max={scrub.duration || 1} onChange={scrub.onChange} onCommit={scrub.onCommit} />
                <span className="loz-time right">-{fmtTime(Math.max(0, scrub.duration - scrub.shown))}</span>
              </div>
            </div>
            <button
              className="icon-btn loz-more"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                useUI.getState().openMenu(r.left, r.bottom + 6, songMenu([song]))
              }}
              title="更多"
            >
              <Icon.More size={16} />
            </button>
          </>
        ) : (
          <div className="loz-logo"><Icon.Note size={22} /></div>
        )}
      </div>
      <div className="topbar-right">
        <VolumeControl />
        <button className={`icon-btn ${panel === 'lyrics' ? 'on' : ''}`} onClick={() => togglePanel('lyrics')} title="歌词">
          <Icon.Lyrics size={18} />
        </button>
        <button className={`icon-btn ${panel === 'queue' ? 'on' : ''}`} onClick={() => togglePanel('queue')} title="播放队列">
          <Icon.QueueIcon size={18} />
        </button>
      </div>
    </header>
  )
}

// ---------- 歌词 ----------
const lrcCache = new Map()
function useLyrics(song) {
  const [state, setState] = useState({ lines: [], loading: false })
  useEffect(() => {
    if (!song) return setState({ lines: [], loading: false })
    if (lrcCache.has(song.id)) return setState({ lines: lrcCache.get(song.id), loading: false })
    let dead = false
    setState({ lines: [], loading: true })
    api.lyric(song.id).then((text) => {
      const lines = parseLrc(text)
      // 无时间戳的纯文本歌词也显示（不滚动）
      const plain = !lines.length && text ? text.split(/\r?\n/).map((t) => t.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).map((t) => ({ time: -1, text: t })) : null
      const out = plain || lines
      lrcCache.set(song.id, out)
      if (!dead) setState({ lines: out, loading: false })
    })
    return () => { dead = true }
  }, [song?.id])
  return state
}

export function LyricsView({ song, big = false }) {
  const { lines, loading } = useLyrics(song)
  const time = usePlayer((s) => s.currentTime)
  const seek = usePlayer((s) => s.seek)
  const ref = useRef(null)
  const userScroll = useRef(0)
  const synced = lines.length && lines[0].time >= 0

  const active = useMemo(() => {
    if (!synced) return -1
    const t = time + 0.25
    let lo = 0, hi = lines.length - 1, ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (lines[mid].time <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }, [time, lines, synced])

  useEffect(() => {
    const el = ref.current
    if (!el || active < 0 || Date.now() - userScroll.current < 3000) return
    const line = el.querySelector(`[data-i="${active}"]`)
    if (line) el.scrollTo({ top: line.offsetTop - el.clientHeight * (big ? 0.38 : 0.32), behavior: 'smooth' })
  }, [active, big])

  if (!song) return <div className="lyrics-empty">未在播放</div>
  if (loading) return <div className="lyrics-empty"><Spinner /></div>
  if (!lines.length) return <div className="lyrics-empty">暂无歌词</div>

  return (
    <div
      className={`lyrics ${big ? 'big' : ''} ${synced ? 'synced' : ''}`}
      ref={ref}
      onWheel={() => (userScroll.current = Date.now())}
    >
      <div className="lyrics-pad" />
      {lines.map((l, i) => {
        const d = active < 0 ? 0 : Math.min(4, Math.abs(i - active))
        return (
          <div
            key={i}
            data-i={i}
            className={`lyric-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''}`}
            style={big && synced && i !== active ? { filter: `blur(${d * 0.6}px)` } : undefined}
            onClick={() => synced && l.time >= 0 && (seek(l.time), (userScroll.current = 0))}
          >
            {l.text || '♪'}
          </div>
        )
      })}
      <div className="lyrics-pad" />
    </div>
  )
}

// ---------- 播放队列 ----------
export function QueueView({ dark = false }) {
  const { queue, index, playIndex, removeFromQueue, clearUpcoming } = usePlayer(
    useShallow((s) => ({ queue: s.queue, index: s.index, playIndex: s.playIndex, removeFromQueue: s.removeFromQueue, clearUpcoming: s.clearUpcoming }))
  )
  const playing = usePlayer((s) => s.playing)
  const songMenu = useSongMenu()
  const cur = queue[index]
  const upcoming = queue.slice(index + 1)
  const ref = useRef(null)

  return (
    <div className={`queue ${dark ? 'dark' : ''}`} ref={ref}>
      {cur && (
        <>
          <div className="queue-head"><span>正在播放</span></div>
          <QueueItem song={cur} active playing={playing} />
        </>
      )}
      <div className="queue-head">
        <span>接下来</span>
        {upcoming.length > 0 && <button className="link-btn" onClick={clearUpcoming}>清除</button>}
      </div>
      {upcoming.length === 0 && <div className="queue-empty">队列中没有更多歌曲</div>}
      {upcoming.slice(0, 300).map((s, k) => {
        const i = index + 1 + k
        return (
          <QueueItem
            key={s.id + ':' + i}
            song={s}
            onPlay={() => playIndex(i)}
            onRemove={() => removeFromQueue(i)}
            onMenu={(e) => {
              e.preventDefault()
              useUI.getState().openMenu(e.clientX, e.clientY, songMenu([s], { extra: [{ label: '从队列中移除', icon: Icon.Close, onClick: () => removeFromQueue(i) }] }))
            }}
          />
        )
      })}
    </div>
  )
}

function QueueItem({ song, active, playing, onPlay, onRemove, onMenu }) {
  return (
    <div className={`queue-item ${active ? 'active' : ''}`} onDoubleClick={onPlay} onContextMenu={onMenu}>
      <div className="qi-cover">
        <Cover coverId={song.coverId} size={40} px={160} />
        {active ? <span className="qi-eq"><Icon.Bars playing={playing} /></span> : (
          <button className="qi-play" onClick={onPlay}><Icon.Play size={14} /></button>
        )}
      </div>
      <div className="qi-text">
        <div className="qi-title">{song.title}</div>
        <div className="qi-sub">{song.artist}</div>
      </div>
      {onRemove && <button className="icon-btn qi-remove" onClick={onRemove} title="移除"><Icon.Close size={14} /></button>}
      <span className="qi-time">{fmtTime(song.duration)}</span>
    </div>
  )
}

// ---------- 右侧面板 ----------
export function SidePanel() {
  const panel = useUI((s) => s.panel)
  const togglePanel = useUI((s) => s.togglePanel)
  const song = useCurrent()
  return (
    <aside className={`sidepanel ${panel ? 'open' : ''}`}>
      <div className="sp-tabs">
        <div className="seg">
          <button className={panel === 'lyrics' ? 'on' : ''} onClick={() => panel !== 'lyrics' && togglePanel('lyrics')}>歌词</button>
          <button className={panel === 'queue' ? 'on' : ''} onClick={() => panel !== 'queue' && togglePanel('queue')}>播放队列</button>
        </div>
      </div>
      <div className="sp-body">
        {panel === 'lyrics' && <LyricsView song={song} />}
        {panel === 'queue' && <QueueView />}
      </div>
    </aside>
  )
}

// ---------- 全屏播放页 ----------
export function FullPlayer() {
  const open = useUI((s) => s.fullPlayer)
  const setFull = useUI((s) => s.setFullPlayer)
  const song = useCurrent()
  const playing = usePlayer((s) => s.playing)
  const toggleFavorite = usePlayer((s) => s.toggleFavorite)
  const [tab, setTab] = useState('lyrics')
  const [r, g, b] = useCoverColor(song?.coverId)
  const scrub = useScrub()
  const navigate = useNavigate()
  const songMenu = useSongMenu()

  useEffect(() => {
    if (!open) return
    const k = (e) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, setFull])

  const go = useCallback((path) => { setFull(false); navigate(path) }, [navigate, setFull])

  return (
    <div className={`fullplayer ${open ? 'open' : ''}`} style={{ '--np-r': r, '--np-g': g, '--np-b': b }}>
      <div className="fp-bg">
        {song?.coverId && <Cover coverId={song.coverId} px={160} className="fp-bg-img a" />}
        {song?.coverId && <Cover coverId={song.coverId} px={160} className="fp-bg-img b" />}
        <div className="fp-bg-tint" />
      </div>
      <div className="fp-top">
        <button className="fp-close" onClick={() => setFull(false)} title="收起 (Esc)"><Icon.ChevronDown size={22} /></button>
      </div>
      {song ? (
        <div className={`fp-main ${tab ? 'with-side' : ''}`}>
          <div className="fp-left">
            <div className={`fp-art ${playing ? 'playing' : ''}`}>
              <Cover coverId={song.coverId} px={1024} />
            </div>
            <div className="fp-meta">
              <div className="fp-meta-text">
                <div className="fp-title">{song.title}</div>
                <div className="fp-artist">
                  <span className="lnk" onClick={() => song.artistId && go(`/artist/${song.artistId}`)}>{song.artist}</span>
                  {song.album && <> — <span className="lnk" onClick={() => song.albumId && go(`/album/${song.albumId}`)}>{song.album}</span></>}
                </div>
              </div>
              <button className={`fp-round ${song.favorite ? 'fav' : ''}`} onClick={() => toggleFavorite(song)} title="喜欢">
                {song.favorite ? <Icon.HeartFill size={18} /> : <Icon.Heart size={18} />}
              </button>
              <button
                className="fp-round"
                onClick={(e) => {
                  const rc = e.currentTarget.getBoundingClientRect()
                  useUI.getState().openMenu(rc.left, rc.bottom + 6, songMenu([song]).map((it) => (it && it.label?.startsWith('前往') ? { ...it, onClick: () => go(it.label === '前往专辑' ? `/album/${song.albumId}` : `/artist/${song.artistId}`) } : it)))
                }}
              >
                <Icon.More size={18} />
              </button>
            </div>
            <div className="fp-progress">
              <Slider className="fp-slider" value={scrub.shown} max={scrub.duration || 1} onChange={scrub.onChange} onCommit={scrub.onCommit} />
              <div className="fp-times">
                <span>{fmtTime(scrub.shown)}</span>
                <span className="fp-quality">{qualityLabel(song)}</span>
                <span>-{fmtTime(Math.max(0, scrub.duration - scrub.shown))}</span>
              </div>
            </div>
            <Transport big />
            <div className="fp-bottom">
              <VolumeControl />
              <div className="fp-tabs">
                <button className={`fp-round ${tab === 'lyrics' ? 'on' : ''}`} onClick={() => setTab(tab === 'lyrics' ? null : 'lyrics')} title="歌词"><Icon.Lyrics size={18} /></button>
                <button className={`fp-round ${tab === 'queue' ? 'on' : ''}`} onClick={() => setTab(tab === 'queue' ? null : 'queue')} title="播放队列"><Icon.QueueIcon size={18} /></button>
              </div>
            </div>
          </div>
          {tab && (
            <div className="fp-side">
              {tab === 'lyrics' ? <LyricsView song={song} big /> : <QueueView dark />}
            </div>
          )}
        </div>
      ) : (
        <div className="fp-nothing">未在播放</div>
      )}
    </div>
  )
}
