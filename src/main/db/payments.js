// ตาราง payments — การรับชำระเงินและใบเสร็จ SQL ดิบล้วน ไม่มี ORM
//
// โครงตามหน้าจริงของต้นแบบ:
// - การ์ด "รับเงิน" ข้างใบแจ้งหนี้: จำนวนเงิน / ชำระเงินโดย / วันที่รับเงิน / หมายเหตุ
//   แล้วมี "รายการรับเงิน" ไล่ประวัติอยู่ใต้การ์ด
// - "รายงานใบเสร็จรับเงิน": กรองตามเดือน + การ์ดสรุป (จำนวนใบ / ยอดรวม) + ตาราง
//   เลขใบเสร็จ | วันที่ | ห้อง | ช่องทาง | ยอดรับเงิน | ประเภท | ผู้รับเงิน
//
// ใบเสร็จหนึ่งใบผูกกับ *ใบแจ้งหนี้* หรือ *สัญญา* อย่างใดอย่างหนึ่ง (ดู migration 012)
// ฝั่งสัญญาคือเงินประกัน/เงินล่วงหน้าที่เก็บตอนทำสัญญา ซึ่งไม่มีใบแจ้งหนี้อยู่เบื้องหลัง
// — ตรงกับคอลัมน์ "ประเภท" ของต้นแบบที่ขึ้นได้ทั้ง "ใบแจ้งหนี้ #Ixxxx" และ "สัญญา"
//
// ห้าม import logger.js หรืออะไรที่ลาก electron เข้ามา (เทสต์รันใต้ ELECTRON_RUN_AS_NODE)
import { toCents } from '../money.js'
import { nextDocumentNumber } from './invoices.js'

export const PAYMENT_METHODS = ['cash', 'transfer', 'other']

export const PAYMENT_METHOD_LABELS = {
  cash: 'เงินสด',
  transfer: 'เงินโอน',
  other: 'อื่นๆ'
}

// **ไม่มีฟังก์ชันลบใบเสร็จโดยตั้งใจ**
// ใบเสร็จที่หายไปเฉยๆ ทำให้ยอดรับเงินย้อนหลังกระทบไม่ได้ และเลขใบเสร็จที่ออกให้ผู้เช่า
// ไปแล้วจะชี้ไปที่ความว่างเปล่า การแก้ที่รับเงินผิดทำโดย "คืนเงิน" ซึ่งเป็นใบเสร็จยอดติดลบ
// อีกใบหนึ่ง — ตรงกับที่ต้นแบบแสดง -1,000.00 ในรายงานใบเสร็จ

// ------------------------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// ------------------------------------------------------------------
function validateCommon({ paymentMethod, paymentDate }) {
  const errors = []
  if (!PAYMENT_METHODS.includes(paymentMethod)) errors.push('กรุณาเลือกช่องทางการชำระเงิน')
  if (!isDate(paymentDate)) errors.push('กรุณาระบุวันที่รับเงิน')
  return errors
}

// ------------------------------------------------------------------
// รับชำระค่าใบแจ้งหนี้
// ------------------------------------------------------------------
export function recordInvoicePayment(
  db,
  { invoiceId, amount, paymentMethod, paymentDate, remark, createdBy }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const invoice = loadInvoiceForPayment(db, invoiceId)
  const amountCents = toCents(amount, 'จำนวนเงิน')
  if (amountCents === 0) throw new Error('จำนวนเงินต้องมากกว่า 0')

  // จ่ายเกินยอดค้างไม่ได้ — เงินส่วนเกินไม่มีที่ไป และยอดค้างจะกลายเป็นติดลบ
  // ซึ่งอ่านไม่ออกว่าแปลว่าอะไร ถ้าผู้เช่าจ่ายเกินจริง ให้ออกใบเสร็จเท่ายอดค้าง
  // แล้วส่วนเกินไปเป็นเงินล่วงหน้าของสัญญา
  const outstanding = invoice.totalAmountCents - invoice.paidCents
  if (amountCents > outstanding) {
    throw new Error(
      `รับเงินได้ไม่เกินยอดค้างชำระ ${formatBaht(outstanding)} บาท ` +
        `(กรอกมา ${formatBaht(amountCents)} บาท)`
    )
  }

  return writePayment(db, {
    invoiceId,
    contractId: null,
    apartmentId: invoice.apartmentId,
    amountCents,
    paymentMethod,
    paymentDate,
    remark,
    createdBy
  })
}

// คืนเงินที่รับไปแล้วบางส่วนหรือทั้งหมด — เขียนเป็นใบเสร็จยอดติดลบ ไม่ใช่ลบใบเดิม
export function refundInvoicePayment(
  db,
  { invoiceId, amount, paymentMethod, paymentDate, remark, createdBy }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const invoice = loadInvoiceForPayment(db, invoiceId)
  const amountCents = toCents(amount, 'จำนวนเงินที่คืน')
  if (amountCents === 0) throw new Error('จำนวนเงินที่คืนต้องมากกว่า 0')

  // คืนได้ไม่เกินที่รับมาจริง ไม่งั้นยอดที่ชำระแล้วจะติดลบ
  if (amountCents > invoice.paidCents) {
    throw new Error(
      `คืนเงินได้ไม่เกินยอดที่รับมาแล้ว ${formatBaht(invoice.paidCents)} บาท ` +
        `(กรอกมา ${formatBaht(amountCents)} บาท)`
    )
  }

  return writePayment(db, {
    invoiceId,
    contractId: null,
    apartmentId: invoice.apartmentId,
    amountCents: -amountCents,
    paymentMethod,
    paymentDate,
    remark,
    createdBy
  })
}

// ------------------------------------------------------------------
// ใบเสร็จของสัญญา (เงินประกัน / เงินล่วงหน้า / เงินจอง)
// ------------------------------------------------------------------
// ต้นแบบมีปุ่มพิมพ์ใบเสร็จเงินประกัน/เงินล่วงหน้าอยู่ในหน้ารายละเอียดห้อง และรายงาน
// ใบเสร็จขึ้นประเภทเป็น "สัญญา" — เงินก้อนนี้ไม่ผ่านใบแจ้งหนี้
//
// ยอดติดลบได้ตรงๆ เพราะการคืนเงินประกันตอนย้ายออก (Phase 4) จะใช้ทางนี้
export function recordContractPayment(
  db,
  { contractId, amount, paymentMethod, paymentDate, remark, createdBy, isRefund }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  if (errors.length > 0) throw new Error(errors.join('\n'))

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

  const magnitude = toCents(amount, 'จำนวนเงิน')
  if (magnitude === 0) throw new Error('จำนวนเงินต้องมากกว่า 0')

  return writePayment(db, {
    invoiceId: null,
    contractId,
    apartmentId: contract.apartment_id,
    amountCents: isRefund ? -magnitude : magnitude,
    paymentMethod,
    paymentDate,
    remark,
    createdBy
  })
}

// ------------------------------------------------------------------
// เขียนจริง
// ------------------------------------------------------------------
// ออกเลขใบเสร็จ + เขียนแถว + คิดสถานะบิลใหม่ ในธุรกรรมเดียว
// ถ้าแยกกัน จะมีจังหวะที่ใบเสร็จมีอยู่แล้วแต่สถานะบิลยังเป็น "ค้างชำระ"
function writePayment(
  db,
  { invoiceId, contractId, apartmentId, amountCents, paymentMethod, paymentDate, remark, createdBy }
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้รับเงิน กรุณาเข้าสู่ระบบใหม่')

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    const receiptNumber = nextDocumentNumber(db, apartmentId, 'receipt', paymentDate)
    const result = db
      .prepare(
        `INSERT INTO payments (
           invoice_id, contract_id, receipt_number, payment_date,
           amount_cents, vat_amount_cents, payment_method, remark, created_by, created_at
         ) VALUES (
           @invoiceId, @contractId, @receiptNumber, @paymentDate,
           @amountCents, 0, @paymentMethod, @remark, @createdBy, @now
         )`
      )
      .run({
        invoiceId,
        contractId,
        receiptNumber,
        paymentDate,
        amountCents,
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

// สถานะบิลเป็นผลของยอดที่รับมาเสมอ ไม่ใช่สิ่งที่ตั้งค่าแยก — คิดใหม่ทุกครั้งที่เงินขยับ
// ทำแบบนี้แล้วบิลจะกลับไปเป็น "ค้างชำระ" เองถ้าคืนเงินจนหมด โดยไม่ต้องมีตรรกะย้อนกลับ
function refreshInvoiceStatus(db, invoiceId, now) {
  const row = db
    .prepare(
      `SELECT i.total_amount_cents AS total, i.status,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id), 0) AS paid
         FROM invoices i WHERE i.invoice_id = ?`
    )
    .get(invoiceId)

  // บิลที่ถูกยกเลิกไม่ถูกแตะ — สถานะ 'cancelled' ต้องชนะทุกอย่าง
  if (row.status === 'cancelled') return

  let status = 'unpaid'
  if (row.paid >= row.total && row.total > 0) status = 'paid'
  else if (row.paid > 0) status = 'partial_paid'

  db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE invoice_id = ?').run(
    status,
    now,
    invoiceId
  )
}

function loadInvoiceForPayment(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT i.invoice_id, i.status, i.total_amount_cents, f.apartment_id,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                         WHERE p.invoice_id = i.invoice_id), 0) AS paid
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

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function getPaymentById(db, paymentId) {
  const row = db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name
         FROM payments p
         LEFT JOIN invoices i  ON i.invoice_id = p.invoice_id
         LEFT JOIN contracts c ON c.contract_id = COALESCE(p.contract_id, i.contract_id)
         LEFT JOIN rooms r     ON r.room_id = c.room_id
         LEFT JOIN users u     ON u.user_id = p.created_by
        WHERE p.payment_id = ?`
    )
    .get(paymentId)
  return row ? toPublicPayment(row) : null
}

// การ์ด "รายการรับเงิน" ใต้ใบแจ้งหนี้
export function listPaymentsForInvoice(db, invoiceId) {
  return db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name
         FROM payments p
         JOIN invoices i  ON i.invoice_id = p.invoice_id
         JOIN contracts c ON c.contract_id = i.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
         LEFT JOIN users u ON u.user_id = p.created_by
        WHERE p.invoice_id = ?
        ORDER BY p.payment_date, p.payment_id`
    )
    .all(invoiceId)
    .map(toPublicPayment)
}

// รายงานใบเสร็จรับเงิน — กรองตามเดือนได้ พร้อมยอดสรุปสองการ์ดด้านบนตามต้นแบบ
export function listReceipts(db, apartmentId, { month } = {}) {
  const where = ['f.apartment_id = @apartmentId']
  // month = 'YYYY-MM' เทียบกับ payment_date ที่เป็น 'YYYY-MM-DD' ตัดเอา 7 ตัวแรก
  if (month) where.push("substr(p.payment_date, 1, 7) = @month")

  const rows = db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name
         FROM payments p
         LEFT JOIN invoices i  ON i.invoice_id = p.invoice_id
         JOIN contracts c ON c.contract_id = COALESCE(p.contract_id, i.contract_id)
         JOIN rooms r     ON r.room_id = c.room_id
         JOIN floors f    ON f.floor_id = r.floor_id
         LEFT JOIN users u ON u.user_id = p.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY p.payment_date DESC, p.payment_id DESC`
    )
    .all({ apartmentId, month })
    .map(toPublicPayment)

  return {
    receipts: rows,
    receiptCount: rows.length,
    // ยอดรวมนับใบคืนเงินเป็นลบไปด้วย จึงเป็น "เงินที่เข้าหอจริง" ไม่ใช่ผลบวกของใบที่ออก
    totalAmountCents: rows.reduce((sum, row) => sum + row.amountCents, 0)
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
    remark: row.remark,
    roomNumber: row.room_number,
    invoiceId: row.invoice_id,
    contractId: row.contract_id,
    // คอลัมน์ "ประเภท" ของรายงาน: อ้างใบแจ้งหนี้ หรือเป็นเงินก้อนของสัญญา
    sourceType: row.invoice_id ? 'invoice' : 'contract',
    sourceLabel: row.invoice_id ? `ใบแจ้งหนี้ #${row.invoice_number}` : 'สัญญา',
    isRefund: row.amount_cents < 0,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at
  }
}

// ------------------------------------------------------------------
function formatBaht(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
