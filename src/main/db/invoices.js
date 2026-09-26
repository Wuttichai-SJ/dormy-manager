// ห้าม import electron/logger — ชุดทดสอบรันแบบ node
import { toCents } from '../money.js'
import { FieldError } from '../fieldError.js'
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

// อัตรา VAT ตรึงที่ invoices.vat_rate ตอนออกบิล — ทุกฟังก์ชันต้องอ่านจากบิล ห้ามอ่านจากหอ · ค่านี้ใช้เมื่อไม่รู้อัตรา
import { DEFAULT_VAT_RATE } from './apartments.js'

// VAT บวกเพิ่มจากราคา: ค่าเช่ายกเว้นเสมอ · น้ำ/ไฟเสียภาษีถ้าหอเปิด VAT · ค่าบริการเสียถ้าเปิด VAT และติดธง

// I + YYYYMM + ลำดับ 4 หลัก · ต้องเรียกในธุรกรรมเดียวกับการสร้างเอกสาร
const DOC_PREFIXES = { invoice: 'I', receipt: 'R', booking: 'B' }

export function nextDocumentNumber(db, apartmentId, docType, dateIso) {
  const prefix = DOC_PREFIXES[docType]
  if (!prefix) throw new Error(`ชนิดเอกสารไม่ถูกต้อง: ${docType}`)

  const period = String(dateIso).slice(0, 7).replace('-', '')
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

// วันครบกำหนด = วันที่ due_date_day ถัดไปหลังวันออกบิล (26/03 + วันที่ 5 → 05/04)
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

// ค่าน้ำ-ไฟบนบิล = ของเดือนก่อนเดือนค่าเช่า (บิลวันที่ 1 ก.พ. = ค่าเช่า ก.พ. + น้ำไฟ ม.ค.)
export function utilityMonthOf(billingMonth) {
  const [year, month] = String(billingMonth ?? '').split('-').map(Number)
  if (!year || !month) return null

  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${pad2(previous.getUTCMonth() + 1)}`
}

// ใช้ทั้งพรีวิวและออกบิลจริง — ตัวเลขตรงกันเสมอ
export function buildInvoiceItems(db, { contractId, billingMonth, meterBatchId }) {
  const contract = db
    .prepare(
      `SELECT c.contract_id, c.room_id, c.rent_amount_cents,
              r.room_number,
              a.apartment_id, a.is_vat_enabled, a.vat_rate, a.default_rent_item_text,
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

  const rentLabel = contract.default_rent_item_text || 'ค่าเช่าห้อง'
  items.push({
    itemType: 'rent',
    description: `${rentLabel} (เดือน ${formatDocumentMonth(billingMonth)})`,
    quantity: 1,
    unitPriceCents: contract.rent_amount_cents,
    totalAmountCents: contract.rent_amount_cents,
    // ค่าเช่ายกเว้น VAT เสมอ
    isTaxable: false
  })

  // สูตรคิดเงินใช้ calculateUtilityCharge ที่เดียว
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

    const utilityMonth = meterBatchId ? utilityMonthOf(billingMonth) : null
    const monthTag = utilityMonth ? ` (เดือน ${formatDocumentMonth(utilityMonth)})` : ''

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

      const showReading = config.showReadingInInvoice && contract.show_unit_qty_in_invoice === 1
      const description = showReading
        ? `${label}${monthTag} : ${units} หน่วย (${previous} - ${current})`
        : `${label}${monthTag}`

      items.push({
        itemType,
        description,
        // ยอดเงินคือค่าที่เรียกเก็บจริง ไม่ใช่ quantity × unitPrice (โหมดขั้นต่ำ/เหมาจ่าย)
        quantity: units,
        unitPriceCents: config.unitPriceCents,
        totalAmountCents: charge,
        isTaxable: contract.is_vat_enabled === 1,
        // ใช้จริงแต่ห้องยังไม่ตั้งราคา — ต้องเตือนก่อนออกบิล
        unpriced: isSideUnpriced(config) && units > 0
      })
    }
  }

  // ค่าบริการอ่านจาก contract_services (ราคาที่ตรึงไว้) ห้ามอ่านราคาสด
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
      isTaxable: contract.is_vat_enabled === 1 && service.is_vat_enabled === 1
    })
  }

  return { contract, items }
}

function formatBillingMonth(billingMonth) {
  const [year, month] = String(billingMonth).split('-')
  return `${month}-${year}`
}

// พ.ศ. สำหรับข้อความบนเอกสาร — แยกจาก formatBillingMonth (ค.ศ. ใช้บนจอ)
function formatDocumentMonth(billingMonth) {
  const [year, month] = String(billingMonth).split('-')
  if (!year || !month) return String(billingMonth)
  return `${month}-${Number(year) + 543}`
}

// vatRate ไม่มีค่าเริ่มต้นโดยตั้งใจ — ลืมส่งต้องพัง
export function calculateInvoiceTotals(items, vatRate) {
  let exempt = 0
  let taxable = 0
  let vat = 0

  for (const item of items) {
    if (item.isTaxable) {
      taxable += item.totalAmountCents
      vat += Math.round((item.totalAmountCents * vatRate) / 100)
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

export function createMonthlyInvoice(db, { contractId, billingMonth, meterBatchId, issueDate }) {
  if (!/^\d{4}-\d{2}$/.test(String(billingMonth ?? ''))) {
    throw new Error('กรุณาระบุเดือนที่ออกบิลในรูปแบบ YYYY-MM')
  }
  if (!isDate(issueDate)) throw new Error('กรุณาระบุวันที่ออกบิล')

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
  // จุดตรึงอัตรา VAT ลงบิล
  const vatRate = Number(contract.vat_rate ?? DEFAULT_VAT_RATE)
  const totals = calculateInvoiceTotals(items, vatRate)
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    const invoiceNumber = nextDocumentNumber(db, contract.apartment_id, 'invoice', issueDate)
    const result = db
      .prepare(
        // เลขที่บิลเดินแยกรายหอ
        `INSERT INTO invoices (
           contract_id, apartment_id, invoice_number, billing_month, issue_date, due_date, status,
           invoice_type, meter_batch_id, vat_rate,
           exempt_amount_cents, taxable_amount_cents, vat_amount_cents, total_amount_cents,
           created_at
         ) VALUES (
           @contractId, @apartmentId, @invoiceNumber, @billingMonth, @issueDate, @dueDate, 'unpaid',
           'monthly', @meterBatchId, @vatRate,
           @exempt, @taxable, @vat, @total,
           @now
         )`
      )
      .run({
        contractId,
        apartmentId: contract.apartment_id,
        invoiceNumber,
        billingMonth,
        issueDate,
        dueDate,
        meterBatchId,
        vatRate,
        exempt: totals.exemptAmountCents,
        taxable: totals.taxableAmountCents,
        vat: totals.vatAmountCents,
        total: totals.totalAmountCents,
        now
      })

    insertItems(db, result.lastInsertRowid, items, now, vatRate)
    return result.lastInsertRowid
  })

  return getInvoiceById(db, run())
}

// vatRate ต้องมาจาก invoices.vat_rate
function insertItems(db, invoiceId, items, now, vatRate) {
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
    const lineVatRate = item.isTaxable ? vatRate : 0
    stmt.run({
      invoiceId,
      itemType: item.itemType,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      vatRate: lineVatRate,
      vatAmountCents: item.isTaxable
        ? Math.round((item.totalAmountCents * vatRate) / 100)
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

export function previewMonthlyBilling(db, { apartmentId, meterBatchId, billingMonth }) {
  const contracts = db
    .prepare(
      `SELECT c.contract_id, c.start_date, r.room_number, r.status
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

    const { contract, items } = buildInvoiceItems(db, {
      contractId: row.contract_id,
      billingMonth,
      meterBatchId
    })
    // ใช้อัตราเดียวกับ createMonthlyInvoice
    const totals = calculateInvoiceTotals(items, Number(contract.vat_rate ?? DEFAULT_VAT_RATE))
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
      unpricedSides: items.filter((i) => i.unpriced).map((i) => i.itemType),
      existingInvoiceId: existing ? existing.invoice_id : null,
      existingInvoiceNumber: existing ? existing.invoice_number : null,
      // สัญญาที่เริ่มเดือนนี้จ่ายค่าเช่าไปแล้วตอนย้ายเข้า — ไม่ออกบิลซ้ำ (น้ำไฟไปอยู่บิลเดือนหน้า)
      startsThisMonth: String(row.start_date ?? '').slice(0, 7) === billingMonth
    }
  })
}

// ห้องที่ออกแล้วข้าม ไม่ล้มทั้งชุด
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
      skipped.push({
        roomNumber: row.roomNumber,
        invoiceNumber: row.existingInvoiceNumber,
        reason: 'ออกบิลของเดือนนี้ไปแล้ว'
      })
      continue
    }

    if (row.startsThisMonth) {
      skipped.push({
        roomNumber: row.roomNumber,
        invoiceNumber: null,
        reason: 'เพิ่งย้ายเข้าเดือนนี้ จ่ายค่าเช่าเดือนแรกแล้ว'
      })
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
      // ห้องหนึ่งพังไม่ทำให้ห้องอื่นออกไม่ได้
      failed.push({ roomNumber: row.roomNumber, message: err.message })
    }
  }

  return { created, skipped, failed }
}

export function getInvoiceById(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT i.*, r.room_number, a.apartment_id, a.name_th AS apartment_name,
              a.address_th AS apartment_address, a.phone AS apartment_phone,
              a.qr_code_image_id, a.is_vat_enabled, a.payment_instructions, a.invoice_note,
              a.show_tenant_info_in_invoice,
              cu.full_name AS cancelled_by_name
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
         LEFT JOIN users cu ON cu.user_id = i.cancelled_by
        WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) return null

  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY invoice_item_id')
    .all(invoiceId)

  // ผู้เช่าหลักขึ้นก่อน · ซ่อนได้ด้วย show_tenant_info_in_invoice
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

  // ยอดชำระคำนวณสดจากใบเสร็จ ไม่นับใบที่ยกเลิก
  const paidCents = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid
         FROM payments WHERE invoice_id = ? AND cancelled_at IS NULL`
    )
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
    // ใช้ธงนี้ตัดสินว่าแสดงแถว VAT — ไม่ใช่ดูว่ายอดเป็น 0
    isVatEnabled: row.is_vat_enabled === 1,
    // อัตราของบิลใบนี้ ไม่ใช่ของหอตอนนี้
    vatRate: Number(row.vat_rate ?? DEFAULT_VAT_RATE),
    totalAmountCents: row.total_amount_cents,
    paidAmountCents: paidCents,
    outstandingCents: row.total_amount_cents - paidCents,
    note: row.note,
    cancelledAt: row.cancelled_at,
    // บิลที่ยกเลิกก่อน migration 024 ไม่มีเหตุผล — คืน null
    cancelReason: row.cancel_reason ?? null,
    cancelledByName: row.cancelled_by_name ?? null,
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

// ค้างชำระรวม partial_paid · บิลที่ยกเลิกมีกลุ่มของตัวเอง (กรองด้วยสถานะ ไม่ใช่ยอดค้าง)
const SETTLEMENT_STATUSES = {
  outstanding: ['unpaid', 'partial_paid'],
  paid: ['paid'],
  cancelled: ['cancelled']
}

// today มีไว้ให้เทสต์ตรึงวัน
export function listInvoices(
  db,
  apartmentId,
  { status, settlement, billingMonth, billingYear, roomNumber, invoiceNumber, dateFrom, dateTo, today } = {}
) {
  const where = ['f.apartment_id = @apartmentId']
  if (status) where.push('i.status = @status')

  if (settlement) {
    const statuses = SETTLEMENT_STATUSES[settlement]
    // ค่าที่ไม่รู้จักต้อง error ไม่คืนทั้งหมดเงียบๆ
    if (!statuses) throw new Error(`ตัวกรองสถานะไม่ถูกต้อง: ${settlement}`)
    // ค่ามาจากค่าคงที่ของเราเอง ต่อเป็นข้อความได้
    where.push(`i.status IN (${statuses.map((s) => `'${s}'`).join(', ')})`)
  }

  if (billingMonth) where.push('i.billing_month = @billingMonth')
  if (billingYear) where.push("i.billing_month LIKE @billingYear || '-%'")
  if (roomNumber) where.push('r.room_number LIKE @roomNumber')
  if (invoiceNumber) where.push('i.invoice_number LIKE @invoiceNumber')
  // ใส่ข้างเดียวได้
  if (dateFrom) where.push('i.issue_date >= @dateFrom')
  if (dateTo) where.push('i.issue_date <= @dateTo')

  return db
    .prepare(
      `SELECT i.invoice_id, i.contract_id, i.invoice_number, i.issue_date, i.due_date, i.status,
              i.total_amount_cents, i.billing_month, r.room_number,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id
                           AND p.cancelled_at IS NULL), 0) AS paid
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
      billingYear: billingYear ? String(billingYear) : null,
      roomNumber: roomNumber ? `%${roomNumber}%` : null,
      invoiceNumber: invoiceNumber ? `%${invoiceNumber}%` : null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null
    })
    .map((row) => ({
      invoiceId: row.invoice_id,
      // ขั้นตอนย้ายออกใช้กรองบิลของสัญญานี้
      contractId: row.contract_id,
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
      overdueDays:
        row.status === 'unpaid' || row.status === 'partial_paid'
          ? Math.max(0, daysBetween(row.due_date, today ?? todayIso()))
          : 0
    }))
}

// ดึงจากบิลที่มีจริง
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

export function addInvoiceItem(db, invoiceId, { itemType, description, amount, isTaxable }) {
  const invoice = requireOpenInvoice(db, invoiceId)

  if (!ITEM_TYPES.includes(itemType)) throw new Error(`ชนิดรายการไม่ถูกต้อง: ${itemType}`)
  const label = String(description ?? '').trim()
  if (!label) throw new FieldError({ description: 'กรุณากรอกชื่อรายการ' })

  let magnitude
  try {
    magnitude = toCents(amount, itemType === 'discount' ? 'ส่วนลด' : 'จำนวนเงิน')
  } catch (err) {
    throw new FieldError({ amount: err.message })
  }
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
        // ส่วนลดไม่คิด VAT · ต้องเช็คสวิตช์ VAT ของหอด้วย ไม่เชื่อ isTaxable อย่างเดียว
        isTaxable:
          invoice.is_vat_enabled === 1 && itemType !== 'discount' && Boolean(isTaxable)
      }
    ], now, Number(invoice.vat_rate ?? DEFAULT_VAT_RATE))
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

// สถานะบิลคิดจากยอดรวมกับยอดรับ — ต้องคิดใหม่ทุกครั้งที่ฝั่งใดฝั่งหนึ่งเปลี่ยน
export function refreshInvoiceStatus(db, invoiceId, now) {
  const row = db
    .prepare(
      `SELECT i.total_amount_cents AS total, i.status,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id
                           AND p.cancelled_at IS NULL), 0) AS paid
         FROM invoices i WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) return

  // 'cancelled' ชนะทุกอย่าง
  if (row.status === 'cancelled') return

  // บิลยอด 0 หรือติดลบ = ชำระครบ
  let status = 'unpaid'
  if (row.paid >= row.total) status = 'paid'
  else if (row.paid > 0) status = 'partial_paid'

  if (status === row.status) return
  db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE invoice_id = ?').run(
    status,
    now,
    invoiceId
  )
}

// รวมใหม่ทั้งใบ · อ่านอัตรา VAT จากบิล ไม่ใช่จากหอ
function recalculateTotals(db, invoiceId, now) {
  const invoice = db
    .prepare('SELECT vat_rate FROM invoices WHERE invoice_id = ?')
    .get(invoiceId)
  const vatRate = Number(invoice?.vat_rate ?? DEFAULT_VAT_RATE)

  const rows = db
    .prepare('SELECT vat_rate, total_amount_cents FROM invoice_items WHERE invoice_id = ?')
    .all(invoiceId)

  const totals = calculateInvoiceTotals(
    rows.map((row) => ({
      totalAmountCents: row.total_amount_cents,
      isTaxable: Number(row.vat_rate) > 0
    })),
    vatRate
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

  refreshInvoiceStatus(db, invoiceId, now)
}

function requireOpenInvoice(db, invoiceId) {
  const row = db
    .prepare(
      // สวิตช์ VAT ยังอ่านสดจากหอ (ตรึงแค่อัตรา) — รู้แล้ว ยังไม่แก้
      `SELECT i.invoice_id, i.status, i.vat_rate, a.is_vat_enabled
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

// ไม่ลบ ทำเครื่องหมายยกเลิก · เหตุผลบังคับกรอก
export function cancelInvoice(db, invoiceId, { reason, cancelledBy } = {}) {
  const invoice = getInvoiceById(db, invoiceId)
  if (!invoice) throw new Error('ไม่พบใบแจ้งหนี้')
  if (invoice.status === 'cancelled') throw new Error('ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว')
  if (invoice.paidAmountCents !== 0) {
    throw new Error(
      'ยกเลิกไม่ได้ เพราะใบแจ้งหนี้นี้มีการรับชำระเงินแล้ว กรุณายกเลิกใบเสร็จให้ครบก่อน'
    )
  }

  const note = String(reason ?? '').trim()
  if (!note) throw new FieldError({ reason: 'กรุณาระบุเหตุผลในการยกเลิกใบแจ้งหนี้' })
  if (!cancelledBy) throw new Error('ไม่ทราบผู้ยกเลิก กรุณาเข้าสู่ระบบใหม่')

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE invoices
        SET status = 'cancelled', cancelled_at = @now, cancel_reason = @reason,
            cancelled_by = @by, updated_at = @now
      WHERE invoice_id = @invoiceId`
  ).run({ now, reason: note, by: cancelledBy, invoiceId })

  return getInvoiceById(db, invoiceId)
}

// ค่าปรับคิดตอนรับเงิน ไม่ใช่ตอนออกบิล · นับจากวันครบกำหนดถึงวันรับเงิน หักวันผ่อนผัน
export function calculateLateFee({ dueDate, paymentDate, ratePerDayCents, graceDays }) {
  const empty = { overdueDays: 0, chargeableDays: 0, amountCents: 0 }
  if (!isDate(dueDate) || !isDate(paymentDate)) return empty

  const overdueDays = daysBetween(dueDate, paymentDate)
  if (overdueDays <= 0) return empty

  // ผ่อนผัน 3 วัน = เริ่มปรับวันที่ 4
  const chargeableDays = Math.max(0, overdueDays - Math.max(0, graceDays ?? 0))
  return {
    overdueDays,
    chargeableDays,
    amountCents: chargeableDays * Math.max(0, ratePerDayCents ?? 0)
  }
}

// เทียบแบบ UTC กันเขตเวลาทำให้วันเพี้ยน
function daysBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd)
  const to = Date.UTC(ty, tm - 1, td)
  return Math.round((to - from) / 86400000)
}

// เพดานค่าปรับ — ลดได้ แต่เก็บเกินไม่ได้
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

  // หักค่าปรับที่เก็บไปแล้ว ไม่ปรับซ้ำ
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
    // เปิดสวิตช์แต่อัตราเป็น 0 = ตั้งค่าไม่ครบ
    misconfigured: row.is_auto_late_fee_enabled === 1 && row.late_fee_per_day_cents === 0,
    dueDate: row.due_date,
    ratePerDayCents: row.late_fee_per_day_cents,
    graceDays,
    overdueDays: fee.overdueDays,
    chargeableDays: fee.chargeableDays,
    alreadyChargedCents: already,
    suggestedCents: enabled ? Math.max(0, fee.amountCents - already) : 0
  }
}

export function addLateFeeItem(db, invoiceId, { amountCents, overdueDays }) {
  const now = new Date().toISOString()
  // insertItems ต้องได้อัตราของบิล — recalculateTotals คิด VAT ทั้งใบใหม่
  const invoice = db.prepare('SELECT vat_rate FROM invoices WHERE invoice_id = ?').get(invoiceId)
  const vatRate = Number(invoice?.vat_rate ?? DEFAULT_VAT_RATE)
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
      now,
      vatRate
    )
    recalculateTotals(db, invoiceId, now)
  })
  run()
}

// ถอดค่าปรับเมื่อไม่เหลือใบเสร็จที่ใช้ได้ (ดู cancelPayment)
export function removeLateFeeItems(db, invoiceId, now) {
  const result = db
    .prepare("DELETE FROM invoice_items WHERE invoice_id = ? AND item_type = 'late_fee'")
    .run(invoiceId)
  if (result.changes > 0) recalculateTotals(db, invoiceId, now)
  return result.changes
}

// ลบได้เฉพาะใบที่ยกเลิกแล้ว · เหตุผลเก็บที่ invoice_deletions
export function deleteInvoice(db, invoiceId, { reason, deletedBy }) {
  const invoice = getInvoiceById(db, invoiceId)
  if (!invoice) throw new Error('ไม่พบใบแจ้งหนี้ที่ต้องการลบ')

  if (invoice.status !== 'cancelled') {
    throw new Error('ลบได้เฉพาะใบแจ้งหนี้ที่ยกเลิกแล้ว กรุณายกเลิกบิลก่อน')
  }

  const note = String(reason ?? '').trim()
  if (!note) throw new FieldError({ reason: 'กรุณาระบุเหตุผลในการลบใบแจ้งหนี้' })
  if (!deletedBy) throw new Error('ไม่ทราบผู้ลบ กรุณาเข้าสู่ระบบใหม่')

  // เคยมีใบเสร็จ (แม้ยกเลิกแล้ว) ลบไม่ได้
  const payments = db
    .prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?')
    .get(invoiceId).n
  if (payments > 0) {
    throw new Error(
      'ลบไม่ได้ เพราะเคยออกใบเสร็จให้ใบแจ้งหนี้นี้แล้ว (นับใบที่ยกเลิกแล้วด้วย) ' +
        'ใบแจ้งหนี้จะค้างไว้เป็นสถานะยกเลิกแทน'
    )
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

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}
