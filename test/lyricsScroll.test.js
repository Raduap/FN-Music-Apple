import { describe, expect, it } from 'vitest'
import { LYRICS_RESUME_DELAY, shouldFollowPlayback, shouldPinToggle } from '../src/lyricsScroll.js'

describe('lyrics auto-scroll policy', () => {
  it('follows the active line when the user has not scrolled', () => {
    expect(shouldFollowPlayback(1000, 0)).toBe(true)
  })

  it('pauses playback following during the three second grace period', () => {
    expect(LYRICS_RESUME_DELAY).toBe(3000)
    expect(shouldFollowPlayback(3999, 1000)).toBe(false)
  })

  it('resumes playback following at exactly three seconds', () => {
    expect(shouldFollowPlayback(4000, 1000)).toBe(true)
  })

  it('does not pin subtitle toggles while returning to the active line', () => {
    expect(shouldPinToggle(true)).toBe(false)
    expect(shouldPinToggle(false)).toBe(true)
  })
})
