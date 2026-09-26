// ทดสอบหน้าภาพรวม — รันด้วย: npm run test:dashboard
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
const bookings = await import('../src/main/db/bookings.js')
const meter = await import('../src/main/db/meterReadings.js')
const invoices = await import('../src/main/db/invoices.js')
const payments = await import('../src/main/db/payments.js')
const maintenance = await import('../src/main/db/maintenance.js')
const terminations = await import('../src/main/db/terminations.js')
const dashboard = await import('../src/main/db/dashboard.js')

const { db, cleanup } = await openTempDatabase('dormy-dashboard')

const TODAY = '2026-08-17'
const THIS_MONTH = '2026-08'
const LAST_MONTH = '2026-07'

const staff = users.insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบภาพรวม',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId
utility.saveUtilityDefaults(db, apartmentId, {
  water: { enabled: false },
  electric: { enabled: false }
})

rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 5 }])
const [room1, room2, room3, room4, room5] = rooms.listFloors(db, apartmentId)[0].rooms
rooms.setRoomRates(
  db,
  [room1.roomId, room2.roomId, room3.roomId, room4.roomId, room5.roomId],
  { monthlyRent: '5000' }
)

let phoneSeq = 0
function makeTenant(firstName) {
  phoneSeq += 1
  return tenants.insertTenant(db, {
    firstName,
    lastName: 'ทดสอบ',
    phone: `08100000${String(phoneSeq).padStart(2, '0')}`
  })
}

function makeContract(roomId, startDate) {
  return contracts.createContract(db, {
    roomId,
    rentType: 'monthly',
    startDate,
    rentAmount: '5000',
    deposit: '5000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    termMonths: 12,
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [makeTenant('ผู้เช่า').tenantId],
    createdBy: staff.user_id
  })
}

const contract1 = makeContract(room1.roomId, '2026-06-01')
const contract2 = makeContract(room2.roomId, '2026-06-01')
const contract3 = makeContract(room3.roomId, '2026-08-05')

bookings.createBooking(db, {
  roomId: room4.roomId,
  rentType: 'monthly',
  checkInDate: '2026-09-01',
  rentPrice: '5000',
  bookingFee: '0',
  paymentMethod: 'cash',
  customerName: 'คนจอง ทดสอบ',
  customerPhone: '0891234567'
})
rooms.setRoomStatus(db, [room5.roomId], 'maintenance')

const julyBatch = meter.createBatch(db, apartmentId, '2026-07-01')

const overdueInvoice = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: LAST_MONTH,
  meterBatchId: julyBatch.batchId,
  issueDate: '2026-07-01'
})
const partialInvoice = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: THIS_MONTH,
  meterBatchId: julyBatch.batchId,
  issueDate: '2026-08-01'
})
const partialPayment = payments.recordInvoicePayment(db, {
  invoiceId: partialInvoice.invoiceId,
  amount: '2000',
  paymentMethod: 'cash',
  paymentDate: '2026-08-10',
  createdBy: staff.user_id
})
const paidInvoice = invoices.createMonthlyInvoice(db, {
  contractId: contract2.contractId,
  billingMonth: LAST_MONTH,
  meterBatchId: julyBatch.batchId,
  issueDate: '2026-07-01'
})
payments.recordInvoicePayment(db, {
  invoiceId: paidInvoice.invoiceId,
  amount: '5000',
  paymentMethod: 'transfer',
  paymentDate: '2026-07-20',
  createdBy: staff.user_id
})
invoices.createMonthlyInvoice(db, {
  contractId: contract3.contractId,
  billingMonth: '2026-09',
  meterBatchId: julyBatch.batchId,
  issueDate: '2026-08-16'
})

const summaryAsOf = (today = TODAY) => dashboard.getDashboardSummary(db, apartmentId, { today })

group('เดือนที่ใช้สรุป')

check('เดือนที่สรุปมาจากวันที่ที่ส่งเข้าไป และเดือนก่อนหน้าข้ามปีได้', () => {
  const august = summaryAsOf()
  assert(august.billingMonth === THIS_MONTH, `ได้ ${august.billingMonth}`)
  assert(august.previousMonth === LAST_MONTH, `ได้ ${august.previousMonth}`)

  const january = summaryAsOf('2026-01-15')
  assert(january.previousMonth === '2025-12', `ได้ ${january.previousMonth}`)
})

check('ช่วงวันของรายรับจบที่วันสุดท้ายของเดือนจริง', () => {
  assert(summaryAsOf().revenue.to === '2026-08-31', `ส.ค. ได้ ${summaryAsOf().revenue.to}`)
  assert(summaryAsOf('2026-02-10').revenue.to === '2026-02-28', 'ก.พ. ปีปกติต้องจบ 28')
  assert(summaryAsOf('2028-02-10').revenue.to === '2028-02-29', 'ก.พ. ปีอธิกสุรทินต้องจบ 29')
})

check('ไม่ระบุหอ / วันที่ไม่ถูกต้อง ต้องไม่ผ่าน', () => {
  throws(() => dashboard.getDashboardSummary(db, null), 'ไม่พบหอพัก', 'ไม่ระบุหอผ่านได้')
  throws(
    () => dashboard.getDashboardSummary(db, apartmentId, { today: '17/08/2026' }),
    'วันที่ไม่ถูกต้อง',
    'วันที่รูปแบบผิดผ่านได้'
  )
})

group('ยอดค้างชำระ')

check('ยอดค้าง/จำนวนใบ ตรงกับหน้าใบแจ้งหนี้ที่กรองค้างชำระ', () => {
  const summary = summaryAsOf()
  const list = invoices.listInvoices(db, apartmentId, {
    settlement: 'outstanding',
    today: TODAY
  })

  const total = list.reduce((sum, inv) => sum + inv.outstandingCents, 0)
  assert(summary.outstanding.totalCents === total, `หน้าแรก ${summary.outstanding.totalCents} ≠ ${total}`)
  assert(summary.outstanding.invoiceCount === list.length, `จำนวนใบ ${summary.outstanding.invoiceCount} ≠ ${list.length}`)
  assert(summary.outstanding.totalCents === 1300000, `ยอดค้างได้ ${summary.outstanding.totalCents}`)
})

check('นับใบที่เกินกำหนดแยกจากจำนวนใบค้างทั้งหมด', () => {
  const summary = summaryAsOf()
  assert(summary.outstanding.invoiceCount === 3, `ค้างทั้งหมดได้ ${summary.outstanding.invoiceCount}`)
  assert(summary.outstanding.overdueCount === 2, `เกินกำหนดได้ ${summary.outstanding.overdueCount}`)
})

check('ตารางบิลค้างเรียงจากค้างนานสุด และมีใบที่ยังไม่ถึงกำหนดต่อท้าย', () => {
  const rows = summaryAsOf().topOverdue
  assert(rows.length === 3, `ได้ ${rows.length} แถว`)
  assert(rows[0].invoiceId === overdueInvoice.invoiceId, 'ใบที่ค้างนานสุดต้องอยู่แถวแรก')
  assert(rows[0].overdueDays === 43, `เกินกำหนดได้ ${rows[0].overdueDays} วัน`)

  for (let i = 1; i < rows.length; i += 1) {
    assert(rows[i - 1].overdueDays >= rows[i].overdueDays, 'ลำดับไม่ได้เรียงจากค้างนานสุด')
  }
  assert(rows[rows.length - 1].overdueDays === 0, 'ใบที่ยังไม่ถึงกำหนดต้องได้ 0')
})

check('ตารางบิลค้างยาวสุด 5 แถว แต่ตัวนับยังบอกจำนวนจริงทั้งหมด', () => {
  const extra = []
  for (let i = 0; i < 4; i += 1) {
    extra.push(
      invoices.addInvoiceItem(db, overdueInvoice.invoiceId, {
        itemType: 'other',
        description: `รายการที่ ${i}`,
        amount: '0'
      })
    )
  }
  const added = ['2026-10', '2026-11', '2026-12'].map((month) =>
    invoices.createMonthlyInvoice(db, {
      contractId: contract2.contractId,
      billingMonth: month,
      meterBatchId: julyBatch.batchId,
      issueDate: '2026-08-16'
    })
  )

  const summary = summaryAsOf()
  assert(summary.topOverdue.length === dashboard.TOP_OVERDUE_LIMIT, `ได้ ${summary.topOverdue.length} แถว`)
  assert(summary.outstanding.invoiceCount === 6, `ตัวนับได้ ${summary.outstanding.invoiceCount}`)

  for (const invoice of added) {
    invoices.cancelInvoice(db, invoice.invoiceId, { reason: 'ล้างข้อมูลเทสต์', cancelledBy: staff.user_id })
  }
  assert(summaryAsOf().outstanding.invoiceCount === 3, 'ล้างข้อมูลเทสต์ไม่กลับสู่สภาพเดิม')
  void extra
})

check('บิลที่ยกเลิกแล้วหายจากยอดค้างทันที', () => {
  const before = summaryAsOf().outstanding
  const throwaway = invoices.createMonthlyInvoice(db, {
    contractId: contract2.contractId,
    billingMonth: '2026-09',
    meterBatchId: julyBatch.batchId,
    issueDate: '2026-08-16'
  })

  const during = summaryAsOf().outstanding
  assert(during.invoiceCount === before.invoiceCount + 1, 'บิลใหม่ไม่เข้ายอดค้าง')

  invoices.cancelInvoice(db, throwaway.invoiceId, {
    reason: 'ออกผิดห้อง',
    cancelledBy: staff.user_id
  })

  const after = summaryAsOf().outstanding
  assert(after.invoiceCount === before.invoiceCount, `จำนวนใบได้ ${after.invoiceCount}`)
  assert(after.totalCents === before.totalCents, `ยอดค้างได้ ${after.totalCents}`)
})

group('ห้อง')

check('นับห้องตามสถานะ และห้องที่มีคนจองยังนับเป็นห้องว่าง', () => {
  const { rooms: stat } = summaryAsOf()
  assert(stat.total === 5, `ห้องทั้งหมดได้ ${stat.total}`)
  assert(stat.occupied === 3, `มีคนอยู่ได้ ${stat.occupied}`)
  assert(stat.vacant === 1, `ห้องว่างได้ ${stat.vacant}`)
  assert(stat.maintenance === 1, `ปิดปรับปรุงได้ ${stat.maintenance}`)
  assert(stat.booked === 1, `จองแล้วได้ ${stat.booked}`)
  assert(stat.occupancyPercent === 60, `อัตราการเข้าพักได้ ${stat.occupancyPercent}`)
})

check('หอที่ยังไม่มีห้องไม่หารด้วยศูนย์', () => {
  const empty = apartments.insertApartment(db, {
    nameTh: 'หอที่ยังไม่มีห้อง',
    addressTh: 'ที่อยู่',
    dueDateDay: 10,
    lateFeePerDay: '0'
  })
  const summary = dashboard.getDashboardSummary(db, empty.apartmentId, { today: TODAY })
  assert(summary.rooms.total === 0, `ได้ ${summary.rooms.total}`)
  assert(summary.rooms.occupancyPercent === 0, `ได้ ${summary.rooms.occupancyPercent}`)
  assert(summary.outstanding.totalCents === 0, 'หอเปล่าต้องไม่มียอดค้าง')
  assert(summary.tasks.billing.expected === 0, 'หอเปล่าต้องไม่มีห้องที่ต้องออกบิล')
  assert(summary.topOverdue.length === 0, 'หอเปล่าต้องไม่มีบิลค้าง')
})

group('สิ่งที่ต้องทำ — จดมิเตอร์')

check('ยังไม่มีใบจดของเดือนนี้ = ยังไม่ได้จด แต่ยังบอกวันของใบล่าสุดได้', () => {
  const { meter: task } = summaryAsOf().tasks
  assert(task.hasBatchThisMonth === false, 'ยังไม่มีใบของเดือนนี้แต่บอกว่าจดแล้ว')
  assert(task.latestBatchDate === '2026-07-01', `ใบล่าสุดได้ ${task.latestBatchDate}`)
})

const augustBatch = meter.createBatch(db, apartmentId, '2026-08-01')

check('ใบของเดือนนี้ที่ยังไม่ได้กรอกเลขห้องไหน ต้องยังไม่นับว่าเสร็จ', () => {
  const { meter: task } = summaryAsOf().tasks
  assert(task.hasBatchThisMonth === true, 'มีใบของเดือนนี้แล้วแต่บอกว่าไม่มี')
  assert(task.batchDate === '2026-08-01', `ได้ ${task.batchDate}`)
  assert(task.roomCount === 0, `จำนวนห้องที่จดได้ ${task.roomCount}`)
})

check('กรอกเลขมิเตอร์แล้วจำนวนห้องที่จดขึ้นตาม', () => {
  meter.saveBatchReadings(db, augustBatch.batchId, 'water', [
    { roomId: room1.roomId, currentReading: 120 },
    { roomId: room2.roomId, currentReading: 80 }
  ])

  const { meter: task } = summaryAsOf().tasks
  assert(task.roomCount === 2, `ได้ ${task.roomCount}`)
})

check('มีใบของเดือนถัดไป/ปีถัดไปอยู่ข้างหน้า ใบของเดือนนี้ต้องยังถูกเจอ', () => {
  meter.createBatch(db, apartmentId, '2026-09-01')
  meter.createBatch(db, apartmentId, '2027-09-01')

  const { meter: task } = summaryAsOf().tasks
  assert(task.hasBatchThisMonth === true, 'ใบของเดือนนี้หายไปเพราะมีใบของเดือนหลังกว่า')
  assert(task.batchDate === '2026-08-01', `ใบของเดือนนี้ได้ ${task.batchDate}`)
  assert(task.roomCount === 2, `จำนวนห้องต้องเป็นของใบเดือนนี้ ได้ ${task.roomCount}`)
  assert(task.latestBatchDate === '2027-09-01', `ใบล่าสุดได้ ${task.latestBatchDate}`)
})

check('เดือนเดียวมีใบเปล่ากับใบที่กรอกแล้วปนกัน ต้องนับใบที่กรอกแล้ว', () => {
  meter.createBatch(db, apartmentId, '2026-08-20')

  const { meter: task } = summaryAsOf().tasks
  assert(task.hasBatchThisMonth === true, 'ใบของเดือนนี้หายไป')
  assert(task.batchDate === '2026-08-01', `ต้องเลือกใบที่กรอกแล้ว ได้ ${task.batchDate}`)
  assert(task.roomCount === 2, `ได้ ${task.roomCount}`)
})

group('สิ่งที่ต้องทำ — ออกบิล')

function billingFromPreview(month = THIS_MONTH) {
  const rows = invoices.previewMonthlyBilling(db, {
    apartmentId,
    meterBatchId: augustBatch.batchId,
    billingMonth: month
  })
  const due = rows.filter((row) => !row.startsThisMonth)
  return {
    expected: due.length,
    issued: due.filter((row) => row.existingInvoiceId).length
  }
}

check('จำนวนห้องที่ต้องออกบิล/ออกแล้ว ตรงกับตัวช่วยออกบิลทีละห้อง', () => {
  const mine = summaryAsOf().tasks.billing
  const theirs = billingFromPreview()

  assert(mine.expected === theirs.expected, `ต้องออกบิล ${mine.expected} ≠ ${theirs.expected}`)
  assert(mine.issued === theirs.issued, `ออกแล้ว ${mine.issued} ≠ ${theirs.issued}`)
  assert(mine.remaining === mine.expected - mine.issued, 'ยอดคงเหลือไม่ตรงกับผลต่าง')
})

check('สัญญาที่เริ่มเดือนนี้ไม่ถูกนับว่าต้องออกบิล', () => {
  const { billing } = summaryAsOf().tasks
  assert(billing.expected === 2, `ต้องออกบิลได้ ${billing.expected} ห้อง`)
  assert(billing.issued === 1, `ออกแล้วได้ ${billing.issued} ห้อง`)
  assert(billing.remaining === 1, `เหลือได้ ${billing.remaining} ห้อง`)

  const september = dashboard.getDashboardSummary(db, apartmentId, { today: '2026-09-02' })
  assert(september.tasks.billing.expected === 3, `เดือนหน้าต้องออกบิล ${september.tasks.billing.expected} ห้อง`)
})

check('บิลที่ยกเลิกแล้วไม่นับว่าออกบิลเดือนนี้แล้ว', () => {
  const invoice = invoices.createMonthlyInvoice(db, {
    contractId: contract2.contractId,
    billingMonth: THIS_MONTH,
    meterBatchId: augustBatch.batchId,
    issueDate: '2026-08-17'
  })
  const full = summaryAsOf().tasks.billing
  assert(full.issued === 2 && full.remaining === 0, `ออกครบแล้วได้ ${full.issued}/${full.expected}`)
  assert(billingFromPreview().issued === full.issued, 'สองที่นับไม่ตรงกันหลังออกบิลเพิ่ม')

  invoices.cancelInvoice(db, invoice.invoiceId, {
    reason: 'ออกผิดเดือน',
    cancelledBy: staff.user_id
  })

  const back = summaryAsOf().tasks.billing
  assert(back.issued === 1, `ยกเลิกแล้วออกแล้วได้ ${back.issued}`)
  assert(back.remaining === 1, `ยกเลิกแล้วเหลือได้ ${back.remaining}`)
  assert(billingFromPreview().issued === back.issued, 'สองที่นับไม่ตรงกันหลังยกเลิกบิล')
})

group('สิ่งที่ต้องทำ — งานซ่อม / ตามเก็บเงินย้ายออก')

check('งานซ่อมค้างและค่าซ่อมรวม ตรงกับหน้าแจ้งซ่อม', () => {
  maintenance.createMaintenanceRequest(db, {
    roomId: room1.roomId,
    reportedDate: '2026-08-10',
    description: 'ก๊อกน้ำรั่ว'
  })
  const done = maintenance.createMaintenanceRequest(db, {
    roomId: room2.roomId,
    reportedDate: '2026-08-11',
    description: 'หลอดไฟขาด'
  })
  maintenance.completeMaintenance(db, done.maintenanceId, {
    repairedDate: '2026-08-12',
    repairCost: '250'
  })

  const report = maintenance.listMaintenanceRequests(db, apartmentId)
  const task = summaryAsOf().tasks.maintenance
  assert(task.openCount === report.openCount, `งานค้าง ${task.openCount} ≠ ${report.openCount}`)
  assert(task.openCount === 1, `งานค้างได้ ${task.openCount}`)
  assert(
    task.repairCostTotalCents === report.repairCostTotalCents,
    `ค่าซ่อมรวม ${task.repairCostTotalCents} ≠ ${report.repairCostTotalCents}`
  )
  assert(task.repairCostTotalCents === 25000, `ค่าซ่อมรวมได้ ${task.repairCostTotalCents}`)
})

check('ยอดตามเก็บเงินย้ายออก ตรงกับหน้าประวัติการย้ายออก', () => {
  const report = terminations.listTerminations(db, apartmentId)
  const task = summaryAsOf().tasks.moveOut
  assert(task.unpaidCount === report.unpaidCount, `จำนวนราย ${task.unpaidCount} ≠ ${report.unpaidCount}`)
  assert(
    task.unpaidTotalCents === report.unpaidTotalCents,
    `ยอด ${task.unpaidTotalCents} ≠ ${report.unpaidTotalCents}`
  )
  assert(typeof task.unpaidTotalCents === 'number', `ได้ ${typeof task.unpaidTotalCents}`)
})

group('รายรับ')

check('รายรับเดือนนี้/เดือนก่อน ตรงกับรายงานใบเสร็จช่วงเดียวกัน', () => {
  const summary = summaryAsOf()
  const thisMonth = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31'
  })
  const lastMonth = payments.listReceipts(db, apartmentId, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31'
  })

  assert(
    summary.revenue.monthCents === thisMonth.totalAmountCents,
    `เดือนนี้ ${summary.revenue.monthCents} ≠ ${thisMonth.totalAmountCents}`
  )
  assert(
    summary.revenue.previousMonthCents === lastMonth.totalAmountCents,
    `เดือนก่อน ${summary.revenue.previousMonthCents} ≠ ${lastMonth.totalAmountCents}`
  )
  assert(summary.revenue.receiptCount === thisMonth.receiptCount, 'จำนวนใบเสร็จไม่ตรงกับรายงาน')
})

check('ผลต่างเทียบเดือนก่อนเป็นผลลบกันตรงๆ และติดลบได้', () => {
  const summary = summaryAsOf()
  assert(
    summary.revenue.deltaCents === summary.revenue.monthCents - summary.revenue.previousMonthCents,
    `ได้ ${summary.revenue.deltaCents}`
  )

  const quiet = summaryAsOf('2026-09-05')
  assert(quiet.revenue.monthCents === 0, `ก.ย. ต้องไม่มีเงินเข้า ได้ ${quiet.revenue.monthCents}`)
  assert(quiet.revenue.deltaCents < 0, `ผลต่างต้องติดลบ ได้ ${quiet.revenue.deltaCents}`)
})

check('รับเงินเพิ่มแล้วรายรับเดือนนี้ขยับเท่ายอดที่รับมาพอดี', () => {
  const before = summaryAsOf().revenue
  payments.recordInvoicePayment(db, {
    invoiceId: partialInvoice.invoiceId,
    amount: '1234',
    paymentMethod: 'cash',
    paymentDate: '2026-08-15',
    createdBy: staff.user_id
  })

  const after = summaryAsOf().revenue
  assert(after.monthCents === before.monthCents + 123400, `ได้ ${after.monthCents}`)
  assert(after.deltaCents === before.deltaCents + 123400, `ผลต่างได้ ${after.deltaCents}`)
})

check('ยกเลิกใบเสร็จแล้วรายรับลดลง และยอดค้างกลับมา', () => {
  const before = summaryAsOf()
  payments.cancelPayment(db, partialPayment.paymentId, {
    reason: 'คีย์ผิดห้อง',
    cancelledBy: staff.user_id
  })

  const after = summaryAsOf()
  assert(after.revenue.monthCents === before.revenue.monthCents - 200000, `รายรับได้ ${after.revenue.monthCents}`)
  assert(
    after.outstanding.totalCents === before.outstanding.totalCents + 200000,
    `ยอดค้างได้ ${after.outstanding.totalCents}`
  )
})

group('หออื่นไม่ปนกัน')

check('ตัวเลขของหออื่นไม่ปนเข้ามา', () => {
  const other = apartments.insertApartment(db, {
    nameTh: 'หอที่สอง',
    addressTh: 'ที่อยู่',
    dueDateDay: 5,
    lateFeePerDay: '0'
  })
  utility.saveUtilityDefaults(db, other.apartmentId, {
    water: { enabled: false },
    electric: { enabled: false }
  })
  rooms.generateFloorPlan(db, other.apartmentId, [{ roomCount: 1 }])
  const otherRoom = rooms.listFloors(db, other.apartmentId)[0].rooms[0]
  rooms.setRoomRates(db, [otherRoom.roomId], { monthlyRent: '9000' })

  const before = summaryAsOf()
  const otherContract = contracts.createContract(db, {
    roomId: otherRoom.roomId,
    rentType: 'monthly',
    startDate: '2026-06-01',
    rentAmount: '9000',
    deposit: '9000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    termMonths: 12,
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [makeTenant('ผู้เช่าหอสอง').tenantId],
    createdBy: staff.user_id
  })
  const otherBatch = meter.createBatch(db, other.apartmentId, '2026-08-01')
  invoices.createMonthlyInvoice(db, {
    contractId: otherContract.contractId,
    billingMonth: THIS_MONTH,
    meterBatchId: otherBatch.batchId,
    issueDate: '2026-08-01'
  })
  maintenance.createMaintenanceRequest(db, {
    roomId: otherRoom.roomId,
    reportedDate: '2026-08-01',
    description: 'งานของหอที่สอง'
  })

  const after = summaryAsOf()
  assert(after.rooms.total === before.rooms.total, 'จำนวนห้องเปลี่ยนเพราะหออื่น')
  assert(after.outstanding.totalCents === before.outstanding.totalCents, 'ยอดค้างปนกับหออื่น')
  assert(after.tasks.billing.expected === before.tasks.billing.expected, 'ห้องที่ต้องออกบิลปนกับหออื่น')
  assert(after.tasks.maintenance.openCount === before.tasks.maintenance.openCount, 'งานซ่อมปนกับหออื่น')
  assert(after.revenue.monthCents === before.revenue.monthCents, 'รายรับปนกับหออื่น')

  const theirs = dashboard.getDashboardSummary(db, other.apartmentId, { today: TODAY })
  assert(theirs.rooms.total === 1, `หอที่สองได้ ${theirs.rooms.total} ห้อง`)
  assert(theirs.tasks.maintenance.openCount === 1, `หอที่สองได้ ${theirs.tasks.maintenance.openCount} งาน`)
})

cleanup()
summarize('หน้าภาพรวมสรุปตัวเลขตรงกับทุกหน้าที่มันสรุป')
