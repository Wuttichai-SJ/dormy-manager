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
