// ทดสอบโมดูลจดมิเตอร์บนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:meter
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
const rooms = await import('../src/main/db/rooms.js')
const tenants = await import('../src/main/db/tenants.js')
const contracts = await import('../src/main/db/contracts.js')
const meter = await import('../src/main/db/meterReadings.js')

const { db, cleanup } = await openTempDatabase('dormy-meter')

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบมิเตอร์',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
const apartmentId = apartment.apartmentId
rooms.generateFloorPlan(db, apartmentId, [{ roomCount: 3 }])
const [room1, room2, room3] = rooms.listFloors(db, apartmentId)[0].rooms

// -----------------------------------------------------
group('คำนวณหน่วยที่ใช้')

check('หักเลขครั้งก่อนออกจากเลขปัจจุบัน', () => {
  assert(meter.calculateUnitsUsed(2, 100) === 98, 'ควรได้ 98')
})

check('มิเตอร์อ่านทศนิยมได้ และต้องไม่มีเศษ float ติดมา', () => {
  const units = meter.calculateUnitsUsed(2, 100.1)
  assert(units === 98.1, `ได้ ${units} ซึ่งน่าจะเป็น 98.09999999999999`)
})

check('เลขปัจจุบันน้อยกว่าครั้งก่อนโดยไม่ติ๊กเกินรอบ ต้องเตือน ไม่ใช่คืนค่าติดลบ', () => {
  throws(
    () => meter.calculateUnitsUsed(100, 20),
    'เกินรอบมิเตอร์',
    'ต้องบอกวิธีแก้ให้ผู้ใช้ด้วย'
  )
})

check('ติ๊กเกินรอบแล้วคิดจากจุดหมุนกลับตามจำนวนหลักของเลขครั้งก่อน', () => {
  // มิเตอร์ 5 หลัก 99,850 → หมุนกลับที่ 100,000 → ใช้ไป 150 + 120 = 270
  assert(meter.calculateUnitsUsed(99850, 120, true) === 270, 'ควรได้ 270')
})

check('ติ๊กเกินรอบทั้งที่เลขยังเดินหน้าปกติ ต้องคิดแบบธรรมดา ไม่บวกรอบเกินให้', () => {
  assert(meter.calculateUnitsUsed(10, 30, true) === 20, 'ควรได้ 20 ไม่ใช่ 120')
})

check('เลขมิเตอร์ติดลบไม่ได้', () => {
  throws(() => meter.calculateUnitsUsed(-1, 10), 'ติดลบ', 'ต้องกันเลขติดลบ')
})

// -----------------------------------------------------
group('ใบจดมิเตอร์')

const batch1 = meter.createBatch(db, apartmentId, '2026-08-31')

check('สร้างใบจดแล้วได้วันที่ตามที่สั่ง', () => {
  assert(batch1.readingDate === '2026-08-31', `ได้ ${batch1.readingDate}`)
})

check('วันเดียวกันสร้างซ้ำไม่ได้ และต้องบอกให้ไปเปิดใบเดิม', () => {
  throws(
    () => meter.createBatch(db, apartmentId, '2026-08-31'),
    'อยู่แล้ว',
    'ต้องกันใบซ้ำวัน'
  )
})

check('ไม่ระบุวันที่ไม่ผ่าน', () => {
  throws(() => meter.createBatch(db, apartmentId, ''), 'วันที่จดมิเตอร์', 'ต้องบังคับวันที่')
})

check('รายการใบจดเรียงใหม่สุดขึ้นก่อน', () => {
  meter.createBatch(db, apartmentId, '2026-07-31')
  const list = meter.listBatches(db, apartmentId)
  assert(list.length === 2, `ได้ ${list.length} ใบ`)
  assert(list[0].readingDate === '2026-08-31', `ใบแรกคือ ${list[0].readingDate}`)
})

// -----------------------------------------------------
group('หน้ากรอกเลขมิเตอร์')

const sheet = meter.getBatchSheet(db, batch1.batchId, 'water')

check('คืนทุกห้องที่เปิดใช้งาน เรียงตามชั้นและเลขห้อง', () => {
  assert(sheet.rooms.length === 3, `ได้ ${sheet.rooms.length} ห้อง`)
  assert(sheet.rooms[0].roomNumber === '101', `ห้องแรกคือ ${sheet.rooms[0].roomNumber}`)
})

check('ห้องที่ไม่เคยจดและไม่เคยมีสัญญา ตั้งต้นที่ 0 และยังไม่ถือว่าบันทึกแล้ว', () => {
  assert(sheet.rooms[0].previousReading === 0, `ได้ ${sheet.rooms[0].previousReading}`)
  assert(sheet.rooms[0].currentReading === null, 'ยังไม่กรอกต้องเป็น null ไม่ใช่ 0')
  assert(sheet.rooms[0].isSaved === false, 'ยังไม่บันทึก')
})

check('ฝั่งมิเตอร์ที่ไม่รู้จักต้องเตือน', () => {
  throws(
    () => meter.getBatchSheet(db, batch1.batchId, 'gas'),
    'ฝั่งมิเตอร์',
    'ต้องกันฝั่งที่ไม่รู้จัก'
  )
})

// -----------------------------------------------------
group('บันทึกเลขมิเตอร์')

const saved = meter.saveBatchReadings(db, batch1.batchId, 'water', [
  { roomId: room1.roomId, roomNumber: '101', currentReading: 100 },
  { roomId: room2.roomId, roomNumber: '102', currentReading: 0 }
])

check('บันทึกแล้วคำนวณหน่วยให้ และห้องที่ไม่ได้ส่งมาไม่ถูกแตะ', () => {
  const r101 = saved.rooms.find((r) => r.roomNumber === '101')
  const r103 = saved.rooms.find((r) => r.roomNumber === '103')
  // ห้องนี้ไม่เคยจดและไม่มีสัญญา เลขครั้งก่อนจึงเป็น 0 → ใช้ไป 100 หน่วยเต็ม
  assert(r101.unitsUsed === 100, `ได้ ${r101.unitsUsed}`)
  assert(r101.isSaved === true, 'ห้อง 101 ต้องถือว่าบันทึกแล้ว')
  assert(r103.isSaved === false, 'ห้อง 103 ไม่ได้ส่งมา ต้องยังไม่บันทึก')
})

check('บันทึกซ้ำที่เดิมทับค่าเก่า ไม่สร้างแถวใหม่', () => {
  meter.saveBatchReadings(db, batch1.batchId, 'water', [
    { roomId: room1.roomId, roomNumber: '101', currentReading: 50 }
  ])
  const again = meter.getBatchSheet(db, batch1.batchId, 'water')
  const r101 = again.rooms.find((r) => r.roomNumber === '101')
  assert(r101.unitsUsed === 50, `ได้ ${r101.unitsUsed}`)
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM meter_readings WHERE meter_batch_id = ?')
    .get(batch1.batchId).n
  assert(count === 2, `มี ${count} แถว ควรมี 2`)
})

check('บันทึกฝั่งไฟไม่ล้างเลขน้ำที่จดไว้แล้ว', () => {
  meter.saveBatchReadings(db, batch1.batchId, 'electric', [
    { roomId: room1.roomId, roomNumber: '101', currentReading: 300 }
  ])
  const water = meter.getBatchSheet(db, batch1.batchId, 'water')
  const electric = meter.getBatchSheet(db, batch1.batchId, 'electric')
  assert(water.rooms.find((r) => r.roomNumber === '101').unitsUsed === 50, 'เลขน้ำต้องอยู่ครบ')
  assert(
    electric.rooms.find((r) => r.roomNumber === '101').unitsUsed === 300,
    'เลขไฟต้องถูกบันทึก'
  )
})

check('แถวเดียวผิด ต้องไม่มีแถวไหนถูกเขียนเลย', () => {
  // ห้อง 101 ปิดรอบก่อนไว้ที่ 50 — กรอก 5 ในรอบถัดไปคือเลขเดินถอยหลังโดยไม่ติ๊กเกินรอบ
  const bad = meter.createBatch(db, apartmentId, '2026-09-15')
  throws(
    () =>
      meter.saveBatchReadings(db, bad.batchId, 'water', [
        { roomId: room3.roomId, roomNumber: '103', currentReading: 10 },
        { roomId: room1.roomId, roomNumber: '101', currentReading: 5 }
      ]),
    'ห้อง 101',
    'ต้องบอกว่าห้องไหนผิด'
  )
  const after = meter.getBatchSheet(db, bad.batchId, 'water')
  assert(
    after.rooms.find((r) => r.roomNumber === '103').isSaved === false,
    'ห้อง 103 ที่กรอกถูกต้องไม่ควรถูกเขียน เพราะทั้งใบต้องล้มพร้อมกัน'
  )
  meter.deleteBatch(db, bad.batchId)
})

check('ห้องที่ไม่ได้อยู่ในหอของใบจดนี้ บันทึกไม่ได้', () => {
  throws(
    () =>
      meter.saveBatchReadings(db, batch1.batchId, 'water', [
        { roomId: 9999, roomNumber: 'ไม่มีจริง', currentReading: 10 }
      ]),
    'ไม่ได้อยู่ในหอพัก',
    'ต้องกันห้องนอกหอ'
  )
})

// -----------------------------------------------------
group('เลขจดครั้งก่อนที่ระบบหาให้')

check('ใบถัดไปดึงเลขปัจจุบันของใบก่อนหน้ามาเป็นเลขครั้งก่อน', () => {
  const batch2 = meter.createBatch(db, apartmentId, '2026-09-30')
  const next = meter.getBatchSheet(db, batch2.batchId, 'water')
  const r101 = next.rooms.find((r) => r.roomNumber === '101')
  assert(r101.previousReading === 50, `ได้ ${r101.previousReading} ควรเป็น 50`)
})

const somying = tenants.insertTenant(db, {
  firstName: 'สมหญิง',
  lastName: 'ทดสอบ',
  phone: '0891234567'
})

check('ห้องที่มีสัญญาแต่ยังไม่เคยจด ใช้เลขมิเตอร์วันเข้าพักจากสัญญา', () => {
  contracts.createContract(db, {
    roomId: room3.roomId,
    rentType: 'monthly',
    startDate: '2026-08-01',
    rentAmount: '5000',
    deposit: '5000',
    depositPaymentMethod: 'cash',
    bookingFee: '0',
    waterMeterStart: 77,
    electricMeterStart: 4200,
    tenants: [somying.tenantId]
  })
  const batch3 = meter.createBatch(db, apartmentId, '2026-10-31')
  const sheet3 = meter.getBatchSheet(db, batch3.batchId, 'water')
  const r103 = sheet3.rooms.find((r) => r.roomNumber === '103')
  assert(r103.previousReading === 77, `ได้ ${r103.previousReading} ควรเป็น 77`)

  const elec3 = meter.getBatchSheet(db, batch3.batchId, 'electric')
  assert(
    elec3.rooms.find((r) => r.roomNumber === '103').previousReading === 4200,
    'ฝั่งไฟต้องดึงเลขเริ่มต้นของสัญญาเหมือนกัน'
  )
})

// บั๊กที่ผู้ใช้เจอจริง 2026-08-07: บันทึกฝั่งน้ำก่อน แล้วฝั่งไฟไม่เติมเลขครั้งก่อนให้
// เพราะแถวถูกเขียนไว้แล้วโดยฝั่งไฟยังเป็นค่าว่าง — ต้องแยก "ยังไม่จด" ออกจาก "จดได้ 0"
check('บันทึกฝั่งน้ำแล้ว ฝั่งไฟยังต้องเติมเลขครั้งก่อนให้อยู่', () => {
  const first = meter.createBatch(db, apartmentId, '2027-01-31')
  meter.saveBatchReadings(db, first.batchId, 'water', [
    { roomId: room2.roomId, roomNumber: '102', currentReading: 20 }
  ])
  meter.saveBatchReadings(db, first.batchId, 'electric', [
    { roomId: room2.roomId, roomNumber: '102', currentReading: 700 }
  ])

  // รอบถัดไป: ห้องนี้ต้องได้เลขปิดของรอบก่อนทั้งสองฝั่ง
  const second = meter.createBatch(db, apartmentId, '2027-02-28')
  meter.saveBatchReadings(db, second.batchId, 'water', [
    { roomId: room2.roomId, roomNumber: '102', currentReading: 25 }
  ])

  const elec = meter.getBatchSheet(db, second.batchId, 'electric')
  const r102 = elec.rooms.find((r) => r.roomNumber === '102')
  assert(
    r102.previousReading === 700,
    `ฝั่งไฟได้ ${r102.previousReading} ควรเป็น 700 (เลขปิดของรอบก่อน)`
  )
  assert(r102.currentReading === null, 'ฝั่งไฟยังไม่ได้จดในรอบนี้ ต้องเป็นช่องว่าง ไม่ใช่ 0')
  assert(r102.isSaved === false, 'ฝั่งไฟยังไม่ถือว่าบันทึกแล้ว')
})

check('รอบที่จดแต่ฝั่งน้ำ ต้องไม่บังเลขไฟของรอบที่เก่ากว่า', () => {
  // รอบ 2027-03 จดแต่น้ำ — รอบ 2027-04 ฝั่งไฟต้องย้อนไปเอาเลขของ 2027-02 (=700)
  const marchBatch = meter.createBatch(db, apartmentId, '2027-03-31')
  meter.saveBatchReadings(db, marchBatch.batchId, 'water', [
    { roomId: room2.roomId, roomNumber: '102', currentReading: 30 }
  ])

  const aprilBatch = meter.createBatch(db, apartmentId, '2027-04-30')
  const elec = meter.getBatchSheet(db, aprilBatch.batchId, 'electric')
  const r102 = elec.rooms.find((r) => r.roomNumber === '102')
  assert(r102.previousReading === 700, `ได้ ${r102.previousReading} ควรเป็น 700`)
})

// เลขครั้งก่อนคือเลขปิดของรอบที่แล้ว ไม่ใช่ตัวเลขที่ใครจะกรอกทับได้ (ผู้ใช้สั่ง 2026-08-07)
// ล็อกที่หน้าจออย่างเดียวไม่พอ — ฝั่ง main ต้องไม่รับค่าที่ส่งมาด้วย
check('ส่งเลขครั้งก่อนมาเองก็ไม่ถูกใช้ ระบบยึดเลขปิดของรอบก่อนเสมอ', () => {
  const batch4 = meter.createBatch(db, apartmentId, '2026-11-30')
  meter.saveBatchReadings(db, batch4.batchId, 'water', [
    // ยัด previousReading มั่วๆ เข้ามา — ต้องถูกเมิน
    { roomId: room1.roomId, roomNumber: '101', previousReading: 999, currentReading: 1000 }
  ])
  const sheet4 = meter.getBatchSheet(db, batch4.batchId, 'water')
  const r101 = sheet4.rooms.find((r) => r.roomNumber === '101')
  assert(r101.previousReading === 50, `ได้ ${r101.previousReading} ควรเป็น 50 (เลขปิดรอบก่อน)`)
  assert(r101.unitsUsed === 950, `หน่วยต้องคิดจาก 50 ไม่ใช่ 999 — ได้ ${r101.unitsUsed}`)
})

// -----------------------------------------------------
group('ลบใบจดมิเตอร์')

check('ลบใบที่ยังไม่ได้ออกบิลได้ และเลขที่จดไว้หายไปด้วย', () => {
  const batch = meter.createBatch(db, apartmentId, '2026-12-31')
  meter.saveBatchReadings(db, batch.batchId, 'water', [
    // รอบก่อนปิดที่ 1000 เลขรอบนี้จึงต้องมากกว่านั้น
    { roomId: room1.roomId, roomNumber: '101', currentReading: 1005 }
  ])
  meter.deleteBatch(db, batch.batchId)
  assert(meter.getBatchById(db, batch.batchId) === null, 'ใบต้องหายไป')
  const orphans = db
    .prepare('SELECT COUNT(*) AS n FROM meter_readings WHERE meter_batch_id = ?')
    .get(batch.batchId).n
  assert(orphans === 0, `เหลือเลขที่จดค้างอยู่ ${orphans} แถว`)
})

check('ลบใบที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => meter.deleteBatch(db, 9999), 'ไม่พบใบจดมิเตอร์', 'ต้องแจ้งเตือน')
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลจดมิเตอร์ทำงานครบทุกเส้นทาง')
