import { invoke } from './ipc.js'

export function previewMonthlyBilling({ apartmentId, meterBatchId, billingMonth }) {
  return invoke('invoice:preview', { apartmentId, meterBatchId, billingMonth })
}

export function createMonthlyInvoice({ contractId, billingMonth, meterBatchId, issueDate }) {
  return invoke('invoice:createMonthly', { contractId, billingMonth, meterBatchId, issueDate })
}

// คืน { created, skipped, failed }
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

export function getLateFee(invoiceId, paymentDate) {
  return invoke('invoice:lateFee', { invoiceId, paymentDate })
}

export function listInvoices(apartmentId, filters = {}) {
  return invoke('invoice:list', { apartmentId, ...filters })
}

// itemType = 'service' | 'discount' | 'other' — ส่วนลดกรอกเป็นบวก
export function addInvoiceItem(invoiceId, item) {
  return invoke('invoice:addItem', { invoiceId, ...item })
}

export function removeInvoiceItem(invoiceId, invoiceItemId) {
  return invoke('invoice:removeItem', { invoiceId, invoiceItemId })
}

export function cancelInvoice(invoiceId, reason) {
  return invoke('invoice:cancel', { invoiceId, reason })
}

export function deleteInvoice(invoiceId, reason) {
  return invoke('invoice:delete', { invoiceId, reason })
}

export function listInvoiceDeletions(apartmentId) {
  return invoke('invoice:listDeletions', { apartmentId })
}
