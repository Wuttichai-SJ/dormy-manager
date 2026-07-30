import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import { regenerateRecoveryCode } from '../services/authService.js'

// ส่วน "ความปลอดภัย" ในหน้าตั้งค่า — ตอนนี้มีเรื่องเดียวคือออกรหัสสำรองใบใหม่
// สำหรับกรณีที่กระดาษที่จดไว้หาย/หลุดไปถึงคนอื่น จะได้ไม่ต้องรอให้ลืมรหัสผ่านก่อน
// (หน้าอื่นๆ ของโมดูลตั้งค่า เช่น ข้อมูลหอพัก/ผู้ใช้งาน จะมาในเฟสถัดไป)
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
          <dt>เบอร์โทรศัพท์</dt>
          <dd>{user.phone}</dd>
        </div>
        <div>
          <dt>อีเมล</dt>
          <dd>{user.email || '—'}</dd>
        </div>
      </dl>

      <hr className="divider" />

      <h3 className="panel-subtitle">รหัสสำรอง</h3>
      <p className="muted">
        ใช้กู้คืนบัญชีเมื่อลืมรหัสผ่าน หากคิดว่ารหัสสำรองที่จดไว้หายหรือมีคนอื่นเห็น
        ให้ออกใบใหม่ที่นี่ — ใบเดิมจะใช้ไม่ได้ทันที
      </p>

      {asking ? (
        <form className="inline-form" onSubmit={submit}>
          <Alert>{error}</Alert>
          {/* ต้องยืนยันรหัสผ่านก่อน ไม่งั้นใครเดินมาที่เครื่องที่เปิดค้างไว้ก็กดออกรหัสใหม่ได้ */}
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
    </div>
  )
}
