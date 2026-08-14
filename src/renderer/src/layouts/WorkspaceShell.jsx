import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import RoomsPage from '../pages/RoomsPage.jsx'
import RoomDetailPage from '../pages/RoomDetailPage.jsx'
import MetersPage from '../pages/MetersPage.jsx'
import InvoicesPage from '../pages/InvoicesPage.jsx'
import ReceiptsPage from '../pages/ReceiptsPage.jsx'
import MoveOutHistoryPage from '../pages/MoveOutHistoryPage.jsx'
import { SETTINGS_GROUPS, SettingsSection } from '../pages/SettingsPage.jsx'

// หน้าจอทำงานภายในหอพักหนึ่งหอ — เมนูด้านข้างจะมีก็ต่อเมื่อเลือกหอแล้วเท่านั้น
//
// ไม่มีเมนู "หอพัก" ในแถบนี้โดยตั้งใจ เพราะการเปลี่ยนหอ = ออกไปหน้ารวม
// ถ้าใส่ไว้ในเมนูข้างจะกลายเป็นว่ามีสองทางเข้าไปเรื่องเดียวกัน แล้วผู้ใช้สับสนว่า
// ตอนนี้ตัวเองอยู่ในบริบทของหอไหน — ชื่อหอบนแถบบนคือคำตอบเดียวที่ควรมี
//
// "ตั้งค่า" กางออกในเมนูข้างเลย ไม่ใช่กดแล้วเข้าไปเจอเมนูซ้อนอีกชั้นในหน้า (ตามต้นแบบ)
// เหตุผล: หัวข้อตั้งค่ามีสิบกว่าอัน ถ้าซ่อนไว้หลังการกดหนึ่งครั้ง คนจะไม่รู้ว่ามีอะไรบ้าง
// และการสลับไปมาระหว่างหัวข้อต้องเสียการกดเพิ่มทุกครั้ง
// **ไม่มีเมนู "สัญญา" กับ "การจอง" โดยตั้งใจ** — ทั้งสองเรื่องอยู่ในหน้ารายละเอียดห้อง
// เหมือนต้นแบบ (สัญญาผูกกับห้อง ไม่ได้ลอยอยู่เดี่ยวๆ) เคยใส่ไว้แล้วกดเข้าไปเจอหน้าเปล่า
// ซึ่งทำให้เข้าใจผิดว่ายังทำสัญญาไม่ได้ ทั้งที่ตัวช่วยทำสัญญาเสร็จตั้งแต่ Phase 2 แล้ว
//
// เมนูที่ยังไม่มีเนื้อหาจริงต้องบอกให้ชัดว่าจะมีอะไร ไม่ใช่ขึ้นว่า "โครงเปล่า" เฉยๆ
const NAV = [
  { key: 'dashboard', label: 'ภาพรวม', soon: 'สรุปห้องว่าง รายรับ และยอดค้างชำระของทั้งหอ' },
  { key: 'rooms', label: 'ห้องพัก' },
  { key: 'meters', label: 'จดมิเตอร์' },
  { key: 'invoices', label: 'ใบแจ้งหนี้' },
  { key: 'payments', label: 'การชำระเงิน' },
  // ประวัติการย้ายออกเป็นเมนูของตัวเอง ไม่ได้ซ่อนอยู่ในหน้าห้อง — ต่างจากสัญญา/การจอง
  // ที่ผูกกับห้องที่ยังมีคนอยู่ ผู้เช่าที่ย้ายออกแล้วไม่มีห้องให้เข้าไปหาอีกต่อไป
  // (ห้องกลับเป็นห้องว่างและอาจมีผู้เช่าคนใหม่อยู่แล้ว)
  { key: 'moveOuts', label: 'ประวัติการย้ายออก' },
  { key: 'maintenance', label: 'แจ้งซ่อม', soon: 'รับแจ้งซ่อมจากผู้เช่าและบันทึกการเข้าซ่อม' }
]

const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items)

export default function WorkspaceShell({ apartment, user, onExit, onLogout }) {
  const [active, setActive] = useState('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // ห้องที่กำลังเปิดรายละเอียดอยู่ — null = อยู่ที่ตารางห้อง
  const [openRoom, setOpenRoom] = useState(null)

  const settingsItem = SETTINGS_ITEMS.find((i) => i.key === active)
  const activeLabel = settingsItem?.label ?? NAV.find((n) => n.key === active)?.label

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
              onClick={() => {
                setActive(item.key)
                setOpenRoom(null)
              }}
            >
              <Icon name={item.key} />
              <span>{item.label}</span>
            </button>
          ))}

          <button
            type="button"
            className={'nav-item nav-parent' + (settingsItem ? ' has-active' : '')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Icon name="settings" />
            <span>ตั้งค่า</span>
            <span className={'nav-caret' + (settingsOpen ? ' open' : '')}>
              <Icon name="chevronDown" />
            </span>
          </button>

          {settingsOpen &&
            SETTINGS_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-group-label">{group.label}</p>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={
                      'nav-subitem' +
                      (item.key === active ? ' active' : '') +
                      (item.ready ? '' : ' disabled')
                    }
                    onClick={() => item.ready && setActive(item.key)}
                    disabled={!item.ready}
                    title={item.ready ? undefined : 'ยังไม่ได้สร้าง'}
                  >
                    <span className="nav-subitem-mark">›</span>
                    <span>{item.label}</span>
                    {!item.ready && <span className="settings-nav-soon">เร็วๆ นี้</span>}
                  </button>
                ))}
              </div>
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
          {active === 'rooms' ? (
            openRoom ? (
              <RoomDetailPage
                apartment={apartment}
                room={openRoom}
                // ชื่อผู้ทำรายการไปขึ้นช่องลงชื่อในใบสรุปการย้ายออก
                user={user}
                onBack={() => setOpenRoom(null)}
              />
            ) : (
              <RoomsPage apartment={apartment} onOpenRoom={setOpenRoom} />
            )
          ) : active === 'meters' ? (
            <MetersPage apartment={apartment} />
          ) : active === 'invoices' ? (
            <InvoicesPage apartment={apartment} user={user} />
          ) : active === 'payments' ? (
            <ReceiptsPage apartment={apartment} />
          ) : active === 'moveOuts' ? (
            // ชื่อผู้ที่ล็อกอินอยู่ไปขึ้นช่องลงชื่อในใบสรุปที่พิมพ์ย้อนหลัง
            <MoveOutHistoryPage apartment={apartment} user={user} />
          ) : settingsItem ? (
            <SettingsSection
              section={active}
              apartment={apartment}
              user={user}
              onApartmentDeleted={onExit}
            />
          ) : (
            <section className="panel">
              <div className="empty-state">
                <p>{NAV.find((n) => n.key === active)?.soon ?? 'ยังไม่ได้สร้างหน้านี้'}</p>
                <p className="muted">ส่วนนี้ยังไม่ได้สร้าง</p>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
