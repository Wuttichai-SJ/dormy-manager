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

// -----------------------------------------------------
group('การแปลงเงิน (สตางค์)')

check('บาททศนิยมแปลงเป็นสตางค์ถูกต้อง', () => {
  assert(toCents('1500') === 150000, `1500 -> ${toCents('1500')}`)
  assert(toCents('1500.50') === 150050, `1500.50 -> ${toCents('1500.50')}`)
  assert(toCents('0') === 0, 'ศูนย์ต้องได้ 0')
  assert(toCents('0.05') === 5, `0.05 -> ${toCents('0.05')}`)
  // ทศนิยมตำแหน่งเดียวต้องเติมศูนย์ ไม่ใช่ตีความเป็น 5 สตางค์
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

// -----------------------------------------------------
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
  // เดือนกุมภาพันธ์ไม่มีวันที่ 29-31 ถ้ายอมให้ตั้งไว้ ระบบจะคิดค่าปรับผิดทั้งหอ
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

// -----------------------------------------------------
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
  // หอเปล่าต้องยังขึ้นในรายการ (นับได้ 0) ไม่ใช่หายไปทั้งแถวเพราะ JOIN ไม่เจอห้อง
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

// -----------------------------------------------------
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

// -----------------------------------------------------
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

// -----------------------------------------------------
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

// -----------------------------------------------------
cleanup()
summarize('โมดูลหอพักทำงานครบทุกเส้นทาง')
