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

const BASE = {
  rentType: 'monthly',
  checkInDate: '2026-09-01',
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
group('แปลงเป็นสัญญา')

const somchai = tenants.insertTenant(db, {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0812345678'
})

const contract = bookings.convertBookingToContract(db, booking.bookingId, {
  startDate: '2026-09-01',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  waterMeterStart: 100,
  electricMeterStart: 200,
  tenants: [somchai.tenantId]
})

// จุดสำคัญ: เงินจองที่รับไว้แล้วต้องไหลเข้าสัญญา ไม่ใช่หายไป
check('เงินจองถูกยกไปเป็นเงินจองของสัญญา', () => {
  assert(contract.bookingFeeCents === 100000, `ได้ ${contract.bookingFeeCents}`)
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
