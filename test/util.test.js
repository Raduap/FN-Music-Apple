import { describe, expect, it } from 'vitest'
import util from '../electron/util.js'

const { normalizeBase, hostOf, authx, signPayload, md5, sha256, friendlyError } = util

describe('normalizeBase', () => {
  it.each([
    ['192.168.1.10:5666', 'http://192.168.1.10:5666/music'],
    ['  192.168.1.10:5666/  ', 'http://192.168.1.10:5666/music'],
    ['https://nas.example.com', 'https://nas.example.com/music'],
    ['HTTPS://nas.example.com/music/', 'HTTPS://nas.example.com/music'],
    ['http://nas:5666/MUSIC', 'http://nas:5666/MUSIC'],
    ['', ''],
    [null, ''],
  ])('%s → %s', (input, out) => expect(normalizeBase(input)).toBe(out))
})

describe('hostOf', () => {
  it('取主机名，去掉端口并转小写', () => expect(hostOf('https://NAS.Local:5667/music')).toBe('nas.local'))
  it('IPv6 去掉方括号', () => expect(hostOf('http://[::1]:5666/music')).toBe('::1'))
  it('无效地址返回空串', () => expect(hostOf('not a url')).toBe(''))
})

describe('authx 签名', () => {
  // 参考值由原始实现（与飞牛音乐网页端一致）在固定 nonce / 时间戳下算出
  it('GET 请求', () => {
    expect(authx('GET', 'http://nas:5666/music/api/v1/album/list?sort=name,asc&page=1&size=500', undefined, { nonce: '123456', ts: '1700000000000' }))
      .toBe('nonce=123456&timestamp=1700000000000&sign=740518b05883cab5a1208ed659ae2086')
  })
  it('POST 请求签名请求体', () => {
    expect(authx('POST', 'http://nas:5666/music/api/v1/user/password-login', '{"username":"demo"}', { nonce: '654321', ts: '1700000000001' }))
      .toBe('nonce=654321&timestamp=1700000000001&sign=8a6cd92357bffbd92bdf63bf8edb8217')
  })
  it('GET 参数按键排序，并忽略 undefined / null 值', () => {
    expect(signPayload('GET', 'http://x/a?b=2&a=1&c=undefined&d=null')).toBe(md5('a=1&b=2'))
  })
  it('GET 参数中的空格编码为 %20 后再解码', () => {
    expect(signPayload('GET', 'http://x/a?q=a+b')).toBe(md5('q=a b'))
  })
  it('非法的百分号编码不会抛错', () => {
    expect(() => signPayload('GET', 'http://x/a?q=100%')).not.toThrow()
  })
  it('请求体为空时签名空串', () => expect(signPayload('POST', 'http://x/a')).toBe(md5('')))
  it('默认 nonce 为 6 位数字', () => expect(authx('GET', 'http://x/a')).toMatch(/^nonce=\d{6}&timestamp=\d+&sign=[0-9a-f]{32}$/))
})

describe('其他', () => {
  it('sha256', () => expect(sha256('demo')).toBe('2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea'))
  it('网络错误转换为中文提示', () => {
    expect(friendlyError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe('无法连接到服务器，请检查地址与网络')
    expect(friendlyError(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('HTTPS 证书不受信任')
    expect(friendlyError(new Error('其他错误'))).toBe('其他错误')
  })
})
