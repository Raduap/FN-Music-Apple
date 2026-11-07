import { describe, expect, it } from 'vitest'
import { artistMatches, looksLikeLyricLines } from '../electron/syllables.js'

describe('艺人名匹配（QQ 源用）', () => {
  it('完全一致或包含关系视为同一艺人', () => {
    expect(artistMatches('周杰伦', '周杰伦')).toBe(true)
    expect(artistMatches('theweeknd', 'theweeknd')).toBe(true)
    expect(artistMatches('onerepublicexcerpt', 'onerepublic')).toBe(true)
    expect(artistMatches('周杰伦', '周杰伦/潘儿')).toBe(true)
  })

  it('同一歌手的异名写法靠共享汉字前缀通过', () => {
    // 本地「宇多田ヒカル」vs QQ 的「宇多田光」
    expect(artistMatches('宇多田ヒカル', '宇多田光')).toBe(true)
    expect(artistMatches('高橋洋子', '高橋洋子')).toBe(true)
  })

  it('不同艺人不会误判', () => {
    expect(artistMatches('周杰伦', '林俊杰')).toBe(false)
    expect(artistMatches('adele', 'edsheeran')).toBe(false)
    expect(artistMatches('', '周杰伦')).toBe(false)
    expect(artistMatches('周杰伦', '')).toBe(false)
  })

  it('单个汉字前缀不算命中，至少两个', () => {
    expect(artistMatches('林俊杰', '林志炫')).toBe(false)
  })
})

describe('真歌词行判据（QQ 源用）', () => {
  it('铺开到 5 秒之后的算真歌词', () => {
    expect(looksLikeLyricLines([{ time: 0 }, { time: 6 }])).toBe(true)
    expect(looksLikeLyricLines([{ time: 0 }, { time: 90 }, { time: 200 }])).toBe(true)
  })

  it('只有开头几秒的 credit 名单被识别为非歌词', () => {
    expect(looksLikeLyricLines([{ time: 0 }, { time: 1.757 }])).toBe(false)
    expect(looksLikeLyricLines([{ time: 0.01 }, { time: 0.08 }, { time: 0.154 }])).toBe(false)
  })

  it('空 / 单行 / 非法输入为 false', () => {
    expect(looksLikeLyricLines([])).toBe(false)
    expect(looksLikeLyricLines(null)).toBe(false)
    expect(looksLikeLyricLines([{ time: 100 }])).toBe(false)
    expect(looksLikeLyricLines([{ time: NaN }, { time: 'x' }])).toBe(false)
  })
})
