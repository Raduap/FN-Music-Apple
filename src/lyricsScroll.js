export const LYRICS_RESUME_DELAY = 3000

export function shouldFollowPlayback(now, lastUserScroll) {
  return !lastUserScroll || now - lastUserScroll >= LYRICS_RESUME_DELAY
}

export function shouldPinToggle(returning) {
  return !returning
}
