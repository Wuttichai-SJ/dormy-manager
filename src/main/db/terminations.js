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
// ทั้ง invoices.js และ payments.js ไม่ได้นำเข้าไฟล์นี้กลับ ทิศทางจึงไม่เป็นวงกลม
import { listInvoices, nextDocumentNumber, refreshInvoiceStatus } from './invoices.js'
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
export function getTerminationSheet(db, contractId, { moveOutDate, adjustments } = {}) {
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
  const refundableDepositCents = verdict.isRefundable ? deposit.receivedCents : 0

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
  const adjustmentsTotalCents = items.reduce((sum, i) => sum + i.amountCents, 0)

  // 🔴 **เงินประกันที่ถูกริบ เอาไปหักหนี้ไม่ได้** (ผู้ใช้ตัดสินใจ 2026-08-11)
  // ริบแปลว่าเงินก้อนนั้นตกเป็นของหอในฐานะค่าปรับผิดสัญญา ไม่ใช่กระเป๋าเงินสำรอง
  // ที่เอามาปิดหนี้ค่าน้ำค่าไฟได้ — หนี้ยังเป็นหนี้ที่ต้องตามเก็บต่อ
  //
  // ผลคือ `settledFromDepositCents` เป็น 0 เมื่อริบ แล้วยอดสุทธิติดลบเท่ากับที่ยังค้าง
  // ซึ่งอ่านออกตรงตัวว่า "ผู้เช่ายังต้องจ่ายอีกเท่านี้"
  const settledFromDepositCents = Math.min(refundableDepositCents, outstandingTotalCents)
  const netRefundCents = refundableDepositCents - outstandingTotalCents - adjustmentsTotalCents

  return {
    contractId,
    roomNumber: contract.room_number,
    apartmentId: contract.apartment_id,
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
    isDepositRefundable: verdict.isRefundable,
    forfeitReason: verdict.forfeitReason,
    forfeitReasonLabel: verdict.forfeitReason
      ? FORFEIT_REASON_LABELS[verdict.forfeitReason]
      : null,
    refundableDepositCents,
    outstandingInvoices,
    outstandingTotalCents,
    items,
    adjustmentsTotalCents,
    settledFromDepositCents,
    // ติดลบ = ผู้เช่ายังต้องจ่ายเพิ่ม ไม่ใช่ได้เงินคืน
    netRefundCents
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
// ทำทุกอย่างในธุรกรรมเดียว: ตัดหนี้จากเงินประกัน → ออกใบเสร็จคืนเงิน → บันทึกผลการตัดสิน
// → ปิดสัญญา → คืนห้องเป็นว่าง · ถ้าขั้นใดพัง ต้องไม่เหลือครึ่งๆ กลางๆ ให้ตามแก้
export function completeTermination(
  db,
  contractId,
  { moveOutDate, adjustments, overrideRefundable, overrideReason, paymentMethod, createdBy } = {}
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้ทำรายการ กรุณาเข้าสู่ระบบใหม่')

  const sheet = getTerminationSheet(db, contractId, { moveOutDate, adjustments })

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

  const isRefundable = isOverride ? Boolean(overrideRefundable) : sheet.isDepositRefundable
  const refundableDepositCents = isRefundable ? sheet.depositReceivedCents : 0
  const settledCents = Math.min(refundableDepositCents, sheet.outstandingTotalCents)
  const netRefundCents =
    refundableDepositCents - sheet.outstandingTotalCents - sheet.adjustmentsTotalCents

  const now = new Date().toISOString()
  const run = db.transaction(() => {
    // 1) ตัดหนี้จากเงินประกันเท่าที่คืนได้ ไล่จากบิลเก่าสุดก่อน
    //    **เงินที่ถูกริบไม่ถูกนำมาตัดหนี้** refundableDepositCents จึงเป็น 0 แล้วลูปนี้ไม่ทำงานเลย
    let remaining = settledCents
    const settledInvoices = []
    for (const invoice of sheet.outstandingInvoices) {
      if (remaining <= 0) break
      const pay = Math.min(remaining, invoice.outstandingCents)
      settleInvoiceFromDeposit(db, invoice.invoiceId, pay, {
        paymentDate: sheet.moveOutDate,
        createdBy,
        apartmentId: sheet.apartmentId,
        now
      })
      settledInvoices.push({ invoiceNumber: invoice.invoiceNumber, amountCents: pay })
      remaining -= pay
    }

    // 2) ใบเสร็จคืนเงินประกัน — ยอดติดลบ ตรงกับที่ต้นแบบแสดงป้าย "คืนเงินประกัน"
    //    ออกเฉพาะเมื่อมีเงินคืนจริง · ติดลบ (ผู้เช่าค้าง) ไม่ออกใบเสร็จ เพราะยังไม่มีเงินเคลื่อน
    let refundReceipt = null
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
        refundable: refundableDepositCents,
        isOverride: isOverride ? 1 : 0,
        overrideReason: isOverride ? note : null
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

    return { terminationId, settledInvoices, refundReceipt }
  })

  const { terminationId, settledInvoices, refundReceipt } = run()
  return {
    ...getTerminationByContract(db, contractId),
    settledInvoices,
    refundReceipt
  }
}

// ตัดหนี้ด้วยเงินประกัน — ไม่ได้เรียก recordInvoicePayment เพราะตัวนั้นมีเรื่องค่าปรับ
// ชำระล่าช้าพ่วงมาด้วย ซึ่งไม่ควรงอกขึ้นมาตอนย้ายออก (ผู้เช่าไปแล้ว ไม่มีใครให้ต่อรอง)
//
// **ช่องทางเป็น 'deposit' ไม่ใช่ 'cash'** — เงินก้อนนี้ไม่ได้เพิ่งเข้าหอ มันเข้ามาตั้งแต่
// วันทำสัญญาแล้วในฐานะเงินประกัน นี่คือการย้ายกระเป๋า ถ้าลงเป็นเงินสด รายงานใบเสร็จ
// จะนับรายรับซ้ำสองรอบจากเงินก้อนเดียว
function settleInvoiceFromDeposit(db, invoiceId, amountCents, { paymentDate, createdBy, apartmentId, now }) {
  const receiptNumber = nextDocumentNumber(db, apartmentId, 'receipt', paymentDate)
  db.prepare(
    `INSERT INTO payments (
       invoice_id, contract_id, apartment_id, receipt_number, payment_date,
       amount_cents, vat_amount_cents, purpose, payment_method, remark, created_by, created_at
     ) VALUES (
       @invoiceId, NULL, @apartmentId, @receiptNumber, @paymentDate,
       @amountCents, 0, 'invoice', 'deposit', @remark, @createdBy, @now
     )`
  ).run({
    invoiceId,
    apartmentId,
    receiptNumber,
    paymentDate,
    amountCents,
    remark: 'หักจากเงินประกันตอนย้ายออก',
    createdBy,
    now
  })
  refreshInvoiceStatus(db, invoiceId, now)
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
export function getTerminationByContract(db, contractId) {
  const row = db
    .prepare(
      `SELECT t.*, r.room_number, c.start_date, c.deposit_refund_policy
         FROM contract_terminations t
         JOIN contracts c ON c.contract_id = t.contract_id
         JOIN rooms r     ON r.room_id = c.room_id
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

  // ใบเสร็จที่เกิดจากการย้ายออกครั้งนี้ — ทั้งใบคืนเงินและใบที่หักจากเงินประกัน
  // ตรงกับตาราง "รายละเอียดการย้ายออก" ของต้นแบบ (เลขที่ใบเสร็จ | ประเภท | ยอดเงิน)
  const receipts = db
    .prepare(
      `SELECT p.receipt_number, p.payment_date, p.amount_cents, p.payment_method,
              p.purpose, i.invoice_number
         FROM payments p
         LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
        WHERE p.payment_date = @moveOutDate
          AND p.cancelled_at IS NULL
          AND (p.contract_id = @contractId
               OR i.contract_id = @contractId)
        ORDER BY p.payment_id`
    )
    .all({ moveOutDate: row.actual_move_out_date, contractId })
    .map((p) => ({
      receiptNumber: p.receipt_number,
      paymentDate: p.payment_date,
      amountCents: p.amount_cents,
      label: p.invoice_number ? `หักหนี้ใบแจ้งหนี้ #${p.invoice_number}` : 'คืนเงินประกัน'
    }))

  return {
    terminationId: row.termination_id,
    contractId: row.contract_id,
    roomNumber: row.room_number,
    noticeDate: row.notice_date,
    isNoticeGiven: row.is_notice_given === 1,
    noticeDaysGiven: row.notice_days_given,
    moveOutDate: row.actual_move_out_date,
    monthsStayed: row.months_stayed_total,
    depositSnapshotCents: row.deposit_snapshot_cents,
    isDepositRefundable: row.is_deposit_refundable === 1,
    forfeitReason: row.forfeit_reason,
    forfeitReasonLabel: row.forfeit_reason ? FORFEIT_REASON_LABELS[row.forfeit_reason] : null,
    refundableDepositCents: row.refundable_deposit_cents,
    outstandingTotalCents: row.unpaid_invoices_total_cents,
    adjustmentsTotalCents: row.additional_adjustments_total_cents,
    netRefundCents: row.net_refund_amount_cents,
    isManualOverride: row.is_manual_override === 1,
    overrideReason: row.override_reason,
    status: row.status,
    createdAt: row.created_at,
    items,
    receipts
  }
}

// ------------------------------------------------------------------
function requireActiveContract(db, contractId) {
  const row = db
    .prepare(
      `SELECT c.*, r.room_number, f.apartment_id
         FROM contracts c
         JOIN rooms r  ON r.room_id = c.room_id
         JOIN floors f ON f.floor_id = r.floor_id
        WHERE c.contract_id = ?`
    )
    .get(contractId)
  if (!row) throw new Error('ไม่พบสัญญา')
  if (row.status !== 'active') throw new Error('สัญญานี้ถูกยกเลิกไปแล้ว')
  return row
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
