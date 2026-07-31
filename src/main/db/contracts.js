// ตาราง contracts — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// โครงตามหน้าจริงของต้นแบบ (`/rooms/{id}/agreements/create` สำรวจ 2026-07-31):
// การทำสัญญาเป็นตัวช่วย 3 ขั้น — 1 สัญญา · 2 ค่าเช่าล่วงหน้า · 3 มิเตอร์น้ำ-ไฟ
// แต่ทั้งสามขั้นเขียนลงฐานข้อมูล "ครั้งเดียว" ตอนจบ ไม่ได้ทยอยบันทึกทีละขั้น
// เพราะสัญญาที่มีแต่ข้อ 1 โดยไม่มีเลขมิเตอร์เริ่มต้น ออกบิลเดือนแรกไม่ได้เลย
import { toCents } from '../money.js'

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
// ค่าเช่าล่วงหน้า (ขั้นที่ 2 ของต้นแบบ)
// ------------------------------------------------------------------
// เข้าพักกลางเดือนต้องจ่ายค่าเช่าเฉพาะวันที่เหลือของเดือนนั้น ไม่ใช่เต็มเดือน
// แล้วรอบบิลปกติค่อยเริ่มเดือนถัดไป
//
// สูตรถอดมาจากตัวเลขจริงบนหน้าจอต้นแบบ: ค่าเช่า 5,000 เข้าพัก 18 ก.ค. (เดือนมี 31 วัน)
// เหลือ 14 วัน → 5000 x 14 / 31 = 2,258.06 ตรงกับที่ต้นแบบแสดง
//
// คิดบนหน่วยสตางค์แล้วปัดครั้งเดียวตอนท้าย — ถ้าคิดเป็นบาททศนิยมก่อนแล้วค่อยคูณ
// จะเพี้ยนทีละสตางค์สะสมข้ามเดือน
export function calculateAdvanceRentCents(rentAmountCents, startDate) {
  const date = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('วันที่เข้าพักไม่ถูกต้อง')

  const year = date.getFullYear()
  const month = date.getMonth()
  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้ (กันเดือน ก.พ. / ปีอธิกสุรทินเอง)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysRemaining = daysInMonth - date.getDate() + 1

  return Math.round((Number(rentAmountCents) * daysRemaining) / daysInMonth)
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
         c.contract_id, c.rent_type, c.start_date, c.end_date, c.rent_amount_cents
       FROM rooms r
       JOIN floors f ON f.floor_id = r.floor_id
       LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
       LEFT JOIN contracts c ON c.room_id = r.room_id AND c.status = 'active'
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
      const hit = room.tenants.some(
        (t) => t.fullName.includes(keyword) || (asDigits && digits(t.phone).includes(asDigits))
      )
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

  const run = db.transaction(() => {
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
        depositCents: toCents(input.deposit, 'เงินประกัน'),
        depositPaymentMethod: input.depositPaymentMethod,
        bookingFeeCents: toCents(input.bookingFee ?? 0, 'เงินจอง'),
        bookingReceiptNo: String(input.bookingReceiptNo ?? '').trim() || null,
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
