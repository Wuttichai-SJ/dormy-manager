import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import { showToast } from '../components/Toast.jsx'
import { regenerateRecoveryCode } from '../services/authService.js'
import { changeOwnPassword } from '../services/userService.js'

export default function SecuritySettingsPage({ user }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [asking, setAsking] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await regenerateRecoveryCode({ password })
    setBusy(false)
    setPassword('')

    if (!res.success) {
      setError(res.error)
      return
    }
    setNewCode(res.data.recoveryCode)
    setAsking(false)
  }

  if (newCode) {
    return (
      <RecoveryCodeCard
        code={newCode}
        title="รหัสสำรองใบใหม่"
        description="ออกรหัสสำรองใบใหม่เรียบร้อยแล้ว ใบเดิมใช้ไม่ได้อีกต่อไป"
        doneLabel="เสร็จสิ้น"
        onDone={() => setNewCode('')}
      />
    )
  }

  return (
    <div className="panel">
      <h2 className="panel-title">ความปลอดภัย</h2>

      <dl className="detail-list">
        <div>
          <dt>ชื่อผู้ใช้</dt>
          <dd>{user.fullName}</dd>
        </div>
        <div>
          <dt>บทบาท</dt>
          <dd>{user.roleLabel ?? '—'}</dd>
        </div>
        <div>
          <dt>เบอร์โทรศัพท์</dt>
          <dd>{user.phone}</dd>
        </div>
        <div>
          <dt>อีเมล</dt>
          <dd>{user.email || '—'}</dd>
        </div>
      </dl>

      <hr className="divider" />

      <ChangePasswordSection />

      <hr className="divider" />

      <h3 className="panel-subtitle">รหัสสำรอง</h3>
      {user.isOwner === false ? (
        <p className="muted">
          บัญชีพนักงานไม่มีรหัสสำรอง · ลืมรหัสผ่านให้เจ้าของหอตั้งใหม่ให้
        </p>
      ) : (
        <>
      <p className="muted">
        ใช้กู้บัญชีเมื่อลืมรหัสผ่าน · ออกใบใหม่แล้วใบเดิมใช้ไม่ได้ทันที
      </p>

      {asking ? (
        <form className="inline-form" onSubmit={submit}>
          <Alert>{error}</Alert>
          <PasswordField
            id="currentPassword"
            label="ยืนยันรหัสผ่านปัจจุบัน"
            value={password}
            onChange={setPassword}
            autoFocus
          />
          <div className="button-row">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังออกรหัสใหม่...' : 'ออกรหัสสำรองใบใหม่'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAsking(false)
                setPassword('')
                setError('')
              }}
            >
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setAsking(true)}>
          ออกรหัสสำรองใบใหม่
        </button>
      )}
        </>
      )}
    </div>
  )
}

function ChangePasswordSection() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const res = await changeOwnPassword(form)
    setBusy(false)
    if (!res.success) return setError(res.error)

    setForm({ currentPassword: '', newPassword: '' })
    setAsking(false)
    showToast('เปลี่ยนรหัสผ่านแล้ว')
  }

  return (
    <>
      <h3 className="panel-subtitle">รหัสผ่าน</h3>
      <p className="muted">
        รหัสสำรองไม่เปลี่ยนตาม
      </p>

      {asking ? (
        <form className="inline-form" onSubmit={submit}>
          <Alert>{error}</Alert>
          <PasswordField
            id="currentPasswordForChange"
            label="รหัสผ่านปัจจุบัน"
            value={form.currentPassword}
            onChange={(v) => setForm((f) => ({ ...f, currentPassword: v }))}
            autoFocus
          />
          <PasswordField
            id="newPassword"
            label="รหัสผ่านใหม่"
            value={form.newPassword}
            onChange={(v) => setForm((f) => ({ ...f, newPassword: v }))}
            autoComplete="new-password"
            hint="อย่างน้อย 8 ตัวอักษร"
          />
          <div className="button-row">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'กำลังเปลี่ยน...' : 'เปลี่ยนรหัสผ่าน'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAsking(false)
                setForm({ currentPassword: '', newPassword: '' })
                setError('')
              }}
            >
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setAsking(true)}>
          เปลี่ยนรหัสผ่าน
        </button>
      )}
    </>
  )
}
