// 手动连续点击“下一首”时，把短窗口内的点击合并成一次真正切歌。
// 语义仍然按点击次数前进；只推迟音频/歌词/翻译/逐字等重请求的启动。
export const RAPID_NEXT_DELAY = 140

export function advanceIndex(index, length, { wrap = true } = {}) {
  const n = Number(length) || 0
  if (n <= 0) return -1
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= n) return 0
  if (i + 1 < n) return i + 1
  return wrap ? 0 : -1
}
