// ตัวห่อ IPC ของการรับชำระเงิน
// ช่องทั้งหมดอยู่ที่ src/main/handlers/paymentHandlers.js
//
// ไม่ต้องส่ง "ผู้รับเงิน" ไปเอง — ฝั่ง main อ่านจากเซสชันที่ล็อกอินอยู่เสมอ
import { invoke } from './ipc.js'

// lateFee = ยอดค่าปรับที่จะเรียกเก็บพร้อมกัน (ไม่ส่ง = ไม่เก็บ)
// ฝั่ง main คิดเพดานเองและปฏิเสธถ้าเกินกฎของหอ
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

// รับเงินหลายห้องในครั้งเดียว
// rows = [{ invoiceId, roomNumber, amount, lateFee }] · ช่องทาง/วันที่/หมายเหตุ ใช้ร่วมกันทั้งชุด
// คืนอาร์เรย์ของใบเสร็จที่ออก — ใบละห้อง ไม่ได้ยุบเป็นใบเดียว
export function receiveManyPayments({ rows, paymentMethod, paymentDate, remark }) {
  return invoke('payment:receiveMany', { rows, paymentMethod, paymentDate, remark })
}

// บิลของเดือนที่เลือก พร้อมค่าปรับที่คิดได้ ณ วันที่รับเงิน (ค่าปรับขยับตามวันที่ จึงต้อง
// ดึงใหม่ทุกครั้งที่ผู้ใช้เปลี่ยนวัน — สูตรอยู่ฝั่ง main ที่เดียว)
export function getMultiPaymentSheet({ apartmentId, billingMonth, paymentDate }) {
  return invoke('payment:multiSheet', { apartmentId, billingMonth, paymentDate })
}

export function listBillingMonths(apartmentId) {
  return invoke('payment:billingMonths', { apartmentId })
}

// **ไม่มีการคืนเงินค่าบิล** — หอพักไม่มีสถานการณ์ที่ต้องคืนเงินค่าบิลให้ผู้เช่า
// (ผู้ใช้ตัดสินใจ 2026-08-08) ส่วนการคืนเงินประกันตอนย้ายออกใช้ receiveContractPayment
// พร้อม isRefund ซึ่งผูกกับสัญญา ไม่ใช่กับบิล

// ใบเสร็จเงินประกัน/เงินล่วงหน้าของสัญญา — ไม่มีใบแจ้งหนี้อยู่เบื้องหลัง
// purpose = 'deposit' (ค่าตั้งต้น) | 'advance' | 'other'
// เฉพาะใบที่เป็น 'deposit' เท่านั้นที่ถูกนับเป็นเงินประกันที่รับมาแล้ว
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

export function listPaymentsForInvoice(invoiceId) {
  return invoke('payment:listForInvoice', { invoiceId })
}

// กรองด้วยช่วงวันที่รับเงิน (ใส่ข้างเดียวหรือไม่ใส่เลยก็ได้)
// คืน { receipts, receiptCount, totalAmountCents }
export function listReceipts(apartmentId, { dateFrom, dateTo } = {}) {
  return invoke('payment:listReceipts', { apartmentId, dateFrom, dateTo })
}
