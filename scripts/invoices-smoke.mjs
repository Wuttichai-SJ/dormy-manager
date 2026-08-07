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
  tenants: [somchai.tenantId]
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
  tenants: [somying.tenantId]
})

const batch = meter.createBatch(db, apartmentId, '2026-08-31')
meter.saveBatchReadings(db, batch.batchId, 'water', [
  { roomId: room1.roomId, roomNumber: '101', previousReading: 2, currentReading: 100 }
])
meter.saveBatchReadings(db, batch.batchId, 'electric', [
  { roomId: room1.roomId, roomNumber: '101', previousReading: 0, currentReading: 300 }
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

check('ใบเสร็จใช้ตัวนับคนละชุดกับใบแจ้งหนี้', () => {
  const receipt = invoices.nextDocumentNumber(db, apartmentId, 'receipt', '2026-08-31')
  assert(receipt === 'R2026080001', `ได้ ${receipt}`)
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

check('ค่าเช่าขึ้นข้อความตามต้นแบบ พร้อมเดือนแบบ MM-YYYY', () => {
  const rent = built.items.find((i) => i.itemType === 'rent')
  assert(
    rent.description === 'ค่าเช่าห้อง/Rent (เดือน/Month 08-2026)',
    `ได้ "${rent.description}"`
  )
  assert(rent.totalAmountCents === 500000, `ได้ ${rent.totalAmountCents}`)
})

check('ค่าน้ำคิดจากหน่วยที่จด และเขียนเลขมิเตอร์ก่อน/หลังลงบรรทัด', () => {
  const water = built.items.find((i) => i.itemType === 'water')
  assert(water.description === 'ค่าน้ำ/water : 98 หน่วย (2 - 100)', `ได้ "${water.description}"`)
  assert(water.totalAmountCents === 98 * 2000, `ได้ ${water.totalAmountCents}`)
})

check('ค่าไฟคิดจากหน่วยที่จดเช่นกัน', () => {
  const elec = built.items.find((i) => i.itemType === 'electricity')
  assert(elec.totalAmountCents === 300 * 700, `ได้ ${elec.totalAmountCents}`)
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

check('ค่าเช่าและค่าน้ำ/ค่าไฟได้รับยกเว้นเสมอ', () => {
  for (const type of ['rent', 'water', 'electricity']) {
    const item = built.items.find((i) => i.itemType === type)
    assert(item.isTaxable === false, `${type} ไม่ควรเสียภาษี`)
  }
})

// -----------------------------------------------------
group('รวมยอด')

check('VAT บวกเพิ่มจากฐานภาษี ไม่ใช่รวมอยู่ในราคาแล้ว', () => {
  const totals = invoices.calculateInvoiceTotals(built.items)
  // ยกเว้น: เช่า 5000 + น้ำ 1960 + ไฟ 2100 + ขยะ 50 = 9110
  assert(totals.exemptAmountCents === 911000, `exempt ได้ ${totals.exemptAmountCents}`)
  assert(totals.taxableAmountCents === 30000, `taxable ได้ ${totals.taxableAmountCents}`)
  assert(totals.vatAmountCents === 2100, `vat ได้ ${totals.vatAmountCents}`)
  assert(totals.totalAmountCents === 943100, `total ได้ ${totals.totalAmountCents}`)
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
  assert(invoice1.totalAmountCents === 943100, `ได้ ${invoice1.totalAmountCents}`)
  assert(invoice1.outstandingCents === 943100, 'ยังไม่จ่ายเลย ต้องค้างเต็มจำนวน')
  assert(invoice1.paidAmountCents === 0, `ได้ ${invoice1.paidAmountCents}`)
})

check('บิลจำวันที่จดมิเตอร์ที่ใช้ออก และแนบข้อมูลหอไปให้หน้าพิมพ์', () => {
  assert(invoice1.meterBatchId === batch.batchId, 'ต้องผูกกับใบจดมิเตอร์')
  assert(invoice1.apartment.name === 'หอทดสอบออกบิล', `ได้ ${invoice1.apartment.name}`)
  assert(invoice1.roomNumber === '101', `ได้ ${invoice1.roomNumber}`)
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
  assert(updated.totalAmountCents === 943100 + 50000, `ได้ ${updated.totalAmountCents}`)
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
  assert(updated.totalAmountCents === 943100 + 50000 - 10000, `ได้ ${updated.totalAmountCents}`)
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
  assert(after.totalAmountCents === 943100 + 50000 - 10000, `ได้ ${after.totalAmountCents}`)
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

check('ยกเลิกแล้วสถานะเปลี่ยนและจำเวลาไว้', () => {
  const cancelled = invoices.cancelInvoice(db, invoice1.invoiceId)
  assert(cancelled.status === 'cancelled', `ได้ ${cancelled.status}`)
  assert(cancelled.cancelledAt !== null, 'ต้องบันทึกเวลายกเลิก')
})

check('ยกเลิกซ้ำไม่ได้', () => {
  throws(() => invoices.cancelInvoice(db, invoice1.invoiceId), 'ยกเลิกไปแล้ว', 'ต้องเตือน')
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

// -----------------------------------------------------
cleanup()
summarize('โมดูลออกบิลทำงานครบทุกเส้นทาง')
