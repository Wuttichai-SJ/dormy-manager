import React, { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx'
import SecuritySettingsPage from './pages/SecuritySettingsPage.jsx'
import { getAuthStatus, logout } from './services/authService.js'

// Navigation mirrors app.yeeraf.com's module grouping (layout follows the source site;
// colors deliberately differ — muted, not garish). Real pages arrive per build phase.
const NAV = [
  { key: 'dashboard', label: 'ภาพรวม' },
  { key: 'apartments', label: 'หอพัก' },
  { key: 'rooms', label: 'ห้องพัก' },
  { key: 'tenants', label: 'ผู้เช่า' },
  { key: 'contracts', label: 'สัญญา' },
  { key: 'bookings', label: 'การจอง' },
  { key: 'meters', label: 'จดมิเตอร์' },
  { key: 'invoices', label: 'ใบแจ้งหนี้' },
  { key: 'payments', label: 'การชำระเงิน' },
  { key: 'maintenance', label: 'แจ้งซ่อม' },
  { key: 'settings', label: 'ตั้งค่า' }
]

// ด่านหน้าของทั้งแอป: ตัดสินจาก auth:status ว่าจะแสดงหน้าตั้งค่าครั้งแรก / หน้าเข้าสู่ระบบ
// / หรือตัวแอปจริง เซสชันตัวจริงอยู่ในหน่วยความจำของ main process ฝั่งนี้เก็บแค่สำเนา
// ไว้แสดงผล — ปิดแอปแล้วเปิดใหม่ต้องเข้าสู่ระบบเสมอ ไม่มี auto-login โดยตั้งใจ
export default function App() {
  const [status, setStatus] = useState({ phase: 'loading' })
  const [showForgot, setShowForgot] = useState(false)

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

  return <AppShell user={status.user} onLogout={handleLogout} />
}

function AppShell({ user, onLogout }) {
  const [active, setActive] = useState('dashboard')
  const activeLabel = NAV.find((n) => n.key === active)?.label

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Dormy Manager</div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={'nav-item' + (item.key === active ? ' active' : '')}
              onClick={() => setActive(item.key)}
            >
              <Icon name={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <h1>{activeLabel}</h1>
          <div className="topbar-user">
            <Icon name="account" />
            <span>{user.fullName}</span>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>
              <Icon name="logout" />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </header>

        <div className="page">
          {active === 'settings' ? (
            <SecuritySettingsPage user={user} />
          ) : (
            <section className="panel">
              <p className="muted">หน้านี้ยังเป็นโครงเปล่า — เนื้อหาจะถูกเติมตามแผนแต่ละเฟส</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
