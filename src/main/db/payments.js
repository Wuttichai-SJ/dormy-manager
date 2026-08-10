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
import {
  addLateFeeItem,
  getLateFeeForInvoice,
  listInvoices,
  nextDocumentNumber,
  refreshInvoiceStatus
} from './invoices.js'

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
// lateFee = ยอดค่าปรับที่จะเรียกเก็บพร้อมกับการรับเงินครั้งนี้ (ไม่ส่งมา = ไม่เก็บ)
//
// เจ้าของหอ "ลดหย่อนได้ แต่เก็บเกินกฎที่ตัวเองตั้งไว้ไม่ได้" — หน้าจอแก้ยอดลงได้
// ส่วนเพดานบังคับที่นี่ ไม่ใช่เชื่อตัวเลขที่หน้าจอส่งมา
export function recordInvoicePayment(
  db,
  { invoiceId, amount, paymentMethod, paymentDate, remark, createdBy, lateFee }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  // ค่าปรับต้องเข้าบิล "ก่อน" คิดยอดค้าง ไม่งั้นเงินที่รับมาคลุมค่าปรับไม่ได้
  const lateFeeCents = lateFee ? toCents(lateFee, 'ค่าปรับชำระล่าช้า') : 0
  if (lateFeeCents > 0) {
    const rule = getLateFeeForInvoice(db, invoiceId, paymentDate)
    if (!rule.enabled) throw new Error('หอพักนี้ไม่ได้เปิดการเก็บค่าปรับชำระล่าช้า')
    if (lateFeeCents > rule.suggestedCents) {
      throw new Error(
        `ค่าปรับเกินกว่าที่กฎของหอกำหนด — เก็บได้ไม่เกิน ${formatBaht(rule.suggestedCents)} บาท`
      )
    }
    addLateFeeItem(db, invoiceId, {
      amountCents: lateFeeCents,
      overdueDays: rule.overdueDays
    })
  }

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

// ------------------------------------------------------------------
// รับเงินหลายห้องในครั้งเดียว
// ------------------------------------------------------------------
// ตรงกับหน้า "รับเงินหลายห้อง" ของต้นแบบ (บิลรายเดือน → multiple-monthly-billings)
// ผู้เช่าหลายคนเดินมาจ่ายพร้อมกันที่โต๊ะเดียว เจ้าของหอจึงกรอกทีเดียวจบ ไม่ต้องเปิดบิล
// ทีละใบแล้วกรอกช่องทาง/วันที่ซ้ำทุกครั้ง
//
// **ยังเป็นใบเสร็จแยกใบต่อหนึ่งใบแจ้งหนี้** ไม่ได้ยุบเป็นใบเดียว — ผู้เช่าแต่ละคนต้องได้
// ใบเสร็จของตัวเองไปถือ และหนี้ของแต่ละห้องเป็นคนละก้อนกัน ที่รวมกันคือ "จังหวะที่รับเงิน"
// เท่านั้น (ช่องทาง/วันที่/หมายเหตุ จึงใช้ร่วมกันทั้งชุด)
//
// **ทั้งชุดสำเร็จหรือไม่สำเร็จพร้อมกัน** ถ้าห้องที่ห้ากรอกยอดเกิน ต้องไม่มีใบเสร็จของ
// สี่ห้องแรกค้างอยู่ — เจ้าของหอที่เห็น error แล้วกดใหม่จะรับเงินซ้ำโดยไม่รู้ตัว
export function recordInvoicePayments(
  db,
  { rows, paymentMethod, paymentDate, remark, createdBy }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.invoiceId)
  if (list.length === 0) throw new Error('ยังไม่ได้เลือกห้องที่จะรับเงิน')

  // ใบเดียวกันสองแถวจะรับเงินซ้ำ — แถวที่สองอาจผ่านการตรวจยอดค้างไปได้ถ้ายอดรวมยังไม่เกิน
  const seen = new Set()
  for (const row of list) {
    if (seen.has(row.invoiceId)) throw new Error('มีใบแจ้งหนี้ซ้ำกันในรายการที่เลือก')
    seen.add(row.invoiceId)
  }

  // เรียก recordInvoicePayment ทีละใบ ไม่ได้เขียน SQL ชุดใหม่ — กฎทั้งหมด (ห้ามเกินยอดค้าง
  // ห้ามรับบิลที่ยกเลิก เพดานค่าปรับ ออกเลขใบเสร็จ คิดสถานะบิลใหม่) จะได้อยู่ที่เดียว
  // better-sqlite3 ทำธุรกรรมซ้อนเป็น SAVEPOINT ให้อยู่แล้ว
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
        // บอกว่าห้องไหนพัง ไม่งั้นเจ้าของหอเห็นแค่ "รับเงินได้ไม่เกินยอดค้าง" แล้วไม่รู้ว่าแถวไหน
        const label = row.roomNumber ? `ห้อง ${row.roomNumber}` : `ใบแจ้งหนี้ #${row.invoiceId}`
        throw new Error(`${label}: ${err.message}`)
      }
    })
  )

  return run()
}

// ตารางสำหรับหน้า "รับเงินหลายห้อง" — บิลของเดือนที่เลือก พร้อมค่าปรับที่คิดได้ ณ วันที่รับเงิน
//
// ส่งบิลที่จ่ายครบแล้วมาด้วย (ต้นแบบก็แสดง) เพราะเจ้าของหอต้องเห็นว่าห้องไหนจ่ายไปแล้ว
// ไม่ใช่ห้องหายไปเฉยๆ จนต้องไปไล่หาว่าตกหล่นหรือจ่ายแล้ว — หน้าจอเป็นคนปิดไม่ให้ติ๊ก
export function getMultiPaymentSheet(db, apartmentId, { billingMonth, paymentDate } = {}) {
  return listInvoices(db, apartmentId, { billingMonth }).map((invoice) => ({
    ...invoice,
    // บิลที่ยกเลิกหรือจ่ายครบแล้วไม่ต้องคิดค่าปรับ — คิดไปก็ไม่มีที่ใช้ และ
    // getLateFeeForInvoice จะไปแตะบิลที่ปิดไปแล้วโดยไม่จำเป็น
    lateFee:
      invoice.status === 'cancelled' || invoice.outstandingCents <= 0
        ? null
        : getLateFeeForInvoice(db, invoice.invoiceId, paymentDate)
  }))
}

// **ไม่มีการคืนเงินค่าบิล โดยตั้งใจ** (ผู้ใช้ตัดสินใจ 2026-08-08)
// หอพักไม่มีสถานการณ์ที่ต้องคืนเงินค่าบิลที่รับมาแล้วให้ผู้เช่า
//
// ผลที่ตามมาที่ต้องรู้: ใบเสร็จลบไม่ได้ และตอนนี้ก็คืนไม่ได้ด้วย ถ้าพนักงานคีย์ยอดผิด
// จึงยังไม่มีทางแก้ในระบบ — ถ้าวันหนึ่งต้องมี ให้ทำเป็น "ยกเลิกใบเสร็จ" ที่อ้างใบเดิม
// ไม่ใช่คืนเงินยอดอิสระ เพราะสองอย่างนี้คนละความหมายกันในบัญชี
//
// การคืนเงินประกันตอนย้ายออกไม่เกี่ยวกับตรงนี้ — ใช้ recordContractPayment(isRefund)
// ซึ่งผูกกับสัญญา ไม่ใช่กับบิล

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
// กรองด้วย "ช่วงวันที่รับเงิน" ตามต้นแบบ — ใส่ข้างเดียวก็ได้
// เทียบเป็นข้อความตรงๆ เพราะเก็บเป็น 'YYYY-MM-DD' ซึ่งเรียงตามเวลาอยู่แล้ว
export function listReceipts(db, apartmentId, { dateFrom, dateTo } = {}) {
  const where = ['f.apartment_id = @apartmentId']
  if (dateFrom) where.push('p.payment_date >= @dateFrom')
  if (dateTo) where.push('p.payment_date <= @dateTo')

  const rows = db
    .prepare(
      `SELECT p.*, i.invoice_number, r.room_number, u.full_name AS created_by_name,
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
         LEFT JOIN users u ON u.user_id = p.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY p.payment_date DESC, p.payment_id DESC`
    )
    .all({ apartmentId, dateFrom: dateFrom || null, dateTo: dateTo || null })
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
    createdAt: row.created_at,
    // ใช้ตอนพิมพ์ใบเสร็จ — มีเฉพาะตอนดึงผ่าน listReceipts ที่ join หอกับผู้เช่ามาด้วย
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

// ------------------------------------------------------------------
function formatBaht(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
