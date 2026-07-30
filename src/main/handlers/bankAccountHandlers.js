// IPC ของบัญชีธนาคารและข้อความแจ้งชำระเงิน — เปลือกบางๆ ครอบ db/bankAccounts.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  deleteBankAccount,
  getPaymentInstructions,
  insertBankAccount,
  listBankAccounts,
  savePaymentInstructions,
  setDefaultBankAccount,
  updateBankAccount,
  validateBankAccountInput
} from '../db/bankAccounts.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`IPC ${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

function assertValid(payload) {
  const errors = validateBankAccountInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerBankAccountHandlers() {
  handle('bankAccount:list', ({ apartmentId }) => ({
    accounts: listBankAccounts(getDatabase(), apartmentId),
    paymentInstructions: getPaymentInstructions(getDatabase(), apartmentId)
  }))

  handle('bankAccount:create', ({ apartmentId, ...payload }) => {
    assertValid(payload)
    const account = insertBankAccount(getDatabase(), apartmentId, payload)
    logInfo(`เพิ่มบัญชีธนาคาร ${account.bankName} (apartment_id ${apartmentId})`)
    return account
  })

  handle('bankAccount:update', ({ bankAccountId, ...payload }) => {
    assertValid(payload)
    const account = updateBankAccount(getDatabase(), bankAccountId, payload)
    logInfo(`แก้ไขบัญชีธนาคาร (bank_account_id ${bankAccountId})`)
    return account
  })

  handle('bankAccount:setDefault', ({ bankAccountId }) => {
    const accounts = setDefaultBankAccount(getDatabase(), bankAccountId)
    logInfo(`ตั้งบัญชีหลัก (bank_account_id ${bankAccountId})`)
    return accounts
  })

  handle('bankAccount:delete', ({ bankAccountId }) => {
    const accounts = deleteBankAccount(getDatabase(), bankAccountId)
    logInfo(`ลบบัญชีธนาคาร (bank_account_id ${bankAccountId})`)
    return accounts
  })

  handle('bankAccount:savePaymentInstructions', ({ apartmentId, text }) => {
    const saved = savePaymentInstructions(getDatabase(), apartmentId, text)
    logInfo(`บันทึกข้อความแจ้งการชำระเงิน (apartment_id ${apartmentId})`)
    return saved
  })
}
