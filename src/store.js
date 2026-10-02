import { create } from 'zustand'
import { api, streamUrl, invalidate } from './api'
import { acquireCover, prefetchCover } from './covers'
import { lineAt, loadLyrics } from './lyrics'
import { shuffled } from './lib'
import { applyMotion } from './motion'

const LS = {
  get(k, d) { try { const v = localStorage.getItem('fnm:' + k); return v === null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('fnm:' + k, JSON.stringify(v)) } catch {} },
}

// ---------- 单例 audio ----------
const audio = new Audio()
audio.preload = 'auto'
// 尚未加载音频（启动后恢复的队列）时记下的起始位置，真正开始播放时再跳转过去
let pendingSeek = 0

// 尚未完成的“喜欢”写请求。界面会先乐观更新，“喜欢的歌曲”页面读取列表前要等这些请求完成，否则会读到旧数据
const favoriteWrites = new Set()
function trackFavorite(p) {
  favoriteWrites.add(p)
  p.catch(() => {}).finally(() => favoriteWrites.delete(p))
  return p
}
export const favoritesSettled = () => Promise.allSettled([...favoriteWrites])

// 整理菜单项：去掉假值，合并连续分隔线，去掉首尾分隔线（子菜单同理）
function tidyMenu(items) {
  const out = []
  for (const it of items.filter(Boolean)) {
    if (it === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue }
    out.push(it.children ? { ...it, children: tidyMenu(it.children) } : it)
  }
  while (out[out.length - 1] === '-') out.pop()
  return out
}

// ---------- UI / 提示 / 菜单 ----------
export const useUI = create((set, get) => ({
  toast: null,
  menu: null, // { x, y, items }
  dialog: null, // { title, ... }
  panel: null, // null | 'lyrics' | 'queue'
  fullPlayer: false,
  playlists: [],
  theme: LS.get('theme', 'system'),
  motion: LS.get('motion', 'on'),
  sidebarCollapsed: LS.get('sbCollapsed', false),
  pageTitle: '', // 当前页面标题，滚动后显示在顶部导航条里
  scrolled: false,

  showToast(text) {
    const id = Date.now()
    set({ toast: { id, text } })
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 2200)
  },
  openMenu: (x, y, items) => set({ menu: { x, y, items: tidyMenu(items) } }),
  closeMenu: () => set({ menu: null }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  closePanel: () => set({ panel: null }),
  toggleSidebar: () => set((s) => { LS.set('sbCollapsed', !s.sidebarCollapsed); return { sidebarCollapsed: !s.sidebarCollapsed } }),
  setPageTitle: (pageTitle) => set({ pageTitle }),
  setScrolled: (scrolled) => set((s) => (s.scrolled === scrolled ? s : { scrolled })),
  setFullPlayer: (v) => set({ fullPlayer: v }),
  setMotion(mode) {
    LS.set('motion', mode)
    applyMotion(mode)
    set({ motion: mode })
  },
  setTheme(mode) {
    LS.set('theme', mode)
    window.fn.setTheme(mode)
    set({ theme: mode })
  },

  async loadPlaylists() {
    try { set({ playlists: await api.playlists() }) } catch {}
  },
  async createPlaylist(name, songs = []) {
    await api.createPlaylist(name)
    invalidate('playlists')
    await get().loadPlaylists()
    if (songs.length) {
      const pl = get().playlists.find((p) => p.name === name)
      if (pl) await api.addToPlaylist(pl.id, songs.map((s) => s.id))
      invalidate('playlists')
      await get().loadPlaylists()
    }
    get().showToast(`已创建播放列表“${name}”`)
  },
  async favoriteSongs(songs) {
    const todo = songs.filter((s) => !s.favorite)
    if (!todo.length) return get().showToast('已在“喜欢的歌曲”中')
    try {
      await Promise.all(todo.map((s) => trackFavorite(api.setFavorite(s.id, true))))
      todo.forEach((s) => window.dispatchEvent(new CustomEvent('fn:favorite-changed', { detail: { id: s.id, favorite: true } })))
      get().showToast(`已将 ${todo.length} 首歌曲添加到“喜欢的歌曲”`)
    } catch (e) { get().showToast('操作失败：' + e.message) }
  },
  async addToPlaylist(pl, songs) {
    try {
      await api.addToPlaylist(pl.id, songs.map((s) => s.id))
      get().showToast(`已添加到“${pl.name}”`)
      get().loadPlaylists()
      window.dispatchEvent(new CustomEvent('fn:playlist-changed', { detail: pl.id }))
    } catch (e) { get().showToast('添加失败：' + e.message) }
  },
}))

// ---------- 鉴权 ----------
export const useAuth = create((set) => ({
  status: 'loading', // loading | out | in
  username: '',
  server: '',
  async restore() {
    const r = await window.fn.restore()
    if (r.ok) {
      set({ status: 'in', username: r.username, server: r.server })
      useUI.getState().loadPlaylists()
    } else set({ status: 'out' })
  },
  async login(form) {
    const r = await window.fn.login(form)
    if (r.ok) {
      set({ status: 'in', username: r.username, server: r.server })
      useUI.getState().loadPlaylists()
    }
    return r
  },
  async logout() {
    usePlayer.getState().stop()
    await window.fn.logout()
    invalidate('')
    set({ status: 'out', username: '' })
  },
}))

// ---------- 播放器 ----------
const saved = LS.get('queue', { queue: [], index: -1 })

export const usePlayer = create((set, get) => ({
  queue: saved.queue || [],
  original: saved.original || saved.queue || [],
  index: saved.index ?? -1,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: LS.get('volume', 0.8),
  muted: false,
  shuffle: LS.get('shuffle', false),
  repeat: LS.get('repeat', 'off'), // off | all | one

  _persist() {
    const { queue, original, index } = get()
    LS.set('queue', { queue, original, index })
  },

  _load(song, autoplay = true, start = 0) {
    pendingSeek = 0
    audio.src = streamUrl(song.id)
    audio.currentTime = 0
    if (start > 0) {
      const src = audio.src
      audio.addEventListener('loadedmetadata', () => { if (audio.src === src) audio.currentTime = start }, { once: true })
    }
    set({ currentTime: start, duration: song.duration || 0, loading: true })
    if (autoplay) audio.play().catch(() => {})
    updateMediaSession(song)
    savePosition(song.id, start)
    setTimeout(prefetchUpcoming, 1500) // 让当前歌曲的音频和封面先走
  },

  /** 播放一组歌曲，从 startIndex 开始；shuffleAll 时随机排序 */
  play(songs, startIndex = 0, { shuffle } = {}) {
    if (!songs.length) return
    const useShuffle = shuffle ?? get().shuffle
    let queue = songs
    let index = startIndex
    if (useShuffle) {
      const first = songs[startIndex]
      queue = [first, ...shuffled(songs.filter((_, i) => i !== startIndex))]
      index = 0
    }
    set({ queue, original: songs, index, shuffle: useShuffle })
    LS.set('shuffle', useShuffle)
    get()._load(queue[index])
    get()._persist()
  },

  playShuffled(songs) { get().play(songs, Math.floor(Math.random() * songs.length), { shuffle: true }) },

  playIndex(i) {
    const song = get().queue[i]
    if (!song) return
    set({ index: i })
    get()._load(song)
    get()._persist()
  },

  playNext(songs) {
    const { queue, index } = get()
    if (!queue.length) return get().play(songs, 0, { shuffle: false })
    const q = [...queue]
    q.splice(index + 1, 0, ...songs)
    set({ queue: q, original: [...get().original, ...songs] })
    get()._persist()
    useUI.getState().showToast('将在接下来播放')
  },

  addToQueue(songs) {
    const { queue } = get()
    if (!queue.length) return get().play(songs, 0, { shuffle: false })
    set({ queue: [...queue, ...songs], original: [...get().original, ...songs] })
    get()._persist()
    useUI.getState().showToast('已添加到播放队列')
  },

  removeFromQueue(i) {
    const { queue, original, index } = get()
    if (i === index || !queue[i]) return
    const q = queue.filter((_, k) => k !== i)
    // original 是关闭随机播放时恢复的顺序，也要去掉这一首，否则关闭随机后它又会回来
    const o = original.findIndex((s) => s.id === queue[i].id)
    set({ queue: q, original: o < 0 ? original : original.filter((_, k) => k !== o), index: i < index ? index - 1 : index })
    get()._persist()
  },

  clearUpcoming() {
    const { queue, original, index } = get()
    const kept = queue.slice(0, index + 1)
    const ids = new Set(kept.map((s) => s.id))
    set({ queue: kept, original: original.filter((s) => ids.has(s.id)) })
    get()._persist()
  },

  toggle() {
    const { queue, index } = get()
    if (!queue[index]) return
    if (!audio.src) get()._load(queue[index], true, pendingSeek)
    else if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  },

  next(auto = false) {
    const { queue, index, repeat } = get()
    if (!queue.length) return
    if (auto && repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return }
    if (index + 1 < queue.length) get().playIndex(index + 1)
    else if (repeat === 'all' || !auto) get().playIndex(0)
    else { audio.pause(); audio.currentTime = 0; set({ playing: false, currentTime: 0 }) }
  },

  prev() {
    const { queue, index } = get()
    if (!queue.length) return
    if (audio.currentTime > 3 || pendingSeek > 3 || index === 0) { get().seek(0); return }
    get().playIndex(index - 1)
  },

  seek(t) {
    if (!Number.isFinite(t)) return
    t = Math.max(0, t)
    if (!audio.src) { pendingSeek = t; set({ currentTime: t }); return } // 尚未加载：开始播放时再跳转
    audio.currentTime = t
    set({ currentTime: audio.currentTime })
  },

  setVolume(v) {
    v = Math.min(1, Math.max(0, v))
    audio.volume = v
    audio.muted = false
    LS.set('volume', v)
    set({ volume: v, muted: false })
  },

  toggleMute() {
    audio.muted = !audio.muted
    set({ muted: audio.muted })
  },

  toggleShuffle() {
    const { shuffle, queue, original, index } = get()
    const cur = queue[index]
    const on = !shuffle
    let q = queue, i = index
    if (cur) {
      if (on) { q = [cur, ...shuffled(original.filter((s) => s.id !== cur.id))]; i = 0 }
      else { q = original; i = Math.max(0, original.findIndex((s) => s.id === cur.id)) }
    }
    LS.set('shuffle', on)
    set({ shuffle: on, queue: q, index: i })
    get()._persist()
  },

  cycleRepeat() {
    const r = { off: 'all', all: 'one', one: 'off' }[get().repeat]
    LS.set('repeat', r)
    set({ repeat: r })
  },

  async toggleFavorite(song) {
    const on = !song.favorite
    const patch = (list) => list.map((s) => (s.id === song.id ? { ...s, favorite: on } : s))
    set({ queue: patch(get().queue), original: patch(get().original) })
    const req = trackFavorite(api.setFavorite(song.id, on))
    window.dispatchEvent(new CustomEvent('fn:favorite-changed', { detail: { id: song.id, favorite: on } }))
    try {
      await req
      useUI.getState().showToast(on ? '已添加到“喜欢的歌曲”' : '已从“喜欢的歌曲”移除')
    } catch (e) {
      const undo = (list) => list.map((s) => (s.id === song.id ? { ...s, favorite: !on } : s))
      set({ queue: undo(get().queue), original: undo(get().original) })
      window.dispatchEvent(new CustomEvent('fn:favorite-changed', { detail: { id: song.id, favorite: !on } }))
      useUI.getState().showToast('操作失败：' + e.message)
    }
  },

  stop() {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    pendingSeek = 0
    set({ queue: [], original: [], index: -1, playing: false, currentTime: 0, duration: 0 })
    LS.set('queue', { queue: [], index: -1 })
    LS.set('position', null)
  },
}))

// ---------- 播放位置（重启后从上次的位置继续） ----------
let lastSaved = 0
function savePosition(id, t) {
  lastSaved = performance.now()
  LS.set('position', { id, t: Math.floor(t) })
}
const saveCurrentPosition = () => {
  const song = usePlayer.getState().queue[usePlayer.getState().index]
  if (song && audio.src) savePosition(song.id, audio.currentTime)
}
audio.addEventListener('pause', saveCurrentPosition)
window.addEventListener('beforeunload', saveCurrentPosition)

// ---------- audio 事件 ----------
audio.volume = usePlayer.getState().volume
audio.addEventListener('play', () => usePlayer.setState({ playing: true }))
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }))
audio.addEventListener('playing', () => usePlayer.setState({ loading: false, playing: true }))
audio.addEventListener('waiting', () => usePlayer.setState({ loading: true }))
audio.addEventListener('ended', () => usePlayer.getState().next(true))
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration })
})
let lastTick = 0
audio.addEventListener('timeupdate', () => {
  const now = performance.now()
  if (now - lastTick < 200) return
  lastTick = now
  usePlayer.setState({ currentTime: audio.currentTime })
  if (now - lastSaved > 5000) saveCurrentPosition()
  if ('mediaSession' in navigator && Number.isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 }) } catch {}
  }
})
audio.addEventListener('error', () => {
  const song = usePlayer.getState().queue[usePlayer.getState().index]
  if (!song || !audio.src) return
  usePlayer.setState({ loading: false })
  useUI.getState().showToast(`无法播放“${song.title}”，已跳到下一首`)
  setTimeout(() => {
    const p = usePlayer.getState()
    if (p.queue[p.index]?.id === song.id && p.queue.length > 1) p.next(true)
  }, 800)
})

// ---------- 系统媒体控制（SMTC / 媒体键） ----------
// MediaSession 只接受 http/https/data/blob 封面，用封面缓存里的 blob URL（600 尺寸足够，原图可能有几 MB）。
// 占用当前歌曲的封面直到切歌，避免被回收
let art = null
function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return
  const meta = { title: song.title, artist: song.artist, album: song.album }
  navigator.mediaSession.metadata = new MediaMetadata(meta)
  art?.release()
  art = song.coverId ? acquireCover(song.coverId, 600) : null
  art?.promise.then((url) => {
    if (!url || usePlayer.getState().queue[usePlayer.getState().index]?.id !== song.id) return
    navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [{ src: url, sizes: '600x600' }] })
  })
}

// 预加载下一首的封面，切歌时播放栏 / 全屏页能立刻显示
function prefetchUpcoming() {
  const { queue, index } = usePlayer.getState()
  const next = queue[index + 1]
  if (!next?.coverId) return
  prefetchCover(next.coverId, 160)
  if (useUI.getState().fullPlayer) prefetchCover(next.coverId, 1024)
}
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f) } catch {} }
  h('play', () => { if (audio.paused) usePlayer.getState().toggle() })
  h('pause', () => audio.pause())
  h('previoustrack', () => usePlayer.getState().prev())
  h('nexttrack', () => usePlayer.getState().next())
  h('seekto', (d) => usePlayer.getState().seek(d.seekTime))
}
// ---------- 托盘与悬浮球：同步播放状态，并接收它们发来的播放控制 ----------
// 歌曲、播放状态、歌词行等变化时立即发送；进度只在跳转或每秒同步一次，悬浮球自己按时间推算进度
let lyricFor = ''
let lyricLines = []
let lastKey = ''
let lastSync = { at: 0, time: 0, playing: false }
function broadcast() {
  const s = usePlayer.getState()
  const song = s.queue[s.index]
  if ((song?.id || '') !== lyricFor) {
    lyricFor = song?.id || ''
    lyricLines = []
    if (song) {
      const id = song.id
      loadLyrics(id).then((lines) => { if (lyricFor === id) { lyricLines = lines; broadcast() } })
    }
  }
  const line = lineAt(lyricLines, s.currentTime + 0.25)
  const state = {
    title: song?.title || '',
    artist: song?.artist || '',
    album: song?.album || '',
    coverId: song?.coverId || '',
    favorite: !!song?.favorite,
    playing: s.playing,
    loading: s.loading,
    duration: s.duration || song?.duration || 0,
    volume: s.muted ? 0 : s.volume,
    lyric: line >= 0 ? lyricLines[line].text : '',
    motion: useUI.getState().motion,
  }
  const key = JSON.stringify(state)
  const now = Date.now()
  const expected = lastSync.time + (lastSync.playing ? (now - lastSync.at) / 1000 : 0)
  const jumped = Math.abs(s.currentTime - expected) > 1.2
  if (key === lastKey && !jumped && now - lastSync.at < 1000) return
  lastKey = key
  lastSync = { at: now, time: s.currentTime, playing: s.playing }
  window.fn?.setPlayerState?.({ ...state, currentTime: s.currentTime, at: now })
}
usePlayer.subscribe(broadcast)
useUI.subscribe((s, prev) => { if (s.motion !== prev.motion) broadcast() })

window.fn?.onPlayerCommand?.((cmd, arg) => {
  const p = usePlayer.getState()
  const song = p.queue[p.index]
  if (cmd === 'toggle') p.toggle()
  else if (cmd === 'next') p.next()
  else if (cmd === 'prev') p.prev()
  else if (cmd === 'favorite' && song) p.toggleFavorite(song)
  else if (cmd === 'volume' && Number.isFinite(arg)) p.setVolume((p.muted ? 0 : p.volume) + arg)
})

audio.addEventListener('play', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing' })
audio.addEventListener('pause', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused' })

// 启动恢复上次队列和播放位置（不自动播放，也不预先请求音频流，点击播放时才加载）
export function restorePlayer() {
  const { queue, index } = usePlayer.getState()
  const song = queue[index]
  if (!song || audio.src) return
  const pos = LS.get('position', null)
  const t = pos && pos.id === song.id && pos.t > 0 && (!song.duration || pos.t < song.duration - 2) ? pos.t : 0
  pendingSeek = t
  usePlayer.setState({ duration: song.duration || 0, currentTime: t })
  updateMediaSession(song)
}
export const getAudio = () => audio
export const useCurrent = () => usePlayer((s) => s.queue[s.index] || null)
