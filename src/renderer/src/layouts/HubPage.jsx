import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import ApartmentsPage from '../pages/ApartmentsPage.jsx'

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
        <button
          className={'hub-tab' + (tab === 'users' ? ' active' : '')}
          onClick={() => setTab('users')}
        >
          <Icon name="tenants" />
          <span>จัดการผู้ใช้งาน</span>
        </button>
      </nav>

      <main className="hub-content">
        {tab === 'apartments' ? (
          <ApartmentsPage
            onOpen={onOpenApartment}
            onCreated={onSetupApartment}
            onSetup={onSetupApartment}
          />
        ) : (
          <section className="panel empty-state">
            <Icon name="tenants" />
            <h2>จัดการผู้ใช้งาน</h2>
            <p className="muted">
              หน้าเพิ่ม/แก้ไขเจ้าหน้าที่ กำหนดตำแหน่งและสิทธิ์รายหอพัก
              <br />
              ยังไม่ได้สร้าง — เป็นงานที่เหลือของเฟสนี้
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
