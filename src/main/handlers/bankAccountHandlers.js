import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  deleteBankAccount,
  getInvoiceNote,
  getPaymentInstructions,
  insertBankAccount,
  listBankAccounts,
  saveInvoiceNote,
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
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

function assertValid(payload) {
  const errors = validateBankAccountInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerBankAccountHandlers() {
  handleSession('bankAccount:list', ({ apartmentId }) => ({
    accounts: listBankAccounts(getDatabase(), apartmentId),
    paymentInstructions: getPaymentInstructions(getDatabase(), apartmentId),
    invoiceNote: getInvoiceNote(getDatabase(), apartmentId)
  }))

  // เขียนได้เฉพาะเจ้าของหอ — เลขบัญชีคือปลายทางเงินของทั้งหอ · list เปิดไว้ให้พิมพ์บิล
  handle('bankAccount:create', ({ apartmentId, ...payload }) => {
    requireOwnerUserId()
    assertValid(payload)
    const account = insertBankAccount(getDatabase(), apartmentId, payload)
    logInfo(`เพิ่มบัญชีธนาคาร ${account.bankName} (apartment_id ${apartmentId})`)
    return account
  })

  handle('bankAccount:update', ({ bankAccountId, ...payload }) => {
    requireOwnerUserId()
    assertValid(payload)
    const account = updateBankAccount(getDatabase(), bankAccountId, payload)
    logInfo(`แก้ไขบัญชีธนาคาร (bank_account_id ${bankAccountId})`)
    return account
  })

  handle('bankAccount:setDefault', ({ bankAccountId }) => {
    requireOwnerUserId()
    const accounts = setDefaultBankAccount(getDatabase(), bankAccountId)
    logInfo(`ตั้งบัญชีหลัก (bank_account_id ${bankAccountId})`)
    return accounts
  })

  handle('bankAccount:delete', ({ bankAccountId }) => {
    requireOwnerUserId()
    const accounts = deleteBankAccount(getDatabase(), bankAccountId)
    logInfo(`ลบบัญชีธนาคาร (bank_account_id ${bankAccountId})`)
    return accounts
  })

  handle('bankAccount:savePaymentInstructions', ({ apartmentId, text }) => {
    requireOwnerUserId()
    const saved = savePaymentInstructions(getDatabase(), apartmentId, text)
    logInfo(`บันทึกข้อความแจ้งการชำระเงิน (apartment_id ${apartmentId})`)
    return saved
  })

  handle('bankAccount:saveInvoiceNote', ({ apartmentId, text }) => {
    requireOwnerUserId()
    const saved = saveInvoiceNote(getDatabase(), apartmentId, text)
    logInfo(`บันทึกข้อความประจำท้ายบิล (apartment_id ${apartmentId})`)
    return saved
  })
}
