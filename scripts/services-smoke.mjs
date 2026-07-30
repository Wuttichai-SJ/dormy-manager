// ทดสอบโมดูลค่าบริการหอพัก — รันด้วย: npm run test:services
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
const svc = await import('../src/main/db/apartmentServices.js')

const { db, cleanup } = await openTempDatabase('dormy-services')

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอพักทดสอบ',
  addressTh: '1 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
})
const other = apartments.insertApartment(db, {
  nameTh: 'หอพักอีกแห่ง',
  addressTh: '2 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
})

// -----------------------------------------------------
group('ตรวจข้อมูลก่อนบันทึก')

check('รายงานข้อผิดพลาดครบทุกข้อในครั้งเดียว', () => {
  const errors = svc.validateServiceInput({ name: '   ', price: 'abc' })
  assert(errors.length === 2, `คาด 2 ข้อ ได้ ${errors.length}: ${errors.join(' | ')}`)
})

check('ราคา 0 ผ่านได้ (บริการที่แถมให้ฟรี)', () => {
  const errors = svc.validateServiceInput({ name: 'ค่าอินเทอร์เน็ต', price: '0' })
  assert(errors.length === 0, errors.join(' | '))
})

// -----------------------------------------------------
group('เพิ่ม / อ่าน')

const internet = svc.insertService(db, apartment.apartmentId, {
  name: '  ค่าอินเทอร์เน็ต  ',
  price: '300',
  isMeterBased: false,
  isVatEnabled: false
})

check('ตัดช่องว่างหัวท้ายชื่อก่อนเก็บ', () => {
  assert(internet.name === 'ค่าอินเทอร์เน็ต', `ได้ "${internet.name}"`)
})

check('เก็บราคาเป็นสตางค์', () => {
  assert(internet.priceCents === 30000, `ได้ ${internet.priceCents}`)
})

check('ค่าบริการเหมาจ่ายได้ kind = flat', () => {
  assert(internet.kind === 'flat', `ได้ ${internet.kind}`)
  assert(internet.isMeterBased === false, 'isMeterBased ควรเป็น false')
})

const water = svc.insertService(db, apartment.apartmentId, {
  name: 'ค่าน้ำอุ่น',
  price: '7.50',
  isMeterBased: true,
  isVatEnabled: true
})

check('ค่าบริการตามมิเตอร์ได้ kind = meter และเก็บสตางค์ถูก', () => {
  assert(water.kind === 'meter', `ได้ ${water.kind}`)
  assert(water.priceCents === 750, `ได้ ${water.priceCents}`)
  assert(water.isVatEnabled === true, 'isVatEnabled ควรเป็น true')
})

check('เรียงตามชื่อ', () => {
  const list = svc.listServices(db, apartment.apartmentId)
  assert(list.length === 2, `คาด 2 ได้ ${list.length}`)
  assert(list[0].name === 'ค่าน้ำอุ่น', `ตัวแรกคือ ${list[0].name}`)
})

check('แยกตามหอ ไม่ปนกัน', () => {
  svc.insertService(db, other.apartmentId, {
    name: 'ค่าอินเทอร์เน็ต',
    price: '400',
    isMeterBased: false,
    isVatEnabled: false
  })
  assert(svc.listServices(db, apartment.apartmentId).length === 2, 'หอแรกต้องมี 2 รายการ')
  assert(svc.listServices(db, other.apartmentId).length === 1, 'หอที่สองต้องมี 1 รายการ')
})

// -----------------------------------------------------
group('ชื่อซ้ำ')

check('ชื่อซ้ำในหอเดียวกันไม่ได้ และข้อความต้องอ่านรู้เรื่อง', () => {
  throws(
    () =>
      svc.insertService(db, apartment.apartmentId, {
        name: 'ค่าอินเทอร์เน็ต',
        price: '500',
        isMeterBased: false,
        isVatEnabled: false
      }),
    'อยู่แล้ว',
    'ควรกันชื่อซ้ำ'
  )
})

check('ชื่อซ้ำข้ามหอได้ (คนละหอคนละแคตตาล็อก)', () => {
  assert(
    svc.listServices(db, other.apartmentId)[0].name === 'ค่าอินเทอร์เน็ต',
    'หออื่นควรมีชื่อเดียวกันได้'
  )
})

check('แก้ไขโดยใช้ชื่อเดิมของตัวเองได้ ไม่ติดว่าซ้ำ', () => {
  const updated = svc.updateService(db, internet.serviceId, {
    name: 'ค่าอินเทอร์เน็ต',
    price: '350',
    isMeterBased: false,
    isVatEnabled: false
  })
  assert(updated.priceCents === 35000, `ได้ ${updated.priceCents}`)
  assert(Boolean(updated.updatedAt), 'ไม่ได้ตั้ง updated_at')
})

check('แก้ไขไปชนชื่อรายการอื่นไม่ได้', () => {
  throws(
    () =>
      svc.updateService(db, internet.serviceId, {
        name: 'ค่าน้ำอุ่น',
        price: '350',
        isMeterBased: false,
        isVatEnabled: false
      }),
    'อยู่แล้ว',
    'ควรกันการแก้ไปชนชื่อที่มีอยู่'
  )
})

check('แก้ไขรายการที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(
    () => svc.updateService(db, 9999, { name: 'x', price: '1' }),
    'ไม่พบค่าบริการ',
    'ควรแจ้งว่าไม่พบ'
  )
})

// -----------------------------------------------------
group('ลบ')

check('ลบรายการที่ยังไม่ถูกใช้ได้', () => {
  const temp = svc.insertService(db, apartment.apartmentId, {
    name: 'ค่าลบทิ้ง',
    price: '10',
    isMeterBased: false,
    isVatEnabled: false
  })
  svc.deleteService(db, temp.serviceId)
  assert(svc.getServiceById(db, temp.serviceId) === null, 'ยังลบไม่ออก')
})

check('ลบไม่ได้ถ้าผูกกับห้องอยู่ และต้องบอกจำนวนห้อง', () => {
  const now = new Date().toISOString()
  const floorId = db
    .prepare('INSERT INTO floors (apartment_id, floor_name, room_count, created_at) VALUES (?,?,?,?)')
    .run(apartment.apartmentId, 'ชั้น 1', 1, now).lastInsertRowid
  const typeId = db
    .prepare('INSERT INTO room_types (apartment_id, name, created_at) VALUES (?,?,?)')
    .run(apartment.apartmentId, 'ห้องพัดลม', now).lastInsertRowid
  const roomId = db
    .prepare(
      `INSERT INTO rooms (floor_id, room_type_id, room_number, is_active,
                          monthly_rent_cents, status, created_at)
       VALUES (?,?,?,1,350000,'vacant',?)`
    )
    .run(floorId, typeId, '101', now).lastInsertRowid
  db.prepare(
    'INSERT INTO room_services (apartment_service_id, room_id, created_at) VALUES (?,?,?)'
  ).run(internet.serviceId, roomId, now)

  throws(
    () => svc.deleteService(db, internet.serviceId),
    'ผูกกับห้องพักอยู่ 1 ห้อง',
    'ควรกันการลบค่าบริการที่ห้องใช้อยู่'
  )
})

check('ลบรายการที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => svc.deleteService(db, 9999), 'ไม่พบค่าบริการ', 'ควรแจ้งว่าไม่พบ')
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลค่าบริการทำงานครบทุกเส้นทาง')
