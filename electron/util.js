// 主进程中不依赖 Electron 的纯函数，单独成文件以便单元测试
const crypto = require('crypto')

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')
const newDeviceId = () => crypto.randomBytes(16).toString('hex')

// 用户输入的地址 → 飞牛音乐服务根地址，例如 192.168.1.10:5666 → http://192.168.1.10:5666/music
function normalizeBase(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  url = url.replace(/\/+$/, '')
  if (!/\/music$/i.test(url)) url += '/music'
  return url
}

// 地址 → 主机名（不含端口与 IPv6 方括号，小写）；无效地址返回空串
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1') } catch { return '' }
}

// ---------- authx 签名（与飞牛音乐网页端一致） ----------
const SIGN_PREFIX = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh'
const SIGN_KEY = '6D5602D4-A342-4799-A0F0-BB795E7167D0'

// GET 请求签名的是排序后的查询串，其余方法签名的是请求体
function signPayload(method, url, body) {
  if (method.toUpperCase() !== 'GET') return md5(body ? Buffer.from(body).toString('utf8') : '')
  const u = new URL(url)
  const sorted = new URLSearchParams()
  for (const k of [...new Set(u.searchParams.keys())].sort()) {
    for (const v of u.searchParams.getAll(k)) if (v !== 'undefined' && v !== 'null') sorted.append(k, v)
  }
  const encoded = sorted.toString().replace(/\+/g, '%20')
  try { return md5(decodeURIComponent(encoded.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'))) } catch { return md5(encoded) }
}

function authx(method, url, body, { nonce = String(Math.floor(Math.random() * 9e5) + 1e5), ts = String(Date.now()) } = {}) {
  const payload = signPayload(method, url, body)
  const sign = md5([SIGN_PREFIX, new URL(url).pathname, nonce, ts, payload, SIGN_KEY].join('_'))
  return `nonce=${nonce}&timestamp=${ts}&sign=${sign}`
}

function friendlyError(e) {
  let msg = (e && e.message) || String(e)
  if (/ERR_CONNECTION|ERR_NAME|ERR_ADDRESS|ERR_TIMED|ERR_INTERNET|fetch failed/i.test(msg)) msg = '无法连接到服务器，请检查地址与网络'
  else if (/CERT/i.test(msg)) msg = 'HTTPS 证书不受信任'
  return msg
}

// 按字符（而非 UTF-16 码元）截断，避免把 emoji 等切成半个
function truncate(text, max) {
  const chars = Array.from(String(text || ''))
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…'
}

// 托盘提示文字。Windows 限制最多 127 个字符
function trayTooltip({ title, artist, playing } = {}) {
  if (!title) return '飞牛音乐'
  return truncate(`飞牛音乐\n${playing ? '' : '已暂停：'}${title}${artist ? ' — ' + artist : ''}`, 127)
}

module.exports = { sha256, md5, newDeviceId, normalizeBase, hostOf, signPayload, authx, friendlyError, truncate, trayTooltip }
