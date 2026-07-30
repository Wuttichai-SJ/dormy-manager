import React, { useState } from 'react'
import Alert from '../components/Alert.jsx'
import PasswordField from '../components/PasswordField.jsx'
import RecoveryCodeCard from '../components/RecoveryCodeCard.jsx'
import { setupFirstUser } from '../services/authService.js'

// หน้า "ลงทะเบียน" — วางหน้าตาให้ตรงกับหน้าลงทะเบียนของต้นแบบ (app.yeeraf.com)
// เพราะผู้ใช้เคยใช้เว็บนั้นมาก่อน จะได้ไม่ต้องเรียนรู้ใหม่
//
// แต่เบื้องหลังไม่เหมือนกัน และห้ามลืมข้อนี้: นี่ไม่ใช่การสมัครสมาชิกกับบริการออนไลน์
// บัญชีถูกสร้างลงไฟล์ในเครื่องนี้เครื่องเดียว และหน้านี้จะโผล่มาแค่ครั้งเดียวตลอดการติดตั้ง
// คือตอนที่ยังไม่มีบัญชีใดๆ ในฐานข้อมูล (main กันซ้ำไว้อีกชั้นด้วย isInitialized)
// ผู้ใช้คนถัดๆ ไปเกิดจากหน้าจัดการผู้ใช้ ไม่ใช่จากหน้านี้
export default function RegisterPage({ onReady }) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { user, recoveryCode }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')

    // ช่องยืนยันรหัสผ่านมีอยู่แค่ฝั่งหน้าจอ ฝั่ง main ไม่รู้จัก จึงต้องตรวจที่นี่
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
    // main สร้างเซสชันให้แล้วตั้งแต่ตอนสร้างบัญชี แต่ยังไม่พาเข้าแอปจนกว่าจะจดรหัสสำรอง
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
            <label htmlFor="phone">เบอร์โทรศัพท์</label>
            <input
              id="phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="08x-xxx-xxxx"
              inputMode="tel"
            />
            <p className="field-hint">ใช้เข้าสู่ระบบได้</p>
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
            <p className="field-hint">ถ้ากรอก จะใช้เข้าสู่ระบบได้อีกทาง</p>
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

        {/* ต้นแบบมีลิงก์ "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ" ตรงนี้ — ที่นี่ไม่ใส่โดยตั้งใจ
            เพราะหน้านี้แสดงก็ต่อเมื่อยังไม่มีบัญชีในเครื่อง ลิงก์นั้นจะพาไปสู่หน้า
            เข้าสู่ระบบที่ล็อกอินไม่ได้แน่ๆ กลายเป็นทางตัน */}
        <p className="auth-footnote">
          บัญชีนี้ถูกสร้างและเก็บไว้ในเครื่องนี้เท่านั้น ไม่ได้ส่งข้อมูลออกไปที่ใด
          และหน้านี้จะแสดงเฉพาะครั้งแรกที่ยังไม่มีบัญชีในระบบ
        </p>
      </form>
    </div>
  )
}
