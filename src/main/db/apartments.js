import { toCents } from '../money.js'
import { deleteOrphanImages } from './images.js'

// วันครบกำหนดเลือกได้ถึง 28 — ทุกเดือนมีวันนั้น
export const MAX_DUE_DATE_DAY = 28

export const DEFAULT_RENT_ITEM_TEXT = 'ค่าเช่าห้อง'

// จำนวนหลักหน้าปัดมิเตอร์ (หอนี้ 5 หลัก)
export const MIN_METER_DIGITS = 3
export const MAX_METER_DIGITS = 8
export const DEFAULT_METER_DIGITS = 5

// อัตรา VAT ของหอใช้กับบิลใหม่ — บิลเดิมเก็บอัตราของตัวเองไว้
export const MIN_VAT_RATE = 0
export const MAX_VAT_RATE = 100
export const DEFAULT_VAT_RATE = 7

// ค่าตั้งต้นของสัญญาใหม่ — สัญญาเดิมใช้กฎที่ตรึงไว้
export const DEPOSIT_REFUND_POLICIES = ['on_full_term', 'always', 'never']

export const DEPOSIT_REFUND_POLICY_LABELS = {
  on_full_term: 'คืนเมื่ออยู่ครบตามสัญญา',
  always: 'คืนเสมอ',
  never: 'ไม่คืนเงินประกัน'
}

// เพดานกันพิมพ์ผิดหลัก
export const MAX_DEPOSIT_NOTICE_DAYS = 365

export const MAX_DEPOSIT_MIN_STAY_MONTHS = 60

export function validateApartmentInput({
  nameTh,
  addressTh,
  dueDateDay,
  lateFeePerDay,
  isAutoLateFeeEnabled,
  meterDigits,
  isVatEnabled,
  vatRate
}) {
  const errors = []

  if (!String(nameTh ?? '').trim()) errors.push('กรุณากรอกชื่อหอพัก (ภาษาไทย)')
  else if (String(nameTh).trim().length > 255) errors.push('ชื่อหอพักยาวเกิน 255 ตัวอักษร')

  if (!String(addressTh ?? '').trim()) errors.push('กรุณากรอกที่อยู่ (ภาษาไทย)')

  const day = Number(dueDateDay)
  if (!Number.isInteger(day) || day < 1 || day > MAX_DUE_DATE_DAY) {
    errors.push(`วันสุดท้ายของการชำระเงินต้องเป็นวันที่ 1-${MAX_DUE_DATE_DAY}`)
  }

  let lateFeeCents = null
  try {
    lateFeeCents = toCents(lateFeePerDay, 'ค่าปรับชำระล่าช้าต่อวัน')
  } catch (err) {
    errors.push(err.message)
  }

  // เปิดค่าปรับแต่อัตรา 0 = บันทึกไม่ได้
  if (isAutoLateFeeEnabled && lateFeeCents === 0) {
    errors.push('เปิดการเก็บค่าปรับแล้ว กรุณากรอกค่าปรับต่อวันให้มากกว่า 0 บาท')
  }

  // ไม่ส่งมา = ใช้ของเดิม
  if (meterDigits !== undefined && meterDigits !== null && meterDigits !== '') {
    const digits = Number(meterDigits)
    if (!Number.isInteger(digits) || digits < MIN_METER_DIGITS || digits > MAX_METER_DIGITS) {
      errors.push(`จำนวนหลักของมิเตอร์ต้องอยู่ระหว่าง ${MIN_METER_DIGITS}-${MAX_METER_DIGITS} หลัก`)
    }
  }

  if (vatRate !== undefined && vatRate !== null && vatRate !== '') {
    const rate = Number(vatRate)
    if (!Number.isFinite(rate) || rate < MIN_VAT_RATE || rate > MAX_VAT_RATE) {
      errors.push(`อัตรา VAT ต้องอยู่ระหว่าง ${MIN_VAT_RATE}-${MAX_VAT_RATE}%`)
    } else if (!/^\d+(\.\d{1,2})?$/.test(String(vatRate).trim())) {
      // ตรวจทศนิยมจากข้อความ — r*100 ด้วย float ไม่แม่น
      errors.push('อัตรา VAT ใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
    }
  }

  // เปิด VAT แต่อัตรา 0 = บันทึกไม่ได้
  if (isVatEnabled && Number(vatRate) === 0) {
    errors.push('เปิดการใช้งาน VAT แล้ว กรุณากรอกอัตรา VAT ให้มากกว่า 0%')
  }

  return errors
}

// ห้ามเป็น NaN หรือ 0 — ใช้เป็นตัวหาร
function normalizeMeterDigits(value) {
  const digits = Math.floor(Number(value))
  if (!Number.isInteger(digits) || digits < MIN_METER_DIGITS || digits > MAX_METER_DIGITS) {
    return DEFAULT_METER_DIGITS
  }
  return digits
}

// ค่าพังหรือไม่ส่งมา ใช้ 7
function normalizeVatRate(value) {
  // ว่าง = ไม่ได้แก้ (ไม่ใช่ 0)
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_VAT_RATE
  }
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < MIN_VAT_RATE || rate > MAX_VAT_RATE) {
    return DEFAULT_VAT_RATE
  }
  // SQLite ไม่บังคับ DECIMAL(5,2) — ปัดเองที่นี่
  return Math.round(rate * 100) / 100
}

function toRow(input) {
  const optional = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  return {
    nameTh: String(input.nameTh).trim(),
    nameEn: optional(input.nameEn),
    addressTh: String(input.addressTh).trim(),
    addressEn: optional(input.addressEn),
    phone: optional(input.phone),
    logoUrl: optional(input.logoUrl),
    dueDateDay: Number(input.dueDateDay),
    lateFeePerDayCents: toCents(input.lateFeePerDay, 'ค่าปรับชำระล่าช้าต่อวัน'),
    isAutoLateFeeEnabled: input.isAutoLateFeeEnabled ? 1 : 0,
    lateFeeGraceDays: Math.max(0, Math.floor(Number(input.lateFeeGraceDays) || 0)),
    isVatEnabled: input.isVatEnabled ? 1 : 0,
    vatRate: normalizeVatRate(input.vatRate),
    meterDigits: normalizeMeterDigits(input.meterDigits)
  }
}

// ใช้ subquery ให้หอที่ยังไม่มีห้องขึ้นในรายการด้วย
const LIST_SQL = `
  SELECT
    a.*,
    (SELECT COUNT(*)
       FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
      WHERE f.apartment_id = a.apartment_id) AS total_rooms,
    (SELECT COUNT(*)
       FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
      WHERE f.apartment_id = a.apartment_id AND r.status = 'vacant') AS vacant_rooms
  FROM apartments a
  ORDER BY a.display_order ASC, a.apartment_id ASC
`

export function listApartments(db) {
  return db.prepare(LIST_SQL).all().map(toPublicApartment)
}

export function getApartmentById(db, apartmentId) {
  const row = db.prepare('SELECT * FROM apartments WHERE apartment_id = ?').get(apartmentId)
  return row ? toPublicApartment(row) : null
}

export function countApartments(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM apartments').get().n
}

// ไม่ทับเวลาเดิม — เก็บเวลาที่ตั้งค่าเสร็จครั้งแรก
export function markSetupCompleted(db, apartmentId) {
  const result = db
    .prepare(
      `UPDATE apartments SET setup_completed_at = ?
        WHERE apartment_id = ? AND setup_completed_at IS NULL`
    )
    .run(new Date().toISOString(), apartmentId)

  if (result.changes === 0 && !getApartmentById(db, apartmentId)) {
    throw new Error('ไม่พบหอพักที่ต้องการ')
  }
  return getApartmentById(db, apartmentId)
}

export function insertApartment(db, input) {
  const row = toRow(input)
  const now = new Date().toISOString()

  const nextOrder =
    (db.prepare('SELECT MAX(display_order) AS m FROM apartments').get().m ?? 0) + 1

  const result = db
    .prepare(
      `INSERT INTO apartments (
         logo_url, name_th, name_en, address_th, address_en, phone,
         late_fee_per_day_cents, is_auto_late_fee_enabled, late_fee_grace_days,
         due_date_day, is_vat_enabled, vat_rate, meter_digits,
         default_rent_item_text, display_order, created_at
       ) VALUES (
         @logoUrl, @nameTh, @nameEn, @addressTh, @addressEn, @phone,
         @lateFeePerDayCents, @isAutoLateFeeEnabled, @lateFeeGraceDays,
         @dueDateDay, @isVatEnabled, @vatRate, @meterDigits,
         @rentItemText, @displayOrder, @now
       )`
    )
    // เขียนเอง ไม่พึ่ง DEFAULT ของคอลัมน์ (ยังเป็นข้อความเก่า)
    .run({ ...row, rentItemText: DEFAULT_RENT_ITEM_TEXT, displayOrder: nextOrder, now })

  return getApartmentById(db, result.lastInsertRowid)
}

export function updateApartment(db, apartmentId, input) {
  const row = toRow(input)

  const result = db
    .prepare(
      `UPDATE apartments SET
         logo_url = @logoUrl,
         name_th = @nameTh,
         name_en = @nameEn,
         address_th = @addressTh,
         address_en = @addressEn,
         phone = @phone,
         late_fee_per_day_cents = @lateFeePerDayCents,
         is_auto_late_fee_enabled = @isAutoLateFeeEnabled,
         late_fee_grace_days = @lateFeeGraceDays,
         due_date_day = @dueDateDay,
         is_vat_enabled = @isVatEnabled,
         vat_rate = @vatRate,
         meter_digits = @meterDigits,
         updated_at = @now
       WHERE apartment_id = @apartmentId`
    )
    .run({ ...row, apartmentId, now: new Date().toISOString() })

  if (result.changes === 0) throw new Error('ไม่พบหอพักที่ต้องการแก้ไข')
  return getApartmentById(db, apartmentId)
}

export function reorderApartments(db, orderedIds) {
  const stmt = db.prepare('UPDATE apartments SET display_order = ? WHERE apartment_id = ?')
  const run = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index + 1, id))
  })
  run(orderedIds)
  return listApartments(db)
}

// ลบได้เฉพาะหอที่ไม่มีชั้น/ห้อง/ผู้ใช้ผูกอยู่
export function deleteApartment(db, apartmentId) {
  const floors = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?')
    .get(apartmentId).n
  if (floors > 0) {
    throw new Error('ลบไม่ได้ เพราะหอพักนี้มีชั้น/ห้องพักอยู่แล้ว กรุณาลบห้องและชั้นก่อน')
  }

  const run = db.transaction(() => {
    // ทุกตารางที่มี apartment_id ต้องอยู่ในรายการนี้ ไม่งั้น FK บล็อก
    db.prepare('DELETE FROM apartment_utility_defaults WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_services WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_bank_accounts WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM users_apartments WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM document_counters WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM invoice_deletions WHERE apartment_id = ?').run(apartmentId)
    db.prepare(
      `DELETE FROM meter_readings
        WHERE meter_batch_id IN (SELECT batch_id FROM meter_batches WHERE apartment_id = ?)`
    ).run(apartmentId)
    db.prepare('DELETE FROM meter_batches WHERE apartment_id = ?').run(apartmentId)
    const result = db.prepare('DELETE FROM apartments WHERE apartment_id = ?').run(apartmentId)
    deleteOrphanImages(db)
    if (result.changes === 0) throw new Error('ไม่พบหอพักที่ต้องการลบ')
  })
  run()
  return { ok: true }
}

export function validateDepositPolicyInput({ policy, noticeDays, minStayMonths }) {
  const errors = []

  if (!DEPOSIT_REFUND_POLICIES.includes(policy)) {
    errors.push('กรุณาเลือกนโยบายคืนเงินประกัน')
  }

  const days = Number(noticeDays)
  if (!Number.isInteger(days) || days < 0) {
    errors.push('จำนวนวันที่ต้องแจ้งล่วงหน้าต้องเป็นจำนวนเต็มไม่ติดลบ')
  } else if (days > MAX_DEPOSIT_NOTICE_DAYS) {
    errors.push(`จำนวนวันที่ต้องแจ้งล่วงหน้าต้องไม่เกิน ${MAX_DEPOSIT_NOTICE_DAYS} วัน`)
  }

  // ว่าง = ใช้ระยะสัญญาของแต่ละใบ
  if (minStayMonths !== null && minStayMonths !== undefined && String(minStayMonths).trim() !== '') {
    const months = Number(minStayMonths)
    if (!Number.isInteger(months) || months < 1) {
      errors.push('เดือนขั้นต่ำที่ต้องอยู่ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
    } else if (months > MAX_DEPOSIT_MIN_STAY_MONTHS) {
      errors.push(`เดือนขั้นต่ำที่ต้องอยู่ต้องไม่เกิน ${MAX_DEPOSIT_MIN_STAY_MONTHS} เดือน`)
    }
  }

  return errors
}

export function getDepositPolicy(db, apartmentId) {
  const row = db
    .prepare(
      `SELECT default_deposit_refund_policy AS policy,
              default_deposit_notice_days AS noticeDays,
              default_deposit_min_stay_months AS minStayMonths
         FROM apartments WHERE apartment_id = ?`
    )
    .get(apartmentId)
  if (!row) throw new Error('ไม่พบหอพัก')

  return {
    policy: row.policy,
    policyLabel: DEPOSIT_REFUND_POLICY_LABELS[row.policy] ?? row.policy,
    noticeDays: row.noticeDays,
    minStayMonths: row.minStayMonths,
    activeContractCount: db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM contracts c
           JOIN rooms r  ON r.room_id = c.room_id
           JOIN floors f ON f.floor_id = r.floor_id
          WHERE f.apartment_id = ? AND c.status = 'active'`
      )
      .get(apartmentId).n
  }
}

export function saveDepositPolicy(db, apartmentId, { policy, noticeDays, minStayMonths } = {}) {
  const errors = validateDepositPolicyInput({ policy, noticeDays, minStayMonths })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const result = db
    .prepare(
      `UPDATE apartments
          SET default_deposit_refund_policy = @policy,
              default_deposit_notice_days = @noticeDays,
              default_deposit_min_stay_months = @minStayMonths,
              updated_at = @now
        WHERE apartment_id = @apartmentId`
    )
    .run({
      apartmentId,
      policy,
      noticeDays: Number(noticeDays),
      minStayMonths:
        minStayMonths === null || minStayMonths === undefined || String(minStayMonths).trim() === ''
          ? null
          : Number(minStayMonths),
      now: new Date().toISOString()
    })
  if (result.changes === 0) throw new Error('ไม่พบหอพัก')

  return getDepositPolicy(db, apartmentId)
}

export function toPublicApartment(row) {
  if (!row) return null
  return {
    apartmentId: row.apartment_id,
    logoUrl: row.logo_url,
    nameTh: row.name_th,
    nameEn: row.name_en,
    addressTh: row.address_th,
    addressEn: row.address_en,
    phone: row.phone,
    lateFeePerDayCents: row.late_fee_per_day_cents,
    isAutoLateFeeEnabled: row.is_auto_late_fee_enabled === 1,
    lateFeeGraceDays: row.late_fee_grace_days ?? 0,
    dueDateDay: row.due_date_day,
    isVatEnabled: row.is_vat_enabled === 1,
    vatRate: normalizeVatRate(row.vat_rate),
    meterDigits: normalizeMeterDigits(row.meter_digits),
    displayOrder: row.display_order,
    setupCompletedAt: row.setup_completed_at ?? null,
    isSetupComplete: Boolean(row.setup_completed_at),
    totalRooms: row.total_rooms,
    vacantRooms: row.vacant_rooms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
