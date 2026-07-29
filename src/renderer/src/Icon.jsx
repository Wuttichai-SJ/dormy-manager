// ไอคอนทั้งหมดเป็นไฟล์ในเครื่อง (assets/icons/heroicons) ไม่ดึงจากอินเทอร์เน็ต
// ตามข้อกำหนด offline-first และไม่มี dependency ตัวไหนเพิ่ม
//
// ใช้ `?raw` เพื่ออ่านไฟล์ SVG มาเป็นสตริงแล้วฝังลง DOM ตรงๆ — ทำแบบนี้เพราะ
// heroicons ใช้ stroke="currentColor" ไอคอนจึงเปลี่ยนสีตาม CSS ของปุ่มที่ครอบอยู่ได้
// (ถ้าใช้ <img src="....svg"> จะย้อมสีไม่ได้เลย ต้องทำไฟล์แยกทุกสี)
//
// วิธีเพิ่มไอคอนใหม่: import ไฟล์ที่ต้องการ แล้วใส่ชื่อลงในตาราง ICONS ข้างล่าง
// จงใจ import ทีละตัวแทนการ glob ทั้งโฟลเดอร์ 648 ไฟล์ — จะได้เห็นชัดว่าแอปใช้
// ไอคอนอะไรบ้าง และตัวที่ไม่ได้ใช้ไม่ต้องถูกรวมเข้า bundle
import dashboard from './assets/icons/heroicons/24/outline/squares-2x2.svg?raw'
import apartments from './assets/icons/heroicons/24/outline/building-office-2.svg?raw'
import rooms from './assets/icons/heroicons/24/outline/key.svg?raw'
import tenants from './assets/icons/heroicons/24/outline/users.svg?raw'
import contracts from './assets/icons/heroicons/24/outline/document-text.svg?raw'
import bookings from './assets/icons/heroicons/24/outline/calendar-days.svg?raw'
import meters from './assets/icons/heroicons/24/outline/bolt.svg?raw'
import invoices from './assets/icons/heroicons/24/outline/receipt-percent.svg?raw'
import payments from './assets/icons/heroicons/24/outline/banknotes.svg?raw'
import maintenance from './assets/icons/heroicons/24/outline/wrench-screwdriver.svg?raw'
import settings from './assets/icons/heroicons/24/outline/cog-6-tooth.svg?raw'

const ICONS = {
  dashboard,
  apartments,
  rooms,
  tenants,
  contracts,
  bookings,
  meters,
  invoices,
  payments,
  maintenance,
  settings
}

export default function Icon({ name, className = '' }) {
  const svg = ICONS[name]
  if (!svg) return null

  return (
    <span
      className={`icon ${className}`.trim()}
      aria-hidden="true"
      // ปลอดภัย: เนื้อหามาจากไฟล์ในโปรเจกต์ที่ถูกฝังตอน build ไม่ใช่ข้อมูลจากผู้ใช้
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
