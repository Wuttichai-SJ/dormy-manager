// ตาราง apartment_bank_accounts — บัญชีรับเงินของหอ ที่จะถูกพิมพ์ลงใบแจ้งหนี้
//
// เก็บ "ชื่อธนาคาร" เป็นข้อความ ไม่ใช่รหัสตัวเลขที่อ้างตารางธนาคารแยก
// เหตุผล: อีก 20 ปีถ้าเปิดฐานข้อมูลนี้ขึ้นมาดู ต้องอ่านออกทันทีว่าเป็นบัญชีธนาคารอะไร
// ไม่ใช่เห็นเลข 2 แล้วต้องไปหาว่าตารางแปลรหัสหายไปไหน (ธนาคารควบรวม/เปลี่ยนชื่อกันได้)
//
// หมายเหตุสำคัญ: ไฟล์ใน db/ ห้าม import logger.js หรืออะไรที่ดึง electron เข้ามา
// เพราะชุดทดสอบรันใต้ ELECTRON_RUN_AS_NODE ซึ่งโมดูล 'electron' กลายเป็น CJS shim
// ที่ import แบบ ESM ไม่ได้ — ชั้น db ต้องเป็น SQL ล้วนๆ ทดสอบได้โดยไม่ต้องเปิดแอป
// การบันทึก log เป็นหน้าที่ของชั้น handlers

// รายชื่อธนาคารที่รองรับ — คัดมาจาก dropdown จริงของต้นแบบ (18 รายการ)
// "พร้อมเพย์" อยู่ในรายการเดียวกับธนาคารตามต้นแบบ ไม่ได้แยกเป็นฟีเจอร์ต่างหาก
export const BANKS = [
  'กรุงเทพ (Bangkok Bank)',
  'กสิกรไทย (Kasikorn)',
  'กรุงไทย (Krungthai)',
  'ไทยพาณิชย์ (SCB)',
  'กรุงศรีอยุธยา (Krungsri)',
  'เกียรตินาคิน',
  'ซีไอเอ็มบีไทย',
  'ทิสโก้',
  'ยูโอบี',
  'สแตนดาร์ดชาร์เตอร์ด',
  'ไทยเครดิตเพื่อรายย่อย',
  'แลนด์ แอนด์ เฮาส์',
  'ไอซีบีซี',
  'ออมสิน',
  'พร้อมเพย์',
  'ทีเอ็มบีธนชาต (TTB)',
  'อิสลามแห่งประเทศไทย (ibank)',
  'ธกส (BAAC)'
]

// ต้นแบบแนะนำว่า "ควรระบุไม่เกิน 2 รายชื่อธนาคาร" — เป็นคำแนะนำ ไม่ใช่ข้อบังคับ
// เพราะพื้นที่บนใบแจ้งหนี้จำกัด ใส่เยอะแล้วผู้เช่าจะงงว่าควรโอนบัญชีไหน
// เตือนที่หน้าจอ แต่ไม่ห้าม เผื่อหอที่มีเหตุผลของตัวเอง
export const RECOMMENDED_MAX_ACCOUNTS = 2

// -----------------------------------------------------
// ตรวจข้อมูล
// -----------------------------------------------------
export function validateBankAccountInput({ bankName, accountName, accountNumber }) {
  const errors = []

  if (!String(bankName ?? '').trim()) errors.push('กรุณาเลือกธนาคาร')
  else if (!BANKS.includes(String(bankName).trim())) errors.push('ไม่รู้จักธนาคารที่เลือก')

  if (!String(accountName ?? '').trim()) errors.push('กรุณากรอกชื่อบัญชี')

  // เลขบัญชีเก็บเป็นตัวเลขล้วน ตัดขีด/ช่องว่างที่คนพิมพ์ออก
  // ไม่บังคับจำนวนหลัก เพราะแต่ละธนาคารไม่เท่ากัน และพร้อมเพย์ใช้เบอร์โทร/เลขบัตรได้
  const digits = normalizeAccountNumber(accountNumber)
  if (!digits) errors.push('กรุณากรอกเลขบัญชี')
  else if (digits.length < 8 || digits.length > 20) errors.push('เลขบัญชีต้องมี 8-20 หลัก')

  return errors
}

export function normalizeAccountNumber(value) {
  return String(value ?? '').replace(/[^\d]/g, '')
}

// -----------------------------------------------------
// อ่าน
// -----------------------------------------------------
export function listBankAccounts(db, apartmentId) {
  return db
    .prepare(
      `SELECT * FROM apartment_bank_accounts
        WHERE apartment_id = ?
        ORDER BY is_default DESC, bank_account_id ASC`
    )
    .all(apartmentId)
    .map(toPublicBankAccount)
}

export function getBankAccountById(db, bankAccountId) {
  const row = db
    .prepare('SELECT * FROM apartment_bank_accounts WHERE bank_account_id = ?')
    .get(bankAccountId)
  return row ? toPublicBankAccount(row) : null
}

// -----------------------------------------------------
// เขียน
// -----------------------------------------------------
// บัญชีแรกของหอถูกตั้งเป็นบัญชีหลักให้อัตโนมัติ — ไม่งั้นหอที่มีบัญชีเดียวจะไม่มี
// บัญชีหลักเลย แล้วตอนออกบิลไม่รู้ว่าจะพิมพ์บัญชีไหนลงไป
export function insertBankAccount(db, apartmentId, input) {
  const isFirst =
    db
      .prepare('SELECT COUNT(*) AS n FROM apartment_bank_accounts WHERE apartment_id = ?')
      .get(apartmentId).n === 0

  const result = db
    .prepare(
      `INSERT INTO apartment_bank_accounts
         (apartment_id, bank_name, account_name, account_number, is_default, created_at)
       VALUES (@apartmentId, @bankName, @accountName, @accountNumber, @isDefault, @now)`
    )
    .run({
      apartmentId,
      bankName: String(input.bankName).trim(),
      accountName: String(input.accountName).trim(),
      accountNumber: normalizeAccountNumber(input.accountNumber),
      isDefault: isFirst ? 1 : 0,
      now: new Date().toISOString()
    })

  return getBankAccountById(db, result.lastInsertRowid)
}

export function updateBankAccount(db, bankAccountId, input) {
  const result = db
    .prepare(
      `UPDATE apartment_bank_accounts SET
         bank_name = @bankName,
         account_name = @accountName,
         account_number = @accountNumber,
         updated_at = @now
       WHERE bank_account_id = @bankAccountId`
    )
    .run({
      bankAccountId,
      bankName: String(input.bankName).trim(),
      accountName: String(input.accountName).trim(),
      accountNumber: normalizeAccountNumber(input.accountNumber),
      now: new Date().toISOString()
    })

  if (result.changes === 0) throw new Error('ไม่พบบัญชีธนาคารที่ต้องการแก้ไข')
  return getBankAccountById(db, bankAccountId)
}

// มีบัญชีหลักได้ทีละหนึ่งบัญชีต่อหอ — ล้างของเดิมแล้วตั้งใหม่ในธุรกรรมเดียว
// ถ้าทำแยกสองคำสั่งแล้วพลาดกลางทาง จะเหลือหอที่มีบัญชีหลักสองใบหรือไม่มีเลย
export function setDefaultBankAccount(db, bankAccountId) {
  const row = db
    .prepare('SELECT apartment_id FROM apartment_bank_accounts WHERE bank_account_id = ?')
    .get(bankAccountId)
  if (!row) throw new Error('ไม่พบบัญชีธนาคารที่ต้องการตั้งเป็นบัญชีหลัก')

  const run = db.transaction(() => {
    db.prepare('UPDATE apartment_bank_accounts SET is_default = 0 WHERE apartment_id = ?').run(
      row.apartment_id
    )
    db.prepare(
      'UPDATE apartment_bank_accounts SET is_default = 1, updated_at = ? WHERE bank_account_id = ?'
    ).run(new Date().toISOString(), bankAccountId)
  })
  run()

  return listBankAccounts(db, row.apartment_id)
}

// ลบบัญชีหลักแล้วต้องเลื่อนบัญชีอื่นขึ้นมาแทนทันที ไม่ปล่อยให้หอไม่มีบัญชีหลัก
export function deleteBankAccount(db, bankAccountId) {
  const row = db
    .prepare(
      'SELECT apartment_id, is_default FROM apartment_bank_accounts WHERE bank_account_id = ?'
    )
    .get(bankAccountId)
  if (!row) throw new Error('ไม่พบบัญชีธนาคารที่ต้องการลบ')

  const run = db.transaction(() => {
    db.prepare('DELETE FROM apartment_bank_accounts WHERE bank_account_id = ?').run(bankAccountId)

    if (row.is_default === 1) {
      const next = db
        .prepare(
          `SELECT bank_account_id FROM apartment_bank_accounts
            WHERE apartment_id = ? ORDER BY bank_account_id ASC LIMIT 1`
        )
        .get(row.apartment_id)
      if (next) {
        db.prepare(
          'UPDATE apartment_bank_accounts SET is_default = 1 WHERE bank_account_id = ?'
        ).run(next.bank_account_id)
      }
    }
  })
  run()

  return listBankAccounts(db, row.apartment_id)
}

// -----------------------------------------------------
// ข้อความแจ้งการชำระเงิน — เก็บอยู่ที่ apartments.payment_instructions
// อยู่หน้าเดียวกับบัญชีธนาคารตามต้นแบบ เพราะทั้งสองอย่างถูกพิมพ์ลงใบแจ้งหนี้ด้วยกัน
// -----------------------------------------------------
export function getPaymentInstructions(db, apartmentId) {
  const row = db
    .prepare('SELECT payment_instructions FROM apartments WHERE apartment_id = ?')
    .get(apartmentId)
  if (!row) throw new Error('ไม่พบหอพัก')
  return row.payment_instructions ?? ''
}

export function savePaymentInstructions(db, apartmentId, text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) throw new Error('กรุณากรอกข้อความแจ้งการชำระเงิน')

  const result = db
    .prepare('UPDATE apartments SET payment_instructions = ?, updated_at = ? WHERE apartment_id = ?')
    .run(trimmed, new Date().toISOString(), apartmentId)

  if (result.changes === 0) throw new Error('ไม่พบหอพัก')
  return trimmed
}

// -----------------------------------------------------
export function toPublicBankAccount(row) {
  if (!row) return null
  return {
    bankAccountId: row.bank_account_id,
    apartmentId: row.apartment_id,
    bankName: row.bank_name,
    accountName: row.account_name,
    accountNumber: row.account_number,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
