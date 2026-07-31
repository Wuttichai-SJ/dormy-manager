// ทดสอบโมดูลผู้เช่าบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:tenants
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

const tenants = await import('../src/main/db/tenants.js')

const { db, cleanup } = await openTempDatabase('dormy-tenants')

const BASE = {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0812345678',
  idCardNo: '1234567890123'
}

// -----------------------------------------------------
group('ตรวจข้อมูล')

check('ชื่อและนามสกุลบังคับกรอก', () => {
  const errors = tenants.validateTenantInput({ firstName: ' ', lastName: '', phone: '0812345678' })
  assert(errors.some((e) => e.includes('ชื่อผู้เช่า')), errors.join(', '))
  assert(errors.some((e) => e.includes('นามสกุล')), errors.join(', '))
})

check('เบอร์โทรบังคับกรอก และต้อง 9-10 หลัก', () => {
  assert(tenants.validateTenantInput({ ...BASE, phone: '' }).length === 1, 'ต้องแจ้งว่าไม่ได้กรอกเบอร์')
  assert(tenants.validateTenantInput({ ...BASE, phone: '12345' }).length === 1, 'เบอร์สั้นไปต้องไม่ผ่าน')
  assert(tenants.validateTenantInput({ ...BASE, phone: '021234567' }).length === 0, 'เบอร์บ้าน 9 หลักต้องผ่าน')
})

// จุดที่ผู้ใช้ตัดสินใจไว้เอง (2026-07-31): ไม่บังคับกรอก แต่ถ้ากรอกต้องถูกและห้ามซ้ำ
check('เลขบัตรประชาชนเว้นว่างได้', () => {
  assert(tenants.validateTenantInput({ ...BASE, idCardNo: '' }).length === 0, 'เว้นว่างต้องผ่าน')
  assert(tenants.validateTenantInput({ ...BASE, idCardNo: null }).length === 0, 'ไม่ส่งมาเลยต้องผ่าน')
})

check('เลขบัตรที่กรอกมาต้องครบ 13 หลัก', () => {
  const errors = tenants.validateTenantInput({ ...BASE, idCardNo: '123' })
  assert(errors.some((e) => e.includes('13 หลัก')), errors.join(', '))
})

// -----------------------------------------------------
group('เพิ่ม / แก้ไข')

check('เพิ่มผู้เช่าได้ และเก็บเบอร์เป็นตัวเลขล้วน', () => {
  const created = tenants.insertTenant(db, { ...BASE, phone: '081-234-5678' })
  assert(created.phone === '0812345678', `ได้ ${created.phone}`)
  assert(created.fullName === 'สมชาย ใจดี', created.fullName)
  assert(created.activeContracts === 0, 'ผู้เช่าใหม่ยังไม่มีสัญญา')
})

check('เลขบัตรที่มีขีดถูกตัดเหลือตัวเลขล้วน', () => {
  const created = tenants.insertTenant(db, {
    firstName: 'สมหญิง',
    lastName: 'รักเรียน',
    phone: '0823456789',
    idCardNo: '1-2345-67890-12-4'
  })
  assert(created.idCardNo === '1234567890124', `ได้ ${created.idCardNo}`)
})

check('เว้นเลขบัตรว่างได้หลายคน โดยไม่ชนกันเอง', () => {
  const a = tenants.insertTenant(db, { firstName: 'ก', lastName: 'ก', phone: '0830000001' })
  const b = tenants.insertTenant(db, { firstName: 'ข', lastName: 'ข', phone: '0830000002' })
  assert(a.idCardNo === null, `ควรเป็น null ได้ ${a.idCardNo}`)
  assert(b.idCardNo === null, `ควรเป็น null ได้ ${b.idCardNo}`)
})

check('เบอร์ซ้ำไม่ได้ และต้องบอกว่าซ้ำกับใคร', () => {
  throws(
    () => tenants.insertTenant(db, { firstName: 'ค', lastName: 'ค', phone: '0812345678' }),
    'สมชาย ใจดี',
    'ควรบอกชื่อคนที่ใช้เบอร์นี้อยู่'
  )
})

check('เลขบัตรซ้ำไม่ได้', () => {
  throws(
    () => tenants.insertTenant(db, {
      firstName: 'ง',
      lastName: 'ง',
      phone: '0840000000',
      idCardNo: '1234567890123'
    }),
    'เลขบัตรประชาชน',
    'ควรกันเลขบัตรซ้ำ'
  )
})

check('แก้ไขผู้เช่าได้ และไม่ติดว่าซ้ำกับตัวเอง', () => {
  const target = tenants.listTenants(db).find((t) => t.phone === '0812345678')
  const updated = tenants.updateTenant(db, target.tenantId, {
    ...BASE,
    lastName: 'ใจงาม',
    address: '  123 ถนนสุขุมวิท  '
  })
  assert(updated.lastName === 'ใจงาม', updated.lastName)
  assert(updated.address === '123 ถนนสุขุมวิท', `ควรตัดช่องว่าง ได้ "${updated.address}"`)
})

check('แก้ไปชนเบอร์คนอื่นไม่ได้', () => {
  const target = tenants.listTenants(db).find((t) => t.phone === '0812345678')
  throws(
    () => tenants.updateTenant(db, target.tenantId, { ...BASE, phone: '0823456789' }),
    'ถูกใช้กับผู้เช่า',
    'ควรกันการแก้ไปชนคนอื่น'
  )
})

// -----------------------------------------------------
group('ค้นหา')

check('ค้นด้วยชื่อได้', () => {
  const found = tenants.listTenants(db, { search: 'สมหญิง' })
  assert(found.length === 1 && found[0].lastName === 'รักเรียน', JSON.stringify(found.map((t) => t.fullName)))
})

check('ค้นด้วยเบอร์ที่พิมพ์มีขีดก็เจอ', () => {
  const found = tenants.listTenants(db, { search: '082-345-6789' })
  assert(found.length === 1 && found[0].firstName === 'สมหญิง', JSON.stringify(found.map((t) => t.fullName)))
})

check('ค้นด้วยเลขบัตรบางส่วนก็เจอ', () => {
  const found = tenants.listTenants(db, { search: '7890124' })
  assert(found.length === 1 && found[0].firstName === 'สมหญิง', JSON.stringify(found.map((t) => t.fullName)))
})

check('ค้นแล้วไม่เจอคืนรายการว่าง ไม่ใช่คืนทั้งหมด', () => {
  assert(tenants.listTenants(db, { search: 'ไม่มีคนนี้' }).length === 0, 'ควรได้รายการว่าง')
})

// -----------------------------------------------------
group('ลบ')

check('ลบผู้เช่าที่ยังไม่มีสัญญาได้', () => {
  const target = tenants.listTenants(db, { search: '0830000001' })[0]
  tenants.deleteTenant(db, target.tenantId)
  assert(tenants.getTenantById(db, target.tenantId) === null, 'ผู้เช่าต้องถูกลบจริง')
})

check('ลบผู้เช่าที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => tenants.deleteTenant(db, 9999), 'ไม่พบผู้เช่า', 'ควรแจ้งว่าไม่พบ')
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลผู้เช่าทำงานครบทุกเส้นทาง')
