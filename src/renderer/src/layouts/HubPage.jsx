import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import ApartmentsPage from '../pages/ApartmentsPage.jsx'
import UsersPage from '../pages/UsersPage.jsx'

// หน้าแรกหลังเข้าสู่ระบบ — ยังไม่มีเมนูด้านข้าง
//
// โครงนี้ลอกจากต้นแบบโดยตั้งใจ: เข้าระบบมาแล้วต้อง "เลือกหอพักก่อน" จึงจะเข้าไปทำงานได้
// เหตุผลที่แยกสองระดับแทนที่จะยัดทุกอย่างไว้ในเมนูเดียว: เจ้าของหอมีหลายหอ และเกือบทุก
// หน้าจอในระบบ (ห้อง สัญญา บิล มิเตอร์) ล้วนต้องรู้ว่า "ของหอไหน" ถ้าไม่บังคับเลือกก่อน
// ทุกหน้าจะต้องมี dropdown เลือกหอของตัวเอง แล้วมีโอกาสที่คนกดผิดหอโดยไม่รู้ตัว
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
        {/* บัญชีผู้ใช้เป็นของ "ทั้งระบบ" ไม่ได้ผูกกับหอใดหอหนึ่ง (ตาราง users ไม่มี
            apartment_id) จึงอยู่ที่หน้ารวมนี้ ไม่ใช่ในเมนูตั้งค่าของหอ — วางไว้ในหอจะสื่อ
            ผิดว่าพนักงานคนหนึ่งผูกกับหอเดียว และกลายเป็นสองทางเข้าไปเรื่องเดียวกัน
            · พนักงานไม่เห็นแท็บนี้เลย */}
        {user.isOwner && (
          <button
            className={'hub-tab' + (tab === 'users' ? ' active' : '')}
            onClick={() => setTab('users')}
          >
            <Icon name="tenants" />
            <span>จัดการผู้ใช้งาน</span>
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
        ) : (
          <UsersPage user={user} />
        )}
      </main>
    </div>
  )
}
