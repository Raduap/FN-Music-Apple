import { describe, expect, it } from 'vitest'
import { parseKrc } from '../electron/syllables.js'

describe('酷狗 KRC 解析', () => {
  it('词绝对时间 = 行起始 + 词偏移（毫秒转秒）', () => {
    const krc = [
      '[offset:0]',
      '[21542,1810]<0,210,0>对<210,190,0>这<400,120,0>个',
      '[23372,1620]<0,180,0>世<180,170,0>界',
    ].join('\n')
    const lines = parseKrc(krc)
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('对这个')
    expect(lines[0].time).toBeCloseTo(21.542, 3)
    expect(lines[0].end).toBeCloseTo(23.352, 3)
    expect(lines[0].words[0]).toMatchObject({ text: '对' })
    expect(lines[0].words[0].time).toBeCloseTo(21.542, 3)
    expect(lines[0].words[0].end).toBeCloseTo(21.752, 3)
    expect(lines[0].words[2].time).toBeCloseTo(21.942, 3)
    expect(lines[1].words[1].time).toBeCloseTo(23.552, 3)
  })

  it('offset 行会把整首歌词整体平移', () => {
    const krc = '[offset:500]\n[1000,500]<0,500,0>你好'
    const lines = parseKrc(krc)
    expect(lines[0].time).toBeCloseTo(1.5, 3)
    expect(lines[0].words[0].time).toBeCloseTo(1.5, 3)
  })

  it('空行 / 无词行 / 全空文本被跳过', () => {
    const krc = [
      '[offset:0]',
      '',
      '[1000,500]<0,500,0>有效',
      '[2000,500]',
      '[3000,500]<0,500,0>   ',
    ].join('\n')
    const lines = parseKrc(krc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('有效')
  })

  it('繁体歌词被转换为简体', () => {
    const krc = '[offset:0]\n[1000,500]<0,500,0>後來'
    expect(parseKrc(krc)[0].text).toBe('后来')
  })
})
