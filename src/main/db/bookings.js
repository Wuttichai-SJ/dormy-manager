// ตาราง room_bookings — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// การจองคือ "คนที่ยังไม่ใช่ผู้เช่า" — วางเงินจองไว้แล้วแต่ยังไม่ย้ายเข้า จึงเก็บชื่อกับเบอร์
// เป็นข้อความธรรมดา ไม่ผูกกับตาราง tenants
//
// เหตุผล: ถ้าสร้างระเบียนผู้เช่าตั้งแต่ตอนจอง คนที่จองแล้วไม่มาจะค้างอยู่ในรายชื่อผู้เช่า
// ตลอดไป (หอหนึ่งเจอปีละหลายสิบราย) ระเบียนผู้เช่าจะถูกสร้างตอนแปลงการจองเป็นสัญญาเท่านั้น
//
// โครงตามการ์ด "รายชื่อคนจองรอเข้าพัก" ในหน้ารายละเอียดห้องของต้นแบบ:
// เลขที่/วันที่จอง | ประเภท | ลูกค้า | วันที่เข้าพัก | ราคา | เงินจอง | สถานะ
import { errorList } from '../fieldError.js'
import { toCents } from '../money.js'
import { createContract, RENT_TYPES } from './contracts.js'
import { nextDocumentNumber } from './invoices.js'

export const BOOKING_STATUSES = ['pending', 'confirmed', 'converted_to_contract', 'cancelled']

export const BOOKING_STATUS_LABELS = {
  pending: 'รอยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  converted_to_contract: 'ทำสัญญาแล้ว',
  cancelled: 'ยกเลิก'
}

// การจองที่ยัง "มีชีวิตอยู่" = ยังกันห้องไว้ให้คนนี้ ใช้ทั้งตอนนับสถิติและตอนกันจองซ้อน
const OPEN_STATUSES = ['pending', 'confirmed']

export const PAYMENT_METHODS = ['cash', 'transfer', 'other']

// ------------------------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// ------------------------------------------------------------------
// คืน errorList() — อาร์เรย์ข้อความเดิม + จำว่าข้อความไหนเป็นของช่องไหน (ดู fieldError.js)
export function validateBookingInput(input) {
  const errors = errorList()

  if (!RENT_TYPES.includes(input.rentType)) errors.add('rentType', 'ประเภทการเช่าต้องเป็นรายเดือนหรือรายวัน')
  if (!isDate(input.checkInDate)) errors.add('checkInDate', 'กรุณาระบุวันที่เข้าพัก')
  if (input.checkOutDate && !isDate(input.checkOutDate)) errors.add('checkOutDate', 'วันที่ออกไม่ถูกต้อง')
  if (isDate(input.checkInDate) && isDate(input.checkOutDate) && input.checkOutDate < input.checkInDate) {
    errors.add('checkOutDate', 'วันที่ออกต้องไม่ก่อนวันที่เข้าพัก')
  }

  if (!String(input.customerName ?? '').trim()) errors.add('customerName', 'กรุณากรอกชื่อผู้จอง')

  const phone = String(input.customerPhone ?? '').replace(/\D/g, '')
  if (!phone) errors.add('customerPhone', 'กรุณากรอกเบอร์โทรศัพท์ผู้จอง')
  else if (phone.length < 9 || phone.length > 10) errors.add('customerPhone', 'เบอร์โทรศัพท์ต้องมี 9-10 หลัก')

  if (!PAYMENT_METHODS.includes(input.paymentMethod)) errors.add('paymentMethod', 'กรุณาเลือกวิธีชำระเงินจอง')

  for (const [key, label] of [
    ['rentPrice', 'ราคาห้อง'],
    ['bookingFee', 'เงินจอง']
  ]) {
    try {
      toCents(input[key], label)
    } catch (err) {
      errors.add(key, err.message)
    }
  }

  return errors
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function listBookingsByRoom(db, roomId) {
  return db
    .prepare('SELECT * FROM room_bookings WHERE room_id = ? ORDER BY booking_date DESC, booking_id DESC')
    .all(roomId)
    .map(toPublicBooking)
}

// นับการจองที่ยังค้างอยู่ทั้งหอ — การ์ด "จองล่วงหน้า" ในหน้าห้องพักใช้ตัวเลขนี้
export function countOpenBookings(db, apartmentId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM room_bookings b
         JOIN rooms r ON r.room_id = b.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND b.status IN ('pending', 'confirmed')`
    )
    .get(apartmentId).n
}

export function getBookingById(db, bookingId) {
  const row = db.prepare('SELECT * FROM room_bookings WHERE booking_id = ?').get(bookingId)
  return row ? toPublicBooking(row) : null
}

// ------------------------------------------------------------------
// เขียน
// ------------------------------------------------------------------
export function createBooking(db, input) {
  const roomId = Number(input.roomId)
  // ต้องรู้ว่าห้องนี้อยู่หอไหน เพราะเลขที่ใบจองเดินแยกกันรายหอ
  const room = db
    .prepare(
      `SELECT r.room_id, r.room_number, f.apartment_id
         FROM rooms r
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE r.room_id = ?`
    )
    .get(roomId)
  if (!room) throw new Error('ไม่พบห้องพักที่ต้องการจอง')

  // ห้องหนึ่งมีคนจองค้างอยู่ได้รายเดียว — กันการรับเงินจองซ้อนสองคนสำหรับห้องเดียวกัน
  // ซึ่งจบลงที่ต้องคืนเงินและเสียลูกค้าไปหนึ่งราย
  const open = db
    .prepare(
      `SELECT booking_id, customer_name FROM room_bookings
        WHERE room_id = ? AND status IN ('pending', 'confirmed') LIMIT 1`
    )
    .get(roomId)
  if (open) {
    throw new Error(`ห้อง ${room.room_number} มีการจองค้างอยู่แล้ว (${open.customer_name})`)
  }

  const now = new Date().toISOString()
  // วันที่จอง = วันนี้เสมอ ไม่ให้กรอกย้อนหลัง เพราะเป็นหลักฐานว่ารับเงินจองเมื่อไหร่
  const bookingDate = now.slice(0, 10)

  // ออกเลขที่กับเขียนแถวต้องอยู่ในธุรกรรมเดียวกัน ไม่งั้นตัวนับเดินไปแล้วแต่ใบจองไม่เกิด
  const run = db.transaction(() => {
    const bookingNumber = nextDocumentNumber(db, room.apartment_id, 'booking', bookingDate)
    const result = db
      .prepare(
        // apartment_id ต้องอยู่ในแถวจริง เพราะ unique index ของเลขที่ใบจองเป็นแบบ
        // (apartment_id, booking_number) — เลขเดินแยกรายหอ (ดู migration 021)
        `INSERT INTO room_bookings (
           room_id, apartment_id, booking_number, rent_type, check_in_date, check_out_date,
           booking_date, rent_price_cents, booking_fee_cents, payment_method,
           customer_name, customer_phone, note, status, created_at
         ) VALUES (
           @roomId, @apartmentId, @bookingNumber, @rentType, @checkInDate, @checkOutDate,
           @bookingDate, @rentPriceCents, @bookingFeeCents, @paymentMethod,
           @customerName, @customerPhone, @note, 'pending', @now
         )`
      )
      .run({
        roomId,
        apartmentId: room.apartment_id,
        bookingNumber,
        rentType: input.rentType,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate || null,
        bookingDate,
        rentPriceCents: toCents(input.rentPrice, 'ราคาห้อง'),
        bookingFeeCents: toCents(input.bookingFee, 'เงินจอง'),
        paymentMethod: input.paymentMethod,
        customerName: String(input.customerName).trim(),
        customerPhone: String(input.customerPhone).replace(/\D/g, ''),
        note: String(input.note ?? '').trim() || null,
        now
      })
    return result.lastInsertRowid
  })

  return getBookingById(db, run())
}

// ยืนยัน / ยกเลิกการจอง — สถานะ converted_to_contract ตั้งได้ทางเดียวคือผ่านการแปลงเป็นสัญญา
export function setBookingStatus(db, bookingId, status) {
  if (!['confirmed', 'cancelled'].includes(status)) {
    throw new Error('สถานะการจองที่ระบุไม่ถูกต้อง')
  }

  const booking = getBookingById(db, bookingId)
  if (!booking) throw new Error('ไม่พบการจองที่ต้องการ')
  if (booking.status === 'converted_to_contract') {
    throw new Error('การจองนี้ถูกแปลงเป็นสัญญาเช่าไปแล้ว')
  }

  db.prepare('UPDATE room_bookings SET status = ?, updated_at = ? WHERE booking_id = ?').run(
    status,
    new Date().toISOString(),
    bookingId
  )
  return getBookingById(db, bookingId)
}

// แปลงการจองเป็นสัญญาเช่า
//
// เงินจองที่รับไว้แล้วต้องไหลเข้าไปในสัญญาด้วย (contracts.booking_fee_cents) ไม่ใช่หายไป
// เพราะกล่องสรุปตอนทำสัญญาเอาเงินจองมาหักออกจากยอดที่ต้องเก็บเพิ่ม — ถ้าไม่ยกมา
// ผู้เช่าจะถูกเก็บเงินประกันเต็มจำนวนทั้งที่วางมัดจำไว้แล้ว
//
// ข้อมูลผู้เช่าตัวจริงมาจาก input ไม่ใช่จากชื่อในใบจอง เพราะใบจองเก็บชื่อไว้เป็นข้อความ
// ก้อนเดียว ("สมชาย ใจดี") แยกชื่อ/นามสกุลอัตโนมัติแล้วผิดบ่อย — ให้หน้าจอเติมให้ผู้ใช้
// ตรวจก่อนแทน
export function convertBookingToContract(db, bookingId, contractInput) {
  const booking = getBookingById(db, bookingId)
  if (!booking) throw new Error('ไม่พบการจองที่ต้องการ')
  if (booking.status === 'converted_to_contract') {
    throw new Error('การจองนี้ถูกแปลงเป็นสัญญาเช่าไปแล้ว')
  }
  if (booking.status === 'cancelled') {
    throw new Error('การจองนี้ถูกยกเลิกไปแล้ว ไม่สามารถแปลงเป็นสัญญาได้')
  }

  const run = db.transaction(() => {
    const contract = createContract(db, {
      ...contractInput,
      // บอก createContract ว่ามาจากการจองใบนี้ — ไม่งั้นมันเห็นการจองค้างในห้องแล้วปฏิเสธ
      fromBookingId: bookingId,
      roomId: booking.roomId,
      rentType: booking.rentType,
      // เงินจองยกมาจากใบจองเสมอ ไม่ให้หน้าจอส่งค่าอื่นมาทับ — ตัวเลขนี้คือเงินที่รับไปแล้วจริง
      bookingFee: String(booking.bookingFeeCents / 100),
      // **วันที่รับเงินจองคือวันที่จอง ไม่ใช่วันทำสัญญา** — จองไว้ 01/03 แล้วเข้าอยู่ 25/05
      // ใบเสร็จเงินจองต้องลงวันที่ 01/03 ไม่งั้นรายรับของเดือนมีนาคมจะหายไปทั้งก้อน
      bookingPaidDate: booking.bookingDate,
      // เลขที่ใบจองยกมาจากใบเดิม ไม่ออกเลขใหม่ — ผู้เช่าถือใบจองที่มีเลขนี้อยู่ในมือแล้ว
      // สัญญากับใบจองต้องอ้างเลขเดียวกันถึงจะตามเรื่องย้อนหลังได้
      bookingReceiptNo: booking.bookingNumber
    })

    db.prepare(
      'UPDATE room_bookings SET status = ?, updated_at = ? WHERE booking_id = ?'
    ).run('converted_to_contract', new Date().toISOString(), bookingId)

    return contract
  })

  return run()
}

export function deleteBooking(db, bookingId) {
  const booking = getBookingById(db, bookingId)
  if (!booking) throw new Error('ไม่พบการจองที่ต้องการลบ')
  if (booking.status === 'converted_to_contract') {
    throw new Error('ลบไม่ได้ เพราะการจองนี้ถูกแปลงเป็นสัญญาเช่าไปแล้ว')
  }

  db.prepare('DELETE FROM room_bookings WHERE booking_id = ?').run(bookingId)
  return { ok: true }
}

// ------------------------------------------------------------------
// รูปแบบที่ส่งออกไปให้หน้าจอ
// ------------------------------------------------------------------
export function toPublicBooking(row) {
  if (!row) return null
  return {
    bookingId: row.booking_id,
    // ใบจองที่บันทึกไว้ก่อนมี migration 013 จะเป็น null — หน้าจอต้องรับกรณีนี้ได้
    bookingNumber: row.booking_number,
    roomId: row.room_id,
    rentType: row.rent_type,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    bookingDate: row.booking_date,
    rentPriceCents: row.rent_price_cents,
    bookingFeeCents: row.booking_fee_cents,
    paymentMethod: row.payment_method,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    note: row.note,
    status: row.status,
    statusLabel: BOOKING_STATUS_LABELS[row.status] ?? row.status,
    // การจองที่ยังกันห้องไว้อยู่ — หน้าจอใช้ตัดสินว่าจะโชว์ปุ่มทำสัญญา/ยกเลิกไหม
    isOpen: OPEN_STATUSES.includes(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
