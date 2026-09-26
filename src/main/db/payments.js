// ใบเสร็จผูกกับใบแจ้งหนี้ หรือกับสัญญา (เงินประกัน/ล่วงหน้า) อย่างใดอย่างหนึ่ง
import { toCents } from '../money.js'
import { FieldError, errorList, throwIfErrors } from '../fieldError.js'
import {
  addLateFeeItem,
  getLateFeeForInvoice,
  listInvoices,
  nextDocumentNumber,
  refreshInvoiceStatus,
  removeLateFeeItems
} from './invoices.js'

export const PAYMENT_METHODS = ['cash', 'transfer', 'other']

export const PAYMENT_METHOD_LABELS = {
  cash: 'เงินสด',
  transfer: 'เงินโอน',
  other: 'อื่นๆ'
}

export const PAYMENT_PURPOSES = ['invoice', 'deposit', 'advance', 'other']

export const PAYMENT_PURPOSE_LABELS = {
  invoice: 'ค่าบิล',
  deposit: 'เงินประกัน',
  advance: 'ค่าเช่าล่วงหน้า',
  other: 'อื่นๆ'
}

// ไม่มีการลบใบเสร็จ — ใช้ cancelPayment (แถวยังอยู่แต่ไม่นับ)

function moneyField(field, value, label) {
  try {
    return toCents(value, label)
  } catch (err) {
    throw new FieldError({ [field]: err.message })
  }
}

function validateCommon({ paymentMethod, paymentDate }) {
  const errors = errorList()
  if (!PAYMENT_METHODS.includes(paymentMethod)) errors.add('paymentMethod', 'กรุณาเลือกช่องทางการชำระเงิน')
  if (!isDate(paymentDate)) errors.add('paymentDate', 'กรุณาระบุวันที่รับเงิน')
  return errors
}

// lateFee ลดได้ แต่เกินเพดานที่หอตั้งไม่ได้
export function recordInvoicePayment(
  db,
  { invoiceId, amount, paymentMethod, paymentDate, remark, createdBy, lateFee }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  throwIfErrors(errors)

  // ทั้งหมดอยู่ในธุรกรรมเดียว — ยอดเกินต้องไม่ทิ้งค่าปรับค้างบนบิล
  const run = db.transaction(() => {
    // ค่าปรับเข้าบิลก่อนคิดยอดค้าง
    const lateFeeCents = lateFee ? moneyField('lateFee', lateFee, 'ค่าปรับชำระล่าช้า') : 0
    if (lateFeeCents > 0) {
      const rule = getLateFeeForInvoice(db, invoiceId, paymentDate)
      if (!rule.enabled) {
        throw new FieldError({ lateFee: 'หอพักนี้ไม่ได้เปิดการเก็บค่าปรับชำระล่าช้า' })
      }
      if (lateFeeCents > rule.suggestedCents) {
        throw new FieldError({
          lateFee: `ค่าปรับเกินกว่าที่กฎของหอกำหนด — เก็บได้ไม่เกิน ${formatBaht(rule.suggestedCents)} บาท`
        })
      }
      addLateFeeItem(db, invoiceId, {
        amountCents: lateFeeCents,
        overdueDays: rule.overdueDays
      })
    }

    const invoice = loadInvoiceForPayment(db, invoiceId)
    const amountCents = moneyField('amount', amount, 'จำนวนเงิน')
    if (amountCents === 0) throw new FieldError({ amount: 'จำนวนเงินต้องมากกว่า 0' })

    // รับเกินยอดค้างไม่ได้
    const outstanding = invoice.totalAmountCents - invoice.paidCents
    if (amountCents > outstanding) {
      throw new FieldError({
        amount:
          `รับเงินได้ไม่เกินยอดค้างชำระ ${formatBaht(outstanding)} บาท ` +
          `(กรอกมา ${formatBaht(amountCents)} บาท)`
      })
    }

    return writePayment(db, {
      invoiceId,
      contractId: null,
      apartmentId: invoice.apartmentId,
      amountCents,
      purpose: 'invoice',
      paymentMethod,
      paymentDate,
      remark,
      createdBy
    })
  })

  return run()
}

// หลายห้องพร้อมกัน: ใบเสร็จแยกต่อบิล แต่สำเร็จหรือล้มทั้งชุด
export function recordInvoicePayments(
  db,
  { rows, paymentMethod, paymentDate, remark, createdBy }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  throwIfErrors(errors)

  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.invoiceId)
  if (list.length === 0) throw new Error('ยังไม่ได้เลือกห้องที่จะรับเงิน')

  // ใบเดียวกันสองแถว = รับเงินซ้ำ
  const seen = new Set()
  for (const row of list) {
    if (seen.has(row.invoiceId)) throw new Error('มีใบแจ้งหนี้ซ้ำกันในรายการที่เลือก')
    seen.add(row.invoiceId)
  }

  // เรียก recordInvoicePayment ทีละใบ ให้กฎอยู่ที่เดียว
  const run = db.transaction(() =>
    list.map((row) => {
      try {
        return recordInvoicePayment(db, {
          invoiceId: row.invoiceId,
          amount: row.amount,
          lateFee: row.lateFee,
          paymentMethod,
          paymentDate,
          remark,
          createdBy
        })
      } catch (err) {
        const label = row.roomNumber ? `ห้อง ${row.roomNumber}` : `ใบแจ้งหนี้ #${row.invoiceId}`
        throw new Error(`${label}: ${err.message}`)
      }
    })
  )

  return run()
}

// ส่งบิลที่จ่ายครบมาด้วย — หน้าจอปิดไม่ให้ติ๊ก
export function getMultiPaymentSheet(db, apartmentId, { billingMonth, paymentDate } = {}) {
  return listInvoices(db, apartmentId, { billingMonth }).map((invoice) => ({
    ...invoice,
    lateFee:
      invoice.status === 'cancelled' || invoice.outstandingCents <= 0
        ? null
        : getLateFeeForInvoice(db, invoice.invoiceId, paymentDate)
  }))
}

// ยกเลิก ≠ คืนเงิน — ไม่มีการคืนเงินค่าบิล · แถวไม่ถูกลบ
export function cancelPayment(db, paymentId, { reason, cancelledBy }) {
  const row = db
    .prepare('SELECT payment_id, invoice_id, cancelled_at FROM payments WHERE payment_id = ?')
    .get(paymentId)
  if (!row) throw new Error('ไม่พบใบเสร็จที่ต้องการยกเลิก')
  if (row.cancelled_at) throw new Error('ใบเสร็จนี้ถูกยกเลิกไปแล้ว')

  const note = String(reason ?? '').trim()
  if (!note) throw new FieldError({ reason: 'กรุณาระบุเหตุผลในการยกเลิกใบเสร็จ' })
  if (!cancelledBy) throw new Error('ไม่ทราบผู้ยกเลิก กรุณาเข้าสู่ระบบใหม่')

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE payments SET cancelled_at = @now, cancel_reason = @reason, cancelled_by = @by
        WHERE payment_id = @paymentId`
    ).run({ now, reason: note, by: cancelledBy, paymentId })

    if (!row.invoice_id) return 0

    // ไม่เหลือใบเสร็จที่ใช้ได้ ค่าปรับที่เข้าบิลต้องออกด้วย
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS n FROM payments
          WHERE invoice_id = ? AND cancelled_at IS NULL`
      )
      .get(row.invoice_id).n
    const removed = remaining === 0 ? removeLateFeeItems(db, row.invoice_id, now) : 0

    refreshInvoiceStatus(db, row.invoice_id, now)
    return removed
  })

  const lateFeeItemsRemoved = run()
  return { payment: getPaymentById(db, paymentId), lateFeeItemsRemoved }
}

// เงินของสัญญา ไม่ผ่านใบแจ้งหนี้ · ติดลบได้ (คืนเงินประกัน)
export function recordContractPayment(
  db,
  { contractId, amount, paymentMethod, paymentDate, remark, createdBy, isRefund, purpose }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  const kind = purpose ?? 'deposit'
  if (!PAYMENT_PURPOSES.includes(kind)) errors.push(`ประเภทเงินไม่ถูกต้อง: ${purpose}`)
  if (kind === 'invoice') errors.push('ใบเสร็จของสัญญาเป็นค่าบิลไม่ได้ — ค่าบิลต้องผูกกับใบแจ้งหนี้')
  throwIfErrors(errors)

  const contract = db
    .prepare(
      `SELECT c.contract_id, f.apartment_id
         FROM contracts c
         JOIN rooms r  ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE c.contract_id = ?`
    )
    .get(contractId)
  if (!contract) throw new Error('ไม่พบสัญญาที่ต้องการออกใบเสร็จ')

  let magnitude
  try {
    magnitude = toCents(amount, 'จำนวนเงิน')
  } catch (err) {
    throw new FieldError({ amount: err.message })
  }
  if (magnitude === 0) throw new FieldError({ amount: 'จำนวนเงินต้องมากกว่า 0' })

  // ใบเสร็จของสัญญาต้องมีข้อความบอกเสมอว่าเป็นเงินก้อนไหน
  const label = String(remark ?? '').trim()
  const fallback = isRefund
    ? `คืน${PAYMENT_PURPOSE_LABELS[kind] ?? 'เงินตามสัญญาเช่า'}`
    : PAYMENT_PURPOSE_LABELS[kind] ?? 'เงินตามสัญญาเช่า'

  return writePayment(db, {
    invoiceId: null,
    contractId,
    apartmentId: contract.apartment_id,
    amountCents: isRefund ? -magnitude : magnitude,
    purpose: kind,
    paymentMethod,
    paymentDate,
    remark: label || fallback,
    createdBy
  })
}

// เงินประกันที่รับจริง = ผลรวมใบเสร็จเงินประกัน (รวมเงินจอง, ใบคืนเป็นลบ)
export function getDepositStatus(db, contractId) {
  const row = db
    .prepare('SELECT deposit_amount_cents FROM contracts WHERE contract_id = ?')
    .get(contractId)
  if (!row) throw new Error('ไม่พบสัญญา')

  const received = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM payments
        WHERE contract_id = ? AND purpose = 'deposit' AND cancelled_at IS NULL`
    )
    .get(contractId).total

  const requiredCents = row.deposit_amount_cents
  return {
    requiredCents,
    receivedCents: received,
    // เก็บเกินได้ แต่ยอดค้างไม่ติดลบ
    outstandingCents: Math.max(0, requiredCents - received),
    isSettled: received >= requiredCents
  }
}

// ออกเลข + เขียนแถว + คิดสถานะบิล ในธุรกรรมเดียว
function writePayment(
  db,
  {
    invoiceId,
    contractId,
    apartmentId,
    amountCents,
    purpose,
    paymentMethod,
    paymentDate,
    remark,
    createdBy
  }
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้รับเงิน กรุณาเข้าสู่ระบบใหม่')

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    const receiptNumber = nextDocumentNumber(db, apartmentId, 'receipt', paymentDate)
    const result = db
      .prepare(
        // เลขใบเสร็จเดินแยกรายหอ
        `INSERT INTO payments (
           invoice_id, contract_id, apartment_id, receipt_number, payment_date,
           amount_cents, vat_amount_cents, purpose, payment_method, remark,
           created_by, created_at
         ) VALUES (
           @invoiceId, @contractId, @apartmentId, @receiptNumber, @paymentDate,
           @amountCents, 0, @purpose, @paymentMethod, @remark, @createdBy, @now
         )`
      )
      .run({
        invoiceId,
        contractId,
        apartmentId,
        receiptNumber,
        paymentDate,
        amountCents,
        purpose,
        paymentMethod,
        remark: String(remark ?? '').trim() || null,
        createdBy,
        now
      })

    if (invoiceId) refreshInvoiceStatus(db, invoiceId, now)
    return result.lastInsertRowid
  })

  return getPaymentById(db, run())
}

function loadInvoiceForPayment(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT i.invoice_id, i.status, i.total_amount_cents, f.apartment_id,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id
                           AND p.cancelled_at IS NULL), 0) AS paid
         FROM invoices i
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
        WHERE i.invoice_id = ?`
    )
    .get(invoiceId)
  if (!row) throw new Error('ไม่พบใบแจ้งหนี้')
  if (row.status === 'cancelled') throw new Error('ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว รับชำระไม่ได้')

  return {
    invoiceId: row.invoice_id,
    apartmentId: row.apartment_id,
    totalAmountCents: row.total_amount_cents,
    paidCents: row.paid
  }
}

export function getPaymentById(db, paymentId) {
  const row = db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name,
              cu.full_name AS cancelled_by_name
         FROM payments p
         LEFT JOIN invoices i  ON i.invoice_id = p.invoice_id
         LEFT JOIN contracts c ON c.contract_id = COALESCE(p.contract_id, i.contract_id)
         LEFT JOIN rooms r     ON r.room_id = c.room_id
         LEFT JOIN users u     ON u.user_id = p.created_by
         LEFT JOIN users cu    ON cu.user_id = p.cancelled_by
        WHERE p.payment_id = ?`
    )
    .get(paymentId)
  return row ? toPublicPayment(row) : null
}

export function listPaymentsForInvoice(db, invoiceId) {
  return db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name,
              cu.full_name AS cancelled_by_name
         FROM payments p
         JOIN invoices i  ON i.invoice_id = p.invoice_id
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         LEFT JOIN users u  ON u.user_id = p.created_by
         LEFT JOIN users cu ON cu.user_id = p.cancelled_by
        WHERE p.invoice_id = ?
        ORDER BY p.payment_date, p.payment_id`
    )
    .all(invoiceId)
    .map(toPublicPayment)
}

// ดึงสดทุกครั้งที่พิมพ์ · เรียงตามวันที่รับเงิน · ไม่เอาใบที่ยกเลิก
export function listContractReceipts(db, contractId) {
  return db
    .prepare(
      `SELECT p.*, r.room_number, u.full_name AS created_by_name,
              cu.full_name AS cancelled_by_name,
              a.name_th AS apartment_name, a.address_th AS apartment_address,
              a.phone AS apartment_phone
         FROM payments p
         JOIN contracts c ON c.contract_id = p.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
         LEFT JOIN users u  ON u.user_id = p.created_by
         LEFT JOIN users cu ON cu.user_id = p.cancelled_by
        WHERE p.contract_id = ? AND p.cancelled_at IS NULL
        ORDER BY p.payment_date, p.payment_id`
    )
    .all(contractId)
    .map(toPublicPayment)
}

export function listReceipts(db, apartmentId, { dateFrom, dateTo } = {}) {
  const where = ['f.apartment_id = @apartmentId']
  if (dateFrom) where.push('p.payment_date >= @dateFrom')
  if (dateTo) where.push('p.payment_date <= @dateTo')

  const rows = db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name,
              cu.full_name AS cancelled_by_name,
              a.name_th AS apartment_name, a.address_th AS apartment_address,
              a.phone AS apartment_phone,
              -- ชื่อผู้เช่าหลักของสัญญา — ใบเสร็จที่ยื่นให้คนหนึ่งต้องมีชื่อคนนั้นอยู่บนนั้น
              (SELECT t.first_name || ' ' || t.last_name
                 FROM contract_tenants ct
                 JOIN tenants t ON t.tenant_id = ct.tenant_id
                WHERE ct.contract_id = c.contract_id
                ORDER BY ct.is_primary DESC, t.tenant_id
                LIMIT 1) AS tenant_name
         FROM payments p
         LEFT JOIN invoices i  ON i.invoice_id = p.invoice_id
         JOIN contracts c ON c.contract_id = COALESCE(p.contract_id, i.contract_id)
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
         LEFT JOIN users u  ON u.user_id = p.created_by
         LEFT JOIN users cu ON cu.user_id = p.cancelled_by
        WHERE ${where.join(' AND ')}
        ORDER BY p.payment_date DESC, p.payment_id DESC`
    )
    .all({ apartmentId, dateFrom: dateFrom || null, dateTo: dateTo || null })
    .map(toPublicPayment)

  // ใบที่ยกเลิกอยู่ในรายการ แต่ไม่นับเข้ายอด
  const active = rows.filter((row) => !row.isCancelled)

  return {
    receipts: rows,
    receiptCount: active.length,
    cancelledCount: rows.length - active.length,
    // ใบคืนเงินนับเป็นลบ
    totalAmountCents: active.reduce((sum, row) => sum + row.amountCents, 0)
  }
}

function toPublicPayment(row) {
  return {
    paymentId: row.payment_id,
    receiptNumber: row.receipt_number,
    paymentDate: row.payment_date,
    amountCents: row.amount_cents,
    paymentMethod: row.payment_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method,
    purpose: row.purpose,
    purposeLabel: PAYMENT_PURPOSE_LABELS[row.purpose] ?? row.purpose,
    remark: row.remark,
    roomNumber: row.room_number,
    invoiceId: row.invoice_id,
    contractId: row.contract_id,
    sourceType: row.invoice_id ? 'invoice' : 'contract',
    sourceLabel: row.invoice_id ? `ใบแจ้งหนี้ #${row.invoice_number}` : 'สัญญา',
    isRefund: row.amount_cents < 0,
    isCancelled: Boolean(row.cancelled_at),
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelledByName: row.cancelled_by_name ?? null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    tenantName: row.tenant_name ?? null,
    apartment: row.apartment_name
      ? {
          name: row.apartment_name,
          address: row.apartment_address,
          phone: row.apartment_phone
        }
      : null
  }
}

function formatBaht(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
