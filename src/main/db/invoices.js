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

export const ITEM_TYPES = ['rent', 'water', 'electricity', 'service', 'discount', 'other']

// ภาษีมูลค่าเพิ่มของไทย เก็บเป็นค่าคงที่ ไม่ใช่ช่องให้กรอก — ถ้าวันหนึ่งอัตราเปลี่ยน
// ต้องเปลี่ยนที่นี่ที่เดียว และบิลเก่าจะไม่ถูกคิดใหม่เพราะอัตราถูกสำเนาลงทุกบรรทัดแล้ว
export const VAT_RATE = 7

// **VAT คิดแบบ "บวกเพิ่มจากราคา" ไม่ใช่ "รวมอยู่ในราคาแล้ว"**
// ตาราง apartments มีแค่สวิตช์ is_vat_enabled ไม่มีช่องบอกว่ารวมหรือไม่รวม จึงต้องเลือก
// ทางใดทางหนึ่ง — เลือกบวกเพิ่มเพราะเป็นแบบที่ใบกำกับภาษีไทยใช้กันทั่วไป
//
// และคิดเฉพาะ "ค่าบริการที่ติดธงเสียภาษี" (apartment_services.is_vat_enabled) เท่านั้น
// ค่าเช่าห้องพักอาศัยกับค่าน้ำ/ค่าไฟที่เก็บตามจริงได้รับยกเว้น จึงลงช่อง exempt เสมอ
// (ตรงกับที่สคีมาแยก exempt_amount_cents ออกจาก taxable_amount_cents ไว้ตั้งแต่ต้น)

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

  // 1) ค่าเช่าห้อง — ข้อความตั้งต้นตั้งได้ที่หน้าหอ ต้นแบบขึ้นเป็น "ค่าเช่าห้อง/Rent (เดือน/Month 03-2025)"
  const rentLabel = contract.default_rent_item_text || 'ค่าเช่าห้อง/Rent'
  items.push({
    itemType: 'rent',
    description: `${rentLabel} (เดือน/Month ${formatBillingMonth(billingMonth)})`,
    quantity: 1,
    unitPriceCents: contract.rent_amount_cents,
    totalAmountCents: contract.rent_amount_cents,
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

    for (const [side, itemType, label] of [
      ['water', 'water', 'ค่าน้ำ/water'],
      ['electric', 'electricity', 'ค่าไฟ/electricity']
    ]) {
      const config = sides[side]
      if (!config.enabled) continue

      const units = reading ? Number(reading[`${side}_units_used`] ?? 0) : 0
      const previous = reading ? Number(reading[`${side}_previous_reading`] ?? 0) : 0
      const current = reading ? Number(reading[`${side}_current_reading`] ?? 0) : 0
      const charge = calculateUtilityCharge(config, units)

      // ต้นแบบเขียนบรรทัดเป็น "ค่าน้ำ/water : 98 หน่วย (2 - 100)" — เลขมิเตอร์ก่อน/หลัง
      // ซ่อนได้ด้วยสวิตช์รายห้อง เพราะหอที่คิดแบบเหมาจ่ายไม่มีเลขมิเตอร์ให้แสดง
      const showReading = config.showReadingInInvoice && contract.show_unit_qty_in_invoice === 1
      const description = showReading
        ? `${label} : ${units} หน่วย (${previous} - ${current})`
        : label

      items.push({
        itemType,
        description,
        // จำนวนหน่วยเป็น quantity ก็จริง แต่ยอดเงินคือคำตอบสุดท้าย ไม่ใช่ quantity × unitPrice
        // เพราะโหมดขั้นต่ำ/เหมาจ่ายคิดคนละแบบ — เก็บยอดที่เรียกเก็บจริงลง totalAmountCents
        quantity: units,
        unitPriceCents: config.unitPriceCents,
        totalAmountCents: charge,
        isTaxable: false,
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
              a.qr_code_image_id, a.is_vat_enabled
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
      qrCodeImageId: row.qr_code_image_id
    },
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

// รายการบิลค้างชำระของหอ — คอลัมน์ตามต้นแบบ: เลขใบแจ้งหนี้ | วันที่ | สถานะ | ห้อง | ยอดเงิน
export function listInvoices(db, apartmentId, { status, billingMonth, roomNumber } = {}) {
  const where = ['f.apartment_id = @apartmentId']
  if (status) where.push('i.status = @status')
  if (billingMonth) where.push('i.billing_month = @billingMonth')
  if (roomNumber) where.push('r.room_number LIKE @roomNumber')

  return db
    .prepare(
      `SELECT i.invoice_id, i.invoice_number, i.issue_date, i.status, i.total_amount_cents,
              i.billing_month, r.room_number,
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
      roomNumber: roomNumber ? `%${roomNumber}%` : null
    })
    .map((row) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      billingMonth: row.billing_month,
      roomNumber: row.room_number,
      status: row.status,
      statusLabel: INVOICE_STATUS_LABELS[row.status],
      totalAmountCents: row.total_amount_cents,
      paidAmountCents: row.paid,
      outstandingCents: row.total_amount_cents - row.paid
    }))
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
