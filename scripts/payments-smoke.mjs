// ทดสอบโมดูลรับชำระเงินบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:payments
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

const { db, cleanup } = await openTempDatabase('dormy-payments')

const staff = users.insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  email: 'manager@example.com',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบรับเงิน',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId

utility.saveUtilityDefaults(db, apartmentId, {
  water: { enabled: false },
  electric: { enabled: false }
})
rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 2 }])
const [room1, room2] = rooms.listFloors(db, apartmentId)[0].rooms
rooms.setRoomRates(db, [room1.roomId, room2.roomId], { monthlyRent: '5000' })

const tenant = tenants.insertTenant(db, {
  firstName: 'สมชาย',
  lastName: 'ทดสอบ',
  phone: '0812345678'
})
const tenant2 = tenants.insertTenant(db, {
  firstName: 'สมหญิง',
  lastName: 'ทดสอบ',
  phone: '0891234567'
})

const contract1 = contracts.createContract(db, {
  roomId: room1.roomId,
  rentType: 'monthly',
  startDate: '2026-08-01',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [tenant.tenantId]
})
const contract2 = contracts.createContract(db, {
  roomId: room2.roomId,
  rentType: 'monthly',
  startDate: '2026-08-01',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [tenant2.tenantId]
})

const batch = meter.createBatch(db, apartmentId, '2026-08-31')
const invoice = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: '2026-08',
  meterBatchId: batch.batchId,
  issueDate: '2026-08-31'
})

const BASE = {
  paymentMethod: 'cash',
  paymentDate: '2026-09-01',
  // getUserById คืนแถวดิบ ไม่ได้แปลงชื่อคอลัมน์
  createdBy: staff.user_id
}

// -----------------------------------------------------
group('ตรวจข้อมูล')

check('ช่องทางการชำระเงินต้องเป็นค่าที่รู้จัก', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '100',
        paymentMethod: 'bitcoin'
      }),
    'ช่องทางการชำระเงิน',
    'ต้องกันช่องทางที่ไม่รู้จัก'
  )
})

check('ไม่ระบุวันที่รับเงินไม่ผ่าน', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '100',
        paymentDate: ''
      }),
    'วันที่รับเงิน',
    'ต้องบังคับวันที่'
  )
})

check('ไม่รู้ว่าใครรับเงินไม่ผ่าน', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '100',
        createdBy: null
      }),
    'ผู้รับเงิน',
    'ต้องรู้ว่าใครเป็นคนรับ'
  )
})

check('รับเงินเกินยอดค้างไม่ได้ และต้องบอกยอดค้างที่แท้จริง', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '9999'
      }),
    'ไม่เกินยอดค้างชำระ 5,000.00',
    'ต้องบอกยอดค้างที่แท้จริง'
  )
})

// -----------------------------------------------------
group('รับชำระบางส่วน')

const firstPayment = payments.recordInvoicePayment(db, {
  ...BASE,
  invoiceId: invoice.invoiceId,
  amount: '2000',
  remark: 'จ่ายสด'
})

check('ได้เลขใบเสร็จรูปแบบ R + YYYYMM + ลำดับ 4 หลัก', () => {
  assert(firstPayment.receiptNumber === 'R2026090001', `ได้ ${firstPayment.receiptNumber}`)
})

check('ใบเสร็จจำห้อง ช่องทาง และผู้รับเงินไว้', () => {
  assert(firstPayment.roomNumber === '101', `ได้ ${firstPayment.roomNumber}`)
  assert(firstPayment.paymentMethodLabel === 'เงินสด', `ได้ ${firstPayment.paymentMethodLabel}`)
  assert(firstPayment.createdByName === 'ผู้จัดการหอ', `ได้ ${firstPayment.createdByName}`)
  assert(firstPayment.remark === 'จ่ายสด', `ได้ ${firstPayment.remark}`)
})

check('บิลเปลี่ยนเป็นชำระบางส่วน และยอดค้างลดลง', () => {
  const after = invoices.getInvoiceById(db, invoice.invoiceId)
  assert(after.status === 'partial_paid', `ได้ ${after.status}`)
  assert(after.paidAmountCents === 200000, `ได้ ${after.paidAmountCents}`)
  assert(after.outstandingCents === 300000, `ได้ ${after.outstandingCents}`)
})

check('ประเภทใบเสร็จอ้างถึงใบแจ้งหนี้', () => {
  assert(firstPayment.sourceType === 'invoice', `ได้ ${firstPayment.sourceType}`)
  assert(
    firstPayment.sourceLabel === `ใบแจ้งหนี้ #${invoice.invoiceNumber}`,
    `ได้ ${firstPayment.sourceLabel}`
  )
})

check('รับเงินส่วนที่เหลือเกินยอดค้างที่เหลือไม่ได้', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '3000.01'
      }),
    '3,000.00',
    'ยอดค้างเหลือ 3,000.00'
  )
})

// -----------------------------------------------------
group('รับชำระจนครบ')

check('จ่ายส่วนที่เหลือแล้วบิลเป็นชำระแล้ว ยอดค้างเป็นศูนย์', () => {
  payments.recordInvoicePayment(db, {
    ...BASE,
    invoiceId: invoice.invoiceId,
    amount: '3000',
    paymentDate: '2026-09-03'
  })
  const after = invoices.getInvoiceById(db, invoice.invoiceId)
  assert(after.status === 'paid', `ได้ ${after.status}`)
  assert(after.outstandingCents === 0, `ได้ ${after.outstandingCents}`)
})

check('รับเงินซ้ำอีกบาทเดียวไม่ได้แล้ว', () => {
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '1'
      }),
    'ไม่เกินยอดค้างชำระ 0.00',
    'จ่ายครบแล้วต้องรับเพิ่มไม่ได้'
  )
})

check('รายการรับเงินใต้บิลเรียงตามวันที่ และครบทุกใบ', () => {
  const list = payments.listPaymentsForInvoice(db, invoice.invoiceId)
  assert(list.length === 2, `ได้ ${list.length} ใบ`)
  assert(list[0].paymentDate === '2026-09-01', `ใบแรก ${list[0].paymentDate}`)
  assert(list[1].paymentDate === '2026-09-03', `ใบสอง ${list[1].paymentDate}`)
})

// -----------------------------------------------------
// ไม่มีการคืนเงินค่าบิลแล้ว (ผู้ใช้ตัดสินใจ 2026-08-08) — เหลือแต่ทางรับเงินเข้าอย่างเดียว
group('ไม่มีการคืนเงินค่าบิล')

check('โมดูลไม่เปิดทางคืนเงินค่าบิลไว้เลย', () => {
  assert(
    payments.refundInvoicePayment === undefined,
    'ยังมี refundInvoicePayment หลงเหลืออยู่ — ถ้าจะเอากลับมา ให้ทำเป็น "ยกเลิกใบเสร็จ" แทน'
  )
})

// -----------------------------------------------------
group('ใบเสร็จของสัญญา')

const depositReceipt = payments.recordContractPayment(db, {
  ...BASE,
  contractId: contract2.contractId,
  amount: '5000',
  paymentDate: '2026-08-01',
  remark: 'เงินประกัน'
})

check('ออกใบเสร็จเงินประกันได้โดยไม่ต้องมีใบแจ้งหนี้', () => {
  assert(depositReceipt.invoiceId === null, 'ต้องไม่ผูกกับใบแจ้งหนี้')
  assert(depositReceipt.contractId === contract2.contractId, 'ต้องผูกกับสัญญา')
  assert(depositReceipt.sourceLabel === 'สัญญา', `ได้ ${depositReceipt.sourceLabel}`)
  assert(depositReceipt.roomNumber === '102', `ได้ ${depositReceipt.roomNumber}`)
})

check('ใบเสร็จของสัญญาใช้ตัวนับชุดเดียวกับใบเสร็จบิล', () => {
  assert(depositReceipt.receiptNumber === 'R2026080001', `ได้ ${depositReceipt.receiptNumber}`)
})

check('คืนเงินประกันเขียนเป็นยอดติดลบได้', () => {
  const refund = payments.recordContractPayment(db, {
    ...BASE,
    contractId: contract2.contractId,
    amount: '5000',
    paymentDate: '2027-02-01',
    isRefund: true
  })
  assert(refund.amountCents === -500000, `ได้ ${refund.amountCents}`)
})

check('สัญญาที่ไม่มีอยู่ออกใบเสร็จไม่ได้', () => {
  throws(
    () => payments.recordContractPayment(db, { ...BASE, contractId: 9999, amount: '100' }),
    'ไม่พบสัญญา',
    'ต้องเตือน'
  )
})

// -----------------------------------------------------
// ยอดบิลเปลี่ยนได้หลังรับเงินไปแล้ว (เจ้าของหอเพิ่มค่าซ่อมเข้าบิลที่จ่ายครบแล้ว)
// สถานะต้องตามไปด้วย ไม่ใช่ค้างเป็น "ชำระแล้ว" ทั้งที่มียอดค้างโผล่ขึ้นมาใหม่
group('แก้ยอดบิลหลังรับเงินแล้ว')

const editable = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: '2026-09',
  meterBatchId: batch.batchId,
  issueDate: '2026-09-30'
})

check('จ่ายครบแล้วบิลเป็นชำระแล้ว', () => {
  payments.recordInvoicePayment(db, {
    ...BASE,
    invoiceId: editable.invoiceId,
    amount: '5000',
    paymentDate: '2026-10-01'
  })
  const after = invoices.getInvoiceById(db, editable.invoiceId)
  assert(after.status === 'paid', `ได้ ${after.status}`)
})

check('เพิ่มรายการเข้าบิลที่จ่ายครบแล้ว ต้องกลับไปเป็นชำระบางส่วน', () => {
  invoices.addInvoiceItem(db, editable.invoiceId, {
    itemType: 'other',
    description: 'ค่าซ่อมประตู',
    amount: '500'
  })
  const after = invoices.getInvoiceById(db, editable.invoiceId)
  assert(after.status === 'partial_paid', `ได้ ${after.status} ทั้งที่ค้างอยู่ 500`)
  assert(after.outstandingCents === 50000, `ได้ ${after.outstandingCents}`)
})

check('ลบรายการนั้นออก ยอดกลับมาเท่าที่จ่ายไว้ สถานะกลับเป็นชำระแล้ว', () => {
  const current = invoices.getInvoiceById(db, editable.invoiceId)
  const extra = current.items.find((i) => i.description === 'ค่าซ่อมประตู')
  invoices.removeInvoiceItem(db, editable.invoiceId, extra.invoiceItemId)
  const after = invoices.getInvoiceById(db, editable.invoiceId)
  assert(after.status === 'paid', `ได้ ${after.status}`)
  assert(after.outstandingCents === 0, `ได้ ${after.outstandingCents}`)
})

// -----------------------------------------------------
// ค่าปรับชำระล่าช้า — คิดตอนรับเงิน ไม่ใช่ตอนออกบิล (ผู้ใช้ตัดสินใจ 2026-08-08)
group('ค่าปรับชำระล่าช้า')

check('หอที่ปิดค่าปรับไว้ ไม่เสนอค่าปรับเลยแม้เกินกำหนด', () => {
  const rule = invoices.getLateFeeForInvoice(db, editable.invoiceId, '2027-01-01')
  assert(rule.enabled === false, 'หอนี้ยังไม่ได้เปิดค่าปรับ')
  assert(rule.suggestedCents === 0, `ได้ ${rule.suggestedCents}`)
})

check('สูตร: นับจากวันครบกำหนดถึงวันรับเงิน แล้วหักวันผ่อนผัน', () => {
  const noGrace = invoices.calculateLateFee({
    dueDate: '2026-09-05',
    paymentDate: '2026-09-19',
    ratePerDayCents: 1000,
    graceDays: 0
  })
  assert(noGrace.overdueDays === 14, `ได้ ${noGrace.overdueDays}`)
  assert(noGrace.amountCents === 14000, `ได้ ${noGrace.amountCents}`)

  const withGrace = invoices.calculateLateFee({
    dueDate: '2026-09-05',
    paymentDate: '2026-09-19',
    ratePerDayCents: 1000,
    graceDays: 3
  })
  assert(withGrace.overdueDays === 14, 'จำนวนวันที่เกินยังเท่าเดิม')
  assert(withGrace.chargeableDays === 11, `ได้ ${withGrace.chargeableDays}`)
  assert(withGrace.amountCents === 11000, `ได้ ${withGrace.amountCents}`)
})

check('จ่ายก่อนหรือตรงวันครบกำหนด ไม่มีค่าปรับ', () => {
  for (const paymentDate of ['2026-09-01', '2026-09-05']) {
    const fee = invoices.calculateLateFee({
      dueDate: '2026-09-05',
      paymentDate,
      ratePerDayCents: 1000,
      graceDays: 0
    })
    assert(fee.amountCents === 0, `${paymentDate} ได้ ${fee.amountCents}`)
  }
})

check('ผ่อนผันยาวกว่าที่เกินมา ก็ยังไม่ปรับ', () => {
  const fee = invoices.calculateLateFee({
    dueDate: '2026-09-05',
    paymentDate: '2026-09-07',
    ratePerDayCents: 1000,
    graceDays: 5
  })
  assert(fee.chargeableDays === 0, `ได้ ${fee.chargeableDays}`)
  assert(fee.amountCents === 0, `ได้ ${fee.amountCents}`)
})

// เปิดค่าปรับให้หอทดสอบ แล้วเดินเส้นทางจริง
db.prepare(
  `UPDATE apartments SET is_auto_late_fee_enabled = 1, late_fee_per_day_cents = 1000,
     late_fee_grace_days = 0 WHERE apartment_id = ?`
).run(apartmentId)

const lateInvoice = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: '2026-10',
  meterBatchId: batch.batchId,
  issueDate: '2026-10-31'
})

check('บิลที่เกินกำหนดเสนอค่าปรับตามจำนวนวันที่เกิน', () => {
  // ครบกำหนด 05/11/2026 · จ่าย 15/11/2026 = เกิน 10 วัน × 10 บาท
  const rule = invoices.getLateFeeForInvoice(db, lateInvoice.invoiceId, '2026-11-15')
  assert(rule.enabled === true, 'หอเปิดค่าปรับแล้ว')
  assert(rule.overdueDays === 10, `ได้ ${rule.overdueDays}`)
  assert(rule.suggestedCents === 10000, `ได้ ${rule.suggestedCents}`)
})

check('เก็บค่าปรับพร้อมรับเงิน แล้วค่าปรับกลายเป็นรายการบนบิล', () => {
  const before = invoices.getInvoiceById(db, lateInvoice.invoiceId)
  payments.recordInvoicePayment(db, {
    ...BASE,
    invoiceId: lateInvoice.invoiceId,
    paymentDate: '2026-11-15',
    lateFee: '100',
    amount: String((before.totalAmountCents + 10000) / 100)
  })

  const after = invoices.getInvoiceById(db, lateInvoice.invoiceId)
  const fee = after.items.find((i) => i.itemType === 'late_fee')
  assert(fee !== undefined, 'ต้องมีรายการค่าปรับบนบิล')
  assert(fee.totalAmountCents === 10000, `ได้ ${fee.totalAmountCents}`)
  assert(fee.description.includes('10 วัน'), `ได้ "${fee.description}"`)
  assert(fee.vatRate === 0, 'ค่าปรับไม่คิด VAT')
  assert(after.status === 'paid', `ได้ ${after.status}`)
})

check('รับเงินงวดถัดไปไม่โดนปรับซ้ำในส่วนที่เคยเก็บไปแล้ว', () => {
  const rule = invoices.getLateFeeForInvoice(db, lateInvoice.invoiceId, '2026-11-15')
  assert(rule.alreadyChargedCents === 10000, `ได้ ${rule.alreadyChargedCents}`)
  assert(rule.suggestedCents === 0, `ยังเสนอเก็บอีก ${rule.suggestedCents}`)
})

check('เก็บค่าปรับเกินกว่ากฎของหอไม่ได้ ต่อให้หน้าจอส่งมา', () => {
  const another = invoices.createMonthlyInvoice(db, {
    contractId: contract2.contractId,
    billingMonth: '2026-10',
    meterBatchId: batch.batchId,
    issueDate: '2026-10-31'
  })
  throws(
    () =>
      payments.recordInvoicePayment(db, {
        ...BASE,
        invoiceId: another.invoiceId,
        paymentDate: '2026-11-15',
        lateFee: '9999',
        amount: '100'
      }),
    'เกินกว่าที่กฎของหอกำหนด',
    'ต้องบังคับเพดานที่ฝั่ง main ไม่เชื่อหน้าจอ'
  )
})

// -----------------------------------------------------
group('บิลที่ถูกยกเลิก')

check('บิลที่ยกเลิกแล้วรับชำระไม่ได้', () => {
  const other = invoices.createMonthlyInvoice(db, {
    contractId: contract2.contractId,
    billingMonth: '2026-08',
    meterBatchId: batch.batchId,
    issueDate: '2026-08-31'
  })
  invoices.cancelInvoice(db, other.invoiceId)
  throws(
    () =>
      payments.recordInvoicePayment(db, { ...BASE, invoiceId: other.invoiceId, amount: '100' }),
    'ยกเลิก',
    'ต้องกันการรับเงินเข้าบิลที่ยกเลิกแล้ว'
  )
})

// -----------------------------------------------------
group('รายงานใบเสร็จรับเงิน')

check('กรองตามเดือนได้ และนับจำนวนใบถูกต้อง', () => {
  const report = payments.listReceipts(db, apartmentId, { month: '2026-09' })
  // ก.ย.: รับ 2,000 + รับ 3,000 = 2 ใบ
  assert(report.receiptCount === 2, `ได้ ${report.receiptCount} ใบ`)
  assert(report.totalAmountCents === 500000, `ได้ ${report.totalAmountCents}`)
})

// ใบเสร็จยอดติดลบยังมีได้จากการคืนเงินประกันตอนย้ายออก (ผูกกับสัญญา ไม่ใช่กับบิล)
// ยอดรวมจึงต้องหักใบพวกนั้นออก เพื่อให้เป็น "เงินที่เข้าหอจริง" ไม่ใช่ผลบวกของใบที่ออก
check('ยอดรวมหักใบคืนเงินประกันออก จึงเป็นเงินที่เข้าหอจริง', () => {
  const report = payments.listReceipts(db, apartmentId)
  // ก.ย. 2,000 + 3,000 · สัญญา ส.ค. +5,000 · สัญญา ก.พ. -5,000 · ต.ค. 5,000
  // · พ.ย. 5,100 (ค่าเช่า 5,000 + ค่าปรับ 100) = 15,100
  assert(report.totalAmountCents === 1510000, `ได้ ${report.totalAmountCents}`)
  assert(
    report.receipts.some((r) => r.isRefund),
    'ต้องมีใบคืนเงินประกันปนอยู่ ไม่งั้นข้อนี้ไม่ได้ทดสอบอะไร'
  )
})

check('ไม่กรองเดือนได้ใบเสร็จทุกใบของหอ รวมใบของสัญญาด้วย', () => {
  const report = payments.listReceipts(db, apartmentId)
  // ก.ย. 2 ใบ + สัญญา 2 ใบ (ส.ค. รับ, ก.พ. คืน) + ต.ค. 1 ใบ + พ.ย. 1 ใบ (บิลที่มีค่าปรับ)
  assert(report.receiptCount === 6, `ได้ ${report.receiptCount} ใบ`)
  assert(
    report.receipts.some((r) => r.sourceType === 'contract'),
    'ต้องมีใบเสร็จของสัญญาปนอยู่ด้วย'
  )
})

check('เรียงใบใหม่สุดขึ้นก่อน', () => {
  const report = payments.listReceipts(db, apartmentId)
  assert(report.receipts[0].paymentDate === '2027-02-01', `ได้ ${report.receipts[0].paymentDate}`)
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลรับชำระเงินทำงานครบทุกเส้นทาง')
