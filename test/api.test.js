import { describe, expect, it } from 'vitest'
import { coverUrl, mapAlbum, mapArtist, mapPlaylist, mapSong, streamUrl } from '../src/api.js'

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
