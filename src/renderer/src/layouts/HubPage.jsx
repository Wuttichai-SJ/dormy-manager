import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import ApartmentsPage from '../pages/ApartmentsPage.jsx'
import UsersPage from '../pages/UsersPage.jsx'
import BackupsPage from '../pages/BackupsPage.jsx'

// หน้าแรกหลังเข้าสู่ระบบ — ต้องเลือกหอก่อนเข้าทำงาน
export default function HubPage({ user, onLogout, onOpenApartment, onSetupApartment }) {
  const [tab, setTab] = useState('apartments')

  return (
    <div className="hub">
      <header className="hub-topbar">
        <div className="brand-mark">Dormy Manager</div>
        <div className="topbar-user">
          <Icon name="account" />
          <span>{user.fullName}</span>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            <Icon name="logout" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </header>

      <div className="hub-band">หอพัก</div>

      <nav className="hub-tabs">
        <button
          className={'hub-tab' + (tab === 'apartments' ? ' active' : '')}
          onClick={() => setTab('apartments')}
        >
          <Icon name="apartments" />
          <span>จัดการหอพัก</span>
        </button>
        {/* บัญชีผู้ใช้เป็นของทั้งระบบ ไม่ผูกหอ · พนักงานไม่เห็นแท็บนี้ */}
        {user.isOwner && (
          <button
            className={'hub-tab' + (tab === 'users' ? ' active' : '')}
            onClick={() => setTab('users')}
          >
            <Icon name="tenants" />
            <span>จัดการผู้ใช้งาน</span>
          </button>
        )}
        {/* ไฟล์สำรองเป็นของทั้งเครื่อง — เข้าได้โดยไม่ต้องเลือกหอก่อน */}
        {user.isOwner && (
          <button
            className={'hub-tab' + (tab === 'backups' ? ' active' : '')}
            onClick={() => setTab('backups')}
          >
            <Icon name="download" />
            <span>สำรองข้อมูล</span>
          </button>
        )}
      </nav>

      <main className="hub-content">
        {tab === 'apartments' || !user.isOwner ? (
          <ApartmentsPage
            user={user}
            onOpen={onOpenApartment}
            onCreated={onSetupApartment}
            onSetup={onSetupApartment}
          />
        ) : tab === 'users' ? (
          <UsersPage user={user} />
        ) : (
          <BackupsPage user={user} />
        )}
      </main>
    </div>
  )
}
