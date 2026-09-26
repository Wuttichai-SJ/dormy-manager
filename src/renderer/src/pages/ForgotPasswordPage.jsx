import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import RecoveryCodeInput from '../components/RecoveryCodeInput.jsx'
import { resetPasswordWithTicket, verifyRecoveryCode } from '../services/authService.js'

// 3 ขั้น: ยืนยันรหัสสำรอง → ตั้งรหัสใหม่ → รับรหัสสำรองใบใหม่ (ใบเก่าใช้ไม่ได้แล้ว)
export default function ForgotPasswordPage({ onCancel, onDone }) {
  const [step, setStep] = useState('verify') /* verify | reset | done */
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
          description="ตั้งรหัสผ่านใหม่แล้ว · รหัสสำรองใบเดิมใช้ไม่ได้อีก"
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
              ? 'กรอกรหัสสำรองที่ได้ตอนสร้างบัญชี'
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
              ตั้งสำเร็จแล้วจะได้รหัสสำรองใบใหม่ · ใบเดิมใช้ไม่ได้อีก
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
