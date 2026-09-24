// ตาราง apartments — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// รับ `db` เป็นพารามิเตอร์ตัวแรกเสมอเหมือน db/users.js เพื่อให้ชุดทดสอบเปิดฐานข้อมูล
// ชั่วคราวของตัวเองได้
import { toCents } from '../money.js'
import { deleteOrphanImages } from './images.js'

// วันครบกำหนดชำระเลือกได้ถึงวันที่ 28 เท่านั้น (ต้นแบบก็ทำแบบนี้) — ไม่ใช่ 31
// เพราะถ้าเจ้าของตั้งวันที่ 31 ไว้ เดือนกุมภาพันธ์กับเดือนที่มี 30 วันจะไม่มีวันนั้นอยู่จริง
// แล้วระบบต้องมาเดาว่าจะเลื่อนไปวันไหน ซึ่งเดาผิดทีเดียวคือคิดค่าปรับผิดทั้งหอ
export const MAX_DUE_DATE_DAY = 28

// ข้อความบรรทัดค่าเช่าบนใบแจ้งหนี้ของหอที่เพิ่งสร้าง — ไทยล้วน ไม่มีอังกฤษพ่วง
// เจ้าของหอแก้เป็นข้อความของตัวเองได้ที่หน้าตั้งค่าหอ
export const DEFAULT_RENT_ITEM_TEXT = 'ค่าเช่าห้อง'

// จำนวนหลักของหน้าปัดมิเตอร์ — เจ้าของหอยืนยัน 2026-08-10 ว่าเป็น 5 หลัก
// ใช้ 2 อย่าง: หาจุดหมุนกลับตอนมิเตอร์วนรอบ และกันเลขที่กรอกเกินหน้าปัด
//
// ขอบเขตกว้างไว้เผื่อมิเตอร์แบบอื่น แต่ 3 หลักก็แทบไม่มีแล้ว และเกิน 8 หลักคือกรอกผิด
export const MIN_METER_DIGITS = 3
export const MAX_METER_DIGITS = 8
export const DEFAULT_METER_DIGITS = 5

// -----------------------------------------------------
// อัตรา VAT
// -----------------------------------------------------
// **ค่านี้คืออัตราของหอ "ตอนนี้" ใช้กับบิลที่ออกใหม่เท่านั้น** (ดู migration 031)
//
// บิลที่ออกไปแล้วเก็บอัตราของตัวเองไว้ที่ invoices.vat_rate และใช้ค่านั้นตลอดไป
// เจ้าของหอยืนยันว่าบิลที่ยื่นให้ผู้เช่าแล้วต้องคง VAT เดิม ต่อให้มาจ่ายช้าแล้วโดนค่าปรับ
// — อัตราใหม่มีผลกับรอบบิลถัดไปเท่านั้น
//
// ไทยใช้ 7% มาตลอด (เคยเป็น 10%) รับทศนิยมไว้เพราะคอลัมน์เป็น DECIMAL(5,2) อยู่แล้ว
// และไม่มีเหตุผลที่จะบังคับให้เป็นจำนวนเต็ม
export const MIN_VAT_RATE = 0
export const MAX_VAT_RATE = 100
export const DEFAULT_VAT_RATE = 7

// -----------------------------------------------------
// นโยบายคืนเงินประกัน (ค่าตั้งต้นของหอ)
// -----------------------------------------------------
// **ค่าเหล่านี้ถูกสำเนาลงสัญญาแต่ละใบตอนทำสัญญา ไม่ได้อ่านสดตอนย้ายออก** (ดู 004)
// เปลี่ยนที่นี่จึงมีผลกับ "สัญญาใบใหม่" เท่านั้น สัญญาที่เซ็นไปแล้วยังใช้กฎที่ตกลงกันวันนั้น
// — ถ้าอ่านสดตอนคำนวณ ผู้เช่าที่เซ็นตอนแจ้ง 15 วันจะโดนกฎ 60 วันย้อนหลัง ซึ่งเป็นข้อพิพาทจริง
export const DEPOSIT_REFUND_POLICIES = ['on_full_term', 'always', 'never']

export const DEPOSIT_REFUND_POLICY_LABELS = {
  on_full_term: 'คืนเมื่ออยู่ครบตามสัญญา',
  always: 'คืนเสมอ',
  never: 'ไม่คืนเงินประกัน'
}

// แจ้งล่วงหน้าได้มากสุด 1 ปี — เกินจากนี้คือกรอกผิดหลัก (พิมพ์ 150 แทน 15)
// ปล่อยผ่านแล้วผู้เช่าทุกคนจะถูกริบเงินประกันโดยไม่มีใครรู้ว่าทำไม
export const MAX_DEPOSIT_NOTICE_DAYS = 365

// อยู่ครบขั้นต่ำได้มากสุด 60 เดือน (5 ปี) ด้วยเหตุผลเดียวกัน
export const MAX_DEPOSIT_MIN_STAY_MONTHS = 60

// -----------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// -----------------------------------------------------
// คืนข้อผิดพลาดทั้งหมดพร้อมกัน ไม่ใช่ throw ตัวแรกที่เจอ (เหมือน validateUserInput)
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

  // ค่าปรับเป็น 0 ได้ (หอที่ไม่คิดค่าปรับ) แต่ต้องกรอก ไม่ใช่เว้นว่าง
  let lateFeeCents = null
  try {
    lateFeeCents = toCents(lateFeePerDay, 'ค่าปรับชำระล่าช้าต่อวัน')
  } catch (err) {
    errors.push(err.message)
  }

  // เปิดสวิตช์เก็บค่าปรับแต่ตั้งอัตราไว้ 0 = สถานะที่เป็นไปไม่ได้ ต้องกันตั้งแต่ตอนบันทึก
  //
  // เคยปล่อยผ่านแล้วเจอจริง: เจ้าของหอติ๊ก "ต้องการ" ไว้ แต่ช่องค่าปรับยังเป็น 0.00
  // ระบบจึงไม่เคยคิดค่าปรับให้เลย และไม่มีอะไรบอกว่าทำไม — ดูเหมือนฟีเจอร์เสีย
  if (isAutoLateFeeEnabled && lateFeeCents === 0) {
    errors.push('เปิดการเก็บค่าปรับแล้ว กรุณากรอกค่าปรับต่อวันให้มากกว่า 0 บาท')
  }

  // ไม่ส่งมา = ไม่ได้มาแก้ช่องนี้ ใช้ของเดิม/ค่าเริ่มต้นต่อ
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
      // **ตรวจจากข้อความ ไม่ใช่จากการคูณ 100** — `Math.round(r*100) !== r*100` ใช้ไม่ได้
      // เพราะเลขทศนิยมฐานสอง: 8.2*100 = 819.9999999999999 · 2.3*100 = 229.99999999999997
      // อัตราที่ถูกต้องอย่าง 8.2 / 2.3 / 16.4 จะถูกปฏิเสธ ขณะที่ 7 / 7.1 / 10 ผ่าน
      // — บั๊กที่ลองเล่นด้วยเลขที่คุ้นเคยแล้วไม่มีวันเจอ
      //
      // ปัดให้เหลือ 2 ตำแหน่งเงียบๆ ก็ไม่ควร: ถ้าเจ้าของหอพิมพ์ 7.125 แปลว่าเข้าใจอะไรผิด
      errors.push('อัตรา VAT ใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
    }
  }

  // เปิดสวิตช์ VAT แต่ตั้งอัตราไว้ 0 = สถานะที่เป็นไปไม่ได้ กันแบบเดียวกับค่าปรับล่าช้า
  // (ถ้าปล่อยผ่าน บิลจะไม่มี VAT เลยทั้งที่ติ๊กเปิดไว้ แล้วดูเหมือนฟีเจอร์เสีย)
  if (isVatEnabled && Number(vatRate) === 0) {
    errors.push('เปิดการใช้งาน VAT แล้ว กรุณากรอกอัตรา VAT ให้มากกว่า 0%')
  }

  return errors
}

// ใช้ทั้งตอนเขียนและตอนอ่านแถวเก่าที่ยังไม่มีค่า — ตัวเลขนี้ไปคูณกับเงินในบิล
// จึงต้องไม่มีทางกลายเป็น NaN หรือ 0 ได้เลย (10 ** 0 = 1 คือจุดหมุนกลับที่พังที่สุด)
function normalizeMeterDigits(value) {
  const digits = Math.floor(Number(value))
  if (!Number.isInteger(digits) || digits < MIN_METER_DIGITS || digits > MAX_METER_DIGITS) {
    return DEFAULT_METER_DIGITS
  }
  return digits
}

// เหตุผลเดียวกับ normalizeMeterDigits — ตัวเลขนี้ไปคูณกับเงินในบิล ห้ามกลายเป็น NaN
// ไม่ส่งมา/ส่งค่าพังมา ให้ถอยไปที่ 7 ซึ่งเป็นอัตราที่ระบบใช้มาตลอดก่อนมีช่องนี้
function normalizeVatRate(value) {
  // เว้นว่าง/ไม่ส่งมา = "ไม่ได้มาแก้ช่องนี้" ไม่ใช่ "ตั้งเป็น 0"
  // (Number('') กับ Number(null) ได้ 0 ซึ่งผ่านช่วง 0-100 แล้วเก็บ 0 ลงไปเงียบๆ)
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_VAT_RATE
  }
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < MIN_VAT_RATE || rate > MAX_VAT_RATE) {
    return DEFAULT_VAT_RATE
  }
  // ตัดให้เหลือ 2 ตำแหน่งเอง — SQLite ไม่ได้บังคับความกว้างของ DECIMAL(5,2) ให้
  // (NUMERIC affinity เก็บ 7.125 ไว้ตรงๆ ไม่ปัด) ตัวที่การันตี 2 ตำแหน่งคือบรรทัดนี้
  return Math.round(rate * 100) / 100
}

// แปลงค่าจากฟอร์มเป็นรูปที่พร้อมเขียนลงตาราง ใช้ร่วมกันทั้งตอนสร้างและตอนแก้ไข
// เก็บช่องที่ไม่บังคับเป็น NULL เมื่อเว้นว่าง ไม่เก็บสตริงว่าง จะได้แยกออกว่า
// "ยังไม่ได้กรอก" ต่างจาก "กรอกเป็นค่าว่างโดยตั้งใจ"
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
    // ผ่อนผันกี่วันหลังวันครบกำหนดจึงเริ่มปรับ (0 = ปรับตั้งแต่วันถัดไปเลย)
    lateFeeGraceDays: Math.max(0, Math.floor(Number(input.lateFeeGraceDays) || 0)),
    isVatEnabled: input.isVatEnabled ? 1 : 0,
    vatRate: normalizeVatRate(input.vatRate),
    meterDigits: normalizeMeterDigits(input.meterDigits)
  }
}

// -----------------------------------------------------
// อ่าน
// -----------------------------------------------------
// นับห้องด้วย subquery แทน JOIN + GROUP BY เพราะหอที่ยังไม่มีชั้น/ห้องเลยต้องขึ้นในรายการ
// ด้วย (นับได้ 0) ถ้าใช้ JOIN ธรรมดาหอเปล่าจะหายไปทั้งแถว
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

// ปิดงานตั้งค่า — เรียกตอนเจ้าของหอกด "เสร็จสิ้น" ที่ขั้นสุดท้ายของตัวช่วยตั้งค่าเท่านั้น
// ก่อนหน้านั้นหอยังเข้าหน้าทำงาน (ที่มีเมนูข้าง) ไม่ได้ ดู 008_apartment_setup_completed.sql
//
// กดซ้ำได้ไม่เป็นไร แต่ไม่ทับเวลาเดิม เพราะอยากได้เวลาที่ "ตั้งค่าเสร็จครั้งแรก"
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

// -----------------------------------------------------
// เขียน
// -----------------------------------------------------
export function insertApartment(db, input) {
  const row = toRow(input)
  const now = new Date().toISOString()

  // หอใหม่ไปต่อท้ายรายการเสมอ ไม่แทรกกลาง — เจ้าของค่อยลากจัดลำดับเองทีหลัง
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
    // เขียนค่านี้เอง ไม่พึ่ง DEFAULT ของคอลัมน์ — DEFAULT ใน 001_init.sql ยังเป็น
    // 'ค่าเช่าห้อง/Rent' และ SQLite แก้ DEFAULT ของคอลัมน์ทีหลังไม่ได้ (ต้องสร้างตารางใหม่
    // ทั้งใบ ซึ่งไม่คุ้มเสี่ยงกับตารางที่มีข้อมูลจริง — ดู migration 016)
    //
    // ข้อความที่ผู้ใช้ตั้งเองจะถูกแก้ผ่าน updateApartment ตามปกติ
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

// จัดลำดับใหม่ทั้งชุดในทีเดียว (หน้าจอส่งลำดับ apartment_id ที่เรียงแล้วมาให้)
// ทำใน transaction เพราะถ้าเขียนสำเร็จครึ่งเดียว ลำดับจะซ้ำ/ข้ามและการ์ดสลับมั่ว
export function reorderApartments(db, orderedIds) {
  const stmt = db.prepare('UPDATE apartments SET display_order = ? WHERE apartment_id = ?')
  const run = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index + 1, id))
  })
  run(orderedIds)
  return listApartments(db)
}

// ลบได้เฉพาะหอที่ยังไม่มีอะไรผูกอยู่ — ห้ามลบหอที่มีชั้น/ห้อง/ผู้ใช้ที่ผูกสิทธิ์ไว้
// เพราะประวัติบิลและสัญญาทั้งหมดอ้างถึงห้องในหอนั้น ลบทิ้งแล้วรายงานย้อนหลังพัง
// (FK ช่วยกันได้ระดับหนึ่ง แต่ข้อความ error ของ SQLite ผู้ใช้อ่านไม่รู้เรื่อง)
export function deleteApartment(db, apartmentId) {
  const floors = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?')
    .get(apartmentId).n
  if (floors > 0) {
    throw new Error('ลบไม่ได้ เพราะหอพักนี้มีชั้น/ห้องพักอยู่แล้ว กรุณาลบห้องและชั้นก่อน')
  }

  const run = db.transaction(() => {
    // ตารางลูกที่ไม่มีห้องมาเกี่ยวข้อง ลบพร้อมกันได้ในธุรกรรมเดียว
    //
    // ทุกตารางที่มี apartment_id ต้องอยู่ในรายการนี้ครบ ถ้าตกไปตารางเดียว FK จะบล็อก
    // การลบแล้วโยนข้อความดิบของ SQLite ("FOREIGN KEY constraint failed") ออกไปที่หน้าจอ
    // ซึ่งเจ้าของหออ่านไม่รู้เรื่องและดูเหมือนปุ่มลบเสีย — เคยหลุด apartment_utility_defaults
    // มาแล้วครั้งหนึ่ง เพิ่มตารางใหม่ที่ผูกกับหอเมื่อไหร่ ต้องกลับมาเพิ่มที่นี่ด้วย
    db.prepare('DELETE FROM apartment_utility_defaults WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_services WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_bank_accounts WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM users_apartments WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM document_counters WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM invoice_deletions WHERE apartment_id = ?').run(apartmentId)
    // ใบจดมิเตอร์ที่ยังไม่มีห้องผูกอยู่เท่านั้นที่มาถึงตรงนี้ได้ (หอที่มีห้องถูกกันไปตั้งแต่ต้น)
    db.prepare(
      `DELETE FROM meter_readings
        WHERE meter_batch_id IN (SELECT batch_id FROM meter_batches WHERE apartment_id = ?)`
    ).run(apartmentId)
    db.prepare('DELETE FROM meter_batches WHERE apartment_id = ?').run(apartmentId)
    const result = db.prepare('DELETE FROM apartments WHERE apartment_id = ?').run(apartmentId)
    // รูป QR ของหอที่เพิ่งถูกลบกลายเป็นรูปกำพร้า เก็บกวาดในธุรกรรมเดียวกัน
    // ไม่งั้นไฟล์ฐานข้อมูลจะพกรูปที่ไม่มีใครใช้ติดไปกับไฟล์สำรองทุกครั้ง
    deleteOrphanImages(db)
    if (result.changes === 0) throw new Error('ไม่พบหอพักที่ต้องการลบ')
  })
  run()
  return { ok: true }
}

// -----------------------------------------------------
// นโยบายคืนเงินประกันของหอ
// -----------------------------------------------------
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

  // เว้นว่างได้ = ใช้ระยะสัญญาของสัญญาใบนั้นเป็นเกณฑ์ (สัญญา 12 เดือนต้องอยู่ครบ 12)
  // ซึ่งเป็นค่าที่หอนี้ใช้อยู่ ใส่ตัวเลขเมื่อหอต้องการเกณฑ์ตายตัวไม่ขึ้นกับระยะสัญญา
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
    // null = ใช้ระยะสัญญาของแต่ละใบเป็นเกณฑ์
    minStayMonths: row.minStayMonths,
    // จำนวนสัญญาที่ยัง active อยู่ — หน้าจอต้องบอกให้ชัดว่าการแก้ตรงนี้ "ไม่" กระทบใบเหล่านี้
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

// -----------------------------------------------------
// รูปแบบที่ส่งออกไปให้หน้าจอ — แปลงชื่อคอลัมน์เป็น camelCase และ 0/1 เป็น boolean
// ที่เดียวที่ฝั่งหน้าจอต้องรู้จัก ไม่ต้องไปรู้ชื่อคอลัมน์ในตาราง
// -----------------------------------------------------
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
    // อัตราปัจจุบันของหอ — บิลที่ออกไปแล้วถือของตัวเองไว้ที่ invoices.vat_rate
    vatRate: normalizeVatRate(row.vat_rate),
    meterDigits: normalizeMeterDigits(row.meter_digits),
    displayOrder: row.display_order,
    // null = ยังเดินตัวช่วยตั้งค่าไม่ครบ หน้าจอใช้ค่านี้ตัดสินว่าจะให้เข้าหน้าทำงานได้ไหม
    setupCompletedAt: row.setup_completed_at ?? null,
    isSetupComplete: Boolean(row.setup_completed_at),
    // มีเฉพาะตอนดึงจากรายการ (LIST_SQL) — หน้าฟอร์มไม่ต้องใช้
    totalRooms: row.total_rooms,
    vacantRooms: row.vacant_rooms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
