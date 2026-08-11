// IPC ของโมดูลรับชำระเงิน — เปลือกบางๆ ครอบ db/payments.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
//
// **ผู้รับเงินมาจากเซสชันฝั่ง main เสมอ ไม่ใช่จาก payload** — ถ้าให้หน้าจอส่ง createdBy
// มาเอง ใครเปิด DevTools ก็ออกใบเสร็จในนามคนอื่นได้ แล้วคอลัมน์ "ผู้รับเงิน" ในรายงาน
// จะเชื่อถือไม่ได้ทั้งระบบ
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  cancelPayment,
  getMultiPaymentSheet,
  listPaymentsForInvoice,
  listReceipts,
  recordContractPayment,
  recordInvoicePayment,
  recordInvoicePayments
} from '../db/payments.js'
import { listBillingMonths } from '../db/invoices.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

export function registerPaymentHandlers() {
  handle('payment:receive', ({ invoiceId, amount, paymentMethod, paymentDate, remark, lateFee }) => {
    const payment = recordInvoicePayment(getDatabase(), {
      invoiceId,
      amount,
      paymentMethod,
      paymentDate,
      remark,
      lateFee,
      createdBy: requireSessionUserId()
    })
    logInfo(`รับชำระ ${payment.receiptNumber} ห้อง ${payment.roomNumber} ${amount} บาท`)
    return payment
  })

  // รับเงินหลายห้องพร้อมกัน — ได้ใบเสร็จแยกใบต่อห้อง แต่ทั้งชุดสำเร็จหรือล้มพร้อมกัน
  handle('payment:receiveMany', ({ rows, paymentMethod, paymentDate, remark }) => {
    const payments = recordInvoicePayments(getDatabase(), {
      rows,
      paymentMethod,
      paymentDate,
      remark,
      createdBy: requireSessionUserId()
    })
    logInfo(
      `รับชำระหลายห้อง ${payments.length} ใบ: ` +
        payments.map((p) => `${p.receiptNumber}/ห้อง ${p.roomNumber}`).join(', ')
    )
    return payments
  })

  handle('payment:multiSheet', ({ apartmentId, billingMonth, paymentDate }) =>
    getMultiPaymentSheet(getDatabase(), apartmentId, { billingMonth, paymentDate })
  )

  handle('payment:billingMonths', ({ apartmentId }) =>
    listBillingMonths(getDatabase(), apartmentId)
  )

  // ไม่มีช่องคืนเงินค่าบิล — ดู db/payments.js ว่าทำไม
  // การคืนเงินประกันตอนย้ายออกใช้ payment:receiveForContract พร้อม isRefund
  //
  // ยกเลิกใบเสร็จที่คีย์ผิด — เหตุผลบังคับกรอก และ **ผู้ยกเลิกมาจากเซสชันเสมอ**
  // เหมือนผู้รับเงิน ไม่งั้นบันทึกการยกเลิกก็เชื่อไม่ได้เหมือนกัน
  handle('payment:cancel', ({ paymentId, reason }) => {
    const result = cancelPayment(getDatabase(), paymentId, {
      reason,
      cancelledBy: requireSessionUserId()
    })
    logInfo(
      `ยกเลิกใบเสร็จ ${result.payment.receiptNumber} ` +
        `ห้อง ${result.payment.roomNumber ?? '-'}: ${result.payment.cancelReason}` +
        (result.lateFeeItemsRemoved > 0
          ? ` (ถอดรายการค่าปรับออกจากบิล ${result.lateFeeItemsRemoved} รายการ)`
          : '')
    )
    return result
  })

  // ใบเสร็จเงินประกัน/เงินล่วงหน้าของสัญญา — ไม่มีใบแจ้งหนี้อยู่เบื้องหลัง
  handle(
    'payment:receiveForContract',
    ({ contractId, amount, paymentMethod, paymentDate, remark, isRefund, purpose }) => {
      const payment = recordContractPayment(getDatabase(), {
        contractId,
        amount,
        paymentMethod,
        paymentDate,
        remark,
        isRefund,
        purpose,
        createdBy: requireSessionUserId()
      })
      logInfo(
        `ออกใบเสร็จสัญญา ${payment.receiptNumber} ห้อง ${payment.roomNumber} ` +
          `${isRefund ? 'คืนเงิน' : 'รับเงิน'} ${amount} บาท`
      )
      return payment
    }
  )

  handle('payment:listForInvoice', ({ invoiceId }) =>
    listPaymentsForInvoice(getDatabase(), invoiceId)
  )

  handle('payment:listReceipts', ({ apartmentId, dateFrom, dateTo }) =>
    listReceipts(getDatabase(), apartmentId, { dateFrom, dateTo })
  )
}
