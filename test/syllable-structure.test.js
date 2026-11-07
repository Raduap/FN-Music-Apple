import { describe, expect, it } from 'vitest'
import { mergeSyllableLines, pickSyllableCandidate } from '../src/lyrics.js'
import { durationScore, scoreVersion } from '../electron/syllables.js'

// 形如 KRC / QRC 的候选：每行带词级时间轴
const wl = (text, t, e) => ({ text, time: t, end: e })
const remote = (text, t, e, parts) => ({ text, time: t, end: e, words: parts.map((p, i) => wl(p, t + i * 0.5, t + (i + 1) * 0.5)) })

describe('逐字合并：候选与本地结构不一致时不硬配（防假逐字）', () => {
  // 本地 8 行、跨度 70s；候选是「只有片段」的版本：8 行但跨度只有 20s、且文本全对不上。
  const local = Array.from({ length: 8 }, (_, i) => ({ time: 10 + i * 10, text: `本地第${i + 1}句` }))
  const fragment = Array.from({ length: 8 }, (_, i) => remote(`其它版本第${i + 1}句`, 1 + i * 2.5, 3 + i * 2.5, ['x']))

  it('跨度严重不匹配时只保留文本锚点，不做时间硬配', () => {
    const merged = mergeSyllableLines(local, fragment)
    const hit = merged.filter((l) => l.words?.length).length
    expect(hit).toBe(0) // 没有文本锚点，就不该产出任何逐字
  })

  it('门控统计会写进 debug，便于线上排查', () => {
    let stats = null
    mergeSyllableLines(local, fragment, (s) => { stats = s })
    expect(stats.structure.pass2).toBe(false)
    expect(stats.structure.spanRatio).toBeLessThan(0.8)
  })

  it('结构一致时仍然照常配对（不误伤正常候选）', () => {
    const good = local.map((l) => remote(l.text, l.time, l.time + 3, [l.text]))
    const merged = mergeSyllableLines(local, good)
    expect(merged.filter((l) => l.words?.length).length).toBe(8)
  })

  it('片段候选不会被选成最优（覆盖率必然低于结构一致候选）', () => {
    const good = local.map((l) => remote(l.text, l.time, l.time + 3, [l.text]))
    const pick = pickSyllableCandidate(local, [
      { source: 'bad', provider: 'fragment', lines: fragment },
      { source: 'good', provider: 'full', lines: good },
    ])
    expect(pick.source).toBe('good')
    expect(pick.coverage).toBe(1)
  })
})

describe('数据源版本打分', () => {
  // 回归：上传者标注「3D环绕版 / Live / DJ版」的条目经常直接复用原版歌词，
  // 这类候选只能被轻微降权排序，绝不能被打到负分而淘汰（否则会漏掉唯一正确候选）。
  it('带版本标记的同名候选不会被淘汰（不返回负分）', () => {
    const s = scoreVersion({ name: '无人之岛 (3D环绕版)', candArtist: '宝藏歌单挖掘姬', candDuration: 290, title: '无人之岛', artist: '任然', duration: 285 })
    expect(s).toBeGreaterThan(0)
  })

  it('本地就是 Live 版时，Live 候选不再被罚', () => {
    const withPenalty = scoreVersion({ name: '蜗牛 (Live)', candArtist: '华语群星', candDuration: 141, title: '蜗牛', artist: '华语群星', duration: 141 })
    const sameAsLocal = scoreVersion({ name: '蜗牛 (Live)', candArtist: '华语群星', candDuration: 141, title: '蜗牛 (Live)', artist: '华语群星', duration: 141 })
    expect(sameAsLocal).toBeGreaterThanOrEqual(withPenalty)
  })

  it('歌名对不上仍返回 -1（由调用方淘汰）', () => {
    expect(scoreVersion({ name: '无关歌曲', candArtist: 'x', title: '无人之岛', artist: 'y' })).toBe(-1)
  })

  it('时长接近得高分，差 45s 以上归零', () => {
    expect(durationScore(240, 241)).toBe(1)
    expect(durationScore(240, 260)).toBeGreaterThan(0.3)
    expect(durationScore(240, 400)).toBe(0)
  })

  it('时长缺失时不奖不罚', () => {
    expect(durationScore(240, 0)).toBe(0.5)
    expect(durationScore(0, 240)).toBe(0.5)
  })
})
