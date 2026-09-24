// ทดสอบโมดูลการจองบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:bookings
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
const tenants = await import('../src/main/db/tenants.js')
const bookings = await import('../src/main/db/bookings.js')

const { db, cleanup } = await openTempDatabase('dormy-bookings')

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบการจอง',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId
rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 3 }])
const [room1, room2, room3] = rooms.listFloors(db, apartmentId)[0].rooms

// วันเข้าอยู่ = วันที่ 1 ของเดือนหน้าเสมอ ห้ามตรึงเป็นวันตายตัว เพราะวันจองคือ "วันนี้" เสมอ
// (ใช้เวลา UTC แบบเดียวกับ bookings.js) ถ้าตรึงไว้ พอเลยวันนั้นไปวันจองจะมาทีหลังวันเข้าอยู่
// ลำดับใบเสร็จจะสลับ — เทสต์นี้เคยตกทุกวันตั้งแต่ 2026-09-01 ด้วยเหตุนี้
// วันที่ 1 ยังคงอยู่ในช่วง "เข้าวันที่ 1-3 คิดเต็มเดือน" ยอดเงินในเทสต์จึงไม่เปลี่ยน
const nowUtc = new Date()
const MOVE_IN_DATE = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() + 1, 1))
  .toISOString()
  .slice(0, 10)

const BASE = {
  rentType: 'monthly',
  checkInDate: MOVE_IN_DATE,
  rentPrice: '5000',
  bookingFee: '1000',
  paymentMethod: 'cash',
  customerName: 'สมชาย ใจดี',
  customerPhone: '081-234-5678'
}

// -----------------------------------------------------
group('ตรวจข้อมูล')

check('ชื่อและเบอร์ผู้จองบังคับกรอก', () => {
  const errors = bookings.validateBookingInput({ ...BASE, customerName: ' ', customerPhone: '' })
  assert(errors.some((e) => e.includes('ชื่อผู้จอง')), errors.join(', '))
  assert(errors.some((e) => e.includes('เบอร์โทรศัพท์ผู้จอง')), errors.join(', '))
})

check('วันที่ออกก่อนวันที่เข้าพักไม่ได้', () => {
  const errors = bookings.validateBookingInput({ ...BASE, checkOutDate: '2026-08-01' })
  assert(errors.some((e) => e.includes('ไม่ก่อนวันที่เข้าพัก')), errors.join(', '))
})

check('วิธีชำระเงินจองต้องเป็นค่าที่รู้จัก', () => {
  const errors = bookings.validateBookingInput({ ...BASE, paymentMethod: 'promise' })
  assert(errors.some((e) => e.includes('วิธีชำระเงินจอง')), errors.join(', '))
})

// -----------------------------------------------------
group('สร้างการจอง')

const booking = bookings.createBooking(db, { ...BASE, roomId: room1.roomId })

check('ระบบออกเลขที่ใบจองให้เอง รูปแบบ B + YYYYMM + ลำดับ 4 หลัก', () => {
  const period = new Date().toISOString().slice(0, 7).replace('-', '')
  assert(booking.bookingNumber === `B${period}0001`, `ได้ ${booking.bookingNumber}`)
})

check('ใบจองใบถัดไปได้เลขถัดไป ไม่ซ้ำกัน', () => {
  const second = bookings.createBooking(db, { ...BASE, roomId: room2.roomId })
  const period = new Date().toISOString().slice(0, 7).replace('-', '')
  assert(second.bookingNumber === `B${period}0002`, `ได้ ${second.bookingNumber}`)
  bookings.deleteBooking(db, second.bookingId)
})

check('เก็บเงินเป็นสตางค์ เบอร์เป็นตัวเลขล้วน และเริ่มที่สถานะรอยืนยัน', () => {
  assert(booking.bookingFeeCents === 100000, `เงินจอง ${booking.bookingFeeCents}`)
  assert(booking.rentPriceCents === 500000, `ราคาห้อง ${booking.rentPriceCents}`)
  assert(booking.customerPhone === '0812345678', `เบอร์ ${booking.customerPhone}`)
  assert(booking.status === 'pending', `สถานะ ${booking.status}`)
  assert(booking.isOpen === true, 'การจองใหม่ต้องยังกันห้องอยู่')
})

check('วันที่จองเป็นวันนี้ ไม่ให้กรอกย้อนหลัง', () => {
  const todayIso = new Date().toISOString().slice(0, 10)
  assert(booking.bookingDate === todayIso, `ได้ ${booking.bookingDate}`)
})

check('จองซ้อนห้องเดิมไม่ได้ และต้องบอกว่าใครจองอยู่', () => {
  throws(
    () => bookings.createBooking(db, { ...BASE, roomId: room1.roomId, customerName: 'สมหญิง' }),
    'สมชาย ใจดี',
    'ควรบอกชื่อคนที่จองค้างอยู่'
  )
})

check('ยกเลิกแล้วจองห้องเดิมใหม่ได้', () => {
  const other = bookings.createBooking(db, { ...BASE, roomId: room2.roomId })
  bookings.setBookingStatus(db, other.bookingId, 'cancelled')
  const again = bookings.createBooking(db, { ...BASE, roomId: room2.roomId, customerName: 'คนใหม่' })
  assert(again.status === 'pending', `สถานะ ${again.status}`)
})

check('นับการจองที่ยังค้างอยู่ทั้งหอได้', () => {
  // ห้อง 1 (pending) + ห้อง 2 (จองใหม่หลังยกเลิก) = 2 รายการที่ยังค้าง
  assert(bookings.countOpenBookings(db, apartmentId) === 2, `ได้ ${bookings.countOpenBookings(db, apartmentId)}`)
})

// -----------------------------------------------------
group('ยืนยัน / ยกเลิก')

check('ยืนยันการจองได้', () => {
  const confirmed = bookings.setBookingStatus(db, booking.bookingId, 'confirmed')
  assert(confirmed.status === 'confirmed', confirmed.status)
  assert(confirmed.isOpen === true, 'ยืนยันแล้วยังกันห้องอยู่')
})

check('ตั้งสถานะเป็นทำสัญญาแล้วโดยตรงไม่ได้', () => {
  throws(
    () => bookings.setBookingStatus(db, booking.bookingId, 'converted_to_contract'),
    'ไม่ถูกต้อง',
    'ต้องแปลงผ่าน convertBookingToContract เท่านั้น'
  )
})

// -----------------------------------------------------
// ผู้ใช้รายงาน 2026-08-10 (หอพักวาสนา): จองห้องแล้วยืนยันเรียบร้อย แต่หน้าห้องยังขึ้นว่า
// "ว่าง" และการ์ด "จองล่วงหน้า" ไม่มีตัวเลข — เพราะการจองไม่เคยถูกส่งไปถึงรายการห้องเลย
//
// **การจองไม่ได้เก็บเป็น rooms.status โดยตั้งใจ** ห้องที่จองไว้ยังว่างจริงๆ (ยังไม่มีใครอยู่)
// รายการห้องจึงต้องแนบใบจองที่ยังกันห้องอยู่มาให้ แล้วหน้าจอขึ้นป้ายเอง
group('การจองที่ส่งไปถึงรายการห้อง')

const contractsDb = await import('../src/main/db/contracts.js')

check('ห้องที่มีการจองค้างอยู่ แนบข้อมูลใบจองมากับรายการห้อง', () => {
  const listed = contractsDb
    .listRoomsForApartment(db, apartmentId)
    .find((r) => r.roomId === room1.roomId)

  assert(listed.booking !== null, 'ห้องที่จองไว้ต้องมีข้อมูลใบจองติดมา')
  assert(listed.booking.customerName === booking.customerName, `ได้ ${listed.booking.customerName}`)
  assert(listed.booking.checkInDate === booking.checkInDate, `ได้ ${listed.booking.checkInDate}`)
  // สถานะห้องยังเป็น vacant — ป้าย "จองแล้ว" เป็นเรื่องของหน้าจอ ไม่ใช่ค่าที่เก็บไว้
  assert(listed.status === 'vacant', `สถานะห้องได้ ${listed.status}`)
})

// ห้อง 3 เป็นห้องเดียวที่ไม่เคยถูกจองเลยตลอดไฟล์นี้ (ห้อง 2 มีใบจองค้างอยู่จากข้อ
// "ยกเลิกแล้วจองห้องเดิมใหม่ได้")
check('ห้องที่ไม่มีการจอง ไม่มีข้อมูลใบจองติดมา', () => {
  const listed = contractsDb.listRoomsForApartment(db, apartmentId)
  const untouched = listed.find((r) => r.roomId === room3.roomId)
  assert(untouched.booking === null, 'ห้องที่ไม่ได้จองต้องไม่มีใบจองติดมา')

  // และการนับต้องตรงกับจำนวนใบจองที่ยังกันห้องอยู่จริง ไม่ใช่นับจากสถานะห้อง
  const booked = listed.filter((r) => r.booking !== null).length
  assert(booked === bookings.countOpenBookings(db, apartmentId), `นับได้ ${booked}`)
})

// หอร้อยห้อง คนจองจำเลขห้องตัวเองไม่ได้ — ชื่อคือทางเดียวที่หาห้องเจอ (ผู้ใช้สั่ง 2026-08-10)
//
// คนจองยังไม่ใช่ผู้เช่า (ระเบียนผู้เช่าเพิ่งถูกสร้างตอนทำสัญญา) ถ้าค้นแต่ผู้เช่า
// คนที่จองแล้วยังไม่ย้ายเข้าจะหาไม่เจอเลย ซึ่งเป็นช่วงเดียวที่จำเป็นต้องหาจริงๆ
check('ค้นหาด้วยชื่อผู้จอง เจอห้องที่เขาจองไว้', () => {
  const byName = contractsDb.listRoomsForApartment(db, apartmentId, { tenant: 'สมชาย' })
  assert(
    byName.some((r) => r.roomId === room1.roomId),
    'ค้นชื่อผู้จองแล้วต้องเจอห้องที่จองไว้'
  )
})

check('ค้นหาด้วยเบอร์ผู้จองก็เจอ และรับเบอร์ที่มีขีดคั่นได้', () => {
  for (const keyword of ['0812345678', '081-234-5678']) {
    const found = contractsDb.listRoomsForApartment(db, apartmentId, { tenant: keyword })
    assert(
      found.some((r) => r.roomId === room1.roomId),
      `ค้นด้วย ${keyword} แล้วไม่เจอ`
    )
  }
})

check('ชื่อที่ไม่มีใครตรง ต้องไม่คืนห้องมั่วๆ', () => {
  const none = contractsDb.listRoomsForApartment(db, apartmentId, { tenant: 'ไม่มีคนชื่อนี้' })
  assert(none.length === 0, `ได้ ${none.length} ห้อง`)
})

// ใบจองที่ยกเลิกไปแล้วต้องไม่ค้างอยู่บนหน้าจอ — นี่คือข้อที่การเก็บเป็น rooms.status จะพลาด
check('ยกเลิกใบจองแล้ว ห้องกลับมาว่างทันที', () => {
  const spare = bookings.createBooking(db, { ...BASE, roomId: room3.roomId })
  assert(
    contractsDb.listRoomsForApartment(db, apartmentId).find((r) => r.roomId === room3.roomId)
      .booking !== null,
    'จองแล้วต้องเห็นใบจอง'
  )

  bookings.setBookingStatus(db, spare.bookingId, 'cancelled')
  assert(
    contractsDb.listRoomsForApartment(db, apartmentId).find((r) => r.roomId === room3.roomId)
      .booking === null,
    'ยกเลิกแล้วต้องไม่เหลือใบจองค้างบนห้อง'
  )
})

// -----------------------------------------------------
group('แปลงเป็นสัญญา')

const somchai = tenants.insertTenant(db, {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0812345678'
})

// เงินจองที่รับไว้แล้วจะถูกออกเป็นใบเสร็จเงินประกันตอนแปลงเป็นสัญญา จึงต้องมีผู้รับเงิน
const staff = (await import('../src/main/db/users.js')).insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  email: 'manager-bookings@example.com',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const contract = bookings.convertBookingToContract(db, booking.bookingId, {
  startDate: MOVE_IN_DATE,
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  waterMeterStart: 100,
  electricMeterStart: 200,
  tenants: [somchai.tenantId],
  createdBy: staff.user_id
})

// จุดสำคัญ: เงินจองที่รับไว้แล้วต้องไหลเข้าสัญญา ไม่ใช่หายไป
check('เงินจองถูกยกไปเป็นเงินจองของสัญญา', () => {
  assert(contract.bookingFeeCents === 100000, `ได้ ${contract.bookingFeeCents}`)
})

// เงินจองคือเงินประกันส่วนแรก — ต้องนับเป็น "รับแล้ว" ไม่ใช่ให้เจ้าของหอไปเก็บซ้ำ
// และใบเสร็จต้องลงวันที่ที่รับเงินจริง (วันจอง) ไม่ใช่วันทำสัญญาซึ่งอาจห่างกันหลายเดือน
check('เงินจองและส่วนที่เหลือถูกออกเป็นใบเสร็จคนละใบ คนละวันที่', () => {
  // เงินจอง 1,000 + ส่วนที่เหลือ 4,000 ที่เก็บวันเซ็นสัญญา = ครบ 5,000 ไม่มียอดค้าง
  const status = contract.deposit
  assert(status.requiredCents === 500000, `ตกลงไว้ ${status.requiredCents}`)
  assert(status.receivedCents === 500000, `รับแล้ว ${status.receivedCents}`)
  assert(status.outstandingCents === 0, `ค้าง ${status.outstandingCents}`)

  const rows = db
    .prepare(
      `SELECT payment_date, amount_cents, purpose FROM payments
        WHERE contract_id = ? AND purpose = 'deposit' ORDER BY payment_date`
    )
    .all(contract.contractId)
  assert(rows.length === 2, `ควรมีใบเสร็จเงินประกัน 2 ใบ ได้ ${rows.length}`)

  // เงินจองลงวันที่ที่รับเงินจริง (วันจอง) ส่วนที่เหลือลงวันเซ็นสัญญา — สองวันนี้ห่างกันได้
  // หลายเดือน ถ้ายุบเป็นวันเดียวรายรับของเดือนที่รับเงินจองจะหายไป
  assert(rows[0].payment_date === booking.bookingDate, `ใบแรกลงวันที่ ${rows[0].payment_date}`)
  assert(rows[0].amount_cents === 100000, `ใบแรก ${rows[0].amount_cents}`)
  assert(rows[1].payment_date === MOVE_IN_DATE, `ใบที่สองลงวันที่ ${rows[1].payment_date}`)
  assert(rows[1].amount_cents === 400000, `ใบที่สอง ${rows[1].amount_cents}`)
})

// เลขที่ต้องเป็นใบเดียวกัน ไม่ใช่ออกเลขใหม่ — ผู้เช่าถือใบจองที่มีเลขนี้อยู่ในมือ
check('สัญญาอ้างเลขที่ใบจองใบเดิม ไม่ออกเลขใหม่', () => {
  assert(
    contract.bookingReceiptNo === booking.bookingNumber,
    `สัญญาได้ ${contract.bookingReceiptNo} แต่ใบจองคือ ${booking.bookingNumber}`
  )
})

check('การจองเปลี่ยนสถานะเป็นทำสัญญาแล้ว และไม่กันห้องอีก', () => {
  const after = bookings.getBookingById(db, booking.bookingId)
  assert(after.status === 'converted_to_contract', after.status)
  assert(after.isOpen === false, 'ไม่ควรกันห้องแล้ว')
})

// ผู้ใช้รายงาน 2026-08-10 (หอพักวาสนา ห้อง 101): วุฒิชัยทำสัญญาเข้าอยู่แล้ว
// แต่ยังค้างอยู่ใน "รายชื่อคนจองรอเข้าพัก"
//
// การ์ดนั้นแยกด้วย isOpen — คนที่เข้าอยู่แล้วต้องหลุดออกจากรายชื่อคนรอ
// **แต่ใบจองต้องยังอยู่ในระบบ** เพราะสัญญาเก็บเลขที่ใบจองไว้ และใบเสร็จเงินประกัน
// เขียนว่า "เงินจองตามใบจอง B..." ถ้าใบหายจะตามที่มาของเงินก้อนนั้นไม่ได้
check('ใบจองที่ทำสัญญาแล้วหลุดจากรายชื่อคนรอ แต่ยังอยู่ในประวัติ', () => {
  const all = bookings.listBookingsByRoom(db, room1.roomId)
  const converted = all.find((b) => b.bookingId === booking.bookingId)

  assert(converted !== undefined, 'ใบจองต้องยังอยู่ในประวัติ ไม่ใช่ถูกลบทิ้ง')
  assert(converted.isOpen === false, 'ต้องไม่นับเป็นคนรอเข้าพักอีก')
  assert(
    all.filter((b) => b.isOpen).length === 0,
    'ห้องนี้ไม่ควรเหลือคนรอเข้าพักแล้ว'
  )
  // เลขที่ใบจองยังโยงกับสัญญาอยู่ — เป็นเหตุผลที่ห้ามลบใบทิ้ง
  assert(
    contract.bookingReceiptNo === converted.bookingNumber,
    `สัญญาอ้าง ${contract.bookingReceiptNo} แต่ใบจองคือ ${converted.bookingNumber}`
  )
})

check('ห้องกลายเป็นไม่ว่างตามสัญญาที่เพิ่งสร้าง', () => {
  const room = rooms.listFloors(db, apartmentId)[0].rooms.find((r) => r.roomId === room1.roomId)
  assert(room.status === 'occupied', `สถานะห้อง ${room.status}`)
})

check('แปลงซ้ำไม่ได้', () => {
  throws(
    () => bookings.convertBookingToContract(db, booking.bookingId, {}),
    'ถูกแปลงเป็นสัญญา',
    'ควรกันการแปลงซ้ำ'
  )
})

check('การจองที่ยกเลิกแล้วแปลงเป็นสัญญาไม่ได้', () => {
  const doomed = bookings.createBooking(db, { ...BASE, roomId: room3.roomId })
  bookings.setBookingStatus(db, doomed.bookingId, 'cancelled')
  throws(
    () => bookings.convertBookingToContract(db, doomed.bookingId, {}),
    'ถูกยกเลิก',
    'ควรกันการแปลงใบที่ยกเลิกแล้ว'
  )
})

check('ลบการจองที่แปลงเป็นสัญญาแล้วไม่ได้', () => {
  throws(
    () => bookings.deleteBooking(db, booking.bookingId),
    'แปลงเป็นสัญญา',
    'ควรกันการลบใบที่ใช้ทำสัญญาไปแล้ว'
  )
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลการจองทำงานครบทุกเส้นทาง')
