// ตัวช่วยทำสัญญา 3 ขั้น แต่เขียนลงฐานข้อมูลครั้งเดียวตอนจบ
import { toCents } from '../money.js'
import { nextDocumentNumber } from './invoices.js'
import { getDepositStatus, recordContractPayment } from './payments.js'

export const RENT_TYPES = ['monthly', 'daily']
export const CONTRACT_STATUSES = ['active', 'terminated']
export const DEPOSIT_PAYMENT_METHODS = ['cash', 'transfer', 'other']

export const DEPOSIT_PAYMENT_METHOD_LABELS = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  other: 'อื่นๆ'
}

// ค่าเช่าเดือนแรก: เข้าวันที่ 1-3 คิดเต็มเดือน · หลังจากนั้น ค่าเช่า ÷ 30 × วันที่อยู่ ปัดเป็นบาทเต็ม (50 สตางค์ขึ้น)

export const FULL_MONTH_MOVE_IN_UNTIL_DAY = 3

// หาร 30 เสมอ ไม่ใช่จำนวนวันจริงของเดือน
export const PRORATE_DAYS_PER_MONTH = 30

export function calculateAdvanceRentCents(rentAmountCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('วันที่เข้าพักไม่ถูกต้อง')

  const rent = Number(rentAmountCents)
  const dayOfMonth = date.getDate()
  if (dayOfMonth <= FULL_MONTH_MOVE_IN_UNTIL_DAY) return rent

  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  // นับวันเข้าพักเป็นวันแรกด้วย
  const daysStaying = daysInMonth - dayOfMonth + 1

  return Math.round((rent * daysStaying) / (PRORATE_DAYS_PER_MONTH * 100)) * 100
}

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

  if (input.depositReceived !== undefined && input.depositReceived !== null && input.depositReceived !== '') {
    try {
      toCents(input.depositReceived, 'เงินประกันที่รับวันนี้')
    } catch (err) {
      errors.push(err.message)
    }
  }

  // ช่องว่างต้องเป็น error — Number('') = 0 เป็นเลขมิเตอร์จริง
  for (const [key, label] of [
    ['waterMeterStart', 'เลขมิเตอร์ค่าน้ำ'],
    ['electricMeterStart', 'เลขมิเตอร์ค่าไฟ']
  ]) {
    const raw = input[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      errors.push(`กรุณากรอก${label}วันเข้าพัก (อ่านจากหน้าปัดจริง ถ้าเป็นศูนย์ให้พิมพ์ 0)`)
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) errors.push(`${label}ต้องเป็นตัวเลขไม่ติดลบ`)
  }

  if (!Array.isArray(tenants) || tenants.length === 0) {
    errors.push('กรุณาระบุผู้เช่าอย่างน้อย 1 คน')
  }

  return errors
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function getContractById(db, contractId) {
  const row = db.prepare('SELECT * FROM contracts WHERE contract_id = ?').get(contractId)
  if (!row) return null
  return toPublicContract(db, row)
}

// ห้องหนึ่งมีสัญญา active ได้ใบเดียว
export function getActiveContractByRoom(db, roomId) {
  const row = db
    .prepare(`SELECT * FROM contracts WHERE room_id = ? AND status = 'active' LIMIT 1`)
    .get(roomId)
  return row ? toPublicContract(db, row) : null
}

export function listRoomsForApartment(db, apartmentId, { search, tenant, rentType } = {}) {
  const rows = db
    .prepare(
      `SELECT
         r.room_id, r.room_number, r.status, r.is_active, r.monthly_rent_cents, r.daily_rent_cents,
         rt.name AS room_type_name,
         f.floor_name,
         c.contract_id, c.rent_type, c.start_date, c.end_date, c.rent_amount_cents,
         -- เงินประกันที่ยังเก็บไม่ครบ — คิดในคิวรีเดียวกันเพื่อไม่ให้ยิงทีละห้อง
         -- นับจากใบเสร็จที่ระบุว่าเป็นเงินประกัน (รวมเงินจองที่ออกใบให้ตอนทำสัญญา)
         c.deposit_amount_cents - COALESCE((
           SELECT SUM(p.amount_cents) FROM payments p
            WHERE p.contract_id = c.contract_id AND p.purpose = 'deposit'
              AND p.cancelled_at IS NULL
         ), 0) AS deposit_outstanding,
         -- การจองที่ยังกันห้องอยู่ (pending/confirmed) — **ไม่ได้เก็บเป็นสถานะห้อง**
         -- ดูเหตุผลที่ toPublicRoomRow ด้านล่าง
         b.booking_id, b.customer_name AS booking_customer, b.check_in_date AS booking_check_in,
         b.customer_phone AS booking_phone, b.status AS booking_status,
         -- ยอดค้างชำระของสัญญาที่ยังใช้งานอยู่ (ไม่นับบิลที่ยกเลิก)
         COALESCE((
           SELECT SUM(i.total_amount_cents) - COALESCE((
             SELECT SUM(p.amount_cents) FROM payments p
              WHERE p.invoice_id = i.invoice_id AND p.cancelled_at IS NULL
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

  // services = ชื่อ · serviceItems = ชื่อ + ราคาปัจจุบันของหอ (ใช้กับห้องว่าง)
  const servicesByRoom = new Map()
  const serviceItemsByRoom = new Map()
  for (const row of db
    .prepare(
      `SELECT rs.room_id, s.name, s.price_cents
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

    const items = serviceItemsByRoom.get(row.room_id) ?? []
    items.push({ name: row.name, priceCents: row.price_cents })
    serviceItemsByRoom.set(row.room_id, items)
  }

  const rooms = rows.map((row) => {
    const occupants = row.contract_id ? (tenantsByContract.get(row.contract_id) ?? []) : []
    return {
      roomId: row.room_id,
      roomNumber: row.room_number,
      floorName: row.floor_name,
      roomTypeName: row.room_type_name ?? null,
      status: row.status,
      isActive: row.is_active === 1,
      monthlyRentCents: row.monthly_rent_cents,
      dailyRentCents: row.daily_rent_cents,
      services: servicesByRoom.get(row.room_id) ?? [],
      serviceItems: serviceItemsByRoom.get(row.room_id) ?? [],
      contractId: row.contract_id ?? null,
      rentType: row.rent_type ?? null,
      startDate: row.start_date ?? null,
      endDate: row.end_date ?? null,
      contractRentCents: row.rent_amount_cents ?? null,
      // > 0 = เงินประกันยังเก็บไม่ครบ
      depositOutstandingCents: Math.max(0, row.deposit_outstanding ?? 0),
      invoiceOutstandingCents: Math.max(0, row.invoice_outstanding ?? 0),
      // สถานะจองอ่านจากใบจองตรงๆ ไม่เก็บใน rooms.status
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

  const digits = (value) => String(value ?? '').replace(/\D/g, '')
  return rooms.filter((room) => {
    if (search && !room.roomNumber.includes(String(search).trim())) return false
    if (rentType && room.rentType !== rentType) return false
    if (tenant) {
      const keyword = String(tenant).trim()
      const asDigits = digits(keyword)
      const matches = (name, phone) =>
        String(name ?? '').includes(keyword) || (asDigits && digits(phone).includes(asDigits))

      // ค้นชื่อคนจองด้วย ไม่ใช่แค่ผู้เช่า
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

export function createContract(db, input) {
  const roomId = Number(input.roomId)
  const room = db
    .prepare(
      `SELECT r.room_id, r.room_number, r.status, f.apartment_id, r.is_active
         FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
        WHERE r.room_id = ?`
    )
    .get(roomId)
  if (!room) throw new Error('ไม่พบห้องพักที่ต้องการทำสัญญา')
  if (room.is_active !== 1) {
    throw new Error(`ห้อง ${room.room_number} ปิดใช้งานอยู่ ทำสัญญาไม่ได้`)
  }

  // ห้องหนึ่งมีสัญญา active ได้ใบเดียว
  const existing = db
    .prepare(`SELECT contract_id FROM contracts WHERE room_id = ? AND status = 'active'`)
    .get(roomId)
  if (existing) {
    throw new Error(`ห้อง ${room.room_number} มีสัญญาที่ยังใช้งานอยู่แล้ว กรุณาแจ้งย้ายออกก่อน`)
  }

  // ห้องที่มีการจองค้าง ทำสัญญาได้ผ่าน convertBookingToContract เท่านั้น
  const openBooking = db
    .prepare(
      `SELECT booking_id, customer_name FROM room_bookings
        WHERE room_id = ? AND status IN ('pending', 'confirmed')`
    )
    .all(roomId)
    .find((b) => b.booking_id !== Number(input.fromBookingId))
  if (openBooking) {
    throw new Error(
      `ห้อง ${room.room_number} มีคนจองรอเข้าพักอยู่ (${openBooking.customer_name}) — ` +
        'ให้ทำสัญญาจากการจองนั้น หรือยกเลิกการจองก่อน'
    )
  }

  const tenantIds = [...new Set(input.tenants.map(Number))]
  for (const tenantId of tenantIds) {
    const exists = db.prepare('SELECT 1 FROM tenants WHERE tenant_id = ?').get(tenantId)
    if (!exists) throw new Error('ไม่พบผู้เช่าที่ระบุ')
  }

  const rentAmountCents = toCents(input.rentAmount, 'ค่าเช่า')
  const now = new Date().toISOString()

  // ตรึงกฎคืนเงินประกันลงสัญญา ณ วันทำสัญญา
  const policy = db
    .prepare(
      `SELECT default_deposit_min_stay_months AS minStay,
              default_deposit_notice_days AS noticeDays,
              default_deposit_refund_policy AS refundPolicy
         FROM apartments WHERE apartment_id = ?`
    )
    .get(room.apartment_id)

  const bookingFeeCents = toCents(input.bookingFee ?? 0, 'เงินจอง')
  const depositCents = toCents(input.deposit, 'เงินประกัน')

  // ไม่ส่งมา = จ่ายครบวันนี้ · 0 = ยังไม่ได้เก็บ
  const depositReceivedCents =
    input.depositReceived === undefined || input.depositReceived === null || input.depositReceived === ''
      ? Math.max(0, depositCents - bookingFeeCents)
      : toCents(input.depositReceived, 'เงินประกันที่รับวันนี้')

  const firstMonthRentCents =
    input.rentType === 'monthly' ? calculateAdvanceRentCents(rentAmountCents, input.startDate) : 0

  // เก็บเกินยอดที่ตกลงไม่ได้
  if (bookingFeeCents + depositReceivedCents > depositCents) {
    throw new Error(
      `เงินประกันที่รับรวมกันเกินยอดที่ตกลงไว้ — ตกลง ${depositCents / 100} บาท ` +
        `แต่รับมา ${(bookingFeeCents + depositReceivedCents) / 100} บาท (รวมเงินจอง)`
    )
  }

  const run = db.transaction(() => {
    // เลขที่ใบจองยกมาจากใบจองเดิม ไม่มีก็ออกให้ใหม่
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
           term_months, deposit_min_stay_months, deposit_notice_days,
           deposit_refund_policy, created_at
         ) VALUES (
           @roomId, @rentType, @startDate, @endDate, @rentAmountCents,
           @depositCents, @depositPaymentMethod, @bookingFeeCents, @bookingReceiptNo,
           @advanceCents, @waterMeterStart, @electricMeterStart, @note, 'active',
           @termMonths, @minStay, @noticeDays,
           @refundPolicy, @now
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
        // คิดค่าเช่าเดือนแรกให้เอง ไม่รับจากหน้าจอ
        advanceCents: firstMonthRentCents,
        waterMeterStart: Number(input.waterMeterStart),
        electricMeterStart: Number(input.electricMeterStart),
        note: String(input.note ?? '').trim() || null,
        termMonths: input.termMonths ? Number(input.termMonths) : null,
        minStay: policy?.minStay ?? null,
        noticeDays: policy?.noticeDays ?? 15,
        refundPolicy: policy?.refundPolicy ?? 'on_full_term',
        now
      }).lastInsertRowid

    // ผู้เช่าคนแรก = ผู้เช่าหลัก
    const addTenant = db.prepare(
      `INSERT INTO contract_tenants (contract_id, tenant_id, is_primary, created_at)
       VALUES (?, ?, ?, ?)`
    )
    tenantIds.forEach((tenantId, index) => {
      addTenant.run(contractId, tenantId, index === 0 ? 1 : 0, now)
    })

    // ตรึงราคาค่าบริการของห้อง ณ วันทำสัญญา
    db.prepare(
      `INSERT INTO contract_services (contract_id, apartment_service_id, price_cents)
       SELECT ?, s.service_id, s.price_cents
         FROM room_services rs JOIN apartment_services s ON s.service_id = rs.apartment_service_id
        WHERE rs.room_id = ?`
    ).run(contractId, roomId)

    // ห้องเป็นไม่ว่างในธุรกรรมเดียวกัน
    db.prepare(`UPDATE rooms SET status = 'occupied', updated_at = ? WHERE room_id = ?`).run(
      now,
      roomId
    )

    // เงินจองออกใบเสร็จเป็นเงินประกัน ลงวันที่จองจริง
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

    // เงินประกันที่รับวันนี้ — ขาดเท่าไหร่ขึ้นเป็นยอดค้าง
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

    // ค่าเช่าเดือนแรกออกใบเสร็จตอนย้ายเข้า — บิลรายเดือนเดือนนี้จะข้ามห้องนี้
    if (firstMonthRentCents > 0) {
      const [startYear, startMonth] = String(input.startDate).split('-')
      recordContractPayment(db, {
        contractId,
        amount: String(firstMonthRentCents / 100),
        purpose: 'advance',
        paymentMethod: input.depositPaymentMethod,
        paymentDate: input.startDate,
        remark: `ค่าเช่าเดือนแรก (เดือน ${startMonth}-${Number(startYear) + 543})`,
        createdBy: input.createdBy
      })
    }

    return contractId
  })

  return getContractById(db, run())
}

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
    deposit: getDepositStatus(db, row.contract_id),
    depositPaymentMethod: row.deposit_payment_method,
    bookingFeeCents: row.booking_fee_cents,
    bookingReceiptNo: row.booking_receipt_no,
    advancePaymentAmountCents: row.advance_payment_amount_cents,
    waterMeterStart: row.water_meter_start,
    electricMeterStart: row.electric_meter_start,
    note: row.note,
    status: row.status,
    // NULL = ยังไม่แจ้งย้ายออก
    moveOutNoticeDate: row.move_out_notice_date ?? null,
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
