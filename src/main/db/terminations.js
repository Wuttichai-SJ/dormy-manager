// ตาราง contract_terminations — แจ้งย้ายออก / ยกเลิกสัญญา / คืนเงินประกัน
//
// โครงหน้าจอลอกจากคู่มือต้นแบบ (yeeraf หัวข้อ "ยกเลิกสัญญาเช่า / ย้ายออก" สำรวจ 2026-08-11):
//   แจ้งย้ายออก (วันที่แจ้ง) → ปุ่มแดงยกเลิกสัญญา → หน้าสรุปสามกล่อง
//   (ใบแจ้งหนี้ค้างชำระ · เงินประกัน · รายการเก็บเงิน/คืนเงินเพิ่มเติม) → ยืนยันพร้อมวันที่ออก
//   → ใบเสร็จ "คืนเงินประกัน" ยอดติดลบ + ใบสรุปการย้ายออก
//
// **สิ่งที่ต่างจากต้นแบบ: กฎริบเงินประกัน** ต้นแบบคืนเสมอ (เงินประกัน − หนี้) ไม่มีเงื่อนไขใดๆ
// ส่วนหอนี้มีกฎของตัวเอง snapshot ไว้ที่สัญญาแต่ละใบตั้งแต่ migration 004 —
// หน้าสรุปของเราจึงมี "ผลการตัดสิน" เพิ่มมาอีกบรรทัดที่ต้นแบบไม่มี
//
// ห้าม import logger.js หรืออะไรที่ลาก electron เข้ามา (เทสต์รันใต้ ELECTRON_RUN_AS_NODE)
import { toCents } from '../money.js'
import { FieldError } from '../fieldError.js'
// ทั้ง invoices.js และ payments.js ไม่ได้นำเข้าไฟล์นี้กลับ ทิศทางจึงไม่เป็นวงกลม
import { listInvoices } from './invoices.js'
import { getDepositStatus, recordContractPayment } from './payments.js'

// แท็บของกล่อง "รายการเก็บเงิน/คืนเงินเพิ่มเติม" ตามต้นแบบ
//
// ชื่อค่าตรงกับที่ 001_init.sql กำกับไว้ที่ `contract_termination_items.item_type`
// ('service' | 'discount_refund' | 'water' | 'electricity') โดยเพิ่ม 'meter' เข้ามา —
// ต้นแบบรวมน้ำกับไฟเป็นแท็บเดียว และตอนย้ายออกไม่มีใครแยกจดสองฝั่งอีกแล้ว
export const TERMINATION_ITEM_TYPES = ['service', 'meter', 'discount_refund']

export const TERMINATION_ITEM_TYPE_LABELS = {
  service: 'ค่าบริการ',
  meter: 'ค่ามิเตอร์',
  discount_refund: 'ส่วนลด / คืนเงิน'
}

// เหตุผลที่ริบเงินประกัน — ต้องแยกออกจากกันเพื่อให้ใบสรุปบอกได้ว่าผิดข้อไหน
export const FORFEIT_REASON_LABELS = {
  early_move_out: 'ออกก่อนครบกำหนดตามสัญญา',
  insufficient_notice: 'แจ้งย้ายออกล่วงหน้าไม่ครบตามกำหนด',
  both: 'ออกก่อนครบกำหนด และแจ้งล่วงหน้าไม่ครบตามกำหนด',
  policy_never: 'สัญญาฉบับนี้ระบุว่าไม่คืนเงินประกัน'
}

// เงื่อนไข SQL ที่บอกว่า "ใบเสร็จใบนี้เกิดจากการย้ายออก" — ดูเหตุผลเต็มที่
// getTerminationByContract · ต้องเป็นก้อนเดียวที่ใช้ร่วมกันทุกที่ ถ้าแยกกันเขียน วันหนึ่ง
// ยอด "ยังค้างเก็บ" ในตารางประวัติกับในใบสรุปจะไม่ตรงกัน แล้วไม่มีใครรู้ว่าอันไหนถูก
const MOVE_OUT_RECEIPT_FILTER = `cancelled_at IS NULL
          AND (purpose = 'other' OR (purpose = 'deposit' AND amount_cents < 0))`

// เงินส่วนต่างที่ตามเก็บมาได้แล้วของสัญญาใบหนึ่ง — ใบรับเงินส่วนต่างคือ purpose = 'other'
// (ทั้งใบที่ออกตอนย้ายออกและใบที่ออกตอนตามเก็บทีหลัง เป็นชนิดเดียวกัน)
const COLLECTED_SHORTFALL_SUBQUERY = `SELECT COALESCE(SUM(amount_cents), 0)
             FROM payments
            WHERE contract_id = t.contract_id
              AND cancelled_at IS NULL
              AND purpose = 'other'`

// ยอดที่ผู้เช่าต้องจ่ายเพิ่มแต่ยังไม่ได้จ่าย
//
// สุทธิติดลบ = ผู้เช่าต้องจ่ายเพิ่ม · ลบด้วยที่เก็บมาได้แล้ว · ไม่ติดลบ (เก็บเกินไม่ได้อยู่แล้ว)
// สุทธิเป็นบวกหรือศูนย์ = หอเป็นฝ่ายคืนเงิน ไม่มีอะไรให้ตามเก็บ
export function shortfallOutstanding(netRefundCents, collectedCents) {
  return netRefundCents < 0 ? Math.max(0, -netRefundCents - collectedCents) : 0
}

// ------------------------------------------------------------------
// แจ้งย้ายออก (จังหวะแรก)
// ------------------------------------------------------------------
// เก็บวันที่แจ้งไว้ที่สัญญา ยังไม่แตะอะไรทั้งสิ้น — ผู้เช่ายังอยู่ ห้องยังไม่ว่าง บิลยังออกได้
//
// ต้องเก็บตั้งแต่วันที่แจ้งจริง ไม่ใช่ให้มากรอกย้อนหลังตอนกดย้ายออก เพราะระยะห่างระหว่าง
// วันแจ้งกับวันออกคือสิ่งที่กฎเงินประกันใช้ตัดสิน ถ้ากรอกตอนนั้นก็แก้ให้เข้าทางได้เสมอ
export function setMoveOutNotice(db, contractId, noticeDate) {
  const contract = requireActiveContract(db, contractId)

  if (noticeDate !== null && !isDate(noticeDate)) {
    throw new Error('กรุณาระบุวันที่แจ้งย้ายออก')
  }
  // แจ้งก่อนวันเริ่มสัญญาไม่ได้ — เป็นวันที่พิมพ์ผิด ไม่ใช่เหตุการณ์ที่เกิดได้จริง
  if (noticeDate !== null && noticeDate < contract.start_date) {
    throw new Error(`วันที่แจ้งย้ายออกต้องไม่ก่อนวันเริ่มสัญญา (${contract.start_date})`)
  }

  db.prepare('UPDATE contracts SET move_out_notice_date = ?, updated_at = ? WHERE contract_id = ?')
    .run(noticeDate, new Date().toISOString(), contractId)

  return { contractId, moveOutNoticeDate: noticeDate }
}

// ------------------------------------------------------------------
// นับเดือนที่อยู่จริง — ข้ามสายการต่อสัญญา
// ------------------------------------------------------------------
// **หัวใจของกฎ "นับเดือนต่อเนื่อง"** (ดู 004_deposit_refund_policy)
// ถ้านับแค่สัญญาใบสุดท้าย คนที่ต่อสัญญา 6+6 จะถูกมองเป็นสัญญาสั้นสองใบแยกกัน
// แล้วไม่มีใครผ่านเกณฑ์ 12 เดือนได้เลยตลอดกาล
//
// ไล่ย้อน previous_contract_id ไปหาใบแรกของสาย แล้วนับจากวันเริ่มของใบนั้น
export function findChainStartDate(db, contractId) {
  const stmt = db.prepare('SELECT contract_id, start_date, previous_contract_id FROM contracts WHERE contract_id = ?')
  let row = stmt.get(contractId)
  if (!row) throw new Error('ไม่พบสัญญา')

  const seen = new Set()
  while (row.previous_contract_id) {
    // ข้อมูลที่ชี้วนกลับมาหาตัวเองจะทำให้วนไม่รู้จบ — เจอเมื่อไหร่ให้หยุดที่ใบปัจจุบัน
    // ดีกว่าแอปค้างทั้งตัวโดยไม่มีใครรู้ว่าค้างตรงไหน
    if (seen.has(row.contract_id)) break
    seen.add(row.contract_id)
    const previous = stmt.get(row.previous_contract_id)
    if (!previous) break
    row = previous
  }
  return row.start_date
}

// จำนวนเดือนเต็มระหว่างสองวัน — ยังไม่ถึงวันเดียวกันของเดือนนั้นถือว่ายังไม่ครบเดือน
// (เริ่ม 15/01 ออก 14/07 = 5 เดือน · ออก 15/07 = 6 เดือน) ต่างกันวันเดียวคือได้เงินคืนหรือไม่ได้
export function monthsBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  const months = (ty - fy) * 12 + (tm - fm)
  return td < fd ? months - 1 : months
}

function daysBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

// ------------------------------------------------------------------
// ผลการตัดสินเรื่องเงินประกัน
// ------------------------------------------------------------------
// กฎอ่านจาก "สัญญาใบนั้น" ไม่ใช่จากค่าปัจจุบันของหอ — ถ้าปีหน้าเจ้าของเปลี่ยนกฎเป็น
// แจ้งล่วงหน้า 60 วัน สัญญาที่เซ็นไปแล้วต้องใช้กฎที่ผู้เช่าตกลงไว้ตอนเซ็น (ดู 004)
//
// **ริบคือริบทั้งก้อน ไม่มีคืนบางส่วน** (ผู้ใช้ตัดสินใจ 2026-07-30)
export function evaluateDepositRefund({
  policy,
  requiredMonths,
  monthsStayed,
  requiredNoticeDays,
  noticeDaysGiven,
  isNoticeGiven
}) {
  if (policy === 'never') {
    return { isRefundable: false, forfeitReason: 'policy_never' }
  }
  if (policy === 'always') {
    return { isRefundable: true, forfeitReason: null }
  }

  // requiredMonths เป็น null = สัญญาไม่กำหนดระยะ (รายเดือนต่อไปเรื่อยๆ) จึงไม่มีอะไรให้ "ออกก่อนครบ"
  const tooEarly = requiredMonths !== null && requiredMonths !== undefined && monthsStayed < requiredMonths
  // ไม่แจ้งเลย = แจ้งไม่ทันโดยอัตโนมัติ (จำนวนวันที่แจ้งคือ 0)
  const tooLate = !isNoticeGiven || noticeDaysGiven < requiredNoticeDays

  if (tooEarly && tooLate) return { isRefundable: false, forfeitReason: 'both' }
  if (tooEarly) return { isRefundable: false, forfeitReason: 'early_move_out' }
  if (tooLate) return { isRefundable: false, forfeitReason: 'insufficient_notice' }
  return { isRefundable: true, forfeitReason: null }
}

// ------------------------------------------------------------------
// หน้าสรุปก่อนยืนยัน
// ------------------------------------------------------------------
// คำนวณอย่างเดียว ยังไม่เขียนอะไรลงฐานข้อมูล — หน้าจอเรียกซ้ำได้ทุกครั้งที่ผู้ใช้เปลี่ยน
// วันที่ออกหรือเพิ่มรายการ (เหมือน buildInvoiceItems ที่พรีวิวกับออกจริงใช้ตัวเดียวกัน)
//
// adjustments = [{ itemType, description, amount }] — บวก = เก็บเพิ่ม, ส่วนลดส่งเป็นบวกแล้ว
// ระบบกลับเครื่องหมายให้เอง (ผู้ใช้ไม่ควรต้องพิมพ์เลขติดลบ เหมือนที่ทำกับส่วนลดบนบิล)
//
// **overrideRefundable ต้องเข้ามาถึงที่นี่ด้วย** — เดิมตัวนี้คิดตามกฎอย่างเดียว หน้าจอจึงแสดง
// ยอดสรุปเป็นของ "ตามกฎ" ค้างไว้ ต่อให้เจ้าของหอติ๊กว่าจะคืนเงินให้ ตัวเลขที่ถูกไปโผล่ตอน
// กดยืนยันซึ่งสายไปแล้ว — หน้าจอโกหกทั้งที่ข้อมูลที่บันทึกถูก (ผู้ใช้เจอ 2026-08-11)
export function getTerminationSheet(
  db,
  contractId,
  { moveOutDate, adjustments, overrideRefundable } = {}
) {
  const contract = requireActiveContract(db, contractId)
  const outDate = moveOutDate ?? todayIso()
  if (!isDate(outDate)) throw new Error('กรุณาระบุวันที่ย้ายออก')
  if (outDate < contract.start_date) {
    throw new Error(`วันที่ย้ายออกต้องไม่ก่อนวันเริ่มสัญญา (${contract.start_date})`)
  }

  const noticeDate = contract.move_out_notice_date
  const isNoticeGiven = Boolean(noticeDate)
  // แจ้งหลังวันที่ออกไปแล้ว = แจ้งช้ากว่าที่ออก นับเป็น 0 วัน ไม่ใช่จำนวนวันติดลบ
  const noticeDaysGiven = isNoticeGiven ? Math.max(0, daysBetween(noticeDate, outDate)) : 0

  const chainStart = findChainStartDate(db, contractId)
  const monthsStayed = Math.max(0, monthsBetween(chainStart, outDate))
  const requiredMonths = contract.deposit_min_stay_months ?? contract.term_months ?? null

  const verdict = evaluateDepositRefund({
    policy: contract.deposit_refund_policy,
    requiredMonths,
    monthsStayed,
    requiredNoticeDays: contract.deposit_notice_days,
    noticeDaysGiven,
    isNoticeGiven
  })

  // เงินประกันที่ "รับมาจริง" ไม่ใช่ยอดที่ตกลงไว้ — คนที่ยังจ่ายเงินประกันไม่ครบ
  // ต้องคืนได้ไม่เกินที่จ่ายมา (นับจากใบเสร็จ ดู getDepositStatus)
  const deposit = getDepositStatus(db, contractId)

  // บิลที่ยังค้างของสัญญานี้ — ยกเลิกไปแล้วไม่นับ (listInvoices กรองด้วยสถานะให้แล้ว)
  const outstandingInvoices = listInvoices(db, contract.apartment_id, { settlement: 'outstanding' })
    .filter((invoice) => invoice.contractId === contractId)
    .map((invoice) => ({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      billingMonth: invoice.billingMonth,
      issueDate: invoice.issueDate,
      outstandingCents: invoice.outstandingCents
    }))
  const outstandingTotalCents = outstandingInvoices.reduce((sum, i) => sum + i.outstandingCents, 0)

  const items = normalizeAdjustments(adjustments)

  // ผลตัดสินที่ "ใช้จริง" — เจ้าของหอกดข้ามกฎได้ (ต้องมีเหตุผลตอนยืนยัน)
  // เก็บผลตามกฎไว้ต่างหาก เพราะหน้าจอต้องบอกได้ว่ากฎว่าอย่างไร แล้วคนตัดสินต่างไปอย่างไร
  const appliedRefundable =
    overrideRefundable === undefined || overrideRefundable === null
      ? verdict.isRefundable
      : Boolean(overrideRefundable)

  const money = summariseMoney({
    depositReceivedCents: deposit.receivedCents,
    items,
    isRefundable: appliedRefundable
  })

  // 🔴 **ต้องเคลียร์บิลค้างให้หมดก่อนย้ายออก** (เจ้าของหอยืนยัน 2026-08-11)
  //
  // ระบบ **ไม่หักหนี้จากเงินประกันให้เอง** — ต่างจากต้นแบบที่ทำอัตโนมัติ เพราะกติกาของหอนี้
  // คือผู้เช่าต้องจ่ายบิลให้ครบก่อน ถ้าเจ้าของหอตกลงหักจากเงินประกันจริง ก็ไปกดรับเงิน
  // ที่บิลใบนั้นตามปกติก่อน แล้วค่อยกลับมาย้ายออก — เงินก้อนนั้นจึงถูกบันทึกเป็นการรับชำระ
  // ที่มีใบเสร็จของตัวเอง ไม่ใช่ตัวเลขที่หายไปในขั้นตอนย้ายออก
  //
  // เปิดทางข้ามไว้สำหรับผู้เช่าที่หนีไปเฉยๆ (ดู completeTermination) ไม่งั้นห้องจะติดอยู่กับ
  // หนี้ที่ไม่มีวันได้คืนตลอดไป และเจ้าของหอปล่อยห้องใหม่ไม่ได้
  //
  // **บิลค้างไม่เข้าสูตรยอดสุทธิ** — เงินประกันไม่ใช่ของสำหรับจ่ายบิล (กติกาข้อเดียวกับที่ทำให้
  // เงินประกันที่ริบเอาไปหักหนี้ไม่ได้) ใบสรุปแสดงเป็นบรรทัด "ยังค้างชำระ" แยกต่างหาก
  const hasOutstanding = outstandingTotalCents > 0

  return {
    contractId,
    roomNumber: contract.room_number,
    apartmentId: contract.apartment_id,
    // ใบสรุปที่พิมพ์ให้ผู้เช่าต้องมีหัวเอกสารและชื่อเจ้าของเรื่อง — พิมพ์ได้ตั้งแต่ก่อนกดยืนยัน
    // (ผู้ใช้สั่ง 2026-08-11: ต้องยื่นให้ผู้เช่าก่อนเขาออกจากหอ)
    apartment: contract.apartment,
    tenantName: contract.tenant_name ?? null,
    termMonths: contract.term_months,
    startDate: contract.start_date,
    chainStartDate: chainStart,
    // มีสัญญาก่อนหน้าในสาย = ต่อสัญญามา หน้าจอต้องบอก ไม่งั้นตัวเลข "อยู่มาแล้ว 14 เดือน"
    // ของสัญญาที่เพิ่งเริ่มเมื่อ 2 เดือนก่อนจะดูเหมือนคำนวณผิด
    isRenewal: chainStart !== contract.start_date,
    moveOutDate: outDate,
    noticeDate: noticeDate ?? null,
    isNoticeGiven,
    noticeDaysGiven,
    requiredNoticeDays: contract.deposit_notice_days,
    monthsStayed,
    requiredMonths,
    depositPolicy: contract.deposit_refund_policy,
    depositReceivedCents: deposit.receivedCents,
    depositAgreedCents: deposit.requiredCents,
    // ผลตามกฎของสัญญา — หน้าจอใช้เทียบว่าคนตัดสินต่างจากกฎหรือไม่
    isDepositRefundable: verdict.isRefundable,
    // ผลที่ใช้คำนวณเงินจริงในใบนี้ (ต่างกันเมื่อเจ้าของหอกดข้ามกฎ)
    appliedRefundable,
    forfeitReason: verdict.forfeitReason,
    forfeitReasonLabel: verdict.forfeitReason
      ? FORFEIT_REASON_LABELS[verdict.forfeitReason]
      : null,
    outstandingInvoices,
    outstandingTotalCents,
    // มีบิลค้าง = ย้ายออกไม่ได้จนกว่าจะเคลียร์ หรือกดข้ามพร้อมเหตุผล
    hasOutstanding,
    items,
    ...money
  }
}

// ------------------------------------------------------------------
// สูตรเงินตอนย้ายออก
// ------------------------------------------------------------------
// **เงินประกันมีไว้รองรับความเสียหายของห้อง ไม่ได้มีไว้จ่ายค่าน้ำค่าไฟค่าเช่า**
// (เจ้าของหอยืนยันหลักข้อนี้ 2026-08-11) สามแท็บของ "รายการเพิ่มเติม" จึงมีความหมาย
// ทางบัญชีคนละอย่าง ไม่ใช่แค่ป้ายจัดกลุ่ม:
//
//   ค่าบริการ/ซ่อม  = ความเสียหาย  → **หักจากเงินประกัน** เป็นหน้าที่ของมันโดยตรง
//   ค่ามิเตอร์       = ค่าน้ำ-ไฟงวดสุดท้าย → **เก็บแยก ไม่แตะเงินประกัน** (เป็นบิล)
//   ส่วนลด/คืนเงิน  = เงินที่หอต้องคืน → **คืนเสมอ แม้เงินประกันถูกริบ** (คนละก้อน)
//
// 🔴 **การริบ = "ส่วนที่เหลือหลังหักค่าเสียหายไม่ได้คืน" ไม่ใช่ "เงินประกันหายไปทั้งก้อน"**
// ของเดิมตั้งเงินประกันที่คืนได้เป็น 0 ทันทีเมื่อริบ แล้วเอาค่าเสียหายไปลบจากศูนย์ —
// ผู้เช่าจึงเสียเงินประกัน 5,000 แล้วยังถูกเรียกเก็บค่าลูกบิดอีก 800 ทั้งที่เงิน 5,000 ก้อนนั้น
// มีไว้รองรับความเสียหายตั้งแต่แรก (ผู้ใช้ทักท้วง 2026-08-11 — จ่ายสองต่อ)
//
// ตัวเดียวกันนี้ใช้ทั้งตอนพรีวิวและตอนอ่านบันทึกที่เก็บไว้แล้ว ตัวเลขบนใบสรุปที่ยื่นให้ผู้เช่า
// ก่อนย้ายออกจึงตรงกับที่บันทึกไว้เสมอ (หลักเดียวกับ buildInvoiceItems ของใบแจ้งหนี้)
export function summariseMoney({ depositReceivedCents, items, isRefundable }) {
  const sumOf = (type) =>
    items.filter((i) => i.itemType === type).reduce((sum, i) => sum + Math.abs(i.amountCents), 0)

  const damageTotalCents = sumOf('service')
  const meterTotalCents = sumOf('meter')
  const refundItemsTotalCents = sumOf('discount_refund')

  // ค่าเสียหายกินเงินประกันก่อนเสมอ — ทั้งกรณีริบและไม่ริบ
  //
  // แยกสองตัว: `depositBalanceCents` **ติดลบได้** เอาไว้แสดงบรรทัด "คงเหลือ" บนใบสรุป
  // ส่วน `depositAfterDamageCents` คือเงินที่เหลืออยู่จริงให้ริบหรือคืน จึงไม่ต่ำกว่า 0
  const depositBalanceCents = depositReceivedCents - damageTotalCents
  const depositAfterDamageCents = Math.max(0, depositBalanceCents)
  // ค่าเสียหายเกินเงินประกัน ส่วนที่เกินคือเงินที่ผู้เช่าต้องควักเพิ่ม
  const excessDamageCents = Math.max(0, -depositBalanceCents)

  const forfeitedCents = isRefundable ? 0 : depositAfterDamageCents
  const depositRefundCents = isRefundable ? depositAfterDamageCents : 0

  const tenantOwesCents = excessDamageCents + meterTotalCents
  const buildingReturnsCents = depositRefundCents + refundItemsTotalCents

  return {
    // **ชื่อเดียวกับที่เก็บในฐานข้อมูล** เพื่อให้ใบสรุปตัวเดียวใช้ได้ทั้งใบพรีวิวก่อนยืนยัน
    // และใบที่อ่านจากบันทึก — เคยพลาดตรงนี้มาแล้ว: สองแหล่งใช้ชื่อฟิลด์ต่างกัน แล้วใบพรีวิว
    // แสดงเงินประกันเป็น 0.00 อย่างเงียบสนิท เพราะ `formatBaht(undefined)` ให้ 0
    depositSnapshotCents: depositReceivedCents,
    depositBalanceCents,
    damageTotalCents,
    meterTotalCents,
    refundItemsTotalCents,
    depositAfterDamageCents,
    excessDamageCents,
    forfeitedCents,
    depositRefundCents,
    tenantOwesCents,
    buildingReturnsCents,
    // ยอดรวมของรายการทั้งหมดตามเครื่องหมายที่เก็บในฐานข้อมูล (ใช้เก็บลงคอลัมน์เดิม)
    adjustmentsTotalCents: items.reduce((sum, i) => sum + i.amountCents, 0),
    // บวก = หอคืนให้ผู้เช่า · ลบ = ผู้เช่าจ่ายเพิ่มให้หอ
    netRefundCents: buildingReturnsCents - tenantOwesCents
  }
}

function normalizeAdjustments(adjustments) {
  return (Array.isArray(adjustments) ? adjustments : []).map((row, index) => {
    const itemType = row?.itemType
    if (!TERMINATION_ITEM_TYPES.includes(itemType)) {
      throw new Error(`ประเภทรายการไม่ถูกต้อง: ${itemType}`)
    }
    const description = String(row?.description ?? '').trim()
    if (!description) throw new Error(`รายการที่ ${index + 1}: กรุณาระบุชื่อรายการ`)

    const magnitude = toCents(row?.amount, `รายการ "${description}"`)
    if (magnitude <= 0) throw new Error(`รายการ "${description}": จำนวนเงินต้องมากกว่า 0`)

    return {
      itemType,
      itemTypeLabel: TERMINATION_ITEM_TYPE_LABELS[itemType],
      description,
      // ส่วนลด/คืนเงินคือเงินที่ไหลกลับหาผู้เช่า จึงเก็บเป็นลบ ผู้ใช้กรอกเป็นบวกเสมอ
      // (กติกาเดียวกับส่วนลดบนใบแจ้งหนี้ — คนกรอกไม่ควรต้องคิดเรื่องเครื่องหมาย)
      amountCents: itemType === 'discount_refund' ? -magnitude : magnitude
    }
  })
}

// ------------------------------------------------------------------
// ยืนยันย้ายออก
// ------------------------------------------------------------------
// ทำทุกอย่างในธุรกรรมเดียว: ออกใบเสร็จคืนเงิน → บันทึกผลการตัดสิน → ปิดสัญญา →
// คืนห้องเป็นว่าง · ถ้าขั้นใดพัง ต้องไม่เหลือครึ่งๆ กลางๆ ให้ตามแก้
export function completeTermination(
  db,
  contractId,
  {
    moveOutDate,
    adjustments,
    overrideRefundable,
    overrideReason,
    allowOutstanding,
    outstandingReason,
    // ยอดสุทธิติดลบ = ผู้เช่าต้องจ่ายเพิ่ม · true (ค่าตั้งต้น) = เก็บเงินได้แล้ว ออกใบเสร็จให้
    // false = ยังเก็บไม่ได้ ไม่ออกใบเสร็จ แล้วยอดนั้นค้างไว้ในบันทึกการย้ายออก
    collectShortfall,
    paymentMethod,
    createdBy
  } = {}
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้ทำรายการ กรุณาเข้าสู่ระบบใหม่')

  // ส่ง override เข้าไปด้วย ตัวเลขที่บันทึกจึงเป็นตัวเดียวกับที่ผู้ใช้เห็นบนหน้าจอเป๊ะ
  // (ตัวคำนวณเดียว ทางเดียว — ถ้าคิดซ้ำที่นี่อีกรอบ วันหนึ่งสองทางจะให้คำตอบต่างกัน)
  const sheet = getTerminationSheet(db, contractId, {
    moveOutDate,
    adjustments,
    overrideRefundable
  })

  // **ด่านบิลค้าง** — กติกาของหอคือต้องเคลียร์ให้หมดก่อน (เจ้าของหอยืนยัน 2026-08-11)
  //
  // ทางข้ามมีไว้สำหรับผู้เช่าที่หนีไปเฉยๆ เท่านั้น และต้องพิมพ์เหตุผล — ถ้าบล็อกตายตัว
  // ห้องนั้นจะปล่อยใหม่ไม่ได้ตลอดไปเพราะหนี้ที่ไม่มีวันได้คืน ซึ่งแย่กว่าการยอมให้ผ่าน
  // โดยมีบันทึกไว้ว่าใครอนุมัติและเพราะอะไร
  const outstandingNote = String(outstandingReason ?? '').trim()
  if (sheet.hasOutstanding) {
    if (!allowOutstanding) {
      throw new Error(
        `ยังมีใบแจ้งหนี้ค้างชำระ ${formatBaht(sheet.outstandingTotalCents)} บาท — ` +
          'ต้องเคลียร์ให้ครบก่อนย้ายออก (หรือระบุเหตุผลเพื่อย้ายออกทั้งที่ยังค้าง)'
      )
    }
    if (!outstandingNote) {
      throw new Error('กรุณาระบุเหตุผลที่ให้ย้ายออกทั้งที่ยังมีบิลค้างชำระ')
    }
  }

  // เจ้าของกดข้ามผลการตัดสินได้ แต่ต้องพิมพ์เหตุผล — ถ้าไม่เปิดช่องนี้ไว้ เจ้าของจะเลี่ยง
  // ไปพิมพ์เป็น "รายการคืนเงินเพิ่มเติม" แทน แล้วเหตุผลจริงจะหายไปจากประวัติ (ดู 004)
  const isOverride =
    overrideRefundable !== undefined &&
    overrideRefundable !== null &&
    Boolean(overrideRefundable) !== sheet.isDepositRefundable
  const note = String(overrideReason ?? '').trim()
  if (isOverride && !note) {
    throw new Error('กรุณาระบุเหตุผลที่ตัดสินต่างจากกฎของสัญญา')
  }

  const isRefundable = sheet.appliedRefundable
  const netRefundCents = sheet.netRefundCents

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    // ใบแจ้งหนี้ค้างชำระ **ไม่ถูกแตะเลย** — ปกติต้องเป็น 0 อยู่แล้วเพราะด่านข้างบน
    // ส่วนกรณีที่กดข้ามมา หนี้ก้อนนั้นยังต้องตามเก็บต่อ ไม่ใช่หายไปเงียบๆ ในขั้นตอนย้ายออก

    // ยอดสุทธิมีได้สามทาง และ **ทั้งสามทางที่มีเงินเคลื่อนต้องมีใบเสร็จ**:
    //   บวก  = หอคืนเงินให้ผู้เช่า      → ใบเสร็จยอดติดลบ ป้าย "คืนเงินประกัน"
    //   ศูนย์ = ไม่มีเงินเคลื่อน         → ไม่ออกใบ
    //   ลบ   = ผู้เช่าจ่ายเพิ่มให้หอ      → ใบเสร็จยอดบวก
    //
    // 🔴 เดิมทางที่สามไม่ออกใบเลย โดยให้เหตุผลว่า "ยังไม่มีเงินเคลื่อน" ซึ่งผิด — เงินเคลื่อนจริง
    // แค่เคลื่อนคนละทิศ ผลคือระบบไม่มีทางรู้ว่าเก็บเงินส่วนต่างมาแล้วหรือยัง และผู้เช่าไม่ได้
    // หลักฐานว่าจ่ายอะไรไป (ผู้ใช้เจอตอนทดสอบจริง 2026-08-11)
    let refundReceipt = null
    let shortfallReceipt = null

    if (netRefundCents > 0) {
      refundReceipt = recordContractPayment(db, {
        contractId,
        amount: netRefundCents / 100,
        paymentMethod: paymentMethod ?? 'cash',
        paymentDate: sheet.moveOutDate,
        remark: `คืนเงินประกันตอนย้ายออก ห้อง ${sheet.roomNumber}`,
        createdBy,
        isRefund: true,
        purpose: 'deposit'
      })
    } else if (netRefundCents < 0 && collectShortfall !== false) {
      // ไม่ใช่ 'deposit' เพราะไม่ใช่เงินประกัน และไม่ใช่ 'invoice' เพราะไม่มีใบแจ้งหนี้
      // อยู่เบื้องหลัง — เป็นเงินที่เรียกเก็บเพิ่มตอนตรวจห้อง
      shortfallReceipt = recordContractPayment(db, {
        contractId,
        amount: -netRefundCents / 100,
        paymentMethod: paymentMethod ?? 'cash',
        paymentDate: sheet.moveOutDate,
        remark: `รับเงินส่วนต่างตอนย้ายออก ห้อง ${sheet.roomNumber}`,
        createdBy,
        purpose: 'other'
      })
    }

    // 3) บันทึกผลการตัดสิน — เก็บ "ทำไม" ไม่ใช่แค่ตัวเลข
    const result = db
      .prepare(
        `INSERT INTO contract_terminations (
           contract_id, notice_date, actual_move_out_date, deposit_snapshot_cents,
           unpaid_invoices_total_cents, additional_adjustments_total_cents,
           net_refund_amount_cents, status, created_at,
           is_notice_given, notice_days_given, months_stayed_total,
           is_deposit_refundable, forfeit_reason, refundable_deposit_cents,
           is_manual_override, override_reason
         ) VALUES (
           @contractId, @noticeDate, @moveOutDate, @depositSnapshot,
           @unpaid, @adjustments,
           @netRefund, 'completed', @now,
           @isNoticeGiven, @noticeDaysGiven, @monthsStayed,
           @isRefundable, @forfeitReason, @refundable,
           @isOverride, @overrideReason
         )`
      )
      .run({
        contractId,
        // ไม่ได้แจ้งล่วงหน้า → คอลัมน์เป็น NOT NULL จึงใส่วันที่ออกแทน
        // แล้วอ่านคู่กับ is_notice_given = 0 (กติกานี้เขียนไว้ตั้งแต่ migration 004)
        noticeDate: sheet.noticeDate ?? sheet.moveOutDate,
        moveOutDate: sheet.moveOutDate,
        depositSnapshot: sheet.depositReceivedCents,
        unpaid: sheet.outstandingTotalCents,
        adjustments: sheet.adjustmentsTotalCents,
        netRefund: netRefundCents,
        now,
        isNoticeGiven: sheet.isNoticeGiven ? 1 : 0,
        noticeDaysGiven: sheet.isNoticeGiven ? sheet.noticeDaysGiven : null,
        monthsStayed: sheet.monthsStayed,
        isRefundable: isRefundable ? 1 : 0,
        forfeitReason: isRefundable ? null : (sheet.forfeitReason ?? 'policy_never'),
        // เงินประกันส่วนที่คืนได้จริง = หลังหักค่าเสียหายแล้ว ไม่ใช่ยอดเต็มที่รับมา
        refundable: sheet.depositRefundCents,
        isOverride: isOverride ? 1 : 0,
        // เหตุผลสองอย่างอยู่คอลัมน์เดียวกัน (004 มีช่องเดียว) ต่อกันเมื่อมีทั้งคู่ —
        // ทั้งสองอย่างคือ "ทำไมถึงตัดสินแบบนี้" เหมือนกัน และการเพิ่มคอลัมน์ที่สอง
        // เพื่อแยกสองประโยคไม่คุ้มกับการที่ใครสักคนอีกสิบปีต้องมาไล่ว่าอันไหนอยู่ช่องไหน
        overrideReason:
          [
            isOverride ? note : null,
            outstandingNote ? `ย้ายออกทั้งที่ค้างบิล: ${outstandingNote}` : null
          ]
            .filter(Boolean)
            .join(' · ') || null
      })

    const terminationId = result.lastInsertRowid

    // ใช้ตาราง `contract_termination_items` ที่มีมาตั้งแต่ 001_init.sql
    // คอลัมน์ VAT ปล่อย NULL — รายการปรับปรุงตอนย้ายออกไม่คิดภาษี เหมือนค่าปรับบนบิล
    const insertItem = db.prepare(
      `INSERT INTO contract_termination_items
         (contract_termination_id, item_type, description, total_amount_cents, created_at)
       VALUES (@terminationId, @itemType, @description, @amountCents, @now)`
    )
    for (const item of sheet.items) {
      insertItem.run({
        terminationId,
        itemType: item.itemType,
        description: item.description,
        amountCents: item.amountCents,
        now
      })
    }

    // 4) ปิดสัญญาและคืนห้องให้ว่าง — ถ้าลืมข้อนี้ ห้องจะติดกับผู้เช่าคนเดิมตลอดไป
    //    และ createContract จะบล็อกการทำสัญญาใหม่ด้วยข้อความ "กรุณาแจ้งย้ายออกก่อน"
    db.prepare(
      `UPDATE contracts SET status = 'terminated', end_date = @moveOutDate, updated_at = @now
        WHERE contract_id = @contractId`
    ).run({ moveOutDate: sheet.moveOutDate, now, contractId })

    db.prepare(
      `UPDATE rooms SET status = 'vacant', updated_at = @now
        WHERE room_id = (SELECT room_id FROM contracts WHERE contract_id = @contractId)`
    ).run({ now, contractId })

    return { terminationId, refundReceipt, shortfallReceipt }
  })

  const { refundReceipt, shortfallReceipt } = run()
  return { ...getTerminationByContract(db, contractId), refundReceipt, shortfallReceipt }
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function getTerminationByContract(db, contractId) {
  const row = db
    .prepare(
      // ข้อมูลหอกับชื่อผู้เช่าติดมาด้วย เพราะใบสรุปการย้ายออกที่พิมพ์ให้ผู้เช่าต้องมีหัวเอกสาร
      // และต้องบอกได้ว่าเป็นของใคร (เหมือนที่ listReceipts ทำให้ใบเสร็จ)
      `SELECT t.*, r.room_number, c.start_date, c.deposit_refund_policy, c.term_months,
              c.deposit_notice_days,
              a.name_th AS apartment_name, a.address_th AS apartment_address,
              a.phone AS apartment_phone,
              (SELECT tn.first_name || ' ' || tn.last_name
                 FROM contract_tenants ct
                 JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                WHERE ct.contract_id = c.contract_id
                ORDER BY ct.is_primary DESC, tn.tenant_id
                LIMIT 1) AS tenant_name
         FROM contract_terminations t
         JOIN contracts c  ON c.contract_id = t.contract_id
         JOIN rooms r      ON r.room_id = c.room_id
         JOIN floors f     ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE t.contract_id = ?`
    )
    .get(contractId)
  if (!row) return null

  const items = db
    .prepare(
      `SELECT * FROM contract_termination_items
        WHERE contract_termination_id = ? ORDER BY item_id`
    )
    .all(row.termination_id)
    .map((item) => ({
      itemType: item.item_type,
      itemTypeLabel: TERMINATION_ITEM_TYPE_LABELS[item.item_type] ?? item.item_type,
      description: item.description,
      amountCents: item.total_amount_cents
    }))

  // ใบเสร็จที่เกิดจากการย้ายออกครั้งนี้ — ตรงกับตาราง "รายละเอียดการย้ายออก" ของต้นแบบ
  //
  // เอาเฉพาะใบที่ผูกกับ *สัญญา* (คืนเงินประกัน / รับเงินส่วนต่าง) ไม่รวมใบที่ผูกกับใบแจ้งหนี้ —
  // บิลต้องถูกเคลียร์ไปก่อนย้ายออกอยู่แล้ว ใบเสร็จของบิลจึงเป็นคนละเรื่อง
  // (ข้อนี้ได้มาฟรีอยู่แล้ว: payments บังคับให้ผูกกับใบแจ้งหนี้ *หรือ* สัญญาอย่างใดอย่างหนึ่ง
  //  ใบที่มี contract_id จึงเป็นใบระดับสัญญาเสมอ)
  //
  // 🔴 **แยกด้วยความหมายของใบ ไม่ใช่ด้วยวันที่** — เดิมกรอง `payment_date = วันที่ย้ายออก`
  // ซึ่งใช้ได้ตราบใดที่เงินทุกก้อนเคลื่อนในวันย้ายออกวันเดียว พอเปิดให้ตามเก็บเงินส่วนต่าง
  // ทีหลังได้ (ผู้เช่าเอาค่าซ่อมมาจ่ายอีกสองอาทิตย์ถัดมา) ใบนั้นลงวันคนละวันแล้วหลุดออกจาก
  // ผลลัพธ์ทันที — ยอด "ยังค้างเก็บ" จะไม่มีวันลดลงทั้งที่เก็บเงินมาแล้ว
  //
  // ที่เหลือคือแยกใบของการย้ายออก ออกจากเงินประกัน/ค่าเช่าล่วงหน้าที่รับตอนเข้าพัก:
  //   purpose = 'other'               → รับเงินส่วนต่าง (ทั้งระบบมีที่เดียวคือการย้ายออก)
  //   purpose = 'deposit' + ยอดติดลบ  → คืนเงินประกัน (เงินประกันไหลออกได้ทางเดียวเท่านั้น)
  const receipts = db
    .prepare(
      `SELECT receipt_number, payment_date, amount_cents, payment_method, purpose, remark
         FROM payments
        WHERE contract_id = @contractId
          AND ${MOVE_OUT_RECEIPT_FILTER}
        ORDER BY payment_date, payment_id`
    )
    .all({ contractId })
    .map((p) => ({
      receiptNumber: p.receipt_number,
      paymentDate: p.payment_date,
      amountCents: p.amount_cents,
      // ยอดติดลบ = เงินออกจากหอ · ยอดบวก = เงินเข้าหอ อ่านจากทิศของตัวเลขตรงๆ
      label: p.amount_cents < 0 ? 'คืนเงินประกัน' : 'รับเงินส่วนต่างตอนย้ายออก'
    }))

  // ยอดที่ผู้เช่าต้องจ่ายเพิ่มแต่ยังไม่ได้จ่าย — สุทธิติดลบทั้งที่ไม่มีใบเสร็จรับเงินส่วนต่าง
  // ใบสรุปที่พิมพ์ให้ผู้เช่าต้องบอกให้ชัดว่ายังค้าง ไม่ใช่ปล่อยให้เข้าใจว่าจบแล้ว
  const collectedCents = receipts
    .filter((r) => r.amountCents > 0)
    .reduce((sum, r) => sum + r.amountCents, 0)
  const netRefundCents = row.net_refund_amount_cents
  const unpaidBalanceCents = shortfallOutstanding(netRefundCents, collectedCents)

  // แจกแจงเงินด้วยตัวคำนวณตัวเดียวกับตอนพรีวิว — ใบสรุปที่ยื่นให้ผู้เช่าก่อนย้ายออก
  // กับใบที่เปิดดูย้อนหลังจึงแสดงตัวเลขชุดเดียวกันเสมอ
  const money = summariseMoney({
    depositReceivedCents: row.deposit_snapshot_cents,
    items,
    isRefundable: row.is_deposit_refundable === 1
  })

  // 🔴 **ใบเก่าที่ตัดสินด้วยสูตรคนละรุ่นต้องบอกออกมา ไม่ใช่ปล่อยให้เอกสารบวกไม่ลงเงียบๆ**
  //
  // เอกสารใบนี้ดึงตัวเลขจากสองแหล่งโดยตั้งใจ: รายการแจกแจงกับยอดย่อยมาจาก summariseMoney
  // (สูตรปัจจุบัน) ส่วนยอดสุทธิบรรทัดล่างสุดมาจากคอลัมน์ที่บันทึกไว้ตอนกดยืนยัน เพราะยอดที่
  // ตกลงกับผู้เช่าไว้ในวันนั้นต้องไม่ถูกสูตรรุ่นหลังเขียนทับ
  //
  // ปกติสองทางนี้ให้ค่าเท่ากัน แต่ถ้าสูตรเคยถูกแก้ ใบที่ทำก่อนหน้านั้นจะแสดง
  // "รวมที่ผู้เช่าต้องชำระ 380" แล้วสรุปว่า "ผู้เช่าต้องชำระเพิ่ม 880" โดยไม่มีอะไรอธิบาย
  // 500 ที่หายไป — ยอดรวมที่อธิบายไม่ได้คือที่มาของข้อพิพาท (เจอจริง 2026-08-14 กับใบที่
  // ยืนยันไว้ 57 นาทีก่อน `051da46` ซึ่งเป็น commit ที่แก้สูตร "จ่ายสองต่อ")
  const recomputedNetRefundCents = money.netRefundCents
  const hasNetRefundMismatch = netRefundCents !== recomputedNetRefundCents

  return {
    terminationId: row.termination_id,
    contractId: row.contract_id,
    roomNumber: row.room_number,
    tenantName: row.tenant_name ?? null,
    apartment: {
      name: row.apartment_name,
      address: row.apartment_address,
      phone: row.apartment_phone
    },
    termMonths: row.term_months,
    requiredNoticeDays: row.deposit_notice_days,
    noticeDate: row.notice_date,
    isNoticeGiven: row.is_notice_given === 1,
    noticeDaysGiven: row.notice_days_given,
    moveOutDate: row.actual_move_out_date,
    monthsStayed: row.months_stayed_total,
    // `depositSnapshotCents` มาจาก ...money ข้างล่าง (ค่าเดียวกับ row.deposit_snapshot_cents
    // ที่ส่งเข้าไปเป็นตัวตั้ง) — ชื่อเดียวกับที่ใบพรีวิวใช้ เอกสารจึงมีทางอ่านทางเดียว
    isDepositRefundable: row.is_deposit_refundable === 1,
    forfeitReason: row.forfeit_reason,
    forfeitReasonLabel: row.forfeit_reason ? FORFEIT_REASON_LABELS[row.forfeit_reason] : null,
    outstandingTotalCents: row.unpaid_invoices_total_cents,
    ...money,
    // ยอดที่บันทึกไว้ตอนยืนยันชนะเสมอ — ตัวคำนวณข้างบนไว้แจกแจง ไม่ได้ไว้เขียนประวัติใหม่
    // (ถ้าวันหนึ่งสูตรเปลี่ยน ใบเก่าต้องยังแสดงยอดที่ตกลงกันไว้ในวันนั้น)
    netRefundCents,
    // ยอดที่สูตรปัจจุบันคำนวณได้ + ธงว่าไม่ตรงกับที่บันทึกไว้ (ดูเหตุผลข้างบน)
    // ทั้งเอกสารและหน้าจอต้องขึ้นข้อความกำกับเมื่อธงนี้เป็นจริง
    recomputedNetRefundCents,
    hasNetRefundMismatch,
    // > 0 = เก็บเงินส่วนต่างยังไม่ได้ ยังต้องตามเก็บ
    unpaidBalanceCents,
    isManualOverride: row.is_manual_override === 1,
    overrideReason: row.override_reason,
    status: row.status,
    createdAt: row.created_at,
    items,
    receipts
  }
}

// ------------------------------------------------------------------
// ประวัติการย้ายออกทั้งหมดของหอ
// ------------------------------------------------------------------
// ต้นแบบเก็บผู้เช่าที่ย้ายออกไว้ให้เปิดดูย้อนหลังได้เสมอ ส่วนของเราเคยปิดสัญญาแล้ว
// ข้อมูลหายไปจากทุกหน้าจอ ทั้งที่ยังอยู่ครบใน contract_terminations — ห้องกลับไปเป็นห้องว่าง
// แล้วผู้เช่าคนเดิมก็ไม่มีทางเข้าไปดูอีกเลย ทั้งเรื่องเงินประกันที่คืนไปและเหตุผลที่ริบ
//
// หน้านี้ยังเป็นทางเดียวที่จะไปถึงยอด "ยังเก็บไม่ได้" ของการย้ายออกเก่าๆ ด้วย
// (ดู collectTerminationShortfall)
export function listTerminations(db, apartmentId, { search, dateFrom, dateTo } = {}) {
  if (!apartmentId) throw new Error('ไม่พบหอพัก')

  const where = ['f.apartment_id = @apartmentId']
  const params = { apartmentId }

  // วันขอบนับรวม (เหมือนตัวกรองของหน้าใบแจ้งหนี้และรายงานใบเสร็จ) · ใส่ข้างเดียวได้
  if (dateFrom) {
    where.push('t.actual_move_out_date >= @dateFrom')
    params.dateFrom = dateFrom
  }
  if (dateTo) {
    where.push('t.actual_move_out_date <= @dateTo')
    params.dateTo = dateTo
  }

  const keyword = String(search ?? '').trim()
  if (keyword) {
    params.search = `%${keyword}%`
    // ค้นด้วย EXISTS ไม่ใช่อ้างชื่อคอลัมน์ที่ตั้ง alias ไว้ใน SELECT — SQLite ยอมให้ทำ
    // แต่เป็นส่วนขยายของมันเอง ไม่ใช่ SQL มาตรฐาน เขียนตรงๆ อ่านง่ายกว่าและไม่พึ่งของแถม
    where.push(
      `(r.room_number LIKE @search
        OR EXISTS (SELECT 1
                     FROM contract_tenants ct
                     JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                    WHERE ct.contract_id = c.contract_id
                      AND (tn.first_name || ' ' || tn.last_name) LIKE @search))`
    )
  }

  const rows = db
    .prepare(
      `SELECT t.termination_id, t.contract_id, t.actual_move_out_date, t.notice_date,
              t.is_notice_given, t.notice_days_given, t.months_stayed_total,
              t.deposit_snapshot_cents, t.refundable_deposit_cents,
              t.net_refund_amount_cents, t.unpaid_invoices_total_cents,
              t.is_deposit_refundable, t.forfeit_reason, t.is_manual_override,
              t.created_at,
              r.room_number, c.start_date, c.term_months,
              (SELECT tn.first_name || ' ' || tn.last_name
                 FROM contract_tenants ct
                 JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                WHERE ct.contract_id = c.contract_id
                ORDER BY ct.is_primary DESC, tn.tenant_id
                LIMIT 1) AS tenant_name,
              (${COLLECTED_SHORTFALL_SUBQUERY}) AS collected_cents
         FROM contract_terminations t
         JOIN contracts c  ON c.contract_id = t.contract_id
         JOIN rooms r      ON r.room_id = c.room_id
         JOIN floors f     ON f.floor_id = r.floor_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.actual_move_out_date DESC, t.termination_id DESC`
    )
    .all(params)

  // รายการหักของทุกใบในคิวรีเดียว แล้วจับกลุ่มในหน่วยความจำ — ต้องมีเพื่อคิดยอดตามสูตร
  // ปัจจุบันเทียบกับยอดที่บันทึกไว้ (ธง hasNetRefundMismatch) ถ้าธงนี้โผล่เฉพาะตอนเปิดดูรายใบ
  // ก็ไม่มีใครหาเจออยู่ดี ตารางคือที่ที่คนกวาดสายตา
  const itemsByTermination = new Map()
  if (rows.length > 0) {
    const ids = rows.map((row) => row.termination_id)
    const placeholders = ids.map(() => '?').join(',')
    const allItems = db
      .prepare(
        `SELECT contract_termination_id, item_type, description, total_amount_cents
           FROM contract_termination_items
          WHERE contract_termination_id IN (${placeholders})
          ORDER BY item_id`
      )
      .all(ids)
    for (const item of allItems) {
      const list = itemsByTermination.get(item.contract_termination_id) ?? []
      list.push({
        itemType: item.item_type,
        itemTypeLabel: TERMINATION_ITEM_TYPE_LABELS[item.item_type] ?? item.item_type,
        description: item.description,
        amountCents: item.total_amount_cents
      })
      itemsByTermination.set(item.contract_termination_id, list)
    }
  }

  const terminations = rows.map((row) => {
    const money = summariseMoney({
      depositReceivedCents: row.deposit_snapshot_cents,
      items: itemsByTermination.get(row.termination_id) ?? [],
      isRefundable: row.is_deposit_refundable === 1
    })

    return {
      terminationId: row.termination_id,
      contractId: row.contract_id,
      roomNumber: row.room_number,
      tenantName: row.tenant_name ?? null,
      startDate: row.start_date,
      moveOutDate: row.actual_move_out_date,
      noticeDate: row.notice_date,
      isNoticeGiven: row.is_notice_given === 1,
      noticeDaysGiven: row.notice_days_given,
      monthsStayed: row.months_stayed_total,
      termMonths: row.term_months,
      depositSnapshotCents: row.deposit_snapshot_cents,
      depositRefundCents: row.refundable_deposit_cents,
      outstandingTotalCents: row.unpaid_invoices_total_cents,
      netRefundCents: row.net_refund_amount_cents,
      isDepositRefundable: row.is_deposit_refundable === 1,
      forfeitReason: row.forfeit_reason,
      forfeitReasonLabel: row.forfeit_reason ? FORFEIT_REASON_LABELS[row.forfeit_reason] : null,
      isManualOverride: row.is_manual_override === 1,
      collectedShortfallCents: row.collected_cents,
      // > 0 = ยังต้องตามเก็บ — คอลัมน์นี้คือเหตุผลหลักที่หน้านี้มีอยู่
      unpaidBalanceCents: shortfallOutstanding(row.net_refund_amount_cents, row.collected_cents),
      // ยอดที่บันทึกไว้ไม่ตรงกับที่สูตรปัจจุบันคำนวณได้ = ใบที่ตัดสินด้วยสูตรคนละรุ่น
      recomputedNetRefundCents: money.netRefundCents,
      hasNetRefundMismatch: row.net_refund_amount_cents !== money.netRefundCents,
      createdAt: row.created_at
    }
  })

  const unpaid = terminations.filter((t) => t.unpaidBalanceCents > 0)

  return {
    terminations,
    count: terminations.length,
    // ยอดที่หอยังตามเก็บไม่ได้ทั้งหมด — ตัวเลขที่เจ้าของหอเปิดหน้านี้มาดูเป็นอย่างแรก
    unpaidTotalCents: unpaid.reduce((sum, t) => sum + t.unpaidBalanceCents, 0),
    unpaidCount: unpaid.length,
    forfeitedCount: terminations.filter((t) => !t.isDepositRefundable).length,
    // ปกติต้องเป็น 0 เสมอ — ไม่เป็น 0 เมื่อไหร่แปลว่ามีใบที่ตัดสินไว้ด้วยสูตรคนละรุ่นกับที่ใช้อยู่
    mismatchCount: terminations.filter((t) => t.hasNetRefundMismatch).length
  }
}

// ------------------------------------------------------------------
// ตามเก็บเงินส่วนต่างทีหลัง
// ------------------------------------------------------------------
// ตอนย้ายออก ถ้ายอดสุทธิติดลบแล้วเจ้าของหอติ๊ก "ยังเก็บไม่ได้" ระบบจะไม่ออกใบเสร็จ
// แล้วยอดนั้นค้างอยู่ในบันทึกการย้ายออกโดย **ไม่มีที่ให้บันทึกตอนเก็บเงินได้จริง** —
// ผู้เช่าเอาเงินมาให้อีกสองอาทิตย์ถัดมา คนคีย์ก็ไม่มีปุ่มให้กด สุดท้ายจะไปคีย์เป็นอย่างอื่น
// หรือไม่คีย์เลย แล้วยอดค้างในระบบจะไม่ตรงกับความจริงตลอดไป
//
// ใบที่ออกเป็นชนิดเดียวกับใบที่ออกตอนย้ายออก (purpose = 'other' ผูกกับสัญญา) เพราะมันคือ
// เงินก้อนเดียวกัน แค่มาถึงช้ากว่า — ทั้งสองใบจึงโผล่ในใบสรุปการย้ายออกใบเดิมเหมือนกัน
export function collectTerminationShortfall(
  db,
  contractId,
  { amount, paymentMethod, paymentDate, remark, createdBy } = {}
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้รับเงิน กรุณาเข้าสู่ระบบใหม่')

  const termination = getTerminationByContract(db, contractId)
  if (!termination) throw new Error('ไม่พบบันทึกการย้ายออกของสัญญานี้')
  if (termination.unpaidBalanceCents <= 0) {
    throw new Error('การย้ายออกครั้งนี้ไม่มียอดค้างให้เก็บแล้ว')
  }

  const date = paymentDate ?? todayIso()
  if (!isDate(date)) throw new FieldError({ paymentDate: 'กรุณาระบุวันที่รับเงิน' })
  // รับเงินก่อนวันที่ย้ายออกไม่ได้ — เงินก้อนนี้เกิดจากการตรวจห้องตอนย้ายออก
  // วันที่ก่อนหน้านั้นคือวันที่พิมพ์ผิด และจะทำให้ใบเสร็จไปโผล่ผิดเดือนในรายงาน
  if (date < termination.moveOutDate) {
    throw new FieldError({
      paymentDate: `วันที่รับเงินต้องไม่ก่อนวันที่ย้ายออก (${termination.moveOutDate})`
    })
  }

  // toCents โยน Error ธรรมดาเมื่อรูปแบบตัวเลขผิด — ห่อให้ผูกกับช่องจำนวนเงิน ข้อความเดิม
  let magnitude
  try {
    magnitude = toCents(amount, 'จำนวนเงิน')
  } catch (err) {
    throw new FieldError({ amount: err.message })
  }
  if (magnitude <= 0) throw new FieldError({ amount: 'จำนวนเงินต้องมากกว่า 0' })
  // เก็บเกินยอดค้างไม่ได้ (กติกาเดียวกับการรับชำระบิล) — ทยอยจ่ายทีละส่วนได้ตามปกติ
  if (magnitude > termination.unpaidBalanceCents) {
    throw new FieldError({
      amount: `รับเงินเกินยอดที่ค้างอยู่ (${formatBaht(termination.unpaidBalanceCents)} บาท) ไม่ได้`
    })
  }

  const receipt = recordContractPayment(db, {
    contractId,
    amount: magnitude / 100,
    paymentMethod: paymentMethod ?? 'cash',
    paymentDate: date,
    remark: String(remark ?? '').trim() || `รับเงินส่วนต่างตอนย้ายออก ห้อง ${termination.roomNumber}`,
    createdBy,
    purpose: 'other'
  })

  // คืนบันทึกที่อ่านใหม่ทั้งใบ ไม่ใช่แค่ใบเสร็จ — หน้าจอต้องได้ยอดค้างที่ลดลงแล้ว
  // และใบสรุปที่พิมพ์ต่อจากนี้ต้องมีใบเสร็จใบใหม่อยู่ในตารางด้วย
  return { ...getTerminationByContract(db, contractId), receipt }
}

// ------------------------------------------------------------------
function requireActiveContract(db, contractId) {
  const row = db
    .prepare(
      // ข้อมูลหอกับชื่อผู้เช่าติดมาด้วย เพราะใบสรุปต้องพิมพ์ได้ตั้งแต่ก่อนกดยืนยัน
      `SELECT c.*, r.room_number, f.apartment_id,
              a.name_th AS apartment_name, a.address_th AS apartment_address,
              a.phone AS apartment_phone,
              (SELECT tn.first_name || ' ' || tn.last_name
                 FROM contract_tenants ct
                 JOIN tenants tn ON tn.tenant_id = ct.tenant_id
                WHERE ct.contract_id = c.contract_id
                ORDER BY ct.is_primary DESC, tn.tenant_id
                LIMIT 1) AS tenant_name
         FROM contracts c
         JOIN rooms r      ON r.room_id = c.room_id
         JOIN floors f     ON f.floor_id = r.floor_id
         JOIN apartments a ON a.apartment_id = f.apartment_id
        WHERE c.contract_id = ?`
    )
    .get(contractId)
  if (!row) throw new Error('ไม่พบสัญญา')
  if (row.status !== 'active') throw new Error('สัญญานี้ถูกยกเลิกไปแล้ว')

  row.apartment = {
    name: row.apartment_name,
    address: row.apartment_address,
    phone: row.apartment_phone
  }
  return row
}

function formatBaht(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
