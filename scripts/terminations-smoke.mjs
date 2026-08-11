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

// เงินประกัน 5,000 เก็บครบวันทำสัญญา แจ้งล่วงหน้า 15 วัน (ค่าตั้งต้นของ 004)
// ระยะสัญญาจริงของหอคือ 12 เดือน — เทสต์บางข้อใช้ 6 เพื่อให้เดินถึงจุด "อยู่ครบ" ได้เร็ว
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

// -----------------------------------------------------
group('นับเดือนที่อยู่')

check('ยังไม่ถึงวันเดียวกันของเดือนนั้น ถือว่ายังไม่ครบเดือน', () => {
  assert(terminations.monthsBetween('2026-01-15', '2026-07-14') === 5, 'วันที่ 14 ต้องได้ 5')
  assert(terminations.monthsBetween('2026-01-15', '2026-07-15') === 6, 'วันที่ 15 ต้องได้ 6')
  assert(terminations.monthsBetween('2026-01-15', '2026-07-16') === 6, 'วันที่ 16 ยังเป็น 6')
})

check('ข้ามปีนับต่อเนื่อง', () => {
  assert(terminations.monthsBetween('2025-11-01', '2026-05-01') === 6, 'ต้องได้ 6')
})

// -----------------------------------------------------
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

// แจ้งพอดี 15 วันต้องผ่าน ไม่ใช่พลาดไปหนึ่งวัน — ขอบเขตแบบนี้คือที่ที่ off-by-one อยู่
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

// -----------------------------------------------------
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

// -----------------------------------------------------
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

// **นี่คือสิ่งที่ปลดล็อกการทดสอบหมุนเวียนผู้เช่า** — ก่อนหน้านี้ห้องติดกับผู้เช่าคนเดิมถาวร
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

// -----------------------------------------------------
group('ต่อสัญญาแล้วนับเดือนต่อเนื่อง')

// สัญญา 6 เดือนสองใบต่อกัน — ถ้านับแค่ใบสุดท้ายจะไม่มีใครผ่านเกณฑ์ 12 เดือนเลยตลอดกาล
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

  // ปิดสัญญาใบแรกเพื่อไม่ให้มีสอง active ในห้องเดียว
  db.prepare("UPDATE contracts SET status = 'terminated' WHERE contract_id = ?")
    .run(first.contract.contractId)

  const chainStart = terminations.findChainStartDate(db, renewed.lastInsertRowid)
  assert(chainStart === '2026-01-01', `ได้ ${chainStart} ควรเป็นวันเริ่มของใบแรก`)

  terminations.setMoveOutNotice(db, renewed.lastInsertRowid, '2026-12-01')
  const sheet = terminations.getTerminationSheet(db, renewed.lastInsertRowid, {
    moveOutDate: '2027-01-01'
  })
  // ใบปัจจุบันเริ่ม ก.ค. อยู่มา 6 เดือน แต่ทั้งสายคือ 12 เดือน
  assert(sheet.monthsStayed === 12, `ได้ ${sheet.monthsStayed} เดือน ควรเป็น 12`)
  assert(sheet.isRenewal === true, 'ต้องรู้ว่าเป็นการต่อสัญญา')
  assert(sheet.isDepositRefundable === true, 'ครบ 12 เดือนแล้วต้องคืน')
})

// -----------------------------------------------------
group('ริบเงินประกัน — หนี้ยังเป็นหนี้')

// 🔴 กติกาที่ผู้ใช้ตัดสินใจ 2026-08-11: เงินประกันที่ถูกริบ เอาไปหักหนี้ไม่ได้
const forfeit = makeContract({ startDate: '2026-03-01', termMonths: 12 })
const forfeitBatch = meter.createBatch(db, apartmentId, '2026-05-01')
const forfeitInvoice = invoices.createMonthlyInvoice(db, {
  contractId: forfeit.contract.contractId,
  billingMonth: '2026-05',
  meterBatchId: forfeitBatch.batchId,
  issueDate: '2026-05-01'
})

// เจ้าของหอยืนยัน 2026-08-11: หอทำสัญญา 12 เดือน — ตัวเลขนี้คือเกณฑ์จริงที่ใช้ตัดสิน
check('ออกก่อนครบสัญญา 12 เดือน = ริบ และเงินคืนเป็น 0', () => {
  terminations.setMoveOutNotice(db, forfeit.contract.contractId, '2026-05-01')
  const sheet = terminations.getTerminationSheet(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01'
  })
  assert(sheet.monthsStayed === 3, `อยู่ ${sheet.monthsStayed} เดือน`)
  assert(sheet.isDepositRefundable === false, 'ต้องริบ')
  assert(sheet.forfeitReason === 'early_move_out', `ได้ ${sheet.forfeitReason}`)
  assert(sheet.depositRefundCents === 0, `ได้ ${sheet.depositRefundCents}`)
  // ไม่มีค่าเสียหาย เงินประกันทั้งก้อนจึงถูกริบ
  assert(sheet.forfeitedCents === 500000, `ริบได้ ${sheet.forfeitedCents}`)
})

// **บิลค้างไม่เข้าสูตรยอดสุทธิ** — เงินประกันไม่ใช่ของสำหรับจ่ายบิล (กติกาเดียวกับที่ทำให้
// เงินประกันที่ริบเอาไปหักหนี้ไม่ได้) บิลเป็นหนี้แยกที่ต้องเคลียร์ก่อนอยู่แล้ว
check('บิลค้างไม่ถูกเอามาลบในยอดสุทธิ แต่ยังรู้ว่าค้างอยู่', () => {
  const sheet = terminations.getTerminationSheet(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01'
  })
  assert(sheet.outstandingTotalCents === 500000, `ค้าง ${sheet.outstandingTotalCents}`)
  assert(sheet.hasOutstanding === true, 'ต้องรู้ว่ายังมีบิลค้าง')
  assert(sheet.netRefundCents === 0, `สุทธิได้ ${sheet.netRefundCents} — บิลไม่ควรเข้าสูตร`)
})

// -----------------------------------------------------
// 🔴 กติกาที่เจ้าของหอยืนยัน 2026-08-11: ต้องเคลียร์บิลค้างให้หมดก่อนย้ายออก
// ระบบไม่หักจากเงินประกันให้เอง — ถ้าจะหักจริงต้องไปกดรับเงินที่บิลใบนั้นก่อน
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

// ผู้เช่าหนีไปแล้ว — ถ้าบล็อกตายตัว ห้องนั้นจะปล่อยใหม่ไม่ได้ตลอดไปเพราะหนี้ที่ไม่มีวันได้คืน
check('ผู้เช่าหนีไป กดข้ามพร้อมเหตุผลแล้วปิดสัญญาได้ แต่บิลยังค้างเหมือนเดิม', () => {
  const result = terminations.completeTermination(db, forfeit.contract.contractId, {
    moveOutDate: '2026-06-01',
    allowOutstanding: true,
    outstandingReason: 'ผู้เช่าย้ายออกเองโดยไม่แจ้งและติดต่อไม่ได้',
    createdBy: staff.user_id
  })
  assert(result.refundReceipt === null, 'ยอดติดลบต้องไม่ออกใบเสร็จคืนเงิน')
  assert(result.overrideReason.includes('ติดต่อไม่ได้'), `ได้ ${result.overrideReason}`)

  // **หนี้ต้องไม่หายไปเงียบๆ ในขั้นตอนย้ายออก** — ยังต้องตามเก็บต่อได้
  const invoice = invoices.getInvoiceById(db, forfeitInvoice.invoiceId)
  assert(invoice.status === 'unpaid', `บิลได้ ${invoice.status} ควรยังค้างอยู่`)
  assert(invoice.outstandingCents === 500000, `ยอดค้างได้ ${invoice.outstandingCents}`)
})

// -----------------------------------------------------
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

  // เส้นทางปกติของหอ: ไปกดรับเงินที่บิลใบนั้นก่อน แล้วค่อยกลับมาย้ายออก
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

// เงินที่รับจากบิลเป็นเงินสดจริงที่เข้าหอ ส่วนใบคืนเงินประกันเป็นเงินออก — ทั้งคู่อยู่ในรายงาน
// ตามความจริง ไม่มีตัวเลขไหนถูกนับซ้ำหรือถูกซ่อน
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

// -----------------------------------------------------
group('รายการเก็บเงิน/คืนเงินเพิ่มเติม')

const adjusted = makeContract({ startDate: '2026-01-01', termMonths: 6 })

// สามแท็บมีความหมายทางบัญชีคนละอย่าง ไม่ใช่แค่ป้ายจัดกลุ่ม (เจ้าของหอยืนยัน 2026-08-11)
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
  // เงินประกัน 5,000 − ค่าเสียหาย 100 = คืน 4,900 · ค่ามิเตอร์ 350 เก็บแยก
  assert(sheet.depositRefundCents === 490000, `เงินประกันคืนได้ ${sheet.depositRefundCents}`)
  assert(sheet.tenantOwesCents === 35000, `ผู้เช่าต้องจ่าย ${sheet.tenantOwesCents}`)
  assert(sheet.netRefundCents === 455000, `สุทธิได้ ${sheet.netRefundCents}`)
})

// ผู้ใช้กรอกเป็นบวกเสมอ ระบบกลับเครื่องหมายให้ — กติกาเดียวกับส่วนลดบนใบแจ้งหนี้
check('ส่วนลด/คืนเงินกรอกเป็นบวก แต่เพิ่มยอดเงินคืน', () => {
  const sheet = terminations.getTerminationSheet(db, adjusted.contract.contractId, {
    moveOutDate: '2026-07-01',
    adjustments: [{ itemType: 'discount_refund', description: 'คืนค่าบริการที่จ่ายเกิน', amount: '200' }]
  })
  assert(sheet.items[0].amountCents === -20000, `ได้ ${sheet.items[0].amountCents}`)
  assert(sheet.netRefundCents === 520000, `สุทธิได้ ${sheet.netRefundCents}`)
})

// 🔴 หัวใจของรอบนี้ (ผู้ใช้ทักท้วง 2026-08-11): เงินประกันมีไว้รองรับความเสียหาย
// ถ้าริบไปแล้วยังเรียกเก็บค่าซ่อมอีก ผู้เช่าจ่ายสองต่อจากเงินก้อนเดียวกัน
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
  // 5,000 − 800 = 4,200 คือส่วนที่ถูกริบ · ผู้เช่าไม่ต้องจ่ายเพิ่มอีกบาทเดียว
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

// เงินคนละก้อนกับเงินประกัน จึงไม่ถูกริบไปด้วย (จรรยาบรรณ — ผู้ใช้ยืนยัน)
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

// 🔴 ผู้ใช้เจอตอนทดสอบจริง 2026-08-11: เก็บเงินเพิ่มค่าลูกบิด/ยางขอบประตูตอนตรวจห้อง
// แล้วยอดสุทธิติดลบ ระบบขึ้นแค่ "ผู้เช่ายังค้างจ่าย" โดยไม่มีทางบันทึกว่าเก็บเงินมาแล้ว
// และผู้เช่าไม่ได้ใบเสร็จว่าจ่ายอะไรไป
group('ยอดสุทธิติดลบ — ผู้เช่าจ่ายเพิ่ม')

const shortfall = makeContract({ startDate: '2026-01-01', termMonths: 6 })

check('เก็บเงินส่วนต่างแล้ว ต้องได้ใบเสร็จยอดบวก', () => {
  terminations.setMoveOutNotice(db, shortfall.contract.contractId, '2026-06-10')
  const result = terminations.completeTermination(db, shortfall.contract.contractId, {
    moveOutDate: '2026-07-01',
    // ค่าซ่อม 5,800 เกินเงินประกัน 5,000 → ส่วนเกิน 800 คือเงินที่ผู้เช่าต้องควักเพิ่ม
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

  // ใบเสร็จต้องโผล่ในรายงานด้วย ไม่ใช่มีแต่ในบันทึกการย้ายออก
  const report = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-01'
  })
  assert(
    report.receipts.some((r) => r.receiptNumber === result.shortfallReceipt.receiptNumber),
    'ใบเสร็จส่วนต่างต้องอยู่ในรายงานใบเสร็จ'
  )
})

// ผู้เช่าที่ริบเงินประกันแล้วยังมีค่ามิเตอร์งวดสุดท้ายค้าง — ค่ามิเตอร์เก็บแยก
// ไม่ถูกหักจากเงินที่ริบ จึงยังเป็นเงินที่ต้องเก็บจากผู้เช่า
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

// ใบสรุปที่พิมพ์ให้ผู้เช่าต้องแจกแจงได้ว่าหักอะไรไปบ้าง และเป็นของใคร
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

// -----------------------------------------------------
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

// -----------------------------------------------------
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

// -----------------------------------------------------
cleanup()
summarize('การย้ายออกและคืนเงินประกันทำงานครบทุกเส้นทาง')
