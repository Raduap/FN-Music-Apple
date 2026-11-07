import { describe, expect, it } from 'vitest'
import { SYLLABLE_SOURCES } from '../electron/syllables.js'

describe('逐字数据源清单', () => {
  it('包含五个已知源且顺序为默认优先级', () => {
    expect(SYLLABLE_SOURCES).toEqual(['amll', 'liriqo', 'kugou', 'netease', 'qq'])
  })
})

