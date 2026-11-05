import { describe, expect, it } from 'vitest'
import { clearLyricsTranslation, detectLyricLang, hasTranslation, lineAt, lyricFrame, lyricPlaceholder, loadLyrics, toLines, translationTargets } from '../src/lyrics.js'

describe('歌词', () => {
  const lines = toLines('[00:01.00]一\n[00:05.00]二\n[00:09.00]三')
  it('lineAt 找到当前时间所在行', () => {
    expect(lineAt(lines, 0)).toBe(-1)
    expect(lineAt(lines, 1)).toBe(0)
    expect(lineAt(lines, 6.5)).toBe(1)
    expect(lineAt(lines, 100)).toBe(2)
    expect(lineAt([], 5)).toBe(-1)
  })

  it('没有时间戳的纯文本歌词保留为不滚动的行', () => {
    const plain = toLines('第一行\n\n第二行')
    expect(plain).toEqual([{ time: -1, text: '第一行' }, { time: -1, text: '第二行' }])
    expect(lineAt(plain, 10)).toBe(-1)
  })

  it('至少 3 个不同时间点存在同时间歌词组时，才合并为原文 + 译文', () => {
    const bi = toLines('[00:47.30]The last ace in a lost hand\n[00:47.30]败局中最后的王牌\n[00:51.03]A heartbeat for a tin man\n[00:51.03]铁人胸膛里跳动的心脏\n[00:55.00]Hero\n[00:55.00]英雄')
    expect(bi).toEqual([
      { time: 47.3, text: 'The last ace in a lost hand', translation: '败局中最后的王牌' },
      { time: 51.03, text: 'A heartbeat for a tin man', translation: '铁人胸膛里跳动的心脏' },
      { time: 55, text: 'Hero', translation: '英雄' },
    ])
    expect(hasTranslation(bi)).toBe(true)
    expect(lineAt(bi, 48)).toBe(0)
    expect(lineAt(bi, 52)).toBe(1)
  })

  it('不足 3 个不同时间点的同时间歌词组不合并', () => {
    const twice = toLines('[00:01.00]One\n[00:01.00]一\n[00:05.00]Two\n[00:05.00]二')
    expect(twice).toEqual([
      { time: 1, text: 'One' },
      { time: 1, text: '一' },
      { time: 5, text: 'Two' },
      { time: 5, text: '二' },
    ])
    expect(hasTranslation(twice)).toBe(false)
  })

  it('单语歌词不合并、也没有译文', () => {
    const mono = toLines('[00:01.00]一\n[00:05.00]二')
    expect(mono).toEqual([{ time: 1, text: '一' }, { time: 5, text: '二' }])
    expect(mono.some((l) => l.translation)).toBe(false)
    expect(hasTranslation(mono)).toBe(false)
  })

  it('识别歌词语言，避免翻译中文歌词', () => {
    expect(detectLyricLang('Hello world')).toBe('latin')
    expect(detectLyricLang('こんにちは世界')).toBe('ja')
    expect(detectLyricLang('你好世界')).toBe('zh')
    expect(detectLyricLang('안녕하세요')).toBe('ko')
  })

  it('侧栏与全屏并发加载时复用翻译结果，不用原文覆盖缓存', async () => {
    const lyrics = '[00:01.00]Hello\n[00:05.00]World'
    const id = 'race-song-' + Date.now()
    const oldFetch = globalThis.fetch
    const oldFn = globalThis.window?.fn
    let lyricCalls = 0
    let translateCalls = 0
    clearLyricsTranslation(id)
    globalThis.fetch = async () => {
      lyricCalls++
      return { json: async () => ({ code: 0, data: { list: [{ content: lyrics }] } }) }
    }
    globalThis.window = globalThis.window || {}
    globalThis.window.fn = {
      ...(oldFn || {}),
      lyricsTranslate: async ({ lines }) => {
        translateCalls++
        await new Promise((r) => setTimeout(r, 5))
        return { ok: true, translations: lines.map((t) => `译:${t}`), source: 'netease', sourceCount: lines.length, aiCount: 0 }
      },
    }
    try {
      const song = { id, title: 'Race', artist: 'Tester', album: '', duration: 180 }
      const [a, b] = await Promise.all([
        loadLyrics(id, song, { translate: true }),
        loadLyrics(id, song, { translate: true }),
      ])
      expect(lyricCalls).toBe(1)
      expect(translateCalls).toBe(1)
      expect(a[0].translation).toBe('译:Hello')
      expect(b[0].translation).toBe('译:Hello')
      expect(a).toEqual(b)
    } finally {
      clearLyricsTranslation(id)
      globalThis.fetch = oldFetch
      if (oldFn) globalThis.window.fn = oldFn
      else delete globalThis.window.fn
    }
  })

  it('只为缺译文的外语行生成翻译目标', () => {
    const lines = [
      { time: 1, text: 'Hello' },
      { time: 2, text: '你好', translation: '已有译文' },
      { time: 3, text: '' },
      { time: 4, text: 'World' },
    ]
    expect(translationTargets(lines)).toEqual([{ index: 0, text: 'Hello' }, { index: 3, text: 'World' }])
  })

  it('只有一个时间点的多行同时间歌词不合并', () => {
    const tri = toLines('[00:10.00]原文\n[00:10.00]译文一\n[00:10.00]译文二')
    expect(tri).toEqual([
      { time: 10, text: '原文' },
      { time: 10, text: '译文一' },
      { time: 10, text: '译文二' },
    ])
    expect(hasTranslation(tri)).toBe(false)
  })

  describe('lyricPlaceholder（悬浮歌词兜底文案）', () => {
    it('歌词还没加载完时不显示纯音乐，而是显示当前歌曲名', () => {
      expect(lyricPlaceholder({ title: '晴天', lyricsReady: false, hasLyrics: false, lyric: '', nextLyric: '' })).toBe('晴天')
    })

    it('歌词已经加载完且确认没有歌词时，才显示纯音乐', () => {
      expect(lyricPlaceholder({ title: '晴天', lyricsReady: true, hasLyrics: false, lyric: '', nextLyric: '' })).toBe('纯音乐，请欣赏')
    })

    it('歌词已加载但没有可显示行时不显示纯音乐', () => {
      expect(lyricPlaceholder({ title: '晴天', lyricsReady: true, hasLyrics: true, lyric: '', nextLyric: '' })).toBe('晴天')
    })

    it('旧消息缺少 lyricsReady 时不把未知状态误判为纯音乐', () => {
      expect(lyricPlaceholder({ title: '晴天', hasLyrics: false, lyric: '', nextLyric: '' })).toBe('晴天')
    })

    it('没有在播放时显示未在播放', () => {
      expect(lyricPlaceholder({ title: '', lyricsReady: true, hasLyrics: false, lyric: '', nextLyric: '' })).toBe('未在播放')
    })
  })

  describe('lyricFrame（悬浮歌词）', () => {
    const bi = toLines('[00:01.00]One\n[00:01.00]一\n[00:05.00]Two\n[00:05.00]二\n[00:09.00]Three\n[00:09.00]三')
    it('返回当前句原文 + 译文 + 下一句原文', () => {
      expect(lyricFrame(bi, 2)).toMatchObject({ index: 0, lyric: 'One', lyricTrans: '一', nextLyric: 'Two', nextLyricTrans: '二' })
    })
    it('最后一句没有下一句时，当前句仍有译文', () => {
      expect(lyricFrame(bi, 100)).toMatchObject({ index: 2, lyric: 'Three', lyricTrans: '三', nextLyric: '', nextLyricTrans: '' })
    })
    it('前奏时把首句作为待播放预告返回', () => {
      expect(lyricFrame(bi, 0)).toMatchObject({ index: -1, lyric: '', lyricTrans: '', nextLyric: 'One', nextLyricTrans: '一' })
    })
    it('当前句是伴奏 / 空行时，下一句跳过空行取真正的歌词', () => {
      const withGap = toLines('[00:01.00]One\n[00:05.00]\n[00:09.00]Two\n[00:13.00]\n[00:17.00]Three')
      expect(lyricFrame(withGap, 2)).toMatchObject({ index: 0, lyric: 'One', nextLyric: 'Two', nextLyricTrans: '' })
      expect(lyricFrame(withGap, 6)).toMatchObject({ index: 1, lyric: '', nextLyric: 'Two', nextLyricTrans: '' })
      expect(lyricFrame(withGap, 14)).toMatchObject({ index: 3, lyric: '', nextLyric: 'Three', nextLyricTrans: '' })
    })
    it('单语歌词译文为空、下一句仍可用', () => {
      const mono = toLines('[00:01.00]甲\n[00:05.00]乙')
      expect(lyricFrame(mono, 2)).toMatchObject({ index: 0, lyric: '甲', lyricTrans: '', nextLyric: '乙', nextLyricTrans: '' })
    })
  })
})
