import React, { useState } from 'react'
import ApartmentServicesPage from './ApartmentServicesPage.jsx'
import SecuritySettingsPage from './SecuritySettingsPage.jsx'

// หน้าตั้งค่าของหอพัก — รวมทุกอย่างที่ต้องตั้งก่อนเริ่มใช้งานจริงไว้ที่เดียว
// เรียงตามลำดับเดียวกับ wizard ของต้นแบบ เพื่อให้คนที่เคยใช้เว็บมาก่อนหาเจอที่เดิม
//
// รายการที่ยังไม่ได้ทำ แสดงเป็นหัวข้อจางๆ กดไม่ได้ ไม่ใช่ซ่อนไว้ — เพื่อให้เห็นตั้งแต่แรก
// ว่าการตั้งค่าหอหนึ่งหอมีทั้งหมดกี่เรื่อง จะได้ไม่คิดว่าตั้งครบแล้วทั้งที่ยังขาด
const SECTIONS = [
  { key: 'services', label: 'ค่าบริการ', ready: true },
  { key: 'meters', label: 'การคิดค่าน้ำ / ค่าไฟ', ready: false },
  { key: 'banks', label: 'บัญชีธนาคาร', ready: false },
  { key: 'floors', label: 'จัดการชั้นและห้องพัก', ready: false },
  { key: 'deposit', label: 'เงินประกันและการคืนเงิน', ready: false },
  { key: 'security', label: 'บัญชีผู้ใช้และความปลอดภัย', ready: true }
]

export default function SettingsPage({ apartment, user }) {
  const [section, setSection] = useState('services')

  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {SECTIONS.map((item) => (
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
      </nav>

      <div className="settings-content">
        {section === 'services' && <ApartmentServicesPage apartment={apartment} />}
        {section === 'security' && <SecuritySettingsPage user={user} />}
      </div>
    </div>
  )
}
