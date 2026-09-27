import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import InfoTip from '../components/InfoTip.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import { setupFirstUser } from '../services/authService.js'
import { restoreFirstRun } from '../services/backupService.js'

// แสดงครั้งเดียวตอนยังไม่มีบัญชีในเครื่อง
export default function RegisterPage({ onReady, onRestored }) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) /* { user, recoveryCode } */

  // เครื่องใหม่: เอาข้อมูลจากไฟล์สำรองเครื่องเดิมมาใช้ แทนการสร้างบัญชีใหม่
  async function restore() {
    setError('')
    setBusy(true)
    const res = await restoreFirstRun()
    setBusy(false)
    if (!res.success) return setError(res.error)
    if (res.data.cancelled) return
    onRestored?.(res.data)
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')

    // ช่องยืนยันรหัสผ่านตรวจที่หน้าจอเท่านั้น
    if (form.password !== form.confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }

    setBusy(true)
    const res = await setupFirstUser(form)
    setBusy(false)

    if (!res.success) {
      setError(res.error)
      return
    }
    setResult(res.data)
  }

  if (result) {
    return (
      <div className="auth-screen">
        <RecoveryCodeCard
          code={result.recoveryCode}
          title="รหัสสำรองของคุณ"
          description="ใช้สำหรับกู้คืนบัญชีในวันที่ลืมรหัสผ่าน"
          doneLabel="เข้าใช้งานระบบ"
          onDone={() => onReady(result.user)}
        />
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <form className="auth-card auth-card-wide" onSubmit={submit}>
        <div className="auth-head">
          <div className="auth-brand">Dormy Manager</div>
          <h2>ลงทะเบียน</h2>
          <p className="muted">สร้างบัญชีผู้ดูแลระบบเพื่อเริ่มใช้งาน</p>
        </div>

        <Alert>{error}</Alert>

        <div className="field">
          <label htmlFor="fullName">ชื่อ-นามสกุล</label>
          <input
            id="fullName"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoFocus
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="phone">
              เบอร์โทรศัพท์
              <InfoTip title="ใช้เข้าสู่ระบบ" points={['เบอร์โทรหรืออีเมลใช้แทนชื่อผู้ใช้ได้']} />
            </label>
            <input
              id="phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="08x-xxx-xxxx"
              inputMode="tel"
            />
          </div>

          <div className="field">
            <label htmlFor="email">
              อีเมล <span className="optional">(ไม่บังคับ)</span>
            </label>
            <input
              id="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              inputMode="email"
            />
          </div>
        </div>

        <div className="field-row">
          <PasswordField
            id="password"
            label="รหัสผ่าน"
            value={form.password}
            onChange={(v) => set('password', v)}
            autoComplete="new-password"
            hint="อย่างน้อย 8 ตัวอักษร"
          />
          <PasswordField
            id="confirmPassword"
            label="ยืนยันรหัสผ่าน"
            value={form.confirmPassword}
            onChange={(v) => set('confirmPassword', v)}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? 'กำลังลงทะเบียน...' : 'ลงทะเบียน'}
        </button>

        <p className="auth-footnote">
          ข้อมูลเก็บไว้ในเครื่องนี้เท่านั้น ไม่ส่งออกไปที่ใด
        </p>

        <div className="auth-restore">
          <p className="auth-restore-title">ย้ายมาจากเครื่องเดิม?</p>
          <p className="auth-restore-text">
            กู้คืนจากไฟล์สำรอง แล้วเข้าสู่ระบบด้วยบัญชีเดิมได้เลย ไม่ต้องลงทะเบียนใหม่
          </p>
          <button type="button" className="btn btn-outline btn-block" disabled={busy} onClick={restore}>
            <Icon name="upload" />
            <span>กู้คืนจากไฟล์สำรอง</span>
          </button>
        </div>
      </form>
    </div>
  )
}
