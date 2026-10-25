// ไฟล์ใน db/ ห้าม import electron/logger — ชุดทดสอบรันแบบ node

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

export const RECOMMENDED_MAX_ACCOUNTS = 2

// จำนวนหลักของเลขบัญชีแต่ละธนาคาร (กลุ่มตัวเลขตามสมุดบัญชี) · ไม่อยู่ในนี้ = 10 หลัก
// สำเนาอยู่ใน renderer constants.js — แก้คู่กัน
export const BANK_ACCOUNT_GROUPS = {
  สแตนดาร์ดชาร์เตอร์ด: [3, 1, 5, 2],
  ออมสิน: [4, 4, 4],
  'ธกส (BAAC)': [3, 1, 5, 3]
}
const DEFAULT_ACCOUNT_GROUPS = [3, 1, 5, 1]
const PROMPTPAY = 'พร้อมเพย์'

function accountNumberError(bankName, digits) {
  if (bankName === PROMPTPAY) {
    return digits.length === 10 || digits.length === 13
      ? null
      : 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก'
  }
  const length = (BANK_ACCOUNT_GROUPS[bankName] ?? DEFAULT_ACCOUNT_GROUPS).reduce((a, b) => a + b, 0)
  return digits.length === length ? null : `เลขบัญชีธนาคารนี้ต้องมี ${length} หลัก`
}

export function validateBankAccountInput({ bankName, accountName, accountNumber }) {
  const errors = []

  if (!String(bankName ?? '').trim()) errors.push('กรุณาเลือกธนาคาร')
  else if (!BANKS.includes(String(bankName).trim())) errors.push('ไม่รู้จักธนาคารที่เลือก')

  if (!String(accountName ?? '').trim()) errors.push('กรุณากรอกชื่อบัญชี')

  const digits = normalizeAccountNumber(accountNumber)
  if (!digits) errors.push('กรุณากรอกเลขบัญชี')
  else if (BANKS.includes(String(bankName ?? '').trim())) {
    const error = accountNumberError(String(bankName).trim(), digits)
    if (error) errors.push(error)
  }

  return errors
}

export function normalizeAccountNumber(value) {
  return String(value ?? '').replace(/[^\d]/g, '')
}

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

// บัญชีแรกของหอเป็นบัญชีหลักอัตโนมัติ
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

// บัญชีหลักมีได้ใบเดียวต่อหอ — ทำในธุรกรรมเดียว
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

// ลบบัญชีหลักแล้วเลื่อนบัญชีอื่นขึ้นแทน
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

export function getInvoiceNote(db, apartmentId) {
  const row = db
    .prepare('SELECT invoice_note FROM apartments WHERE apartment_id = ?')
    .get(apartmentId)
  if (!row) throw new Error('ไม่พบหอพัก')
  return row.invoice_note ?? ''
}

export function saveInvoiceNote(db, apartmentId, text) {
  const trimmed = String(text ?? '').trim()

  const result = db
    .prepare('UPDATE apartments SET invoice_note = ?, updated_at = ? WHERE apartment_id = ?')
    .run(trimmed || null, new Date().toISOString(), apartmentId)

  if (result.changes === 0) throw new Error('ไม่พบหอพัก')
  return trimmed
}

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
