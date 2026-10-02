// 飞牛音乐 API 封装。所有请求发往 fnm://srv/…，由主进程代理并附带 music-token。
const BASE = 'fnm://srv'

export class ApiError extends Error {
  constructor(msg, code) {
    super(msg)
    this.code = code
  }
}

let reloginPromise = null

async function raw(path, { query, method = 'GET', body } = {}) {
  const url = new URL(BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new ApiError(`服务器响应异常（HTTP ${res.status}）`, res.status)
  }
  return json
}

async function call(path, opts) {
  let json = await raw(path, opts)
  if (json.code === 99999) {
    // token 失效：静默重登一次，并发请求共享同一次重登
    reloginPromise ||= window.fn.relogin().finally(() => (reloginPromise = null))
    const r = await reloginPromise
    if (!r.ok) {
      window.dispatchEvent(new CustomEvent('fn:auth-lost'))
      throw new ApiError('登录已失效，请重新登录', 99999)
    }
    json = await raw(path, opts)
  }
  if (json.code !== 0) throw new ApiError(json.msg || '请求失败', json.code)
  return json.data || {}
}

// ---------- 映射 ----------
const s = (v, d = '') => (v === undefined || v === null ? d : String(v))
const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d)

export function mapSong(j) {
  const album = j.album || {}
  const artists = j.artists || []
  const a0 = artists[0] || {}
  const spec = j.audioSpec || {}
  const path = s(spec.path)
  const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : ''
  return {
    id: s(j.guid),
    title: s(j.title, '未知歌曲'),
    artist: artists.map((x) => x.name).filter(Boolean).join(' / ') || '未知歌手',
    artistId: s(a0.guid),
    album: s(album.name),
    albumId: s(album.guid),
    coverId: s(j.coverId || album.coverId),
    duration: n(j.duration) / 1000,
    favorite: j.isFavorite === true,
    codec: s(spec.codec).toUpperCase() || ext.toUpperCase(),
    bitrate: n(spec.bitrate) ? Math.round(n(spec.bitrate) / 1000) : 0,
    sampleRate: n(spec.sampleRate),
    bitDepth: n(spec.bitDepth),
    year: n(j.year) || 0,
    trackNo: n(j.trackNo) || 0,
    discNo: n(j.discNo) || 0,
    createdAt: n(j.createdAt),
  }
}

export function mapAlbum(j) {
  const a0 = (j.artists || [])[0] || {}
  const rd = s(j.releaseDate)
  return {
    id: s(j.guid),
    name: s(j.name, '未知专辑'),
    artist: (j.artists || []).map((x) => x.name).filter(Boolean).join(' / ') || '未知歌手',
    artistId: s(a0.guid),
    coverId: s(j.coverId),
    year: rd.length >= 4 ? parseInt(rd.slice(0, 4)) || 0 : 0,
    trackCount: n(j.trackCount),
  }
}

export function mapArtist(j) {
  return { id: s(j.guid), name: s(j.name, '未知歌手'), coverId: s(j.coverId), albumCount: n(j.albumCount), trackCount: n(j.trackCount) }
}

export const mapPlaylist = (j) => ({ id: s(j.guid), name: s(j.name, '未命名歌单'), trackCount: n(j.trackCount), coverId: s(j.coverId) })

// ---------- 资源地址 ----------
export const coverUrl = (coverId) => (coverId ? `${BASE}/api/v1/static/cover?coverId=${encodeURIComponent(coverId)}` : '')
export const streamUrl = (songId) => `${BASE}/api/v1/track/stream?guid=${encodeURIComponent(songId)}`

// ---------- 缓存 ----------
const cache = new Map()
function cached(key, ttl, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttl) return hit.p
  const p = fn().catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, { t: Date.now(), p })
  return p
}
export function invalidate(prefix = '') {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}
export const clearCache = () => cache.clear()

// 拉取全部分页（size=500），可通过 onPage 逐页回调以便界面渐进显示
async function fetchAll(path, query, mapper, onPage) {
  const out = []
  let page = 1
  for (;;) {
    const data = await call(path, { query: { ...query, page, size: 500 } })
    const list = (data.list || []).map(mapper)
    out.push(...list)
    onPage?.([...out], n(data.total))
    if (!list.length || out.length >= n(data.total) || page >= 40) break
    page++
  }
  return out
}

const listOf = (data, mapper) => (data.list || []).map(mapper)

// ---------- 公开接口 ----------
export const api = {
  // 专辑
  albums: (sort = 'newTrackAddedAt,desc', onPage) => fetchAll('/api/v1/album/list', { sort }, mapAlbum, onPage),
  albumsPage: async (size, sort = 'newTrackAddedAt,desc') => listOf(await call('/api/v1/album/list', { query: { page: 1, size, sort } }), mapAlbum),
  album: async (id) => mapAlbum(await call('/api/v1/album/detail', { query: { albumGUID: id } })),
  albumSongs: async (id) => listOf(await call('/api/v1/track/album-detail/list', { query: { albumGUID: id, page: 1, size: 500 } }), mapSong),
  artistAlbums: async (id) => listOf(await call('/api/v1/album/artist-detail/list', { query: { artistGUID: id, page: 1, size: 500 } }), mapAlbum),

  // 歌曲
  songs: (onPage) => fetchAll('/api/v1/track/list', { sort: 'createdAt,desc' }, mapSong, onPage),
  artistSongs: async (id, size = 200) => listOf(await call('/api/v1/track/artist-detail/list', { query: { artistGUID: id, page: 1, size } }), mapSong),
  favorites: () => fetchAll('/api/v1/favorite-track/list', { sort: 'favoriteAt,desc' }, mapSong),
  genreSongs: async (guid, name) => {
    const q = async (g) => listOf(await call('/api/v1/track/genre-detail/list', { query: { genreGUID: g, page: 1, size: 500 } }), mapSong)
    const r = await q(guid)
    return r.length || !name || name === guid ? r : q(name)
  },

  // 歌手 / 流派
  artists: () => cached('artists', 60_000, () => fetchAll('/api/v1/artist/list', {}, mapArtist)),
  genres: async () => listOf(await call('/api/v1/genre/list', { query: { page: 1, size: 500 } }), (j) => ({ id: s(j.guid || j.name), name: s(j.name), trackCount: n(j.trackCount) })),

  // 歌单
  playlists: () => cached('playlists', 30_000, async () => listOf(await call('/api/v1/playlist/list', { query: { page: 1, size: 200 } }), mapPlaylist)),
  playlistSongs: async (id) => listOf(await call('/api/v1/track/playlist-detail/list', { query: { playlistGUID: id, page: 1, size: 500 } }), mapSong),
  createPlaylist: async (name) => { await call('/api/v1/playlist/create', { method: 'POST', body: { name } }); invalidate('playlists') },
  renamePlaylist: async (id, name) => { await call('/api/v1/playlist/update', { method: 'POST', body: { guid: id, name } }); invalidate('playlists') },
  deletePlaylist: async (id) => { await call('/api/v1/playlist/delete', { method: 'POST', body: { guid: id } }); invalidate('playlists') },
  addToPlaylist: async (id, songIds) => { await call('/api/v1/playlist/add-track', { method: 'POST', body: { guid: id, trackGUIDs: songIds } }); invalidate('playlists') },
  removeFromPlaylist: async (id, songIds) => { await call('/api/v1/playlist/remove-track', { method: 'POST', body: { guid: id, trackGUIDs: songIds } }); invalidate('playlists') },

  // 收藏
  setFavorite: (id, on) => call(on ? '/api/v1/favorite-track/create' : '/api/v1/favorite-track/delete', { method: 'POST', body: { trackGUID: id } }),

  // 搜索
  search: async (q) => {
    const [songs, albums, artists] = await Promise.all([
      call('/api/v1/search/track', { query: { q, page: 1, size: 30 } }),
      call('/api/v1/search/album', { query: { q, page: 1, size: 20 } }),
      call('/api/v1/search/artist', { query: { q, page: 1, size: 20 } }),
    ])
    return { songs: listOf(songs, mapSong), albums: listOf(albums, mapAlbum), artists: listOf(artists, mapArtist) }
  },

  // 歌词（返回 LRC 原文）
  lyric: async (songId) => {
    try {
      const data = await call('/api/v1/lyric/list', { query: { trackGUID: songId } })
      for (const e of data.list || []) if (e.content && String(e.content).trim()) return String(e.content)
    } catch {}
    return ''
  },
}
