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
import BackupsPage from './BackupsPage.jsx'

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
      // 🔴 **ทั้งเมนู "ตั้งค่า" เป็นของเจ้าของหอ ยกเว้น "บัญชีผู้ใช้และความปลอดภัย"**
      // (ผู้ใช้ตัดสินใจ 2026-08-14) เส้นแบ่งคือ: งานประจำวันอยู่ในเมนูหลัก ส่วนตั้งค่าคือ
      // การกำหนดกติกาของหอ — ราคา ค่าน้ำ-ไฟ VAT ค่าปรับ ผังห้อง บัญชีรับเงิน
      // ทุกอย่างในนี้เปลี่ยนแล้วบิลยังออกมา "ถูกต้องตามที่ตั้งไว้" ทุกประการ จึงไม่มีอะไร
      // ผิดปกติให้จับได้ นอกจากจะไปไล่ดูค่าที่ตั้งไว้เอง
      { key: 'info', label: 'ข้อมูลหอพัก', ready: true, ownerOnly: true },
      { key: 'services', label: 'บริการ', ready: true, ownerOnly: true },
      // 🔴 สองหัวข้อนี้คือ "เงินเข้ากระเป๋าใคร" ไม่ใช่ข้อมูลตั้งค่าทั่วไป — พนักงานที่ไม่ซื่อสัตย์
      // เปลี่ยนเป็นบัญชี/QR ของตัวเองแล้วบิลยังหน้าตาเหมือนเดิมทุกอย่าง ผู้เช่าโอนตามปกติ
      // และมีสลิปยืนยันว่าจ่ายแล้ว กว่าหอจะรู้ตัวก็ตอนกระทบยอดธนาคาร (ผู้ใช้ทักท้วง 2026-08-14)
      { key: 'banks', label: 'บัญชีธนาคาร', ready: true, ownerOnly: true },
      { key: 'qrCode', label: 'QR Code รับเงิน', ready: true, ownerOnly: true },
      { key: 'meterRules', label: 'การคิดค่ามิเตอร์', ready: true, ownerOnly: true },
      { key: 'deposit', label: 'เงินประกันและการคืนเงิน', ready: true, ownerOnly: true },
      // หัวข้อเดียวที่พนักงานเห็น — เป็นเรื่องของบัญชีตัวเอง (เปลี่ยนรหัสผ่านของตัวเอง)
      // ไม่ใช่การตั้งค่าหอ
      { key: 'security', label: 'บัญชีผู้ใช้และความปลอดภัย', ready: true },
      // **"ผู้ใช้งานระบบ" ไม่ได้อยู่ที่นี่** — บัญชีผู้ใช้เป็นของทั้งระบบ ไม่ได้ผูกกับหอ
      // จึงอยู่ที่หน้ารวมหอ (HubPage แท็บ "จัดการผู้ใช้งาน") อย่าเพิ่มกลับมาที่นี่
      // จะกลายเป็นสองทางเข้าไปเรื่องเดียวกัน และสื่อผิดว่าพนักงานผูกกับหอเดียว
      // สำรองข้อมูลเป็นเรื่องของ "ทั้งเครื่อง" ไม่ใช่ของหอใดหอหนึ่ง (ไฟล์ฐานข้อมูลมีไฟล์เดียว)
      // แต่วางไว้กลุ่มนี้เพราะเป็นที่ที่คนไปหาเรื่องตั้งค่าระบบ
      { key: 'backups', label: 'สำรองข้อมูล', ready: true, ownerOnly: true }
    ]
  },
  {
    label: 'ระดับห้อง',
    items: [
      { key: 'plan', label: 'ผังห้อง', ready: true, ownerOnly: true },
      { key: 'status', label: 'ห้องว่าง', ready: true, ownerOnly: true },
      { key: 'rate', label: 'ค่าห้อง', ready: true, ownerOnly: true },
      { key: 'roomServices', label: 'ค่าบริการอื่น ๆ', ready: true, ownerOnly: true }
    ]
  }
]

// เนื้อหาของหัวข้อที่เลือกอยู่ — เต็มความกว้างของพื้นที่เนื้อหา ไม่มีเมนูซ้อนอีกชั้น
export function SettingsSection({ section, apartment, user, onApartmentDeleted }) {
  switch (section) {
    case 'info':
      // user ไปตัดสินว่าจะแสดงปุ่ม "ลบหอพัก" ไหม (เจ้าของหอเท่านั้น)
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
    case 'backups':
      return <BackupsPage user={user} />
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
