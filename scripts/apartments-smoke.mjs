// ทดสอบโมดูลหอพักบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:apartments
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
const { toCents, centsToBaht } = await import('../src/main/money.js')

const { db, cleanup } = await openTempDatabase('dormy-apartments')

group('การแปลงเงิน (สตางค์)')

check('บาททศนิยมแปลงเป็นสตางค์ถูกต้อง', () => {
  assert(toCents('1500') === 150000, `1500 -> ${toCents('1500')}`)
  assert(toCents('1500.50') === 150050, `1500.50 -> ${toCents('1500.50')}`)
  assert(toCents('0') === 0, 'ศูนย์ต้องได้ 0')
  assert(toCents('0.05') === 5, `0.05 -> ${toCents('0.05')}`)
  assert(toCents('10.5') === 1050, `10.5 -> ${toCents('10.5')}`)
})

check('รับคอมมาคั่นหลักพันที่คนไทยพิมพ์จริง', () => {
  assert(toCents('1,500.50') === 150050, `1,500.50 -> ${toCents('1,500.50')}`)
})

check('ปฏิเสธค่าที่ไม่ใช่จำนวนเงิน แทนที่จะปัดเงียบๆ', () => {
  throws(() => toCents('33.333', 'ค่าเช่า'), 'ทศนิยมไม่เกิน 2', 'ทศนิยม 3 ตำแหน่งต้องไม่ผ่าน')
  throws(() => toCents('-50', 'ค่าเช่า'), 'ไม่ติดลบ', 'ค่าติดลบต้องไม่ผ่าน')
  throws(() => toCents('abc', 'ค่าเช่า'), 'ตัวเลข', 'ตัวอักษรต้องไม่ผ่าน')
  throws(() => toCents('', 'ค่าเช่า'), 'กรุณากรอก', 'ค่าว่างต้องไม่ผ่าน')
})

check('แปลงกลับเป็นบาทคงสตางค์ไว้ครบ', () => {
  assert(centsToBaht(150050) === '1500.50', centsToBaht(150050))
  assert(centsToBaht(5) === '0.05', centsToBaht(5))
  assert(centsToBaht(150000) === '1500.00', centsToBaht(150000))
})

group('ตรวจข้อมูลก่อนบันทึก')

check('รายงานข้อผิดพลาดครบทุกข้อในครั้งเดียว', () => {
  const errors = apartments.validateApartmentInput({
    nameTh: '',
    addressTh: '',
    dueDateDay: 31,
    lateFeePerDay: ''
  })
  assert(errors.length === 4, `คาด 4 ข้อ ได้ ${errors.length}: ${errors.join(' | ')}`)
})

check('วันครบกำหนดเกินวันที่ 28 ถูกปฏิเสธ', () => {
  for (const day of [0, 29, 30, 31, 1.5]) {
    const errors = apartments.validateApartmentInput({
      nameTh: 'หอทดสอบ',
      addressTh: '123',
      dueDateDay: day,
      lateFeePerDay: '0'
    })
    assert(errors.length === 1, `วันที่ ${day} ควรถูกปฏิเสธ`)
  }
})

check('วันที่ 1-28 และค่าปรับ 0 ผ่านได้', () => {
  const errors = apartments.validateApartmentInput({
    nameTh: 'หอทดสอบ',
    addressTh: '123 ถนนทดสอบ',
    dueDateDay: 28,
    lateFeePerDay: '0'
  })
  assert(errors.length === 0, errors.join(' | '))
})

check('จำนวนหลักของมิเตอร์นอกช่วงที่รับได้ ถูกปฏิเสธ', () => {
  for (const digits of [0, 2, 9, 12, 5.5]) {
    const errors = apartments.validateApartmentInput({
      nameTh: 'หอทดสอบ',
      addressTh: '123',
      dueDateDay: 5,
      lateFeePerDay: '0',
      meterDigits: digits
    })
    assert(errors.length === 1, `${digits} หลักควรถูกปฏิเสธ — ได้ ${errors.length} ข้อ`)
  }
})

check('ไม่ส่งจำนวนหลักมา = ไม่ได้มาแก้ช่องนี้ ไม่ใช่ข้อผิดพลาด', () => {
  const errors = apartments.validateApartmentInput({
    nameTh: 'หอทดสอบ',
    addressTh: '123',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  assert(errors.length === 0, errors.join(' | '))
})

group('สร้าง / อ่าน / แก้ไข')

const first = apartments.insertApartment(db, {
  nameTh: 'หอพักทดสอบ ก',
  addressTh: '1 ถนนทดสอบ กรุงเทพฯ',
  nameEn: 'Test Dorm A',
  addressEn: '1 Test Rd',
  phone: '081-234-5678',
  dueDateDay: 5,
  lateFeePerDay: '50',
  isAutoLateFeeEnabled: true,
  isVatEnabled: false
})

check('เก็บค่าปรับเป็นสตางค์ ไม่ใช่บาท', () => {
  assert(first.lateFeePerDayCents === 5000, `ได้ ${first.lateFeePerDayCents}`)
})

check('แปลง 0/1 เป็น boolean ให้หน้าจอ', () => {
  assert(first.isAutoLateFeeEnabled === true, 'is_auto_late_fee_enabled ควรเป็น true')
  assert(first.isVatEnabled === false, 'is_vat_enabled ควรเป็น false')
})

check('ไม่ระบุจำนวนหลักของมิเตอร์ ได้ 5 หลักเป็นค่าเริ่มต้น', () => {
  assert(first.meterDigits === 5, `ได้ ${first.meterDigits}`)
})

check('ตั้งจำนวนหลักเองแล้วบันทึกและอ่านกลับได้', () => {
  const updated = apartments.updateApartment(db, first.apartmentId, {
    nameTh: first.nameTh,
    addressTh: first.addressTh,
    dueDateDay: 5,
    lateFeePerDay: '50',
    isAutoLateFeeEnabled: true,
    meterDigits: 6
  })
  assert(updated.meterDigits === 6, `ได้ ${updated.meterDigits}`)

  apartments.updateApartment(db, first.apartmentId, {
    nameTh: first.nameTh,
    addressTh: first.addressTh,
    dueDateDay: 5,
    lateFeePerDay: '50',
    isAutoLateFeeEnabled: true,
    meterDigits: 5
  })
})

check('ช่องไม่บังคับที่เว้นว่างเก็บเป็น NULL ไม่ใช่สตริงว่าง', () => {
  const bare = apartments.insertApartment(db, {
    nameTh: 'หอพักทดสอบ ข',
    addressTh: '2 ถนนทดสอบ',
    nameEn: '',
    addressEn: '   ',
    phone: '',
    dueDateDay: 10,
    lateFeePerDay: '0',
    isAutoLateFeeEnabled: false,
    isVatEnabled: false
  })
  assert(bare.nameEn === null, `nameEn = ${JSON.stringify(bare.nameEn)}`)
  assert(bare.addressEn === null, `addressEn = ${JSON.stringify(bare.addressEn)}`)
  assert(bare.phone === null, `phone = ${JSON.stringify(bare.phone)}`)
})

check('หอใหม่ต่อท้ายลำดับเสมอ', () => {
  const third = apartments.insertApartment(db, {
    nameTh: 'หอพักทดสอบ ค',
    addressTh: '3 ถนนทดสอบ',
    dueDateDay: 1,
    lateFeePerDay: '20',
    isAutoLateFeeEnabled: false,
    isVatEnabled: false
  })
  assert(third.displayOrder === 3, `displayOrder = ${third.displayOrder}`)
})

check('รายการเรียงตาม display_order และนับห้องได้แม้ยังไม่มีห้อง', () => {
  const list = apartments.listApartments(db)
  assert(list.length === 3, `คาด 3 หอ ได้ ${list.length}`)
  assert(list[0].nameTh === 'หอพักทดสอบ ก', `ตัวแรกคือ ${list[0].nameTh}`)
  assert(list[0].totalRooms === 0, `totalRooms = ${list[0].totalRooms}`)
  assert(list[0].vacantRooms === 0, `vacantRooms = ${list[0].vacantRooms}`)
})

check('แก้ไขแล้วค่าเปลี่ยนจริงและมี updated_at', () => {
  const updated = apartments.updateApartment(db, first.apartmentId, {
    nameTh: 'หอพักทดสอบ ก (แก้ไขแล้ว)',
    addressTh: '1 ถนนทดสอบ กรุงเทพฯ',
    phone: '',
    dueDateDay: 15,
    lateFeePerDay: '75.25',
    isAutoLateFeeEnabled: false,
    isVatEnabled: true
  })
  assert(updated.nameTh.includes('แก้ไขแล้ว'), updated.nameTh)
  assert(updated.dueDateDay === 15, `dueDateDay = ${updated.dueDateDay}`)
  assert(updated.lateFeePerDayCents === 7525, `ได้ ${updated.lateFeePerDayCents}`)
  assert(updated.isVatEnabled === true, 'ควรเปิด VAT แล้ว')
  assert(updated.phone === null, 'ลบเบอร์โทรออกต้องกลายเป็น NULL')
  assert(Boolean(updated.updatedAt), 'ไม่ได้ตั้ง updated_at')
})

check('แก้ไขหอที่ไม่มีอยู่ต้องแจ้งเตือน ไม่ใช่เงียบ', () => {
  throws(
    () =>
      apartments.updateApartment(db, 9999, {
        nameTh: 'ไม่มีอยู่จริง',
        addressTh: '-',
        dueDateDay: 1,
        lateFeePerDay: '0'
      }),
    'ไม่พบหอพัก',
    'ควรแจ้งว่าไม่พบ'
  )
})

check('เปิดเก็บค่าปรับแต่ตั้งอัตราไว้ 0 ต้องไม่ผ่าน', () => {
  const errors = apartments.validateApartmentInput({
    nameTh: 'หอทดสอบ',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0',
    isAutoLateFeeEnabled: true
  })
  assert(
    errors.some((e) => e.includes('มากกว่า 0')),
    `ควรเตือนให้กรอกอัตรา ได้ ${errors.join(' | ')}`
  )
})

check('ปิดเก็บค่าปรับแล้วตั้งอัตรา 0 ได้ตามปกติ', () => {
  const errors = apartments.validateApartmentInput({
    nameTh: 'หอทดสอบ',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0',
    isAutoLateFeeEnabled: false
  })
  assert(errors.length === 0, errors.join(' | '))
})

group('จัดเรียงลำดับ')

check('สลับลำดับแล้วรายการเรียงตามที่สั่ง', () => {
  const ids = apartments.listApartments(db).map((a) => a.apartmentId)
  const reversed = [...ids].reverse()
  const list = apartments.reorderApartments(db, reversed)
  assert(
    list.map((a) => a.apartmentId).join(',') === reversed.join(','),
    `ได้ลำดับ ${list.map((a) => a.apartmentId).join(',')}`
  )
})

group('ปิดงานตั้งค่า')

check('หอที่เพิ่งสร้างยังไม่นับว่าตั้งค่าเสร็จ', () => {
  const created = apartments.insertApartment(db, {
    nameTh: 'หอพักทดสอบ ตั้งค่า',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  assert(created.isSetupComplete === false, 'หอใหม่ไม่ควรนับว่าเสร็จ')
  assert(created.setupCompletedAt === null, `ได้ ${created.setupCompletedAt}`)
})

check('กดเสร็จสิ้นแล้วปลดล็อก และเวลาที่บันทึกไว้ไม่ถูกทับถ้ากดซ้ำ', () => {
  const target = apartments.listApartments(db).find((a) => a.nameTh === 'หอพักทดสอบ ตั้งค่า')
  const first = apartments.markSetupCompleted(db, target.apartmentId)
  assert(first.isSetupComplete === true, 'ควรปลดล็อกแล้ว')
  assert(typeof first.setupCompletedAt === 'string', 'ควรมีเวลาที่ตั้งค่าเสร็จ')

  const again = apartments.markSetupCompleted(db, target.apartmentId)
  assert(
    again.setupCompletedAt === first.setupCompletedAt,
    `เวลาถูกทับ ${first.setupCompletedAt} -> ${again.setupCompletedAt}`
  )
})

check('ปิดงานตั้งค่าให้หอที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => apartments.markSetupCompleted(db, 9999), 'ไม่พบหอพัก', 'ควรแจ้งว่าไม่พบ')
})

group('ลบ')

check('ลบหอที่ยังไม่มีชั้น/ห้องได้', () => {
  const before = apartments.countApartments(db)
  const target = apartments.listApartments(db).find((a) => a.nameTh === 'หอพักทดสอบ ค')
  apartments.deleteApartment(db, target.apartmentId)
  assert(apartments.countApartments(db) === before - 1, 'จำนวนหอไม่ลดลง')
})

check('ลบหอที่มีชั้นอยู่ไม่ได้ และต้องบอกเหตุผลที่คนอ่านรู้เรื่อง', () => {
  const target = apartments.listApartments(db)[0]
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO floors (apartment_id, floor_name, room_count, created_at) VALUES (?, ?, ?, ?)'
  ).run(target.apartmentId, 'ชั้น 1', 3, now)

  throws(
    () => apartments.deleteApartment(db, target.apartmentId),
    'มีชั้น/ห้องพักอยู่แล้ว',
    'ควรกันไม่ให้ลบหอที่มีชั้น'
  )
  assert(apartments.getApartmentById(db, target.apartmentId) !== null, 'หอต้องยังอยู่')
})

check('ลบหอที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => apartments.deleteApartment(db, 9999), 'ไม่พบหอพัก', 'ควรแจ้งว่าไม่พบ')
})

check('ลบหอที่ตั้งค่าน้ำ/ค่าไฟ ค่าบริการ และบัญชีไว้แล้วได้ (ไม่ติด FK)', () => {
  const created = apartments.insertApartment(db, {
    nameTh: 'หอพักทดสอบ ลบพร้อมลูก',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  const id = created.apartmentId
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO apartment_utility_defaults
       (apartment_id, is_water_enabled, water_billing_type, water_unit_price_cents,
        is_electric_enabled, electric_billing_type, electric_unit_price_cents, created_at)
     VALUES (?, 1, 'actual', 1800, 1, 'actual', 800, ?)`
  ).run(id, now)
  db.prepare(
    'INSERT INTO apartment_services (apartment_id, name, price_cents, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, 'ค่าอินเทอร์เน็ต', 30000, now)
  db.prepare(
    `INSERT INTO apartment_bank_accounts (apartment_id, bank_name, account_name, account_number, is_default, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(id, 'กสิกรไทย (Kasikorn)', 'ทดสอบ', '1234567890', now)

  apartments.deleteApartment(db, id)

  assert(apartments.getApartmentById(db, id) === null, 'หอต้องถูกลบจริง')
  const leftovers = ['apartment_utility_defaults', 'apartment_services', 'apartment_bank_accounts']
    .map((t) => `${t}:${db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE apartment_id = ?`).get(id).n}`)
    .filter((s) => !s.endsWith(':0'))
  assert(leftovers.length === 0, `ยังเหลือข้อมูลค้าง ${leftovers.join(', ')}`)
})

group('นับห้องว่าง')

check('นับเฉพาะห้องสถานะ vacant', () => {
  const target = apartments.listApartments(db)[0]
  const now = new Date().toISOString()
  const floorId = db
    .prepare('SELECT floor_id FROM floors WHERE apartment_id = ?')
    .get(target.apartmentId).floor_id
  const typeId = db
    .prepare('INSERT INTO room_types (apartment_id, name, created_at) VALUES (?, ?, ?)')
    .run(target.apartmentId, 'ห้องพัดลม', now).lastInsertRowid

  const insertRoom = db.prepare(
    `INSERT INTO rooms (floor_id, room_type_id, room_number, is_active,
                        monthly_rent_cents, daily_rent_cents, status, created_at)
     VALUES (?, ?, ?, 1, 350000, NULL, ?, ?)`
  )
  insertRoom.run(floorId, typeId, '101', 'vacant', now)
  insertRoom.run(floorId, typeId, '102', 'vacant', now)
  insertRoom.run(floorId, typeId, '103', 'occupied', now)

  const listed = apartments.listApartments(db).find((a) => a.apartmentId === target.apartmentId)
  assert(listed.totalRooms === 3, `totalRooms = ${listed.totalRooms}`)
  assert(listed.vacantRooms === 2, `vacantRooms = ${listed.vacantRooms}`)
})

group('นโยบายคืนเงินประกันของหอ')

const policyHome = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบนโยบายเงินประกัน',
  addressTh: 'ที่อยู่',
  dueDateDay: 10,
  lateFeePerDay: '0'
})

check('ค่าตั้งต้นตรงกับกติกาที่เจ้าของหอยืนยันไว้', () => {
  const policy = apartments.getDepositPolicy(db, policyHome.apartmentId)
  assert(policy.policy === 'on_full_term', `ได้ ${policy.policy}`)
  assert(policy.noticeDays === 15, `ได้ ${policy.noticeDays}`)
  assert(policy.minStayMonths === null, `ได้ ${policy.minStayMonths}`)
  assert(policy.policyLabel === 'คืนเมื่ออยู่ครบตามสัญญา', `ได้ ${policy.policyLabel}`)
})

check('บันทึกแล้วอ่านกลับมาได้ และเว้นเดือนขั้นต่ำเป็นว่างได้', () => {
  const saved = apartments.saveDepositPolicy(db, policyHome.apartmentId, {
    policy: 'on_full_term',
    noticeDays: 30,
    minStayMonths: 6
  })
  assert(saved.noticeDays === 30, `ได้ ${saved.noticeDays}`)
  assert(saved.minStayMonths === 6, `ได้ ${saved.minStayMonths}`)

  const cleared = apartments.saveDepositPolicy(db, policyHome.apartmentId, {
    policy: 'always',
    noticeDays: 15,
    minStayMonths: ''
  })
  assert(cleared.minStayMonths === null, `ได้ ${cleared.minStayMonths}`)
  assert(cleared.policy === 'always', `ได้ ${cleared.policy}`)
})

check('นโยบายที่ไม่รู้จัก / วันติดลบ / ค่าเกินเพดาน ต้องไม่ผ่าน', () => {
  throws(
    () =>
      apartments.saveDepositPolicy(db, policyHome.apartmentId, {
        policy: 'refund_maybe',
        noticeDays: 15
      }),
    'กรุณาเลือกนโยบาย',
    'นโยบายมั่วผ่านได้'
  )
  throws(
    () =>
      apartments.saveDepositPolicy(db, policyHome.apartmentId, {
        policy: 'on_full_term',
        noticeDays: -1
      }),
    'ไม่ติดลบ',
    'วันติดลบผ่านได้'
  )
  throws(
    () =>
      apartments.saveDepositPolicy(db, policyHome.apartmentId, {
        policy: 'on_full_term',
        noticeDays: 400
      }),
    'ไม่เกิน',
    'วันเกินเพดานผ่านได้'
  )
  throws(
    () =>
      apartments.saveDepositPolicy(db, policyHome.apartmentId, {
        policy: 'on_full_term',
        noticeDays: 15,
        minStayMonths: 0
      }),
    'ตั้งแต่ 1',
    'เดือนขั้นต่ำ 0 ผ่านได้'
  )
})

check('หอที่ไม่มีอยู่ อ่านหรือบันทึกไม่ได้', () => {
  throws(() => apartments.getDepositPolicy(db, 999999), 'ไม่พบหอพัก', 'อ่านหอมั่วได้')
  throws(
    () => apartments.saveDepositPolicy(db, 999999, { policy: 'always', noticeDays: 15 }),
    'ไม่พบหอพัก',
    'บันทึกหอมั่วได้'
  )
})

group('อัตรา VAT')

const vatBase = {
  nameTh: 'หอทดสอบ VAT',
  addressTh: '1 ถนนทดสอบ',
  dueDateDay: 10,
  lateFeePerDay: '0'
}

check('อัตราที่ใช้ได้จริงต้องผ่านทุกตัว รวมเลขที่ทศนิยมลอยทำพัง', () => {
  for (const rate of ['0', '7', '7.1', '7.5', '8.2', '2.3', '10', '12.9', '16.4', '100']) {
    const errors = apartments.validateApartmentInput({ ...vatBase, vatRate: rate })
    assert(errors.length === 0, `อัตรา ${rate} ควรผ่าน แต่ได้: ${errors.join(' / ')}`)
  }
})

check('อัตราที่ใช้ไม่ได้ต้องถูกปฏิเสธ', () => {
  for (const rate of ['-1', '101', '7.125', 'abc', '7.5.5']) {
    const errors = apartments.validateApartmentInput({ ...vatBase, vatRate: rate })
    assert(errors.length > 0, `อัตรา ${rate} ควรถูกปฏิเสธ`)
  }
})

check('เปิดสวิตช์ VAT แล้วตั้งอัตราเป็น 0 ไม่ได้', () => {
  const errors = apartments.validateApartmentInput({
    ...vatBase,
    isVatEnabled: true,
    vatRate: '0'
  })
  assert(
    errors.some((e) => e.includes('อัตรา VAT')),
    `ควรเตือนเรื่องอัตรา ได้: ${errors.join(' / ')}`
  )
})

check('เก็บและอ่านอัตรากลับมาได้ · เว้นว่างถอยไปที่ 7 ไม่ใช่ 0', () => {
  const withRate = apartments.insertApartment(db, {
    ...vatBase,
    nameTh: 'หอ VAT 8.2',
    isVatEnabled: true,
    vatRate: '8.2'
  })
  assert(withRate.vatRate === 8.2, `ได้ ${withRate.vatRate}`)

  const blank = apartments.insertApartment(db, {
    ...vatBase,
    nameTh: 'หอ VAT เว้นว่าง',
    vatRate: ''
  })
  assert(blank.vatRate === 7, `เว้นว่างควรได้ 7 ได้ ${blank.vatRate}`)
})

cleanup()
summarize('โมดูลหอพักทำงานครบทุกเส้นทาง')
