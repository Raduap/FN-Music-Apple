import { describe, expect, it } from 'vitest'
import { mergeSyllableLines } from '../src/lyrics.js'

describe('逐字时间轴拼接不变性（显示内容永不改动）', () => {
  const line = (text, time, words) => ({ text, time, words })

  it('CJK：远端分词数不同时，spans 拼接 === 本地原文（含空格）', () => {
    const local = { time: 10, text: '一群嗜血的蚂蚁 被腐肉所吸引' }
    const remote = [line('一群嗜血的蚂蚁 被腐肉所吸引', 10, [
      { text: '一群', time: 10, end: 10.5 }, { text: '嗜血', time: 10.5, end: 11 },
      { text: '的蚂蚁', time: 11, end: 11.8 }, { text: '被腐肉', time: 12, end: 12.6 }, { text: '所吸引', time: 12.6, end: 13.2 },
    ])]
    const spans = mergeSyllableLines([local], remote)[0].words
    expect(spans.map((s) => s.text).join('')).toBe(local.text)
    expect(spans.map((s) => s.text).join('')).not.toContain('妳')
  })

  it('英文：远端 4 词、本地 4 词，拼接保持原样', () => {
    const local = { time: 1, text: 'Look at the stars' }
    const remote = [line('Look at the stars', 1, [
      { text: 'Look', time: 1, end: 1.4 }, { text: 'at', time: 1.4, end: 1.7 },
      { text: 'the', time: 1.7, end: 2 }, { text: 'stars', time: 2, end: 2.5 },
    ])]
    const spans = mergeSyllableLines([local], remote)[0].words
    expect(spans.map((s) => s.text).join('')).toBe('Look at the stars')
  })

  it('远端 5 词、本地 4 词（分行差异）：拼接仍是本地原文', () => {
    const local = { time: 1, text: 'Look at the stars' }
    const remote = [line('Look at the stars', 1, [
      { text: 'Lo', time: 1, end: 1.2 }, { text: 'ok', time: 1.2, end: 1.4 }, { text: 'at', time: 1.4, end: 1.7 },
      { text: 'the', time: 1.7, end: 2 }, { text: 'stars', time: 2, end: 2.5 },
    ])]
    const spans = mergeSyllableLines([local], remote)[0].words
    expect(spans.map((s) => s.text).join('')).toBe('Look at the stars')
  })
})
