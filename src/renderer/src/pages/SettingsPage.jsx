import React from 'react'
import ApartmentInfoPage from './ApartmentInfoPage.jsx'
import ApartmentServicesPage from './ApartmentServicesPage.jsx'
import UtilitySettingsPage from './UtilitySettingsPage.jsx'
import DepositPolicyPage from './DepositPolicyPage.jsx'
import BankAccountsPage from './BankAccountsPage.jsx'
import QrCodePage from './QrCodePage.jsx'
import FloorPlanPage from './FloorPlanPage.jsx'
import RoomRatesPage from './RoomRatesPage.jsx'
import SecuritySettingsPage from './SecuritySettingsPage.jsx'

// หัวข้อเมนูตั้งค่า (วาดใน WorkspaceShell) · รายการที่ยังไม่ทำแสดงจางๆ
export const SETTINGS_GROUPS = [
  {
    label: 'หอพัก',
    items: [
      // ตั้งค่าทั้งหมดเป็นของเจ้าของหอ ยกเว้นบัญชีผู้ใช้และความปลอดภัย
      { key: 'info', label: 'ข้อมูลหอพัก', ready: true, ownerOnly: true },
      { key: 'services', label: 'บริการ', ready: true, ownerOnly: true },
      { key: 'banks', label: 'บัญชีธนาคาร', ready: true, ownerOnly: true },
      { key: 'qrCode', label: 'QR Code รับเงิน', ready: true, ownerOnly: true },
      { key: 'meterRules', label: 'การคิดค่ามิเตอร์', ready: true, ownerOnly: true },
      { key: 'deposit', label: 'เงินประกันและการคืนเงิน', ready: true, ownerOnly: true },
      { key: 'security', label: 'บัญชีผู้ใช้และความปลอดภัย', ready: true }
      // ผู้ใช้งานระบบและสำรองข้อมูลอยู่ที่ HubPage (ของทั้งเครื่อง ไม่ผูกหอ)
    ]
  },
  {
    label: 'ห้องพัก',
    items: [
      { key: 'plan', label: 'ผังห้อง', ready: true, ownerOnly: true },
      { key: 'status', label: 'ห้องว่าง', ready: true, ownerOnly: true },
      { key: 'rate', label: 'ค่าห้อง', ready: true, ownerOnly: true },
      { key: 'roomServices', label: 'ค่าบริการอื่น ๆ', ready: true, ownerOnly: true }
    ]
  }
]

export function SettingsSection({ section, apartment, user, onApartmentDeleted }) {
  switch (section) {
    case 'info':
      return <ApartmentInfoPage apartment={apartment} user={user} onDeleted={onApartmentDeleted} />
    case 'services':
      return <ApartmentServicesPage apartment={apartment} />
    case 'banks':
      return <BankAccountsPage apartment={apartment} />
    case 'qrCode':
      return <QrCodePage apartment={apartment} />
    case 'meterRules':
      return <UtilitySettingsPage apartment={apartment} />
    case 'deposit':
      return <DepositPolicyPage apartment={apartment} />
    case 'security':
      return <SecuritySettingsPage user={user} />
    case 'plan':
      return <FloorPlanPage apartment={apartment} />
    // key บังคับสร้างใหม่ทุกครั้งที่สลับโหมด
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
