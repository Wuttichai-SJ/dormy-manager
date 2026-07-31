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
rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 2 }])
const floor = rooms.listFloors(db, apartmentId)[0]
const [room1, room2] = floor.rooms
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

const BASE = {
  rentType: 'monthly',
  startDate: '2026-07-18',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 3124,
  electricMeterStart: 4476
}

// -----------------------------------------------------
group('ค่าเช่าล่วงหน้าตามสัดส่วนวัน')

// ตัวเลขชุดนี้ถอดจากหน้าจอจริงของต้นแบบ: ค่าเช่า 5,000 เข้าพัก 18 ก.ค. → 2,258.06
check('เข้าพักกลางเดือน คิดเฉพาะวันที่เหลือ', () => {
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-18')
  assert(got === 225806, `ควรได้ 225806 สตางค์ ได้ ${got}`)
})

check('เข้าพักวันที่ 1 คิดเต็มเดือน', () => {
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-01')
  assert(got === 500000, `ควรได้เต็มเดือน ได้ ${got}`)
})

check('เข้าพักวันสุดท้ายของเดือน คิดวันเดียว', () => {
  const got = contracts.calculateAdvanceRentCents(500000, '2026-07-31')
  assert(got === Math.round(500000 / 31), `ได้ ${got}`)
})

check('เดือนกุมภาพันธ์ปีอธิกสุรทินนับ 29 วัน', () => {
  // 2028 เป็นปีอธิกสุรทิน — เข้าพัก 1 ก.พ. ต้องได้เต็มเดือน ไม่ใช่ 28/29 ของเดือน
  const got = contracts.calculateAdvanceRentCents(290000, '2028-02-01')
  assert(got === 290000, `ได้ ${got}`)
  // เข้าวันที่ 29 = เหลือวันเดียว
  const lastDay = contracts.calculateAdvanceRentCents(290000, '2028-02-29')
  assert(lastDay === Math.round(290000 / 29), `ได้ ${lastDay}`)
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
  assert(created.advancePaymentAmountCents === 225806, `ล่วงหน้า ${created.advancePaymentAmountCents}`)
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
  assert(t.activeContracts === 2, `สมหญิงอยู่ 2 สัญญา ได้ ${t.activeContracts}`)
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลสัญญาเช่าทำงานครบทุกเส้นทาง')
