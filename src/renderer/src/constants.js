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

// ต้องตรงกับ USER_ROLES / USER_ROLE_LABELS ใน src/main/db/users.js (ดู migration 027)
// สองบทบาทตายตัว ไม่ใช่เมทริกซ์สิทธิ์ที่ตั้งค่าได้
export const USER_ROLES = [
  {
    key: 'owner',
    label: 'เจ้าของหอ',
    hint:
      'ทำได้ทุกอย่าง รวมถึงแก้บัญชีธนาคาร/QR รับเงิน ลบใบแจ้งหนี้ ยกเลิกใบเสร็จ ' +
      'ลบหอพัก กู้คืนข้อมูล และจัดการผู้ใช้'
  },
  {
    key: 'staff',
    label: 'พนักงาน',
    hint:
      'ทำงานประจำวันได้ทั้งหมด — จดมิเตอร์ ออกบิล รับเงิน ทำสัญญา ย้ายออก · ' +
      'แต่แก้บัญชีธนาคาร/QR รับเงินไม่ได้'
  }
]

// สิ่งที่พนักงานทำไม่ได้ — ต้องตรงกับ OWNER_ONLY_ACTIONS ใน src/main/db/users.js
// **main เป็นฝ่ายบังคับจริงทุกช่อง** ที่นี่มีไว้อธิบายให้คนอ่านเข้าใจตรงกันเท่านั้น
export const OWNER_ONLY_ACTIONS = [
  'แก้ไขบัญชีธนาคารและข้อความแจ้งชำระเงิน',
  'เปลี่ยน QR Code รับเงิน',
  'ลบใบแจ้งหนี้',
  'ยกเลิกใบเสร็จรับเงิน',
  'ลบหอพัก',
  'กู้คืนและลบไฟล์สำรองข้อมูล',
  'จัดการผู้ใช้งานระบบ'
]

// ต้องตรงกับ MAINTENANCE_STATUSES / MAINTENANCE_STATUS_LABELS ใน src/main/db/maintenance.js
// (ดู migration 028) · 'open' ไม่ใช่สถานะจริงในฐานข้อมูล แต่เป็นตัวกรอง "งานที่ยังต้องตามต่อ"
// ซึ่งเป็นคำถามที่คนเปิดหน้านี้ถามบ่อยที่สุด จึงเป็นค่าตั้งต้นของตัวกรอง
export const MAINTENANCE_STATUS_FILTERS = [
  { key: 'open', label: 'ที่ยังค้างอยู่' },
  { key: 'pending', label: 'รอดำเนินการ' },
  { key: 'scheduled', label: 'นัดช่างแล้ว' },
  { key: 'done', label: 'ซ่อมเสร็จแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
  { key: '', label: 'ทั้งหมด' }
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
export function previewUnitsUsed(previous, current, options = {}) {
  const { isOverCycle, isMeterReplaced, removedReading, newStartReading, meterDigits } = options

  // จำนวนหลักของหน้าปัดมาจากค่าตั้งค่าของหอ ส่งมากับใบจดมิเตอร์ (ไม่ได้เดาจากเลขครั้งก่อน
  // แล้ว) — ต้องเป็นตัวเดียวกับที่ main ใช้ ไม่งั้นเลขบนจอกับเลขที่บันทึกจะคนละตัว
  const digits = Number.isInteger(Number(meterDigits)) ? Number(meterDigits) : 5
  const rollover = 10 ** digits

  const prev = Number(previous)
  const curr = Number(current)
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev < 0 || curr < 0) return null
  if (String(current).trim() === '') return null
  // เกินหน้าปัด = พิมพ์เกินหลัก ขึ้นเครื่องหมายเตือนตั้งแต่ระหว่างพิมพ์ ไม่ต้องรอกดบันทึก
  if (curr >= rollover) return null

  // เปลี่ยนมิเตอร์ลูกใหม่ — (เลขถอดเก่า − ครั้งก่อน) + (ปัจจุบัน − เลขเริ่มลูกใหม่)
  if (isMeterReplaced) {
    if (isOverCycle) return null
    if (String(removedReading ?? '').trim() === '') return null
    if (String(newStartReading ?? '').trim() === '') return null

    const removed = Number(removedReading)
    const newStart = Number(newStartReading)
    if (!Number.isFinite(removed) || !Number.isFinite(newStart)) return null
    if (removed < 0 || newStart < 0 || removed < prev || curr < newStart) return null
    if (removed >= rollover || newStart >= rollover) return null

    return round2(removed - prev + (curr - newStart))
  }

  if (curr >= prev) return round2(curr - prev)
  if (!isOverCycle) return null

  return round2(rollover - prev + curr)
}

function round2(n) {
  return Math.round(n * 100) / 100
}
