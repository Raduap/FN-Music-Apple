import { describe, expect, it } from 'vitest'
import { mergeSyllableLines } from '../src/lyrics.js'
import { readFileSync } from 'node:fs'

// 真实数据回放：Apple/PetitLyrics 的《夜曲》词级数据（用户实抓）× 常见简体 LRC。
// 本地与远端存在分行差异（如 Apple 把「…走过的 走过的 / 生命」拆成两行）与
// 副歌重复段，验证两遍对齐的鲁棒性。
const dumpPath = 'dev/fixtures/yequ-apple-word-timing.json'

describe('夜曲真实数据回放（两遍对齐）', () => {
  const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
  const lines = []
  for (const raw of readFileSync('dev/fixtures/yequ.lrc', 'utf8').split('\n')) {
    const m = /\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(raw)
    if (!m) continue
    lines.push({ time: +m[1] * 60 + +m[2], text: raw.replace(/\[[^\]]*\]/g, '').trim() })
  }

  it('大部分行命中（≥85%），且命中行拼接 === 本地原文', () => {
    const merged = mergeSyllableLines(lines, dump.lines)
    const hit = merged.filter((l) => l.words?.length).length
    expect(hit / lines.length).toBeGreaterThanOrEqual(0.85)
    for (const l of merged) {
      if (l.words) expect(l.words.map((w) => w.text).join('')).toBe(l.text)
    }
  })
})
