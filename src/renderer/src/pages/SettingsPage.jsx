import React, { useState } from 'react'
import ApartmentInfoPage from './ApartmentInfoPage.jsx'
import ApartmentServicesPage from './ApartmentServicesPage.jsx'
import UtilitySettingsPage from './UtilitySettingsPage.jsx'
import BankAccountsPage from './BankAccountsPage.jsx'
import FloorPlanPage from './FloorPlanPage.jsx'
import RoomRatesPage from './RoomRatesPage.jsx'
import SecuritySettingsPage from './SecuritySettingsPage.jsx'

// หน้าตั้งค่าของหอพัก — แบ่งเป็นสองกลุ่มตามต้นแบบ: เรื่องที่เป็นของ "ทั้งหอ" กับเรื่องที่
// ลงไปถึง "รายห้อง" หัวข้อกลุ่มเป็นแค่ป้ายกำกับ กดไม่ได้
//
// การแบ่งแบบนี้ตอบคำถามที่คนหาเมนูไม่เจอถามบ่อยที่สุด: "ของทั้งหอ หรือของห้อง"
// เช่นค่าน้ำ/ค่าไฟ ที่นี่คือค่าตั้งต้นของทั้งหอ ส่วนการแก้รายห้องอยู่คนละที่
//
// รายการที่ยังไม่ได้ทำ แสดงเป็นหัวข้อจางๆ กดไม่ได้ ไม่ใช่ซ่อนไว้ — เพื่อให้เห็นตั้งแต่แรก
// ว่าการตั้งค่าหอหนึ่งหอมีทั้งหมดกี่เรื่อง จะได้ไม่คิดว่าตั้งครบแล้วทั้งที่ยังขาด
const GROUPS = [
  {
    label: 'ระดับอพาร์ตเมนต์',
    items: [
      { key: 'info', label: 'ข้อมูลหอพัก', ready: true },
      { key: 'services', label: 'บริการ', ready: true },
      { key: 'banks', label: 'บัญชีธนาคาร', ready: true },
      { key: 'meters', label: 'การคิดค่ามิเตอร์', ready: true },
      { key: 'deposit', label: 'เงินประกันและการคืนเงิน', ready: false },
      { key: 'security', label: 'บัญชีผู้ใช้และความปลอดภัย', ready: true }
    ]
  },
  {
    label: 'ระดับห้อง',
    items: [
      { key: 'plan', label: 'ผังห้อง', ready: true },
      { key: 'status', label: 'ห้องว่าง', ready: true },
      { key: 'rate', label: 'ค่าห้อง', ready: true },
      { key: 'roomServices', label: 'ค่าบริการอื่น ๆ', ready: true }
    ]
  }
]

export default function SettingsPage({ apartment, user, onApartmentDeleted }) {
  const [section, setSection] = useState('info')

  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {GROUPS.map((group) => (
          <div className="settings-nav-group" key={group.label}>
            <p className="settings-nav-group-label">{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={
                  'settings-nav-item' +
                  (item.key === section ? ' active' : '') +
                  (item.ready ? '' : ' disabled')
                }
                onClick={() => item.ready && setSection(item.key)}
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

      <div className="settings-content">
        {section === 'info' && (
          <ApartmentInfoPage apartment={apartment} onDeleted={onApartmentDeleted} />
        )}
        {section === 'services' && <ApartmentServicesPage apartment={apartment} />}
        {section === 'banks' && <BankAccountsPage apartment={apartment} />}
        {section === 'meters' && <UtilitySettingsPage apartment={apartment} />}
        {section === 'security' && <SecuritySettingsPage user={user} />}

        {section === 'plan' && <FloorPlanPage apartment={apartment} />}
        {/* สามหัวข้อนี้ใช้หน้าเดียวกัน ต่างกันที่โหมด — key บังคับให้สร้างใหม่ทุกครั้งที่สลับ
            ไม่งั้น React ใช้ instance เดิมแล้วโหมดไม่เปลี่ยนตาม (เคยพลาดมาแล้วใน wizard) */}
        {section === 'status' && <RoomRatesPage key="status" apartment={apartment} only="status" />}
        {section === 'rate' && <RoomRatesPage key="rate" apartment={apartment} only="rate" />}
        {section === 'roomServices' && (
          <RoomRatesPage key="services" apartment={apartment} only="services" />
        )}
      </div>
    </div>
  )
}
