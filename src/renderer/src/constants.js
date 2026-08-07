// ค่าคงที่ที่ฝั่งหน้าจอกับฝั่ง main ต้องตรงกัน
//
// ทำไมไม่ import จาก src/main โดยตรง: renderer ถูก bundle แยกและรันในกระบวนการที่
// ไม่มีสิทธิ์แตะ Node/Electron API ถ้าลาก db/apartments.js เข้ามาจะพา better-sqlite3
// ติดเข้า bundle ฝั่งหน้าจอไปด้วย — ที่นี่จึงคัดลอกเฉพาะ "ตัวเลข" มาไว้
//
// ค่าเหล่านี้ต้องตรงกับต้นทางเสมอ ถ้าแก้ที่ main ต้องแก้ที่นี่ด้วย
// (main เป็นฝ่ายตรวจสอบจริงอยู่แล้ว ที่นี่มีไว้เพื่อไม่ให้หน้าจอเสนอค่าที่ main จะปฏิเสธ)

// ต้องตรงกับ MAX_DUE_DATE_DAY ใน src/main/db/apartments.js
export const MAX_DUE_DATE_DAY = 28

// ต้องตรงกับ BILLING_TYPES / BILLING_TYPE_LABELS ใน src/main/db/utilityDefaults.js
// และกับค่าที่ 001_init.sql ระบุไว้สำหรับ room_utility_settings.water_billing_type
export const BILLING_TYPES = ['actual', 'minimum', 'flat']

export const BILLING_TYPE_LABELS = {
  actual: 'ตามมิเตอร์ที่ใช้จริง',
  minimum: 'ตามมิเตอร์แบบมีขั้นต่ำ',
  flat: 'เหมาจ่ายรายเดือน'
}

// ต้องตรงกับ BANKS ใน src/main/db/bankAccounts.js (main เป็นฝ่ายตรวจว่าค่าที่ส่งมาถูกต้อง)
export const BANKS = [
  'กรุงเทพ (Bangkok Bank)',
  'กสิกรไทย (Kasikorn)',
  'กรุงไทย (Krungthai)',
  'ไทยพาณิชย์ (SCB)',
  'กรุงศรีอยุธยา (Krungsri)',
  'เกียรตินาคิน',
  'ซีไอเอ็มบีไทย',
  'ทิสโก้',
  'ยูโอบี',
  'สแตนดาร์ดชาร์เตอร์ด',
  'ไทยเครดิตเพื่อรายย่อย',
  'แลนด์ แอนด์ เฮาส์',
  'ไอซีบีซี',
  'ออมสิน',
  'พร้อมเพย์',
  'ทีเอ็มบีธนชาต (TTB)',
  'อิสลามแห่งประเทศไทย (ibank)',
  'ธกส (BAAC)'
]

// ต้องตรงกับ RECOMMENDED_MAX_ACCOUNTS ใน src/main/db/bankAccounts.js
export const RECOMMENDED_MAX_ACCOUNTS = 2

// ต้องตรงกับ MAX_FLOORS / MAX_ROOMS_PER_FLOOR ใน src/main/db/rooms.js
export const MAX_FLOORS = 30
export const MAX_ROOMS_PER_FLOOR = 50

// ต้องตรงกับ ROOM_STATUSES / ROOM_STATUS_LABELS ใน src/main/db/rooms.js
// และกับค่าที่ 001_init.sql ระบุไว้สำหรับ rooms.status
export const ROOM_STATUSES = ['vacant', 'occupied', 'maintenance']

export const ROOM_STATUS_LABELS = {
  vacant: 'ว่าง',
  occupied: 'ไม่ว่าง',
  maintenance: 'ปิดปรับปรุง'
}

// ต้องตรงกับ PAYMENT_METHODS / PAYMENT_METHOD_LABELS ใน src/main/db/payments.js
export const PAYMENT_METHODS = [
  { key: 'cash', label: 'เงินสด' },
  { key: 'transfer', label: 'เงินโอน' },
  { key: 'other', label: 'อื่นๆ' }
]

// ต้องตรงกับ VAT_RATE ใน src/main/db/invoices.js — ใช้ขึ้นป้าย "VAT 7%" บนใบแจ้งหนี้เท่านั้น
// การคำนวณจริงอยู่ฝั่ง main ทั้งหมด ห้ามเอาค่านี้ไปคูณอะไรที่นี่
export const VAT_RATE = 7

// ต้องตรงกับ INVOICE_STATUSES / INVOICE_STATUS_LABELS ใน src/main/db/invoices.js
export const INVOICE_STATUS_LABELS = {
  unpaid: 'ค้างชำระ',
  partial_paid: 'ชำระบางส่วน',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก'
}

// ต้องตรงกับ METER_SIDES / METER_SIDE_LABELS ใน src/main/db/meterReadings.js
// หน้าจอกรอกเลขมิเตอร์ทีละฝั่งตามต้นแบบ จึงต้องมีชื่อกับไอคอนของแต่ละฝั่งไว้ทำปุ่ม
export const METER_SIDES = [
  { key: 'water', label: 'ค่าน้ำ', icon: 'water' },
  { key: 'electric', label: 'ค่าไฟ', icon: 'electric' }
]

// เงาของ calculateUnitsUsed ใน src/main/db/meterReadings.js — **ต้องแก้ทั้งสองที่พร้อมกัน**
//
// ทำไมต้องมีสำเนา: ตัวเลขหน่วยต้องขยับทันทีที่พิมพ์ ยิง IPC ทุกตัวอักษรไม่ไหว
// ที่นี่ใช้ "แสดงผลระหว่างพิมพ์" อย่างเดียว ค่าที่เข้าฐานข้อมูลคำนวณใหม่ฝั่ง main เสมอ
// จึงไม่มีทางที่เลขบนจอจะกลายเป็นเลขที่ถูกบันทึกโดยไม่ผ่านการตรวจ
//
// คืน null เมื่อคำนวณไม่ได้ (เลขลดลงโดยไม่ได้ติ๊กเกินรอบ) เพื่อให้หน้าจอขึ้นเครื่องหมาย
// เตือนแทนตัวเลข — ฝั่ง main จะโยน error ข้อความเดียวกันนี้ตอนกดบันทึก
export function previewUnitsUsed(previous, current, isOverCycle) {
  const prev = Number(previous)
  const curr = Number(current)
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev < 0 || curr < 0) return null
  if (String(current).trim() === '') return null

  if (curr >= prev) return round2(curr - prev)
  if (!isOverCycle) return null

  const rollover = 10 ** String(Math.floor(prev)).length
  return round2(rollover - prev + curr)
}

function round2(n) {
  return Math.round(n * 100) / 100
}
