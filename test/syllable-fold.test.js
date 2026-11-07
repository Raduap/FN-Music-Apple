import { describe, expect, it } from 'vitest'
import { mergeSyllableLines, normForMatch, textBagOverlap } from '../src/lyrics.js'

// 回归：《アイドル》类问题——本地 LRC 是日文/繁体原文，逐字候选源已被 opencc 转成简体。
// 折叠前逐行文本锚点大面积失配，剩余行被「按时间硬配」错位，导致部分行在自己的
// 显示窗口内永远轮不到铺色。折叠只影响「哪一行配哪一行」，不改显示文本。
describe('繁简折叠后按行锚点匹配（修复日文/繁体本地 × 简体候选的错位）', () => {
  // 与 opencc t2cn 一致：繁 -> 简
  const foldCases = [
    ['遊びに行くならどこに行くの？', '游びに行くならどこに行くの？'],
    ['それは内緒', 'それは内绪'],
    ['何を聞かれても', '何を闻かれても'],
    ['誰かを好きになることなんて', '谁かを好きになることなんて'],
    ['無敵の笑顔で荒らすメディア', '无敌の笑颜で荒らすメディア'],
  ]

  it('逐行文本归一化：繁简与历史异体字都视为同一句', () => {
    for (const [trad, simp] of foldCases) {
      expect(normForMatch(trad)).toBe(normForMatch(simp))
    }
    // 既有等价字行为不回归
    expect(normForMatch('妳')).toBe(normForMatch('你'))
    expect(normForMatch('著')).toBe(normForMatch('着'))
  })

  it('两侧只有繁简差异时，全部走文本锚点匹配（不再落到时间硬配）', () => {
    // 造一段结构相同、只有繁简差异的歌词：本地繁体，候选简体
    const pairs = [
      ['無敵の笑顔で荒らすメディア', 0],
      ['知りたいその秘密ミステリアス', 3],
      ['遊びに行くならどこに行くの？', 6],
      ['それは内緒', 9],
      ['何を聞かれても', 12],
      ['だけど燦々と', 15],
      ['見えそうで見えない秘密は蜜の味', 18],
    ]
    const local = pairs.map(([text, t]) => ({ time: t, text }))
    const cand = pairs.map(([text, t]) => ({
      time: t + 0.05,
      end: t + 2.8,
      text: normForMatch(text) === text ? text : null, // 占位，下面统一替换
      words: [{ text: normForMatch(text), time: t + 0.2, end: t + 2.5 }],
    }))
    // 用简体文本（模拟 opencc 处理过的候选）：直接对同一句做单字折叠即可
    const simp = (s) => [...s].map((c) => ({ '遊': '游', '緒': '绪', '聞': '闻', '敵': '敌', '顔': '颜', '燦': '灿', '見': '见', '誰': '谁' }[c] ?? c)).join('')
    cand.forEach((c, i) => { c.text = simp(pairs[i][0]); c.words[0].text = c.text })

    let stats = null
    const merged = mergeSyllableLines(local, cand, (s) => { stats = s })
    expect(stats.matchedPass1).toBe(local.length) // 全部命中文本锚点
    expect(stats.matched).toBe(local.length)
    // 显示文本必须一个字都不改（仍是本地原文）
    expect(merged.map((l) => l.text)).toEqual(local.map((l) => l.text))
  })

  it('不再产生「词级起点晚于下一句起点」的错位行', () => {
    const pairs = [
      ['無敵の笑顔で荒らすメディア', 0],
      ['遊びに行くならどこに行くの？', 6],
      ['それは内緒', 9],
      ['何を聞かれても', 12],
      ['だけど燦々と', 15],
    ]
    const simp = (s) => [...s].map((c) => ({ '遊': '游', '緒': '绪', '聞': '闻', '敵': '敌', '顔': '颜', '燦': '灿' }[c] ?? c)).join('')
    const local = pairs.map(([text, t]) => ({ time: t, text }))
    const cand = pairs.map(([text, t]) => ({ time: t + 0.05, end: t + 2.8, text: simp(text), words: [{ text: simp(text), time: t + 0.2, end: t + 2.5 }] }))
    const merged = mergeSyllableLines(local, cand)
    for (let i = 0; i < merged.length; i++) {
      const l = merged[i]
      if (!l.words?.length) continue
      let nextT = null
      for (let k = i + 1; k < merged.length; k++) {
        if (String(merged[k].text || '').trim()) { nextT = merged[k].time; break }
      }
      if (nextT != null) expect(l.words[0].time).toBeLessThan(nextT)
    }
  })

  it('基本功：繁简折叠不会让不同歌的字符袋重叠虚高', () => {
    expect(textBagOverlap('無敵の笑顔で荒らすメディア', '无敌の笑颜で荒らすメディア')).toBeGreaterThan(0.9)
    expect(textBagOverlap('無敵の笑顔で荒らすメディア', '我在人民广场吃炸鸡喝啤酒')).toBeLessThan(0.5)
  })
})
