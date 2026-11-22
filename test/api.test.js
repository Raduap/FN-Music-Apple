import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, coverUrl, mapAlbum, mapArtist, mapPlaylist, mapSong, streamUrl } from '../src/api.js'

describe('mapSong', () => {
  const raw = {
    guid: 'abc',
    title: '晴天',
    artists: [{ guid: 'ar1', name: '周杰伦' }, { guid: 'ar2', name: '客串' }],
    album: { guid: 'al1', name: '叶惠美', coverId: 'album_ff00' },
    coverId: '0123456789abcdef0123456789abcdef', // 歌单接口里出现的裸 GUID，封面接口不认
    duration: 269000,
    isFavorite: true,
    audioSpec: { codec: '', bitrate: 921600, sampleRate: 96000, bitDepth: 24, path: '/vol1/music/晴天.FLAC' },
    year: 2003,
    trackNo: 3,
  }
  const s = mapSong(raw)
  it('基本字段', () => {
    expect(s).toMatchObject({ id: 'abc', title: '晴天', artist: '周杰伦 / 客串', artistId: 'ar1', album: '叶惠美', albumId: 'al1', duration: 269, favorite: true, year: 2003, trackNo: 3, discNo: 0 })
  })
  it('丢弃无效的封面 ID，退回专辑封面', () => expect(s.coverId).toBe('album_ff00'))
  it('保留搜索结果里的来源标记，供搜索列表原样展示', () => {
    expect(mapSong({ ...raw, title: '[music box] 晴天' }).title).toBe('[music box] 晴天')
  })
  it('编码缺失时取文件扩展名，码率换算为 kbps', () => {
    expect(s.codec).toBe('FLAC')
    expect(s.bitrate).toBe(922)
    expect(s.sampleRate).toBe(96000)
    expect(s.bitDepth).toBe(24)
  })
  it('缺字段时给出默认值', () => {
    expect(mapSong({})).toMatchObject({ id: '', title: '未知歌曲', artist: '未知歌手', coverId: '', duration: 0, favorite: false, codec: '' })
  })
})

describe('其他映射', () => {
  it('mapAlbum 从发行日期取年份', () => {
    expect(mapAlbum({ guid: 'a', name: 'X', releaseDate: '2019-05-01', artists: [{ guid: 'r', name: 'Y' }], coverId: 'album_1', trackCount: '12' }))
      .toEqual({ id: 'a', name: 'X', artist: 'Y', artistId: 'r', coverId: 'album_1', year: 2019, trackCount: 12 })
    expect(mapAlbum({}).year).toBe(0)
  })
  it('mapArtist / mapPlaylist', () => {
    expect(mapArtist({ guid: 'r', name: 'Y', coverId: 'bad' }).coverId).toBe('')
    expect(mapPlaylist({ guid: 'p', trackCount: 3 })).toEqual({ id: 'p', name: '未命名歌单', trackCount: 3, coverId: '' })
  })
})

describe('资源地址', () => {
  it('coverUrl', () => {
    expect(coverUrl('album_1', 160)).toBe('fnm://srv/api/v1/static/cover?coverId=album_1&size=160')
    expect(coverUrl('album_1')).toBe('fnm://srv/api/v1/static/cover?coverId=album_1')
    expect(coverUrl('')).toBe('')
  })
  it('streamUrl 对 ID 编码', () => expect(streamUrl('a b')).toBe('fnm://srv/api/v1/track/stream?guid=a%20b'))
})

// 装了接管插件后搜索会等待在线音源聚合，客户端必须给搜索留出比普通接口更宽的超时，
// 否则冷启动首次搜索会被渲染进程提前 abort（表现为「请求超时」但服务端仍在工作）。
describe('搜索超时（适配 fnmusic-ext）', () => {
  afterEach(() => vi.restoreAllMocks())

  // raw() 用 setTimeout(abort, timeout) 实现超时；从注册的定时器里读回每个请求的超时上限。
  function stubFetchCapturingTimeouts() {
    const timers = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      const h = { fn, ms }
      timers.push(h)
      return h
    })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // 永不 resolve，保留请求在飞行中
    return timers
  }

  it('search/track 与 search/album 使用更宽的超时，artist 仍是普通接口超时', async () => {
    const timers = stubFetchCapturingTimeouts()
    api.search('x').catch(() => {})
    const searchTimeouts = timers.map((t) => t.ms).filter((ms) => ms > 15000)
    expect(searchTimeouts.filter((ms) => ms === 25000)).toHaveLength(2)
    expect(timers.some((t) => t.ms === 20000)).toBe(true) // search/artist 仍是普通 20s 兜底
  })

  it('普通接口（如专辑列表）仍是普通超时', async () => {
    const timers = stubFetchCapturingTimeouts()
    api.albumsPage(20).catch(() => {})
    expect(timers.map((t) => t.ms)).toContain(20000)
    expect(timers.every((t) => t.ms <= 20000)).toBe(true)
  })
})

// fnmusic-ext 等接管插件依赖官方 event/report 的 track_play 事件写在线播放历史，
// 这里固定住客户端上报的报文形状，避免回归导致最近播放 / 推荐拿不到在线曲目。
describe('播放上报（适配 fnmusic-ext）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reportPlay 发送官方 track_play 事件（occurredAt + trackGUID）', async () => {
    let captured
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured = { url: String(url), opts }
      return { status: 200, json: async () => ({ code: 0, msg: 'ok', data: null }) }
    }))
    await api.reportPlay({ id: 'online:abc', title: '稻香', artist: '周杰伦', album: '魔杰座', duration: 223 }, 1794044288780)
    expect(captured.url).toBe('fnm://srv/api/v1/event/report')
    expect(captured.opts.method).toBe('POST')
    expect(JSON.parse(captured.opts.body)).toEqual({
      events: [{
        eventType: 'track_play',
        occurredAt: 1794044288780,
        payload: { trackGUID: 'online:abc' },
      }],
    })
  })
})