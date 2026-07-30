// ตัวห่อ IPC ของบัญชีธนาคารและข้อความแจ้งชำระเงิน
// ช่องทั้งหมดอยู่ที่ src/main/handlers/bankAccountHandlers.js
import { invoke } from './ipc.js'

export function listBankAccounts(apartmentId) {
  return invoke('bankAccount:list', { apartmentId })
}

export function createBankAccount(apartmentId, payload) {
  return invoke('bankAccount:create', { apartmentId, ...payload })
}

export function updateBankAccount(bankAccountId, payload) {
  return invoke('bankAccount:update', { bankAccountId, ...payload })
}

export function setDefaultBankAccount(bankAccountId) {
  return invoke('bankAccount:setDefault', { bankAccountId })
}

export function deleteBankAccount(bankAccountId) {
  return invoke('bankAccount:delete', { bankAccountId })
}

export function savePaymentInstructions(apartmentId, text) {
  return invoke('bankAccount:savePaymentInstructions', { apartmentId, text })
}
