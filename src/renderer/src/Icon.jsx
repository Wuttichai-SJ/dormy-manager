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
// รูปเดียวกับ bookings แต่เรียกคนละชื่อตามหน้าที่ — ปุ่มเปิดปฏิทินในช่องกรอกวันที่
// ถ้าวันหนึ่งอยากเปลี่ยนรูปของอย่างใดอย่างหนึ่ง จะแยกกันได้โดยไม่กระทบอีกอัน
import calendar from './assets/icons/heroicons/24/outline/calendar-days.svg?raw'
import meters from './assets/icons/heroicons/24/outline/bolt.svg?raw'
import invoices from './assets/icons/heroicons/24/outline/receipt-percent.svg?raw'
import payments from './assets/icons/heroicons/24/outline/banknotes.svg?raw'
// ประวัติการย้ายออก = "ผู้เช่าที่ออกไปแล้ว" จึงเป็นคนที่มีเครื่องหมายลบ ไม่ใช่ประตูทางออก
// (ประตูถูกใช้เป็นไอคอนออกจากระบบไปแล้ว สองอย่างนี้ต้องแยกกันให้ออกในเมนูเดียวกัน)
import moveOuts from './assets/icons/heroicons/24/outline/user-minus.svg?raw'
import maintenance from './assets/icons/heroicons/24/outline/wrench-screwdriver.svg?raw'
import settings from './assets/icons/heroicons/24/outline/cog-6-tooth.svg?raw'
// ไอคอนของระบบเข้าสู่ระบบ — ตั้งชื่อตามหน้าที่ ไม่ใช่ตามชื่อไฟล์ heroicons
// จะได้เปลี่ยนรูปทีหลังโดยไม่ต้องไล่แก้ทุกที่ที่เรียกใช้
import eye from './assets/icons/heroicons/24/outline/eye.svg?raw'
import eyeOff from './assets/icons/heroicons/24/outline/eye-slash.svg?raw'
import lock from './assets/icons/heroicons/24/outline/lock-closed.svg?raw'
import shield from './assets/icons/heroicons/24/outline/shield-check.svg?raw'
import warning from './assets/icons/heroicons/24/outline/exclamation-triangle.svg?raw'
import check from './assets/icons/heroicons/24/outline/check-circle.svg?raw'
// แบบทึบไว้ใช้กับข้อความแจ้งผลมุมจอ — ต้นแบบใช้วงกลมทึบติ๊กถูก ไม่ใช่แบบเส้น
import checkSolid from './assets/icons/heroicons/24/solid/check-circle.svg?raw'
import warningSolid from './assets/icons/heroicons/24/solid/exclamation-circle.svg?raw'
import copy from './assets/icons/heroicons/24/outline/clipboard-document.svg?raw'
// ไอคอนของตัวช่วยตั้งค่า — ปุ่มเลือก/ยกเลิกทั้งชั้น ปุ่มปิดหน้าต่างซ้อน และจุดคำอธิบาย
import minusCircle from './assets/icons/heroicons/24/outline/minus-circle.svg?raw'
import close from './assets/icons/heroicons/24/outline/x-mark.svg?raw'
import info from './assets/icons/heroicons/24/outline/information-circle.svg?raw'
import plus from './assets/icons/heroicons/24/outline/plus.svg?raw'
import search from './assets/icons/heroicons/24/outline/magnifying-glass.svg?raw'
import chevronDown from './assets/icons/heroicons/24/outline/chevron-down.svg?raw'
import chevronLeft from './assets/icons/heroicons/24/outline/chevron-left.svg?raw'
import chevronRight from './assets/icons/heroicons/24/outline/chevron-right.svg?raw'
import trash from './assets/icons/heroicons/24/outline/trash.svg?raw'
import back from './assets/icons/heroicons/24/outline/arrow-left.svg?raw'
import logoutIcon from './assets/icons/heroicons/24/outline/arrow-right-on-rectangle.svg?raw'
import account from './assets/icons/heroicons/24/outline/user-circle.svg?raw'
// ค่าน้ำ/ค่าไฟใช้ไอคอน "ทึบ" ไม่ใช่เส้น เพราะต้องการให้เป็นจุดสังเกตที่มีสีของตัวเอง
// (น้ำ=น้ำเงิน ไฟ=เหลืองอำพัน) แบบเดียวกับต้นแบบ ไอคอนเส้นบางจะจมหายไปกับพื้น
import electric from './assets/icons/heroicons/24/solid/bolt.svg?raw'
// heroicons ไม่มีหยดน้ำ — วาดเองแล้วเก็บเป็นไฟล์ในเครื่องเหมือนไอคอนอื่น ไม่ดึงจากเน็ต
import water from './assets/icons/custom/water-drop.svg?raw'
// พิมพ์เอกสาร / บันทึกไฟล์ลงเครื่อง
import printer from './assets/icons/heroicons/24/outline/printer.svg?raw'
import download from './assets/icons/heroicons/24/outline/arrow-down-tray.svg?raw'

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
  moveOuts,
  maintenance,
  settings,
  eye,
  eyeOff,
  lock,
  shield,
  warning,
  check,
  checkSolid,
  warningSolid,
  minusCircle,
  close,
  info,
  plus,
  search,
  chevronDown,
  chevronLeft,
  chevronRight,
  trash,
  copy,
  back,
  logout: logoutIcon,
  account,
  water,
  electric,
  calendar,
  printer,
  download
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
