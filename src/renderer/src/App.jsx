import React, { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx'
import HubPage from './layouts/HubPage.jsx'
import WorkspaceShell from './layouts/WorkspaceShell.jsx'
import SetupWizard from './layouts/SetupWizard.jsx'
import { getAuthStatus, logout } from './services/authService.js'
import { showToast } from './components/Toast.jsx'

// ยังไม่มีบัญชี → ลงทะเบียน · ยังไม่ล็อกอิน → เข้าสู่ระบบ · ยังไม่เลือกหอ → HubPage · เลือกแล้ว → WorkspaceShell
export default function App() {
  const [status, setStatus] = useState({ phase: 'loading' })
  const [showForgot, setShowForgot] = useState(false)
  // ไม่จำหอข้ามการเปิดแอป — ต้องเลือกใหม่ทุกครั้ง
  const [apartment, setApartment] = useState(null)
  const [setupApartment, setSetupApartment] = useState(null)

  const loadStatus = useCallback(async () => {
    setStatus({ phase: 'loading' })
    const res = await getAuthStatus()

    if (!res.success) {
      setStatus({ phase: 'error', error: res.error })
      return
    }
    const { initialized, session, lastIdentifier } = res.data
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
    // ล้างหอที่เลือกไว้ด้วย
    setApartment(null)
    setSetupApartment(null)
    loadStatus()
  }

  if (status.phase === 'loading') {
    return (
      <div className="auth-screen">
        <p className="muted">กำลังเริ่มระบบ...</p>
      </div>
    )
  }

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
    return (
      <RegisterPage
        onReady={handleAuthenticated}
        onRestored={({ apartments }) => {
          showToast(`กู้คืนข้อมูลแล้ว (${apartments} หอ) — เข้าสู่ระบบด้วยบัญชีเดิม`)
          loadStatus()
        }}
      />
    )
  }

  if (status.phase === 'login') {
    if (showForgot) {
      return (
        <ForgotPasswordPage
          onCancel={() => setShowForgot(false)}
          // ตั้งรหัสใหม่แล้วต้องเข้าสู่ระบบอีกครั้ง
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
