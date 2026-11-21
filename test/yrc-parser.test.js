import { describe, expect, it } from 'vitest'
import { parseYrc } from '../electron/syllables.js'

describe('网易云 YRC 解析', () => {
  const sample = [
    JSON.stringify({ t: 0, c: [{ tx: '作词: ' }, { tx: 'Ryan Tedder' }] }),
    '[9210,4650](9210,240,0)But (9450,1200,0)baby(10650,0,0), (10650,540,0)I\'ve',
    '[14130,2100](14130,360,0)Said (14490,210,0)no (14700,330,0)more',
  ].join('\n')

  it('跳过 JSON 元数据行，保留词级歌词行', () => {
    const lines = parseYrc(sample)
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('But baby, I\'ve')
    expect(lines[1].text).toBe('Said no more')
  })

  it('词时间取绝对毫秒而非行内偏移', () => {
    const lines = parseYrc(sample)
    expect(lines[0].time).toBeCloseTo(9.21, 3)
    expect(lines[0].end).toBeCloseTo(13.86, 3)
    expect(lines[0].words[0]).toMatchObject({ text: 'But ' })
    expect(lines[0].words[0].time).toBeCloseTo(9.21, 3)
    expect(lines[0].words[1].time).toBeCloseTo(9.45, 3)
    expect(lines[0].words[1].end).toBeCloseTo(10.65, 3)
    // 第三行前的词也应使用绝对时间
    expect(lines[1].words[0].time).toBeCloseTo(14.13, 3)
  })

  it('词时长可缺省，词文本自带括号不受影响', () => {
    const yrc = '[1000,2000](1000,500,0)啊(1500,0,0)(真的)'
    const lines = parseYrc(yrc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('啊(真的)')
    expect(lines[0].words).toHaveLength(2)
    expect(lines[0].words[1].text).toBe('(真的)')
  })

  it('空行 / 无词行 / 纯元数据被跳过', () => {
    const yrc = [
      JSON.stringify({ t: 0, c: [{ tx: '作词: ' }] }),
      '',
      '[1000,500](1000,500,0)有效',
      '[2000,500]',
    ].join('\n')
    const lines = parseYrc(yrc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('有效')
  })

  it('繁体歌词被转换为简体', () => {
    expect(parseYrc('[1000,500](1000,500,0)後來')[0].text).toBe('后来')
  })
})
