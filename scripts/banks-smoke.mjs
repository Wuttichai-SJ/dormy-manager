// ทดสอบบัญชีธนาคารและข้อความแจ้งชำระเงิน — รันด้วย: npm run test:banks
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
const banks = await import('../src/main/db/bankAccounts.js')

const { db, cleanup } = await openTempDatabase('dormy-banks')

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอพักทดสอบ',
  addressTh: '1 ถนนทดสอบ',
  dueDateDay: 5,
  lateFeePerDay: '0',
  isAutoLateFeeEnabled: false,
  isVatEnabled: false
})
const id = apartment.apartmentId

const KBANK = 'กสิกรไทย (Kasikorn)'
const SCB = 'ไทยพาณิชย์ (SCB)'
const PROMPTPAY = 'พร้อมเพย์'

// -----------------------------------------------------
group('ตรวจข้อมูล')

check('รายงานข้อผิดพลาดครบทุกข้อในครั้งเดียว', () => {
  const errors = banks.validateBankAccountInput({
    bankName: '',
    accountName: '',
    accountNumber: ''
  })
  assert(errors.length === 3, `คาด 3 ข้อ ได้ ${errors.length}: ${errors.join(' | ')}`)
})

check('ธนาคารนอกรายการถูกปฏิเสธ', () => {
  const errors = banks.validateBankAccountInput({
    bankName: 'ธนาคารที่ไม่มีอยู่จริง',
    accountName: 'ทดสอบ',
    accountNumber: '1234567890'
  })
  assert(errors.length === 1, errors.join(' | '))
  assert(errors[0].includes('ไม่รู้จัก'), errors[0])
})

check('เลขบัญชีสั้น/ยาวเกินถูกปฏิเสธ', () => {
  const short = banks.validateBankAccountInput({
    bankName: KBANK,
    accountName: 'ทดสอบ',
    accountNumber: '123'
  })
  assert(short.length === 1, short.join(' | '))

  const long = banks.validateBankAccountInput({
    bankName: KBANK,
    accountName: 'ทดสอบ',
    accountNumber: '1'.repeat(21)
  })
  assert(long.length === 1, long.join(' | '))
})

check('เลขบัญชีมีขีดยังผ่านได้ (นับเฉพาะตัวเลข)', () => {
  const errors = banks.validateBankAccountInput({
    bankName: KBANK,
    accountName: 'ทดสอบ',
    accountNumber: '123-4-56789-0'
  })
  assert(errors.length === 0, errors.join(' | '))
})

check('พร้อมเพย์อยู่ในรายการธนาคาร (ตามต้นแบบ)', () => {
  assert(banks.BANKS.includes(PROMPTPAY), 'ควรมีพร้อมเพย์ใน BANKS')
  assert(banks.BANKS.length === 18, `คาด 18 รายการ ได้ ${banks.BANKS.length}`)
})

// -----------------------------------------------------
group('เพิ่ม / บัญชีหลัก')

const first = banks.insertBankAccount(db, id, {
  bankName: KBANK,
  accountName: 'นายทดสอบ ระบบ',
  accountNumber: '123-4-56789-0'
})

check('เก็บเลขบัญชีเป็นตัวเลขล้วน', () => {
  assert(first.accountNumber === '123456789 0'.replace(' ', ''), `ได้ ${first.accountNumber}`)
})

check('บัญชีแรกถูกตั้งเป็นบัญชีหลักอัตโนมัติ', () => {
  assert(first.isDefault === true, 'บัญชีแรกควรเป็นบัญชีหลัก')
})

const second = banks.insertBankAccount(db, id, {
  bankName: SCB,
  accountName: 'นายทดสอบ ระบบ',
  accountNumber: '98765432109'
})

check('บัญชีถัดมาไม่ถูกตั้งเป็นหลักเอง', () => {
  assert(second.isDefault === false, 'บัญชีที่สองไม่ควรเป็นบัญชีหลัก')
})

check('มีบัญชีหลักได้ทีละหนึ่งเดียว', () => {
  const list = banks.setDefaultBankAccount(db, second.bankAccountId)
  const defaults = list.filter((a) => a.isDefault)
  assert(defaults.length === 1, `มีบัญชีหลัก ${defaults.length} บัญชี`)
  assert(defaults[0].bankAccountId === second.bankAccountId, 'บัญชีหลักไม่ใช่ใบที่สั่ง')
})

check('บัญชีหลักถูกเรียงขึ้นก่อนเสมอ', () => {
  const list = banks.listBankAccounts(db, id)
  assert(list[0].isDefault === true, `ตัวแรกคือ ${list[0].bankName} ซึ่งไม่ใช่บัญชีหลัก`)
})

// -----------------------------------------------------
group('แก้ไข / ลบ')

check('แก้ไขแล้วค่าเปลี่ยนและมี updated_at', () => {
  const updated = banks.updateBankAccount(db, first.bankAccountId, {
    bankName: KBANK,
    accountName: 'นางสาวทดสอบ ระบบ',
    accountNumber: '111 222 3333'
  })
  assert(updated.accountName === 'นางสาวทดสอบ ระบบ', updated.accountName)
  assert(updated.accountNumber === '1112223333', updated.accountNumber)
  assert(Boolean(updated.updatedAt), 'ไม่ได้ตั้ง updated_at')
})

check('แก้ไขบัญชีที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(
    () =>
      banks.updateBankAccount(db, 9999, {
        bankName: KBANK,
        accountName: 'x',
        accountNumber: '12345678'
      }),
    'ไม่พบบัญชีธนาคาร',
    'ควรแจ้งว่าไม่พบ'
  )
})

check('ลบบัญชีหลักแล้วบัญชีอื่นถูกเลื่อนขึ้นมาเป็นหลักแทน', () => {
  // ตอนนี้บัญชีหลักคือ second — ลบทิ้งแล้ว first ต้องกลายเป็นหลักอัตโนมัติ
  const list = banks.deleteBankAccount(db, second.bankAccountId)
  assert(list.length === 1, `เหลือ ${list.length} บัญชี`)
  assert(list[0].isDefault === true, 'บัญชีที่เหลือควรถูกตั้งเป็นหลักให้อัตโนมัติ')
})

check('ลบบัญชีสุดท้ายได้ ไม่ค้าง', () => {
  const list = banks.deleteBankAccount(db, first.bankAccountId)
  assert(list.length === 0, `เหลือ ${list.length} บัญชี`)
})

check('ลบบัญชีที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => banks.deleteBankAccount(db, 9999), 'ไม่พบบัญชีธนาคาร', 'ควรแจ้งว่าไม่พบ')
})

check('บัญชีของคนละหอไม่ปนกัน', () => {
  const other = apartments.insertApartment(db, {
    nameTh: 'หอพักอีกแห่ง',
    addressTh: '2 ถนนทดสอบ',
    dueDateDay: 5,
    lateFeePerDay: '0',
    isAutoLateFeeEnabled: false,
    isVatEnabled: false
  })
  banks.insertBankAccount(db, other.apartmentId, {
    bankName: PROMPTPAY,
    accountName: 'หออีกแห่ง',
    accountNumber: '0812345678'
  })
  assert(banks.listBankAccounts(db, id).length === 0, 'หอแรกไม่ควรมีบัญชีแล้ว')
  assert(banks.listBankAccounts(db, other.apartmentId).length === 1, 'หอที่สองควรมี 1 บัญชี')
})

// -----------------------------------------------------
group('ข้อความแจ้งการชำระเงิน')

check('หอใหม่ยังไม่มีข้อความ คืนค่าว่าง ไม่ใช่ null', () => {
  assert(banks.getPaymentInstructions(db, id) === '', 'ควรได้สตริงว่าง')
})

check('บันทึกแล้วอ่านกลับได้ และถูก trim', () => {
  banks.savePaymentInstructions(db, id, '  โอนแล้วแจ้ง Line: @test  ')
  assert(
    banks.getPaymentInstructions(db, id) === 'โอนแล้วแจ้ง Line: @test',
    banks.getPaymentInstructions(db, id)
  )
})

check('ข้อความว่างถูกปฏิเสธ', () => {
  throws(
    () => banks.savePaymentInstructions(db, id, '   '),
    'กรุณากรอก',
    'ควรปฏิเสธข้อความว่าง'
  )
})

check('บันทึกให้หอที่ไม่มีอยู่ต้องแจ้งเตือน', () => {
  throws(() => banks.savePaymentInstructions(db, 9999, 'x'), 'ไม่พบหอพัก', 'ควรแจ้งว่าไม่พบ')
})

// -----------------------------------------------------
cleanup()
summarize('โมดูลบัญชีธนาคารทำงานครบทุกเส้นทาง')
