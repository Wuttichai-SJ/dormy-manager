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

check('กรองตามช่วงวันที่ได้ และนับจำนวนใบถูกต้อง', () => {
  const report = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30'
  })
  // ก.ย.: รับ 2,000 + รับ 3,000 = 2 ใบ
  assert(report.receiptCount === 2, `ได้ ${report.receiptCount} ใบ`)
  assert(report.totalAmountCents === 500000, `ได้ ${report.totalAmountCents}`)
})

check('ใส่แต่วันเริ่ม = ตั้งแต่วันนั้นเป็นต้นไป', () => {
  const report = payments.listReceipts(db, apartmentId, { dateFrom: '2026-09-03' })
  assert(
    report.receipts.every((r) => r.paymentDate >= '2026-09-03'),
    'มีใบที่รับก่อนวันเริ่มหลุดมา'
  )
  assert(report.receipts.length > 0, 'ควรเจอใบเสร็จหลังวันที่ 3 ก.ย.')
})

check('วันขอบทั้งสองข้างนับรวมด้วย', () => {
  const oneDay = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-09-01',
    dateTo: '2026-09-01'
  })
  assert(oneDay.receiptCount === 1, `ได้ ${oneDay.receiptCount} ใบ`)
  assert(oneDay.receipts[0].paymentDate === '2026-09-01', oneDay.receipts[0].paymentDate)
})

// ใบเสร็จที่จะเอาไปพิมพ์ต้องมีชื่อหอกับชื่อผู้เช่าติดมาด้วย ไม่งั้นเอกสารไม่มีหัวและไม่รู้ว่าของใคร
check('ใบเสร็จแนบข้อมูลหอและชื่อผู้เช่ามาให้หน้าพิมพ์', () => {
  const report = payments.listReceipts(db, apartmentId)
  const withInvoice = report.receipts.find((r) => r.sourceType === 'invoice')
  assert(withInvoice.apartment?.name === 'หอทดสอบรับเงิน', `ได้ ${withInvoice.apartment?.name}`)
  assert(Boolean(withInvoice.tenantName), 'ต้องมีชื่อผู้เช่า')
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
// รับเงินหลายห้องพร้อมกัน (ผู้เช่าหลายคนมาจ่ายที่โต๊ะเดียว) — ตามหน้า "รับเงินหลายห้อง"
// ของต้นแบบ
group('รับเงินหลายห้อง')

const mayBatch = meter.createBatch(db, apartmentId, '2027-05-01')
const may1 = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: '2027-05',
  meterBatchId: mayBatch.batchId,
  issueDate: '2027-05-01'
})
const may2 = invoices.createMonthlyInvoice(db, {
  contractId: contract2.contractId,
  billingMonth: '2027-05',
  meterBatchId: mayBatch.batchId,
  issueDate: '2027-05-01'
})

function countPayments() {
  return db.prepare('SELECT COUNT(*) AS n FROM payments').get().n
}

check('ตารางของหน้ารับเงินหลายห้องคืนบิลของเดือนที่เลือก', () => {
  const sheet = payments.getMultiPaymentSheet(db, apartmentId, {
    billingMonth: '2027-05',
    paymentDate: '2027-05-03'
  })
  assert(sheet.length === 2, `ได้ ${sheet.length} ใบ`)
  assert(
    sheet.every((row) => row.outstandingCents === 500000),
    'ทั้งสองห้องต้องค้างอยู่ห้องละ 5,000'
  )
  // ค่าปรับติดมากับแถวเลย หน้าจอจะได้ไม่ต้องยิงถามทีละห้อง
  assert(
    sheet.every((row) => row.lateFee !== null),
    'บิลที่ยังค้างต้องมีข้อมูลค่าปรับติดมาด้วย'
  )
})

check('ไม่เลือกห้องเลย ต้องเตือน', () => {
  throws(
    () => payments.recordInvoicePayments(db, { ...BASE, rows: [] }),
    'ยังไม่ได้เลือกห้อง',
    'ต้องกันการกดบันทึกทั้งที่ยังไม่เลือกอะไร'
  )
})

// ใบเดียวกันสองแถวจะรับเงินซ้ำ และแถวที่สองอาจผ่านการตรวจยอดค้างไปได้ถ้ารวมกันแล้วยังไม่เกิน
check('ใบแจ้งหนี้ซ้ำในชุดเดียวกัน ต้องเตือน', () => {
  throws(
    () =>
      payments.recordInvoicePayments(db, {
        ...BASE,
        rows: [
          { invoiceId: may1.invoiceId, amount: '1000' },
          { invoiceId: may1.invoiceId, amount: '1000' }
        ]
      }),
    'ซ้ำกัน',
    'ต้องกันใบซ้ำ'
  )
})

check('ช่องทางการชำระเงินตรวจครั้งเดียวสำหรับทั้งชุด', () => {
  throws(
    () =>
      payments.recordInvoicePayments(db, {
        ...BASE,
        paymentMethod: 'bitcoin',
        rows: [{ invoiceId: may1.invoiceId, amount: '100' }]
      }),
    'ช่องทางการชำระเงิน',
    'ต้องกันช่องทางที่ไม่รู้จัก'
  )
})

// **หัวใจของฟังก์ชันนี้** — ถ้าห้องที่สองกรอกผิด ต้องไม่มีใบเสร็จของห้องแรกค้างอยู่
// เจ้าของหอที่เห็น error แล้วแก้ยอดกดใหม่ จะรับเงินห้องแรกซ้ำโดยไม่รู้ตัว
check('ห้องเดียวกรอกผิด ทั้งชุดต้องไม่ถูกบันทึกเลย', () => {
  const before = countPayments()
  throws(
    () =>
      payments.recordInvoicePayments(db, {
        ...BASE,
        paymentDate: '2027-05-03',
        rows: [
          { invoiceId: may1.invoiceId, roomNumber: '101', amount: '5000' },
          // ห้อง 102 ค้างอยู่ 5,000 — กรอก 9,000 คือเกินยอดค้าง
          { invoiceId: may2.invoiceId, roomNumber: '102', amount: '9000' }
        ]
      }),
    'ห้อง 102',
    'ต้องบอกว่าห้องไหนผิด'
  )
  assert(countPayments() === before, 'ห้อง 101 ไม่ควรถูกบันทึก เพราะทั้งชุดต้องล้มพร้อมกัน')
  assert(
    invoices.getInvoiceById(db, may1.invoiceId).status === 'unpaid',
    'สถานะบิลห้อง 101 ต้องไม่ขยับ'
  )
})

check('รับเงินสองห้องพร้อมกัน ได้ใบเสร็จแยกใบ คนละเลข', () => {
  const receipts = payments.recordInvoicePayments(db, {
    ...BASE,
    paymentDate: '2027-05-03',
    remark: 'จ่ายพร้อมกันที่ออฟฟิศ',
    rows: [
      { invoiceId: may1.invoiceId, roomNumber: '101', amount: '5000' },
      { invoiceId: may2.invoiceId, roomNumber: '102', amount: '2000' }
    ]
  })

  assert(receipts.length === 2, `ได้ ${receipts.length} ใบ`)
  assert(
    receipts[0].receiptNumber !== receipts[1].receiptNumber,
    'ใบเสร็จสองใบต้องคนละเลข ไม่ใช่ยุบเป็นใบเดียว'
  )
  assert(receipts[0].amountCents === 500000, `ห้องแรกได้ ${receipts[0].amountCents}`)
  assert(receipts[1].amountCents === 200000, `ห้องที่สองได้ ${receipts[1].amountCents}`)
})

check('ช่องทาง วันที่ และหมายเหตุ ใช้ร่วมกันทั้งชุด', () => {
  const list = payments
    .listReceipts(db, apartmentId, { dateFrom: '2027-05-03', dateTo: '2027-05-03' })
    .receipts
  assert(list.length === 2, `ได้ ${list.length} ใบ`)
  for (const receipt of list) {
    assert(receipt.paymentMethod === 'cash', `ได้ ${receipt.paymentMethod}`)
    assert(receipt.remark === 'จ่ายพร้อมกันที่ออฟฟิศ', `ได้ "${receipt.remark}"`)
  }
})

// จ่ายเต็มกับจ่ายบางส่วนในชุดเดียวกันต้องได้สถานะคนละอย่าง ไม่ใช่เหมารวม
check('สถานะบิลถูกคิดใหม่รายใบตามยอดที่รับจริง', () => {
  assert(invoices.getInvoiceById(db, may1.invoiceId).status === 'paid', 'ห้อง 101 จ่ายครบ')
  const second = invoices.getInvoiceById(db, may2.invoiceId)
  assert(second.status === 'partial_paid', `ห้อง 102 ได้ ${second.status}`)
  assert(second.outstandingCents === 300000, `ห้อง 102 ค้างเหลือ ${second.outstandingCents}`)
})

check('บิลที่จ่ายครบแล้วยังอยู่ในตาราง แต่ไม่มีค่าปรับให้คิด', () => {
  const sheet = payments.getMultiPaymentSheet(db, apartmentId, {
    billingMonth: '2027-05',
    paymentDate: '2027-05-10'
  })
  const settled = sheet.find((row) => row.invoiceId === may1.invoiceId)
  assert(settled !== undefined, 'ห้องที่จ่ายแล้วต้องยังเห็นอยู่ ไม่ใช่หายไปเฉยๆ')
  assert(settled.outstandingCents === 0, `ได้ ${settled.outstandingCents}`)
  assert(settled.lateFee === null, 'บิลที่ปิดแล้วไม่ต้องคิดค่าปรับ')
})

check('รับเงินส่วนที่เหลือของห้องเดิมต่อได้', () => {
  const receipts = payments.recordInvoicePayments(db, {
    ...BASE,
    paymentDate: '2027-05-20',
    rows: [{ invoiceId: may2.invoiceId, roomNumber: '102', amount: '3000' }]
  })
  assert(receipts.length === 1, `ได้ ${receipts.length} ใบ`)
  assert(invoices.getInvoiceById(db, may2.invoiceId).status === 'paid', 'ต้องกลายเป็นจ่ายครบ')
})

// -----------------------------------------------------
// เคสจริงที่ผู้ใช้ยกมา 2026-08-10: ผู้เช่ามาดูห้อง 01/03 วางเงินจอง 2,000 (= ครึ่งหนึ่งของ
// เงินประกัน 4,000) แล้วเข้าอยู่จริง 25/05 — เจ้าของหอต้องไม่ลืมเก็บอีก 2,000
group('เงินประกันที่ยังเก็บไม่ครบ')

// หอนี้มีผังห้องอยู่แล้ว จึงเพิ่มเป็นชั้นใหม่ ไม่ใช่สร้างผังทับ
const floorsAfter = rooms.addFloor(db, apartmentId, { roomCount: 1 })
const depositRoom = floorsAfter[floorsAfter.length - 1].rooms[0]
rooms.setRoomRates(db, [depositRoom.roomId], { monthlyRent: '3500' })

const depositTenant = tenants.insertTenant(db, {
  firstName: 'ผู้เช่ามัดจำครึ่ง',
  lastName: 'ทดสอบ',
  phone: '0899999999'
})

const depositContract = contracts.createContract(db, {
  roomId: depositRoom.roomId,
  rentType: 'monthly',
  startDate: '2026-05-25',
  rentAmount: '3500',
  deposit: '4000',
  depositPaymentMethod: 'cash',
  // เงินจอง 2,000 ที่รับไปแล้วตั้งแต่วันมาดูห้อง
  bookingFee: '2000',
  bookingPaidDate: '2026-03-01',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [depositTenant.tenantId],
  createdBy: staff.user_id
})

check('เงินจองที่รับไปแล้ว ถูกออกเป็นใบเสร็จเงินประกันให้อัตโนมัติ', () => {
  const status = payments.getDepositStatus(db, depositContract.contractId)
  assert(status.requiredCents === 400000, `ตกลงไว้ ${status.requiredCents}`)
  assert(status.receivedCents === 200000, `รับแล้ว ${status.receivedCents}`)
  assert(status.outstandingCents === 200000, `ค้าง ${status.outstandingCents}`)
  assert(status.isSettled === false, 'ยังเก็บไม่ครบ')
})

// เงินเข้าหอวันที่ 01/03 ไม่ใช่วันทำสัญญา 25/05 — ถ้าลงวันผิด รายรับเดือนมีนาคมจะหายทั้งก้อน
check('ใบเสร็จเงินจองลงวันที่รับเงินจริง ไม่ใช่วันทำสัญญา', () => {
  const list = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-03-01',
    dateTo: '2026-03-01'
  }).receipts
  assert(list.length === 1, `ได้ ${list.length} ใบ`)
  assert(list[0].amountCents === 200000, `ได้ ${list[0].amountCents}`)
  assert(list[0].purpose === 'deposit', `ได้ ${list[0].purpose}`)
  assert(list[0].sourceType === 'contract', `ได้ ${list[0].sourceType}`)
})

check('รายการห้องบอกยอดเงินประกันที่ยังค้าง', () => {
  const room = contracts
    .listRoomsForApartment(db, apartmentId)
    .find((r) => r.roomId === depositRoom.roomId)
  assert(room.depositOutstandingCents === 200000, `ได้ ${room.depositOutstandingCents}`)
})

check('รับส่วนที่เหลือแล้วยอดค้างเป็นศูนย์', () => {
  payments.recordContractPayment(db, {
    contractId: depositContract.contractId,
    amount: '2000',
    purpose: 'deposit',
    paymentMethod: 'cash',
    paymentDate: '2026-05-25',
    createdBy: staff.user_id
  })
  const status = payments.getDepositStatus(db, depositContract.contractId)
  assert(status.receivedCents === 400000, `รับแล้ว ${status.receivedCents}`)
  assert(status.outstandingCents === 0, `ค้าง ${status.outstandingCents}`)
  assert(status.isSettled === true, 'ต้องถือว่าเก็บครบแล้ว')

  const room = contracts
    .listRoomsForApartment(db, apartmentId)
    .find((r) => r.roomId === depositRoom.roomId)
  assert(room.depositOutstandingCents === 0, `ป้ายในตารางยังขึ้น ${room.depositOutstandingCents}`)
})

// ค่าเช่าล่วงหน้าผูกกับสัญญาเหมือนกัน แต่ไม่ใช่เงินประกัน — ถ้านับรวมจะทำให้ยอดค้าง
// หายไปทั้งที่ยังไม่ได้เก็บเงินประกันจริง
check('ใบเสร็จค่าเช่าล่วงหน้าไม่ถูกนับเป็นเงินประกัน', () => {
  payments.recordContractPayment(db, {
    contractId: depositContract.contractId,
    amount: '1000',
    purpose: 'advance',
    paymentMethod: 'cash',
    paymentDate: '2026-05-25',
    createdBy: staff.user_id
  })
  const status = payments.getDepositStatus(db, depositContract.contractId)
  assert(status.receivedCents === 400000, `ได้ ${status.receivedCents} ไม่ควรขยับ`)
})

check('ประเภทเงินที่ไม่รู้จักต้องเตือน และใบเสร็จของสัญญาเป็นค่าบิลไม่ได้', () => {
  throws(
    () =>
      payments.recordContractPayment(db, {
        contractId: depositContract.contractId,
        amount: '100',
        purpose: 'ค่าอะไรก็ไม่รู้',
        paymentMethod: 'cash',
        paymentDate: '2026-05-25',
        createdBy: staff.user_id
      }),
    'ประเภทเงินไม่ถูกต้อง',
    'ต้องกันค่าที่ไม่รู้จัก'
  )
  throws(
    () =>
      payments.recordContractPayment(db, {
        contractId: depositContract.contractId,
        amount: '100',
        purpose: 'invoice',
        paymentMethod: 'cash',
        paymentDate: '2026-05-25',
        createdBy: staff.user_id
      }),
    'ค่าบิลต้องผูกกับใบแจ้งหนี้',
    'ค่าบิลต้องมาทางใบแจ้งหนี้เท่านั้น'
  )
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลรับชำระเงินทำงานครบทุกเส้นทาง')
