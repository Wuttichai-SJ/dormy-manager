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
const payments = await import('../src/main/db/payments.js')
const terminations = await import('../src/main/db/terminations.js')

const { db, cleanup } = await openTempDatabase('dormy-contracts')

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

group('ค่าเช่าล่วงหน้าตามสัดส่วนวัน')

check('เข้าพักกลางเดือน คิดเฉพาะวันที่เหลือ', () => {
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-18')
  assert(got === 233300, `ควรได้ 233300 สตางค์ ได้ ${got}`)
})

check('เข้าพักวันที่ 1-3 คิดเต็มเดือน ไม่ปัดลดให้', () => {
  for (const day of ['01', '02', '03']) {
    const got = contracts.calculateAdvanceRentCents(500000, `2026-07-${day}`)
    assert(got === 500000, `วันที่ ${day} ควรได้เต็มเดือน ได้ ${got}`)
  }
})

check('เข้าพักวันที่ 4 เริ่มคิดตามวัน', () => {
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-04')
  assert(got === 466700, `ได้ ${got}`)
  assert(got < 500000, 'ต้องไม่เกินค่าเช่าเต็มเดือน')
})

check('หารด้วย 30 เสมอ เดือน 31 วันกับ 28 วันจึงได้ต่อวันเท่ากัน', () => {
  const perDay = 16700

  assert(contracts.calculateAdvanceRentCents(500000, '2026-07-31') === perDay, 'ก.ค. วันสุดท้าย')
  assert(contracts.calculateAdvanceRentCents(500000, '2026-02-28') === perDay, 'ก.พ. วันสุดท้าย')
})

check('ปีอธิกสุรทินนับวันที่อยู่จริงถูก แต่ยังหารด้วย 30', () => {
  const got = contracts.calculateAdvanceRentCents(300000, '2028-02-20')
  assert(got === Math.round((300000 * 10) / 30), `ได้ ${got}`)

  assert(contracts.calculateAdvanceRentCents(290000, '2028-02-01') === 290000, 'วันที่ 1 เต็มเดือน')
})

check('ค่าเช่าล่วงหน้าปัดเป็นบาทเต็ม: 0.50 ขึ้นไปปัดขึ้น ต่ำกว่าปัดลง', () => {
  assert(contracts.calculateAdvanceRentCents(451500, '2026-09-30') === 15100, 'เศษ .50 ต้องปัดขึ้น')
  assert(contracts.calculateAdvanceRentCents(499170, '2026-09-30') === 16600, 'เศษ .39 ต้องปัดลง')
  assert(contracts.calculateAdvanceRentCents(500000, '2026-06-29') === 33300, '333.33 → 333')
  for (let day = 4; day <= 31; day++) {
    const got = contracts.calculateAdvanceRentCents(498750, `2026-07-${String(day).padStart(2, '0')}`)
    assert(got % 100 === 0, `เข้าวันที่ ${day} ยังมีเศษสตางค์: ${got}`)
  }
})

check('เข้าวันที่ 1-3 ไม่ปัด — เก็บตามราคาห้องที่ตั้งไว้แม้มีเศษสตางค์', () => {
  assert(contracts.calculateAdvanceRentCents(499950, '2026-07-02') === 499950, 'ราคาห้อง 4,999.50 ต้องคงเดิม')
})

group('ตรวจข้อมูล')

check('ต้องมีผู้เช่าอย่างน้อยหนึ่งคน', () => {
  const errors = contracts.validateContractInput({ ...BASE, tenants: [] })
  assert(errors.some((e) => e.includes('ผู้เช่าอย่างน้อย')), errors.join(', '))
})

check('ไม่รับสัญญารายวัน', () => {
  const errors = contracts.validateContractInput({
    ...BASE,
    rentType: 'daily',
    tenants: [somchai.tenantId]
  })
  assert(errors.some((e) => e.includes('เฉพาะสัญญารายเดือน')), errors.join(', '))
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

group('สร้างสัญญา')

const created = contracts.createContract(db, {
  ...BASE,
  roomId: room1.roomId,
  tenants: [somchai.tenantId, somying.tenantId]
})

check('เก็บเงินเป็นสตางค์ และคิดค่าเช่าล่วงหน้าให้เอง', () => {
  assert(created.rentAmountCents === 500000, `ค่าเช่า ${created.rentAmountCents}`)
  assert(created.depositAmountCents === 500000, `เงินประกัน ${created.depositAmountCents}`)
  assert(created.advancePaymentAmountCents === 233300, `ล่วงหน้า ${created.advancePaymentAmountCents}`)
})

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

check('ค่าบริการของห้องถูกถ่ายสำเนาลงสัญญา', () => {
  assert(created.services.length === 1, `ได้ ${created.services.length} รายการ`)
  assert(created.services[0].priceCents === 30000, `ราคา ${created.services[0].priceCents}`)
})

check('ขึ้นราคาค่าบริการทีหลัง ไม่กระทบสัญญาที่เซ็นไปแล้ว', () => {
  services.updateService(db, internet.serviceId, { name: 'ค่าอินเทอร์เน็ต', price: '500' })
  const reread = contracts.getContractById(db, created.contractId)
  assert(reread.services[0].priceCents === 30000, `สัญญาเก่าเปลี่ยนตาม ${reread.services[0].priceCents}`)
})

check('นำค่าบริการออกจากห้อง สัญญาที่ใช้งานอยู่ไม่ถูกเก็บด้วย · ผูกกลับได้ราคาปัจจุบัน', () => {
  rooms.detachServicesFromRooms(db, [room1.roomId], [internet.serviceId])
  const removed = contracts.getContractById(db, created.contractId)
  assert(removed.services.length === 0, `ยังเหลือ ${removed.services.length} รายการ`)

  rooms.attachServicesToRooms(db, [room1.roomId], [internet.serviceId])
  const back = contracts.getContractById(db, created.contractId)
  assert(back.services.length === 1, `ได้ ${back.services.length} รายการ`)
  assert(back.services[0].priceCents === 50000, `ราคา ${back.services[0].priceCents}`)
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
  assert(t.activeContracts === 3, `สมหญิงอยู่ 3 สัญญา ได้ ${t.activeContracts}`)
})

group('สำเนากติกาเงินประกันลงสัญญา')

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

check('เปลี่ยนกติกาของหอทีหลัง สัญญาที่ใช้งานอยู่เปลี่ยนตาม ยกเว้นห้องที่แจ้งย้ายออกแล้ว', () => {
  const home = apartments.insertApartment(db, {
    nameTh: 'หอทดสอบกติกาย้อนสัญญาเดิม',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  const other = apartments.insertApartment(db, {
    nameTh: 'หออื่นต้องไม่โดนด้วย',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  rooms.generateFloorPlan(db, home.apartmentId, [{ roomCount: 2 }])
  rooms.generateFloorPlan(db, other.apartmentId, [{ roomCount: 1 }])
  const [stayRoom, leavingRoom] = rooms.listFloors(db, home.apartmentId)[0].rooms
  const otherRoom = rooms.listFloors(db, other.apartmentId)[0].rooms[0]
  rooms.setRoomRates(db, [stayRoom.roomId, leavingRoom.roomId], { monthlyRent: '4000' })
  rooms.setRoomRates(db, [otherRoom.roomId], { monthlyRent: '4000' })

  const sign = (room, phone) =>
    contracts.createContract(db, {
      ...BASE,
      roomId: room.roomId,
      rentAmount: '4000',
      deposit: '4000',
      termMonths: 12,
      tenants: [
        tenants.insertTenant(db, { firstName: `ผู้เช่า${phone}`, lastName: 'ทดสอบ', phone }).tenantId
      ]
    })
  const staying = sign(stayRoom, '0899997771')
  const leaving = sign(leavingRoom, '0899997772')
  const elsewhere = sign(otherRoom, '0899997773')
  terminations.setMoveOutNotice(db, leaving.contractId, '2026-08-01')

  const saved = apartments.saveDepositPolicy(db, home.apartmentId, {
    policy: 'on_full_term',
    noticeDays: 30,
    minStayMonths: 6
  })
  assert(saved.appliedContractCount === 1, `อัปเดต ${saved.appliedContractCount} ใบ ควรเป็น 1`)
  assert(saved.noticeGivenContractCount === 1, `แจ้งย้ายออกแล้ว ${saved.noticeGivenContractCount} ใบ`)

  const read = (id) =>
    db
      .prepare('SELECT deposit_notice_days AS days, deposit_min_stay_months AS minStay FROM contracts WHERE contract_id = ?')
      .get(id)
  assert(read(staying.contractId).days === 30, `สัญญาที่อยู่ต่อได้ ${read(staying.contractId).days}`)
  assert(read(staying.contractId).minStay === 6, `เดือนขั้นต่ำได้ ${read(staying.contractId).minStay}`)
  assert(read(leaving.contractId).days === 15, `ห้องที่แจ้งย้ายออกแล้วถูกเปลี่ยนเป็น ${read(leaving.contractId).days}`)
  assert(read(elsewhere.contractId).days === 15, `หออื่นถูกเปลี่ยนเป็น ${read(elsewhere.contractId).days}`)

  // ยกเลิกการแจ้ง = กลับมาใช้กติกาปัจจุบันของหอ
  terminations.setMoveOutNotice(db, leaving.contractId, null)
  assert(read(leaving.contractId).days === 30, `ยกเลิกแจ้งแล้วได้ ${read(leaving.contractId).days}`)
  assert(read(leaving.contractId).minStay === 6, `ยกเลิกแจ้งแล้วเดือนขั้นต่ำได้ ${read(leaving.contractId).minStay}`)
})

group('ผู้เช่าเดิมจากระบบเก่า')

check('ผู้เช่าเดิมใส่วันเข้าพักในอนาคตไม่ได้ แต่ย้อนหลังได้', () => {
  const future = contracts.validateContractInput({
    ...BASE,
    carriedOver: true,
    startDate: '2999-01-01',
    tenants: [somchai.tenantId]
  })
  assert(future.some((e) => e.includes('ไม่เกินวันนี้')), future.join(', '))

  const past = contracts.validateContractInput({
    ...BASE,
    carriedOver: true,
    startDate: '2024-10-15',
    tenants: [somchai.tenantId]
  })
  assert(past.length === 0, past.join(', '))
})

check('ผู้เช่าเดิม: ไม่เก็บค่าเช่าเดือนแรก ไม่มีเงินจอง เงินประกันยกยอดลงวันเข้าพักเดิม', () => {
  rooms.addRoom(db, floor.floorId, { roomNumber: '980' })
  const room = rooms.listFloors(db, apartmentId)[0].rooms.find((r) => r.roomNumber === '980')
  const person = tenants.insertTenant(db, { firstName: 'ผู้เช่า', lastName: 'อยู่มานาน', phone: '0877776666' })

  const contract = contracts.createContract(db, {
    ...BASE,
    carriedOver: true,
    roomId: room.roomId,
    startDate: '2024-10-15',
    bookingFee: '1000',
    bookingReceiptNo: 'BK-เก่า',
    tenants: [person.tenantId]
  })

  assert(contract.advancePaymentAmountCents === 0, `ค่าเช่าล่วงหน้า ${contract.advancePaymentAmountCents}`)
  assert(contract.bookingReceiptNo === null, `เลขใบจอง ${contract.bookingReceiptNo}`)

  const paid = db
    .prepare('SELECT purpose, amount_cents, payment_date, remark FROM payments WHERE contract_id = ?')
    .all(contract.contractId)
  assert(paid.length === 1, `ควรมีใบเดียว ได้ ${JSON.stringify(paid)}`)
  assert(paid[0].purpose === 'deposit' && paid[0].amount_cents === 500000, JSON.stringify(paid[0]))
  assert(paid[0].payment_date === '2024-10-15', `ลงวันที่ ${paid[0].payment_date}`)
  assert(paid[0].remark.includes('ยกยอดจากระบบเดิม'), paid[0].remark)

  const deposit = payments.getDepositStatus(db, contract.contractId)
  assert(deposit.isSettled && deposit.receivedCents === 500000, JSON.stringify(deposit))
})

check('สัญญาจากใบจองบันทึกเป็นผู้เช่าเดิมไม่ได้', () => {
  throws(
    () =>
      contracts.createContract(db, {
        ...BASE,
        carriedOver: true,
        fromBookingId: 1,
        roomId: room4.roomId,
        tenants: [somying.tenantId]
      }),
    'ผู้เช่าเดิมไม่ได้',
    'ต้องกันสัญญาจากใบจอง'
  )
})

group('ห้องที่ปิดใช้งาน')

check('ห้องที่ปิดใช้งานทำสัญญาไม่ได้ และรายการห้องบอกว่าปิดอยู่', () => {
  rooms.addRoom(db, floor.floorId, { roomNumber: '990' })
  const closed = rooms.listFloors(db, apartmentId)[0].rooms.find((r) => r.roomNumber === '990')
  rooms.updateRoom(db, closed.roomId, { roomNumber: '990', roomTypeName: closed.roomTypeName, isActive: false })

  throws(
    () => contracts.createContract(db, { ...BASE, roomId: closed.roomId, tenants: [somying.tenantId] }),
    'ปิดใช้งาน',
    'ห้องที่ปิดใช้งานต้องทำสัญญาไม่ได้'
  )

  const listed = contracts.listRoomsForApartment(db, apartmentId)
  assert(listed.find((r) => r.roomId === closed.roomId).isActive === false, 'ห้อง 990 ต้องบอกว่าปิดใช้งาน')
  assert(listed.find((r) => r.roomId === room1.roomId).isActive === true, 'ห้องอื่นต้องยังเปิดใช้งาน')
})

group('ห้องที่ปิดปรับปรุง')

const bookings = await import('../src/main/db/bookings.js')

check('ปิดปรับปรุง: จองล่วงหน้าได้ แต่ทำสัญญาไม่ได้ทั้งตรงและจากใบจอง จนกว่าจะเปิดห้อง', () => {
  rooms.addRoom(db, floor.floorId, { roomNumber: '991' })
  const repair = rooms.listFloors(db, apartmentId)[0].rooms.find((r) => r.roomNumber === '991')
  rooms.setRoomStatus(db, [repair.roomId], 'maintenance')

  throws(
    () => contracts.createContract(db, { ...BASE, roomId: repair.roomId, tenants: [somying.tenantId] }),
    'ปิดปรับปรุง',
    'ห้องปิดปรับปรุงต้องทำสัญญาตรงไม่ได้'
  )

  const booking = bookings.createBooking(db, {
    roomId: repair.roomId,
    rentType: 'monthly',
    checkInDate: '2026-12-01',
    rentPrice: '5000',
    bookingFee: '1000',
    paymentMethod: 'cash',
    customerName: 'รอซ่อมเสร็จ',
    customerPhone: '0899999999'
  })
  throws(
    () => bookings.convertBookingToContract(db, booking.bookingId, { ...BASE, tenants: [somying.tenantId] }),
    'ปิดปรับปรุง',
    'ใบจองของห้องปิดปรับปรุงต้องแปลงเป็นสัญญาไม่ได้'
  )
  assert(bookings.getBookingById(db, booking.bookingId).status === 'pending', 'ใบจองต้องยังค้างอยู่')

  rooms.setRoomStatus(db, [repair.roomId], 'vacant')
  const contract = bookings.convertBookingToContract(db, booking.bookingId, {
    ...BASE,
    tenants: [somying.tenantId]
  })
  assert(contract.contractId > 0, 'เปิดห้องแล้วต้องทำสัญญาจากใบจองได้')
})

cleanup()
summarize('โมดูลสัญญาเช่าทำงานครบทุกเส้นทาง')
