// ทดสอบโมดูลสัญญาเช่าบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:contracts
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
const services = await import('../src/main/db/apartmentServices.js')
const rooms = await import('../src/main/db/rooms.js')
const tenants = await import('../src/main/db/tenants.js')
const contracts = await import('../src/main/db/contracts.js')

const { db, cleanup } = await openTempDatabase('dormy-contracts')

// ตั้งฉากหลัง: หอ 1 หอ / ชั้น 1 ชั้น / ห้อง 2 ห้อง / ค่าบริการ 1 รายการผูกกับห้องแรก
const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบสัญญา',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId

const internet = services.insertService(db, apartmentId, { name: 'ค่าอินเทอร์เน็ต', price: '300' })
rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 4 }])
const floor = rooms.listFloors(db, apartmentId)[0]
const [room1, room2, room3, room4] = floor.rooms
rooms.attachServicesToRooms(db, [room1.roomId], [internet.serviceId])

const somchai = tenants.insertTenant(db, {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0811111111'
})
const somying = tenants.insertTenant(db, {
  firstName: 'สมหญิง',
  lastName: 'รักเรียน',
  phone: '0822222222'
})

// สัญญาที่มีเงินจอง ระบบจะออกใบเสร็จเงินประกันให้ก้อนนั้นทันที (ดู createContract)
// ใบเสร็จต้องมีผู้รับเงินเสมอ จึงต้องมีผู้ใช้ในระบบให้อ้างถึง
const staff = (await import('../src/main/db/users.js')).insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  email: 'manager-contracts@example.com',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const BASE = {
  rentType: 'monthly',
  startDate: '2026-07-18',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 3124,
  electricMeterStart: 4476,
  createdBy: staff.user_id
}

// -----------------------------------------------------
group('ค่าเช่าล่วงหน้าตามสัดส่วนวัน')

// ตัวเลขชุดนี้ถอดจากหน้าจอจริงของต้นแบบ: ค่าเช่า 5,000 เข้าพัก 18 ก.ค. → 2,258.06
check('เข้าพักกลางเดือน คิดเฉพาะวันที่เหลือ', () => {
  // เข้า 18 ก.ค. = อยู่ 14 วัน (18-31) → 5000 ÷ 30 × 14 = 2,333.33
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-18')
  assert(got === 233333, `ควรได้ 233333 สตางค์ ได้ ${got}`)
})

// **กติกาจริงของหอ ยืนยันกับเจ้าของหอ 2026-08-10** — "เข้าอยู่ช่วงวันที่ 2 หรือ 3 ก็คิดเต็มเดือน"
check('เข้าพักวันที่ 1-3 คิดเต็มเดือน ไม่ปัดลดให้', () => {
  for (const day of ['01', '02', '03']) {
    const got = contracts.calculateAdvanceRentCents(500000, `2026-07-${day}`)
    assert(got === 500000, `วันที่ ${day} ควรได้เต็มเดือน ได้ ${got}`)
  }
})

check('เข้าพักวันที่ 4 เริ่มคิดตามวัน', () => {
  // 4-31 ก.ค. = 28 วัน → 5000 ÷ 30 × 28 = 4,666.67 (น้อยกว่าเต็มเดือน)
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-04')
  assert(got === 466667, `ได้ ${got}`)
  assert(got < 500000, 'ต้องไม่เกินค่าเช่าเต็มเดือน')
})

// **หารด้วย 30 เสมอ ไม่ใช่จำนวนวันจริงของเดือน** — เจ้าของหอบอกว่า "เอาราคาห้องหาร 30 วัน
// แล้วนับวันคิด" ต่างจากของเดิมที่หารด้วยจำนวนวันจริง ซึ่งเพี้ยนทุกเดือนที่ไม่มี 30 วัน
check('หารด้วย 30 เสมอ เดือน 31 วันกับ 28 วันจึงได้ต่อวันเท่ากัน', () => {
  const perDay = Math.round(500000 / 30)

  // ก.ค. 31 วัน เข้าวันสุดท้าย = อยู่ 1 วัน
  assert(contracts.calculateAdvanceRentCents(500000, '2026-07-31') === perDay, 'ก.ค. วันสุดท้าย')
  // ก.พ. 28 วัน เข้าวันสุดท้าย = อยู่ 1 วัน ต้องได้เท่ากันเป๊ะ
  assert(contracts.calculateAdvanceRentCents(500000, '2026-02-28') === perDay, 'ก.พ. วันสุดท้าย')
})

check('ปีอธิกสุรทินนับวันที่อยู่จริงถูก แต่ยังหารด้วย 30', () => {
  // 2028 เป็นปีอธิกสุรทิน ก.พ. มี 29 วัน — เข้า 20 ก.พ. = อยู่ 10 วัน (20-29)
  const got = contracts.calculateAdvanceRentCents(300000, '2028-02-20')
  assert(got === Math.round((300000 * 10) / 30), `ได้ ${got}`)

  // เข้าวันที่ 1 ยังคิดเต็มเดือนเหมือนเดิม
  assert(contracts.calculateAdvanceRentCents(290000, '2028-02-01') === 290000, 'วันที่ 1 เต็มเดือน')
})

// -----------------------------------------------------
group('ตรวจข้อมูล')

check('ต้องมีผู้เช่าอย่างน้อยหนึ่งคน', () => {
  const errors = contracts.validateContractInput({ ...BASE, tenants: [] })
  assert(errors.some((e) => e.includes('ผู้เช่าอย่างน้อย')), errors.join(', '))
})

check('วันที่ออกก่อนวันที่เข้าพักไม่ได้', () => {
  const errors = contracts.validateContractInput({
    ...BASE,
    endDate: '2026-07-01',
    tenants: [somchai.tenantId]
  })
  assert(errors.some((e) => e.includes('ไม่ก่อนวันที่เข้าพัก')), errors.join(', '))
})

check('วิธีชำระเงินประกันต้องเป็นค่าที่รู้จัก', () => {
  const errors = contracts.validateContractInput({
    ...BASE,
    depositPaymentMethod: 'bitcoin',
    tenants: [somchai.tenantId]
  })
  assert(errors.some((e) => e.includes('วิธีชำระเงินประกัน')), errors.join(', '))
})

check('เลขมิเตอร์ติดลบไม่ได้', () => {
  const errors = contracts.validateContractInput({
    ...BASE,
    waterMeterStart: -1,
    tenants: [somchai.tenantId]
  })
  assert(errors.some((e) => e.includes('เลขมิเตอร์ค่าน้ำ')), errors.join(', '))
})

// `Number('')` เป็น 0 ซึ่งเป็นเลขมิเตอร์ที่อ่านได้จริง ช่องที่ลืมกรอกจึงเคยผ่านเข้าไปเงียบๆ
// เป็น 0 ทั้งที่ป้ายเขียนว่า "* จำเป็น" — และเลขนี้เป็นเลขตั้งต้นของบิลใบแรก
// ห้องที่หน้าปัดเดินอยู่ที่ 8,000 จะกลายเป็นใช้ไป 8,000 หน่วยในบิลแรกของผู้เช่าใหม่
check('เลขมิเตอร์ที่เว้นว่างไว้ต้องไม่ผ่านเป็น 0 เงียบๆ', () => {
  for (const key of ['waterMeterStart', 'electricMeterStart']) {
    const errors = contracts.validateContractInput({
      ...BASE,
      [key]: '',
      tenants: [somchai.tenantId]
    })
    assert(
      errors.some((e) => e.includes('กรุณากรอกเลขมิเตอร์')),
      `${key}: ${errors.join(', ') || 'ไม่มี error เลย'}`
    )
  }
})

check('กรอกศูนย์มาจริงๆ ยังผ่านได้ (มิเตอร์ลูกใหม่เริ่มที่ 0)', () => {
  const errors = contracts.validateContractInput({
    ...BASE,
    waterMeterStart: '0',
    electricMeterStart: 0,
    tenants: [somchai.tenantId]
  })
  assert(!errors.some((e) => e.includes('เลขมิเตอร์')), errors.join(', '))
})

// -----------------------------------------------------
group('สร้างสัญญา')

const created = contracts.createContract(db, {
  ...BASE,
  roomId: room1.roomId,
  tenants: [somchai.tenantId, somying.tenantId]
})

check('เก็บเงินเป็นสตางค์ และคิดค่าเช่าล่วงหน้าให้เอง', () => {
  assert(created.rentAmountCents === 500000, `ค่าเช่า ${created.rentAmountCents}`)
  assert(created.depositAmountCents === 500000, `เงินประกัน ${created.depositAmountCents}`)
  // เข้าพัก 18 ก.ค. = อยู่ 14 วัน → 5000 ÷ 30 × 14 = 2,333.33 (กติกาของหอ ยืนยัน 2026-08-10)
  assert(created.advancePaymentAmountCents === 233333, `ล่วงหน้า ${created.advancePaymentAmountCents}`)
})

// เลขที่ใบจองออกให้เฉพาะตอนมีเงินจองจริง ไม่ใช่ออกให้ทุกสัญญา
check('ไม่มีเงินจอง ก็ไม่ต้องมีเลขที่ใบจอง', () => {
  assert(created.bookingReceiptNo === null, `ได้ ${created.bookingReceiptNo}`)
})

check('มีเงินจองแต่ไม่ได้กรอกเลขที่ ระบบออกเลขให้เอง', () => {
  const walkIn = contracts.createContract(db, {
    ...BASE,
    roomId: room3.roomId,
    bookingFee: '1000',
    tenants: [somchai.tenantId]
  })
  const period = BASE.startDate.slice(0, 7).replace('-', '')
  assert(walkIn.bookingReceiptNo === `B${period}0001`, `ได้ ${walkIn.bookingReceiptNo}`)
})

check('กรอกเลขที่มาเอง ระบบต้องไม่ทับ (หอที่ใช้เล่มใบเสร็จของตัวเอง)', () => {
  const own = contracts.createContract(db, {
    ...BASE,
    roomId: room4.roomId,
    bookingFee: '1000',
    bookingReceiptNo: 'เล่ม 5 เลขที่ 042',
    tenants: [somying.tenantId]
  })
  assert(own.bookingReceiptNo === 'เล่ม 5 เลขที่ 042', `ได้ ${own.bookingReceiptNo}`)
})

check('ผู้เช่าหลายคนต่อสัญญา คนแรกเป็นผู้เช่าหลัก', () => {
  assert(created.tenants.length === 2, `ได้ ${created.tenants.length} คน`)
  assert(created.primaryTenant.tenantId === somchai.tenantId, 'คนแรกต้องเป็นผู้เช่าหลัก')
  assert(created.tenants.filter((t) => t.isPrimary).length === 1, 'ผู้เช่าหลักต้องมีคนเดียว')
})

// จุดสำคัญของโมดูลนี้: ราคาค่าบริการถูกตรึงไว้ ณ วันทำสัญญา
check('ค่าบริการของห้องถูกถ่ายสำเนาลงสัญญา', () => {
  assert(created.services.length === 1, `ได้ ${created.services.length} รายการ`)
  assert(created.services[0].priceCents === 30000, `ราคา ${created.services[0].priceCents}`)
})

check('ขึ้นราคาค่าบริการทีหลัง ไม่กระทบสัญญาที่เซ็นไปแล้ว', () => {
  services.updateService(db, internet.serviceId, { name: 'ค่าอินเทอร์เน็ต', price: '500' })
  const reread = contracts.getContractById(db, created.contractId)
  assert(reread.services[0].priceCents === 30000, `สัญญาเก่าเปลี่ยนตาม ${reread.services[0].priceCents}`)
})

check('ห้องกลายเป็นไม่ว่างทันที', () => {
  const room = rooms.listFloors(db, apartmentId)[0].rooms.find((r) => r.roomId === room1.roomId)
  assert(room.status === 'occupied', `สถานะห้อง ${room.status}`)
})

check('กฎคืนเงินประกันถูกถ่ายสำเนาลงสัญญา', () => {
  assert(created.depositNoticeDays === 15, `ได้ ${created.depositNoticeDays}`)
})

check('ทำสัญญาซ้อนในห้องเดิมไม่ได้ และต้องบอกเลขห้อง', () => {
  throws(
    () => contracts.createContract(db, { ...BASE, roomId: room1.roomId, tenants: [somying.tenantId] }),
    room1.roomNumber,
    'ควรกันสัญญาซ้อนและบอกว่าห้องไหน'
  )
})

check('ห้องที่ไม่มีค่าบริการผูกไว้ ทำสัญญาได้ตามปกติ', () => {
  const other = contracts.createContract(db, {
    ...BASE,
    roomId: room2.roomId,
    tenants: [somying.tenantId]
  })
  assert(other.services.length === 0, `ไม่ควรมีค่าบริการ ได้ ${other.services.length}`)
})

check('สัญญาที่ยังใช้งานอยู่ของห้อง หาเจอ', () => {
  const active = contracts.getActiveContractByRoom(db, room1.roomId)
  assert(active.contractId === created.contractId, 'ควรได้สัญญาที่เพิ่งสร้าง')
})

check('ผู้เช่าที่มีสัญญาแล้ว ลบไม่ได้', () => {
  throws(
    () => tenants.deleteTenant(db, somchai.tenantId),
    'มีประวัติสัญญาเช่า',
    'ควรกันการลบผู้เช่าที่มีสัญญา'
  )
})

check('จำนวนสัญญาที่ยังใช้งานอยู่ของผู้เช่าถูกนับถูก', () => {
  const t = tenants.getTenantById(db, somying.tenantId)
  // ห้อง 101 (ผู้เช่าร่วม) + 102 + 104 (เทสต์เลขที่ใบจองแบบกรอกเอง)
  assert(t.activeContracts === 3, `สมหญิงอยู่ 3 สัญญา ได้ ${t.activeContracts}`)
})

// -----------------------------------------------------
group('สำเนากติกาเงินประกันลงสัญญา')

// 🔴 บั๊กที่เจอตอนทำหน้าตั้งค่านโยบาย (2026-08-14): INSERT ของ createContract ไม่ได้ใส่
// `deposit_refund_policy` เลย สัญญาทุกใบจึงได้ 'on_full_term' จาก DEFAULT ของตาราง
// ต่อให้หอตั้งไว้เป็นอย่างอื่น — เงียบสนิทเพราะค่า DEFAULT บังเอิญตรงกับกติกาจริงของหอนี้
check('สัญญาใหม่ได้กติกาปัจจุบันของหอครบทั้งสามค่า', () => {
  const home = apartments.insertApartment(db, {
    nameTh: 'หอทดสอบสำเนากติกา',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  apartments.saveDepositPolicy(db, home.apartmentId, {
    policy: 'never',
    noticeDays: 45,
    minStayMonths: 9
  })

  rooms.generateFloorPlan(db, home.apartmentId, [{ roomCount: 1 }])
  const room = rooms.listFloors(db, home.apartmentId)[0].rooms[0]
  rooms.setRoomRates(db, [room.roomId], { monthlyRent: '4000' })

  const person = tenants.insertTenant(db, {
    firstName: 'ผู้เช่ากติกา',
    lastName: 'ทดสอบ',
    phone: '0899998888'
  })
  const contract = contracts.createContract(db, {
    ...BASE,
    roomId: room.roomId,
    rentAmount: '4000',
    deposit: '4000',
    termMonths: 12,
    tenants: [person.tenantId]
  })

  const row = db
    .prepare(
      `SELECT deposit_refund_policy, deposit_notice_days, deposit_min_stay_months
         FROM contracts WHERE contract_id = ?`
    )
    .get(contract.contractId)
  assert(row.deposit_refund_policy === 'never', `ได้ ${row.deposit_refund_policy}`)
  assert(row.deposit_notice_days === 45, `ได้ ${row.deposit_notice_days}`)
  assert(row.deposit_min_stay_months === 9, `ได้ ${row.deposit_min_stay_months}`)
})

// **หัวใจของการ snapshot**: ผู้เช่าที่เซ็นตอนกติกาเป็นอย่างหนึ่ง ต้องไม่โดนกติกาใหม่ย้อนหลัง
check('เปลี่ยนกติกาของหอทีหลัง สัญญาที่ทำไปแล้วต้องไม่เปลี่ยนตาม', () => {
  const home = apartments.insertApartment(db, {
    nameTh: 'หอทดสอบไม่ย้อนหลัง',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  rooms.generateFloorPlan(db, home.apartmentId, [{ roomCount: 1 }])
  const room = rooms.listFloors(db, home.apartmentId)[0].rooms[0]
  rooms.setRoomRates(db, [room.roomId], { monthlyRent: '4000' })

  const person = tenants.insertTenant(db, {
    firstName: 'ผู้เช่าเซ็นก่อน',
    lastName: 'ทดสอบ',
    phone: '0899997777'
  })
  const contract = contracts.createContract(db, {
    ...BASE,
    roomId: room.roomId,
    rentAmount: '4000',
    deposit: '4000',
    termMonths: 12,
    tenants: [person.tenantId]
  })

  apartments.saveDepositPolicy(db, home.apartmentId, {
    policy: 'never',
    noticeDays: 60,
    minStayMonths: 24
  })

  const row = db
    .prepare(
      `SELECT deposit_refund_policy, deposit_notice_days FROM contracts WHERE contract_id = ?`
    )
    .get(contract.contractId)
  assert(row.deposit_refund_policy === 'on_full_term', `กติกาเก่าถูกเขียนทับเป็น ${row.deposit_refund_policy}`)
  assert(row.deposit_notice_days === 15, `จำนวนวันถูกเขียนทับเป็น ${row.deposit_notice_days}`)
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลสัญญาเช่าทำงานครบทุกเส้นทาง')
