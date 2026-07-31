import React from 'react'
import ApartmentInfoPage from './ApartmentInfoPage.jsx'
import ApartmentServicesPage from './ApartmentServicesPage.jsx'
import UtilitySettingsPage from './UtilitySettingsPage.jsx'
import BankAccountsPage from './BankAccountsPage.jsx'
import FloorPlanPage from './FloorPlanPage.jsx'
import RoomRatesPage from './RoomRatesPage.jsx'
import SecuritySettingsPage from './SecuritySettingsPage.jsx'

// หัวข้อของเมนู "ตั้งค่า" — แบ่งสองกลุ่มตามต้นแบบ: เรื่องที่เป็นของ "ทั้งหอ" กับเรื่องที่
// ลงไปถึง "รายห้อง" ป้ายกลุ่มเป็นแค่หัวข้อ กดไม่ได้
//
// การแบ่งแบบนี้ตอบคำถามที่คนหาเมนูไม่เจอถามบ่อยที่สุด: "ของทั้งหอ หรือของห้อง"
// เช่นค่าน้ำ/ค่าไฟ ที่นี่คือค่าตั้งต้นของทั้งหอ ส่วนการแก้รายห้องอยู่คนละที่
//
// รายการที่ยังไม่ได้ทำ แสดงเป็นหัวข้อจางๆ กดไม่ได้ ไม่ใช่ซ่อนไว้ — เพื่อให้เห็นตั้งแต่แรก
// ว่าการตั้งค่าหอหนึ่งหอมีทั้งหมดกี่เรื่อง จะได้ไม่คิดว่าตั้งครบแล้วทั้งที่ยังขาด
//
// รายการอยู่ที่นี่แต่ตัวเมนูวาดอยู่ใน WorkspaceShell เพราะต้นแบบกางหัวข้อพวกนี้ไว้ใน
// แถบเมนูซ้ายเลย ไม่ได้มีเมนูซ้อนอีกชั้นในหน้า
export const SETTINGS_GROUPS = [
  {
    label: 'ระดับอพาร์ตเมนต์',
    items: [
      { key: 'info', label: 'ข้อมูลหอพัก', ready: true },
      { key: 'services', label: 'บริการ', ready: true },
      { key: 'banks', label: 'บัญชีธนาคาร', ready: true },
      { key: 'meterRules', label: 'การคิดค่ามิเตอร์', ready: true },
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

// เนื้อหาของหัวข้อที่เลือกอยู่ — เต็มความกว้างของพื้นที่เนื้อหา ไม่มีเมนูซ้อนอีกชั้น
export function SettingsSection({ section, apartment, user, onApartmentDeleted }) {
  switch (section) {
    case 'info':
      return <ApartmentInfoPage apartment={apartment} onDeleted={onApartmentDeleted} />
    case 'services':
      return <ApartmentServicesPage apartment={apartment} />
    case 'banks':
      return <BankAccountsPage apartment={apartment} />
    case 'meterRules':
      return <UtilitySettingsPage apartment={apartment} />
    case 'security':
      return <SecuritySettingsPage user={user} />
    case 'plan':
      return <FloorPlanPage apartment={apartment} />
    // สามหัวข้อนี้ใช้หน้าเดียวกัน ต่างกันที่โหมด — key บังคับให้สร้างใหม่ทุกครั้งที่สลับ
    // ไม่งั้น React ใช้ instance เดิมแล้วโหมดไม่เปลี่ยนตาม (เคยพลาดมาแล้วใน wizard)
    case 'status':
      return <RoomRatesPage key="status" apartment={apartment} only="status" />
    case 'rate':
      return <RoomRatesPage key="rate" apartment={apartment} only="rate" />
    case 'roomServices':
      return <RoomRatesPage key="services" apartment={apartment} only="services" />
    default:
      return null
  }
}
