// 逐字歌词审计：从本地曲库目录读取曲目 + 同名 LRC（如 V:\）。
// 目录结构约定：平铺，`艺人 - 标题.ext` 与同名 .lrc 成对。
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const AUDIO_EXT = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.wav', '.ape', '.wma', '.aac'])

// `艺人 - 标题`；标题里可能含 " - "，只按第一个分隔符拆。
function parseName(base) {
  const i = base.indexOf(' - ')
  if (i < 0) return { artist: '', title: base.trim() }
  return { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() }
}

/**
 * 扫描曲库目录，返回带 LRC 的曲目清单。
 * @param dir 曲库根目录（如 V:\ ）
 * @param opts { requireLrc=true } 缺少同名字幕的曲目是否跳过
 */
function loadLibrary(dir, { requireLrc = true } = {}) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const audio = []
  const lrcByBase = new Map()
  for (const e of entries) {
    if (!e.isFile()) continue
    const ext = path.extname(e.name).toLowerCase()
    if (ext === '.lrc') lrcByBase.set(path.basename(e.name, ext), path.join(dir, e.name))
    else if (AUDIO_EXT.has(ext)) audio.push(e.name)
  }
  const tracks = []
  for (const name of audio) {
    const base = path.basename(name, path.extname(name))
    const lrcPath = lrcByBase.get(base)
    if (requireLrc && !lrcPath) continue
    const { artist, title } = parseName(base)
    let lrcText = ''
    if (lrcPath) { try { lrcText = fs.readFileSync(lrcPath, 'utf8') } catch { lrcText = '' } }
    tracks.push({ base, title, artist, audioPath: path.join(dir, name), lrcPath: lrcPath || '', lrcText })
  }
  return tracks
}

module.exports = { loadLibrary, parseName, AUDIO_EXT }
