// ทดสอบผังห้อง (ชั้น + ห้อง) — รันด้วย: npm run test:rooms
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
const util = await import('../src/main/db/utilityDefaults.js')
const rooms = await import('../src/main/db/rooms.js')

const { db, cleanup } = await openTempDatabase('dormy-rooms')

function newApartment(name) {
  return apartments.insertApartment(db, {
    nameTh: name,
    addressTh: '1 ถนนทดสอบ',
    dueDateDay: 5,
    lateFeePerDay: '0',
    isAutoLateFeeEnabled: false,
    isVatEnabled: false
  })
}

const apartment = newApartment('หอพักทดสอบ')
const id = apartment.apartmentId

// ตั้งค่าน้ำ/ไฟไว้ก่อน เพื่อดูว่าห้องที่สร้างได้ค่านี้ไปจริงไหม
util.saveUtilityDefaults(db, id, {
  water: { enabled: true, billingType: 'actual', unitPrice: '18', showReadingInInvoice: true },
  electric: {
    enabled: true,
    billingType: 'minimum',
    unitPrice: '8',
    minCharge: '100',
    showReadingInInvoice: false
  }
})

// -----------------------------------------------------
group('เลขห้องอัตโนมัติ')

check('ชั้น 1 ได้ 101 102 103', () => {
  assert(rooms.buildRoomNumber(1, 0) === '101', rooms.buildRoomNumber(1, 0))
  assert(rooms.buildRoomNumber(1, 2) === '103', rooms.buildRoomNumber(1, 2))
})

check('ชั้น 2 ได้ 201', () => {
  assert(rooms.buildRoomNumber(2, 0) === '201', rooms.buildRoomNumber(2, 0))
})

check('ห้องที่ 10 ขึ้นไปยังเรียงถูก (เติมศูนย์ 2 หลัก)', () => {
  // ถ้าไม่เติมศูนย์ ชั้น 1 ที่มี 12 ห้องจะเรียงเป็น 101, 1010, 1011, 102 ...
  assert(rooms.buildRoomNumber(1, 9) === '110', rooms.buildRoomNumber(1, 9))
  assert(rooms.buildRoomNumber(1, 11) === '112', rooms.buildRoomNumber(1, 11))
})

check('ชั้น 10 ได้ 1001', () => {
  assert(rooms.buildRoomNumber(10, 0) === '1001', rooms.buildRoomNumber(10, 0))
})

// -----------------------------------------------------
group('ตรวจข้อมูลผังห้อง')

check('ไม่ระบุชั้นเลยไม่ผ่าน', () => {
  assert(rooms.validateFloorPlan([]).length === 1, 'ควรมี 1 ข้อผิดพลาด')
})

check('จำนวนห้องต้องเป็นจำนวนเต็มตั้งแต่ 1', () => {
  assert(rooms.validateFloorPlan([{ roomCount: 0 }]).length === 1, 'ศูนย์ห้องไม่ควรผ่าน')
  assert(rooms.validateFloorPlan([{ roomCount: 2.5 }]).length === 1, 'ทศนิยมไม่ควรผ่าน')
  assert(rooms.validateFloorPlan([{ roomCount: -1 }]).length === 1, 'ติดลบไม่ควรผ่าน')
})

check('เกินขีดจำกัดถูกปฏิเสธ', () => {
  assert(rooms.validateFloorPlan([{ roomCount: 51 }]).length === 1, '51 ห้อง/ชั้นไม่ควรผ่าน')
  const many = Array.from({ length: 31 }, () => ({ roomCount: 1 }))
  assert(rooms.validateFloorPlan(many).length === 1, '31 ชั้นไม่ควรผ่าน')
})

check('รายงานข้อผิดพลาดทุกชั้นพร้อมกัน พร้อมบอกว่าชั้นไหน', () => {
  const errors = rooms.validateFloorPlan([{ roomCount: 0 }, { roomCount: 3 }, { roomCount: 99 }])
  assert(errors.length === 2, `คาด 2 ข้อ ได้ ${errors.length}`)
  assert(errors[0].includes('ชั้นที่ 1'), errors[0])
  assert(errors[1].includes('ชั้นที่ 3'), errors[1])
})

// -----------------------------------------------------
group('สร้างผังห้อง')

const plan = rooms.generateFloorPlan(db, id, [
  { roomCount: 3 },
  { roomCount: 2 }
])

check('สร้างชั้นและห้องครบตามที่สั่ง', () => {
  assert(plan.length === 2, `ได้ ${plan.length} ชั้น`)
  assert(plan[0].rooms.length === 3, `ชั้น 1 ได้ ${plan[0].rooms.length} ห้อง`)
  assert(plan[1].rooms.length === 2, `ชั้น 2 ได้ ${plan[1].rooms.length} ห้อง`)
})

check('เลขห้องถูกสร้างตามชั้น', () => {
  assert(
    plan[0].rooms.map((r) => r.roomNumber).join(',') === '101,102,103',
    plan[0].rooms.map((r) => r.roomNumber).join(',')
  )
  assert(
    plan[1].rooms.map((r) => r.roomNumber).join(',') === '201,202',
    plan[1].rooms.map((r) => r.roomNumber).join(',')
  )
})

check('ตั้งชื่อชั้นให้อัตโนมัติเมื่อไม่ได้ระบุ', () => {
  assert(plan[0].floorName === 'ชั้น 1', plan[0].floorName)
  assert(plan[1].floorName === 'ชั้น 2', plan[1].floorName)
})

check('ห้องใหม่เริ่มที่ว่าง เปิดใช้งาน และค่าเช่า 0', () => {
  const room = plan[0].rooms[0]
  assert(room.status === 'vacant', room.status)
  assert(room.isActive === true, 'ควรเปิดใช้งาน')
  assert(room.monthlyRentCents === 0, `ได้ ${room.monthlyRentCents}`)
})

check('ทุกห้องได้ค่าน้ำ/ค่าไฟของหอคัดลอกไปครบ', () => {
  const total = rooms.countRooms(db, id)
  const settings = db.prepare('SELECT COUNT(*) AS n FROM room_utility_settings').get().n
  assert(settings === total, `ห้อง ${total} แต่มีการตั้งค่า ${settings} แถว`)

  const one = db
    .prepare(
      `SELECT * FROM room_utility_settings WHERE room_id = ?`
    )
    .get(plan[0].rooms[0].roomId)
  assert(one.water_billing_type === 'actual', one.water_billing_type)
  assert(one.water_unit_price_cents === 1800, `ได้ ${one.water_unit_price_cents}`)
  assert(one.electric_billing_type === 'minimum', one.electric_billing_type)
  assert(one.electric_min_charge_cents === 10000, `ได้ ${one.electric_min_charge_cents}`)
  // toggle แสดงเลขมิเตอร์ต้องตามหอมาด้วย ไม่ใช่ใช้ค่า default ของตาราง
  assert(one.show_electric_reading_in_invoice === 0, 'ควรคัดลอกค่า toggle มาด้วย')
})

check('สร้างผังซ้ำไม่ได้ ต้องบอกให้ไปใช้ปุ่มเพิ่มชั้นแทน', () => {
  throws(
    () => rooms.generateFloorPlan(db, id, [{ roomCount: 1 }]),
    'มีผังห้องอยู่แล้ว',
    'ควรกันการสร้างซ้ำ'
  )
})

check('หอที่ยังไม่ตั้งค่าน้ำ/ไฟ ก็สร้างห้องได้ (ใช้ค่าเริ่มต้น)', () => {
  const bare = newApartment('หอยังไม่ตั้งค่า')
  const result = rooms.generateFloorPlan(db, bare.apartmentId, [{ roomCount: 1 }])
  const setting = db
    .prepare('SELECT * FROM room_utility_settings WHERE room_id = ?')
    .get(result[0].rooms[0].roomId)
  assert(Boolean(setting), 'ห้องต้องมีการตั้งค่าค่าน้ำ/ไฟเสมอ')
  assert(setting.water_billing_type === 'actual', setting.water_billing_type)
})

// -----------------------------------------------------
group('เลขห้องซ้ำ')

check('เพิ่มห้องเลขซ้ำในหอเดียวกันไม่ได้ แม้อยู่คนละชั้น', () => {
  const floor2 = rooms.listFloors(db, id)[1]
  throws(
    () => rooms.addRoom(db, floor2.floorId, { roomNumber: '101' }),
    'อยู่แล้ว',
    'ควรกันเลขห้องซ้ำข้ามชั้น'
  )
})

check('แก้เลขห้องไปชนห้องอื่นไม่ได้', () => {
  const room = rooms.listFloors(db, id)[0].rooms[0]
  throws(
    () => rooms.updateRoom(db, room.roomId, { roomNumber: '102' }),
    'อยู่แล้ว',
    'ควรกันการแก้ไปชนเลขที่มีอยู่'
  )
})

check('แก้เลขห้องเป็นเลขเดิมของตัวเองได้', () => {
  const room = rooms.listFloors(db, id)[0].rooms[0]
  const result = rooms.updateRoom(db, room.roomId, {
    roomNumber: '101',
    roomTypeName: 'ห้องแอร์',
    isActive: false
  })
  const updated = result[0].rooms.find((r) => r.roomId === room.roomId)
  assert(updated.roomTypeName === 'ห้องแอร์', updated.roomTypeName)
  assert(updated.isActive === false, 'ควรถูกปิดใช้งาน')
})

// -----------------------------------------------------
group('เพิ่มชั้น / เพิ่มห้อง')

check('เพิ่มชั้นใหม่ได้เลขห้องต่อจากชั้นที่มี', () => {
  const result = rooms.addFloor(db, id, { roomCount: 2 })
  const newFloor = result[result.length - 1]
  assert(newFloor.floorName === 'ชั้น 3', newFloor.floorName)
  assert(
    newFloor.rooms.map((r) => r.roomNumber).join(',') === '301,302',
    newFloor.rooms.map((r) => r.roomNumber).join(',')
  )
})

check('เพิ่มห้องเดี่ยวพร้อมประเภทห้องได้ และได้ค่าน้ำ/ไฟด้วย', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  const result = rooms.addRoom(db, floor1.floorId, {
    roomNumber: '104',
    roomTypeName: 'ห้องพัดลม'
  })
  const added = result[0].rooms.find((r) => r.roomNumber === '104')
  assert(Boolean(added), 'ไม่พบห้องที่เพิ่ง')
  assert(added.roomTypeName === 'ห้องพัดลม', added.roomTypeName)

  const setting = db
    .prepare('SELECT COUNT(*) AS n FROM room_utility_settings WHERE room_id = ?')
    .get(added.roomId).n
  assert(setting === 1, 'ห้องที่เพิ่มทีหลังต้องมีการตั้งค่าค่าน้ำ/ไฟด้วย')
})

check('เปลี่ยนชื่อชั้นได้', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  const result = rooms.renameFloor(db, floor1.floorId, '  ชั้นล่าง  ')
  assert(result[0].floorName === 'ชั้นล่าง', result[0].floorName)
})

check('ชื่อชั้นว่างถูกปฏิเสธ', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  throws(() => rooms.renameFloor(db, floor1.floorId, '   '), 'กรุณากรอก', 'ควรปฏิเสธชื่อว่าง')
})

// -----------------------------------------------------
group('ลบ')

check('ลบห้องที่ยังไม่มีสัญญาได้ และการตั้งค่าค่าน้ำ/ไฟถูกลบตาม', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  const target = floor1.rooms.find((r) => r.roomNumber === '104')
  rooms.deleteRoom(db, target.roomId)

  const left = db
    .prepare('SELECT COUNT(*) AS n FROM room_utility_settings WHERE room_id = ?')
    .get(target.roomId).n
  assert(left === 0, 'การตั้งค่าค่าน้ำ/ไฟของห้องที่ลบยังค้างอยู่')
})

check('ลบชั้นที่ยังมีห้องไม่ได้ และต้องบอกจำนวนห้อง', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  throws(
    () => rooms.deleteFloor(db, floor1.floorId),
    'ยังมีห้องอยู่ 3 ห้อง',
    'ควรกันการลบชั้นที่มีห้อง'
  )
})

check('ลบห้องที่เคยมีสัญญาไม่ได้ ให้ปิดใช้งานแทน', () => {
  const floor1 = rooms.listFloors(db, id)[0]
  const room = floor1.rooms[0]
  const now = new Date().toISOString()
  const tenantId = db
    .prepare(
      `INSERT INTO tenants (first_name, last_name, phone, id_card_no, created_at)
       VALUES ('ทดสอบ','ผู้เช่า','0810000000','1234567890123',?)`
    )
    .run(now).lastInsertRowid
  db.prepare(
    `INSERT INTO contracts (room_id, tenant_id, rent_type, start_date, rent_amount_cents,
                            deposit_amount_cents, deposit_payment_method, booking_fee_cents,
                            advance_payment_amount_cents, water_meter_start,
                            electric_meter_start, status, created_at)
     VALUES (?, ?, 'monthly', '2026-01-01', 350000, 700000, 'cash', 0, 0, 0, 0, 'active', ?)`
  ).run(room.roomId, tenantId, now)

  throws(
    () => rooms.deleteRoom(db, room.roomId),
    'เคยมีสัญญาเช่าแล้ว',
    'ควรกันการลบห้องที่มีสัญญา'
  )
})

check('ลบชั้นที่ว่างแล้วได้', () => {
  const empty = rooms.addFloor(db, id, { roomCount: 0 })
  const target = empty[empty.length - 1]
  assert(target.rooms.length === 0, 'ชั้นใหม่ควรว่าง')
  const after = rooms.deleteFloor(db, target.floorId)
  assert(
    after.every((f) => f.floorId !== target.floorId),
    'ชั้นยังไม่ถูกลบ'
  )
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลผังห้องทำงานครบทุกเส้นทาง')
