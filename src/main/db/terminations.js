// ต่างจากต้นแบบ: หอนี้มีกฎริบเงินประกัน (ตรึงไว้ในสัญญาแต่ละใบ)
import { toCents } from '../money.js'
import { FieldError } from '../fieldError.js'
import { listInvoices } from './invoices.js'
import { getDepositStatus, recordContractPayment } from './payments.js'

export const TERMINATION_ITEM_TYPES = ['service', 'meter', 'discount_refund']

export const TERMINATION_ITEM_TYPE_LABELS = {
  service: 'ค่าบริการ',
  meter: 'ค่ามิเตอร์',
  discount_refund: 'ส่วนลด / คืนเงิน'
}

export const FORFEIT_REASON_LABELS = {
  early_move_out: 'ออกก่อนครบกำหนดตามสัญญา',
  insufficient_notice: 'แจ้งย้ายออกล่วงหน้าไม่ครบตามกำหนด',
  both: 'ออกก่อนครบกำหนด และแจ้งล่วงหน้าไม่ครบตามกำหนด',
  policy_never: 'สัญญาฉบับนี้ระบุว่าไม่คืนเงินประกัน'
}

// ใช้ก้อนเดียวทุกที่ — ยอดค้างเก็บในประวัติกับใบสรุปจะได้ตรงกัน
const MOVE_OUT_RECEIPT_FILTER = `cancelled_at IS NULL
          AND (purpose = 'other' OR (purpose = 'deposit' AND amount_cents < 0))`

const COLLECTED_SHORTFALL_SUBQUERY = `SELECT COALESCE(SUM(amount_cents), 0)
             FROM payments
            WHERE contract_id = t.contract_id
              AND cancelled_at IS NULL
              AND purpose = 'other'`

// สุทธิติดลบ = ผู้เช่าต้องจ่ายเพิ่ม (หักที่เก็บได้แล้ว) · บวก/ศูนย์ = ไม่มีอะไรตามเก็บ
export function shortfallOutstanding(netRefundCents, collectedCents) {
  return netRefundCents < 0 ? Math.max(0, -netRefundCents - collectedCents) : 0
}

// บันทึกวันที่แจ้งอย่างเดียว — ผู้เช่ายังอยู่ ห้องยังไม่ว่าง
export function setMoveOutNotice(db, contractId, noticeDate) {
  const contract = requireActiveContract(db, contractId)

  if (noticeDate !== null && !isDate(noticeDate)) {
    throw new FieldError({ noticeDate: 'กรุณาระบุวันที่แจ้งย้ายออก' })
  }
  if (noticeDate !== null && noticeDate < contract.start_date) {
    throw new FieldError({
      noticeDate: `วันที่แจ้งย้ายออกต้องไม่ก่อนวันเริ่มสัญญา (${contract.start_date})`
    })
  }

  db.prepare('UPDATE contracts SET move_out_notice_date = ?, updated_at = ? WHERE contract_id = ?')
    .run(noticeDate, new Date().toISOString(), contractId)

  return { contractId, moveOutNoticeDate: noticeDate }
}

// นับเดือนต่อเนื่องข้ามสายการต่อสัญญา (previous_contract_id)
export function findChainStartDate(db, contractId) {
  const stmt = db.prepare('SELECT contract_id, start_date, previous_contract_id FROM contracts WHERE contract_id = ?')
  let row = stmt.get(contractId)
  if (!row) throw new Error('ไม่พบสัญญา')

  const seen = new Set()
  while (row.previous_contract_id) {
    // กันวนไม่รู้จบถ้าข้อมูลชี้กลับหาตัวเอง
    if (seen.has(row.contract_id)) break
    seen.add(row.contract_id)
    const previous = stmt.get(row.previous_contract_id)
    if (!previous) break
    row = previous
  }
  return row.start_date
}

// เดือนเต็ม: เริ่ม 15/01 ออก 14/07 = 5 เดือน · ออก 15/07 = 6 เดือน
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

// ใช้กฎที่ตรึงในสัญญา · ริบคือริบทั้งก้อน
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

  // null = สัญญาไม่กำหนดระยะ
  const tooEarly = requiredMonths !== null && requiredMonths !== undefined && monthsStayed < requiredMonths
  // ไม่แจ้งเลย = 0 วัน
  const tooLate = !isNoticeGiven || noticeDaysGiven < requiredNoticeDays

  if (tooEarly && tooLate) return { isRefundable: false, forfeitReason: 'both' }
  if (tooEarly) return { isRefundable: false, forfeitReason: 'early_move_out' }
  if (tooLate) return { isRefundable: false, forfeitReason: 'insufficient_notice' }
  return { isRefundable: true, forfeitReason: null }
}

// คำนวณอย่างเดียว · adjustments ส่วนลดส่งเป็นบวก ระบบกลับเครื่องหมายเอง · ต้องรับ overrideRefundable
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
  // แจ้งหลังวันออก = 0 วัน
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

  // ใช้เงินประกันที่รับมาจริง ไม่ใช่ยอดที่ตกลง
  const deposit = getDepositStatus(db, contractId)

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

  // เจ้าของกดข้ามกฎได้ · เก็บผลตามกฎไว้เทียบด้วย
  const appliedRefundable =
    overrideRefundable === undefined || overrideRefundable === null
      ? verdict.isRefundable
      : Boolean(overrideRefundable)

  const money = summariseMoney({
    depositReceivedCents: deposit.receivedCents,
    items,
    isRefundable: appliedRefundable
  })

  // ต้องเคลียร์บิลค้างก่อนย้ายออก (ระบบไม่หักจากเงินประกันให้) · บิลค้างไม่เข้าสูตรยอดสุทธิ
  const hasOutstanding = outstandingTotalCents > 0

  return {
    contractId,
    roomNumber: contract.room_number,
    apartmentId: contract.apartment_id,
    apartment: contract.apartment,
    tenantName: contract.tenant_name ?? null,
    termMonths: contract.term_months,
    startDate: contract.start_date,
    chainStartDate: chainStart,
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
    appliedRefundable,
    forfeitReason: verdict.forfeitReason,
    forfeitReasonLabel: verdict.forfeitReason
      ? FORFEIT_REASON_LABELS[verdict.forfeitReason]
      : null,
    outstandingInvoices,
    outstandingTotalCents,
    hasOutstanding,
    items,
    ...money
  }
}

// สูตร: ค่าเสียหายหักจากเงินประกัน · ค่ามิเตอร์เก็บแยก · ส่วนลด/คืนเงินคืนเสมอ · ริบ = ส่วนที่เหลือหลังหักค่าเสียหาย
export function summariseMoney({ depositReceivedCents, items, isRefundable }) {
  const sumOf = (type) =>
    items.filter((i) => i.itemType === type).reduce((sum, i) => sum + Math.abs(i.amountCents), 0)

  const damageTotalCents = sumOf('service')
  const meterTotalCents = sumOf('meter')
  const refundItemsTotalCents = sumOf('discount_refund')

  // depositBalanceCents ติดลบได้ (แสดงผล) · depositAfterDamageCents ไม่ต่ำกว่า 0
  const depositBalanceCents = depositReceivedCents - damageTotalCents
  const depositAfterDamageCents = Math.max(0, depositBalanceCents)
  const excessDamageCents = Math.max(0, -depositBalanceCents)

  const forfeitedCents = isRefundable ? 0 : depositAfterDamageCents
  const depositRefundCents = isRefundable ? depositAfterDamageCents : 0

  const tenantOwesCents = excessDamageCents + meterTotalCents
  const buildingReturnsCents = depositRefundCents + refundItemsTotalCents

  return {
    // ชื่อฟิลด์ต้องตรงกับที่เก็บในฐานข้อมูล — ใบพรีวิวกับใบบันทึกใช้ตัวเดียวกัน
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
    adjustmentsTotalCents: items.reduce((sum, i) => sum + i.amountCents, 0),
    // บวก = หอคืนให้ผู้เช่า · ลบ = ผู้เช่าจ่ายเพิ่ม
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
      // ส่วนลดเก็บเป็นลบ ผู้ใช้กรอกเป็นบวก
      amountCents: itemType === 'discount_refund' ? -magnitude : magnitude
    }
  })
}

// ทำทุกอย่างในธุรกรรมเดียว
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
    // collected: true = ออกใบเสร็จ · false = ค้างไว้ในบันทึกการย้ายออก
    collectShortfall,
    paymentMethod,
    createdBy
  } = {}
) {
  if (!createdBy) throw new Error('ไม่ทราบผู้ทำรายการ กรุณาเข้าสู่ระบบใหม่')

  // ใช้ตัวคำนวณเดียวกับพรีวิว
  const sheet = getTerminationSheet(db, contractId, {
    moveOutDate,
    adjustments,
    overrideRefundable
  })

  // บิลค้างต้องเคลียร์ก่อน — ข้ามได้พร้อมเหตุผล (ผู้เช่าหนี)
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

  // ข้ามผลการตัดสินได้ แต่ต้องมีเหตุผล
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
    // ไม่แตะบิลค้าง — ยังต้องตามเก็บต่อ

    // มีเงินเคลื่อนต้องมีใบเสร็จ: บวก → ใบคืนเงินประกัน (ติดลบ) · ลบ → ใบรับเงินส่วนต่าง
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
        // ไม่แจ้งล่วงหน้า: ใส่วันที่ออกแทน (NOT NULL) คู่กับ is_notice_given = 0
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
        // คืนได้จริง = หลังหักค่าเสียหาย
        refundable: sheet.depositRefundCents,
        isOverride: isOverride ? 1 : 0,
        overrideReason:
          [
            isOverride ? note : null,
            outstandingNote ? `ย้ายออกทั้งที่ค้างบิล: ${outstandingNote}` : null
          ]
            .filter(Boolean)
            .join(' · ') || null
      })

    const terminationId = result.lastInsertRowid

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

    // ปิดสัญญาและคืนห้องเป็นว่าง
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

export function getTerminationByContract(db, contractId) {
  const row = db
    .prepare(
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

  // แยกใบของการย้ายออกด้วยความหมาย ไม่ใช่วันที่: 'other' = ส่วนต่าง · 'deposit' ติดลบ = คืนเงินประกัน
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
      label: p.amount_cents < 0 ? 'คืนเงินประกัน' : 'รับเงินส่วนต่างตอนย้ายออก'
    }))

  // สุทธิติดลบแต่ยังไม่มีใบรับเงิน = ยังค้าง
  const collectedCents = receipts
    .filter((r) => r.amountCents > 0)
    .reduce((sum, r) => sum + r.amountCents, 0)
  const netRefundCents = row.net_refund_amount_cents
  const unpaidBalanceCents = shortfallOutstanding(netRefundCents, collectedCents)

  const money = summariseMoney({
    depositReceivedCents: row.deposit_snapshot_cents,
    items,
    isRefundable: row.is_deposit_refundable === 1
  })

  // ใบเก่าที่คำนวณด้วยสูตรคนละรุ่นต้องมีธงบอก
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
    isDepositRefundable: row.is_deposit_refundable === 1,
    forfeitReason: row.forfeit_reason,
    forfeitReasonLabel: row.forfeit_reason ? FORFEIT_REASON_LABELS[row.forfeit_reason] : null,
    outstandingTotalCents: row.unpaid_invoices_total_cents,
    ...money,
    // ยอดที่บันทึกตอนยืนยันชนะเสมอ
    netRefundCents,
    recomputedNetRefundCents,
    hasNetRefundMismatch,
    // > 0 = ยังต้องตามเก็บ
    unpaidBalanceCents,
    isManualOverride: row.is_manual_override === 1,
    overrideReason: row.override_reason,
    status: row.status,
    createdAt: row.created_at,
    items,
    receipts
  }
}

export function listTerminations(db, apartmentId, { search, dateFrom, dateTo } = {}) {
  if (!apartmentId) throw new Error('ไม่พบหอพัก')

  const where = ['f.apartment_id = @apartmentId']
  const params = { apartmentId }

  // วันขอบนับรวม · ใส่ข้างเดียวได้
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
      unpaidBalanceCents: shortfallOutstanding(row.net_refund_amount_cents, row.collected_cents),
      recomputedNetRefundCents: money.netRefundCents,
      hasNetRefundMismatch: row.net_refund_amount_cents !== money.netRefundCents,
      createdAt: row.created_at
    }
  })

  const unpaid = terminations.filter((t) => t.unpaidBalanceCents > 0)

  return {
    terminations,
    count: terminations.length,
    unpaidTotalCents: unpaid.reduce((sum, t) => sum + t.unpaidBalanceCents, 0),
    unpaidCount: unpaid.length,
    forfeitedCount: terminations.filter((t) => !t.isDepositRefundable).length,
    mismatchCount: terminations.filter((t) => t.hasNetRefundMismatch).length
  }
}

// ตามเก็บเงินส่วนต่างทีหลัง — ใบเสร็จชนิดเดียวกับตอนย้ายออก (purpose = 'other')
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
  // รับเงินก่อนวันย้ายออกไม่ได้
  if (date < termination.moveOutDate) {
    throw new FieldError({
      paymentDate: `วันที่รับเงินต้องไม่ก่อนวันที่ย้ายออก (${termination.moveOutDate})`
    })
  }

  let magnitude
  try {
    magnitude = toCents(amount, 'จำนวนเงิน')
  } catch (err) {
    throw new FieldError({ amount: err.message })
  }
  if (magnitude <= 0) throw new FieldError({ amount: 'จำนวนเงินต้องมากกว่า 0' })
  // เก็บเกินยอดค้างไม่ได้ ทยอยจ่ายได้
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

  return { ...getTerminationByContract(db, contractId), receipt }
}

function requireActiveContract(db, contractId) {
  const row = db
    .prepare(
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
