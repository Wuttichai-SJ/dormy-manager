import React, { useState } from 'react'
import Icon from './Icon.jsx'

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

export default function App() {
  const [active, setActive] = useState('dashboard')
  const [ping, setPing] = useState(null)

  // `npm run dev:web` เปิดเฉพาะหน้าจอในเบราว์เซอร์ (ไม่มี Electron) — ที่นั่นไม่มี
  // window.electron ให้เรียก ต้องกันไว้ ไม่งั้นกดปุ่มแล้ว throw
  async function testBridge() {
    if (!window.electron) {
      setPing({ success: false, error: 'โหมดเบราว์เซอร์ — ไม่มี IPC (ต้องรัน npm run dev)' })
      return
    }
    const res = await window.electron.invoke('app:ping')
    setPing(res)
  }

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
        </header>

        <section className="panel">
          <p className="muted">หน้านี้ยังเป็นโครงเปล่า — เนื้อหาจะถูกเติมตามแผนแต่ละเฟส</p>

          <div className="selftest">
            <button className="btn" onClick={testBridge}>
              ทดสอบการเชื่อมต่อระบบ (IPC)
            </button>
            {ping && (
              <span className={'status ' + (ping.success ? 'ok' : 'err')}>
                {ping.success ? `เชื่อมต่อสำเร็จ: ${ping.data}` : `ผิดพลาด: ${ping.error}`}
              </span>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
