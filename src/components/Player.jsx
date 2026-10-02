import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../api'
import { usePlayer, useUI, useCurrent } from '../store'
import { fmtTime, parseLrc, useCoverColor, useViewport } from '../lib'
import { Cover, HeartIcon, Seg, Spinner, useSongMenu } from './common'
import { closeFullPlayer, openFullPlayer } from '../motion'
import * as Icon from '../icons'

// ---------- 滑块（进度 / 音量）：指针拖动、键盘、滚轮、悬停时间提示 ----------
export function Slider({ value, max = 1, onChange, onCommit, className = '', disabled, label, step, tip, valueText }) {
  const ref = useRef(null)
  const [drag, setDrag] = useState(null)
  const [hover, setHover] = useState(null) // 悬停位置（0~1）
  const cur = drag ?? value
  const pct = max > 0 ? Math.min(1, Math.max(0, cur / max)) : 0
  const frac = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  const apply = (v) => (onCommit || onChange)?.(Math.min(max, Math.max(0, v)))
  const inc = step ?? max / 20

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max * 100) / 100}
      aria-valuenow={Math.round(cur * 100) / 100}
      aria-valuetext={valueText ? valueText(cur) : undefined}
      aria-disabled={disabled || undefined}
      className={`slider ${drag !== null ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const v = frac(e) * max
        setDrag(v)
        onChange?.(v)
      }}
      onPointerMove={(e) => {
        const f = frac(e)
        if (drag === null) return setHover(f)
        setDrag(f * max)
        onChange?.(f * max)
      }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        if (drag === null) return
        const v = frac(e) * max
        setDrag(null)
        onCommit?.(v)
      }}
      onPointerCancel={() => setDrag(null)}
      onWheel={(e) => !disabled && apply(cur - Math.sign(e.deltaY) * inc)}
      onKeyDown={(e) => {
        if (disabled) return
        const k = e.key
        let v = null
        if (k === 'ArrowRight' || k === 'ArrowUp') v = cur + inc
        else if (k === 'ArrowLeft' || k === 'ArrowDown') v = cur - inc
        else if (k === 'PageUp') v = cur + inc * 4
        else if (k === 'PageDown') v = cur - inc * 4
        else if (k === 'Home') v = 0
        else if (k === 'End') v = max
        if (v === null) return
        e.preventDefault()
        e.stopPropagation()
        apply(v)
      }}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${pct * 100}%` }} />
      {tip && hover !== null && !disabled && (
        <div className="slider-tip" style={{ left: `${(drag !== null ? pct : hover) * 100}%` }}>{tip(drag !== null ? drag : hover * max)}</div>
      )}
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
  const sz = big ? 1.4 : 1
  const repeatLabel = { off: '重复：关闭', all: '重复：全部', one: '重复：单曲' }[repeat]
  return (
    <div className={`transport ${big ? 'big' : ''}`} role="group" aria-label="播放控制">
      <button className={`icon-btn tbtn toggle ${shuffle ? 'on' : ''}`} onClick={toggleShuffle} title={shuffle ? '随机播放：开' : '随机播放：关'} aria-label="随机播放" aria-pressed={shuffle}>
        <Icon.Shuffle size={16 * sz} />
      </button>
      <button className="icon-btn tbtn" onClick={prev} disabled={!has} title="上一首" aria-label="上一首">
        <Icon.Prev size={19 * sz} />
      </button>
      <button className="icon-btn tbtn main" onClick={toggle} disabled={!has} title={playing ? '暂停 (空格)' : '播放 (空格)'} aria-label={playing ? '暂停' : '播放'}>
        {loading && playing ? <Spinner size={20 * sz} /> : (
          <span key={playing ? 'pause' : 'play'} className="icon-swap">{playing ? <Icon.Pause size={22 * sz} /> : <Icon.Play size={22 * sz} />}</span>
        )}
      </button>
      <button className="icon-btn tbtn" onClick={() => next()} disabled={!has} title="下一首" aria-label="下一首">
        <Icon.Next size={19 * sz} />
      </button>
      <button className={`icon-btn tbtn toggle ${repeat !== 'off' ? 'on' : ''}`} onClick={cycleRepeat} title={repeatLabel} aria-label={repeatLabel} aria-pressed={repeat !== 'off'}>
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
      <button className="icon-btn" onClick={toggleMute} title={muted ? '取消静音' : '静音'} aria-label={muted ? '取消静音' : '静音'}>
        {v === 0 ? <Icon.Mute size={17} /> : v < 0.5 ? <Icon.VolumeLow size={17} /> : <Icon.Volume size={17} />}
      </button>
      <Slider className="vol-slider" label="音量" value={v} max={1} step={0.05} onChange={setVolume} onCommit={setVolume} valueText={(x) => `${Math.round(x * 100)}%`} tip={(x) => `${Math.round(x * 100)}%`} />
    </div>
  )
}

const LOSSLESS = ['FLAC', 'ALAC', 'WAV', 'APE', 'AIFF', 'DSD', 'DSF', 'DFF']
function qualityLabel(song) {
  if (!song) return ''
  const lossless = LOSSLESS.includes(song.codec)
  if (lossless && song.bitDepth && song.sampleRate) {
    const hi = song.bitDepth > 16 || song.sampleRate > 48000
    return `${hi ? '高解析度无损' : '无损'} · ${song.bitDepth}-bit/${(song.sampleRate / 1000).toFixed(song.sampleRate % 1000 ? 1 : 0)} kHz`
  }
  if (lossless) return '无损'
  return [song.codec, song.bitrate ? song.bitrate + ' kbps' : ''].filter(Boolean).join(' · ')
}

function QualityBadge({ song }) {
  if (!song) return null
  const hi = song.bitDepth > 16 || song.sampleRate > 48000
  const lossless = LOSSLESS.includes(song.codec)
  if (!lossless && !(song.codec === 'MP3' && song.bitrate >= 256)) return null
  return (
    <span className={`quality-badge ${lossless ? (hi ? 'hires' : 'lossless') : ''}`} title={qualityLabel(song)}>
      {lossless ? (hi ? 'Hi-Res' : '无损') : `${song.bitrate}k`}
    </span>
  )
}

// ---------- 底部播放栏 ----------
export function PlayerBar() {
  const song = useCurrent()
  const panel = useUI((s) => s.panel)
  const togglePanel = useUI((s) => s.togglePanel)
  const toggleFavorite = usePlayer((s) => s.toggleFavorite)
  const scrub = useScrub()
  const songMenu = useSongMenu()

  return (
    <footer className="playerbar" aria-label="播放器">
      <div className="pb-left">
        {song ? (
          <>
            <button key={'c' + song.id} className="pb-cover swap" onClick={openFullPlayer} title="展开正在播放" aria-label="展开正在播放">
              <Cover coverId={song.coverId} size={52} px={160} />
              <span className="pb-expand"><Icon.Expand size={16} /></span>
            </button>
            <div key={'m' + song.id} className="pb-meta swap">
              <div className="pb-title" title={song.title}>{song.title}</div>
              <div className="pb-sub">
                {song.artistId ? <Link to={`/artist/${song.artistId}`}>{song.artist}</Link> : <span>{song.artist}</span>}
                {song.album && <><span className="pb-dot">·</span>{song.albumId ? <Link to={`/album/${song.albumId}`}>{song.album}</Link> : <span>{song.album}</span>}</>}
              </div>
            </div>
            <div className="pb-actions">
              <button className={`icon-btn ${song.favorite ? 'on' : ''}`} onClick={() => toggleFavorite(song)} title={song.favorite ? '取消喜欢' : '喜欢'} aria-label={song.favorite ? '取消喜欢' : '喜欢'} aria-pressed={song.favorite}>
                <HeartIcon on={song.favorite} size={17} />
              </button>
              <button
                className="icon-btn"
                aria-label="更多"
                title="更多"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  useUI.getState().openMenu(r.left, r.top - 6, songMenu([song]))
                }}
              >
                <Icon.More size={17} />
              </button>
            </div>
          </>
        ) : (
          <div className="pb-idle"><Icon.Note size={20} /><span>未在播放</span></div>
        )}
      </div>

      <div className="pb-center">
        <Transport />
        <div className="pb-progress">
          <span className="pb-time">{fmtTime(scrub.shown)}</span>
          <Slider
            className="pb-slider"
            label="播放进度"
            disabled={!song}
            value={scrub.shown}
            max={scrub.duration || 1}
            step={5}
            onChange={scrub.onChange}
            onCommit={scrub.onCommit}
            valueText={(x) => `${fmtTime(x)} / ${fmtTime(scrub.duration)}`}
            tip={fmtTime}
          />
          <span className="pb-time right">-{fmtTime(Math.max(0, scrub.duration - scrub.shown))}</span>
        </div>
      </div>

      <div className="pb-right">
        <QualityBadge song={song} />
        <VolumeControl />
        <button className={`icon-btn ${panel === 'lyrics' ? 'on' : ''}`} onClick={() => togglePanel('lyrics')} title="歌词 (Ctrl+L)" aria-label="歌词" aria-pressed={panel === 'lyrics'}>
          <Icon.Lyrics size={18} />
        </button>
        <button className={`icon-btn ${panel === 'queue' ? 'on' : ''}`} onClick={() => togglePanel('queue')} title="播放队列" aria-label="播放队列" aria-pressed={panel === 'queue'}>
          <Icon.QueueIcon size={18} />
        </button>
      </div>
    </footer>
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
  if (!lines.length) return <div className="lyrics-empty"><Icon.Lyrics size={36} /><span>暂无歌词</span></div>

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
  // 仅在刚打开时依次浮现；之后切歌导致列表整体平移时不再重播动画
  const [entering, setEntering] = useState(true)
  useEffect(() => { const t = setTimeout(() => setEntering(false), 900); return () => clearTimeout(t) }, [])

  return (
    <div className={`queue ${dark ? 'dark' : ''} ${entering ? 'enter' : ''}`}>
      {cur && (
        <>
          <div className="queue-head"><span>正在播放</span></div>
          <QueueItem song={cur} active playing={playing} index={0} />
        </>
      )}
      <div className="queue-head">
        <span>接下来{upcoming.length > 0 && <em className="queue-count">{upcoming.length}</em>}</span>
        {upcoming.length > 0 && <button className="link-btn" onClick={clearUpcoming}>清除</button>}
      </div>
      {!cur && <div className="queue-empty">播放队列是空的。双击任意歌曲即可开始播放。</div>}
      {cur && upcoming.length === 0 && <div className="queue-empty">队列中没有更多歌曲</div>}
      {upcoming.slice(0, 300).map((s, k) => {
        const i = index + 1 + k
        return (
          <QueueItem
            key={s.id + ':' + i}
            song={s}
            index={k + 1}
            onPlay={() => playIndex(i)}
            onRemove={() => removeFromQueue(i)}
            onMenu={(e) => {
              e.preventDefault()
              useUI.getState().openMenu(e.clientX, e.clientY, songMenu([s], { extra: [{ label: '从队列中移除', icon: Icon.Close, onClick: () => removeFromQueue(i) }] }))
            }}
          />
        )
      })}
      {upcoming.length > 300 && <div className="queue-empty">仅显示接下来的 300 首</div>}
    </div>
  )
}

function QueueItem({ song, active, playing, index = 0, onPlay, onRemove, onMenu }) {
  return (
    <div
      className={`queue-item ${active ? 'active' : ''}`}
      style={{ '--i': index }}
      tabIndex={onPlay ? 0 : undefined}
      onDoubleClick={onPlay}
      onContextMenu={onMenu}
      onKeyDown={(e) => { if (onPlay && e.key === 'Enter') onPlay(); if (onRemove && (e.key === 'Delete' || e.key === 'Backspace')) onRemove() }}
    >
      <div className="qi-cover">
        <Cover coverId={song.coverId} size={40} px={160} />
        {active ? <span className="qi-eq"><Icon.Bars playing={playing} /></span> : (
          <button className="qi-play" onClick={onPlay} aria-label={`播放 ${song.title}`}><Icon.Play size={14} /></button>
        )}
      </div>
      <div className="qi-text">
        <div className="qi-title" title={song.title}>{song.title}</div>
        <div className="qi-sub">{song.artist}</div>
      </div>
      {onRemove && <button className="icon-btn qi-remove" onClick={onRemove} title="移除" aria-label="从队列中移除"><Icon.Close size={14} /></button>}
      <span className="qi-time">{fmtTime(song.duration)}</span>
    </div>
  )
}

// ---------- 右侧面板（宽屏时推开内容；窄屏时作为浮层覆盖在内容上方） ----------
export const PANEL_OVERLAY_MAX = 1239
export function SidePanel() {
  const panel = useUI((s) => s.panel)
  const togglePanel = useUI((s) => s.togglePanel)
  const closePanel = useUI((s) => s.closePanel)
  const song = useCurrent()
  const { w } = useViewport()
  const overlay = w <= PANEL_OVERLAY_MAX
  const ref = useRef(null)

  // 浮层模式：点击面板外部、按 Esc 即关闭
  useEffect(() => {
    if (!panel || !overlay) return
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || e.target.closest?.('.playerbar, .menu, .dialog-mask')) return
      closePanel()
    }
    const onKey = (e) => e.key === 'Escape' && !useUI.getState().menu && !useUI.getState().dialog && closePanel()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [panel, overlay, closePanel])

  return (
    <aside ref={ref} className={`sidepanel ${panel ? 'open' : ''} ${overlay ? 'overlay' : ''}`} aria-label={panel === 'queue' ? '播放队列面板' : '歌词面板'} inert={!panel}>
      <div className="sp-tabs">
        <Seg tabs label="面板" value={panel || 'lyrics'} onChange={(v) => panel !== v && togglePanel(v)} options={[{ value: 'lyrics', label: '歌词' }, { value: 'queue', label: '播放队列' }]} />
        <button className="icon-btn" onClick={closePanel} title="关闭" aria-label="关闭面板"><Icon.Close size={16} /></button>
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
  const song = useCurrent()
  const playing = usePlayer((s) => s.playing)
  const toggleFavorite = usePlayer((s) => s.toggleFavorite)
  const [tab, setTab] = useState('lyrics')
  const [r, g, b] = useCoverColor(song?.coverId)
  const scrub = useScrub()
  const navigate = useNavigate()
  const songMenu = useSongMenu()
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const k = (e) => e.key === 'Escape' && !useUI.getState().menu && closeFullPlayer()
    window.addEventListener('keydown', k)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [open])

  const go = useCallback((path) => { closeFullPlayer(); navigate(path) }, [navigate])

  return (
    <div className={`fullplayer ${open ? 'open' : ''}`} style={{ '--np-r': r, '--np-g': g, '--np-b': b }} role="dialog" aria-modal="true" aria-label="正在播放" inert={!open}>
      <div className="fp-bg">
        {open && song?.coverId && <Cover coverId={song.coverId} px={160} className="fp-bg-img a" />}
        {open && song?.coverId && <Cover coverId={song.coverId} px={160} className="fp-bg-img b" />}
        <div className="fp-bg-tint" />
      </div>
      <div className="fp-top">
        <button ref={closeRef} className="fp-close" onClick={closeFullPlayer} title="收起 (Esc)" aria-label="收起全屏播放器"><Icon.ChevronDown size={22} /></button>
      </div>
      {song ? (
        <div className={`fp-main ${tab ? 'with-side' : ''}`}>
          <div className="fp-left">
            <div className="fp-art-wrap">
              <div className={`fp-art ${playing ? 'playing' : ''}`}>
                <Cover key={song.id} className="swap" coverId={song.coverId} px={1024} />
              </div>
            </div>
            <div className="fp-meta">
              <div key={song.id} className="fp-meta-text swap">
                <div className="fp-title" title={song.title}>{song.title}</div>
                <div className="fp-artist">
                  <button className="lnk" onClick={() => song.artistId && go(`/artist/${song.artistId}`)}>{song.artist}</button>
                  {song.album && <><span className="fp-dash">—</span><button className="lnk" onClick={() => song.albumId && go(`/album/${song.albumId}`)}>{song.album}</button></>}
                </div>
              </div>
              <button className={`fp-round ${song.favorite ? 'fav' : ''}`} onClick={() => toggleFavorite(song)} title={song.favorite ? '取消喜欢' : '喜欢'} aria-label={song.favorite ? '取消喜欢' : '喜欢'} aria-pressed={song.favorite}>
                <HeartIcon on={song.favorite} size={18} />
              </button>
              <button
                className="fp-round"
                aria-label="更多"
                title="更多"
                onClick={(e) => {
                  const rc = e.currentTarget.getBoundingClientRect()
                  useUI.getState().openMenu(rc.left, rc.bottom + 6, songMenu([song]).map((it) => (it && it.label?.startsWith('前往') ? { ...it, onClick: () => go(it.label === '前往专辑' ? `/album/${song.albumId}` : `/artist/${song.artistId}`) } : it)))
                }}
              >
                <Icon.More size={18} />
              </button>
            </div>
            <div className="fp-progress">
              <Slider className="fp-slider" label="播放进度" value={scrub.shown} max={scrub.duration || 1} step={5} onChange={scrub.onChange} onCommit={scrub.onCommit} valueText={(x) => `${fmtTime(x)} / ${fmtTime(scrub.duration)}`} tip={fmtTime} />
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
                <button className={`fp-round ${tab === 'lyrics' ? 'on' : ''}`} onClick={() => setTab(tab === 'lyrics' ? null : 'lyrics')} title="歌词" aria-label="歌词" aria-pressed={tab === 'lyrics'}><Icon.Lyrics size={18} /></button>
                <button className={`fp-round ${tab === 'queue' ? 'on' : ''}`} onClick={() => setTab(tab === 'queue' ? null : 'queue')} title="播放队列" aria-label="播放队列" aria-pressed={tab === 'queue'}><Icon.QueueIcon size={18} /></button>
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
