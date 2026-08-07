// IPC ของโมดูลออกบิล — เปลือกบางๆ ครอบ db/invoices.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  addInvoiceItem,
  cancelInvoice,
  createMonthlyInvoice,
  createMonthlyInvoicesForApartment,
  getInvoiceById,
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
      return { success: false, error: err.message }
    }
  })
}

export function registerInvoiceHandlers() {
  // ตารางขั้นที่ 3 ของ wizard ออกบิล — คำนวณอย่างเดียว ยังไม่เขียนอะไรลงฐานข้อมูล
  handle('invoice:preview', ({ apartmentId, meterBatchId, billingMonth }) =>
    previewMonthlyBilling(getDatabase(), { apartmentId, meterBatchId, billingMonth })
  )

  handle('invoice:createMonthly', ({ contractId, billingMonth, meterBatchId, issueDate }) => {
    const invoice = createMonthlyInvoice(getDatabase(), {
      contractId,
      billingMonth,
      meterBatchId,
      issueDate
    })
    logInfo(`ออกบิล ${invoice.invoiceNumber} ห้อง ${invoice.roomNumber} เดือน ${billingMonth}`)
    return invoice
  })

  // ปุ่ม "สร้างใบแจ้งหนี้ทุกห้อง" — คืน { created, skipped, failed } ให้หน้าจอสรุปให้ผู้ใช้
  // ห้องที่พังไม่ล้มทั้งชุด จึงต้อง log ไว้ด้วยว่ามีห้องไหนไม่ผ่านบ้าง
  handle('invoice:createMonthlyAll', ({ apartmentId, meterBatchId, billingMonth, issueDate }) => {
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

  handle('invoice:get', ({ invoiceId }) => getInvoiceById(getDatabase(), invoiceId))

  handle('invoice:list', ({ apartmentId, status, billingMonth, roomNumber }) =>
    listInvoices(getDatabase(), apartmentId, { status, billingMonth, roomNumber })
  )

  handle('invoice:addItem', ({ invoiceId, itemType, description, amount, isTaxable }) => {
    const invoice = addInvoiceItem(getDatabase(), invoiceId, {
      itemType,
      description,
      amount,
      isTaxable
    })
    logInfo(`เพิ่มรายการ "${description}" เข้าบิล ${invoice.invoiceNumber}`)
    return invoice
  })

  handle('invoice:removeItem', ({ invoiceId, invoiceItemId }) => {
    const invoice = removeInvoiceItem(getDatabase(), invoiceId, invoiceItemId)
    logInfo(`ลบรายการ ${invoiceItemId} ออกจากบิล ${invoice.invoiceNumber}`)
    return invoice
  })

  handle('invoice:cancel', ({ invoiceId }) => {
    const invoice = cancelInvoice(getDatabase(), invoiceId)
    logInfo(`ยกเลิกบิล ${invoice.invoiceNumber}`)
    return invoice
  })
}
