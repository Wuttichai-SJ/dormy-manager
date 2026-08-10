// ตาราง invoices / invoice_items / document_counters — SQL ดิบล้วน ไม่มี ORM
//
// นี่คือใจกลางของระบบ: เงินทุกบาทที่หอเก็บได้ผ่านไฟล์นี้
//
// โครงตามหน้าจริงของต้นแบบ (ดูคู่มือ yeeraf.com/documents/ หัวข้อ "ออกบิลรายเดือน"
// และ "บิลค้างชำระ"): ออกบิลจากใบจดมิเตอร์หนึ่งใบ → พรีวิวทุกห้อง → กดสร้างทีละห้อง
// หรือทั้งหอ → ได้ใบแจ้งหนี้ที่แก้/เพิ่ม/ลบรายการทีหลังได้
//
// ห้าม import logger.js หรืออะไรที่ลาก electron เข้ามา (เทสต์รันใต้ ELECTRON_RUN_AS_NODE)
import { toCents } from '../money.js'
import { calculateUtilityCharge, isSideUnpriced, toUtilitySides } from './utilityDefaults.js'

export const INVOICE_STATUSES = ['unpaid', 'partial_paid', 'paid', 'cancelled']

export const INVOICE_STATUS_LABELS = {
  unpaid: 'ค้างชำระ',
  partial_paid: 'ชำระบางส่วน',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก'
}

export const INVOICE_TYPES = ['monthly', 'general']

export const ITEM_TYPES = [
  'rent',
  'water',
  'electricity',
  'service',
  'discount',
  'late_fee',
  'other'
]

// ภาษีมูลค่าเพิ่มของไทย เก็บเป็นค่าคงที่ ไม่ใช่ช่องให้กรอก — ถ้าวันหนึ่งอัตราเปลี่ยน
// ต้องเปลี่ยนที่นี่ที่เดียว และบิลเก่าจะไม่ถูกคิดใหม่เพราะอัตราถูกสำเนาลงทุกบรรทัดแล้ว
export const VAT_RATE = 7

// **VAT คิดแบบ "บวกเพิ่มจากราคา" ไม่ใช่ "รวมอยู่ในราคาแล้ว"**
// ยืนยันกับบิลจริงของต้นแบบแล้ว (หัวคอลัมน์เขียน "ราคาต่อหน่วย (ก่อน VAT)" / "ยอดเงิน (รวม VAT)")
//
// **อะไรเสียภาษีบ้าง** (แก้ 2026-08-08 หลังเทียบกับบิลจริง — ของเดิมผิด):
//   ค่าเช่าห้อง       ยกเว้นเสมอ — การให้เช่าอสังหาริมทรัพย์ได้รับยกเว้น VAT ตามกฎหมายไทย
//   ค่าน้ำ / ค่าไฟ    เสียภาษี ถ้าหอเปิด VAT — เป็นการขายสินค้า/บริการ ไม่ใช่ค่าเช่า
//   ค่าบริการ         เสียภาษี ถ้าหอเปิด VAT *และ* ค่าบริการตัวนั้นติดธงไว้
//   ส่วนลด / อื่นๆ     ไม่คิดต่อ (ดู addInvoiceItem)
//
// เดิมเขียนไว้ว่าค่าน้ำ/ค่าไฟยกเว้นด้วย ซึ่งเป็นการเดาที่ผิด — ผลคือหอที่เปิด VAT แล้วมีแต่
// ค่าเช่ากับค่าน้ำค่าไฟบนบิล จะได้ฐานภาษี 0 และ VAT 0 ทั้งที่ควรเก็บ

// ------------------------------------------------------------------
// เลขที่เอกสาร
// ------------------------------------------------------------------
// I2025030018 = 'I' + YYYYMM + ลำดับ 4 หลัก (ต้นแบบเดินเลขแบบนี้)
// ใบเสร็จเป็น 'R' ใบจองเป็น 'B' แต่ละชนิดเดินเลขของตัวเองแยกกัน
//
// ต้องเรียกอยู่ในธุรกรรมเดียวกับการสร้างเอกสารเสมอ ไม่งั้นถ้าสร้างเอกสารล้มทีหลัง
// ตัวนับจะเดินไปแล้วโดยไม่มีเอกสารจริง (เลขหาย — ยอมรับได้) แต่ที่ยอมไม่ได้คือเลขซ้ำ
const DOC_PREFIXES = { invoice: 'I', receipt: 'R', booking: 'B' }

export function nextDocumentNumber(db, apartmentId, docType, dateIso) {
  const prefix = DOC_PREFIXES[docType]
  if (!prefix) throw new Error(`ชนิดเอกสารไม่ถูกต้อง: ${docType}`)

  const period = String(dateIso).slice(0, 7).replace('-', '') // 'YYYY-MM-DD' -> 'YYYYMM'
  if (!/^\d{6}$/.test(period)) throw new Error('วันที่เอกสารไม่ถูกต้อง')

  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO document_counters (apartment_id, doc_type, period, last_seq, updated_at)
     VALUES (@apartmentId, @docType, @period, 1, @now)
     ON CONFLICT (apartment_id, doc_type, period)
       DO UPDATE SET last_seq = last_seq + 1, updated_at = @now`
  ).run({ apartmentId, docType, period, now })

  const seq = db
    .prepare(
      `SELECT last_seq FROM document_counters
        WHERE apartment_id = ? AND doc_type = ? AND period = ?`
    )
    .get(apartmentId, docType, period).last_seq

  return `${prefix}${period}${String(seq).padStart(4, '0')}`
}

// ------------------------------------------------------------------
// วันครบกำหนดชำระ
// ------------------------------------------------------------------
// = วันที่ due_date_day ครั้งถัดไป *หลัง* วันที่ออกบิล
// ออกบิล 26/03 + กำหนดชำระวันที่ 5 → ครบกำหนด 05/04
// ออกบิล 01/03 + กำหนดชำระวันที่ 5 → ครบกำหนด 05/03
//
// ตั้งค่าหน้าหอจำกัด due_date_day ไว้ที่ 28 อยู่แล้ว (ยืนยันกับต้นแบบแล้ว) จึงไม่ต้อง
// กังวลเรื่องเดือนที่ไม่มีวันที่ 29-31
export function calculateDueDate(issueDate, dueDateDay) {
  const day = Number(dueDateDay)
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error('วันครบกำหนดชำระของหอพักไม่ถูกต้อง (ต้องเป็น 1-28)')
  }

  const [year, month, dayOfMonth] = String(issueDate).split('-').map(Number)
  if (!year || !month || !dayOfMonth) throw new Error('วันที่ออกบิลไม่ถูกต้อง')

  let dueYear = year
  let dueMonth = month
  if (dayOfMonth >= day) {
    dueMonth += 1
    if (dueMonth > 12) {
      dueMonth = 1
      dueYear += 1
    }
  }
  return `${dueYear}-${pad2(dueMonth)}-${pad2(day)}`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// ------------------------------------------------------------------
// เดือนที่ค่าน้ำ-ค่าไฟบนบิลเป็นของ
// ------------------------------------------------------------------
// บิลหนึ่งใบมีสองเดือนอยู่ในนั้น: **ค่าเช่าเป็นของเดือนที่กำลังจะอยู่ ส่วนค่าน้ำ-ค่าไฟ
// เป็นของเดือนที่เพิ่งผ่านไป** (ออกบิล 1 ก.พ. = ค่าเช่าเดือน ก.พ. + มิเตอร์เดือน ม.ค.)
// ผู้เช่าที่อ่านบิลจึงต้องเห็นว่าค่าน้ำเป็นของเดือนไหน ไม่งั้นจะเข้าใจว่าเป็นเดือนเดียวกับค่าเช่า
//
// คิดจาก **วันก่อนวันจดมิเตอร์** ไม่ใช่เดือนของวันจดตรงๆ — การจดมิเตอร์คือการปิดยอด
// การใช้ของเดือนที่ผ่านมา หอที่จดวันที่ 31 ม.ค. กับหอที่จดวันที่ 1 ก.พ. ปิดยอดเดือนมกราคม
// เหมือนกัน ต่างแค่ธรรมเนียม ถ้าใช้เดือนของวันจดตรงๆ หอแบบหลังจะได้เดือนกุมภาพันธ์
// ซึ่งยังไม่ได้ใช้น้ำสักหยด
//
// **ไม่ได้คิดจาก billingMonth** เพราะค่าน้ำผูกกับใบจดมิเตอร์ ไม่ได้ผูกกับเดือนค่าเช่า
// เจ้าของหอเลือกเดือนค่าเช่าเป็นอะไรก็ได้ แต่หน่วยน้ำที่จดมาเป็นของเดือนไหนก็เดือนนั้น
export function utilityMonthOf(readingDate) {
  const [year, month, day] = String(readingDate ?? '').split('-').map(Number)
  if (!year || !month || !day) return null

  // UTC เพื่อไม่ให้เขตเวลาของเครื่องดันวันข้ามไปมา
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1))
  return `${dayBefore.getUTCFullYear()}-${pad2(dayBefore.getUTCMonth() + 1)}`
}

// ------------------------------------------------------------------
// ประกอบรายการในบิล
// ------------------------------------------------------------------
// คืน "รายการที่จะลงบิล" โดยยังไม่เขียนอะไร เพื่อให้หน้าพรีวิวก่อนออกบิลกับตอนออกบิลจริง
// ใช้ตรรกะชุดเดียวกันเป๊ะ ไม่ใช่คำนวณคนละทางแล้วตัวเลขบนจอไม่ตรงกับบิลที่ออกมา
export function buildInvoiceItems(db, { contractId, billingMonth, meterBatchId }) {
  const contract = db
    .prepare(
      `SELECT c.contract_id, c.room_id, c.rent_amount_cents,
              r.room_number,
              a.apartment_id, a.is_vat_enabled, a.default_rent_item_text,
              a.show_unit_qty_in_invoice
         FROM contracts c
         JOIN rooms r  ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE c.contract_id = ?`
    )
    .get(contractId)
  if (!contract) throw new Error('ไม่พบสัญญาที่ต้องการออกบิล')

  const items = []

  // 1) ค่าเช่าห้อง — ข้อความตั้งต้นตั้งได้ที่หน้าหอ (ดู migration 016 เรื่องค่าเดิมที่มีอังกฤษพ่วง)
  const rentLabel = contract.default_rent_item_text || 'ค่าเช่าห้อง'
  items.push({
    itemType: 'rent',
    description: `${rentLabel} (เดือน ${formatDocumentMonth(billingMonth)})`,
    quantity: 1,
    unitPriceCents: contract.rent_amount_cents,
    totalAmountCents: contract.rent_amount_cents,
    // ค่าเช่าอสังหาริมทรัพย์ได้รับยกเว้น VAT เสมอ ต่อให้หอจดทะเบียน VAT ไว้
    isTaxable: false
  })

  // 2) ค่าน้ำ / ค่าไฟ — อ่านค่าที่จดไว้ในใบจดมิเตอร์ที่เลือก แล้วคิดเงินด้วย
  //    calculateUtilityCharge ซึ่งเป็นสูตรเดียวของทั้งระบบ (ห้ามเขียนสูตรซ้ำที่นี่)
  const settingsRow = db
    .prepare('SELECT * FROM room_utility_settings WHERE room_id = ?')
    .get(contract.room_id)

  if (settingsRow) {
    const sides = toUtilitySides(settingsRow)
    const reading = meterBatchId
      ? db
          .prepare(
            'SELECT * FROM meter_readings WHERE meter_batch_id = ? AND room_id = ?'
          )
          .get(meterBatchId, contract.room_id)
      : null

    // เดือนที่หน่วยน้ำ/ไฟชุดนี้เป็นของ — ไม่ได้จดมิเตอร์มาก็ไม่มีเดือนให้เขียน
    const batch = meterBatchId
      ? db.prepare('SELECT reading_date FROM meter_batches WHERE batch_id = ?').get(meterBatchId)
      : null
    const utilityMonth = batch ? utilityMonthOf(batch.reading_date) : null
    const monthTag = utilityMonth ? ` (เดือน ${formatDocumentMonth(utilityMonth)})` : ''

    // ชื่อรายการเป็นภาษาไทยล้วน — เคยเขียนคู่กับอังกฤษ ('ค่าน้ำ/water') ตามต้นแบบ
    // แต่ผู้เช่าอ่านไทยกันหมด และคอลัมน์รายการบนบิลแคบ คำอังกฤษเบียดจนอ่านยาก
    for (const [side, itemType, label] of [
      ['water', 'water', 'ค่าน้ำ'],
      ['electric', 'electricity', 'ค่าไฟ']
    ]) {
      const config = sides[side]
      if (!config.enabled) continue

      const units = reading ? Number(reading[`${side}_units_used`] ?? 0) : 0
      const previous = reading ? Number(reading[`${side}_previous_reading`] ?? 0) : 0
      const current = reading ? Number(reading[`${side}_current_reading`] ?? 0) : 0
      const charge = calculateUtilityCharge(config, units)

      // ต้นแบบเขียนบรรทัดเป็น "ค่าน้ำ/water : 98 หน่วย (2 - 100)" — เลขมิเตอร์ก่อน/หลัง
      // ซ่อนได้ด้วยสวิตช์รายห้อง เพราะหอที่คิดแบบเหมาจ่ายไม่มีเลขมิเตอร์ให้แสดง
      //
      // เดือนต่อท้ายชื่อรายการเหมือนบรรทัดค่าเช่า ('ค่าเช่าห้อง (เดือน 02-2569)') เพื่อให้
      // สองเดือนบนบิลใบเดียวกันอ่านออกว่าอันไหนเป็นของเดือนไหน
      const showReading = config.showReadingInInvoice && contract.show_unit_qty_in_invoice === 1
      const description = showReading
        ? `${label}${monthTag} : ${units} หน่วย (${previous} - ${current})`
        : `${label}${monthTag}`

      items.push({
        itemType,
        description,
        // จำนวนหน่วยเป็น quantity ก็จริง แต่ยอดเงินคือคำตอบสุดท้าย ไม่ใช่ quantity × unitPrice
        // เพราะโหมดขั้นต่ำ/เหมาจ่ายคิดคนละแบบ — เก็บยอดที่เรียกเก็บจริงลง totalAmountCents
        quantity: units,
        unitPriceCents: config.unitPriceCents,
        totalAmountCents: charge,
        // ค่าน้ำ/ค่าไฟเป็นการขายสินค้า ไม่ใช่ค่าเช่า จึงเสียภาษีเมื่อหอจดทะเบียน VAT
        isTaxable: contract.is_vat_enabled === 1,
        // ใช้จริงแต่คิดเงินไม่ได้เพราะห้องนี้ไม่เคยถูกตั้งราคา — ต้องเตือนก่อนออกบิล
        // ไม่ใช่ปล่อยให้บิล 0 บาทหลุดไปถึงมือผู้เช่า
        unpriced: isSideUnpriced(config) && units > 0
      })
    }
  }

  // 3) ค่าบริการ — อ่านจาก contract_services ที่ตรึงราคาไว้ตอนทำสัญญา
  //    **ห้ามอ่านราคาสดจาก apartment_services** เพราะเจ้าของหอขึ้นราคากลางสัญญาได้
  //    แล้วบิลย้อนหลังจะเปลี่ยนตามไปด้วยทั้งที่ผู้เช่าตกลงราคาเดิมไว้
  const services = db
    .prepare(
      `SELECT cs.price_cents, s.name, s.is_vat_enabled
         FROM contract_services cs
         JOIN apartment_services s ON s.service_id = cs.apartment_service_id
        WHERE cs.contract_id = ?
        ORDER BY s.name`
    )
    .all(contractId)

  for (const service of services) {
    items.push({
      itemType: 'service',
      description: service.name,
      quantity: 1,
      unitPriceCents: service.price_cents,
      totalAmountCents: service.price_cents,
      // ค่าบริการเสียภาษีก็ต่อเมื่อหอเปิด VAT *และ* ค่าบริการตัวนั้นติดธงไว้
      isTaxable: contract.is_vat_enabled === 1 && service.is_vat_enabled === 1
    })
  }

  return { contract, items }
}

function formatBillingMonth(billingMonth) {
  // '2025-03' -> '03-2025' ตามที่ต้นแบบขึ้นบนบิล
  const [year, month] = String(billingMonth).split('-')
  return `${month}-${year}`
}

// เดือนที่จะไปอยู่ใน "ข้อความของรายการบนเอกสาร" — พ.ศ. (ผู้ใช้สั่ง 2026-08-10)
//
// **แยกจาก formatBillingMonth โดยตั้งใจ** ตัวนั้นยังใช้ ค.ศ. เพราะไปโผล่ในข้อความเตือน
// ที่ผู้ใช้อ่านคู่กับตัวเลือกเดือนบนหน้าจอ ซึ่งยังเป็น ค.ศ. อยู่ ถ้าใช้ตัวเดียวกันทั้งสองที่
// เจ้าของหอจะเลือกเดือน 08-2026 แล้วโดนเตือนว่า "ออกบิลของเดือน 08-2569 ไปแล้ว"
//
// ฐานข้อมูลยังเก็บ billing_month เป็น 'YYYY-MM' ค.ศ. เหมือนเดิม — แปลงตอนประกอบข้อความเท่านั้น
function formatDocumentMonth(billingMonth) {
  const [year, month] = String(billingMonth).split('-')
  if (!year || !month) return String(billingMonth)
  return `${month}-${Number(year) + 543}`
}

// ------------------------------------------------------------------
// รวมยอด
// ------------------------------------------------------------------
// แยก exempt / taxable / vat ตามที่สคีมาเตรียมช่องไว้ ยอดรวมคือผลบวกของทั้งสาม
// ส่วนลดเก็บเป็นยอดติดลบในรายการ จึงลดยอดรวมได้เองโดยไม่ต้องมีตรรกะพิเศษ
export function calculateInvoiceTotals(items) {
  let exempt = 0
  let taxable = 0
  let vat = 0

  for (const item of items) {
    if (item.isTaxable) {
      taxable += item.totalAmountCents
      vat += Math.round((item.totalAmountCents * VAT_RATE) / 100)
    } else {
      exempt += item.totalAmountCents
    }
  }

  return {
    exemptAmountCents: exempt,
    taxableAmountCents: taxable,
    vatAmountCents: vat,
    totalAmountCents: exempt + taxable + vat
  }
}

// ------------------------------------------------------------------
// ออกบิล
// ------------------------------------------------------------------
export function createMonthlyInvoice(db, { contractId, billingMonth, meterBatchId, issueDate }) {
  if (!/^\d{4}-\d{2}$/.test(String(billingMonth ?? ''))) {
    throw new Error('กรุณาระบุเดือนที่ออกบิลในรูปแบบ YYYY-MM')
  }
  if (!isDate(issueDate)) throw new Error('กรุณาระบุวันที่ออกบิล')

  // ต้นแบบออกบิลรายเดือนจากใบจดมิเตอร์เสมอ (ผู้ใช้ยืนยันให้ทำตาม 2026-08-07)
  // ห้องที่ยังไม่ได้จดจะได้ 0 หน่วย ซึ่งเป็นคำตอบที่ถูกต้อง ไม่ใช่บิลที่ขาดข้อมูล
  if (!meterBatchId) throw new Error('กรุณาเลือกใบจดมิเตอร์ก่อนออกบิลรายเดือน')

  const { contract, items } = buildInvoiceItems(db, { contractId, billingMonth, meterBatchId })

  const existing = db
    .prepare(
      `SELECT invoice_number FROM invoices
        WHERE contract_id = ? AND billing_month = ?
          AND invoice_type = 'monthly' AND status <> 'cancelled'`
    )
    .get(contractId, billingMonth)
  if (existing) {
    throw new Error(
      `ห้อง ${contract.room_number} ออกบิลของเดือน ${formatBillingMonth(billingMonth)} ไปแล้ว ` +
        `(เลขที่ ${existing.invoice_number})`
    )
  }

  const dueDate = calculateDueDate(issueDate, getDueDateDay(db, contract.apartment_id))
  const totals = calculateInvoiceTotals(items)
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    const invoiceNumber = nextDocumentNumber(db, contract.apartment_id, 'invoice', issueDate)
    const result = db
      .prepare(
        `INSERT INTO invoices (
           contract_id, invoice_number, billing_month, issue_date, due_date, status,
           invoice_type, meter_batch_id,
           exempt_amount_cents, taxable_amount_cents, vat_amount_cents, total_amount_cents,
           created_at
         ) VALUES (
           @contractId, @invoiceNumber, @billingMonth, @issueDate, @dueDate, 'unpaid',
           'monthly', @meterBatchId,
           @exempt, @taxable, @vat, @total,
           @now
         )`
      )
      .run({
        contractId,
        invoiceNumber,
        billingMonth,
        issueDate,
        dueDate,
        meterBatchId,
        exempt: totals.exemptAmountCents,
        taxable: totals.taxableAmountCents,
        vat: totals.vatAmountCents,
        total: totals.totalAmountCents,
        now
      })

    insertItems(db, result.lastInsertRowid, items, now)
    return result.lastInsertRowid
  })

  return getInvoiceById(db, run())
}

function insertItems(db, invoiceId, items, now) {
  const stmt = db.prepare(
    `INSERT INTO invoice_items (
       invoice_id, item_type, description, quantity,
       unit_price_cents, vat_rate, vat_amount_cents, total_amount_cents, created_at
     ) VALUES (
       @invoiceId, @itemType, @description, @quantity,
       @unitPriceCents, @vatRate, @vatAmountCents, @totalAmountCents, @now
     )`
  )
  for (const item of items) {
    const vatRate = item.isTaxable ? VAT_RATE : 0
    stmt.run({
      invoiceId,
      itemType: item.itemType,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      vatRate,
      vatAmountCents: item.isTaxable
        ? Math.round((item.totalAmountCents * VAT_RATE) / 100)
        : 0,
      totalAmountCents: item.totalAmountCents,
      now
    })
  }
}

function getDueDateDay(db, apartmentId) {
  const row = db
    .prepare('SELECT due_date_day FROM apartments WHERE apartment_id = ?')
    .get(apartmentId)
  if (!row) throw new Error('ไม่พบหอพักของสัญญานี้')
  return row.due_date_day
}

// ------------------------------------------------------------------
// พรีวิวก่อนออกบิลทั้งหอ
// ------------------------------------------------------------------
// ตารางขั้นที่ 3 ของต้นแบบ: ห้อง | สถานะ | ค่าน้ำ | ค่าไฟ | เงินฝากล่วงหน้า
// คืนทุกห้องที่มีสัญญาใช้งานอยู่ พร้อมบอกว่าห้องไหนออกบิลเดือนนี้ไปแล้ว
export function previewMonthlyBilling(db, { apartmentId, meterBatchId, billingMonth }) {
  const contracts = db
    .prepare(
      `SELECT c.contract_id, r.room_number, r.status
         FROM contracts c
         JOIN rooms r  ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND c.status = 'active'
        ORDER BY f.floor_id, r.room_number`
    )
    .all(apartmentId)

  return contracts.map((row) => {
    const existing = db
      .prepare(
        `SELECT invoice_id, invoice_number FROM invoices
          WHERE contract_id = ? AND billing_month = ?
            AND invoice_type = 'monthly' AND status <> 'cancelled'`
      )
      .get(row.contract_id, billingMonth)

    const { items } = buildInvoiceItems(db, {
      contractId: row.contract_id,
      billingMonth,
      meterBatchId
    })
    const totals = calculateInvoiceTotals(items)
    const water = items.find((i) => i.itemType === 'water')
    const electric = items.find((i) => i.itemType === 'electricity')

    return {
      contractId: row.contract_id,
      roomNumber: row.room_number,
      roomStatus: row.status,
      waterUnits: water ? water.quantity : 0,
      waterChargeCents: water ? water.totalAmountCents : 0,
      electricUnits: electric ? electric.quantity : 0,
      electricChargeCents: electric ? electric.totalAmountCents : 0,
      totalAmountCents: totals.totalAmountCents,
      // ห้องที่มีหน่วยใช้จริงแต่คิดเงินไม่ได้ — หน้าจอต้องเตือนก่อนกดออกบิล
      unpricedSides: items.filter((i) => i.unpriced).map((i) => i.itemType),
      // ห้องที่ออกบิลไปแล้วยังต้องแสดงในตาราง (ต้นแบบขึ้น "สร้างสำเร็จ") แต่กดสร้างซ้ำไม่ได้
      existingInvoiceId: existing ? existing.invoice_id : null,
      existingInvoiceNumber: existing ? existing.invoice_number : null
    }
  })
}

// ปุ่ม "สร้างใบแจ้งหนี้ทุกห้อง" — ห้องที่ออกไปแล้วให้ข้าม ไม่ใช่ล้มทั้งชุด
// เพราะเจ้าของหอกดปุ่มนี้ซ้ำได้เป็นเรื่องปกติ (เพิ่มผู้เช่าใหม่กลางเดือนแล้วกดอีกรอบ)
export function createMonthlyInvoicesForApartment(
  db,
  { apartmentId, meterBatchId, billingMonth, issueDate }
) {
  const rows = previewMonthlyBilling(db, { apartmentId, meterBatchId, billingMonth })
  const created = []
  const skipped = []
  const failed = []

  for (const row of rows) {
    if (row.existingInvoiceId) {
      skipped.push({ roomNumber: row.roomNumber, invoiceNumber: row.existingInvoiceNumber })
      continue
    }
    try {
      const invoice = createMonthlyInvoice(db, {
        contractId: row.contractId,
        billingMonth,
        meterBatchId,
        issueDate
      })
      created.push({ roomNumber: row.roomNumber, invoiceNumber: invoice.invoiceNumber })
    } catch (err) {
      // ห้องหนึ่งพังต้องไม่ทำให้อีก 40 ห้องออกบิลไม่ได้ — เก็บไว้รายงานท้ายงาน
      failed.push({ roomNumber: row.roomNumber, message: err.message })
    }
  }

  return { created, skipped, failed }
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function getInvoiceById(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT i.*, r.room_number, a.apartment_id, a.name_th AS apartment_name,
              a.address_th AS apartment_address, a.phone AS apartment_phone,
              a.qr_code_image_id, a.is_vat_enabled, a.payment_instructions, a.invoice_note,
              a.show_tenant_info_in_invoice
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) return null

  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY invoice_item_id')
    .all(invoiceId)

  // ผู้เช่าของสัญญานี้ — ใบแจ้งหนี้ที่ยื่นให้คนหนึ่งต้องมีชื่อคนนั้นอยู่บนนั้น
  // ผู้เช่าหลักขึ้นก่อนเสมอ (ดู 010_contract_tenants.sql) เพราะเป็นคนที่ชื่อขึ้นใบแจ้งหนี้
  //
  // ซ่อนได้ด้วย apartments.show_tenant_info_in_invoice — หอที่ส่งบิลแบบติดหน้าห้อง
  // อาจไม่อยากให้ชื่อกับเบอร์ของผู้เช่าติดไปกับกระดาษที่คนเดินผ่านเห็นได้
  const tenants =
    row.show_tenant_info_in_invoice === 1
      ? db
          .prepare(
            `SELECT t.tenant_id, t.first_name, t.last_name, t.phone, t.address, ct.is_primary
               FROM contract_tenants ct
               JOIN tenants t ON t.tenant_id = ct.tenant_id
              WHERE ct.contract_id = ?
              ORDER BY ct.is_primary DESC, t.tenant_id`
          )
          .all(row.contract_id)
          .map((t) => ({
            tenantId: t.tenant_id,
            fullName: `${t.first_name} ${t.last_name}`.trim(),
            phone: t.phone,
            address: t.address,
            isPrimary: t.is_primary === 1
          }))
      : []

  // บัญชีธนาคารกับข้อความแจ้งชำระต้องไปอยู่บนใบแจ้งหนี้ ไม่ใช่แค่ในหน้าตั้งค่า —
  // ผู้เช่าที่ได้รับบิลต้องโอนเงินได้ทันทีโดยไม่ต้องถามว่าโอนเข้าบัญชีไหน (ต้นแบบก็มี)
  const bankAccounts = db
    .prepare(
      `SELECT bank_name, account_name, account_number, is_default
         FROM apartment_bank_accounts
        WHERE apartment_id = ?
        ORDER BY is_default DESC, bank_account_id`
    )
    .all(row.apartment_id)
    .map((bank) => ({
      bankName: bank.bank_name,
      accountName: bank.account_name,
      accountNumber: bank.account_number,
      isDefault: bank.is_default === 1
    }))

  // ยอดที่ชำระมาแล้วคำนวณสดจากใบเสร็จเสมอ ไม่เก็บเป็นคอลัมน์
  // ความจริงเดียวกันสองที่จะไม่ตรงกันวันใดวันหนึ่ง และตัวที่ถูกคือผลรวมของใบเสร็จ
  const paidCents = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE invoice_id = ?')
    .get(invoiceId).paid

  return {
    invoiceId: row.invoice_id,
    contractId: row.contract_id,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    billingMonth: row.billing_month,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    statusLabel: INVOICE_STATUS_LABELS[row.status],
    meterBatchId: row.meter_batch_id,
    exemptAmountCents: row.exempt_amount_cents,
    taxableAmountCents: row.taxable_amount_cents,
    vatAmountCents: row.vat_amount_cents,
    // หน้าใบแจ้งหนี้ใช้ธงนี้ตัดสินว่าจะ "แสดงแถว VAT" หรือไม่ ไม่ใช่ดูว่ายอด VAT เป็น 0
    // เพราะหอที่เปิด VAT ไว้แต่เดือนนี้ไม่มีรายการที่เสียภาษี ก็ได้ 0 เหมือนกัน
    // แต่ควรยังเห็นแถว VAT 0.00 บนบิล ต่างจากหอที่ไม่ได้จด VAT ซึ่งต้องไม่มีแถวนี้เลย
    isVatEnabled: row.is_vat_enabled === 1,
    totalAmountCents: row.total_amount_cents,
    paidAmountCents: paidCents,
    outstandingCents: row.total_amount_cents - paidCents,
    note: row.note,
    cancelledAt: row.cancelled_at,
    roomNumber: row.room_number,
    apartment: {
      apartmentId: row.apartment_id,
      name: row.apartment_name,
      address: row.apartment_address,
      phone: row.apartment_phone,
      qrCodeImageId: row.qr_code_image_id,
      paymentInstructions: row.payment_instructions,
      invoiceNote: row.invoice_note
    },
    tenants,
    bankAccounts,
    items: items.map(toPublicItem)
  }
}

function toPublicItem(row) {
  return {
    invoiceItemId: row.invoice_item_id,
    itemType: row.item_type,
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceCents: row.unit_price_cents,
    vatRate: Number(row.vat_rate),
    vatAmountCents: row.vat_amount_cents,
    totalAmountCents: row.total_amount_cents
  }
}

// จับกลุ่มสถานะเป็น "ยังต้องตามเก็บ" กับ "จบแล้ว" สำหรับตัวกรองบนหน้าจอ
//
// **ค้างชำระต้องรวม `partial_paid` ด้วย** — จ่ายมาครึ่งเดียวก็ยังเป็นหนี้ที่ต้องตามเก็บ
// ถ้ากรองแค่ `unpaid` บิลที่จ่ายบางส่วนจะหายไปจากทั้งสองแท็บแล้วไม่มีใครตามต่อ
// (ชื่อป้ายสถานะ `unpaid` ก็แปลว่า "ค้างชำระ" เหมือนกัน จุดนี้จึงพลาดได้ง่ายมาก)
//
// บิลที่ยกเลิกไม่อยู่ในกลุ่มไหนเลย ต่อให้ยอดค้างคำนวณออกมาเป็นบวกก็ไม่ใช่หนี้จริง
// จึงกรองด้วย "สถานะ" ไม่ใช่ "ยอดค้าง > 0"
const SETTLEMENT_STATUSES = {
  outstanding: ['unpaid', 'partial_paid'],
  paid: ['paid']
}

// รายการบิลค้างชำระของหอ — คอลัมน์ตามต้นแบบ: เลขใบแจ้งหนี้ | วันที่ | สถานะ | ห้อง | ยอดเงิน
export function listInvoices(
  db,
  apartmentId,
  { status, settlement, billingMonth, roomNumber, invoiceNumber, dateFrom, dateTo } = {}
) {
  const where = ['f.apartment_id = @apartmentId']
  if (status) where.push('i.status = @status')

  if (settlement) {
    const statuses = SETTLEMENT_STATUSES[settlement]
    // ค่าที่ไม่รู้จักต้องดังออกมา ไม่ใช่เงียบแล้วคืนบิลทั้งหมด — ตัวกรองที่ไม่ทำงาน
    // แต่หน้าจอยังไฮไลต์แท็บอยู่ ทำให้อ่านตัวเลขผิดโดยไม่รู้ตัว
    if (!statuses) throw new Error(`ตัวกรองสถานะไม่ถูกต้อง: ${settlement}`)
    // ค่าในลิสต์มาจากค่าคงที่ของเราเอง ไม่ได้มาจากผู้เรียก จึงต่อเป็นข้อความได้
    where.push(`i.status IN (${statuses.map((s) => `'${s}'`).join(', ')})`)
  }

  if (billingMonth) where.push('i.billing_month = @billingMonth')
  if (roomNumber) where.push('r.room_number LIKE @roomNumber')
  if (invoiceNumber) where.push('i.invoice_number LIKE @invoiceNumber')
  // ช่วงวันที่ออกบิล — เทียบเป็นข้อความได้ตรงๆ เพราะเก็บเป็น 'YYYY-MM-DD' ซึ่งเรียงตามเวลา
  // อยู่แล้ว ไม่ต้องแปลงเป็น date ก่อน (และไม่ต้องพึ่งฟังก์ชันวันที่ของ SQLite)
  //
  // ใส่มาข้างเดียวก็ได้ — ระบุแต่วันเริ่มคือ "ตั้งแต่วันนั้นเป็นต้นไป"
  if (dateFrom) where.push('i.issue_date >= @dateFrom')
  if (dateTo) where.push('i.issue_date <= @dateTo')

  return db
    .prepare(
      `SELECT i.invoice_id, i.invoice_number, i.issue_date, i.due_date, i.status,
              i.total_amount_cents, i.billing_month, r.room_number,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id), 0) AS paid
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.issue_date DESC, i.invoice_id DESC`
    )
    .all({
      apartmentId,
      status,
      billingMonth,
      roomNumber: roomNumber ? `%${roomNumber}%` : null,
      invoiceNumber: invoiceNumber ? `%${invoiceNumber}%` : null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null
    })
    .map((row) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      billingMonth: row.billing_month,
      roomNumber: row.room_number,
      status: row.status,
      statusLabel: INVOICE_STATUS_LABELS[row.status],
      totalAmountCents: row.total_amount_cents,
      paidAmountCents: row.paid,
      outstandingCents: row.total_amount_cents - row.paid,
      // เกินกำหนดกี่วันแล้ว — มีประโยชน์แม้หอจะปิดค่าปรับ เพราะหอต้องรู้อยู่ดีว่าใครค้าง
      // นับถึงวันนี้ ไม่ใช่ถึงวันที่จ่าย เพราะบิลใบนี้ยังไม่ได้จ่าย
      overdueDays:
        row.status === 'unpaid' || row.status === 'partial_paid'
          ? Math.max(0, daysBetween(row.due_date, todayIso()))
          : 0
    }))
}

// รอบเดือนที่หอนี้เคยออกบิลไว้ ใหม่สุดก่อน — ใช้ทำตัวเลือกเดือนบนหน้ารับเงินหลายห้อง
//
// ดึงจากบิลที่มีจริง ไม่ใช่ไล่เดือนย้อนหลังไปเรื่อยๆ จากวันนี้ เพราะหอที่เพิ่งเริ่มใช้ระบบ
// จะได้เดือนเปล่าเต็มไปหมด ส่วนหอที่ค้างบิลข้ามปีจะหาเดือนเก่าไม่เจอ
export function listBillingMonths(db, apartmentId) {
  return db
    .prepare(
      `SELECT DISTINCT i.billing_month AS month
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
        WHERE f.apartment_id = ? AND i.billing_month IS NOT NULL
        ORDER BY i.billing_month DESC`
    )
    .all(apartmentId)
    .map((row) => row.month)
}

// ------------------------------------------------------------------
// แก้ไขบิลที่ออกไปแล้ว
// ------------------------------------------------------------------
// ต้นแบบให้เพิ่ม/ลบรายการบนใบที่ออกไปแล้วได้ (การ์ด "เพิ่มรายการ" แท็บค่าบริการ /
// ส่วนลด-คืนเงิน) ทุกครั้งที่รายการเปลี่ยน ยอดรวมของหัวบิลต้องถูกคิดใหม่ทันที
export function addInvoiceItem(db, invoiceId, { itemType, description, amount, isTaxable }) {
  const invoice = requireOpenInvoice(db, invoiceId)

  if (!ITEM_TYPES.includes(itemType)) throw new Error(`ชนิดรายการไม่ถูกต้อง: ${itemType}`)
  const label = String(description ?? '').trim()
  if (!label) throw new Error('กรุณากรอกชื่อรายการ')

  // ส่วนลด/คืนเงินเก็บเป็นยอดติดลบ ผู้ใช้กรอกเป็นจำนวนบวกตามปกติ
  const magnitude = toCents(amount, itemType === 'discount' ? 'ส่วนลด' : 'จำนวนเงิน')
  const totalAmountCents = itemType === 'discount' ? -magnitude : magnitude

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    insertItems(db, invoiceId, [
      {
        itemType,
        description: label,
        quantity: 1,
        unitPriceCents: totalAmountCents,
        totalAmountCents,
        // ส่วนลดไม่คิด VAT ต่อ — ไม่งั้นต้องตัดสินว่าลดจากฐานภาษีหรือลดจากยอดรวม
        // ซึ่งต้นแบบก็ไม่ได้แยกไว้
        //
        // และต้องเช็คสวิตช์ VAT ของหอด้วยเสมอ ไม่ใช่เชื่อ isTaxable ที่ส่งมาอย่างเดียว —
        // หอที่เจ้าของไม่ได้ติ๊ก "เปิดการใช้งาน VAT" ต้องไม่มี VAT โผล่บนบิลจากทางไหนเลย
        isTaxable:
          invoice.is_vat_enabled === 1 && itemType !== 'discount' && Boolean(isTaxable)
      }
    ], now)
    recalculateTotals(db, invoiceId, now)
  })
  run()

  return getInvoiceById(db, invoiceId)
}

export function removeInvoiceItem(db, invoiceId, invoiceItemId) {
  requireOpenInvoice(db, invoiceId)

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    const result = db
      .prepare('DELETE FROM invoice_items WHERE invoice_item_id = ? AND invoice_id = ?')
      .run(invoiceItemId, invoiceId)
    if (result.changes === 0) throw new Error('ไม่พบรายการที่ต้องการลบในบิลใบนี้')
    recalculateTotals(db, invoiceId, now)
  })
  run()

  return getInvoiceById(db, invoiceId)
}

// สถานะบิลเป็น "ผล" ของยอดรวมกับยอดที่รับมาแล้วเสมอ ไม่ใช่ค่าที่ตั้งแยก
// จึงต้องคิดใหม่ทุกครั้งที่ *ฝั่งใดฝั่งหนึ่ง* ขยับ — เงินเข้า/ออก (payments.js เรียกตัวนี้)
// และยอดบิลเปลี่ยนเพราะเพิ่ม/ลบรายการ (recalculateTotals ข้างล่างเรียกตัวนี้)
//
// เคยพลาดมาแล้ว: เพิ่มรายการเข้าบิลที่จ่ายครบแล้ว ยอดรวมขึ้นแต่สถานะยังค้างเป็น 'paid'
// กลายเป็นบิลที่เขียนว่า "ชำระแล้ว" ทั้งที่มียอดค้างอยู่
//
// อยู่ที่ไฟล์นี้ไม่ใช่ payments.js เพราะเป็นเรื่องของใบแจ้งหนี้ และ payments.js นำเข้าจาก
// ไฟล์นี้อยู่แล้ว (ทางกลับกันจะกลายเป็นวงกลม)
export function refreshInvoiceStatus(db, invoiceId, now) {
  const row = db
    .prepare(
      `SELECT i.total_amount_cents AS total, i.status,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id), 0) AS paid
         FROM invoices i WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) return

  // บิลที่ถูกยกเลิกไม่ถูกแตะ — สถานะ 'cancelled' ต้องชนะทุกอย่าง
  if (row.status === 'cancelled') return

  let status = 'unpaid'
  if (row.paid >= row.total && row.total > 0) status = 'paid'
  else if (row.paid > 0) status = 'partial_paid'

  if (status === row.status) return
  db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE invoice_id = ?').run(
    status,
    now,
    invoiceId
  )
}

// อ่านรายการทั้งหมดกลับมารวมใหม่ ไม่ใช่บวก/ลบส่วนต่างจากยอดเดิม
// เพราะยอดเดิมอาจเพี้ยนมาก่อนแล้ว การรวมใหม่ทั้งใบทำให้บิลกลับมาถูกเสมอ
function recalculateTotals(db, invoiceId, now) {
  const rows = db
    .prepare('SELECT vat_rate, total_amount_cents FROM invoice_items WHERE invoice_id = ?')
    .all(invoiceId)

  const totals = calculateInvoiceTotals(
    rows.map((row) => ({
      totalAmountCents: row.total_amount_cents,
      isTaxable: Number(row.vat_rate) > 0
    }))
  )

  db.prepare(
    `UPDATE invoices
        SET exempt_amount_cents = @exempt,
            taxable_amount_cents = @taxable,
            vat_amount_cents = @vat,
            total_amount_cents = @total,
            updated_at = @now
      WHERE invoice_id = @invoiceId`
  ).run({
    invoiceId,
    exempt: totals.exemptAmountCents,
    taxable: totals.taxableAmountCents,
    vat: totals.vatAmountCents,
    total: totals.totalAmountCents,
    now
  })

  // ยอดรวมเพิ่งเปลี่ยน สถานะจึงอาจไม่ตรงกับความจริงแล้ว
  refreshInvoiceStatus(db, invoiceId, now)
}

function requireOpenInvoice(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT i.invoice_id, i.status, a.is_vat_enabled
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) throw new Error('ไม่พบใบแจ้งหนี้')
  if (row.status === 'cancelled') throw new Error('ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว แก้ไขไม่ได้')
  return row
}

// ------------------------------------------------------------------
// ยกเลิกบิล
// ------------------------------------------------------------------
// ไม่ลบทิ้ง — ทำเครื่องหมายยกเลิกไว้ เอกสารการเงินที่หายไปเฉยๆ ตรวจสอบย้อนหลังไม่ได้
// และ partial unique index ยอมให้ออกบิลเดือนเดิมใหม่ได้หลังใบเก่าถูกยกเลิก
export function cancelInvoice(db, invoiceId) {
  const invoice = getInvoiceById(db, invoiceId)
  if (!invoice) throw new Error('ไม่พบใบแจ้งหนี้')
  if (invoice.status === 'cancelled') throw new Error('ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว')
  if (invoice.paidAmountCents !== 0) {
    throw new Error(
      'ยกเลิกไม่ได้ เพราะใบแจ้งหนี้นี้มีการรับชำระเงินแล้ว กรุณาคืนเงินให้ครบก่อน'
    )
  }

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE invoice_id = ?`
  ).run(now, now, invoiceId)

  return getInvoiceById(db, invoiceId)
}

// ------------------------------------------------------------------
// ค่าปรับชำระล่าช้า
// ------------------------------------------------------------------
// คิด "ตอนรับเงิน" ไม่ใช่ตอนออกบิล (ผู้ใช้ตัดสินใจ 2026-08-08 ตามที่ต้นแบบทำ)
//
// เหตุผล: ตอนออกบิลยังไม่รู้ว่าผู้เช่าจะจ่ายวันไหน ค่าปรับจึงเป็นตัวเลขที่ยังเดินอยู่ทุกวัน
// ตรึงเป็นตัวเลขจริงได้ก็ต่อเมื่อเงินเข้าแล้ว — ถ้าใส่ลงบิลตั้งแต่ออก จะได้ค่าปรับที่เดาไว้
// ล่วงหน้าซึ่งไม่มีทางตรง
//
// นับวันจาก "วันครบกำหนด" ถึง "วันที่รับเงิน" แล้วหักวันผ่อนผันออก (ดู migration 018)
export function calculateLateFee({ dueDate, paymentDate, ratePerDayCents, graceDays }) {
  const empty = { overdueDays: 0, chargeableDays: 0, amountCents: 0 }
  if (!isDate(dueDate) || !isDate(paymentDate)) return empty

  const overdueDays = daysBetween(dueDate, paymentDate)
  if (overdueDays <= 0) return empty

  // ผ่อนผัน 3 วัน แปลว่าเกิน 3 วันแรกไม่ปรับ วันที่ 4 เป็นต้นไปจึงเริ่มนับ
  const chargeableDays = Math.max(0, overdueDays - Math.max(0, graceDays ?? 0))
  return {
    overdueDays,
    chargeableDays,
    amountCents: chargeableDays * Math.max(0, ratePerDayCents ?? 0)
  }
}

// เทียบวันแบบ UTC เพื่อไม่ให้เวลาออมแสง/เขตเวลาทำให้ผลต่างเพี้ยนไปหนึ่งวัน
// (วันที่เก็บเป็น 'YYYY-MM-DD' ไม่มีเวลาอยู่แล้ว จึงไม่ควรมีเรื่องเขตเวลามาเกี่ยว)
function daysBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd)
  const to = Date.UTC(ty, tm - 1, td)
  return Math.round((to - from) / 86400000)
}

// ค่าปรับที่ "เรียกเก็บได้สูงสุด" ของบิลใบหนึ่ง ณ วันที่รับเงินหนึ่ง
// ฝั่งรับเงินใช้ตัวนี้เป็นเพดาน — เจ้าของหอลดหย่อนได้ แต่เก็บเกินกฎที่ตัวเองตั้งไว้ไม่ได้
export function getLateFeeForInvoice(db, invoiceId, paymentDate) {
  const row = db
    .prepare(
      `SELECT i.due_date, i.status,
              a.is_auto_late_fee_enabled, a.late_fee_per_day_cents, a.late_fee_grace_days
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) throw new Error('ไม่พบใบแจ้งหนี้')

  const enabled = row.is_auto_late_fee_enabled === 1 && row.late_fee_per_day_cents > 0
  const graceDays = row.late_fee_grace_days ?? 0

  // บิลที่มีค่าปรับอยู่แล้วไม่คิดซ้ำ — รับเงินสองงวดในบิลเดียวกันต้องไม่โดนปรับสองรอบ
  const already = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount_cents), 0) AS charged
         FROM invoice_items WHERE invoice_id = ? AND item_type = 'late_fee'`
    )
    .get(invoiceId).charged

  const fee = calculateLateFee({
    dueDate: row.due_date,
    paymentDate,
    ratePerDayCents: row.late_fee_per_day_cents,
    graceDays
  })

  return {
    enabled,
    // เปิดสวิตช์ไว้แต่อัตราเป็น 0 — ตั้งค่าไม่ครบ ไม่ใช่ "ตั้งใจไม่เก็บ"
    // หน้าจอต้องบอกให้รู้ ไม่งั้นดูเหมือนระบบไม่ทำงาน (เจอจริง 2026-08-08)
    misconfigured: row.is_auto_late_fee_enabled === 1 && row.late_fee_per_day_cents === 0,
    dueDate: row.due_date,
    ratePerDayCents: row.late_fee_per_day_cents,
    graceDays,
    overdueDays: fee.overdueDays,
    chargeableDays: fee.chargeableDays,
    alreadyChargedCents: already,
    // เก็บได้อีกเท่าไหร่ — หักส่วนที่เคยเก็บไปแล้วออก
    suggestedCents: enabled ? Math.max(0, fee.amountCents - already) : 0
  }
}

// เพิ่มบรรทัด "ค่าปรับ" เข้าบิล — ไม่คิด VAT (ตรงกับต้นแบบ: เป็นค่าเสียหาย ไม่ใช่ค่าสินค้า)
export function addLateFeeItem(db, invoiceId, { amountCents, overdueDays }) {
  const now = new Date().toISOString()
  const run = db.transaction(() => {
    insertItems(
      db,
      invoiceId,
      [
        {
          itemType: 'late_fee',
          description: `ค่าปรับชำระล่าช้า (${overdueDays} วัน)`,
          quantity: 1,
          unitPriceCents: amountCents,
          totalAmountCents: amountCents,
          isTaxable: false
        }
      ],
      now
    )
    recalculateTotals(db, invoiceId, now)
  })
  run()
}

// ------------------------------------------------------------------
// ลบบิลที่ยกเลิกแล้วออกจากระบบ
// ------------------------------------------------------------------
// ลบได้เฉพาะใบที่ "ยกเลิกแล้ว" เท่านั้น — การยกเลิกเป็นด่านที่บังคับให้ตัดสินใจสองครั้ง
// และด่านแรกกันไม่ให้ลบใบที่มีการรับเงินไปแล้วอยู่ก่อนหน้านี้
//
// เหตุผลบังคับกรอกเสมอ (ผู้ใช้สั่ง 2026-08-07) และถูกเก็บไว้ที่ invoice_deletions
// ไม่ใช่ถามแล้วทิ้ง — เลขที่ใบที่หายไปจากรายการต้องตามได้ว่าเป็นใบอะไรและหายเพราะอะไร
export function deleteInvoice(db, invoiceId, { reason, deletedBy }) {
  const invoice = getInvoiceById(db, invoiceId)
  if (!invoice) throw new Error('ไม่พบใบแจ้งหนี้ที่ต้องการลบ')

  if (invoice.status !== 'cancelled') {
    throw new Error('ลบได้เฉพาะใบแจ้งหนี้ที่ยกเลิกแล้ว กรุณายกเลิกบิลก่อน')
  }

  const note = String(reason ?? '').trim()
  if (!note) throw new Error('กรุณาระบุเหตุผลในการลบใบแจ้งหนี้')
  if (!deletedBy) throw new Error('ไม่ทราบผู้ลบ กรุณาเข้าสู่ระบบใหม่')

  // ใบที่ยกเลิกแล้วไม่ควรมีใบเสร็จผูกอยู่ (cancelInvoice กันไว้) แต่ตรวจซ้ำก่อนลบจริง
  // เพราะการลบเป็นทางเดียว ถ้าหลุดไปได้ใบเสร็จจะชี้ไปที่บิลที่ไม่มีอยู่
  const payments = db
    .prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?')
    .get(invoiceId).n
  if (payments > 0) {
    throw new Error('ลบไม่ได้ เพราะใบแจ้งหนี้นี้มีรายการรับเงินอยู่')
  }

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO invoice_deletions (
         apartment_id, invoice_number, room_number, billing_month, issue_date,
         total_amount_cents, reason, deleted_by, deleted_at
       ) VALUES (
         @apartmentId, @invoiceNumber, @roomNumber, @billingMonth, @issueDate,
         @total, @reason, @deletedBy, @now
       )`
    ).run({
      apartmentId: invoice.apartment.apartmentId,
      invoiceNumber: invoice.invoiceNumber,
      roomNumber: invoice.roomNumber,
      billingMonth: invoice.billingMonth,
      issueDate: invoice.issueDate,
      total: invoice.totalAmountCents,
      reason: note,
      deletedBy,
      now
    })

    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId)
    db.prepare('DELETE FROM invoices WHERE invoice_id = ?').run(invoiceId)
  })
  run()

  return { invoiceNumber: invoice.invoiceNumber }
}

// ประวัติการลบของหอ — ไว้ให้ตอบได้ว่าเลขที่ใบที่หายไปคือใบอะไร ใครลบ เพราะอะไร
export function listInvoiceDeletions(db, apartmentId) {
  return db
    .prepare(
      `SELECT d.*, u.full_name AS deleted_by_name
         FROM invoice_deletions d
         LEFT JOIN users u ON u.user_id = d.deleted_by
        WHERE d.apartment_id = ?
        ORDER BY d.deleted_at DESC`
    )
    .all(apartmentId)
    .map((row) => ({
      invoiceDeletionId: row.invoice_deletion_id,
      invoiceNumber: row.invoice_number,
      roomNumber: row.room_number,
      billingMonth: row.billing_month,
      issueDate: row.issue_date,
      totalAmountCents: row.total_amount_cents,
      reason: row.reason,
      deletedByName: row.deleted_by_name,
      deletedAt: row.deleted_at
    }))
}

// ------------------------------------------------------------------
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}
