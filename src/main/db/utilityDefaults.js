// ตาราง apartment_utility_defaults — วิธีคิดค่าน้ำ/ค่าไฟระดับหอ
//
// เป็น "ค่าตั้งต้น" ที่จะถูกคัดลอกลง room_utility_settings ตอนสร้างห้อง
// การแก้ที่นี่ทีหลังจะ *ไม่* ย้อนไปเปลี่ยนห้องที่สร้างไว้แล้ว โดยตั้งใจ — ไม่งั้น
// ห้องที่เจ้าของตั้งราคาพิเศษไว้จะถูกทับหายโดยไม่มีใครรู้ตัว
import { centsToBaht, toCents } from '../money.js'

// SQLite ไม่มี ENUM — เก็บเป็น TEXT แล้วตรวจค่าที่ JS ก่อนเขียนทุกครั้ง
// ค่าเหล่านี้ต้องตรงกับที่ระบุไว้ใน 001_init.sql (room_utility_settings) เป๊ะๆ
// เพราะสองตารางนี้คัดลอกค่าข้ามกัน
export const BILLING_TYPES = ['actual', 'minimum', 'flat']

export const BILLING_TYPE_LABELS = {
  actual: 'ตามมิเตอร์ที่ใช้จริง',
  minimum: 'ตามมิเตอร์แบบมีขั้นต่ำ',
  flat: 'เหมาจ่ายรายเดือน'
}

// -----------------------------------------------------
// ตรวจข้อมูล
// -----------------------------------------------------
// ตรวจทีละฝั่ง (น้ำ/ไฟ) เพราะเงื่อนไขเหมือนกันเป๊ะ ต่างแค่ชื่อที่เอาไปขึ้นข้อความ
function validateSide(input, label, errors) {
  // ปิดการคิดค่าบริการนี้ = ไม่ต้องตรวจอะไรเลย ราคาจะถูกเก็บเป็น 0
  if (!input.enabled) return

  // ไม่ได้ส่ง billingType มา = ก้อนนี้แค่สลับสวิตช์ ไม่ได้มาตั้งวิธีคิดเงิน ปล่อยผ่าน
  if (input.billingType === undefined) return

  if (!BILLING_TYPES.includes(input.billingType)) {
    errors.push(`กรุณาเลือกประเภทการคิด${label}`)
    return
  }

  // ตรวจเฉพาะช่องที่โหมดนั้นใช้จริง ช่องที่ไม่ใช้ปล่อยว่างได้ (เก็บเป็น 0)
  // ถ้าบังคับกรอกครบทุกช่องทุกโหมด ผู้ใช้จะต้องใส่เลขมั่วๆ ลงช่องที่ไม่เกี่ยว
  if (input.billingType === 'actual' || input.billingType === 'minimum') {
    try {
      toCents(input.unitPrice, `ราคา${label}ต่อหน่วย`)
    } catch (err) {
      errors.push(err.message)
    }
  }

  if (input.billingType === 'minimum') {
    try {
      toCents(input.minCharge, `ขั้นต่ำเรียกเก็บ${label}`)
    } catch (err) {
      errors.push(err.message)
    }
  }

  if (input.billingType === 'flat') {
    try {
      toCents(input.flatRate, `ค่า${label}เหมาจ่าย`)
    } catch (err) {
      errors.push(err.message)
    }
  }
}

// รับได้ทั้งก้อนเต็ม {water, electric} และก้อนบางส่วน {water} — ฝั่งที่ไม่ได้ส่งมา
// แปลว่า "ไม่ได้แก้" จึงไม่ต้องตรวจ
//
// ทำไมต้องตรวจแยกฝั่ง: หน้าจอตั้งค่าน้ำกับค่าไฟทีละฝั่ง ถ้าตรวจรวมทุกครั้ง ฝั่งที่ยัง
// ไม่ได้กรอกราคาจะโยน error ออกมาบล็อกฝั่งที่กำลังกรอกอยู่ กลายเป็น "ระบุอะไรไม่ได้เลย"
//
// และตรวจ "ราคา" เฉพาะตอนที่ผู้เรียกส่ง billingType มาด้วย = เจตนามาตั้งวิธีคิดเงินจริงๆ
// ส่วนการสลับสวิตช์เปิด/ปิด ส่งมาแค่ enabled จึงบันทึกได้โดยไม่ต้องมีราคาก่อน
// (ต้นแบบก็เปิดสวิตช์ได้ก่อนแล้วค่อยกดเข้าไประบุราคาทีหลัง)
export function validateUtilityInput(input) {
  const errors = []
  if (input?.water) validateSide(input.water, 'ค่าน้ำ', errors)
  if (input?.electric) validateSide(input.electric, 'ค่าไฟ', errors)
  return errors
}

// แปลงค่าจากฟอร์มเป็นตัวเลขที่พร้อมเขียน — ช่องที่โหมดปัจจุบันไม่ใช้จะถูกเก็บเป็น 0
// ไม่ใช่เก็บค่าเก่าค้างไว้ เพราะถ้าเก็บค้าง แล้ววันหนึ่งสลับโหมดกลับมา จะได้ราคาเก่า
// ที่ลืมไปแล้วโผล่มาใช้งานเงียบๆ
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

// -----------------------------------------------------
// อ่าน / เขียน
// -----------------------------------------------------
// หอที่ยังไม่เคยตั้งค่าจะไม่มีแถวในตารางนี้ — คืนค่าเริ่มต้นกลับไปแทน null
// เพื่อให้หน้าจอมีอะไรให้แสดงเสมอ ไม่ต้องเขียนเงื่อนไข "ยังไม่มีข้อมูล" ซ้ำทุกที่
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

// รวมค่าที่ส่งมาใหม่ทับค่าที่เก็บอยู่ — คืนรูปแบบ "ฟอร์ม" (ราคาเป็นข้อความบาท)
// ให้ sideToRow เอาไปแปลงเป็นสตางค์ต่อ
//
// ค่าที่เก็บอยู่เป็น *Cents ส่วนค่าที่ส่งมาจากฟอร์มเป็นบาท จึงต้องแปลงกลับก่อนผสม
// ไม่งั้นราคา 18 บาทที่เก็บเป็น 1800 จะถูกอ่านเป็น 1800 บาทในรอบบันทึกถัดไป
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

// UPSERT — หอหนึ่งมีได้แถวเดียว (apartment_id UNIQUE)
// ใช้ ON CONFLICT แทนการ SELECT แล้วค่อยตัดสินใจ INSERT/UPDATE เพราะสั้นกว่า
// และไม่มีช่องว่างระหว่างสองคำสั่งให้เกิดแถวซ้ำได้
export function saveUtilityDefaults(db, apartmentId, input) {
  // ก้อนที่ส่งมาเป็น "เฉพาะสิ่งที่แก้" ได้ ฝั่งไหน/ช่องไหนไม่ได้ส่งมาให้ใช้ของเดิมต่อ
  // ถ้าไม่ merge ก่อน การกดสวิตช์ฝั่งเดียวจะล้างราคาของอีกฝั่งเป็น 0 ทันที
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

// -----------------------------------------------------
// การคิดเงินจริง — ใช้ได้ทั้งค่าตั้งต้นของหอและค่ารายห้อง เพราะรูปร่างเหมือนกัน
// -----------------------------------------------------
// แยกออกมาเป็นฟังก์ชันบริสุทธิ์ตัวเดียวโดยตั้งใจ เพื่อให้ตอนออกบิลจริง (Phase 3)
// ใช้ตัวนี้ตัวเดียวกัน ไม่ใช่ไปเขียนสูตรซ้ำอีกรอบแล้วสองที่คำนวณไม่ตรงกัน
export function calculateUtilityCharge(side, unitsUsed) {
  if (!side.enabled) return 0

  const units = Number(unitsUsed ?? 0)
  if (units < 0) throw new Error('จำนวนหน่วยที่ใช้ติดลบไม่ได้')

  switch (side.billingType) {
    case 'flat':
      // เหมาจ่าย: ใช้เท่าไหร่ก็จ่ายเท่านี้ ไม่สนมิเตอร์
      return side.flatRateCents

    case 'minimum':
      // ขั้นต่ำเป็น "บาท" ไม่ใช่จำนวนหน่วย — ใช้น้อยกว่าขั้นต่ำก็จ่ายเท่าขั้นต่ำ
      return Math.max(Math.round(units * side.unitPriceCents), side.minChargeCents)

    case 'actual':
    default:
      // ปัดเป็นจำนวนเต็มสตางค์ เพราะหน่วยที่ใช้เป็นทศนิยมได้ (มิเตอร์อ่านได้ .5 หน่วย)
      return Math.round(units * side.unitPriceCents)
  }
}

// -----------------------------------------------------
// แปลงแถวดิบเป็นก้อน {water, electric} ที่ calculateUtilityCharge กินได้
//
// ใช้ได้ทั้งกับ apartment_utility_defaults และ room_utility_settings เพราะสองตารางนี้
// ตั้งใจให้มีคอลัมน์ชื่อเดียวกันทุกช่อง (ต่างแค่ apartment_id / room_id — ดู 006)
// ตอนออกบิลต้องอ่านของ *รายห้อง* จึงต้องมีตัวแปลงที่ไม่ผูกกับตารางใดตารางหนึ่ง
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
