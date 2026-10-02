import { describe, expect, it } from 'vitest'
import { lineAt, toLines } from '../src/lyrics.js'

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
})
