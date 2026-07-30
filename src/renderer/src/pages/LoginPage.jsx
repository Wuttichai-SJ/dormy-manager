import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import { login } from '../services/authService.js'

// หน้าเข้าสู่ระบบ — โครงหน้าตามต้นแบบ (ช่องเดียวรับได้ทั้งอีเมลและเบอร์โทร, จดจำฉัน,
// ลืมรหัสผ่าน) ต่างกันตรงที่ต้นแบบยิง OTP ต่อหลังกรอกรหัสผ่าน ส่วนแอปนี้เข้าระบบทันที
// เพราะเป็นเครื่องเดี่ยวในสำนักงานหอพักที่อาจไม่มีอินเทอร์เน็ตเลย
export default function LoginPage({ lastIdentifier = '', onSuccess, onForgotPassword }) {
  const [identifier, setIdentifier] = useState(lastIdentifier)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(Boolean(lastIdentifier))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await login({ identifier, password, remember })
    setBusy(false)

    if (!res.success) {
      // ล้างเฉพาะรหัสผ่าน ปล่อยช่องชื่อผู้ใช้ไว้ให้พิมพ์ซ้ำน้อยที่สุด
      setPassword('')
      setError(res.error)
      return
    }
    onSuccess(res.data.user)
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-head">
          <div className="auth-brand">Dormy Manager</div>
          <h2>เข้าสู่ระบบ</h2>
          <p className="muted">ระบบจัดการหอพัก</p>
        </div>

        <Alert>{error}</Alert>

        <div className="field">
          <label htmlFor="identifier">อีเมล หรือ เบอร์โทรศัพท์</label>
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoFocus={!lastIdentifier}
          />
        </div>

        <PasswordField
          id="password"
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          autoFocus={Boolean(lastIdentifier)}
        />

        <div className="form-row-between">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {/* จำแค่ชื่อผู้ใช้ ไม่ใช่การคงสถานะเข้าสู่ระบบ — ข้อความต้องไม่ทำให้เข้าใจผิด */}
            <span>จดจำชื่อผู้ใช้</span>
          </label>

          <button type="button" className="link-btn" onClick={onForgotPassword}>
            ลืมรหัสผ่าน?
          </button>
        </div>

        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  )
}
