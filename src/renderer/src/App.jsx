import React, { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx'
import HubPage from './layouts/HubPage.jsx'
import WorkspaceShell from './layouts/WorkspaceShell.jsx'
import SetupWizard from './layouts/SetupWizard.jsx'
import { getAuthStatus, logout } from './services/authService.js'

// ด่านหน้าของทั้งแอป: ตัดสินจาก auth:status ว่าจะแสดงหน้าลงทะเบียน / หน้าเข้าสู่ระบบ
// / หรือตัวแอปจริง เซสชันตัวจริงอยู่ในหน่วยความจำของ main process ฝั่งนี้เก็บแค่สำเนา
// ไว้แสดงผล — ปิดแอปแล้วเปิดใหม่ต้องเข้าสู่ระบบเสมอ ไม่มี auto-login โดยตั้งใจ
//
// หลังเข้าสู่ระบบยังแบ่งอีกสองระดับตามต้นแบบ:
//   ยังไม่เลือกหอ → HubPage (เลือก/สร้างหอพัก ไม่มีเมนูข้าง)
//   เลือกหอแล้ว   → WorkspaceShell (เมนูข้างครบ ทำงานในบริบทของหอนั้น)
export default function App() {
  const [status, setStatus] = useState({ phase: 'loading' })
  const [showForgot, setShowForgot] = useState(false)
  // หอที่กำลังทำงานอยู่ เก็บไว้ในหน่วยความจำของหน้าจอเท่านั้น ไม่ได้จำข้ามการเปิดแอป
  // ตั้งใจให้เลือกใหม่ทุกครั้ง จะได้ไม่เผลอแก้ข้อมูลผิดหอเพราะระบบจำหอเดิมไว้ให้
  const [apartment, setApartment] = useState(null)
  // หอที่กำลังเดินตัวช่วยตั้งค่าอยู่ — คนละตัวกับ apartment ข้างบน เพราะยังไม่ได้
  // เข้าไปทำงานในหอนั้น แค่กำลังตั้งค่าให้เสร็จก่อน
  const [setupApartment, setSetupApartment] = useState(null)

  const loadStatus = useCallback(async () => {
    setStatus({ phase: 'loading' })
    const res = await getAuthStatus()

    if (!res.success) {
      setStatus({ phase: 'error', error: res.error })
      return
    }
    const { initialized, session, lastIdentifier } = res.data
    // ยังไม่มีบัญชีในเครื่อง = ไปหน้าลงทะเบียน (ชื่อ phase คงไว้ว่า register เพื่อให้ตรงกับ UI)
    if (!initialized) return setStatus({ phase: 'register' })
    if (!session) return setStatus({ phase: 'login', lastIdentifier })
    setStatus({ phase: 'ready', user: session })
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  function handleAuthenticated(user) {
    setShowForgot(false)
    setStatus({ phase: 'ready', user })
  }

  async function handleLogout() {
    await logout()
    // ต้องล้างหอที่เลือกไว้ด้วย ไม่งั้นคนถัดไปที่เข้าสู่ระบบบนเครื่องเดียวกัน
    // จะเด้งเข้าไปในหอที่คนก่อนหน้าเปิดค้างไว้ทันที
    setApartment(null)
    setSetupApartment(null)
    // อ่านสถานะใหม่จาก main แทนการเดาเอง จะได้ได้ lastIdentifier ล่าสุดมาเติมช่องให้ด้วย
    loadStatus()
  }

  if (status.phase === 'loading') {
    return (
      <div className="auth-screen">
        <p className="muted">กำลังเริ่มระบบ...</p>
      </div>
    )
  }

  // เปิดฐานข้อมูลได้แต่ถาม auth:status ไม่สำเร็จ = ผิดปกติจริง ต้องเห็นสาเหตุ ไม่ใช่จอว่าง
  if (status.phase === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-head">
            <div className="auth-icon-badge">
              <Icon name="warning" />
            </div>
            <h2>เริ่มระบบไม่สำเร็จ</h2>
            <p className="muted">{status.error}</p>
          </div>
          <button className="btn btn-block" onClick={loadStatus}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </div>
    )
  }

  if (status.phase === 'register') {
    return <RegisterPage onReady={handleAuthenticated} />
  }

  if (status.phase === 'login') {
    if (showForgot) {
      return (
        <ForgotPasswordPage
          onCancel={() => setShowForgot(false)}
          // ตั้งรหัสผ่านใหม่แล้วยัง "ไม่" ถือว่าเข้าสู่ระบบ ต้องกรอกรหัสใหม่ที่เพิ่งตั้งอีกครั้ง
          onDone={() => {
            setShowForgot(false)
            loadStatus()
          }}
        />
      )
    }
    return (
      <LoginPage
        lastIdentifier={status.lastIdentifier}
        onSuccess={handleAuthenticated}
        onForgotPassword={() => setShowForgot(true)}
      />
    )
  }

  // เพิ่งสร้างหอใหม่ (หรือกด "ตั้งค่าต่อ") — เดินตัวช่วยตั้งค่าให้จบก่อน
  if (setupApartment) {
    return (
      <SetupWizard
        apartment={setupApartment}
        onFinish={(a) => {
          setSetupApartment(null)
          setApartment(a)
        }}
        onExit={() => setSetupApartment(null)}
      />
    )
  }

  // เลือกหอแล้วหรือยัง คือสิ่งที่แยกว่าจะเห็นหน้ารวมหรือหน้าทำงานที่มีเมนูข้าง
  if (!apartment) {
    return (
      <HubPage
        user={status.user}
        onLogout={handleLogout}
        onOpenApartment={setApartment}
        onSetupApartment={setSetupApartment}
      />
    )
  }

  return (
    <WorkspaceShell
      apartment={apartment}
      user={status.user}
      onExit={() => setApartment(null)}
      onLogout={handleLogout}
    />
  )
}
