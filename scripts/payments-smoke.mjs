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
group('คืนเงิน')

check('คืนเงินเกินที่รับมาไม่ได้', () => {
  throws(
    () =>
      payments.refundInvoicePayment(db, {
        ...BASE,
        invoiceId: invoice.invoiceId,
        amount: '6000'
      }),
    'ไม่เกินยอดที่รับมาแล้ว 5,000.00',
    'ต้องกันการคืนเกิน'
  )
})

check('คืนเงินบางส่วนเขียนเป็นใบเสร็จยอดติดลบ และบิลกลับเป็นชำระบางส่วน', () => {
  const refund = payments.refundInvoicePayment(db, {
    ...BASE,
    invoiceId: invoice.invoiceId,
    amount: '1000',
    paymentDate: '2026-09-10',
    remark: 'คิดค่าน้ำผิด'
  })
  assert(refund.amountCents === -100000, `ได้ ${refund.amountCents}`)
  assert(refund.isRefund === true, 'ต้องรู้ว่าเป็นใบคืนเงิน')

  const after = invoices.getInvoiceById(db, invoice.invoiceId)
  assert(after.status === 'partial_paid', `ได้ ${after.status}`)
  assert(after.paidAmountCents === 400000, `ได้ ${after.paidAmountCents}`)
})

check('คืนจนหมดแล้วบิลกลับไปเป็นค้างชำระเอง', () => {
  payments.refundInvoicePayment(db, {
    ...BASE,
    invoiceId: invoice.invoiceId,
    amount: '4000',
    paymentDate: '2026-09-11'
  })
  const after = invoices.getInvoiceById(db, invoice.invoiceId)
  assert(after.status === 'unpaid', `ได้ ${after.status}`)
  assert(after.paidAmountCents === 0, `ได้ ${after.paidAmountCents}`)
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
  // ก.ย.: รับ 2,000 + รับ 3,000 + คืน 1,000 + คืน 4,000 = 4 ใบ
  assert(report.receiptCount === 4, `ได้ ${report.receiptCount} ใบ`)
})

check('ยอดรวมหักใบคืนเงินออก จึงเป็นเงินที่เข้าหอจริง', () => {
  const report = payments.listReceipts(db, apartmentId, { month: '2026-09' })
  assert(report.totalAmountCents === 0, `ได้ ${report.totalAmountCents} ควรเป็น 0`)
})

check('ไม่กรองเดือนได้ใบเสร็จทุกใบของหอ รวมใบของสัญญาด้วย', () => {
  const report = payments.listReceipts(db, apartmentId)
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
