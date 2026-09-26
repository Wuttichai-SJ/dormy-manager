// ทดสอบการแจ้งย้ายออก / ยกเลิกสัญญา / คืนเงินประกัน — รันด้วย: npm run test:terminations
import {
  assert,
  check,
  ensureElectronRuntime,
  group,
  openTempDatabase,
  summarize,
  throws
} from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const apartments = await import('../src/main/db/apartments.js')
const utility = await import('../src/main/db/utilityDefaults.js')
const rooms = await import('../src/main/db/rooms.js')
const tenants = await import('../src/main/db/tenants.js')
const users = await import('../src/main/db/users.js')
const contracts = await import('../src/main/db/contracts.js')
const meter = await import('../src/main/db/meterReadings.js')
const invoices = await import('../src/main/db/invoices.js')
const payments = await import('../src/main/db/payments.js')
const terminations = await import('../src/main/db/terminations.js')

const { db, cleanup } = await openTempDatabase('dormy-terminations')

const staff = users.insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  email: 'manager@example.com',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบย้ายออก',
  addressTh: 'ที่อยู่',
  dueDateDay: 10,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId
utility.saveUtilityDefaults(db, apartmentId, {
  water: { enabled: false },
  electric: { enabled: false }
})

let roomSeq = 0
function makeRoom(rent = '5000') {
  const floors = rooms.addFloor(db, apartmentId, { roomCount: 1 })
  const room = floors[floors.length - 1].rooms[0]
  rooms.setRoomRates(db, [room.roomId], { monthlyRent: rent })
  return room
}

function makeTenant() {
  roomSeq += 1
  return tenants.insertTenant(db, {
    firstName: `ผู้เช่า${roomSeq}`,
    lastName: 'ทดสอบ',
    phone: `08000000${String(roomSeq).padStart(2, '0')}`
  })
}

function makeContract({ startDate = '2026-01-15', termMonths = 12, deposit = '5000', rent = '5000' } = {}) {
  const room = makeRoom(rent)
  const person = makeTenant()
  const contract = contracts.createContract(db, {
    roomId: room.roomId,
    rentType: 'monthly',
    startDate,
    rentAmount: rent,
    deposit,
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    termMonths,
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [person.tenantId],
    createdBy: staff.user_id
  })
  return { room, contract }
}

group('นับเดือนที่อยู่')

check('ยังไม่ถึงวันเดียวกันของเดือนนั้น ถือว่ายังไม่ครบเดือน', () => {
  assert(terminations.monthsBetween('2026-01-15', '2026-07-14') === 5, 'วันที่ 14 ต้องได้ 5')
  assert(terminations.monthsBetween('2026-01-15', '2026-07-15') === 6, 'วันที่ 15 ต้องได้ 6')
  assert(terminations.monthsBetween('2026-01-15', '2026-07-16') === 6, 'วันที่ 16 ยังเป็น 6')
})

check('ข้ามปีนับต่อเนื่อง', () => {
  assert(terminations.monthsBetween('2025-11-01', '2026-05-01') === 6, 'ต้องได้ 6')
})

group('ผลการตัดสินเรื่องเงินประกัน')

check('อยู่ครบตามสัญญา + แจ้งทัน = คืนเต็ม', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: 6,
    monthsStayed: 6,
    requiredNoticeDays: 15,
    noticeDaysGiven: 20,
    isNoticeGiven: true
  })
  assert(v.isRefundable === true, 'ต้องคืน')
  assert(v.forfeitReason === null, `ได้ ${v.forfeitReason}`)
})

check('ออกก่อนครบ = ริบ และบอกเหตุผลว่าออกก่อนครบ', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: 6,
    monthsStayed: 5,
    requiredNoticeDays: 15,
    noticeDaysGiven: 30,
    isNoticeGiven: true
  })
  assert(v.isRefundable === false, 'ต้องริบ')
  assert(v.forfeitReason === 'early_move_out', `ได้ ${v.forfeitReason}`)
})

check('อยู่ครบแต่แจ้งไม่ทัน = ริบ', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: 6,
    monthsStayed: 12,
    requiredNoticeDays: 15,
    noticeDaysGiven: 14,
    isNoticeGiven: true
  })
  assert(v.isRefundable === false, 'ต้องริบ')
  assert(v.forfeitReason === 'insufficient_notice', `ได้ ${v.forfeitReason}`)
})

check('แจ้งพอดีตามกำหนดผ่าน', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: 6,
    monthsStayed: 6,
    requiredNoticeDays: 15,
    noticeDaysGiven: 15,
    isNoticeGiven: true
  })
  assert(v.isRefundable === true, 'แจ้ง 15 วันพอดีต้องผ่าน')
})

check('ผิดทั้งสองข้อ บอกว่า both', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: 6,
    monthsStayed: 2,
    requiredNoticeDays: 15,
    noticeDaysGiven: 0,
    isNoticeGiven: false
  })
  assert(v.forfeitReason === 'both', `ได้ ${v.forfeitReason}`)
})

check('สัญญาที่ไม่กำหนดระยะ ไม่มีคำว่าออกก่อนครบ', () => {
  const v = terminations.evaluateDepositRefund({
    policy: 'on_full_term',
    requiredMonths: null,
    monthsStayed: 1,
    requiredNoticeDays: 15,
    noticeDaysGiven: 30,
    isNoticeGiven: true
  })
  assert(v.isRefundable === true, 'ไม่มีระยะสัญญาก็ไม่มีอะไรให้ผิด')
})

check('นโยบาย always / never ชนะทุกเงื่อนไข', () => {
  const always = terminations.evaluateDepositRefund({
    policy: 'always',
    requiredMonths: 12,
    monthsStayed: 0,
    requiredNoticeDays: 15,
    noticeDaysGiven: 0,
    isNoticeGiven: false
  })
  assert(always.isRefundable === true, 'always ต้องคืนเสมอ')

  const never = terminations.evaluateDepositRefund({
    policy: 'never',
    requiredMonths: 6,
    monthsStayed: 99,
    requiredNoticeDays: 15,
    noticeDaysGiven: 99,
    isNoticeGiven: true
  })
  assert(never.isRefundable === false, 'never ต้องไม่คืนเสมอ')
  assert(never.forfeitReason === 'policy_never', `ได้ ${never.forfeitReason}`)
})

group('แจ้งย้ายออก')

const notice = makeContract({ termMonths: 6 })

check('บันทึกวันที่แจ้งย้ายออกได้ และล้างกลับได้', () => {
  terminations.setMoveOutNotice(db, notice.contract.contractId, '2026-07-01')
  let sheet = terminations.getTerminationSheet(db, notice.contract.contractId, {
    moveOutDate: '2026-07-20'
  })
  assert(sheet.noticeDate === '2026-07-01', `ได้ ${sheet.noticeDate}`)
  assert(sheet.noticeDaysGiven === 19, `ได้ ${sheet.noticeDaysGiven}`)

  terminations.setMoveOutNotice(db, notice.contract.contractId, null)
  sheet = terminations.getTerminationSheet(db, notice.contract.contractId, {
    moveOutDate: '2026-07-20'
  })
  assert(sheet.isNoticeGiven === false, 'ล้างแล้วต้องถือว่าไม่ได้แจ้ง')
  assert(sheet.noticeDaysGiven === 0, `ได้ ${sheet.noticeDaysGiven}`)
})

check('แจ้งก่อนวันเริ่มสัญญาไม่ได้', () => {
  throws(
    () => terminations.setMoveOutNotice(db, notice.contract.contractId, '2025-12-01'),
    'ไม่ก่อนวันเริ่มสัญญา',
    'ต้องกันวันที่พิมพ์ผิด'
  )
})

group('ย้ายออกแบบคืนเงินเต็ม')

const clean = makeContract({ termMonths: 6 })

check('อยู่ครบ 6 เดือน แจ้งล่วงหน้า 20 วัน = คืนเต็ม 5,000', () => {
  terminations.setMoveOutNotice(db, clean.contract.contractId, '2026-06-25')
  const sheet = terminations.getTerminationSheet(db, clean.contract.contractId, {
    moveOutDate: '2026-07-15'
  })
  assert(sheet.monthsStayed === 6, `อยู่ ${sheet.monthsStayed} เดือน`)
  assert(sheet.noticeDaysGiven === 20, `แจ้ง ${sheet.noticeDaysGiven} วัน`)
  assert(sheet.isDepositRefundable === true, 'ต้องคืน')
  assert(sheet.depositRefundCents === 500000, `ได้ ${sheet.depositRefundCents}`)
  assert(sheet.netRefundCents === 500000, `สุทธิได้ ${sheet.netRefundCents}`)
})

check('ยืนยันแล้วได้ใบเสร็จคืนเงินยอดติดลบ สัญญาปิด ห้องกลับมาว่าง', () => {
  const result = terminations.completeTermination(db, clean.contract.contractId, {
    moveOutDate: '2026-07-15',
    createdBy: staff.user_id
  })
  assert(result.netRefundCents === 500000, `ได้ ${result.netRefundCents}`)
  assert(result.refundReceipt.amountCents === -500000, `ใบเสร็จได้ ${result.refundReceipt.amountCents}`)

  const contract = contracts.getContractById(db, clean.contract.contractId)
  assert(contract.status === 'terminated', `สัญญาได้ ${contract.status}`)
  assert(contract.endDate === '2026-07-15', `วันสิ้นสุดได้ ${contract.endDate}`)

  const room = contracts
    .listRoomsForApartment(db, apartmentId)
    .find((r) => r.roomId === clean.room.roomId)
  assert(room.status === 'vacant', `ห้องได้ ${room.status}`)
})

check('ห้องที่ย้ายออกแล้ว ทำสัญญาใหม่ได้ทันที', () => {
  const next = makeTenant()
  const fresh = contracts.createContract(db, {
    roomId: clean.room.roomId,
    rentType: 'monthly',
    startDate: '2026-08-01',
    rentAmount: '5000',
    deposit: '5000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    waterMeterStart: 120,
    electricMeterStart: 3400,
    tenants: [next.tenantId],
    createdBy: staff.user_id
  })
  assert(fresh.contractId !== clean.contract.contractId, 'ต้องเป็นสัญญาใบใหม่')
  assert(fresh.status === 'active', `ได้ ${fresh.status}`)
})

group('ต่อสัญญาแล้วนับเดือนต่อเนื่อง')

check('นับจากวันเริ่มของสัญญาใบแรกในสาย ไม่ใช่ใบปัจจุบัน', () => {
  const first = makeContract({ startDate: '2026-01-01', termMonths: 6 })
  const renewed = db
    .prepare(
      `INSERT INTO contracts (
         room_id, rent_type, start_date, rent_amount_cents, deposit_amount_cents,
         deposit_payment_method, booking_fee_cents, advance_payment_amount_cents,
         water_meter_start, electric_meter_start, status, term_months,
         deposit_notice_days, previous_contract_id, is_deposit_carried_over, created_at
       ) VALUES (
         @roomId, 'monthly', '2026-07-01', 500000, 500000,
         'cash', 0, 0, 0, 0, 'active', 6, 15, @previous, 1, @now
       )`
    )
    .run({
      roomId: first.room.roomId,
      previous: first.contract.contractId,
      now: new Date().toISOString()
    })

  db.prepare("UPDATE contracts SET status = 'terminated' WHERE contract_id = ?")
    .run(first.contract.contractId)

  const chainStart = terminations.findChainStartDate(db, renewed.lastInsertRowid)
  assert(chainStart === '2026-01-01', `ได้ ${chainStart} ควรเป็นวันเริ่มของใบแรก`)

  terminations.setMoveOutNotice(db, renewed.lastInsertRowid, '2026-12-01')
  const sheet = terminations.getTerminationSheet(db, renewed.lastInsertRowid, {
    moveOutDate: '2027-01-01'
  })
  assert(sheet.monthsStayed === 12, `ได้ ${sheet.monthsStayed} เดือน ควรเป็น 12`)
  assert(sheet.isRenewal === true, 'ต้องรู้ว่าเป็นการต่อสัญญา')
  assert(sheet.isDepositRefundable === true, 'ครบ 12 เดือนแล้วต้องคืน')
})

group('ริบเงินประกัน — หนี้ยังเป็นหนี้')

const forfeit = makeContract({ startDate: '2026-03-01', termMonths: 12 })
const forfeitBatch = meter.createBatch(db, apartmentId, '2026-05-01')
const forfeitInvoice = invoices.createMonthlyInvoice(db, {
  contractId: forfeit.contract.contractId,
  billingMonth: '2026-05',
  meterBatchId: forfeitBatch.batchId,
  issueDate: '2026-05-01'
})

check('ออกก่อนครบสัญญา 12 เดือน = ริบ และเงินคืนเป็น 0', () => {
  terminations.setMoveOutNotice(db, forfeit.contract.contractId, '2026-05-01')
  const sheet = terminations.getTerminationSheet(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01'
  })
  assert(sheet.monthsStayed === 3, `อยู่ ${sheet.monthsStayed} เดือน`)
  assert(sheet.isDepositRefundable === false, 'ต้องริบ')
  assert(sheet.forfeitReason === 'early_move_out', `ได้ ${sheet.forfeitReason}`)
  assert(sheet.depositRefundCents === 0, `ได้ ${sheet.depositRefundCents}`)
  assert(sheet.forfeitedCents === 500000, `ริบได้ ${sheet.forfeitedCents}`)
})

check('บิลค้างไม่ถูกเอามาลบในยอดสุทธิ แต่ยังรู้ว่าค้างอยู่', () => {
  const sheet = terminations.getTerminationSheet(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01'
  })
  assert(sheet.outstandingTotalCents === 500000, `ค้าง ${sheet.outstandingTotalCents}`)
  assert(sheet.hasOutstanding === true, 'ต้องรู้ว่ายังมีบิลค้าง')
  assert(sheet.netRefundCents === 0, `สุทธิได้ ${sheet.netRefundCents} — บิลไม่ควรเข้าสูตร`)
})

group('ต้องเคลียร์บิลค้างก่อนย้ายออก')

check('มีบิลค้างอยู่ ย้ายออกไม่ได้ และบอกยอดที่ค้าง', () => {
  throws(
    () =>
      terminations.completeTermination(db, forfeit.contract.contractId, {
        moveOutDate: '2026-06-01',
        createdBy: staff.user_id
      }),
    'ต้องเคลียร์ให้ครบก่อนย้ายออก',
    'ต้องบล็อกไว้'
  )
})

check('กดข้ามได้แต่ต้องมีเหตุผล', () => {
  throws(
    () =>
      terminations.completeTermination(db, forfeit.contract.contractId, {
        moveOutDate: '2026-06-01',
        allowOutstanding: true,
        createdBy: staff.user_id
      }),
    'เหตุผล',
    'ต้องบังคับเหตุผลตอนกดข้าม'
  )
})

check('ผู้เช่าหนีไป กดข้ามพร้อมเหตุผลแล้วปิดสัญญาได้ แต่บิลยังค้างเหมือนเดิม', () => {
  const result = terminations.completeTermination(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01',
    allowOutstanding: true,
    outstandingReason: 'ผู้เช่าย้ายออกเองโดยไม่แจ้งและติดต่อไม่ได้',
    createdBy: staff.user_id
  })
  assert(result.refundReceipt === null, 'ยอดติดลบต้องไม่ออกใบเสร็จคืนเงิน')
  assert(result.overrideReason.includes('ติดต่อไม่ได้'), `ได้ ${result.overrideReason}`)

  const invoice = invoices.getInvoiceById(db, forfeitInvoice.invoiceId)
  assert(invoice.status === 'unpaid', `บิลได้ ${invoice.status} ควรยังค้างอยู่`)
  assert(invoice.outstandingCents === 500000, `ยอดค้างได้ ${invoice.outstandingCents}`)
})

group('เคลียร์บิลแล้วค่อยย้ายออก')

const settle = makeContract({ startDate: '2026-01-01', termMonths: 6 })
const settleBatch = meter.createBatch(db, apartmentId, '2026-06-01')
const settleInvoice = invoices.createMonthlyInvoice(db, {
  contractId: settle.contract.contractId,
  billingMonth: '2026-06',
  meterBatchId: settleBatch.batchId,
  issueDate: '2026-06-01'
})

check('รับเงินบิลจนครบแล้ว ย้ายออกได้ตามปกติและคืนเงินประกันเต็ม', () => {
  terminations.setMoveOutNotice(db, settle.contract.contractId, '2026-06-15')

  payments.recordInvoicePayment(db, {
    invoiceId: settleInvoice.invoiceId,
    amount: '5000',
    paymentMethod: 'cash',
    paymentDate: '2026-06-20',
    createdBy: staff.user_id
  })

  const result = terminations.completeTermination(db, settle.contract.contractId, {
    moveOutDate: '2026-07-01',
    createdBy: staff.user_id
  })

  assert(result.isDepositRefundable === true, 'ต้องคืน (อยู่ครบ 6 เดือน แจ้ง 16 วัน)')
  assert(result.outstandingTotalCents === 0, `ยอดค้างได้ ${result.outstandingTotalCents}`)
  assert(result.netRefundCents === 500000, `สุทธิได้ ${result.netRefundCents}`)
  assert(result.refundReceipt.amountCents === -500000, `ใบเสร็จได้ ${result.refundReceipt.amountCents}`)

  const invoice = invoices.getInvoiceById(db, settleInvoice.invoiceId)
  assert(invoice.status === 'paid', `บิลได้ ${invoice.status}`)
})

check('รายงานใบเสร็จเห็นทั้งเงินที่รับจากบิลและเงินประกันที่คืนไป', () => {
  const report = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-06-20',
    dateTo: '2026-07-01'
  })
  assert(
    report.receipts.some((r) => r.amountCents === 500000 && r.sourceType === 'invoice'),
    'ต้องมีใบรับเงินค่าบิล'
  )
  assert(
    report.receipts.some((r) => r.amountCents === -500000 && r.sourceType === 'contract'),
    'ต้องมีใบคืนเงินประกัน'
  )
})

group('รายการเก็บเงิน/คืนเงินเพิ่มเติม')

const adjusted = makeContract({ startDate: '2026-01-01', termMonths: 6 })

check('ค่าเสียหายหักจากเงินประกัน · ค่ามิเตอร์เก็บแยก ไม่แตะเงินประกัน', () => {
  terminations.setMoveOutNotice(db, adjusted.contract.contractId, '2026-06-10')
  const sheet = terminations.getTerminationSheet(db, adjusted.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [
      { itemType: 'meter', description: 'ค่าน้ำ-ค่าไฟงวดสุดท้าย', amount: '350' },
      { itemType: 'service', description: 'ค่า keycard หาย', amount: '100' }
    ]
  })
  assert(sheet.damageTotalCents === 10000, `ค่าเสียหายได้ ${sheet.damageTotalCents}`)
  assert(sheet.meterTotalCents === 35000, `ค่ามิเตอร์ได้ ${sheet.meterTotalCents}`)
  assert(sheet.depositRefundCents === 490000, `เงินประกันคืนได้ ${sheet.depositRefundCents}`)
  assert(sheet.tenantOwesCents === 35000, `ผู้เช่าต้องจ่าย ${sheet.tenantOwesCents}`)
  assert(sheet.netRefundCents === 455000, `สุทธิได้ ${sheet.netRefundCents}`)
})

check('ส่วนลด/คืนเงินกรอกเป็นบวก แต่เพิ่มยอดเงินคืน', () => {
  const sheet = terminations.getTerminationSheet(db, adjusted.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [{ itemType: 'discount_refund', description: 'คืนค่าบริการที่จ่ายเกิน', amount: '200' }]
  })
  assert(sheet.items[0].amountCents === -20000, `ได้ ${sheet.items[0].amountCents}`)
  assert(sheet.netRefundCents === 520000, `สุทธิได้ ${sheet.netRefundCents}`)
})

check('ริบเงินประกันแล้ว ค่าเสียหายต้องหักจากเงินที่ริบ ไม่ใช่เรียกเก็บเพิ่ม', () => {
  const forfeited = makeContract({ startDate: '2026-03-01', termMonths: 12 })
  terminations.setMoveOutNotice(db, forfeited.contract.contractId, '2026-05-01')
  const sheet = terminations.getTerminationSheet(db, forfeited.contract.contractId, {
    moveOutDate: '2026-06-01',
    adjustments: [
      { itemType: 'service', description: 'ค่าเปลี่ยนลูกบิดประตู', amount: '450' },
      { itemType: 'service', description: 'ค่าเปลี่ยนยางขอบประตู', amount: '350' }
    ]
  })

  assert(sheet.isDepositRefundable === false, 'ออกก่อนครบ 12 เดือน ต้องริบ')
  assert(sheet.damageTotalCents === 80000, `ค่าเสียหายได้ ${sheet.damageTotalCents}`)
  assert(sheet.depositAfterDamageCents === 420000, `คงเหลือได้ ${sheet.depositAfterDamageCents}`)
  assert(sheet.forfeitedCents === 420000, `ริบได้ ${sheet.forfeitedCents}`)
  assert(sheet.excessDamageCents === 0, `ส่วนเกินได้ ${sheet.excessDamageCents}`)
  assert(sheet.netRefundCents === 0, `สุทธิได้ ${sheet.netRefundCents} — ไม่ควรมีใครจ่ายใคร`)
})

check('ค่าเสียหายเกินเงินประกัน ส่วนเกินคือเงินที่ผู้เช่าต้องจ่ายเพิ่ม', () => {
  const wrecked = makeContract({ startDate: '2026-01-01', termMonths: 6 })
  terminations.setMoveOutNotice(db, wrecked.contract.contractId, '2026-06-10')
  const sheet = terminations.getTerminationSheet(db, wrecked.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [{ itemType: 'service', description: 'ค่าซ่อมห้องทั้งห้อง', amount: '6000' }]
  })
  assert(sheet.depositAfterDamageCents === 0, `คงเหลือได้ ${sheet.depositAfterDamageCents}`)
  assert(sheet.excessDamageCents === 100000, `ส่วนเกินได้ ${sheet.excessDamageCents}`)
  assert(sheet.netRefundCents === -100000, `สุทธิได้ ${sheet.netRefundCents}`)
})

check('ส่ง override มาแล้ว ยอดสรุปต้องเปลี่ยนทันที ไม่ต้องรอกดยืนยัน', () => {
  const early = makeContract({ startDate: '2026-03-01', termMonths: 12 })
  const base = { contractId: early.contract.contractId, moveOutDate: '2026-06-01' }

  const byRule = terminations.getTerminationSheet(db, base.contractId, {
    moveOutDate: base.moveOutDate
  })
  assert(byRule.isDepositRefundable === false, 'ตามกฎต้องริบ')
  assert(byRule.appliedRefundable === false, 'ไม่ได้ส่ง override มา ต้องใช้ผลตามกฎ')
  assert(byRule.netRefundCents === 0, `ตามกฎได้ ${byRule.netRefundCents}`)

  const overridden = terminations.getTerminationSheet(db, base.contractId, {
    moveOutDate: base.moveOutDate,
    overrideRefundable: true
  })
  assert(overridden.isDepositRefundable === false, 'ผลตามกฎต้องไม่เปลี่ยน')
  assert(overridden.appliedRefundable === true, 'ผลที่ใช้จริงต้องเป็นคืน')
  assert(overridden.depositRefundCents === 500000, `คืนได้ ${overridden.depositRefundCents}`)
  assert(overridden.netRefundCents === 500000, `สุทธิได้ ${overridden.netRefundCents}`)
})

check('ใบพรีวิวกับใบที่บันทึกแล้ว ใช้ชื่อฟิลด์ชุดเดียวกัน', () => {
  const same = makeContract({ startDate: '2026-01-01', termMonths: 6 })
  terminations.setMoveOutNotice(db, same.contract.contractId, '2026-06-10')
  const adjustment = [{ itemType: 'service', description: 'ค่าเปลี่ยนลูกบิดประตู', amount: '50' }]

  const sheet = terminations.getTerminationSheet(db, same.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: adjustment
  })
  const saved = terminations.completeTermination(db, same.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: adjustment,
    createdBy: staff.user_id
  })

  for (const field of [
    'depositSnapshotCents',
    'depositBalanceCents',
    'damageTotalCents',
    'depositRefundCents',
    'forfeitedCents',
    'excessDamageCents',
    'netRefundCents'
  ]) {
    assert(sheet[field] !== undefined, `ใบพรีวิวไม่มี ${field}`)
    assert(saved[field] !== undefined, `ใบที่บันทึกแล้วไม่มี ${field}`)
    assert(sheet[field] === saved[field], `${field}: พรีวิว ${sheet[field]} ≠ บันทึก ${saved[field]}`)
  }
  assert(saved.depositBalanceCents === 495000, `คงเหลือได้ ${saved.depositBalanceCents}`)
})

check('ส่วนลด/คืนเงินยังได้คืน แม้เงินประกันถูกริบ', () => {
  const owed = makeContract({ startDate: '2026-03-01', termMonths: 12 })
  const sheet = terminations.getTerminationSheet(db, owed.contract.contractId, {
    moveOutDate: '2026-06-01',
    adjustments: [{ itemType: 'discount_refund', description: 'คืนค่าบริการที่จ่ายเกิน', amount: '200' }]
  })
  assert(sheet.isDepositRefundable === false, 'ต้องริบเงินประกัน')
  assert(sheet.depositRefundCents === 0, 'เงินประกันไม่คืน')
  assert(sheet.netRefundCents === 20000, `สุทธิได้ ${sheet.netRefundCents} — ต้องคืน 200`)
})

check('รายการที่ไม่มีชื่อ / ยอด 0 / ประเภทไม่รู้จัก ต้องเตือน', () => {
  const base = { contractId: adjusted.contract.contractId, moveOutDate: '2026-07-01' }
  throws(
    () =>
      terminations.getTerminationSheet(db, base.contractId, {
        moveOutDate: base.moveOutDate,
        adjustments: [{ itemType: 'meter', description: '  ', amount: '100' }]
      }),
    'ชื่อรายการ',
    'ต้องบังคับชื่อรายการ'
  )
  throws(
    () =>
      terminations.getTerminationSheet(db, base.contractId, {
        moveOutDate: base.moveOutDate,
        adjustments: [{ itemType: 'meter', description: 'ค่าน้ำ', amount: '0' }]
      }),
    'มากกว่า 0',
    'ต้องกันยอด 0'
  )
  throws(
    () =>
      terminations.getTerminationSheet(db, base.contractId, {
        moveOutDate: base.moveOutDate,
        adjustments: [{ itemType: 'อะไรก็ไม่รู้', description: 'x', amount: '1' }]
      }),
    'ประเภทรายการไม่ถูกต้อง',
    'ต้องกันประเภทที่ไม่รู้จัก'
  )
})

group('ยอดสุทธิติดลบ — ผู้เช่าจ่ายเพิ่ม')

const shortfall = makeContract({ startDate: '2026-01-01', termMonths: 6 })

check('เก็บเงินส่วนต่างแล้ว ต้องได้ใบเสร็จยอดบวก', () => {
  terminations.setMoveOutNotice(db, shortfall.contract.contractId, '2026-06-10')
  const result = terminations.completeTermination(db, shortfall.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [
      { itemType: 'service', description: 'ค่าเปลี่ยนประตูทั้งบาน', amount: '5450' },
      { itemType: 'service', description: 'ค่าเปลี่ยนยางขอบประตู', amount: '350' }
    ],
    createdBy: staff.user_id
  })

  assert(result.excessDamageCents === 80000, `ส่วนเกินได้ ${result.excessDamageCents}`)
  assert(result.netRefundCents === -80000, `สุทธิได้ ${result.netRefundCents}`)
  assert(result.shortfallReceipt !== null, 'ต้องออกใบเสร็จรับเงินส่วนต่าง')
  assert(result.shortfallReceipt.amountCents === 80000, `ได้ ${result.shortfallReceipt.amountCents}`)
  assert(result.unpaidBalanceCents === 0, `ยังค้าง ${result.unpaidBalanceCents} ควรเป็น 0`)

  const report = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-01'
  })
  assert(
    report.receipts.some((r) => r.receiptNumber === result.shortfallReceipt.receiptNumber),
    'ใบเสร็จส่วนต่างต้องอยู่ในรายงานใบเสร็จ'
  )
})

check('ยังเก็บเงินไม่ได้ ไม่ออกใบเสร็จ แล้วยอดค้างขึ้นในใบสรุป', () => {
  const unpaid = makeContract({ startDate: '2026-03-01', termMonths: 12 })
  const result = terminations.completeTermination(db, unpaid.contract.contractId, {
    moveOutDate: '2026-06-01',
    adjustments: [{ itemType: 'meter', description: 'ค่าน้ำ-ค่าไฟงวดสุดท้าย', amount: '1200' }],
    collectShortfall: false,
    createdBy: staff.user_id
  })

  assert(result.isDepositRefundable === false, 'ออกก่อนครบต้องริบ')
  assert(result.meterTotalCents === 120000, `ค่ามิเตอร์ได้ ${result.meterTotalCents}`)
  assert(result.netRefundCents === -120000, `สุทธิได้ ${result.netRefundCents}`)
  assert(result.shortfallReceipt === null, 'ต้องไม่ออกใบเสร็จ')
  assert(result.unpaidBalanceCents === 120000, `ยังค้าง ${result.unpaidBalanceCents}`)
})

check('ใบสรุปมีข้อมูลครบสำหรับพิมพ์: หอ ผู้เช่า รายการหัก ใบเสร็จ', () => {
  const t = terminations.getTerminationByContract(db, shortfall.contract.contractId)
  assert(t.apartment.name === 'หอทดสอบย้ายออก', `ได้ ${t.apartment.name}`)
  assert(Boolean(t.tenantName), 'ต้องมีชื่อผู้เช่า')
  assert(t.termMonths === 6, `ระยะสัญญาได้ ${t.termMonths}`)
  assert(t.requiredNoticeDays === 15, `กำหนดแจ้งล่วงหน้าได้ ${t.requiredNoticeDays}`)
  assert(t.items.length === 2, `รายการหักได้ ${t.items.length}`)
  assert(t.receipts.length === 1, `ใบเสร็จได้ ${t.receipts.length}`)
  assert(t.receipts[0].label === 'รับเงินส่วนต่างตอนย้ายออก', `ได้ ${t.receipts[0].label}`)
})

group('รายการเก็บเงิน/คืนเงินเพิ่มเติม (ต่อ)')

check('รายการถูกเก็บลงฐานข้อมูลแยกบรรทัด ไม่ใช่ยอดรวมก้อนเดียว', () => {
  const result = terminations.completeTermination(db, adjusted.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [
      { itemType: 'meter', description: 'ค่าน้ำ-ค่าไฟงวดสุดท้าย', amount: '350' },
      { itemType: 'discount_refund', description: 'คืนค่าบริการที่จ่ายเกิน', amount: '200' }
    ],
    createdBy: staff.user_id
  })
  assert(result.items.length === 2, `ได้ ${result.items.length} รายการ`)
  assert(result.items[0].description === 'ค่าน้ำ-ค่าไฟงวดสุดท้าย', result.items[0].description)
  assert(result.items[1].amountCents === -20000, `ได้ ${result.items[1].amountCents}`)
  assert(result.netRefundCents === 485000, `สุทธิได้ ${result.netRefundCents}`)
})

group('เจ้าของกดข้ามผลการตัดสิน')

const override = makeContract({ startDate: '2026-03-01', termMonths: 12 })

check('ตัดสินต่างจากกฎโดยไม่บอกเหตุผลไม่ได้', () => {
  throws(
    () =>
      terminations.completeTermination(db, override.contract.contractId, {
        moveOutDate: '2026-06-01',
        overrideRefundable: true,
        createdBy: staff.user_id
      }),
    'เหตุผล',
    'ต้องบังคับเหตุผลตอนกดข้ามกฎ'
  )
})

check('กดข้ามพร้อมเหตุผลแล้วคืนเงินได้ และบันทึกไว้ว่ากดข้าม', () => {
  const result = terminations.completeTermination(db, override.contract.contractId, {
    moveOutDate: '2026-06-01',
    overrideRefundable: true,
    overrideReason: 'ผู้เช่าย้ายออกเพราะหอซ่อมท่อน้ำ ไม่ใช่ความผิดผู้เช่า',
    createdBy: staff.user_id
  })
  assert(result.isDepositRefundable === true, 'ต้องคืนตามที่เจ้าของสั่ง')
  assert(result.isManualOverride === true, 'ต้องบันทึกว่ากดข้าม')
  assert(result.overrideReason.includes('ซ่อมท่อน้ำ'), result.overrideReason)
  assert(result.netRefundCents === 500000, `ได้ ${result.netRefundCents}`)
})

check('ไม่รู้ว่าใครทำรายการก็ย้ายออกไม่ได้', () => {
  const other = makeContract()
  throws(
    () => terminations.completeTermination(db, other.contract.contractId, { moveOutDate: '2026-07-01' }),
    'ผู้ทำรายการ',
    'ต้องรู้ว่าใครเป็นคนทำ'
  )
})

check('สัญญาที่ปิดไปแล้วย้ายออกซ้ำไม่ได้', () => {
  throws(
    () =>
      terminations.completeTermination(db, clean.contract.contractId, {
        moveOutDate: '2026-08-01',
        createdBy: staff.user_id
      }),
    'ยกเลิกไปแล้ว',
    'ต้องกันการย้ายออกซ้ำ'
  )
})

group('ตามเก็บเงินส่วนต่างทีหลัง')

function makeUncollected({ startDate = '2026-03-01', moveOutDate = '2026-06-01', meter = '1200' } = {}) {
  const made = makeContract({ startDate, termMonths: 12 })
  const result = terminations.completeTermination(db, made.contract.contractId, {
    moveOutDate,
    adjustments: [{ itemType: 'meter', description: 'ค่าน้ำ-ค่าไฟงวดสุดท้าย', amount: meter }],
    collectShortfall: false,
    createdBy: staff.user_id
  })
  return { ...made, result }
}

check('เก็บเงินส่วนต่างทีหลังได้ ยอดค้างเป็นศูนย์ แม้ใบเสร็จลงวันคนละวันกับวันย้ายออก', () => {
  const { contract } = makeUncollected()
  const after = terminations.collectTerminationShortfall(db, contract.contractId, {
    amount: '1200',
    paymentMethod: 'transfer',
    paymentDate: '2026-06-20',
    createdBy: staff.user_id
  })

  assert(after.receipt.amountCents === 120000, `ใบเสร็จได้ ${after.receipt.amountCents}`)
  assert(after.receipt.paymentDate === '2026-06-20', `ลงวันที่ ${after.receipt.paymentDate}`)
  assert(after.unpaidBalanceCents === 0, `ยังค้าง ${after.unpaidBalanceCents}`)
  assert(after.receipts.length === 1, `ใบเสร็จในใบสรุปได้ ${after.receipts.length}`)
  assert(
    after.receipts[0].label === 'รับเงินส่วนต่างตอนย้ายออก',
    `ป้ายได้ ${after.receipts[0].label}`
  )

  const reread = terminations.getTerminationByContract(db, contract.contractId)
  assert(reread.unpaidBalanceCents === 0, `อ่านใหม่ยังค้าง ${reread.unpaidBalanceCents}`)
})

check('ทยอยจ่ายบางส่วนได้ ยอดค้างลดลงตามจริง', () => {
  const { contract } = makeUncollected()
  const first = terminations.collectTerminationShortfall(db, contract.contractId, {
    amount: '500',
    paymentDate: '2026-06-10',
    createdBy: staff.user_id
  })
  assert(first.unpaidBalanceCents === 70000, `ค้างเหลือ ${first.unpaidBalanceCents}`)

  const second = terminations.collectTerminationShortfall(db, contract.contractId, {
    amount: '700',
    paymentDate: '2026-06-25',
    createdBy: staff.user_id
  })
  assert(second.unpaidBalanceCents === 0, `ค้างเหลือ ${second.unpaidBalanceCents}`)
  assert(second.receipts.length === 2, `ใบเสร็จรวมได้ ${second.receipts.length}`)
})

check('เก็บเกินยอดที่ค้างอยู่ไม่ได้', () => {
  const { contract } = makeUncollected()
  throws(
    () =>
      terminations.collectTerminationShortfall(db, contract.contractId, {
        amount: '1200.01',
        paymentDate: '2026-06-05',
        createdBy: staff.user_id
      }),
    'เกินยอดที่ค้าง',
    'ต้องปฏิเสธยอดที่เกิน'
  )
})

check('เก็บครบแล้วเก็บซ้ำอีกไม่ได้', () => {
  const { contract } = makeUncollected()
  terminations.collectTerminationShortfall(db, contract.contractId, {
    amount: '1200',
    paymentDate: '2026-06-05',
    createdBy: staff.user_id
  })
  throws(
    () =>
      terminations.collectTerminationShortfall(db, contract.contractId, {
        amount: '100',
        paymentDate: '2026-06-06',
        createdBy: staff.user_id
      }),
    'ไม่มียอดค้าง',
    'ต้องปฏิเสธการเก็บซ้ำ'
  )
})

check('รับเงินก่อนวันที่ย้ายออกไม่ได้', () => {
  const { contract } = makeUncollected()
  throws(
    () =>
      terminations.collectTerminationShortfall(db, contract.contractId, {
        amount: '100',
        paymentDate: '2026-05-31',
        createdBy: staff.user_id
      }),
    'ไม่ก่อนวันที่ย้ายออก',
    'ต้องปฏิเสธวันที่ย้อนหลังเกินไป'
  )
})

check('สัญญาที่ยังไม่ได้ย้ายออก เก็บเงินส่วนต่างไม่ได้', () => {
  const live = makeContract()
  throws(
    () =>
      terminations.collectTerminationShortfall(db, live.contract.contractId, {
        amount: '100',
        createdBy: staff.user_id
      }),
    'ไม่พบบันทึกการย้ายออก',
    'ต้องปฏิเสธสัญญาที่ยังอยู่'
  )
})

check('ไม่รู้ว่าใครรับเงิน ออกใบเสร็จไม่ได้', () => {
  const { contract } = makeUncollected()
  throws(
    () => terminations.collectTerminationShortfall(db, contract.contractId, { amount: '100' }),
    'ผู้รับเงิน',
    'ต้องรู้ผู้รับเงินก่อน'
  )
})

check('ยกเลิกใบเสร็จส่วนต่างแล้ว ยอดค้างกลับมาเท่าเดิม', () => {
  const { contract } = makeUncollected()
  const after = terminations.collectTerminationShortfall(db, contract.contractId, {
    amount: '1200',
    paymentDate: '2026-06-15',
    createdBy: staff.user_id
  })
  assert(after.unpaidBalanceCents === 0, 'เก็บครบแล้วต้องเป็นศูนย์ก่อน')

  payments.cancelPayment(db, after.receipt.paymentId, {
    reason: 'คีย์ยอดผิด',
    cancelledBy: staff.user_id
  })

  const reread = terminations.getTerminationByContract(db, contract.contractId)
  assert(reread.unpaidBalanceCents === 120000, `ยอดค้างกลับมาได้ ${reread.unpaidBalanceCents}`)
  assert(reread.receipts.length === 0, `ใบที่ยกเลิกต้องไม่อยู่ในใบสรุป (ได้ ${reread.receipts.length})`)
})

group('ประวัติการย้ายออก')

check('รายการที่ย้ายออกแล้วขึ้นในประวัติ เรียงจากใหม่ไปเก่า', () => {
  const report = terminations.listTerminations(db, apartmentId)
  assert(report.count > 0, 'ต้องมีรายการ')
  assert(report.count === report.terminations.length, 'จำนวนต้องตรงกับรายการที่คืนมา')

  for (let i = 1; i < report.terminations.length; i += 1) {
    assert(
      report.terminations[i - 1].moveOutDate >= report.terminations[i].moveOutDate,
      `เรียงผิดที่ลำดับ ${i}`
    )
  }
})

check('ยอด "ยังเก็บไม่ได้" ในตารางตรงกับในใบสรุปทุกแถว', () => {
  const report = terminations.listTerminations(db, apartmentId)
  for (const row of report.terminations) {
    const sheet = terminations.getTerminationByContract(db, row.contractId)
    assert(
      row.unpaidBalanceCents === sheet.unpaidBalanceCents,
      `ห้อง ${row.roomNumber}: ตาราง ${row.unpaidBalanceCents} · ใบสรุป ${sheet.unpaidBalanceCents}`
    )
    assert(
      row.netRefundCents === sheet.netRefundCents,
      `ห้อง ${row.roomNumber}: สุทธิไม่ตรงกัน`
    )
  }

  const unpaidRows = report.terminations.filter((t) => t.unpaidBalanceCents > 0)
  assert(report.unpaidCount === unpaidRows.length, `นับรายที่ค้างได้ ${report.unpaidCount}`)
  assert(
    report.unpaidTotalCents === unpaidRows.reduce((sum, t) => sum + t.unpaidBalanceCents, 0),
    `ยอดค้างรวมได้ ${report.unpaidTotalCents}`
  )
})

check('ค้นด้วยเลขห้องและชื่อผู้เช่าได้', () => {
  const target = terminations.listTerminations(db, apartmentId).terminations[0]

  const byRoom = terminations.listTerminations(db, apartmentId, { search: target.roomNumber })
  assert(
    byRoom.terminations.some((t) => t.contractId === target.contractId),
    `ค้นห้อง ${target.roomNumber} ไม่เจอ`
  )

  const byName = terminations.listTerminations(db, apartmentId, { search: target.tenantName })
  assert(
    byName.terminations.some((t) => t.contractId === target.contractId),
    `ค้นชื่อ ${target.tenantName} ไม่เจอ`
  )

  const none = terminations.listTerminations(db, apartmentId, { search: 'ไม่มีคนชื่อนี้แน่นอน' })
  assert(none.count === 0, `ค้นคำที่ไม่มีต้องได้ 0 (ได้ ${none.count})`)
})

check('กรองด้วยช่วงวันที่ย้ายออก วันขอบนับรวม', () => {
  const all = terminations.listTerminations(db, apartmentId).terminations
  const pivot = all[all.length - 1].moveOutDate

  const onlyPivot = terminations.listTerminations(db, apartmentId, {
    dateFrom: pivot,
    dateTo: pivot
  })
  assert(onlyPivot.count > 0, 'วันขอบต้องนับรวม ไม่ใช่ตัดทิ้ง')
  assert(
    onlyPivot.terminations.every((t) => t.moveOutDate === pivot),
    'ต้องได้เฉพาะวันที่ที่กรอง'
  )

  const fromOnly = terminations.listTerminations(db, apartmentId, { dateFrom: pivot })
  assert(
    fromOnly.terminations.every((t) => t.moveOutDate >= pivot),
    'กรองข้างเดียวแล้วยังมีของเก่ากว่าหลุดมา'
  )
})

check('ประวัติของหออื่นไม่ปนเข้ามา', () => {
  const other = apartments.insertApartment(db, {
    nameTh: 'หอที่สอง',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  const floors = rooms.addFloor(db, other.apartmentId, { roomCount: 1 })
  const room = floors[floors.length - 1].rooms[0]
  rooms.setRoomRates(db, [room.roomId], { monthlyRent: '4000' })
  const person = tenants.insertTenant(db, {
    firstName: 'ผู้เช่าหอสอง',
    lastName: 'ทดสอบ',
    phone: '0899999999'
  })
  const contract = contracts.createContract(db, {
    roomId: room.roomId,
    rentType: 'monthly',
    startDate: '2026-01-01',
    rentAmount: '4000',
    deposit: '4000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    termMonths: 12,
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [person.tenantId],
    createdBy: staff.user_id
  })
  terminations.completeTermination(db, contract.contractId, {
    moveOutDate: '2027-01-01',
    createdBy: staff.user_id
  })

  const mine = terminations.listTerminations(db, apartmentId)
  assert(
    !mine.terminations.some((t) => t.contractId === contract.contractId),
    'การย้ายออกของหออื่นต้องไม่โผล่ในประวัติของหอนี้'
  )

  const theirs = terminations.listTerminations(db, other.apartmentId)
  assert(theirs.count === 1, `หอที่สองต้องมี 1 รายการ (ได้ ${theirs.count})`)
  assert(theirs.terminations[0].contractId === contract.contractId, 'ต้องเป็นรายการของหอที่สอง')
})

check('ไม่ระบุหอ ไล่รายการไม่ได้', () => {
  throws(() => terminations.listTerminations(db, null), 'ไม่พบหอพัก', 'ต้องบังคับให้ระบุหอ')
})

group('ใบที่ตัดสินไว้ด้วยสูตรคนละรุ่น')

check('ยอดที่บันทึกไม่ตรงกับสูตรปัจจุบัน ต้องติดธงและบอกยอดทั้งสองชุด', () => {
  const made = makeContract({ startDate: '2026-02-01', termMonths: 12 })
  terminations.completeTermination(db, made.contract.contractId, {
    moveOutDate: '2026-05-01',
    adjustments: [
      { itemType: 'service', description: 'ค่าทาสี', amount: '500' },
      { itemType: 'meter', description: 'ค่าน้ำ-ไฟ', amount: '380' }
    ],
    collectShortfall: false,
    createdBy: staff.user_id
  })

  const fresh = terminations.getTerminationByContract(db, made.contract.contractId)
  assert(fresh.netRefundCents === -38000, `สูตรปัจจุบันต้องได้ -38000 (ได้ ${fresh.netRefundCents})`)
  assert(fresh.hasNetRefundMismatch === false, 'ใบที่เพิ่งทำต้องไม่ติดธง')

  db.prepare('UPDATE contract_terminations SET net_refund_amount_cents = ? WHERE contract_id = ?')
    .run(-88000, made.contract.contractId)

  const stale = terminations.getTerminationByContract(db, made.contract.contractId)
  assert(stale.hasNetRefundMismatch === true, 'ต้องติดธง')
  assert(stale.netRefundCents === -88000, `ยอดที่บันทึกต้องชนะ (ได้ ${stale.netRefundCents})`)
  assert(
    stale.recomputedNetRefundCents === -38000,
    `ยอดตามสูตรปัจจุบันได้ ${stale.recomputedNetRefundCents}`
  )
  assert(stale.tenantOwesCents === 38000, `รายการแจกแจงยังคิดตามสูตรปัจจุบัน (${stale.tenantOwesCents})`)
  assert(stale.unpaidBalanceCents === 88000, `ยอดค้างได้ ${stale.unpaidBalanceCents}`)
})

check('ธงขึ้นถึงตารางประวัติด้วย ไม่ใช่เห็นเฉพาะตอนเปิดใบ', () => {
  const report = terminations.listTerminations(db, apartmentId)
  const flagged = report.terminations.filter((t) => t.hasNetRefundMismatch)
  assert(report.mismatchCount === flagged.length, `นับได้ ${report.mismatchCount}`)
  assert(report.mismatchCount === 1, `ต้องมีใบเดียวที่ไม่ตรง (ได้ ${report.mismatchCount})`)
  assert(
    flagged[0].recomputedNetRefundCents === -38000,
    `ตารางต้องบอกยอดตามสูตรปัจจุบันด้วย (ได้ ${flagged[0].recomputedNetRefundCents})`
  )

  for (const t of report.terminations) {
    if (t.contractId === flagged[0].contractId) continue
    assert(t.hasNetRefundMismatch === false, `ห้อง ${t.roomNumber} ไม่ควรติดธง`)
  }
})

cleanup()
summarize('การย้ายออกและคืนเงินประกันทำงานครบทุกเส้นทาง')
