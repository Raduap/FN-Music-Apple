import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../store'
import { Spinner } from '../components/common'
import * as Icon from '../icons'

export default function Login() {
  const login = useAuth((s) => s.login)
  const [server, setServer] = useState('')
  const [mode, setMode] = useState('nas') // nas | password
  const [form, setForm] = useState({ username: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null) // { serverName, version, nasLogin } | { error }
  const probeSeq = useRef(0)

  useEffect(() => {
    window.fn.getPrefs().then((p) => {
      if (p.lastServer) setServer(p.lastServer)
      if (p.lastMode === 'password') setMode('password')
      if (p.lastUser) setForm((f) => ({ ...f, username: p.lastUser }))
    })
  }, [])

  // 输入地址后探测服务器，显示 NAS 名称
  useEffect(() => {
    setInfo(null)
    if (!server.trim()) return
    const id = ++probeSeq.current
    const t = setTimeout(async () => {
      const r = await window.fn.serverInfo(server)
      if (id === probeSeq.current) setInfo(r.ok ? r : { error: r.error })
    }, 500)
    return () => clearTimeout(t)
  }, [server])

  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    const r = await login({ server, mode, ...form })
    if (r.ok) window.fn.setPrefs({ lastServer: server, lastMode: mode, lastUser: mode === 'password' ? form.username : '' })
    else if (!r.cancelled) setError(r.error)
    setBusy(false)
  }
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })) }
  const canSubmit = server.trim() && (mode === 'nas' || form.username.trim()) && !busy

  return (
    <div className="login">
      <div className="login-drag" />
      <div className="login-blobs"><i /><i /><i /></div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><Icon.Note size={34} /></div>
        <h1>飞牛音乐</h1>
        <p className="login-sub">登录 fnOS 以收听你的资料库</p>

        <label className="field">
          <span>服务器地址</span>
          <input className="input" placeholder="192.168.1.10:5666 或 https://nas.example.com" value={server} onChange={(e) => setServer(e.target.value)} autoFocus />
        </label>
        <div className={`server-status ${info?.error ? 'bad' : info ? 'good' : ''}`}>
          {info && !info.error && <><Icon.Check size={13} /> 已找到 {info.serverName || '飞牛 NAS'}{info.version && ` · 音乐 ${info.version}`}</>}
          {info?.error && info.error}
        </div>

        {mode === 'password' && (
          <>
            <label className="field">
              <span>用户名</span>
              <input className="input" placeholder="飞牛音乐独立账号" value={form.username} onChange={set('username')} autoComplete="username" />
            </label>
            <label className="field">
              <span>密码</span>
              <input className="input" type="password" placeholder="密码" value={form.password} onChange={set('password')} autoComplete="current-password" />
            </label>
          </>
        )}

        {error && <div className="login-error">{error}</div>}

        <button className="btn btn-accent login-btn" disabled={!canSubmit}>
          {busy ? <Spinner size={18} /> : mode === 'nas' ? '使用 NAS 账号登录' : '登录'}
        </button>

        <button type="button" className="link-btn login-switch" onClick={() => { setMode(mode === 'nas' ? 'password' : 'nas'); setError('') }}>
          {mode === 'nas' ? '使用飞牛音乐独立账号登录' : '使用 NAS 账号登录'}
        </button>

        <p className="login-hint">
          {mode === 'nas'
            ? <>将打开 fnOS 官方登录页，账号密码只在飞牛页面中输入。地址中的 <code>/music</code> 会自动补全。</>
            : <>独立账号是在飞牛音乐「设置 → 用户」中单独创建的账号，fnOS 系统账号请使用 NAS 账号登录。</>}
        </p>
      </form>
    </div>
  )
}
