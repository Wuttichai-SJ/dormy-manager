// ตัวห่อ IPC ของการรับชำระเงิน
// ช่องทั้งหมดอยู่ที่ src/main/handlers/paymentHandlers.js
//
// ไม่ต้องส่ง "ผู้รับเงิน" ไปเอง — ฝั่ง main อ่านจากเซสชันที่ล็อกอินอยู่เสมอ
import { invoke } from './ipc.js'

export function receivePayment({ invoiceId, amount, paymentMethod, paymentDate, remark }) {
  return invoke('payment:receive', { invoiceId, amount, paymentMethod, paymentDate, remark })
}

// คืนเงินเขียนเป็นใบเสร็จยอดติดลบอีกใบ ไม่ได้ลบใบเดิม — amount กรอกเป็นจำนวนบวก
export function refundPayment({ invoiceId, amount, paymentMethod, paymentDate, remark }) {
  return invoke('payment:refund', { invoiceId, amount, paymentMethod, paymentDate, remark })
}

// ใบเสร็จเงินประกัน/เงินล่วงหน้าของสัญญา — ไม่มีใบแจ้งหนี้อยู่เบื้องหลัง
export function receiveContractPayment({
  contractId,
  amount,
  paymentMethod,
  paymentDate,
  remark,
  isRefund
}) {
  return invoke('payment:receiveForContract', {
    contractId,
    amount,
    paymentMethod,
    paymentDate,
    remark,
    isRefund
  })
}

export function listPaymentsForInvoice(invoiceId) {
  return invoke('payment:listForInvoice', { invoiceId })
}

// month = 'YYYY-MM' หรือไม่ส่งเพื่อเอาทุกใบ — คืน { receipts, receiptCount, totalAmountCents }
export function listReceipts(apartmentId, month) {
  return invoke('payment:listReceipts', { apartmentId, month })
}
