// ทดสอบโมดูลออกบิลบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:invoices
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
const services = await import('../src/main/db/apartmentServices.js')
const utility = await import('../src/main/db/utilityDefaults.js')
const rooms = await import('../src/main/db/rooms.js')
const tenants = await import('../src/main/db/tenants.js')
const contracts = await import('../src/main/db/contracts.js')
const meter = await import('../src/main/db/meterReadings.js')
const invoices = await import('../src/main/db/invoices.js')
// แปลงสตางค์เป็นข้อความบาทด้วยตัวเดียวกับที่โปรแกรมใช้ ไม่หาร 100 เอง (กฎใน money.js)
const { centsToBaht } = await import('../src/main/money.js')

const { db, cleanup } = await openTempDatabase('dormy-invoices')

// -----------------------------------------------------
// ตั้งหอให้ครบเหมือนใช้งานจริง: ค่าน้ำ/ค่าไฟ → ผังห้อง → ค่าบริการ → สัญญา
const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบออกบิล',
  addressTh: '123 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isVatEnabled: true
})
const apartmentId = apartment.apartmentId

utility.saveUtilityDefaults(db, apartmentId, {
  water: { enabled: true, billingType: 'actual', unitPrice: '20' },
  electric: { enabled: true, billingType: 'actual', unitPrice: '7' }
})

rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 3 }])
const [room1, room2, room3] = rooms.listFloors(db, apartmentId)[0].rooms
rooms.setRoomRates(db, [room1.roomId, room2.roomId, room3.roomId], { monthlyRent: '5000' })

const wifi = services.insertService(db, apartmentId, {
  name: 'ค่าอินเทอร์เน็ต',
  price: '300',
  isVatEnabled: true
})
const trash = services.insertService(db, apartmentId, {
  name: 'ค่าขยะ',
  price: '50',
  isVatEnabled: false
})
rooms.attachServicesToRooms(db, [room1.roomId], [wifi.serviceId, trash.serviceId])

// บัญชีรับเงิน + ข้อความแจ้งชำระ — ต้องไปโผล่บนใบแจ้งหนี้ ไม่ใช่อยู่แต่ในหน้าตั้งค่า
const banks = await import('../src/main/db/bankAccounts.js')
const mainAccount = banks.insertBankAccount(db, apartmentId, {
  bankName: 'กสิกรไทย',
  accountName: 'หอทดสอบออกบิล',
  accountNumber: '123-4-56789-0'
})
banks.insertBankAccount(db, apartmentId, {
  bankName: 'ไทยพาณิชย์',
  accountName: 'หอทดสอบออกบิล',
  accountNumber: '987-6-54321-0'
})
banks.setDefaultBankAccount(db, mainAccount.bankAccountId)
banks.savePaymentInstructions(db, apartmentId, 'โอนแล้วส่งสลิปมาที่ไลน์ @dormy')

const somchai = tenants.insertTenant(db, {
  firstName: 'สมชาย',
  lastName: 'ทดสอบ',
  phone: '0812345678'
})
const somying = tenants.insertTenant(db, {
  firstName: 'สมหญิง',
  lastName: 'ทดสอบ',
  phone: '0891234567'
})

// เงินประกันที่รับในวันทำสัญญาถูกออกเป็นใบเสร็จให้ทันที จึงต้องมีผู้รับเงินตั้งแต่ต้นไฟล์
const staffUser = (await import('../src/main/db/users.js')).insertUser(db, {
  fullName: 'ผู้จัดการหอ',
  phone: '0801112222',
  email: 'manager@example.com',
  passwordHash: 'x',
  recoveryCodeHash: 'y'
})

const contract1 = contracts.createContract(db, {
  roomId: room1.roomId,
  rentType: 'monthly',
  startDate: '2026-07-01',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  // เลขมิเตอร์วันเข้าพัก = เลขครั้งก่อนของการจดรอบแรก (ระบบไล่หาให้ ห้ามกรอกทับ)
  waterMeterStart: 2,
  electricMeterStart: 0,
  tenants: [somchai.tenantId],
  createdBy: staffUser.user_id
})
const contract2 = contracts.createContract(db, {
  roomId: room2.roomId,
  rentType: 'monthly',
  startDate: '2026-07-01',
  rentAmount: '5000',
  deposit: '5000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [somying.tenantId],
  createdBy: staffUser.user_id
})

const batch = meter.createBatch(db, apartmentId, '2026-08-31')
meter.saveBatchReadings(db, batch.batchId, 'water', [
  { roomId: room1.roomId, roomNumber: '101', currentReading: 100 }
])
meter.saveBatchReadings(db, batch.batchId, 'electric', [
  { roomId: room1.roomId, roomNumber: '101', currentReading: 300 }
])

// -----------------------------------------------------
group('เลขที่เอกสาร')

check('รูปแบบ I + YYYYMM + ลำดับ 4 หลัก', () => {
  const first = invoices.nextDocumentNumber(db, apartmentId, 'invoice', '2026-08-31')
  assert(first === 'I2026080001', `ได้ ${first}`)
})

check('เดินหน้าทีละหนึ่งภายในเดือนเดียวกัน', () => {
  const second = invoices.nextDocumentNumber(db, apartmentId, 'invoice', '2026-08-15')
  assert(second === 'I2026080002', `ได้ ${second}`)
})

check('ขึ้นเดือนใหม่เริ่มนับหนึ่งใหม่', () => {
  const next = invoices.nextDocumentNumber(db, apartmentId, 'invoice', '2026-09-01')
  assert(next === 'I2026090001', `ได้ ${next}`)
})

// ไม่ผูกกับลำดับที่แน่นอน เพราะการทำสัญญาข้างบนออกใบเสร็จเงินประกันไปแล้วหลายใบ
// สิ่งที่ต้องพิสูจน์คือ "คนละตัวนับกับใบแจ้งหนี้" ไม่ใช่ว่าเลขเท่าไหร่
check('ใบเสร็จใช้ตัวนับคนละชุดกับใบแจ้งหนี้', () => {
  const first = invoices.nextDocumentNumber(db, apartmentId, 'receipt', '2026-08-31')
  const second = invoices.nextDocumentNumber(db, apartmentId, 'receipt', '2026-08-31')
  assert(first.startsWith('R202608'), `ได้ ${first}`)
  assert(Number(second.slice(-4)) === Number(first.slice(-4)) + 1, `${first} → ${second}`)

  // ตัวนับของใบแจ้งหนี้ต้องไม่ขยับตามการออกเลขใบเสร็จ
  const invoiceNumber = invoices.nextDocumentNumber(db, apartmentId, 'invoice', '2026-08-31')
  assert(invoiceNumber === 'I2026080003', `ได้ ${invoiceNumber}`)
})

check('ชนิดเอกสารที่ไม่รู้จักต้องเตือน', () => {
  throws(
    () => invoices.nextDocumentNumber(db, apartmentId, 'quotation', '2026-08-31'),
    'ชนิดเอกสาร',
    'ต้องกันชนิดที่ไม่รู้จัก'
  )
})

// -----------------------------------------------------
group('วันครบกำหนดชำระ')

check('ออกบิลหลังวันครบกำหนดของเดือนนี้ ให้เลื่อนไปเดือนหน้า', () => {
  assert(invoices.calculateDueDate('2026-08-31', 5) === '2026-09-05', 'ควรเป็น 2026-09-05')
})

check('ออกบิลก่อนวันครบกำหนดของเดือนนี้ ให้ครบกำหนดในเดือนเดียวกัน', () => {
  assert(invoices.calculateDueDate('2026-08-01', 5) === '2026-08-05', 'ควรเป็น 2026-08-05')
})

check('ข้ามปีได้ถูกต้อง', () => {
  assert(invoices.calculateDueDate('2026-12-20', 5) === '2027-01-05', 'ควรเป็น 2027-01-05')
})

check('วันครบกำหนดนอกช่วง 1-28 ต้องเตือน', () => {
  throws(() => invoices.calculateDueDate('2026-08-01', 31), '1-28', 'ต้องกันวันที่เกิน 28')
})

// กติกาจริงของหอ ผู้ใช้ระบุ 2026-08-10: "จ่ายไม่เกินวันที่ 10 ของเดือน"
// ออกบิล 01/03 → ครบกำหนด 10/03 (ตัวอย่างที่ผู้ใช้ยกมาเอง)
//
// ตรึงไว้เป็นเทสต์เพราะข้อนี้คือข้อสมมติสุดท้ายที่ค้างมาตลอดโปรเจกต์ ตอนนี้ยืนยันแล้ว
check('กติกาของหอ: ออกบิลต้นเดือน ครบกำหนดวันที่ 10 ของเดือนเดียวกัน', () => {
  assert(invoices.calculateDueDate('2026-03-01', 10) === '2026-03-10', 'ควรเป็น 2026-03-10')
  // ออกบิลปลายเดือนก่อนก็ยังได้วันที่ 10 ของเดือนที่ผู้เช่ากำลังจะอยู่
  assert(invoices.calculateDueDate('2026-02-25', 10) === '2026-03-10', 'ควรเป็น 2026-03-10')
  // วันสุดท้ายที่ยังไม่เลื่อน
  assert(invoices.calculateDueDate('2026-03-09', 10) === '2026-03-10', 'ควรเป็น 2026-03-10')
  // ออกบิลวันที่ 10 พอดี = วันครบกำหนดผ่านไปแล้ว จึงเลื่อนไปเดือนหน้า
  assert(invoices.calculateDueDate('2026-03-10', 10) === '2026-04-10', 'ควรเป็น 2026-04-10')
})

// -----------------------------------------------------
group('ประกอบรายการในบิล')

const built = invoices.buildInvoiceItems(db, {
  contractId: contract1.contractId,
  billingMonth: '2026-08',
  meterBatchId: batch.batchId
})

check('มีค่าเช่า ค่าน้ำ ค่าไฟ และค่าบริการครบ', () => {
  const types = built.items.map((i) => i.itemType)
  assert(types.includes('rent'), 'ต้องมีค่าเช่า')
  assert(types.includes('water'), 'ต้องมีค่าน้ำ')
  assert(types.includes('electricity'), 'ต้องมีค่าไฟ')
  assert(types.filter((t) => t === 'service').length === 2, `ค่าบริการได้ ${types}`)
})

// ชื่อรายการเป็นไทยล้วน ไม่มีอังกฤษพ่วง (ผู้ใช้สั่ง 2026-08-08 — คอลัมน์แคบ อ่านยาก)
// และเดือนบนเอกสารเป็น พ.ศ. (ผู้ใช้สั่ง 2026-08-10) — ฐานข้อมูลยังเก็บ '2026-08' เหมือนเดิม
check('ค่าเช่าขึ้นเป็นไทยล้วน พร้อมเดือนแบบ MM-พ.ศ.', () => {
  const rent = built.items.find((i) => i.itemType === 'rent')
  assert(rent.description === 'ค่าเช่าห้อง (เดือน 08-2569)', `ได้ "${rent.description}"`)
  assert(rent.totalAmountCents === 500000, `ได้ ${rent.totalAmountCents}`)
})

check('ไม่มีคำอังกฤษหลงเหลือในชื่อรายการใดเลย', () => {
  for (const item of built.items) {
    assert(!/[A-Za-z]/.test(item.description), `ยังมีอังกฤษอยู่: "${item.description}"`)
  }
})

// บิลค่าเช่าเดือนสิงหาคม → ค่าน้ำ-ค่าไฟเป็นของกรกฎาคม (เดือนก่อนหน้าเสมอ)
// ไม่ขึ้นกับว่าใบจดมิเตอร์ลงวันที่อะไร
check('ค่าน้ำคิดจากหน่วยที่จด พร้อมเดือนและเลขมิเตอร์ก่อน/หลัง', () => {
  const water = built.items.find((i) => i.itemType === 'water')
  assert(
    water.description === 'ค่าน้ำ (เดือน 07-2569) : 98 หน่วย (2 - 100)',
    `ได้ "${water.description}"`
  )
  assert(water.totalAmountCents === 98 * 2000, `ได้ ${water.totalAmountCents}`)
})

check('ค่าไฟคิดจากหน่วยที่จดเช่นกัน', () => {
  const elec = built.items.find((i) => i.itemType === 'electricity')
  assert(elec.totalAmountCents === 300 * 700, `ได้ ${elec.totalAmountCents}`)
  assert(elec.description.includes('(เดือน 07-2569)'), `ได้ "${elec.description}"`)
})

// -----------------------------------------------------
// บิลใบเดียวมีสองเดือนอยู่ในนั้น: ค่าเช่าเป็นของเดือนที่กำลังจะอยู่ ค่าน้ำ-ค่าไฟเป็นของ
// เดือนที่ผ่านไปแล้ว (ธรรมเนียมจริงของหอ — ผู้ใช้อธิบาย 2026-08-10)
group('เดือนของค่าน้ำ-ค่าไฟบนบิล')

// ยืนยันกับใบเสร็จจริงของหอแล้ว (2026-08-10): ออกวันที่ 1 ก.พ. → ค่าเช่า ก.พ. + ค่าน้ำ-ไฟ ม.ค.
//
// **คิดจากเดือนค่าเช่า ไม่ใช่จากวันจดมิเตอร์** — ผู้ใช้ไม่รู้ว่าหอจดมิเตอร์วันไหน
// แต่รู้แน่ว่าออกบิลวันที่ 1 เสมอ วันจดมิเตอร์จึงเป็นหลักยึดที่เชื่อไม่ได้
check('ค่าน้ำ-ค่าไฟเป็นของเดือนก่อนเดือนค่าเช่าเสมอ', () => {
  assert(invoices.utilityMonthOf('2026-02') === '2026-01', invoices.utilityMonthOf('2026-02'))
  assert(invoices.utilityMonthOf('2026-07') === '2026-06', invoices.utilityMonthOf('2026-07'))
})

check('ข้ามปีได้ถูกต้อง', () => {
  assert(invoices.utilityMonthOf('2027-01') === '2026-12', invoices.utilityMonthOf('2027-01'))
})

check('เดือนที่ส่งมาไม่ถูกต้องคืน null ไม่ใช่เดือนมั่วๆ', () => {
  for (const bad of ['', null, undefined, 'ไม่ใช่เดือน']) {
    assert(invoices.utilityMonthOf(bad) === null, `${bad} ควรได้ null`)
  }
})

// ออกบิลย้อนหลังก็ยังถูก — ตั้งเดือนค่าเช่าเป็นธันวาคม ค่าน้ำก็ต้องเป็นพฤศจิกายน
// ไม่ใช่ค้างเป็นเดือนของใบจดมิเตอร์ที่หยิบมาใช้
check('เปลี่ยนเดือนค่าเช่าแล้ว เดือนของค่าน้ำขยับตามไปด้วยเสมอ', () => {
  const other = invoices.buildInvoiceItems(db, {
    contractId: contract1.contractId,
    billingMonth: '2026-12',
    meterBatchId: batch.batchId
  })
  const rent = other.items.find((i) => i.itemType === 'rent')
  const water = other.items.find((i) => i.itemType === 'water')
  assert(rent.description.includes('(เดือน 12-2569)'), `ค่าเช่าได้ "${rent.description}"`)
  assert(water.description.includes('(เดือน 11-2569)'), `ค่าน้ำได้ "${water.description}"`)
})

// เคสจริงจากใบเสร็จของหอ: จดมิเตอร์วันที่ 28 แล้วออกบิลวันที่ 1 ของเดือนถัดไป
// กติกาเดิม (วันถัดจากวันจดมิเตอร์) จะได้เดือนค่าเช่าย้อนไปหนึ่งเดือนทุกครั้ง
check('จดมิเตอร์วันที่ 28 แล้วออกบิลเดือนถัดไป ค่าน้ำต้องเป็นเดือนที่จด', () => {
  const lateBatch = meter.createBatch(db, apartmentId, '2027-06-28')
  meter.saveBatchReadings(db, lateBatch.batchId, 'water', [
    { roomId: room1.roomId, roomNumber: '101', currentReading: 200 }
  ])

  const july = invoices.buildInvoiceItems(db, {
    contractId: contract1.contractId,
    billingMonth: '2027-07',
    meterBatchId: lateBatch.batchId
  })
  const rent = july.items.find((i) => i.itemType === 'rent')
  const water = july.items.find((i) => i.itemType === 'water')
  assert(rent.description.includes('(เดือน 07-2570)'), `ค่าเช่าได้ "${rent.description}"`)
  assert(water.description.includes('(เดือน 06-2570)'), `ค่าน้ำได้ "${water.description}"`)
})

check('ไม่ได้เลือกใบจดมิเตอร์ ก็ไม่เขียนเดือนมั่วลงไป', () => {
  const noMeter = invoices.buildInvoiceItems(db, {
    contractId: contract1.contractId,
    billingMonth: '2026-08'
  })
  const water = noMeter.items.find((i) => i.itemType === 'water')
  assert(!water.description.includes('เดือน'), `ได้ "${water.description}"`)
  assert(water.totalAmountCents === 0, `ได้ ${water.totalAmountCents}`)
})

check('ห้องที่ไม่ได้จดมิเตอร์ได้ 0 หน่วย ไม่ใช่บิลที่ขาดรายการ', () => {
  const other = invoices.buildInvoiceItems(db, {
    contractId: contract2.contractId,
    billingMonth: '2026-08',
    meterBatchId: batch.batchId
  })
  const water = other.items.find((i) => i.itemType === 'water')
  assert(water !== undefined, 'ต้องยังมีบรรทัดค่าน้ำ')
  assert(water.totalAmountCents === 0, `ได้ ${water.totalAmountCents}`)
})

check('ค่าบริการที่ติดธง VAT เท่านั้นที่ต้องเสียภาษี', () => {
  const wifiItem = built.items.find((i) => i.description === 'ค่าอินเทอร์เน็ต')
  const trashItem = built.items.find((i) => i.description === 'ค่าขยะ')
  assert(wifiItem.isTaxable === true, 'ค่าอินเทอร์เน็ตติดธง VAT ไว้')
  assert(trashItem.isTaxable === false, 'ค่าขยะไม่ได้ติดธง')
})

// ยืนยันกับบิลจริงของต้นแบบแล้ว: ค่าเช่ายกเว้น แต่ค่าน้ำ/ค่าไฟเสียภาษี
// (การให้เช่าอสังหาฯ ได้รับยกเว้น VAT ส่วนการขายน้ำ/ไฟเป็นการขายสินค้า)
check('ค่าเช่าได้รับยกเว้นเสมอ แม้หอจะเปิด VAT', () => {
  const rent = built.items.find((i) => i.itemType === 'rent')
  assert(rent.isTaxable === false, 'ค่าเช่าต้องไม่เสียภาษี')
})

check('ค่าน้ำและค่าไฟเสียภาษีเมื่อหอเปิด VAT', () => {
  for (const type of ['water', 'electricity']) {
    const item = built.items.find((i) => i.itemType === type)
    assert(item.isTaxable === true, `${type} ต้องเสียภาษี`)
  }
})

// -----------------------------------------------------
group('รวมยอด')

check('VAT บวกเพิ่มจากฐานภาษี ไม่ใช่รวมอยู่ในราคาแล้ว', () => {
  const totals = invoices.calculateInvoiceTotals(built.items, 7)
  // ยกเว้น: ค่าเช่า 5,000 + ค่าขยะ 50 (ไม่ได้ติดธง VAT) = 5,050
  assert(totals.exemptAmountCents === 505000, `exempt ได้ ${totals.exemptAmountCents}`)
  // ฐานภาษี: น้ำ 1,960 + ไฟ 2,100 + เน็ต 300 = 4,360
  assert(totals.taxableAmountCents === 436000, `taxable ได้ ${totals.taxableAmountCents}`)
  // VAT 7%: 137.20 + 147.00 + 21.00 = 305.20
  assert(totals.vatAmountCents === 30520, `vat ได้ ${totals.vatAmountCents}`)
  assert(totals.totalAmountCents === 971520, `total ได้ ${totals.totalAmountCents}`)
})

check('ส่วนลดที่เป็นยอดติดลบลดยอดรวมได้เอง', () => {
  const totals = invoices.calculateInvoiceTotals([
    { totalAmountCents: 100000, isTaxable: false },
    { totalAmountCents: -30000, isTaxable: false }
  ])
  assert(totals.totalAmountCents === 70000, `ได้ ${totals.totalAmountCents}`)
})

// -----------------------------------------------------
group('ออกบิลรายเดือน')

const invoice1 = invoices.createMonthlyInvoice(db, {
  contractId: contract1.contractId,
  billingMonth: '2026-08',
  meterBatchId: batch.batchId,
  issueDate: '2026-08-31'
})

check('ได้เลขที่ วันครบกำหนด และสถานะค้างชำระ', () => {
  assert(invoice1.invoiceNumber.startsWith('I202608'), `ได้ ${invoice1.invoiceNumber}`)
  assert(invoice1.dueDate === '2026-09-05', `ได้ ${invoice1.dueDate}`)
  assert(invoice1.status === 'unpaid', `ได้ ${invoice1.status}`)
  assert(invoice1.invoiceType === 'monthly', `ได้ ${invoice1.invoiceType}`)
})

check('ยอดบนหัวบิลตรงกับผลรวมของรายการ', () => {
  assert(invoice1.totalAmountCents === 971520, `ได้ ${invoice1.totalAmountCents}`)
  assert(invoice1.outstandingCents === 971520, 'ยังไม่จ่ายเลย ต้องค้างเต็มจำนวน')
  assert(invoice1.paidAmountCents === 0, `ได้ ${invoice1.paidAmountCents}`)
})

// **ปี พ.ศ. อยู่แค่ข้อความบนเอกสาร ฐานข้อมูลยังเป็น ค.ศ. ทั้งหมด** (ผู้ใช้สั่ง 2026-08-10)
//
// ถ้าวันหนึ่งมีใครเผลอเก็บ พ.ศ. ลงคอลัมน์จริง การเทียบวันที่จะพังทั้งระบบ — ช่วงวันที่
// ในการค้นหา ลำดับใบเสร็จ วันครบกำหนด ค่าปรับ ล้วนเทียบข้อความ 'YYYY-MM-DD' ตรงๆ
// และแถวเก่ากับแถวใหม่จะแยกไม่ออกว่าเป็นปีระบบไหน
check('ฐานข้อมูลเก็บวันที่และเดือนเป็น ค.ศ. แต่ข้อความบนเอกสารเป็น พ.ศ.', () => {
  const row = db
    .prepare('SELECT billing_month, issue_date, due_date FROM invoices WHERE invoice_id = ?')
    .get(invoice1.invoiceId)
  assert(row.billing_month === '2026-08', `เก็บเดือนเป็น ${row.billing_month}`)
  assert(row.issue_date.startsWith('2026-'), `เก็บวันที่ออกบิลเป็น ${row.issue_date}`)
  assert(row.due_date.startsWith('2026-'), `เก็บวันครบกำหนดเป็น ${row.due_date}`)

  const rent = invoice1.items.find((i) => i.itemType === 'rent')
  assert(rent.description.includes('08-2569'), `ข้อความบนบิลได้ "${rent.description}"`)
})

check('บิลจำวันที่จดมิเตอร์ที่ใช้ออก และแนบข้อมูลหอไปให้หน้าพิมพ์', () => {
  assert(invoice1.meterBatchId === batch.batchId, 'ต้องผูกกับใบจดมิเตอร์')
  assert(invoice1.apartment.name === 'หอทดสอบออกบิล', `ได้ ${invoice1.apartment.name}`)
  assert(invoice1.roomNumber === '101', `ได้ ${invoice1.roomNumber}`)
})

// ใบแจ้งหนี้ที่ยื่นให้คนหนึ่งต้องมีชื่อคนนั้นอยู่บนนั้น
check('บิลแนบชื่อผู้เช่าไปด้วย ผู้เช่าหลักมาก่อน', () => {
  assert(invoice1.tenants.length >= 1, `ได้ ${invoice1.tenants.length} คน`)
  assert(invoice1.tenants[0].isPrimary === true, 'ผู้เช่าหลักต้องอยู่ตัวแรก')
  assert(invoice1.tenants[0].fullName === 'สมชาย ทดสอบ', `ได้ ${invoice1.tenants[0].fullName}`)
  assert(invoice1.tenants[0].phone === '0812345678', `ได้ ${invoice1.tenants[0].phone}`)
})

check('หอที่ปิดการแสดงข้อมูลผู้เช่า ต้องไม่ส่งชื่อออกไปเลย', () => {
  const db2 = db
  db2
    .prepare('UPDATE apartments SET show_tenant_info_in_invoice = 0 WHERE apartment_id = ?')
    .run(apartmentId)
  const hidden = invoices.getInvoiceById(db2, invoice1.invoiceId)
  assert(hidden.tenants.length === 0, `ยังส่งมา ${hidden.tenants.length} คน`)

  db2
    .prepare('UPDATE apartments SET show_tenant_info_in_invoice = 1 WHERE apartment_id = ?')
    .run(apartmentId)
})

// ผู้เช่าที่ได้รับบิลต้องโอนเงินได้ทันทีโดยไม่ต้องถามว่าโอนเข้าบัญชีไหน
check('บิลแนบบัญชีธนาคารและข้อความแจ้งชำระไปด้วย บัญชีหลักมาก่อน', () => {
  assert(invoice1.bankAccounts.length === 2, `ได้ ${invoice1.bankAccounts.length} บัญชี`)
  assert(invoice1.bankAccounts[0].isDefault === true, 'บัญชีหลักต้องอยู่บนสุด')
  assert(invoice1.bankAccounts[0].accountNumber === '1234567890', `ได้ ${invoice1.bankAccounts[0].accountNumber}`)
  assert(
    invoice1.apartment.paymentInstructions === 'โอนแล้วส่งสลิปมาที่ไลน์ @dormy',
    `ได้ ${invoice1.apartment.paymentInstructions}`
  )
})

check('ออกบิลเดือนเดิมซ้ำไม่ได้ และต้องบอกเลขใบเดิม', () => {
  throws(
    () =>
      invoices.createMonthlyInvoice(db, {
        contractId: contract1.contractId,
        billingMonth: '2026-08',
        meterBatchId: batch.batchId,
        issueDate: '2026-08-31'
      }),
    invoice1.invoiceNumber,
    'ต้องบอกว่าใบไหนออกไปแล้ว'
  )
})

check('ไม่เลือกใบจดมิเตอร์ออกบิลรายเดือนไม่ได้', () => {
  throws(
    () =>
      invoices.createMonthlyInvoice(db, {
        contractId: contract2.contractId,
        billingMonth: '2026-08',
        issueDate: '2026-08-31'
      }),
    'ใบจดมิเตอร์',
    'ต้องบังคับให้เลือกใบจด'
  )
})

check('เดือนที่ออกบิลผิดรูปแบบไม่ผ่าน', () => {
  throws(
    () =>
      invoices.createMonthlyInvoice(db, {
        contractId: contract2.contractId,
        billingMonth: 'สิงหาคม',
        meterBatchId: batch.batchId,
        issueDate: '2026-08-31'
      }),
    'YYYY-MM',
    'ต้องบังคับรูปแบบเดือน'
  )
})

// -----------------------------------------------------
group('ราคาค่าบริการถูกตรึงไว้ที่สัญญา')

check('ขึ้นราคากลางแล้วบิลรอบถัดไปยังคิดราคาเดิมของสัญญา', () => {
  services.updateService(db, wifi.serviceId, {
    name: 'ค่าอินเทอร์เน็ต',
    price: '900',
    isVatEnabled: true
  })

  const next = invoices.buildInvoiceItems(db, {
    contractId: contract1.contractId,
    billingMonth: '2026-09',
    meterBatchId: batch.batchId
  })
  const wifiItem = next.items.find((i) => i.description === 'ค่าอินเทอร์เน็ต')
  assert(wifiItem.totalAmountCents === 30000, `ได้ ${wifiItem.totalAmountCents} ควรยังเป็น 300 บาท`)
})

// -----------------------------------------------------
group('พรีวิวและออกบิลทั้งหอ')

check('พรีวิวคืนทุกห้องที่มีสัญญา และบอกว่าห้องไหนออกบิลไปแล้ว', () => {
  const preview = invoices.previewMonthlyBilling(db, {
    apartmentId,
    meterBatchId: batch.batchId,
    billingMonth: '2026-08'
  })
  assert(preview.length === 2, `ได้ ${preview.length} ห้อง`)
  const r101 = preview.find((p) => p.roomNumber === '101')
  const r102 = preview.find((p) => p.roomNumber === '102')
  assert(r101.existingInvoiceNumber === invoice1.invoiceNumber, 'ห้อง 101 ออกไปแล้ว')
  assert(r102.existingInvoiceId === null, 'ห้อง 102 ยังไม่ออก')
  assert(r101.waterUnits === 98, `ได้ ${r101.waterUnits}`)
})

check('ยอดในพรีวิวตรงกับบิลที่ออกจริง', () => {
  const preview = invoices.previewMonthlyBilling(db, {
    apartmentId,
    meterBatchId: batch.batchId,
    billingMonth: '2026-08'
  })
  const r101 = preview.find((p) => p.roomNumber === '101')
  assert(
    r101.totalAmountCents === invoice1.totalAmountCents,
    `พรีวิว ${r101.totalAmountCents} แต่บิลจริง ${invoice1.totalAmountCents}`
  )
})

check('กดสร้างทุกห้องแล้วข้ามห้องที่ออกไปแล้ว ไม่ล้มทั้งชุด', () => {
  const result = invoices.createMonthlyInvoicesForApartment(db, {
    apartmentId,
    meterBatchId: batch.batchId,
    billingMonth: '2026-08',
    issueDate: '2026-08-31'
  })
  assert(result.created.length === 1, `สร้างได้ ${result.created.length} ใบ`)
  assert(result.created[0].roomNumber === '102', `ได้ห้อง ${result.created[0].roomNumber}`)
  assert(result.skipped.length === 1, `ข้าม ${result.skipped.length} ใบ`)
  assert(result.failed.length === 0, `พัง ${JSON.stringify(result.failed)}`)
})

check('กดซ้ำอีกรอบไม่สร้างอะไรเพิ่ม', () => {
  const again = invoices.createMonthlyInvoicesForApartment(db, {
    apartmentId,
    meterBatchId: batch.batchId,
    billingMonth: '2026-08',
    issueDate: '2026-08-31'
  })
  assert(again.created.length === 0, `สร้างเพิ่ม ${again.created.length} ใบ`)
  assert(again.skipped.length === 2, `ข้าม ${again.skipped.length} ใบ`)
})

// -----------------------------------------------------
group('แก้ไขบิลที่ออกไปแล้ว')

check('เพิ่มค่าบริการเข้าบิลแล้วยอดรวมถูกคิดใหม่', () => {
  const updated = invoices.addInvoiceItem(db, invoice1.invoiceId, {
    itemType: 'other',
    description: 'ค่าซ่อมประตู',
    amount: '500'
  })
  assert(updated.totalAmountCents === 971520 + 50000, `ได้ ${updated.totalAmountCents}`)
  assert(updated.items.length === 6, `ได้ ${updated.items.length} รายการ`)
})

check('ส่วนลดเก็บเป็นยอดติดลบ แม้ผู้ใช้กรอกเป็นจำนวนบวก', () => {
  const updated = invoices.addInvoiceItem(db, invoice1.invoiceId, {
    itemType: 'discount',
    description: 'ส่วนลดจ่ายตรงเวลา',
    amount: '100'
  })
  const discount = updated.items.find((i) => i.itemType === 'discount')
  assert(discount.totalAmountCents === -10000, `ได้ ${discount.totalAmountCents}`)
  assert(updated.totalAmountCents === 971520 + 50000 - 10000, `ได้ ${updated.totalAmountCents}`)
})

check('เพิ่มรายการที่เสียภาษีแล้ว VAT ถูกคิดเพิ่มด้วย', () => {
  const before = invoices.getInvoiceById(db, invoice1.invoiceId)
  const after = invoices.addInvoiceItem(db, invoice1.invoiceId, {
    itemType: 'service',
    description: 'ค่าบริการพิเศษ',
    amount: '1000',
    isTaxable: true
  })
  assert(
    after.vatAmountCents === before.vatAmountCents + 7000,
    `VAT ${before.vatAmountCents} → ${after.vatAmountCents}`
  )
  assert(after.totalAmountCents === before.totalAmountCents + 100000 + 7000, 'ยอดรวมต้องรวม VAT')
})

check('ลบรายการแล้วยอดรวมกลับมาถูก', () => {
  const before = invoices.getInvoiceById(db, invoice1.invoiceId)
  const special = before.items.find((i) => i.description === 'ค่าบริการพิเศษ')
  const after = invoices.removeInvoiceItem(db, invoice1.invoiceId, special.invoiceItemId)
  assert(after.totalAmountCents === 971520 + 50000 - 10000, `ได้ ${after.totalAmountCents}`)
})

check('ลบรายการที่ไม่ได้อยู่ในบิลใบนั้นต้องเตือน', () => {
  throws(
    () => invoices.removeInvoiceItem(db, invoice1.invoiceId, 9999),
    'ไม่พบรายการ',
    'ต้องเตือน'
  )
})

check('ชนิดรายการที่ไม่รู้จักไม่ผ่าน', () => {
  throws(
    () =>
      invoices.addInvoiceItem(db, invoice1.invoiceId, {
        itemType: 'bribe',
        description: 'x',
        amount: '1'
      }),
    'ชนิดรายการ',
    'ต้องกันชนิดที่ไม่รู้จัก'
  )
})

// -----------------------------------------------------
group('ยกเลิกบิล')

// เหตุผลบังคับกรอก (ผู้ใช้สั่ง 2026-08-11) เหมือนที่ลบใบแจ้งหนี้และยกเลิกใบเสร็จบังคับไว้
// — ยกเลิกบิลทำให้ยอดหนี้ของห้องนั้นหายไปจากรายการค้างชำระ หนักพอกันกับการลบ
check('ยกเลิกโดยไม่บอกเหตุผลไม่ได้', () => {
  throws(
    () => invoices.cancelInvoice(db, invoice1.invoiceId, { reason: '  ', cancelledBy: staffUser.user_id }),
    'เหตุผล',
    'ต้องบังคับเหตุผล'
  )
  // ไม่ส่งอะไรมาเลย (ผู้เรียกแบบเก่า) ก็ต้องไม่ผ่าน ไม่ใช่ยกเลิกได้เงียบๆ
  throws(() => invoices.cancelInvoice(db, invoice1.invoiceId), 'เหตุผล', 'ต้องบังคับเหตุผล')
})

check('ไม่รู้ว่าใครยกเลิกก็ยกเลิกไม่ได้', () => {
  throws(
    () => invoices.cancelInvoice(db, invoice1.invoiceId, { reason: 'ออกผิดห้อง' }),
    'ผู้ยกเลิก',
    'ต้องรู้ว่าใครเป็นคนยกเลิก'
  )
})

check('ยกเลิกแล้วสถานะเปลี่ยน และจำเวลา/เหตุผล/ผู้ยกเลิกไว้', () => {
  const cancelled = invoices.cancelInvoice(db, invoice1.invoiceId, {
    reason: 'ออกบิลผิดห้อง',
    cancelledBy: staffUser.user_id
  })
  assert(cancelled.status === 'cancelled', `ได้ ${cancelled.status}`)
  assert(cancelled.cancelledAt !== null, 'ต้องบันทึกเวลายกเลิก')
  assert(cancelled.cancelReason === 'ออกบิลผิดห้อง', `ได้ ${cancelled.cancelReason}`)
  assert(cancelled.cancelledByName === staffUser.full_name, `ได้ ${cancelled.cancelledByName}`)
})

check('ยกเลิกซ้ำไม่ได้', () => {
  throws(
    () =>
      invoices.cancelInvoice(db, invoice1.invoiceId, {
        reason: 'ยกเลิกอีกรอบ',
        cancelledBy: staffUser.user_id
      }),
    'ยกเลิกไปแล้ว',
    'ต้องเตือน'
  )
})

check('แก้ไขบิลที่ยกเลิกแล้วไม่ได้', () => {
  throws(
    () =>
      invoices.addInvoiceItem(db, invoice1.invoiceId, {
        itemType: 'other',
        description: 'x',
        amount: '1'
      }),
    'ยกเลิก',
    'ต้องกันการแก้บิลที่ยกเลิกแล้ว'
  )
})

check('ยกเลิกแล้วออกบิลเดือนเดิมใหม่ได้ และได้เลขใบใหม่', () => {
  const reissued = invoices.createMonthlyInvoice(db, {
    contractId: contract1.contractId,
    billingMonth: '2026-08',
    meterBatchId: batch.batchId,
    issueDate: '2026-08-31'
  })
  assert(reissued.invoiceNumber !== invoice1.invoiceNumber, 'ต้องเป็นเลขใหม่ ไม่ใช้เลขเดิมซ้ำ')
  assert(reissued.status === 'unpaid', `ได้ ${reissued.status}`)
})

// -----------------------------------------------------
// เจ้าของหอที่ไม่ได้ติ๊ก "เปิดการใช้งาน VAT" ต้องไม่เจอ VAT บนบิลจากทางไหนเลย
group('หอที่ปิด VAT')

const plainApartment = apartments.insertApartment(db, {
  nameTh: 'หอไม่จด VAT',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isVatEnabled: false
})
const plainId = plainApartment.apartmentId

utility.saveUtilityDefaults(db, plainId, {
  water: { enabled: true, billingType: 'actual', unitPrice: '20' },
  electric: { enabled: true, billingType: 'actual', unitPrice: '7' }
})
rooms.generateFloorPlan(db, plainId, [{ roomCount: 1 }])
const plainRoom = rooms.listFloors(db, plainId)[0].rooms[0]
rooms.setRoomRates(db, [plainRoom.roomId], { monthlyRent: '4000' })

// ค่าบริการตัวนี้ติดธง "คำนวณ VAT" ไว้ แต่หอไม่ได้เปิด VAT — ธงต้องไม่มีผล
const plainWifi = services.insertService(db, plainId, {
  name: 'ค่าอินเทอร์เน็ต',
  price: '300',
  isVatEnabled: true
})
rooms.attachServicesToRooms(db, [plainRoom.roomId], [plainWifi.serviceId])

const plainTenant = tenants.insertTenant(db, {
  firstName: 'สมศักดิ์',
  lastName: 'ทดสอบ',
  phone: '0861112222'
})
const plainContract = contracts.createContract(db, {
  roomId: plainRoom.roomId,
  rentType: 'monthly',
  startDate: '2026-07-01',
  rentAmount: '4000',
  deposit: '4000',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [plainTenant.tenantId],
  createdBy: staffUser.user_id
})
const plainBatch = meter.createBatch(db, plainId, '2026-08-31')

const plainInvoice = invoices.createMonthlyInvoice(db, {
  contractId: plainContract.contractId,
  billingMonth: '2026-08',
  meterBatchId: plainBatch.batchId,
  issueDate: '2026-08-31'
})

check('ค่าบริการที่ติดธง VAT ไว้ ไม่ถูกคิดภาษีเมื่อหอปิด VAT', () => {
  assert(plainInvoice.vatAmountCents === 0, `ได้ VAT ${plainInvoice.vatAmountCents}`)
  assert(plainInvoice.taxableAmountCents === 0, `ได้ฐานภาษี ${plainInvoice.taxableAmountCents}`)
})

check('ยอดรวมเท่ากับผลบวกของรายการตรงๆ ไม่มีอะไรบวกเพิ่ม', () => {
  // เช่า 4000 + น้ำ 0 + ไฟ 0 + เน็ต 300 = 4300
  assert(plainInvoice.totalAmountCents === 430000, `ได้ ${plainInvoice.totalAmountCents}`)
  assert(plainInvoice.exemptAmountCents === 430000, `ได้ ${plainInvoice.exemptAmountCents}`)
})

check('ทุกบรรทัดมีอัตราภาษีเป็นศูนย์ หน้าพิมพ์จึงไม่มีอะไรให้แสดง', () => {
  assert(
    plainInvoice.items.every((i) => i.vatRate === 0 && i.vatAmountCents === 0),
    'ต้องไม่มีบรรทัดไหนติดภาษี'
  )
})

check('บิลบอกหน้าจอได้ว่าหอนี้ไม่ต้องแสดงแถว VAT', () => {
  assert(plainInvoice.isVatEnabled === false, 'หอปิด VAT')
  const vatDorm = invoices.getInvoiceById(db, invoice1.invoiceId)
  assert(vatDorm.isVatEnabled === true, 'หอที่เปิด VAT ต้องยังแสดงแถว')
})

check('เพิ่มรายการเองแล้วสั่งให้เสียภาษี ก็ยังต้องไม่มี VAT เมื่อหอปิดไว้', () => {
  const updated = invoices.addInvoiceItem(db, plainInvoice.invoiceId, {
    itemType: 'service',
    description: 'ค่าบริการพิเศษ',
    amount: '1000',
    isTaxable: true
  })
  assert(updated.vatAmountCents === 0, `ได้ VAT ${updated.vatAmountCents}`)
  assert(updated.totalAmountCents === 430000 + 100000, `ได้ ${updated.totalAmountCents}`)
})

// -----------------------------------------------------
// ลบบิลที่ยกเลิกแล้วออกจากระบบ พร้อมเหตุผลที่บังคับกรอก (ผู้ใช้สั่ง 2026-08-07)
group('ลบใบแจ้งหนี้')

check('บิลที่ยังไม่ยกเลิก ลบไม่ได้', () => {
  const live = invoices.listInvoices(db, apartmentId, { status: 'unpaid' })[0]
  throws(
    () => invoices.deleteInvoice(db, live.invoiceId, { reason: 'x', deletedBy: staffUser.user_id }),
    'ยกเลิกบิลก่อน',
    'ต้องบังคับให้ยกเลิกก่อนลบ'
  )
})

check('ไม่กรอกเหตุผล ลบไม่ได้', () => {
  throws(
    () => invoices.deleteInvoice(db, invoice1.invoiceId, { reason: '   ', deletedBy: staffUser.user_id }),
    'เหตุผลในการลบ',
    'เหตุผลต้องบังคับเสมอ'
  )
})

check('ไม่รู้ว่าใครลบ ก็ลบไม่ได้', () => {
  throws(
    () => invoices.deleteInvoice(db, invoice1.invoiceId, { reason: 'ออกซ้ำ' }),
    'ผู้ลบ',
    'ต้องรู้ว่าใครเป็นคนลบ'
  )
})

check('ลบแล้วใบและรายการในใบหายไปจากระบบ', () => {
  const itemsBefore = db
    .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?')
    .get(invoice1.invoiceId).n
  assert(itemsBefore > 0, 'ควรมีรายการอยู่ก่อนลบ')

  invoices.deleteInvoice(db, invoice1.invoiceId, {
    reason: 'ออกบิลผิดห้อง',
    deletedBy: staffUser.user_id
  })

  assert(invoices.getInvoiceById(db, invoice1.invoiceId) === null, 'ใบต้องหายไป')
  const itemsAfter = db
    .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?')
    .get(invoice1.invoiceId).n
  assert(itemsAfter === 0, `เหลือรายการค้างอยู่ ${itemsAfter} แถว`)
})

check('เหตุผลถูกเก็บไว้ในประวัติการลบ ไม่ได้หายไปพร้อมใบ', () => {
  const history = invoices.listInvoiceDeletions(db, apartmentId)
  assert(history.length === 1, `ได้ ${history.length} รายการ`)
  assert(history[0].invoiceNumber === invoice1.invoiceNumber, `ได้ ${history[0].invoiceNumber}`)
  assert(history[0].reason === 'ออกบิลผิดห้อง', `ได้ ${history[0].reason}`)
  assert(history[0].deletedByName === 'ผู้จัดการหอ', `ได้ ${history[0].deletedByName}`)
  assert(history[0].roomNumber === '101', `ได้ ${history[0].roomNumber}`)
})

check('เลขที่ของใบที่ถูกลบไม่ถูกนำมาใช้ซ้ำ', () => {
  // เดือน 08 ของห้องนี้มีใบที่ยังใช้งานอยู่แล้ว จึงออกของเดือนอื่นแทน
  // (ตัวนับเลขที่นับตามเดือนของ "วันที่ออกบิล" ไม่ใช่รอบเดือน จึงยังอยู่ชุด 202608 เหมือนกัน)
  const reissued = invoices.createMonthlyInvoice(db, {
    contractId: contract1.contractId,
    billingMonth: '2026-10',
    meterBatchId: batch.batchId,
    issueDate: '2026-08-31'
  })
  assert(
    reissued.invoiceNumber !== invoice1.invoiceNumber,
    `ใช้เลขซ้ำกับใบที่ลบไปแล้ว: ${reissued.invoiceNumber}`
  )
  invoices.cancelInvoice(db, reissued.invoiceId, {
    reason: 'เตรียมใบนี้ไว้ทดสอบการลบต่อ',
    cancelledBy: staffUser.user_id
  })
})

check('ลบใบที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(
    () => invoices.deleteInvoice(db, 9999, { reason: 'x', deletedBy: staffUser.user_id }),
    'ไม่พบใบแจ้งหนี้',
    'ต้องแจ้งเตือน'
  )
})

// -----------------------------------------------------
group('รายการบิล')

check('รายการบิลของหอไม่นับใบที่ยกเลิกออกจากยอดค้าง', () => {
  const unpaid = invoices.listInvoices(db, apartmentId, { status: 'unpaid' })
  assert(unpaid.length === 2, `ได้ ${unpaid.length} ใบ`)
  assert(
    unpaid.every((i) => i.outstandingCents === i.totalAmountCents),
    'ยังไม่มีการชำระ ยอดค้างต้องเท่ายอดรวม'
  )
})

check('กรองตามเลขห้องได้', () => {
  const filtered = invoices.listInvoices(db, apartmentId, { roomNumber: '102' })
  assert(filtered.length === 1, `ได้ ${filtered.length} ใบ`)
  assert(filtered[0].roomNumber === '102', `ได้ห้อง ${filtered[0].roomNumber}`)
})

check('กรองตามเลขที่ใบแจ้งหนี้แบบบางส่วนได้', () => {
  const all = invoices.listInvoices(db, apartmentId)
  const target = all[0]
  const filtered = invoices.listInvoices(db, apartmentId, {
    invoiceNumber: target.invoiceNumber.slice(-4)
  })
  assert(
    filtered.some((i) => i.invoiceNumber === target.invoiceNumber),
    `หาไม่เจอ ${target.invoiceNumber}`
  )
})

// ค้นหาตามวันที่ออกบิล (ผู้ใช้สั่ง 2026-08-07) — ใส่ข้างเดียวก็ต้องทำงาน
group('ค้นหาตามวันที่ออกบิล')

check('ระบุแต่วันเริ่ม = ตั้งแต่วันนั้นเป็นต้นไป', () => {
  const from = invoices.listInvoices(db, apartmentId, { dateFrom: '2026-08-31' })
  assert(from.length > 0, 'ควรเจอบิลที่ออกวันที่ 31 ส.ค.')
  assert(
    from.every((i) => i.issueDate >= '2026-08-31'),
    'มีใบที่ออกก่อนวันเริ่มหลุดมา'
  )
})

check('ระบุแต่วันสิ้นสุด = ถึงวันนั้น', () => {
  const to = invoices.listInvoices(db, apartmentId, { dateTo: '2026-08-30' })
  assert(to.length === 0, `ไม่ควรมีบิลที่ออกก่อน 30 ส.ค. แต่ได้ ${to.length} ใบ`)
})

check('ระบุทั้งช่วง และวันขอบทั้งสองข้างต้องนับรวมด้วย', () => {
  const range = invoices.listInvoices(db, apartmentId, {
    dateFrom: '2026-08-31',
    dateTo: '2026-08-31'
  })
  assert(range.length > 0, 'วันเดียวกันทั้งเริ่มและจบ ต้องเจอบิลของวันนั้น')
  assert(
    range.every((i) => i.issueDate === '2026-08-31'),
    'มีใบวันอื่นหลุดมา'
  )
})

check('ช่วงวันที่กลับหัวได้ผลลัพธ์ว่าง ไม่ใช่ error', () => {
  const none = invoices.listInvoices(db, apartmentId, {
    dateFrom: '2026-09-01',
    dateTo: '2026-08-01'
  })
  assert(none.length === 0, `ได้ ${none.length} ใบ`)
})

check('วันที่รวมกับเงื่อนไขอื่นได้', () => {
  const combined = invoices.listInvoices(db, apartmentId, {
    dateFrom: '2026-08-01',
    roomNumber: '102'
  })
  assert(combined.length === 1, `ได้ ${combined.length} ใบ`)
  assert(combined[0].roomNumber === '102', `ได้ห้อง ${combined[0].roomNumber}`)
})

// -----------------------------------------------------
// 🔴 บั๊กที่เจอจริง 2026-08-10 (หอพักประตู 5): ออกบิลได้ห้องเดียวจากสามห้อง
// ที่เหลือล้มด้วย UNIQUE constraint failed: invoices.invoice_number
//
// ต้นเหตุ: document_counters เดินเลขแยกรายหอ แต่ unique index บังคับไม่ซ้ำทั้งฐานข้อมูล
// หอที่สองจึงเริ่มนับ 0001 ใหม่แล้วไปชนเลขของหอแรกในงวดเดียวกัน (migration 021)
group('เลขที่เอกสารของสองหอในงวดเดียวกัน')

const rivalApartment = apartments.insertApartment(db, {
  nameTh: 'หอที่สองในงวดเดียวกัน',
  addressTh: 'ที่อยู่',
  dueDateDay: 10,
  lateFeePerDay: '0'
})
const rivalId = rivalApartment.apartmentId
utility.saveUtilityDefaults(db, rivalId, {
  water: { enabled: false },
  electric: { enabled: false }
})
rooms.generateFloorPlan(db, rivalId, [{ roomCount: 2 }])
const rivalRooms = rooms.listFloors(db, rivalId)[0].rooms
rooms.setRoomRates(
  db,
  rivalRooms.map((r) => r.roomId),
  { monthlyRent: '3000' }
)

const rivalContracts = rivalRooms.map((room, index) => {
  const person = tenants.insertTenant(db, {
    firstName: `ผู้เช่าหอสอง${index + 1}`,
    lastName: 'ทดสอบ',
    phone: `0810000${index + 1}00`
  })
  return contracts.createContract(db, {
    roomId: room.roomId,
    rentType: 'monthly',
    startDate: '2026-07-01',
    rentAmount: '3000',
    deposit: '0',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    waterMeterStart: 0,
    electricMeterStart: 0,
    tenants: [person.tenantId],
    // ค่าเช่าเดือนแรกออกเป็นใบเสร็จตอนทำสัญญา จึงต้องมีผู้รับเงิน
    createdBy: staffUser.user_id
  })
})

const rivalBatch = meter.createBatch(db, rivalId, '2026-08-31')

check('หอที่สองออกบิลงวดเดียวกับหอแรกได้ ไม่ชนเลขที่กัน', () => {
  const made = rivalContracts.map((contract) =>
    invoices.createMonthlyInvoice(db, {
      contractId: contract.contractId,
      billingMonth: '2026-08',
      meterBatchId: rivalBatch.batchId,
      issueDate: '2026-08-31'
    })
  )
  assert(made.length === 2, `ออกได้ ${made.length} ใบ`)
  // เลขของแต่ละหอเริ่มที่ 0001 ของตัวเอง ไม่ใช่เดินต่อจากหออื่น
  assert(made[0].invoiceNumber.endsWith('0001'), `ได้ ${made[0].invoiceNumber}`)
  assert(made[1].invoiceNumber.endsWith('0002'), `ได้ ${made[1].invoiceNumber}`)
})

// ด่านสุดท้ายต้องอยู่ที่ฐานข้อมูล ไม่ใช่พึ่งตัวนับอย่างเดียว — เอกสารการเงินที่เลขซ้ำกัน
// ในหอเดียวกันคือสิ่งที่ฐานข้อมูลต้องปฏิเสธเอง ไม่ว่าโค้ดข้างบนจะพลาดยังไง
// ใช้เดือนไกลๆ ที่ยังไม่มีใครออกบิล เพราะยังมี partial unique index อีกอันคุมว่า
// หนึ่งสัญญาออกบิลรายเดือนได้เดือนละใบ — ข้อนี้กำลังทดสอบเรื่อง "เลขที่" ไม่ใช่เรื่องนั้น
const insertRaw = (contractId, apartmentIdOfRow, number, month) =>
  db
    .prepare(
      `INSERT INTO invoices (contract_id, apartment_id, invoice_number, billing_month,
                             issue_date, due_date, status, invoice_type,
                             exempt_amount_cents, taxable_amount_cents,
                             vat_amount_cents, total_amount_cents, created_at)
       VALUES (?, ?, ?, ?, '2029-01-01', '2029-01-10', 'unpaid', 'monthly',
               0, 0, 0, 0, '2029-01-01T00:00:00.000Z')`
    )
    .run(contractId, apartmentIdOfRow, number, month)

check('เลขที่เดียวกันอยู่คนละหอได้ — นี่คือสิ่งที่บั๊กเดิมไม่ยอม', () => {
  const theirNumber = invoices.listInvoices(db, rivalId)[0].invoiceNumber
  const written = insertRaw(contract1.contractId, apartmentId, theirNumber, '2029-01')
  assert(written.changes === 1, 'หอแรกต้องใช้เลขเดียวกันกับหอที่สองได้')
  db.prepare('DELETE FROM invoices WHERE invoice_id = ?').run(written.lastInsertRowid)
})

check('เลขที่ซ้ำในหอเดียวกัน ฐานข้อมูลต้องปฏิเสธ', () => {
  const theirNumber = invoices.listInvoices(db, rivalId)[0].invoiceNumber
  throws(
    () => insertRaw(rivalContracts[0].contractId, rivalId, theirNumber, '2029-02'),
    'UNIQUE',
    'หอเดียวกันต้องออกเลขซ้ำไม่ได้'
  )
})


// -----------------------------------------------------
// ตัวกรอง "ค้างชำระ / ชำระแล้ว" บนหน้าใบแจ้งหนี้ (ผู้ใช้สั่ง 2026-08-09)
group('กรองตามการชำระ')

const payments = await import('../src/main/db/payments.js')

// ทำให้มีครบทั้งสามแบบในหอเดียว: จ่ายครบ / จ่ายบางส่วน / ยกเลิก
const [toPayFull, toPayPartial] = invoices.listInvoices(db, apartmentId, { status: 'unpaid' })

payments.recordInvoicePayment(db, {
  invoiceId: toPayFull.invoiceId,
  amount: String(toPayFull.totalAmountCents / 100),
  paymentMethod: 'cash',
  paymentDate: '2026-09-05',
  createdBy: staffUser.user_id
})
payments.recordInvoicePayment(db, {
  invoiceId: toPayPartial.invoiceId,
  amount: '100',
  paymentMethod: 'cash',
  paymentDate: '2026-09-05',
  createdBy: staffUser.user_id
})

check('แท็บ "ชำระแล้ว" คืนเฉพาะบิลที่จ่ายครบ', () => {
  const paid = invoices.listInvoices(db, apartmentId, { settlement: 'paid' })
  assert(paid.length === 1, `ได้ ${paid.length} ใบ`)
  assert(paid[0].invoiceId === toPayFull.invoiceId, 'ได้คนละใบกับที่จ่ายครบ')
  assert(paid[0].outstandingCents === 0, `ยอดค้างต้องเป็น 0 ได้ ${paid[0].outstandingCents}`)
})

// จุดที่พลาดง่ายที่สุดของตัวกรองนี้ — ป้ายสถานะ `unpaid` ก็แปลว่า "ค้างชำระ" เหมือนกัน
// ถ้ากรองแค่สถานะเดียว บิลที่จ่ายมาครึ่งเดียวจะไม่อยู่ในแท็บไหนเลยแล้วไม่มีใครตามเก็บ
check('แท็บ "ค้างชำระ" รวมบิลที่จ่ายมาบางส่วนด้วย', () => {
  const outstanding = invoices.listInvoices(db, apartmentId, { settlement: 'outstanding' })
  assert(
    outstanding.some((i) => i.invoiceId === toPayPartial.invoiceId),
    'บิลที่จ่ายบางส่วนหายไปจากแท็บค้างชำระ'
  )
  assert(
    outstanding.every((i) => i.outstandingCents > 0),
    'มีบิลที่ไม่ได้ค้างเงินหลุดเข้ามา'
  )
})

// ยอดค้างของบิลที่ยกเลิกคำนวณออกมาเป็นบวกได้ (ยอดรวมยังอยู่ ไม่มีใครจ่าย)
// แต่ไม่ใช่หนี้จริง จึงต้องกรองด้วยสถานะ ไม่ใช่ "ยอดค้าง > 0"
check('บิลที่ยกเลิกไม่เข้าแท็บค้างชำระและชำระแล้ว', () => {
  const cancelled = invoices.listInvoices(db, apartmentId, { status: 'cancelled' })
  assert(cancelled.length > 0, 'ต้องมีบิลที่ยกเลิกอยู่ในหอนี้ ไม่งั้นเทสต์นี้ไม่ได้ทดสอบอะไร')

  for (const settlement of ['outstanding', 'paid']) {
    const list = invoices.listInvoices(db, apartmentId, { settlement })
    assert(
      list.every((i) => i.status !== 'cancelled'),
      `แท็บ ${settlement} มีบิลที่ยกเลิกหลุดเข้ามา`
    )
  }
})

// แท็บของตัวเอง (ผู้ใช้ขอ 2026-08-11) — เดิมบิลที่ยกเลิกต้องไปหาเอาใน "ทั้งหมด"
// ปนกับบิลที่ยังต้องตามเก็บเงิน ทั้งที่เป็นที่เดียวที่ปุ่มลบถาวรโผล่
check('แท็บ "ยกเลิกแล้ว" คืนเฉพาะบิลที่ยกเลิก และครบทุกใบ', () => {
  const tab = invoices.listInvoices(db, apartmentId, { settlement: 'cancelled' })
  const byStatus = invoices.listInvoices(db, apartmentId, { status: 'cancelled' })

  assert(tab.length === byStatus.length, `แท็บได้ ${tab.length} ใบ แต่มีจริง ${byStatus.length} ใบ`)
  assert(
    tab.every((i) => i.status === 'cancelled'),
    'มีบิลที่ยังไม่ถูกยกเลิกหลุดเข้ามาในแท็บ'
  )
})

// **"ทั้งหมด" ต้องยังหมายถึงทั้งหมดจริงๆ** ต่อให้บิลที่ยกเลิกมีแท็บของตัวเองแล้ว —
// แท็บใหม่เป็นทางลัดไปหาเฉพาะกลุ่ม ไม่ได้ย้ายมันออกจาก "ทั้งหมด"
// (ป้ายที่เขียนว่าทั้งหมดแล้วซ่อนของบางอย่างไว้ คือป้ายที่โกหก)
check('ไม่ระบุแท็บ = ได้ทั้งหมด รวมใบที่ยกเลิก', () => {
  const all = invoices.listInvoices(db, apartmentId)
  const outstanding = invoices.listInvoices(db, apartmentId, { settlement: 'outstanding' })
  const paid = invoices.listInvoices(db, apartmentId, { settlement: 'paid' })
  const cancelled = invoices.listInvoices(db, apartmentId, { settlement: 'cancelled' })
  assert(
    all.length === outstanding.length + paid.length + cancelled.length,
    `ทั้งหมด ${all.length} ≠ ค้าง ${outstanding.length} + จ่ายครบ ${paid.length} + ยกเลิก ${cancelled.length}`
  )
})

check('แท็บใช้ร่วมกับเงื่อนไขค้นหาอื่นได้', () => {
  const list = invoices.listInvoices(db, apartmentId, {
    settlement: 'outstanding',
    roomNumber: toPayPartial.roomNumber
  })
  assert(list.length === 1, `ได้ ${list.length} ใบ`)
  assert(list[0].invoiceId === toPayPartial.invoiceId, 'ได้คนละใบ')
})

// ตัวกรองที่สะกดผิดต้องดังออกมา ไม่ใช่เงียบแล้วคืนบิลทั้งหมดทั้งที่หน้าจอไฮไลต์แท็บอยู่
check('ค่าแท็บที่ไม่รู้จักต้องเตือน', () => {
  throws(
    () => invoices.listInvoices(db, apartmentId, { settlement: 'overdue' }),
    'ตัวกรองสถานะไม่ถูกต้อง',
    'ต้องกันค่าที่ไม่รู้จัก'
  )
})

// -----------------------------------------------------
// ผู้เช่าจ่ายค่าเช่าเดือนแรกตอนย้ายเข้าแล้ว (createContract ออกใบเสร็จให้) ถ้าออกบิล
// ของเดือนเดียวกันให้อีก ผู้เช่าจะโดนเก็บค่าเช่าเดือนนั้นสองรอบ
group('ห้องที่เพิ่งย้ายเข้าเดือนนี้')

const newcomerRoom = rooms.addFloor(db, apartmentId, { roomCount: 1 })
const newcomer = newcomerRoom[newcomerRoom.length - 1].rooms[0]
rooms.setRoomRates(db, [newcomer.roomId], { monthlyRent: '4000' })

const newTenant = tenants.insertTenant(db, {
  firstName: 'เพิ่งย้ายเข้า',
  lastName: 'ทดสอบ',
  phone: '0855555555'
})
const newContract = contracts.createContract(db, {
  roomId: newcomer.roomId,
  rentType: 'monthly',
  startDate: '2027-09-01',
  rentAmount: '4000',
  deposit: '0',
  depositPaymentMethod: 'cash',
  bookingFee: '0',
  waterMeterStart: 0,
  electricMeterStart: 0,
  tenants: [newTenant.tenantId],
  createdBy: staffUser.user_id
})

check('จ่ายค่าเช่าเดือนแรกแล้ว มีใบเสร็จเป็นหลักฐาน', () => {
  const row = db
    .prepare("SELECT amount_cents, purpose FROM payments WHERE contract_id = ? AND purpose = 'advance'")
    .get(newContract.contractId)
  assert(row !== undefined, 'ต้องมีใบเสร็จค่าเช่าเดือนแรก')
  // เข้าพักวันที่ 1 → คิดเต็มเดือน
  assert(row.amount_cents === 400000, `ได้ ${row.amount_cents}`)
})

check('พรีวิวออกบิลติดธงว่าห้องนี้จ่ายค่าเช่าเดือนนี้ไปแล้ว', () => {
  const sepBatch = meter.createBatch(db, apartmentId, '2027-09-01')
  const rows = invoices.previewMonthlyBilling(db, {
    apartmentId,
    meterBatchId: sepBatch.batchId,
    billingMonth: '2027-09'
  })
  const row = rows.find((r) => r.roomNumber === newcomer.roomNumber)
  assert(row.startsThisMonth === true, 'ต้องติดธงว่าเพิ่งย้ายเข้าเดือนนี้')

  // เดือนถัดไปเข้ารอบบิลปกติ ไม่ติดธงแล้ว
  const october = invoices.previewMonthlyBilling(db, {
    apartmentId,
    meterBatchId: sepBatch.batchId,
    billingMonth: '2027-10'
  })
  assert(
    october.find((r) => r.roomNumber === newcomer.roomNumber).startsThisMonth === false,
    'เดือนถัดไปต้องออกบิลได้ตามปกติ'
  )
})

check('ออกบิลทั้งหอแล้วข้ามห้องนั้น พร้อมบอกเหตุผล', () => {
  const sep = meter.createBatch(db, apartmentId, '2027-09-02')
  const result = invoices.createMonthlyInvoicesForApartment(db, {
    apartmentId,
    meterBatchId: sep.batchId,
    billingMonth: '2027-09',
    issueDate: '2027-09-02'
  })

  const skipped = result.skipped.find((s) => s.roomNumber === newcomer.roomNumber)
  assert(skipped !== undefined, 'ต้องอยู่ในกองที่ข้าม')
  assert(skipped.reason.includes('เพิ่งย้ายเข้า'), `เหตุผลได้ "${skipped.reason}"`)
  assert(
    !result.created.some((c) => c.roomNumber === newcomer.roomNumber),
    'ต้องไม่มีบิลของห้องนั้นถูกสร้าง'
  )
})

// -----------------------------------------------------
// บิลที่ถูกลดจนยอดรวมเหลือ 0 — เจ้าของหอใส่ส่วนลดเท่ากับยอดบิลทั้งใบ (addInvoiceItem รองรับ)
// บิลแบบนี้ต้องนับว่าชำระครบทันที ไม่งั้นจะเคลียร์ไม่ได้เลย เพราะ recordInvoicePayment
// ไม่รับยอด 0 และไม่รับยอดเกินยอดค้าง (ซึ่งเป็น 0) → ค้างในแท็บค้างชำระและบล็อกการย้ายออกถาวร
group('บิลที่ยอดรวมเหลือ 0')

const zeroBatch = meter.createBatch(db, apartmentId, '2027-10-31')
const zeroInvoice = invoices.createMonthlyInvoice(db, {
  contractId: newContract.contractId,
  billingMonth: '2027-10',
  meterBatchId: zeroBatch.batchId,
  issueDate: '2027-10-31'
})

check('ตั้งต้น: บิลยังค้างชำระตามปกติก่อนใส่ส่วนลด', () => {
  assert(zeroInvoice.totalAmountCents > 0, `ยอดตั้งต้น ${zeroInvoice.totalAmountCents}`)
  assert(zeroInvoice.status === 'unpaid', `ได้ ${zeroInvoice.status}`)
})

check('ส่วนลดเท่ากับยอดบิลทั้งใบ ทำให้บิลเป็นชำระแล้วทันที', () => {
  const after = invoices.addInvoiceItem(db, zeroInvoice.invoiceId, {
    itemType: 'discount',
    description: 'ยกเว้นค่าเช่าทั้งเดือน',
    amount: centsToBaht(zeroInvoice.totalAmountCents)
  })
  assert(after.totalAmountCents === 0, `ได้ ${after.totalAmountCents}`)
  assert(after.status === 'paid', `ได้ ${after.status}`)
  assert(after.outstandingCents === 0, `ยอดค้าง ${after.outstandingCents}`)
})

check('บิลยอด 0 ไม่ค้างอยู่ในแท็บค้างชำระ แต่ไปอยู่แท็บชำระแล้ว', () => {
  const outstanding = invoices.listInvoices(db, apartmentId, { settlement: 'outstanding' })
  assert(
    !outstanding.some((i) => i.invoiceId === zeroInvoice.invoiceId),
    'ต้องไม่อยู่ในแท็บค้างชำระ'
  )
  const paid = invoices.listInvoices(db, apartmentId, { settlement: 'paid' })
  assert(
    paid.some((i) => i.invoiceId === zeroInvoice.invoiceId),
    'ต้องอยู่ในแท็บชำระแล้ว'
  )
})

check('บิลที่ยกเลิกแล้วไม่ถูกดึงกลับมาเป็นชำระแล้วเพราะยอดเหลือ 0', () => {
  const cancelled = invoices.createMonthlyInvoice(db, {
    contractId: newContract.contractId,
    billingMonth: '2027-11',
    meterBatchId: zeroBatch.batchId,
    issueDate: '2027-11-30'
  })
  invoices.cancelInvoice(db, cancelled.invoiceId, {
    reason: 'ทดสอบว่าสถานะยกเลิกชนะยอด 0',
    cancelledBy: staffUser.user_id
  })
  // สถานะ 'cancelled' ต้องชนะเสมอ — refreshInvoiceStatus return ออกไปก่อนถึงตรรกะยอด 0
  invoices.refreshInvoiceStatus(db, cancelled.invoiceId, new Date().toISOString())
  const after = invoices.getInvoiceById(db, cancelled.invoiceId)
  assert(after.status === 'cancelled', `ได้ ${after.status}`)
})

// -----------------------------------------------------
// อัตรา VAT ถูกตรึงไว้ที่บิลตั้งแต่วันออกบิล (migration 031)
// -----------------------------------------------------
// เจ้าของหอยืนยัน: บิลที่ออกไปแล้วต้องคง VAT เดิมตลอด **ต่อให้ผู้เช่ามาจ่ายช้าแล้วโดนค่าปรับ**
// อัตราใหม่มีผลกับบิลที่ออกในรอบถัดไปเท่านั้น
//
// เส้นทางที่อันตรายที่สุดคือ addLateFeeItem -> recalculateTotals ซึ่งคิด VAT ของทั้งใบใหม่
// ถ้า recalculateTotals ไปหยิบอัตราปัจจุบันของหอมาใช้ บิลเก่าจะเปลี่ยนยอดเองโดยไม่มีใครสั่ง
group('อัตรา VAT ถูกตรึงไว้ที่บิล')

const vatBatch = meter.createBatch(db, apartmentId, '2028-03-31')
// ต้องมีเลขมิเตอร์จริง ไม่งั้นค่าน้ำ/ค่าไฟเป็น 0 แล้วบิลไม่มีฐานภาษีให้ทดสอบ
// (ค่าเช่ายกเว้น VAT เสมอ ฐานภาษีจึงมาจากค่าน้ำ/ค่าไฟล้วน)
meter.saveBatchReadings(db, vatBatch.batchId, 'water', [
  { roomId: newcomer.roomId, roomNumber: newcomer.roomNumber, currentReading: 60 }
])
meter.saveBatchReadings(db, vatBatch.batchId, 'electric', [
  { roomId: newcomer.roomId, roomNumber: newcomer.roomNumber, currentReading: 200 }
])

const billAt7 = invoices.createMonthlyInvoice(db, {
  contractId: newContract.contractId,
  billingMonth: '2028-03',
  meterBatchId: vatBatch.batchId,
  issueDate: '2028-03-31'
})

check('บิลเก็บอัตราของตัวเองไว้ตอนออกบิล', () => {
  assert(billAt7.vatRate === 7, `ได้ ${billAt7.vatRate}`)
  assert(billAt7.vatAmountCents > 0, 'หอเปิด VAT ไว้ ต้องมียอดภาษี')
})

const vatAt7Cents = billAt7.vatAmountCents
const totalAt7Cents = billAt7.totalAmountCents

// เจ้าของหอเปลี่ยนอัตราเป็น 10% หลังจากออกบิลใบบนไปแล้ว
apartments.updateApartment(db, apartmentId, {
  nameTh: 'หอทดสอบออกบิล',
  addressTh: '123 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isVatEnabled: true,
  vatRate: 10
})

check('หอเปลี่ยนอัตราแล้ว แต่บิลที่ออกไปแล้วไม่ขยับ', () => {
  const after = invoices.getInvoiceById(db, billAt7.invoiceId)
  assert(after.vatRate === 7, `บิลเก่าควรยังเป็น 7 ได้ ${after.vatRate}`)
  assert(after.vatAmountCents === vatAt7Cents, `ยอด VAT เปลี่ยน: ${vatAt7Cents} -> ${after.vatAmountCents}`)
  assert(after.totalAmountCents === totalAt7Cents, 'ยอดรวมของบิลเก่าต้องเท่าเดิม')
})

check('บิลที่ออกใหม่หลังเปลี่ยนอัตรา ใช้อัตราใหม่', () => {
  const nextBatch = meter.createBatch(db, apartmentId, '2028-04-30')
  // หน่วยที่ใช้เท่ากับรอบก่อนพอดี ฐานภาษีจึงเท่ากัน ต่างกันแค่อัตรา
  meter.saveBatchReadings(db, nextBatch.batchId, 'water', [
    { roomId: newcomer.roomId, roomNumber: newcomer.roomNumber, currentReading: 120 }
  ])
  meter.saveBatchReadings(db, nextBatch.batchId, 'electric', [
    { roomId: newcomer.roomId, roomNumber: newcomer.roomNumber, currentReading: 400 }
  ])

  const billAt10 = invoices.createMonthlyInvoice(db, {
    contractId: newContract.contractId,
    billingMonth: '2028-04',
    meterBatchId: nextBatch.batchId,
    issueDate: '2028-04-30'
  })
  assert(billAt10.vatRate === 10, `ได้ ${billAt10.vatRate}`)

  // ฐานภาษีเท่ากันทั้งสองใบ (ค่าน้ำ/ค่าไฟชุดเดียวกัน) ยอด VAT จึงต้องต่างกันตามอัตรา
  const oldBill = invoices.getInvoiceById(db, billAt7.invoiceId)
  if (billAt10.taxableAmountCents === oldBill.taxableAmountCents) {
    assert(
      billAt10.vatAmountCents > oldBill.vatAmountCents,
      `ฐานภาษีเท่ากันแต่ VAT ไม่มากขึ้น: ${oldBill.vatAmountCents} -> ${billAt10.vatAmountCents}`
    )
  }
})

// 🔴 ข้อสำคัญที่สุดของกลุ่มนี้ — ตรงกับสถานการณ์ที่เจ้าของหอระบุมาเป๊ะ
check('ผู้เช่ามาจ่ายช้าจนโดนค่าปรับ VAT ของบิลเก่าต้องไม่ขยับ', () => {
  invoices.addLateFeeItem(db, billAt7.invoiceId, { amountCents: 5000, overdueDays: 5 })

  const after = invoices.getInvoiceById(db, billAt7.invoiceId)
  assert(after.vatRate === 7, `อัตราของบิลเปลี่ยนไป: ${after.vatRate}`)
  assert(
    after.vatAmountCents === vatAt7Cents,
    `ยอด VAT ถูกคิดใหม่: ${vatAt7Cents} -> ${after.vatAmountCents}`
  )
  // ยอดรวมต้องเพิ่มขึ้นเท่าค่าปรับพอดี ไม่ใช่เพิ่มเพราะ VAT ถูกคิดใหม่ด้วย
  assert(
    after.totalAmountCents === totalAt7Cents + 5000,
    `ยอดรวมควรเพิ่มแค่ค่าปรับ 50 บาท: ${totalAt7Cents} -> ${after.totalAmountCents}`
  )
})

check('แก้รายการในบิลเก่าด้วยมือ ก็ยังคิดที่อัตราเดิมของใบนั้น', () => {
  const before = invoices.getInvoiceById(db, billAt7.invoiceId)
  const after = invoices.addInvoiceItem(db, billAt7.invoiceId, {
    itemType: 'other',
    description: 'ค่าบริการเพิ่มเติม',
    amount: '100',
    isTaxable: true
  })
  // 100 บาท ที่อัตรา 7% = 7 บาท ไม่ใช่ 10 บาท
  assert(
    after.vatAmountCents - before.vatAmountCents === 700,
    `VAT ที่เพิ่มควรเป็น 7 บาท ได้ ${(after.vatAmountCents - before.vatAmountCents) / 100}`
  )
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลออกบิลทำงานครบทุกเส้นทาง')
