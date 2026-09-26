// ผู้รับเงินมาจากเซสชันเสมอ ไม่รับจาก payload
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  cancelPayment,
  getMultiPaymentSheet,
  listContractReceipts,
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

  // หลายห้องพร้อมกัน — สำเร็จหรือล้มทั้งชุด
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

  handleSession('payment:multiSheet', ({ apartmentId, billingMonth, paymentDate }) =>
    getMultiPaymentSheet(getDatabase(), apartmentId, { billingMonth, paymentDate })
  )

  handleSession('payment:billingMonths', ({ apartmentId }) =>
    listBillingMonths(getDatabase(), apartmentId)
  )

  // ยกเลิกใบเสร็จ: เฉพาะเจ้าของหอ ผู้ยกเลิกจากเซสชัน
  handle('payment:cancel', ({ paymentId, reason }) => {
    const result = cancelPayment(getDatabase(), paymentId, {
      reason,
      cancelledBy: requireOwnerUserId()
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

  handleSession('payment:contractReceipts', ({ contractId }) =>
    listContractReceipts(getDatabase(), contractId)
  )

  handleSession('payment:listForInvoice', ({ invoiceId }) =>
    listPaymentsForInvoice(getDatabase(), invoiceId)
  )

  handleSession('payment:listReceipts', ({ apartmentId, dateFrom, dateTo }) =>
    listReceipts(getDatabase(), apartmentId, { dateFrom, dateTo })
  )
}
