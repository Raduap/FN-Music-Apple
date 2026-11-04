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

// 定时中止信号：ms 毫秒后自动中止请求。调用 clear() 可取消计时——
// 长连接（音频流）在拿到响应头之后就不应再中止，否则播放中途会被切断。
function abortAfter(ms, message = '服务器响应超时') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(message)), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

// 把上游响应体包一层，用于音频流：
// - 失效歌曲常见表现是“响应头已到、响应体却迟迟不来”。此时播放器会主动索取数据，
//   我们就在这里计时：超过 idleMs 仍拿不到数据 → 中止上游，释放连接。
// - 只有在“消费者正在索取数据却拿不到”时才计时。消费者停止索取（例如播放器缓冲已满、
//   不再 pull）时不计时，否则会误杀正常播放。
// - 下游取消（切歌 / 换源）时把取消传播给上游，立即释放连接。
function streamWithIdle(body, { idleMs, abort }) {
  if (!body || typeof body.getReader !== 'function') return body
  const reader = body.getReader()
  let ctrlRef = null
  let timer = null
  const idle = () => {
    const err = new Error('音频流空闲超时')
    try { abort?.(err) } catch {}
    try { ctrlRef?.error(err) } catch {} // 同时让下游停止等待，避免消费端悬挂
  }
  return new ReadableStream({
    start(ctrl) { ctrlRef = ctrl },
    async pull(ctrl) {
      ctrlRef = ctrl
      // 只在“消费者正在索取数据”时计时：拿到数据或消费者停止索取都不会触发
      timer = setTimeout(idle, idleMs)
      try {
        const { done, value } = await reader.read()
        clearTimeout(timer)
        if (done) { ctrl.close(); return }
        ctrl.enqueue(value)
      } catch (e) {
        clearTimeout(timer)
        ctrl.error(e)
      }
    },
    cancel(reason) {
      clearTimeout(timer)
      try { abort?.(reason) } catch {}
      reader.cancel(reason).catch(() => {})
    },
  })
}

function friendlyError(e) {
  let msg = (e && e.message) || String(e)
  if (/abort|timeout|timed out|ERR_TIMED|请求超时|响应超时/i.test(msg)) msg = '服务器响应超时，请检查网络或降级服务器负载'
  else if (/ERR_CONNECTION|ERR_NAME|ERR_ADDRESS|ERR_TIMED|ERR_INTERNET|fetch failed/i.test(msg)) msg = '无法连接到服务器，请检查地址与网络'
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

module.exports = { sha256, md5, newDeviceId, normalizeBase, hostOf, signPayload, authx, abortAfter, streamWithIdle, friendlyError, truncate, trayTooltip }
