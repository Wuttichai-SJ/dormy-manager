// ตัวห่อ IPC ของการออกบิล
// ช่องทั้งหมดอยู่ที่ src/main/handlers/invoiceHandlers.js
import { invoke } from './ipc.js'

// ตารางพรีวิวก่อนออกบิล — คำนวณอย่างเดียว ยังไม่มีอะไรถูกเขียน
export function previewMonthlyBilling({ apartmentId, meterBatchId, billingMonth }) {
  return invoke('invoice:preview', { apartmentId, meterBatchId, billingMonth })
}

export function createMonthlyInvoice({ contractId, billingMonth, meterBatchId, issueDate }) {
  return invoke('invoice:createMonthly', { contractId, billingMonth, meterBatchId, issueDate })
}

// คืน { created, skipped, failed } — หน้าจอต้องสรุปทั้งสามกองให้ผู้ใช้เห็น
// ห้องที่ออกบิลไปแล้วจะอยู่ใน skipped ไม่ใช่ failed
export function createMonthlyInvoicesForApartment({
  apartmentId,
  meterBatchId,
  billingMonth,
  issueDate
}) {
  return invoke('invoice:createMonthlyAll', {
    apartmentId,
    meterBatchId,
    billingMonth,
    issueDate
  })
}

export function getInvoice(invoiceId) {
  return invoke('invoice:get', { invoiceId })
}

// ค่าปรับชำระล่าช้า ณ วันที่รับเงินที่เลือก — ถามใหม่ทุกครั้งที่เปลี่ยนวันที่
// สูตรอยู่ฝั่ง main ที่เดียว หน้าจอไม่มีสำเนา
export function getLateFee(invoiceId, paymentDate) {
  return invoke('invoice:lateFee', { invoiceId, paymentDate })
}

export function listInvoices(apartmentId, filters = {}) {
  return invoke('invoice:list', { apartmentId, ...filters })
}

// itemType = 'service' | 'discount' | 'other' — ส่วนลดกรอกเป็นจำนวนบวก ระบบเก็บเป็นลบให้เอง
export function addInvoiceItem(invoiceId, item) {
  return invoke('invoice:addItem', { invoiceId, ...item })
}

export function removeInvoiceItem(invoiceId, invoiceItemId) {
  return invoke('invoice:removeItem', { invoiceId, invoiceItemId })
}

export function cancelInvoice(invoiceId) {
  return invoke('invoice:cancel', { invoiceId })
}

// ลบถาวร — ได้เฉพาะใบที่ยกเลิกแล้ว และต้องมีเหตุผลเสมอ (เหตุผลถูกเก็บไว้ในประวัติการลบ)
export function deleteInvoice(invoiceId, reason) {
  return invoke('invoice:delete', { invoiceId, reason })
}

export function listInvoiceDeletions(apartmentId) {
  return invoke('invoice:listDeletions', { apartmentId })
}
