import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import SettingsPage from '../pages/SettingsPage.jsx'

// หน้าจอทำงานภายในหอพักหนึ่งหอ — เมนูด้านข้างจะมีก็ต่อเมื่อเลือกหอแล้วเท่านั้น
//
// ไม่มีเมนู "หอพัก" ในแถบนี้โดยตั้งใจ เพราะการเปลี่ยนหอ = ออกไปหน้ารวม
// ถ้าใส่ไว้ในเมนูข้างจะกลายเป็นว่ามีสองทางเข้าไปเรื่องเดียวกัน แล้วผู้ใช้สับสนว่า
// ตอนนี้ตัวเองอยู่ในบริบทของหอไหน — ชื่อหอบนแถบบนคือคำตอบเดียวที่ควรมี
const NAV = [
  { key: 'dashboard', label: 'ภาพรวม' },
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

export default function WorkspaceShell({ apartment, user, onExit, onLogout }) {
  const [active, setActive] = useState('dashboard')
  const activeLabel = NAV.find((n) => n.key === active)?.label

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Dormy Manager</div>

        {/* ชื่อหอที่กำลังทำงานอยู่ ต้องเห็นตลอดเวลาไม่ว่าจะเลื่อนไปหน้าไหน
            พร้อมทางออกกลับไปเลือกหออื่นในที่เดียวกัน */}
        <button type="button" className="apartment-switch" onClick={onExit}>
          <span className="apartment-switch-label">หอพักที่เลือก</span>
          <span className="apartment-switch-name">{apartment.nameTh}</span>
          <span className="apartment-switch-action">
            <Icon name="back" />
            <span>เปลี่ยนหอพัก</span>
          </span>
        </button>

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
          <div>
            <h1>{activeLabel}</h1>
            <p className="topbar-context">{apartment.nameTh}</p>
          </div>
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
            <SettingsPage apartment={apartment} user={user} />
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
