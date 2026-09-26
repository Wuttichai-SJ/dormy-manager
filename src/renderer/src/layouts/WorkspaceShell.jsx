import React, { useState } from 'react'
import Icon from '../Icon.jsx'
import DashboardPage from '../pages/DashboardPage.jsx'
import RoomsPage from '../pages/RoomsPage.jsx'
import RoomDetailPage from '../pages/RoomDetailPage.jsx'
import MetersPage from '../pages/MetersPage.jsx'
import InvoicesPage from '../pages/InvoicesPage.jsx'
import ReceiptsPage from '../pages/ReceiptsPage.jsx'
import MoveOutHistoryPage from '../pages/MoveOutHistoryPage.jsx'
import MaintenancePage from '../pages/MaintenancePage.jsx'
import { SETTINGS_GROUPS, SettingsSection } from '../pages/SettingsPage.jsx'

// เมนูของหอที่เลือก — สัญญาและการจองอยู่ในหน้ารายละเอียดห้อง
const NAV = [
  { key: 'dashboard', label: 'ภาพรวม' },
  { key: 'rooms', label: 'ห้องพัก' },
  { key: 'meters', label: 'จดมิเตอร์' },
  { key: 'invoices', label: 'ใบแจ้งหนี้' },
  { key: 'payments', label: 'การชำระเงิน' },
  { key: 'moveOuts', label: 'ประวัติการย้ายออก' },
  { key: 'maintenance', label: 'แจ้งซ่อม' }
]

const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((g) => g.items)

export default function WorkspaceShell({ apartment, user, onExit, onLogout }) {
  // ซ่อนเมนูเจ้าของหอจากพนักงาน — สิทธิ์จริงตรวจที่ main
  const settingsGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.ownerOnly || user.isOwner)
  })).filter((group) => group.items.length > 0)

  const [active, setActive] = useState('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openRoom, setOpenRoom] = useState(null)
  const [jumpInvoiceId, setJumpInvoiceId] = useState(null)

  // เปลี่ยนหน้าจากในเนื้อหา — ล้างสถานะค้างจากหน้าก่อน
  function goto(key) {
    setJumpInvoiceId(null)
    setOpenRoom(null)
    setActive(key)
  }

  const settingsItem = SETTINGS_ITEMS.find((i) => i.key === active)
  const activeLabel = settingsItem?.label ?? NAV.find((n) => n.key === active)?.label

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Dormy Manager</div>

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
              onClick={() => goto(item.key)}
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
            settingsGroups.map((group) => (
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
                    onClick={() => item.ready && goto(item.key)}
                    disabled={!item.ready}
                    title={item.ready ? undefined : 'ยังไม่ได้สร้าง'}
                  >
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
          {active === 'dashboard' ? (
            <DashboardPage
              apartment={apartment}
              onNavigate={goto}
              onOpenInvoice={(invoiceId) => {
                setJumpInvoiceId(invoiceId)
                setOpenRoom(null)
                setActive('invoices')
              }}
            />
          ) : active === 'rooms' ? (
            openRoom ? (
              <RoomDetailPage
                apartment={apartment}
                room={openRoom}
                user={user}
                onBack={() => setOpenRoom(null)}
              />
            ) : (
              <RoomsPage apartment={apartment} onOpenRoom={setOpenRoom} />
            )
          ) : active === 'meters' ? (
            <MetersPage apartment={apartment} />
          ) : active === 'invoices' ? (
            // key ตามบิลที่สั่งกาง — ให้ React สร้างหน้าใหม่
            <InvoicesPage
              key={jumpInvoiceId ?? 'list'}
              apartment={apartment}
              user={user}
              initialInvoiceId={jumpInvoiceId}
            />
          ) : active === 'payments' ? (
            <ReceiptsPage apartment={apartment} user={user} />
          ) : active === 'maintenance' ? (
            <MaintenancePage apartment={apartment} />
          ) : active === 'moveOuts' ? (
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
