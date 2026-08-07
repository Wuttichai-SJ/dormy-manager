// ทดสอบการคิดค่าน้ำ/ค่าไฟ — รันด้วย: npm run test:utility
import {
  assert,
  check,
  ensureElectronRuntime,
  group,
  openTempDatabase,
  summarize,
  throws
} from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const apartments = await import('../src/main/db/apartments.js')
const rooms = await import('../src/main/db/rooms.js')
const util = await import('../src/main/db/utilityDefaults.js')

const { db, cleanup } = await openTempDatabase('dormy-utility')

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอพักทดสอบ',
  addressTh: '1 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
})
const id = apartment.apartmentId

// -----------------------------------------------------
group('ค่าเริ่มต้นเมื่อยังไม่เคยตั้ง')

check('คืนค่าเริ่มต้นแทน null เพื่อให้หน้าจอมีอะไรแสดงเสมอ', () => {
  const defaults = util.getUtilityDefaults(db, id)
  assert(defaults.isConfigured === false, 'ควรบอกว่ายังไม่ได้ตั้งค่า')
  assert(defaults.water.billingType === 'actual', `ได้ ${defaults.water.billingType}`)
  assert(defaults.electric.enabled === true, 'ค่าไฟควรเปิดไว้เป็นค่าเริ่มต้น')
})

// -----------------------------------------------------
group('ตรวจข้อมูลตามโหมด')

check('โหมด actual บังคับราคาต่อหน่วยอย่างเดียว', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'actual', unitPrice: '18' },
    electric: { enabled: false }
  })
  assert(errors.length === 0, errors.join(' | '))
})

check('โหมด actual ไม่กรอกราคาต่อหน่วยไม่ผ่าน', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'actual', unitPrice: '' },
    electric: { enabled: false }
  })
  assert(errors.length === 1, `คาด 1 ข้อ ได้ ${errors.length}: ${errors.join(' | ')}`)
})

check('โหมด minimum บังคับทั้งราคาต่อหน่วยและขั้นต่ำ', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'minimum', unitPrice: '18', minCharge: '' },
    electric: { enabled: false }
  })
  assert(errors.length === 1, `คาด 1 ข้อ ได้ ${errors.length}: ${errors.join(' | ')}`)
})

check('โหมด flat บังคับเฉพาะค่าเหมาจ่าย ไม่บังคับราคาต่อหน่วย', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'flat', unitPrice: '', flatRate: '100' },
    electric: { enabled: false }
  })
  assert(errors.length === 0, errors.join(' | '))
})

check('ปิดการคิดแล้วไม่ตรวจอะไรเลย', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: false, billingType: 'actual', unitPrice: '' },
    electric: { enabled: false }
  })
  assert(errors.length === 0, errors.join(' | '))
})

check('ประเภทการคิดที่ไม่รู้จักถูกปฏิเสธ', () => {
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'มั่วๆ', unitPrice: '18' },
    electric: { enabled: false }
  })
  assert(errors.length === 1, `คาด 1 ข้อ ได้ ${errors.length}`)
})

// -----------------------------------------------------
group('บันทึก')

const saved = util.saveUtilityDefaults(db, id, {
  water: { enabled: true, billingType: 'actual', unitPrice: '18', showReadingInInvoice: true },
  electric: {
    enabled: true,
    billingType: 'minimum',
    unitPrice: '8',
    minCharge: '100',
    showReadingInInvoice: false
  }
})

check('เก็บราคาเป็นสตางค์ทั้งสองฝั่ง', () => {
  assert(saved.water.unitPriceCents === 1800, `น้ำ ${saved.water.unitPriceCents}`)
  assert(saved.electric.unitPriceCents === 800, `ไฟ ${saved.electric.unitPriceCents}`)
  assert(saved.electric.minChargeCents === 10000, `ขั้นต่ำ ${saved.electric.minChargeCents}`)
})

check('ช่องที่โหมดไม่ได้ใช้ถูกล้างเป็น 0 ไม่เก็บค่าค้าง', () => {
  // น้ำเป็น actual จึงไม่ควรมีขั้นต่ำหรือค่าเหมาจ่ายติดมา
  assert(saved.water.minChargeCents === 0, `ได้ ${saved.water.minChargeCents}`)
  assert(saved.water.flatRateCents === 0, `ได้ ${saved.water.flatRateCents}`)
  assert(saved.electric.flatRateCents === 0, `ได้ ${saved.electric.flatRateCents}`)
})

check('เก็บ toggle แสดงเลขมิเตอร์แยกกันได้', () => {
  assert(saved.water.showReadingInInvoice === true, 'น้ำควรแสดงเลขมิเตอร์')
  assert(saved.electric.showReadingInInvoice === false, 'ไฟไม่ควรแสดงเลขมิเตอร์')
})

// หน้าจอตั้งค่าน้ำกับค่าไฟทีละฝั่ง จึงส่งมาแค่ฝั่งเดียว/ช่องเดียว
// เคยพลาด: ตรวจรวมทุกครั้ง ฝั่งที่ยังไม่มีราคาเลยบล็อกฝั่งที่กำลังกรอก = "ระบุอะไรไม่ได้เลย"
group('บันทึกทีละฝั่ง')

check('ส่งมาฝั่งเดียว อีกฝั่งต้องไม่ถูกล้าง', () => {
  const after = util.saveUtilityDefaults(db, id, {
    water: { enabled: true, billingType: 'flat', flatRate: '150' }
  })
  assert(after.water.flatRateCents === 15000, `น้ำ ${after.water.flatRateCents}`)
  assert(after.electric.unitPriceCents === 800, `ไฟหายไป ${after.electric.unitPriceCents}`)
  assert(after.electric.minChargeCents === 10000, `ขั้นต่ำไฟหาย ${after.electric.minChargeCents}`)
})

check('สลับสวิตช์อย่างเดียวไม่ต้องมีราคา และไม่ทับราคาเดิม', () => {
  const before = util.getUtilityDefaults(db, id)
  const errors = util.validateUtilityInput({ electric: { enabled: true } })
  assert(errors.length === 0, `ไม่ควรมี error ได้ ${errors.join(', ')}`)

  const after = util.saveUtilityDefaults(db, id, { electric: { showReadingInInvoice: true } })
  assert(after.electric.showReadingInInvoice === true, 'สวิตช์ไม่เปลี่ยน')
  assert(
    after.electric.unitPriceCents === before.electric.unitPriceCents,
    `ราคาไฟถูกทับ ${after.electric.unitPriceCents}`
  )
  assert(after.water.flatRateCents === 15000, `ราคาน้ำถูกทับ ${after.water.flatRateCents}`)
})

check('ฝั่งที่ยังไม่มีราคา ต้องไม่บล็อกการบันทึกของอีกฝั่ง', () => {
  const fresh = apartments.insertApartment(db, {
    nameTh: 'หอทดสอบ บันทึกฝั่งเดียว',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  // หอใหม่ยังไม่มีราคาสักฝั่ง — ตั้งค่าน้ำอย่างเดียวต้องผ่าน
  const errors = util.validateUtilityInput({
    water: { enabled: true, billingType: 'actual', unitPrice: '20' }
  })
  assert(errors.length === 0, `ไม่ควรมี error ได้ ${errors.join(', ')}`)

  const after = util.saveUtilityDefaults(db, fresh.apartmentId, {
    water: { enabled: true, billingType: 'actual', unitPrice: '20' }
  })
  assert(after.water.unitPriceCents === 2000, `น้ำ ${after.water.unitPriceCents}`)
})

check('บันทึกซ้ำเป็นการทับของเดิม ไม่ใช่เพิ่มแถวใหม่', () => {
  util.saveUtilityDefaults(db, id, {
    water: { enabled: true, billingType: 'flat', flatRate: '150', showReadingInInvoice: false },
    electric: { enabled: false }
  })
  const rows = db
    .prepare('SELECT COUNT(*) AS n FROM apartment_utility_defaults WHERE apartment_id = ?')
    .get(id).n
  assert(rows === 1, `มี ${rows} แถว ควรมีแถวเดียว`)

  const now = util.getUtilityDefaults(db, id)
  assert(now.water.billingType === 'flat', `ได้ ${now.water.billingType}`)
  assert(now.water.flatRateCents === 15000, `ได้ ${now.water.flatRateCents}`)
  // สลับจาก actual มา flat แล้ว ราคาต่อหน่วยเดิมต้องไม่ค้างอยู่
  assert(now.water.unitPriceCents === 0, `ราคาต่อหน่วยเดิมยังค้าง: ${now.water.unitPriceCents}`)
  assert(now.electric.enabled === false, 'ค่าไฟควรถูกปิด')
  assert(now.isConfigured === true, 'ควรบอกว่าตั้งค่าแล้ว')
})

// -----------------------------------------------------
group('สูตรคิดเงิน')

const actual = { enabled: true, billingType: 'actual', unitPriceCents: 1800 }
const minimum = { enabled: true, billingType: 'minimum', unitPriceCents: 800, minChargeCents: 10000 }
const flat = { enabled: true, billingType: 'flat', flatRateCents: 15000 }

check('actual = หน่วย x ราคาต่อหน่วย', () => {
  assert(util.calculateUtilityCharge(actual, 10) === 18000, 'ใช้ 10 หน่วยควรได้ 180 บาท')
  assert(util.calculateUtilityCharge(actual, 0) === 0, 'ไม่ใช้เลยควรได้ 0')
})

check('actual รองรับหน่วยทศนิยม และปัดเป็นสตางค์เต็ม', () => {
  // 10.5 x 18.00 = 189.00
  assert(util.calculateUtilityCharge(actual, 10.5) === 18900, `ได้ ${util.calculateUtilityCharge(actual, 10.5)}`)
  // 3.33 x 18.00 = 59.94
  assert(util.calculateUtilityCharge(actual, 3.33) === 5994, `ได้ ${util.calculateUtilityCharge(actual, 3.33)}`)
})

check('minimum: ใช้เยอะกว่าขั้นต่ำ คิดตามจริง', () => {
  // 20 x 8 = 160 บาท > ขั้นต่ำ 100
  assert(util.calculateUtilityCharge(minimum, 20) === 16000, `ได้ ${util.calculateUtilityCharge(minimum, 20)}`)
})

check('minimum: ใช้น้อยกว่าขั้นต่ำ คิดเท่าขั้นต่ำ', () => {
  // 5 x 8 = 40 บาท < ขั้นต่ำ 100 -> เก็บ 100
  assert(util.calculateUtilityCharge(minimum, 5) === 10000, `ได้ ${util.calculateUtilityCharge(minimum, 5)}`)
  // ไม่ใช้เลยก็ยังต้องจ่ายขั้นต่ำ
  assert(util.calculateUtilityCharge(minimum, 0) === 10000, `ได้ ${util.calculateUtilityCharge(minimum, 0)}`)
})

check('ขั้นต่ำเป็นบาท ไม่ใช่จำนวนหน่วย', () => {
  // ถ้าตีความผิดเป็น "ขั้นต่ำ 100 หน่วย" ผลจะเป็น 100 x 8 = 800 บาท
  // ค่าที่ถูกต้องคือ 100 บาท — เทสต์นี้กันการตีความผิดนั้นโดยเฉพาะ
  assert(util.calculateUtilityCharge(minimum, 1) === 10000, 'ต้องได้ 100 บาท ไม่ใช่ 800 บาท')
})

check('flat: ใช้เท่าไหร่ก็จ่ายเท่าเดิม', () => {
  assert(util.calculateUtilityCharge(flat, 0) === 15000, 'ไม่ใช้เลยก็จ่ายเต็ม')
  assert(util.calculateUtilityCharge(flat, 999) === 15000, 'ใช้เยอะก็จ่ายเท่าเดิม')
})

check('ปิดการคิด = 0 เสมอ', () => {
  assert(util.calculateUtilityCharge({ ...actual, enabled: false }, 50) === 0, 'ควรได้ 0')
})

check('หน่วยติดลบถูกปฏิเสธ ไม่ใช่คิดเงินคืน', () => {
  // มิเตอร์เดินถอยหลังแปลว่าจดผิดหรือเปลี่ยนมิเตอร์ ต้องให้คนดู ไม่ใช่ออกบิลติดลบ
  throws(() => util.calculateUtilityCharge(actual, -5), 'ติดลบ', 'ควรปฏิเสธหน่วยติดลบ')
})

// -----------------------------------------------------
// -----------------------------------------------------
// ห้องที่ถูกสร้างก่อนหอจะตั้งราคา จะติด "ราคา 0" ไว้แล้วออกบิลเป็น 0 เงียบๆ
// (เจอจริงกับหอนาโรในฐานข้อมูลของผู้ใช้ 2026-08-07)
group('นำราคาของหอไปใช้กับห้องที่มีอยู่')

check('ห้องที่สร้างก่อนตั้งราคา ได้ราคา 0 ติดตัวมา', () => {
  const fresh = apartments.insertApartment(db, {
    nameTh: 'หอสร้างห้องก่อนตั้งราคา',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  rooms.generateFloorPlan(db, fresh.apartmentId, [{ roomCount: 2 }])
  const room = rooms.listFloors(db, fresh.apartmentId)[0].rooms[0]
  const settings = db
    .prepare('SELECT * FROM room_utility_settings WHERE room_id = ?')
    .get(room.roomId)
  assert(settings.water_unit_price_cents === 0, `ได้ ${settings.water_unit_price_cents}`)
  assert(settings.is_water_enabled === 1, 'เปิดเก็บเงินไว้ แต่ราคาเป็น 0 — นี่คือกับดัก')

  // ตั้งราคาทีหลัง แล้วสั่งให้ไปใช้กับห้องที่มีอยู่
  util.saveUtilityDefaults(db, fresh.apartmentId, {
    water: { enabled: true, billingType: 'actual', unitPrice: '25' },
    electric: { enabled: true, billingType: 'actual', unitPrice: '9' }
  })
  const result = util.applyDefaultsToRooms(db, fresh.apartmentId)
  assert(result.updatedRooms === 2, `ทับไป ${result.updatedRooms} ห้อง`)

  const after = db.prepare('SELECT * FROM room_utility_settings WHERE room_id = ?').get(room.roomId)
  assert(after.water_unit_price_cents === 2500, `ได้ ${after.water_unit_price_cents}`)
  assert(after.electric_unit_price_cents === 900, `ได้ ${after.electric_unit_price_cents}`)
})

check('หอที่ยังไม่เคยตั้งราคา สั่งนำไปใช้ไม่ได้ และต้องบอกให้ไปตั้งก่อน', () => {
  const bare = apartments.insertApartment(db, {
    nameTh: 'หอยังไม่ตั้งราคา',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  throws(
    () => util.applyDefaultsToRooms(db, bare.apartmentId),
    'ยังไม่ได้ตั้งค่า',
    'ต้องบอกให้ไปตั้งราคาก่อน'
  )
})

check('เปิดเก็บเงินแต่ทุกราคาเป็น 0 = ยังไม่เคยตั้งราคา ไม่ใช่ตั้งใจให้ฟรี', () => {
  assert(
    util.isSideUnpriced({
      enabled: true,
      unitPriceCents: 0,
      minChargeCents: 0,
      flatRateCents: 0
    }),
    'ควรถือว่ายังไม่ได้ตั้งราคา'
  )
  assert(
    !util.isSideUnpriced({
      enabled: false,
      unitPriceCents: 0,
      minChargeCents: 0,
      flatRateCents: 0
    }),
    'ปิดสวิตช์ = ตั้งใจไม่เก็บ ไม่ใช่ลืมตั้งราคา'
  )
  assert(
    !util.isSideUnpriced({
      enabled: true,
      unitPriceCents: 0,
      minChargeCents: 0,
      flatRateCents: 50000
    }),
    'เหมาจ่ายมีราคาแล้ว'
  )
})

// -----------------------------------------------------
cleanup()
summarize('การคิดค่าน้ำ/ค่าไฟทำงานครบทุกโหมด')
