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
  listPaymentsForInvoice,
  listReceipts,
  recordContractPayment,
  recordInvoicePayment
} from '../db/payments.js'

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
  handle('payment:receive', ({ invoiceId, amount, paymentMethod, paymentDate, remark }) => {
    const payment = recordInvoicePayment(getDatabase(), {
      invoiceId,
      amount,
      paymentMethod,
      paymentDate,
      remark,
      createdBy: requireSessionUserId()
    })
    logInfo(`รับชำระ ${payment.receiptNumber} ห้อง ${payment.roomNumber} ${amount} บาท`)
    return payment
  })

  // ไม่มีช่องคืนเงินค่าบิล — ดู db/payments.js ว่าทำไม
  // การคืนเงินประกันตอนย้ายออกใช้ payment:receiveForContract พร้อม isRefund

  // ใบเสร็จเงินประกัน/เงินล่วงหน้าของสัญญา — ไม่มีใบแจ้งหนี้อยู่เบื้องหลัง
  handle(
    'payment:receiveForContract',
    ({ contractId, amount, paymentMethod, paymentDate, remark, isRefund }) => {
      const payment = recordContractPayment(getDatabase(), {
        contractId,
        amount,
        paymentMethod,
        paymentDate,
        remark,
        isRefund,
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

  handle('payment:listReceipts', ({ apartmentId, month }) =>
    listReceipts(getDatabase(), apartmentId, { month })
  )
}
