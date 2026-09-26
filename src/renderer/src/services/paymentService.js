import { invoke } from './ipc.js'

export function receivePayment({
  invoiceId,
  amount,
  paymentMethod,
  paymentDate,
  remark,
  lateFee
}) {
  return invoke('payment:receive', {
    invoiceId,
    amount,
    paymentMethod,
    paymentDate,
    remark,
    lateFee
  })
}

// rows = [{ invoiceId, roomNumber, amount, lateFee }] · ได้ใบเสร็จแยกใบต่อห้อง
export function receiveManyPayments({ rows, paymentMethod, paymentDate, remark }) {
  return invoke('payment:receiveMany', { rows, paymentMethod, paymentDate, remark })
}

export function getMultiPaymentSheet({ apartmentId, billingMonth, paymentDate }) {
  return invoke('payment:multiSheet', { apartmentId, billingMonth, paymentDate })
}

export function listBillingMonths(apartmentId) {
  return invoke('payment:billingMonths', { apartmentId })
}

export function cancelPayment(paymentId, reason) {
  return invoke('payment:cancel', { paymentId, reason })
}

// purpose = 'deposit' (ค่าตั้งต้น) | 'advance' | 'other'
export function receiveContractPayment({
  contractId,
  amount,
  paymentMethod,
  paymentDate,
  remark,
  isRefund,
  purpose
}) {
  return invoke('payment:receiveForContract', {
    contractId,
    amount,
    paymentMethod,
    paymentDate,
    remark,
    isRefund,
    purpose
  })
}

export function listContractReceipts(contractId) {
  return invoke('payment:contractReceipts', { contractId })
}

export function listPaymentsForInvoice(invoiceId) {
  return invoke('payment:listForInvoice', { invoiceId })
}

// คืน { receipts, receiptCount, totalAmountCents }
export function listReceipts(apartmentId, { dateFrom, dateTo } = {}) {
  return invoke('payment:listReceipts', { apartmentId, dateFrom, dateTo })
}
