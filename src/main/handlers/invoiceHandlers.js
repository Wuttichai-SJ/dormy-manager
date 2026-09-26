import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  addInvoiceItem,
  cancelInvoice,
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  deleteInvoice,
  getInvoiceById,
  getLateFeeForInvoice,
  listInvoiceDeletions,
  listInvoices,
  previewMonthlyBilling,
  removeInvoiceItem
} from '../db/invoices.js'

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

export function registerInvoiceHandlers() {
  handleSession('invoice:preview', ({ apartmentId, meterBatchId, billingMonth }) =>
    previewMonthlyBilling(getDatabase(), { apartmentId, meterBatchId, billingMonth })
  )

  handleSession('invoice:createMonthly', ({ contractId, billingMonth, meterBatchId, issueDate }) => {
    const invoice = createMonthlyInvoice(getDatabase(), {
      contractId,
      billingMonth,
      meterBatchId,
      issueDate
    })
    logInfo(`ออกบิล ${invoice.invoiceNumber} ห้อง ${invoice.roomNumber} เดือน ${billingMonth}`)
    return invoice
  })

  handleSession('invoice:createMonthlyAll', ({ apartmentId, meterBatchId, billingMonth, issueDate }) => {
    const result = createMonthlyInvoicesForApartment(getDatabase(), {
      apartmentId,
      meterBatchId,
      billingMonth,
      issueDate
    })
    logInfo(
      `ออกบิลทั้งหอ ${apartmentId} เดือน ${billingMonth}: ` +
        `สร้าง ${result.created.length} ข้าม ${result.skipped.length} ไม่สำเร็จ ${result.failed.length}`
    )
    for (const item of result.failed) logError(`ออกบิลห้อง ${item.roomNumber} ไม่สำเร็จ: ${item.message}`)
    return result
  })

  handleSession('invoice:get', ({ invoiceId }) => getInvoiceById(getDatabase(), invoiceId))

  handleSession('invoice:lateFee', ({ invoiceId, paymentDate }) =>
    getLateFeeForInvoice(getDatabase(), invoiceId, paymentDate)
  )

  handleSession('invoice:list', ({ apartmentId, ...filters }) =>
    listInvoices(getDatabase(), apartmentId, filters)
  )

  handleSession('invoice:addItem', ({ invoiceId, itemType, description, amount, isTaxable }) => {
    const invoice = addInvoiceItem(getDatabase(), invoiceId, {
      itemType,
      description,
      amount,
      isTaxable
    })
    logInfo(`เพิ่มรายการ "${description}" เข้าบิล ${invoice.invoiceNumber}`)
    return invoice
  })

  handleSession('invoice:removeItem', ({ invoiceId, invoiceItemId }) => {
    const invoice = removeInvoiceItem(getDatabase(), invoiceId, invoiceItemId)
    logInfo(`ลบรายการ ${invoiceItemId} ออกจากบิล ${invoice.invoiceNumber}`)
    return invoice
  })

  // ผู้ยกเลิกมาจากเซสชันเสมอ
  handle('invoice:cancel', ({ invoiceId, reason }) => {
    const invoice = cancelInvoice(getDatabase(), invoiceId, {
      reason,
      cancelledBy: requireSessionUserId()
    })
    logInfo(`ยกเลิกบิล ${invoice.invoiceNumber} — เหตุผล: ${invoice.cancelReason}`)
    return invoice
  })

  // เฉพาะเจ้าของหอ · ผู้ลบมาจากเซสชัน
  handle('invoice:delete', ({ invoiceId, reason }) => {
    const result = deleteInvoice(getDatabase(), invoiceId, {
      reason,
      deletedBy: requireOwnerUserId()
    })
    logInfo(`ลบบิล ${result.invoiceNumber} — เหตุผล: ${String(reason ?? '').trim()}`)
    return result
  })

  handleSession('invoice:listDeletions', ({ apartmentId }) =>
    listInvoiceDeletions(getDatabase(), apartmentId)
  )
}
