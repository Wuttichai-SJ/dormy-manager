// ค่าที่ต้องตรงกับฝั่ง main — แก้ที่ main ต้องแก้ที่นี่ด้วย (main เป็นฝ่ายตรวจจริง)

// = MAX_DUE_DATE_DAY ใน main/db/apartments.js
export const MAX_DUE_DATE_DAY = 28

// = BILLING_TYPES / BILLING_TYPE_LABELS ใน main/db/utilityDefaults.js
export const BILLING_TYPES = ['actual', 'minimum', 'flat']

export const BILLING_TYPE_LABELS = {
  actual: 'ตามมิเตอร์ที่ใช้จริง',
  minimum: 'ตามมิเตอร์แบบมีขั้นต่ำ',
  flat: 'เหมาจ่ายรายเดือน'
}

// = BANKS ใน main/db/bankAccounts.js
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

// = RECOMMENDED_MAX_ACCOUNTS ใน main/db/bankAccounts.js
export const RECOMMENDED_MAX_ACCOUNTS = 2

// = MAX_FLOORS / MAX_ROOMS_PER_FLOOR ใน main/db/rooms.js
export const MAX_FLOORS = 30
export const MAX_ROOMS_PER_FLOOR = 50

// = ROOM_STATUSES / ROOM_STATUS_LABELS ใน main/db/rooms.js
export const ROOM_STATUSES = ['vacant', 'occupied', 'maintenance']

export const ROOM_STATUS_LABELS = {
  vacant: 'ว่าง',
  occupied: 'ไม่ว่าง',
  maintenance: 'ปิดปรับปรุง'
}

// = PAYMENT_METHODS / PAYMENT_METHOD_LABELS ใน main/db/payments.js
export const PAYMENT_METHODS = [
  { key: 'cash', label: 'เงินสด' },
  { key: 'transfer', label: 'เงินโอน' },
  { key: 'other', label: 'อื่นๆ' }
]

// = USER_ROLES / USER_ROLE_LABELS ใน main/db/users.js
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

// = OWNER_ONLY_ACTIONS ใน main/db/users.js
export const OWNER_ONLY_ACTIONS = [
  'แก้ไขบัญชีธนาคารและข้อความแจ้งชำระเงิน',
  'เปลี่ยน QR Code รับเงิน',
  'ลบใบแจ้งหนี้',
  'ยกเลิกใบเสร็จรับเงิน',
  'ลบหอพัก',
  'กู้คืนและลบไฟล์สำรองข้อมูล',
  'จัดการผู้ใช้งานระบบ'
]

// = DEPOSIT_REFUND_POLICIES / LABELS ใน main/db/apartments.js
export const DEPOSIT_REFUND_POLICIES = [
  {
    key: 'on_full_term',
    label: 'คืนเมื่ออยู่ครบตามสัญญา',
    hint: 'อยู่ครบตามระยะสัญญา และแจ้งย้ายออกล่วงหน้าครบกำหนด จึงได้คืนเต็มจำนวน · ผิดข้อใดข้อหนึ่ง = ริบทั้งหมด'
  },
  {
    key: 'always',
    label: 'คืนเสมอ',
    hint: 'คืนเงินประกันทุกกรณี ไม่ว่าจะอยู่ครบหรือแจ้งทันหรือไม่ (ค่าเสียหายยังหักได้ตามปกติ)'
  },
  {
    key: 'never',
    label: 'ไม่คืนเงินประกัน',
    hint: 'ไม่คืนเงินประกันทุกกรณี — ใช้เมื่อหอเก็บเป็นค่าแรกเข้าที่ไม่มีการคืนอยู่แล้ว'
  }
]

// = MAINTENANCE_STATUSES / LABELS ใน main/db/maintenance.js · 'open' เป็นตัวกรอง ไม่ใช่สถานะจริง
export const MAINTENANCE_STATUS_FILTERS = [
  { key: 'open', label: 'ที่ยังค้างอยู่' },
  { key: 'pending', label: 'รอดำเนินการ' },
  { key: 'scheduled', label: 'นัดช่างแล้ว' },
  { key: 'done', label: 'ซ่อมเสร็จแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
  { key: '', label: 'ทั้งหมด' }
]

// = MIN/MAX/DEFAULT_VAT_RATE ใน main/db/apartments.js · ป้าย VAT บนบิลต้องใช้ invoice.vatRate
export const MIN_VAT_RATE = 0
export const MAX_VAT_RATE = 100
export const DEFAULT_VAT_RATE = 7

// = FULL_MONTH_MOVE_IN_UNTIL_DAY / PRORATE_DAYS_PER_MONTH ใน main/db/contracts.js — แก้สูตรต้องแก้สองที่
export const FULL_MONTH_MOVE_IN_UNTIL_DAY = 3
export const PRORATE_DAYS_PER_MONTH = 30

// = INVOICE_STATUSES / LABELS ใน main/db/invoices.js
export const INVOICE_STATUS_LABELS = {
  unpaid: 'ค้างชำระ',
  partial_paid: 'ชำระบางส่วน',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก'
}

// = METER_SIDES / LABELS ใน main/db/meterReadings.js
export const METER_SIDES = [
  { key: 'water', label: 'ค่าน้ำ', icon: 'water' },
  { key: 'electric', label: 'ค่าไฟ', icon: 'electric' }
]

// สำเนาของ calculateUnitsUsed ใน main/db/meterReadings.js (แสดงผลระหว่างพิมพ์) — แก้สองที่พร้อมกัน · null = คำนวณไม่ได้
export function previewUnitsUsed(previous, current, options = {}) {
  const { isOverCycle, isMeterReplaced, removedReading, newStartReading, meterDigits } = options

  const digits = Number.isInteger(Number(meterDigits)) ? Number(meterDigits) : 5
  const rollover = 10 ** digits

  const prev = Number(previous)
  const curr = Number(current)
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev < 0 || curr < 0) return null
  if (String(current).trim() === '') return null
  if (curr >= rollover) return null

  // (เลขถอดเก่า − ครั้งก่อน) + (ปัจจุบัน − เลขเริ่มลูกใหม่)
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
