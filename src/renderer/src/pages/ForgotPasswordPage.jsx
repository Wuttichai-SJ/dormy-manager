import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import RecoveryCodeInput from '../components/RecoveryCodeInput.jsx'
import { resetPasswordWithTicket, verifyRecoveryCode } from '../services/authService.js'

// ลืมรหัสผ่าน 3 ขั้น: ยืนยันรหัสสำรอง → ตั้งรหัสผ่านใหม่ → รับรหัสสำรองใบใหม่
// ขั้นที่ 3 ไม่ใช่ของแถม แต่เป็นหัวใจของ rotate-on-use: ใบเก่าใช้ไม่ได้แล้วตั้งแต่วินาที
// ที่ตั้งรหัสผ่านใหม่สำเร็จ ถ้าผู้ใช้ข้ามจอนี้ไปจะเหลือกระดาษใบเก่าที่ใช้ไม่ได้อยู่ในมือ
export default function ForgotPasswordPage({ onCancel, onDone }) {
  const [step, setStep] = useState('verify') // verify | reset | done
  const [identifier, setIdentifier] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newCode, setNewCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitVerify(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await verifyRecoveryCode({ identifier, recoveryCode })
    setBusy(false)

    if (!res.success) {
      setError(res.error)
      return
    }
    // ตั๋วมีอายุ 10 นาทีนับจากตรงนี้ (main เป็นคนจับเวลา)
    setTicket(res.data.ticket)
    setFullName(res.data.fullName)
    setStep('reset')
  }

  async function submitReset(e) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }

    setBusy(true)
    const res = await resetPasswordWithTicket({ ticket, newPassword: password })
    setBusy(false)

    if (!res.success) {
      setError(res.error)
      return
    }
    setNewCode(res.data.recoveryCode)
    setStep('done')
  }

  if (step === 'done') {
    return (
      <div className="auth-screen">
        <RecoveryCodeCard
          code={newCode}
          title="รหัสสำรองใบใหม่"
          description="ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว รหัสสำรองใบเดิมถูกยกเลิกทันที กรุณาใช้ใบนี้แทน"
          doneLabel="กลับไปหน้าเข้าสู่ระบบ"
          onDone={onDone}
        />
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={step === 'verify' ? submitVerify : submitReset}>
        <div className="auth-head">
          <div className="auth-icon-badge">
            <Icon name="lock" />
          </div>
          <h2>{step === 'verify' ? 'กู้คืนด้วยรหัสสำรอง' : 'ตั้งรหัสผ่านใหม่'}</h2>
          <p className="muted">
            {step === 'verify'
              ? 'กรอกรหัสสำรองที่ได้รับตอนสร้างบัญชี (พิมพ์มีขีดหรือไม่มีขีดก็ได้)'
              : `บัญชีของ ${fullName}`}
          </p>
        </div>

        <Alert>{error}</Alert>

        {step === 'verify' ? (
          <>
            <div className="field">
              <label htmlFor="identifier">อีเมล หรือ เบอร์โทรศัพท์</label>
              <input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>

            <RecoveryCodeInput
              id="recoveryCode"
              label="รหัสสำรอง"
              value={recoveryCode}
              onChange={setRecoveryCode}
            />
          </>
        ) : (
          <>
            <PasswordField
              id="newPassword"
              label="รหัสผ่านใหม่"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              autoFocus
              hint="อย่างน้อย 8 ตัวอักษร"
            />
            <PasswordField
              id="confirmNewPassword"
              label="ยืนยันรหัสผ่านใหม่"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
            <p className="field-hint">
              เมื่อตั้งรหัสผ่านใหม่สำเร็จ ระบบจะออกรหัสสำรองใบใหม่ให้ทันที
              และรหัสสำรองใบที่เพิ่งใช้ไปจะใช้ไม่ได้อีก
            </p>
          </>
        )}

        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy
            ? 'กำลังตรวจสอบ...'
            : step === 'verify'
              ? 'ตรวจสอบรหัสสำรอง'
              : 'บันทึกรหัสผ่านใหม่'}
        </button>

        <button type="button" className="link-btn link-back" onClick={onCancel}>
          <Icon name="back" />
          <span>กลับไปหน้าเข้าสู่ระบบ</span>
        </button>
      </form>
    </div>
  )
}
