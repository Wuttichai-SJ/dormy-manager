// IPC ของบัญชีธนาคารและข้อความแจ้งชำระเงิน — เปลือกบางๆ ครอบ db/bankAccounts.js
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

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็ม (ภัยจาก DevTools ตอนหน้าจอค้างที่
// ล็อกอิน และช่องไหนห้ามใส่การ์ด) อยู่เหนือ requireSessionUserId() ใน authHandlers.js
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

  // 🔴 **ทุกช่องที่ "เขียน" ตรงนี้เป็นของเจ้าของหอเท่านั้น** (ช่อง list เปิดไว้ เพราะบิลที่
  // พนักงานพิมพ์ต้องมีกล่องบัญชีอยู่ท้ายเอกสาร)
  //
  // เลขบัญชีคือปลายทางที่ผู้เช่าโอนเงินไป การแก้ตรงนี้จึงไม่ใช่ "แก้ข้อมูลตั้งค่า" แต่คือ
  // การเปลี่ยนว่าเงินค่าเช่าทั้งหอจะเข้ากระเป๋าใคร — และเป็นการขโมยที่มองไม่เห็น: บิล
  // หน้าตาปกติทุกอย่าง ผู้เช่าโอนตามปกติและมีสลิปยืนยันว่าจ่ายแล้ว กว่าจะรู้ตัวก็ตอน
  // กระทบยอดกับธนาคารซึ่งอาจเป็นสัปดาห์ถัดมา (ผู้ใช้ทักท้วง 2026-08-14)
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

  // บัญชีหลักคือใบที่ขึ้นบนบิล สลับบัญชีหลักจึงเปลี่ยนปลายทางเงินได้เท่ากับแก้เลขบัญชี
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

  // "โอนแล้วแจ้งที่ไหน" ก็เปลี่ยนปลายทางได้เหมือนกัน (เช่น เปลี่ยนเป็นไลน์ไอดีของตัวเอง
  // แล้วคอยตอบรับสลิปแทนหอ) จึงอยู่ชั้นเดียวกับเลขบัญชี ไม่ใช่ข้อความตกแต่ง
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
