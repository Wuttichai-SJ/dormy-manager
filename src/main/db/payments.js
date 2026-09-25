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

// เงินก้อนนี้เป็นค่าอะไร (migration 022) — ต้องรู้เพื่อคิดว่า "เงินประกันรับมาครบหรือยัง"
// เพราะใบเสร็จที่ผูกกับสัญญามีทั้งเงินประกัน ค่าเช่าล่วงหน้า และเงินประกันที่คืนตอนย้ายออก
export const PAYMENT_PURPOSES = ['invoice', 'deposit', 'advance', 'other']

export const PAYMENT_PURPOSE_LABELS = {
  invoice: 'ค่าบิล',
  deposit: 'เงินประกัน',
  advance: 'ค่าเช่าล่วงหน้า',
  other: 'อื่นๆ'
}

// **ไม่มีฟังก์ชันลบใบเสร็จโดยตั้งใจ** — ใบเสร็จที่หายไปเฉยๆ ทำให้ยอดรับเงินย้อนหลัง
// ตรวจสอบไม่ได้ และเลขใบเสร็จที่ออกให้ผู้เช่าไปแล้วจะชี้ไปที่ความว่างเปล่า
// การแก้ที่รับเงินผิดทำโดย `cancelPayment` ด้านล่าง (แถวยังอยู่ แต่ไม่ถูกนับ)

// ------------------------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// ------------------------------------------------------------------
// toCents โยน Error ธรรมดาเมื่อรูปแบบตัวเลขผิด — ห่อให้ผูกกับช่องนั้น ข้อความเดิม
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
  throwIfErrors(errors)

  // **ทั้งตัวรับเงินอยู่ในธุรกรรมเดียว** — `addLateFeeItem` ข้างล่างเขียนค่าปรับลงบิล *จริง*
  // และ commit ทันที ทั้งที่ด่านตรวจ "รับเงินได้ไม่เกินยอดค้างชำระ" ยังอยู่ถัดไปอีกหลายบรรทัด
  // ถ้าไม่ห่อไว้ การกรอกยอดเกินจะทิ้งรายการค่าปรับค้างบนบิลถาวรโดยไม่มีใบเสร็จคู่กัน
  // = บิลมีหนี้ที่งอกมาจากการจ่ายเงินที่ไม่เคยเกิดขึ้น (handler `payment:receive` ไม่ได้ห่อ
  // ธุรกรรมให้ จึงต้องห่อที่นี่ ไม่ใช่ฝากความหวังไว้กับผู้เรียก)
  //
  // better-sqlite3 ทำธุรกรรมซ้อนเป็น SAVEPOINT อยู่แล้ว จึงไม่ชนกับธุรกรรมภายใน
  // `addLateFeeItem`/`writePayment` และซ้อนอยู่ใต้ `recordInvoicePayments` (พหูพจน์) ได้ตามเดิม
  const run = db.transaction(() => {
    // ค่าปรับต้องเข้าบิล "ก่อน" คิดยอดค้าง ไม่งั้นเงินที่รับมาคลุมค่าปรับไม่ได้
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

    // จ่ายเกินยอดค้างไม่ได้ — เงินส่วนเกินไม่มีที่ไป และยอดค้างจะกลายเป็นติดลบ
    // ซึ่งอ่านไม่ออกว่าแปลว่าอะไร ถ้าผู้เช่าจ่ายเกินจริง ให้ออกใบเสร็จเท่ายอดค้าง
    // แล้วส่วนเกินไปเป็นเงินล่วงหน้าของสัญญา
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
  throwIfErrors(errors)

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

// ------------------------------------------------------------------
// ยกเลิกใบเสร็จ
// ------------------------------------------------------------------
// **ไม่มีการคืนเงินค่าบิล โดยตั้งใจ** (ผู้ใช้ตัดสินใจ 2026-08-08) หอพักไม่มีสถานการณ์
// ที่ต้องคืนเงินค่าบิลที่รับมาแล้วให้ผู้เช่า — ทางแก้ที่คีย์เงินผิดคือ "ยกเลิกใบเสร็จ" ใบนี้
//
// **ยกเลิก ≠ คืนเงิน** คืนเงินแปลว่ารับมาจริงแล้วจ่ายกลับ (เงินสองก้อนเดินเข้าออกจริง)
// ส่วนยกเลิกแปลว่าใบนี้ออกผิด เงินก้อนนั้นไม่เคยเข้ามา ซึ่งเป็นความจริงของกรณีคีย์ผิด
// ถ้าใช้การคืนเงินแทน รายงานจะมีเงินเข้าและเงินออกที่ไม่เคยเกิดขึ้นจริงคาอยู่ตลอดไป
//
// **แถวไม่ถูกลบ** เลขที่ใบเสร็จจึงยังตามได้ว่ามีอยู่จริงและถูกยกเลิกเพราะอะไร
// (เจ้าของหออาจยื่นกระดาษให้ผู้เช่าไปแล้วก่อนจะรู้ว่าคีย์ผิด)
//
// การคืนเงินประกันตอนย้ายออกไม่เกี่ยวกับตรงนี้ — ใช้ recordContractPayment(isRefund)
// ซึ่งผูกกับสัญญา ไม่ใช่กับบิล และเป็นเงินที่จ่ายกลับจริง
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

    // ถ้าไม่เหลือใบเสร็จที่ยังใช้ได้เลย ค่าปรับที่เคยเข้าบิลตอนรับเงินต้องออกไปด้วย
    // ไม่งั้นบิลจะค้างหนี้ก้อนที่งอกมาจากการรับเงินที่ถูกลบล้างไปแล้ว
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS n FROM payments
          WHERE invoice_id = ? AND cancelled_at IS NULL`
      )
      .get(row.invoice_id).n
    const removed = remaining === 0 ? removeLateFeeItems(db, row.invoice_id, now) : 0

    // ยอดที่รับมาเพิ่งเปลี่ยน สถานะบิลจึงต้องคิดใหม่ — จ่ายครบแล้วยกเลิกใบเสร็จทิ้ง
    // บิลต้องกลับไปเป็นค้างชำระเอง ไม่ต้องมีตรรกะย้อนกลับแยกต่างหาก
    // (removeLateFeeItems คิดสถานะให้แล้วรอบหนึ่ง แต่เรียกซ้ำไม่มีผลข้างเคียง)
    refreshInvoiceStatus(db, row.invoice_id, now)
    return removed
  })

  const lateFeeItemsRemoved = run()
  return { payment: getPaymentById(db, paymentId), lateFeeItemsRemoved }
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
  { contractId, amount, paymentMethod, paymentDate, remark, createdBy, isRefund, purpose }
) {
  const errors = validateCommon({ paymentMethod, paymentDate })
  // ค่าตั้งต้นเป็นเงินประกัน เพราะเป็นเงินก้อนที่รับกันจริงเกือบทุกครั้งของสัญญา
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

  // **ใบเสร็จของสัญญาต้องมีข้อความบอกเสมอว่าเป็นเงินก้อนไหน** — remark เป็นช่องที่
  // เจ้าหน้าที่เว้นว่างได้ (เช่นตอนกด "รับเงินประกันเพิ่ม" แล้วไม่พิมพ์หมายเหตุ)
  // ถ้าปล่อยว่าง ใบเสร็จกับใบรับเงินแรกเข้าจะขึ้นข้อความกลางๆ ที่ผู้เช่าอ่านแล้ว
  // แยกไม่ออกว่าจ่ายอะไรไป — ซึ่งคือปัญหาที่เอกสารพวกนี้มีไว้แก้พอดี
  //
  // createContract เขียน remark ที่เจาะจงกว่านี้มาให้อยู่แล้ว ('เงินจองตามใบจอง B...'
  // / 'เงินประกันวันทำสัญญา' / 'ค่าเช่าเดือนแรก (เดือน 09-2569)') ตัวนี้เป็นตาข่าย
  // สำหรับเงินที่รับเพิ่มทีหลังเท่านั้น
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

// ------------------------------------------------------------------
// เงินประกันรับมาครบหรือยัง
// ------------------------------------------------------------------
// **นับจากใบเสร็จจริง ไม่ใช่คอลัมน์ที่พิมพ์มือ** — `contracts.deposit_amount_cents` คือยอด
// ที่ตกลงกันไว้ ส่วนยอดที่รับมาจริงคือผลรวมของใบเสร็จที่ระบุว่าเป็นเงินประกัน
//
// เงินจองที่ถูกหักเป็นเงินประกันก็อยู่ในผลรวมนี้ด้วย เพราะตอนทำสัญญาระบบออกใบเสร็จ
// ให้เงินจองก้อนนั้นแล้ว (ดู createContract) จึงไม่ต้องบวก booking_fee_cents ซ้ำอีก
//
// ใบคืนเงินประกันตอนย้ายออกเป็นยอดติดลบ จึงหักออกเองโดยอัตโนมัติ
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
    // เก็บเกินได้ (เจ้าของหอเก็บเผื่อ) แต่ยอดค้างไม่ติดลบ — ติดลบอ่านไม่ออกว่าแปลว่าอะไร
    outstandingCents: Math.max(0, requiredCents - received),
    isSettled: received >= requiredCents
  }
}

// ------------------------------------------------------------------
// เขียนจริง
// ------------------------------------------------------------------
// ออกเลขใบเสร็จ + เขียนแถว + คิดสถานะบิลใหม่ ในธุรกรรมเดียว
// ถ้าแยกกัน จะมีจังหวะที่ใบเสร็จมีอยู่แล้วแต่สถานะบิลยังเป็น "ค้างชำระ"
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
        // apartment_id ต้องอยู่ในแถวจริง เพราะ unique index ของเลขใบเสร็จเป็นแบบ
        // (apartment_id, receipt_number) — เลขใบเสร็จเดินแยกรายหอ (ดู migration 021)
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

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
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

// การ์ด "รายการรับเงิน" ใต้ใบแจ้งหนี้
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

// ใบเสร็จทุกใบของสัญญาหนึ่ง — เงินจอง / เงินประกัน / ค่าเช่าเดือนแรก และเงินประกันที่เก็บ
// เพิ่มทีหลัง · ใช้ทำ "ใบรับเงินแรกเข้า" ที่รวมทุกก้อนไว้ในกระดาษใบเดียว
//
// **ดึงสดทุกครั้งที่พิมพ์ ไม่ได้ล็อกไว้ตอนทำสัญญา** — พิมพ์ตอนเซ็นสัญญาได้ 3 บรรทัด
// พิมพ์อีกทีหลังเก็บเงินประกันส่วนที่ค้างครบแล้วได้ 4 บรรทัด ซึ่งตรงกับความจริงเสมอ
//
// เรียงตามวันที่รับเงินจริง ไม่ใช่ลำดับที่บันทึก — เงินจองอาจรับไว้ก่อนวันทำสัญญาหลายเดือน
// (ดู createContract ใน db/contracts.js) บนเอกสารจึงต้องขึ้นก่อน
//
// ใบที่ถูกยกเลิกไม่เอามาด้วย — เอกสารนี้ยื่นให้ผู้เช่า ต้องมีแต่เงินที่รับจริง
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

  // ใบที่ยกเลิกยังอยู่ในรายการ (เลขที่ที่หายไปจากตารางคือเลขที่ตามไม่ได้) แต่ไม่นับเข้ายอด
  const active = rows.filter((row) => !row.isCancelled)

  return {
    receipts: rows,
    receiptCount: active.length,
    cancelledCount: rows.length - active.length,
    // ยอดรวมนับใบคืนเงินเป็นลบไปด้วย จึงเป็น "เงินที่เข้าหอจริง" ไม่ใช่ผลบวกของใบที่ออก
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
    // คอลัมน์ "ประเภท" ของรายงาน: อ้างใบแจ้งหนี้ หรือเป็นเงินก้อนของสัญญา
    sourceType: row.invoice_id ? 'invoice' : 'contract',
    sourceLabel: row.invoice_id ? `ใบแจ้งหนี้ #${row.invoice_number}` : 'สัญญา',
    isRefund: row.amount_cents < 0,
    // ใบที่ถูกยกเลิก — ยังอยู่ในรายการให้เห็น แต่ไม่ถูกนับเป็นเงินที่รับมาที่ไหนเลย
    isCancelled: Boolean(row.cancelled_at),
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelledByName: row.cancelled_by_name ?? null,
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
