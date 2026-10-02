import { useEffect, useState } from 'react'
import { useAuth } from '../store'
import { Spinner } from '../components/common'
import * as Icon from '../icons'

export default function Login() {
  const login = useAuth((s) => s.login)
  const [form, setForm] = useState({ server: '', username: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.fn.getPrefs().then((p) => {
      if (p.lastServer || p.lastUser) setForm((f) => ({ ...f, server: p.lastServer || '', username: p.lastUser || '' }))
    })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await login(form)
    if (r.ok) window.fn.setPrefs({ lastServer: form.server, lastUser: form.username })
    else setError(r.error)
    setBusy(false)
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

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
          <input className="input" placeholder="192.168.1.10:5666 或 https://nas.example.com" value={form.server} onChange={set('server')} autoFocus />
        </label>
        <label className="field">
          <span>用户名</span>
          <input className="input" placeholder="fnOS 账户" value={form.username} onChange={set('username')} autoComplete="username" />
        </label>
        <label className="field">
          <span>密码</span>
          <input className="input" type="password" placeholder="密码" value={form.password} onChange={set('password')} autoComplete="current-password" />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-accent login-btn" disabled={busy || !form.server || !form.username}>
          {busy ? <Spinner size={18} /> : '登录'}
        </button>
        <p className="login-hint">地址填 NAS 的访问地址与端口即可，<code>/music</code> 路径会自动补全。</p>
      </form>
    </div>
  )
}
