// ตาราง contracts — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// โครงตามหน้าจริงของต้นแบบ (`/rooms/{id}/agreements/create` สำรวจ 2026-07-31):
// การทำสัญญาเป็นตัวช่วย 3 ขั้น — 1 สัญญา · 2 ค่าเช่าล่วงหน้า · 3 มิเตอร์น้ำ-ไฟ
// แต่ทั้งสามขั้นเขียนลงฐานข้อมูล "ครั้งเดียว" ตอนจบ ไม่ได้ทยอยบันทึกทีละขั้น
// เพราะสัญญาที่มีแต่ข้อ 1 โดยไม่มีเลขมิเตอร์เริ่มต้น ออกบิลเดือนแรกไม่ได้เลย
import { toCents } from '../money.js'
// invoices.js ไม่ได้นำเข้าอะไรจากไฟล์นี้ ทิศทางจึงไม่เป็นวงกลม
import { nextDocumentNumber } from './invoices.js'
// payments.js ไม่ได้ import ไฟล์นี้กลับ จึงไม่เกิดวงกลม
import { getDepositStatus, recordContractPayment } from './payments.js'

// SQLite ไม่มี ENUM — เก็บเป็น TEXT แล้วตรวจที่ JS ก่อนเขียนทุกครั้ง
export const RENT_TYPES = ['monthly', 'daily']
export const CONTRACT_STATUSES = ['active', 'terminated']
export const DEPOSIT_PAYMENT_METHODS = ['cash', 'transfer', 'other']

export const DEPOSIT_PAYMENT_METHOD_LABELS = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  other: 'อื่นๆ'
}

// ------------------------------------------------------------------
// ค่าเช่าเดือนแรก (ขั้นที่ 2 ของต้นแบบ)
// ------------------------------------------------------------------
// **กติกาจริงของหอ ยืนยันกับเจ้าของหอแล้ว 2026-08-10** (คำพูดของเจ้าของหอ):
//   "พอน้องมาอยู่เปิดเทอมเข้าต้นเดือนก็คิดเต็มเดือน"
//   "ถ้าเข้าอยู่ช่วงวันที่ 2 หรือ 3 ก็จะคิดเต็มเดือน"
//   "ถ้าเข้าคาบเกี่ยว เอาราคาห้องหาร 30 วันแล้วนับวันคิด"
//
// จึงมีสองกฎ:
//   1) เข้าพักวันที่ 1-3 → คิดเต็มเดือน ไม่ปัดเศษลง
//   2) เข้าพักหลังจากนั้น → (ค่าเช่า ÷ 30) × จำนวนวันที่อยู่จริงจนสิ้นเดือน
//
// **หารด้วย 30 เสมอ ไม่ใช่จำนวนวันจริงของเดือนนั้น** — เดิมหารด้วยจำนวนวันจริง (28/29/31)
// ซึ่งถอดมาจากหน้าจอต้นแบบ แต่หอนี้คิดคนละแบบ ต่างกันจริงทุกเดือนที่ไม่มี 30 วัน:
//   เข้า 15 ก.ค. ค่าเช่า 5,000 → ของเดิม 5000×17/31 = 2,741.94 · ของหอ 5000/30×17 = 2,833.33
//
// คิดบนหน่วยสตางค์แล้วปัดครั้งเดียวตอนท้าย — ถ้าคิดเป็นบาททศนิยมก่อนแล้วค่อยคูณ
// จะเพี้ยนทีละสตางค์สะสมข้ามเดือน

// เข้าพักภายในวันนี้ของเดือน ยังคิดเต็มเดือน
export const FULL_MONTH_MOVE_IN_UNTIL_DAY = 3

// ตัวหารคงที่ตามที่หอใช้ ไม่ใช่จำนวนวันจริงของเดือน
export const PRORATE_DAYS_PER_MONTH = 30

export function calculateAdvanceRentCents(rentAmountCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('วันที่เข้าพักไม่ถูกต้อง')

  const rent = Number(rentAmountCents)
  const dayOfMonth = date.getDate()
  if (dayOfMonth <= FULL_MONTH_MOVE_IN_UNTIL_DAY) return rent

  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้ (กันเดือน ก.พ. / ปีอธิกสุรทินเอง)
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  // นับวันเข้าพักเป็นวันแรกที่คิดเงิน — เข้า 15 มิ.ย. = อยู่ 16 วัน (15 ถึง 30)
  const daysStaying = daysInMonth - dayOfMonth + 1

  return Math.round((rent * daysStaying) / PRORATE_DAYS_PER_MONTH)
}

// ------------------------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// ------------------------------------------------------------------
export function validateContractInput(input) {
  const errors = []
  const { rentType, startDate, endDate, tenants } = input

  if (!RENT_TYPES.includes(rentType)) errors.push('ประเภทสัญญาต้องเป็นรายเดือนหรือรายวัน')
  if (!isDate(startDate)) errors.push('กรุณาระบุวันที่เข้าพัก')
  if (endDate && !isDate(endDate)) errors.push('วันที่ออกไม่ถูกต้อง')
  if (isDate(startDate) && isDate(endDate) && endDate < startDate) {
    errors.push('วันที่ออกต้องไม่ก่อนวันที่เข้าพัก')
  }

  if (!DEPOSIT_PAYMENT_METHODS.includes(input.depositPaymentMethod)) {
    errors.push('กรุณาเลือกวิธีชำระเงินประกัน')
  }

  // เงินทุกช่องยอมให้เป็น 0 ได้ แต่ต้องเป็นตัวเลขที่แปลงเป็นสตางค์ได้
  for (const [key, label] of [
    ['rentAmount', 'ค่าเช่า'],
    ['deposit', 'เงินประกัน'],
    ['bookingFee', 'เงินจอง']
  ]) {
    try {
      toCents(input[key], label)
    } catch (err) {
      errors.push(err.message)
    }
  }

  // ไม่บังคับกรอก — เว้นว่าง = จ่ายส่วนที่เหลือครบในวันทำสัญญา (กรณีปกติ)
  if (input.depositReceived !== undefined && input.depositReceived !== null && input.depositReceived !== '') {
    try {
      toCents(input.depositReceived, 'เงินประกันที่รับวันนี้')
    } catch (err) {
      errors.push(err.message)
    }
  }

  // เลขมิเตอร์เป็นค่าที่อ่านจากหน้าปัด ไม่ใช่เงิน จึงเป็นทศนิยมธรรมดา ไม่ใช่สตางค์
  for (const [key, label] of [
    ['waterMeterStart', 'เลขมิเตอร์ค่าน้ำ'],
    ['electricMeterStart', 'เลขมิเตอร์ค่าไฟ']
  ]) {
    const value = Number(input[key])
    if (!Number.isFinite(value) || value < 0) errors.push(`${label}ต้องเป็นตัวเลขไม่ติดลบ`)
  }

  // ต้นแบบบังคับให้มีผู้เช่าอย่างน้อยหนึ่งคนตั้งแต่ขั้นแรก — สัญญาที่ไม่มีคนเช่าไม่มีความหมาย
  if (!Array.isArray(tenants) || tenants.length === 0) {
    errors.push('กรุณาระบุผู้เช่าอย่างน้อย 1 คน')
  }

  return errors
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function getContractById(db, contractId) {
  const row = db.prepare('SELECT * FROM contracts WHERE contract_id = ?').get(contractId)
  if (!row) return null
  return toPublicContract(db, row)
}

// สัญญาที่ยังใช้งานอยู่ของห้องหนึ่ง — หน้ารายละเอียดห้องถามตัวนี้ทุกครั้งที่เปิด
// ห้องหนึ่งมีสัญญา active ได้ทีละใบเท่านั้น (บังคับตอนสร้าง)
export function getActiveContractByRoom(db, roomId) {
  const row = db
    .prepare(`SELECT * FROM contracts WHERE room_id = ? AND status = 'active' LIMIT 1`)
    .get(roomId)
  return row ? toPublicContract(db, row) : null
}

// รายการห้องทั้งหอสำหรับหน้า "ห้องพัก" — ต้นแบบใช้หน้านี้เป็นหน้าหลักของระบบ
// (คอลัมน์ ห้อง | ลูกค้า | ประเภท | ค่าเช่า | บริการเสริม | ...)
//
// ดึงผู้เช่าหลักของสัญญาที่ยัง active มาด้วยในคำถามเดียว ไม่ใช่ยิงถามทีละห้อง
// หอ 40 ห้องจะได้ไม่กลายเป็น 40 คำถาม
export function listRoomsForApartment(db, apartmentId, { search, tenant, rentType } = {}) {
  const rows = db
    .prepare(
      `SELECT
         r.room_id, r.room_number, r.status, r.monthly_rent_cents, r.daily_rent_cents,
         rt.name AS room_type_name,
         f.floor_name,
         c.contract_id, c.rent_type, c.start_date, c.end_date, c.rent_amount_cents,
         -- เงินประกันที่ยังเก็บไม่ครบ — คิดในคิวรีเดียวกันเพื่อไม่ให้ยิงทีละห้อง
         -- นับจากใบเสร็จที่ระบุว่าเป็นเงินประกัน (รวมเงินจองที่ออกใบให้ตอนทำสัญญา)
         c.deposit_amount_cents - COALESCE((
           SELECT SUM(p.amount_cents) FROM payments p
            WHERE p.contract_id = c.contract_id AND p.purpose = 'deposit'
         ), 0) AS deposit_outstanding,
         -- การจองที่ยังกันห้องอยู่ (pending/confirmed) — **ไม่ได้เก็บเป็นสถานะห้อง**
         -- ดูเหตุผลที่ toPublicRoomRow ด้านล่าง
         b.booking_id, b.customer_name AS booking_customer, b.check_in_date AS booking_check_in,
         b.customer_phone AS booking_phone, b.status AS booking_status,
         -- ยอดค้างชำระของสัญญาที่ยังใช้งานอยู่ (ไม่นับบิลที่ยกเลิก)
         COALESCE((
           SELECT SUM(i.total_amount_cents) - COALESCE((
             SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.invoice_id
           ), 0)
             FROM invoices i
            WHERE i.contract_id = c.contract_id AND i.status IN ('unpaid', 'partial_paid')
         ), 0) AS invoice_outstanding
       FROM rooms r
       JOIN floors f ON f.floor_id = r.floor_id
       LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
       LEFT JOIN contracts c ON c.room_id = r.room_id AND c.status = 'active'
       -- ห้องหนึ่งมีการจองที่ยังค้างอยู่ได้ใบเดียว (บังคับไว้ที่ createBooking แล้ว)
       LEFT JOIN room_bookings b
              ON b.room_id = r.room_id AND b.status IN ('pending', 'confirmed')
      WHERE f.apartment_id = ?
      ORDER BY r.room_number`
    )
    .all(apartmentId)

  const tenantsByContract = new Map()
  for (const row of db
    .prepare(
      `SELECT ct.contract_id, t.tenant_id, t.first_name, t.last_name, t.phone, ct.is_primary
         FROM contract_tenants ct
         JOIN tenants t ON t.tenant_id = ct.tenant_id
         JOIN contracts c ON c.contract_id = ct.contract_id
         JOIN rooms r ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND c.status = 'active'
        ORDER BY ct.is_primary DESC`
    )
    .all(apartmentId)) {
    const list = tenantsByContract.get(row.contract_id) ?? []
    list.push({
      tenantId: row.tenant_id,
      fullName: `${row.first_name} ${row.last_name}`,
      phone: row.phone,
      isPrimary: row.is_primary === 1
    })
    tenantsByContract.set(row.contract_id, list)
  }

  const servicesByRoom = new Map()
  for (const row of db
    .prepare(
      `SELECT rs.room_id, s.name
         FROM room_services rs
         JOIN apartment_services s ON s.service_id = rs.apartment_service_id
         JOIN rooms r ON r.room_id = rs.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ?
        ORDER BY s.name`
    )
    .all(apartmentId)) {
    const list = servicesByRoom.get(row.room_id) ?? []
    list.push(row.name)
    servicesByRoom.set(row.room_id, list)
  }

  const rooms = rows.map((row) => {
    const occupants = row.contract_id ? (tenantsByContract.get(row.contract_id) ?? []) : []
    return {
      roomId: row.room_id,
      roomNumber: row.room_number,
      floorName: row.floor_name,
      roomTypeName: row.room_type_name ?? null,
      status: row.status,
      monthlyRentCents: row.monthly_rent_cents,
      dailyRentCents: row.daily_rent_cents,
      services: servicesByRoom.get(row.room_id) ?? [],
      contractId: row.contract_id ?? null,
      rentType: row.rent_type ?? null,
      startDate: row.start_date ?? null,
      endDate: row.end_date ?? null,
      contractRentCents: row.rent_amount_cents ?? null,
      // > 0 = ยังเก็บเงินประกันไม่ครบ หน้ารายการห้องขึ้นป้ายเตือนจากค่านี้
      // เก็บเกินไม่ทำให้ติดลบ เพราะติดลบอ่านไม่ออกว่าแปลว่าอะไร
      depositOutstandingCents: Math.max(0, row.deposit_outstanding ?? 0),
      invoiceOutstandingCents: Math.max(0, row.invoice_outstanding ?? 0),
      // **การจองไม่ได้ถูกเก็บเป็น rooms.status โดยตั้งใจ**
      //
      // rooms.status มีแค่ vacant / occupied / maintenance และห้องที่มีคนจองไว้ยัง "ว่าง"
      // จริงๆ (ยังไม่มีใครอยู่) การเพิ่มสถานะ 'booked' แปลว่าต้องมีคนคอยตั้งและล้างมันตาม
      // วงจรของใบจอง — จอง ยืนยัน ยกเลิก แปลงเป็นสัญญา — แล้วความจริงเรื่องเดียวกันจะอยู่
      // สองที่ วันหนึ่งก็ไม่ตรงกัน (แบบเดียวกับ is_active ที่เพิ่งทำให้ห้อง 102 หายไป)
      //
      // หน้าจอจึงอ่านจากใบจองตรงๆ แล้วขึ้นป้าย "จองแล้ว" เอง — ตัวเลขบนจอมาจากใบจอง
      // เสมอ ไม่มีทางค้างเป็นสถานะเก่าที่ไม่มีใครล้าง
      booking: row.booking_id
        ? {
            bookingId: row.booking_id,
            customerName: row.booking_customer,
            customerPhone: row.booking_phone,
            checkInDate: row.booking_check_in,
            status: row.booking_status
          }
        : null,
      tenants: occupants,
      primaryTenant: occupants.find((t) => t.isPrimary) ?? occupants[0] ?? null
    }
  })

  // กรองในหน่วยความจำ ไม่ใช่ต่อ WHERE เข้าไปใน SQL — หอใหญ่สุดที่รองรับคือ 30 ชั้น x 50 ห้อง
  // = 1,500 แถว ซึ่งเล็กมาก แต่การกรองข้ามหลายตาราง (ชื่อผู้เช่าอยู่คนละตาราง) ถ้าเขียนเป็น
  // SQL จะกลายเป็นคำสั่งยาวที่อ่านยากและแก้ทีหลังพลาดง่าย
  const digits = (value) => String(value ?? '').replace(/\D/g, '')
  return rooms.filter((room) => {
    if (search && !room.roomNumber.includes(String(search).trim())) return false
    if (rentType && room.rentType !== rentType) return false
    if (tenant) {
      const keyword = String(tenant).trim()
      const asDigits = digits(keyword)
      const matches = (name, phone) =>
        String(name ?? '').includes(keyword) || (asDigits && digits(phone).includes(asDigits))

      // **ค้นหาคนจองด้วย ไม่ใช่แค่ผู้เช่าตามสัญญา** (ผู้ใช้สั่ง 2026-08-10)
      //
      // คนที่จองห้องไว้ยังไม่ใช่ผู้เช่า — ระเบียนผู้เช่าเพิ่งถูกสร้างตอนทำสัญญา ถ้าค้นแต่
      // ผู้เช่า คนที่จองไว้แล้วยังไม่ย้ายเข้าจะหาไม่เจอเลย ซึ่งเป็นช่วงเวลาเดียวที่ต้องหา
      // จริงๆ: หอร้อยห้อง คนจองจำเลขห้องตัวเองไม่ได้ เหลือแค่ชื่อให้ค้น
      const hit =
        room.tenants.some((t) => matches(t.fullName, t.phone)) ||
        (room.booking && matches(room.booking.customerName, room.booking.customerPhone))
      if (!hit) return false
    }
    return true
  })
}

export function listContractsByRoom(db, roomId) {
  return db
    .prepare('SELECT * FROM contracts WHERE room_id = ? ORDER BY start_date DESC, contract_id DESC')
    .all(roomId)
    .map((row) => toPublicContract(db, row))
}

// ------------------------------------------------------------------
// เขียน
// ------------------------------------------------------------------
export function createContract(db, input) {
  const roomId = Number(input.roomId)
  const room = db
    .prepare(
      `SELECT r.room_id, r.room_number, r.status, f.apartment_id
         FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
        WHERE r.room_id = ?`
    )
    .get(roomId)
  if (!room) throw new Error('ไม่พบห้องพักที่ต้องการทำสัญญา')

  // ห้องหนึ่งมีสัญญาที่ยังใช้งานอยู่ได้ใบเดียว — กันการทำสัญญาซ้อนโดยไม่ตั้งใจ
  // (เปิดสองแท็บแล้วกดบันทึกทั้งคู่ หรือลืมว่าทำไปแล้ว)
  const existing = db
    .prepare(`SELECT contract_id FROM contracts WHERE room_id = ? AND status = 'active'`)
    .get(roomId)
  if (existing) {
    throw new Error(`ห้อง ${room.room_number} มีสัญญาที่ยังใช้งานอยู่แล้ว กรุณาแจ้งย้ายออกก่อน`)
  }

  const tenantIds = [...new Set(input.tenants.map(Number))]
  for (const tenantId of tenantIds) {
    const exists = db.prepare('SELECT 1 FROM tenants WHERE tenant_id = ?').get(tenantId)
    if (!exists) throw new Error('ไม่พบผู้เช่าที่ระบุ')
  }

  const rentAmountCents = toCents(input.rentAmount, 'ค่าเช่า')
  const now = new Date().toISOString()

  // กฎคืนเงินประกันถูก "ถ่ายสำเนา" ลงสัญญา ณ วันทำสัญญา (ดู 004_deposit_refund_policy.sql)
  // ถ้าเจ้าของหอเปลี่ยนกฎทีหลัง สัญญาเก่าต้องยังใช้กฎเดิมที่ตกลงกันไว้ ไม่ใช่ย้อนหลัง
  const policy = db
    .prepare(
      `SELECT default_deposit_min_stay_months AS minStay, default_deposit_notice_days AS noticeDays
         FROM apartments WHERE apartment_id = ?`
    )
    .get(room.apartment_id)

  const bookingFeeCents = toCents(input.bookingFee ?? 0, 'เงินจอง')
  const depositCents = toCents(input.deposit, 'เงินประกัน')

  // ไม่ส่งมา = จ่ายส่วนที่เหลือครบในวันทำสัญญา ซึ่งเป็นกรณีปกติ
  // (ส่งมาเป็น 0 คือตั้งใจบอกว่าวันนี้ยังไม่ได้เก็บ — ต่างจากไม่ส่งมาเลย)
  const depositReceivedCents =
    input.depositReceived === undefined || input.depositReceived === null || input.depositReceived === ''
      ? Math.max(0, depositCents - bookingFeeCents)
      : toCents(input.depositReceived, 'เงินประกันที่รับวันนี้')

  // เก็บเกินยอดที่ตกลงกันไว้ไม่ได้ — เงินส่วนเกินไม่มีที่ไป และยอดค้างจะติดลบ
  if (bookingFeeCents + depositReceivedCents > depositCents) {
    throw new Error(
      `เงินประกันที่รับรวมกันเกินยอดที่ตกลงไว้ — ตกลง ${depositCents / 100} บาท ` +
        `แต่รับมา ${(bookingFeeCents + depositReceivedCents) / 100} บาท (รวมเงินจอง)`
    )
  }

  const run = db.transaction(() => {
    // เลขที่ใบจอง: ยกมาจากใบจองเดิมถ้ามี (ดู convertBookingToContract) ถ้าไม่มีแต่มีการวาง
    // เงินจองไว้จริง ให้ระบบออกเลขให้เอง — ผู้เช่าที่เดินเข้ามาวางมัดจำแล้วทำสัญญาเลย
    // ก็ต้องมีเลขอ้างอิงบนใบเสร็จเหมือนกัน
    //
    // ยังพิมพ์ทับเองได้ สำหรับหอที่ใช้เล่มใบเสร็จของตัวเองอยู่แล้ว
    const givenReceiptNo = String(input.bookingReceiptNo ?? '').trim()
    const bookingReceiptNo =
      givenReceiptNo ||
      (bookingFeeCents > 0
        ? nextDocumentNumber(db, room.apartment_id, 'booking', input.startDate)
        : null)

    const contractId = db
      .prepare(
        `INSERT INTO contracts (
           room_id, rent_type, start_date, end_date, rent_amount_cents,
           deposit_amount_cents, deposit_payment_method, booking_fee_cents, booking_receipt_no,
           advance_payment_amount_cents, water_meter_start, electric_meter_start, note, status,
           term_months, deposit_min_stay_months, deposit_notice_days, created_at
         ) VALUES (
           @roomId, @rentType, @startDate, @endDate, @rentAmountCents,
           @depositCents, @depositPaymentMethod, @bookingFeeCents, @bookingReceiptNo,
           @advanceCents, @waterMeterStart, @electricMeterStart, @note, 'active',
           @termMonths, @minStay, @noticeDays, @now
         )`
      )
      .run({
        roomId,
        rentType: input.rentType,
        startDate: input.startDate,
        endDate: input.endDate || null,
        rentAmountCents,
        depositCents,
        depositPaymentMethod: input.depositPaymentMethod,
        bookingFeeCents,
        bookingReceiptNo,
        // ค่าเช่าล่วงหน้าคิดให้เอง ไม่ให้กรอกมือ — คิดมือแล้วผิดคือเก็บเงินผิดตั้งแต่วันแรก
        advanceCents:
          input.rentType === 'monthly'
            ? calculateAdvanceRentCents(rentAmountCents, input.startDate)
            : 0,
        waterMeterStart: Number(input.waterMeterStart),
        electricMeterStart: Number(input.electricMeterStart),
        note: String(input.note ?? '').trim() || null,
        termMonths: input.termMonths ? Number(input.termMonths) : null,
        minStay: policy?.minStay ?? null,
        noticeDays: policy?.noticeDays ?? 15,
        now
      }).lastInsertRowid

    // ผู้เช่าคนแรกในรายการ = ผู้เช่าหลัก (คนที่ชื่อขึ้นใบแจ้งหนี้) ดู 010_contract_tenants.sql
    const addTenant = db.prepare(
      `INSERT INTO contract_tenants (contract_id, tenant_id, is_primary, created_at)
       VALUES (?, ?, ?, ?)`
    )
    tenantIds.forEach((tenantId, index) => {
      addTenant.run(contractId, tenantId, index === 0 ? 1 : 0, now)
    })

    // *** ถ่ายสำเนาค่าบริการของห้อง ณ วันทำสัญญา ลง contract_services ***
    // ไม่อ่านจาก room_services ตอนออกบิล เพราะเจ้าของหอขึ้นราคาค่าอินเทอร์เน็ตกลางสัญญาได้
    // ผู้เช่าที่เซ็นไปแล้วต้องจ่ายราคาที่ตกลงกันไว้ ไม่ใช่ราคาใหม่ที่ไม่เคยรับรู้
    db.prepare(
      `INSERT INTO contract_services (contract_id, apartment_service_id, price_cents)
       SELECT ?, s.service_id, s.price_cents
         FROM room_services rs JOIN apartment_services s ON s.service_id = rs.apartment_service_id
        WHERE rs.room_id = ?`
    ).run(contractId, roomId)

    // ห้องต้องกลายเป็น "ไม่ว่าง" ทันทีในธุรกรรมเดียวกัน ไม่ใช่ให้ไปกดเปลี่ยนเองทีหลัง
    // ถ้าแยกกันแล้วขั้นที่สองพลาด จะได้ห้องว่างที่มีคนอยู่ แล้วปล่อยเช่าซ้ำ
    db.prepare(`UPDATE rooms SET status = 'occupied', updated_at = ? WHERE room_id = ?`).run(
      now,
      roomId
    )

    // *** เงินจองที่รับไปแล้ว ออกใบเสร็จเป็น "เงินประกัน" ให้ตรงนี้ ***
    //
    // เงินจองคือเงินประกันส่วนแรกที่ผู้เช่าวางไว้ตอนมาดูห้อง (ฟอร์มทำสัญญาก็คิดแบบนี้:
    // "รวม (เก็บเพิ่ม) = เงินประกัน − เงินจอง") ถ้าไม่บันทึกเป็นใบเสร็จ จะเกิดสองปัญหา:
    //   1. เงินที่เข้าหอไปจริงไม่โผล่ในรายงานใบเสร็จเลย
    //   2. ระบบไม่รู้ว่าเงินประกันรับมาแล้วเท่าไหร่ จึงเตือนเรื่องยอดค้างไม่ได้
    //
    // **วันที่บนใบเสร็จเป็นวันที่รับเงินจริง ไม่ใช่วันทำสัญญา** — ผู้เช่าวางเงินจองวันที่
    // 01/03 แล้วเข้าอยู่ 25/05 ใบเสร็จต้องลงวันที่ 01/03 ไม่งั้นรายงานรายรับเดือนมีนาคมจะหาย
    if (bookingFeeCents > 0) {
      recordContractPayment(db, {
        contractId,
        amount: String(bookingFeeCents / 100),
        purpose: 'deposit',
        paymentMethod: input.depositPaymentMethod,
        paymentDate: input.bookingPaidDate || input.startDate,
        remark: bookingReceiptNo ? `เงินจองตามใบจอง ${bookingReceiptNo}` : 'เงินจอง',
        createdBy: input.createdBy
      })
    }

    // *** เงินประกันส่วนที่รับในวันทำสัญญา ***
    //
    // ปกติผู้เช่าจ่ายส่วนที่เหลือครบในวันเซ็นสัญญา (เดินเข้ามาดูห้องแล้วเข้าอยู่เลยก็จ่าย
    // เต็มจำนวนตรงนั้น) ฟอร์มจึงเติมยอด "เงินประกัน − เงินจอง" ไว้ให้ก่อน
    //
    // แต่แก้ลงได้ สำหรับกรณีที่ตกลงกันว่าจ่ายไม่ครบวันนี้ — ส่วนที่ขาดจะไปโผล่เป็นยอดค้าง
    // บนหน้าห้องจนกว่าจะเก็บครบ ถ้าไม่มีช่องนี้ ระบบจะเหมาว่าเก็บครบเสมอ แล้วการเตือน
    // เรื่องเงินประกันค้างก็ไม่มีวันทำงาน
    if (depositReceivedCents > 0) {
      recordContractPayment(db, {
        contractId,
        amount: String(depositReceivedCents / 100),
        purpose: 'deposit',
        paymentMethod: input.depositPaymentMethod,
        paymentDate: input.startDate,
        remark: 'เงินประกันวันทำสัญญา',
        createdBy: input.createdBy
      })
    }

    return contractId
  })

  return getContractById(db, run())
}

// ------------------------------------------------------------------
// รูปแบบที่ส่งออกไปให้หน้าจอ
// ------------------------------------------------------------------
export function toPublicContract(db, row) {
  if (!row) return null

  const tenants = db
    .prepare(
      `SELECT t.tenant_id, t.first_name, t.last_name, t.phone, ct.is_primary, ct.note
         FROM contract_tenants ct JOIN tenants t ON t.tenant_id = ct.tenant_id
        WHERE ct.contract_id = ?
        ORDER BY ct.is_primary DESC, t.first_name`
    )
    .all(row.contract_id)
    .map((t) => ({
      tenantId: t.tenant_id,
      fullName: `${t.first_name} ${t.last_name}`,
      phone: t.phone,
      isPrimary: t.is_primary === 1,
      note: t.note
    }))

  const services = db
    .prepare(
      `SELECT cs.apartment_service_id, cs.price_cents, s.name
         FROM contract_services cs JOIN apartment_services s ON s.service_id = cs.apartment_service_id
        WHERE cs.contract_id = ?
        ORDER BY s.name`
    )
    .all(row.contract_id)
    .map((s) => ({ serviceId: s.apartment_service_id, name: s.name, priceCents: s.price_cents }))

  return {
    contractId: row.contract_id,
    roomId: row.room_id,
    rentType: row.rent_type,
    startDate: row.start_date,
    endDate: row.end_date,
    rentAmountCents: row.rent_amount_cents,
    depositAmountCents: row.deposit_amount_cents,
    // ยอดที่รับมาจริงกับยอดที่ยังค้าง — นับจากใบเสร็จ ไม่ใช่คอลัมน์ที่พิมพ์มือ
    // หน้าจอใช้ตัวนี้ขึ้นป้ายเตือนว่ายังเก็บเงินประกันไม่ครบ
    deposit: getDepositStatus(db, row.contract_id),
    depositPaymentMethod: row.deposit_payment_method,
    bookingFeeCents: row.booking_fee_cents,
    bookingReceiptNo: row.booking_receipt_no,
    advancePaymentAmountCents: row.advance_payment_amount_cents,
    waterMeterStart: row.water_meter_start,
    electricMeterStart: row.electric_meter_start,
    note: row.note,
    status: row.status,
    termMonths: row.term_months,
    depositMinStayMonths: row.deposit_min_stay_months,
    depositNoticeDays: row.deposit_notice_days,
    tenants,
    primaryTenant: tenants.find((t) => t.isPrimary) ?? null,
    services,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
