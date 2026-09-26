// ค่าตั้งต้นของหอ — คัดลอกลงห้องตอนสร้างห้อง แก้ทีหลังไม่ย้อนไปทับห้องเดิม
import { errorList } from '../fieldError.js'
import { centsToBaht, toCents } from '../money.js'

// ต้องตรงกับค่าใน room_utility_settings (คัดลอกข้ามตารางกัน)
export const BILLING_TYPES = ['actual', 'minimum', 'flat']

export const BILLING_TYPE_LABELS = {
  actual: 'ตามมิเตอร์ที่ใช้จริง',
  minimum: 'ตามมิเตอร์แบบมีขั้นต่ำ',
  flat: 'เหมาจ่ายรายเดือน'
}

function validateSide(input, label, errors) {
  if (!input.enabled) return

  // ไม่ส่ง billingType = แค่สลับสวิตช์ ไม่ต้องตรวจราคา
  if (input.billingType === undefined) return

  if (!BILLING_TYPES.includes(input.billingType)) {
    errors.add('billingType', `กรุณาเลือกประเภทการคิด${label}`)
    return
  }

  if (input.billingType === 'actual' || input.billingType === 'minimum') {
    try {
      toCents(input.unitPrice, `ราคา${label}ต่อหน่วย`)
    } catch (err) {
      errors.add('unitPrice', err.message)
    }
  }

  if (input.billingType === 'minimum') {
    try {
      toCents(input.minCharge, `ขั้นต่ำเรียกเก็บ${label}`)
    } catch (err) {
      errors.add('minCharge', err.message)
    }
  }

  if (input.billingType === 'flat') {
    try {
      toCents(input.flatRate, `ค่า${label}เหมาจ่าย`)
    } catch (err) {
      errors.add('flatRate', err.message)
    }
  }
}

// รับทั้งก้อนเต็มหรือบางฝั่ง — ฝั่งที่ไม่ส่งมาคือไม่ได้แก้
export function validateUtilityInput(input) {
  const errors = errorList()
  if (input?.water) validateSide(input.water, 'ค่าน้ำ', errors)
  if (input?.electric) validateSide(input.electric, 'ค่าไฟ', errors)
  return errors
}

// ช่องที่โหมดนี้ไม่ใช้เก็บเป็น 0
function sideToRow(input) {
  const enabled = Boolean(input?.enabled)
  const type = enabled && BILLING_TYPES.includes(input.billingType) ? input.billingType : 'actual'
  const money = (value) => {
    try {
      return toCents(value, 'ราคา')
    } catch {
      return 0
    }
  }

  return {
    enabled: enabled ? 1 : 0,
    billingType: type,
    unitPrice: enabled && (type === 'actual' || type === 'minimum') ? money(input.unitPrice) : 0,
    minCharge: enabled && type === 'minimum' ? money(input.minCharge) : 0,
    flatRate: enabled && type === 'flat' ? money(input.flatRate) : 0,
    showReading: input?.showReadingInInvoice ? 1 : 0
  }
}

// หอที่ยังไม่ตั้งค่า คืนค่าเริ่มต้นแทน null
export function getUtilityDefaults(db, apartmentId) {
  const row = db
    .prepare('SELECT * FROM apartment_utility_defaults WHERE apartment_id = ?')
    .get(apartmentId)

  if (!row) {
    return {
      apartmentId,
      isConfigured: false,
      water: emptySide(),
      electric: emptySide()
    }
  }
  return toPublicDefaults(row)
}

function emptySide() {
  return {
    enabled: true,
    billingType: 'actual',
    unitPriceCents: 0,
    minChargeCents: 0,
    flatRateCents: 0,
    showReadingInInvoice: true
  }
}

// ของที่เก็บเป็นสตางค์ ของจากฟอร์มเป็นบาท — แปลงก่อนผสม
function mergeSide(stored, patch) {
  const base = {
    enabled: stored.enabled,
    billingType: stored.billingType,
    unitPrice: centsToBaht(stored.unitPriceCents),
    minCharge: centsToBaht(stored.minChargeCents),
    flatRate: centsToBaht(stored.flatRateCents),
    showReadingInInvoice: stored.showReadingInInvoice
  }
  if (!patch) return base

  const merged = { ...base }
  for (const key of Object.keys(base)) {
    if (patch[key] !== undefined) merged[key] = patch[key]
  }
  return merged
}

export function saveUtilityDefaults(db, apartmentId, input) {
  // merge กับของเดิมก่อน ไม่งั้นอีกฝั่งถูกล้างเป็น 0
  const current = getUtilityDefaults(db, apartmentId)
  const water = sideToRow(mergeSide(current.water, input?.water))
  const electric = sideToRow(mergeSide(current.electric, input?.electric))
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO apartment_utility_defaults (
       apartment_id,
       is_water_enabled, water_billing_type, water_unit_price_cents,
       water_min_charge_cents, water_flat_rate_cents, show_water_reading_in_invoice,
       is_electric_enabled, electric_billing_type, electric_unit_price_cents,
       electric_min_charge_cents, electric_flat_rate_cents, show_electric_reading_in_invoice,
       created_at
     ) VALUES (
       @apartmentId,
       @waterEnabled, @waterType, @waterUnitPrice,
       @waterMinCharge, @waterFlatRate, @waterShowReading,
       @electricEnabled, @electricType, @electricUnitPrice,
       @electricMinCharge, @electricFlatRate, @electricShowReading,
       @now
     )
     ON CONFLICT (apartment_id) DO UPDATE SET
       is_water_enabled = @waterEnabled,
       water_billing_type = @waterType,
       water_unit_price_cents = @waterUnitPrice,
       water_min_charge_cents = @waterMinCharge,
       water_flat_rate_cents = @waterFlatRate,
       show_water_reading_in_invoice = @waterShowReading,
       is_electric_enabled = @electricEnabled,
       electric_billing_type = @electricType,
       electric_unit_price_cents = @electricUnitPrice,
       electric_min_charge_cents = @electricMinCharge,
       electric_flat_rate_cents = @electricFlatRate,
       show_electric_reading_in_invoice = @electricShowReading,
       updated_at = @now`
  ).run({
    apartmentId,
    waterEnabled: water.enabled,
    waterType: water.billingType,
    waterUnitPrice: water.unitPrice,
    waterMinCharge: water.minCharge,
    waterFlatRate: water.flatRate,
    waterShowReading: water.showReading,
    electricEnabled: electric.enabled,
    electricType: electric.billingType,
    electricUnitPrice: electric.unitPrice,
    electricMinCharge: electric.minCharge,
    electricFlatRate: electric.flatRate,
    electricShowReading: electric.showReading,
    now
  })

  return getUtilityDefaults(db, apartmentId)
}

// เจ้าของสั่งเอง: ทับราคาน้ำ-ไฟของทุกห้องด้วยราคาปัจจุบันของหอ
export function applyDefaultsToRooms(db, apartmentId) {
  const defaults = getUtilityDefaults(db, apartmentId)
  if (!defaults.isConfigured) {
    throw new Error('หอพักนี้ยังไม่ได้ตั้งค่าการคิดค่าน้ำ-ค่าไฟ กรุณาบันทึกค่าก่อน')
  }

  const now = new Date().toISOString()
  const run = db.transaction(() =>
    db
      .prepare(
        `UPDATE room_utility_settings SET
           is_water_enabled = @waterEnabled,
           water_billing_type = @waterType,
           water_unit_price_cents = @waterUnitPrice,
           water_min_charge_cents = @waterMinCharge,
           water_flat_rate_cents = @waterFlatRate,
           show_water_reading_in_invoice = @waterShowReading,
           is_electric_enabled = @electricEnabled,
           electric_billing_type = @electricType,
           electric_unit_price_cents = @electricUnitPrice,
           electric_min_charge_cents = @electricMinCharge,
           electric_flat_rate_cents = @electricFlatRate,
           show_electric_reading_in_invoice = @electricShowReading,
           updated_at = @now
         WHERE room_id IN (
           SELECT r.room_id FROM rooms r
             JOIN floors f ON f.floor_id = r.floor_id
            WHERE f.apartment_id = @apartmentId
         )`
      )
      .run({
        apartmentId,
        waterEnabled: defaults.water.enabled ? 1 : 0,
        waterType: defaults.water.billingType,
        waterUnitPrice: defaults.water.unitPriceCents,
        waterMinCharge: defaults.water.minChargeCents,
        waterFlatRate: defaults.water.flatRateCents,
        waterShowReading: defaults.water.showReadingInInvoice ? 1 : 0,
        electricEnabled: defaults.electric.enabled ? 1 : 0,
        electricType: defaults.electric.billingType,
        electricUnitPrice: defaults.electric.unitPriceCents,
        electricMinCharge: defaults.electric.minChargeCents,
        electricFlatRate: defaults.electric.flatRateCents,
        electricShowReading: defaults.electric.showReadingInInvoice ? 1 : 0,
        now
      }).changes
  )

  return { updatedRooms: run() }
}

// เปิดเก็บแต่ราคาเป็น 0 = ยังไม่เคยตั้งค่า
export function isSideUnpriced(side) {
  return (
    side.enabled &&
    side.unitPriceCents === 0 &&
    side.minChargeCents === 0 &&
    side.flatRateCents === 0
  )
}

// สูตรคิดเงินที่เดียว ใช้ทั้งค่าของหอและรายห้อง
export function calculateUtilityCharge(side, unitsUsed) {
  if (!side.enabled) return 0

  const units = Number(unitsUsed ?? 0)
  if (units < 0) throw new Error('จำนวนหน่วยที่ใช้ติดลบไม่ได้')

  switch (side.billingType) {
    case 'flat':
      return side.flatRateCents

    case 'minimum':
      // ขั้นต่ำเป็นบาท ไม่ใช่หน่วย
      return Math.max(Math.round(units * side.unitPriceCents), side.minChargeCents)

    case 'actual':
    default:
      return Math.round(units * side.unitPriceCents)
  }
}

// ใช้ได้ทั้งสองตาราง — ชื่อคอลัมน์ตรงกัน
export function toUtilitySides(row) {
  return {
    water: {
      enabled: row.is_water_enabled === 1,
      billingType: row.water_billing_type,
      unitPriceCents: row.water_unit_price_cents,
      minChargeCents: row.water_min_charge_cents,
      flatRateCents: row.water_flat_rate_cents,
      showReadingInInvoice: row.show_water_reading_in_invoice === 1
    },
    electric: {
      enabled: row.is_electric_enabled === 1,
      billingType: row.electric_billing_type,
      unitPriceCents: row.electric_unit_price_cents,
      minChargeCents: row.electric_min_charge_cents,
      flatRateCents: row.electric_flat_rate_cents,
      showReadingInInvoice: row.show_electric_reading_in_invoice === 1
    }
  }
}

export function toPublicDefaults(row) {
  if (!row) return null
  return {
    apartmentId: row.apartment_id,
    isConfigured: true,
    ...toUtilitySides(row),
    updatedAt: row.updated_at
  }
}
