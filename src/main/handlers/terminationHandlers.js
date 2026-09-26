import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  collectTerminationShortfall,
  completeTermination,
  getTerminationByContract,
  getTerminationSheet,
  listTerminations,
  setMoveOutNotice
} from '../db/terminations.js'

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

export function registerTerminationHandlers() {
  // noticeDate = null คือยกเลิกการแจ้ง
  handleSession('termination:setNotice', ({ contractId, noticeDate }) => {
    const result = setMoveOutNotice(getDatabase(), contractId, noticeDate ?? null)
    logInfo(
      noticeDate
        ? `แจ้งย้ายออก สัญญา ${contractId} วันที่ ${noticeDate}`
        : `ยกเลิกการแจ้งย้ายออก สัญญา ${contractId}`
    )
    return result
  })

  handleSession('termination:sheet', ({ contractId, moveOutDate, adjustments, overrideRefundable }) =>
    getTerminationSheet(getDatabase(), contractId, {
      moveOutDate,
      adjustments,
      overrideRefundable
    })
  )

  handle('termination:complete', (payload) => {
    const result = completeTermination(getDatabase(), payload.contractId, {
      moveOutDate: payload.moveOutDate,
      adjustments: payload.adjustments,
      overrideRefundable: payload.overrideRefundable,
      overrideReason: payload.overrideReason,
      allowOutstanding: payload.allowOutstanding,
      outstandingReason: payload.outstandingReason,
      collectShortfall: payload.collectShortfall,
      paymentMethod: payload.paymentMethod,
      createdBy: requireSessionUserId()
    })
    logInfo(
      `ย้ายออก ห้อง ${result.roomNumber} วันที่ ${result.moveOutDate} · ` +
        `เงินประกัน ${result.isDepositRefundable ? 'คืน' : `ริบ (${result.forfeitReason})`} · ` +
        `สุทธิ ${result.netRefundCents / 100} บาท` +
        (result.isManualOverride ? ' · เจ้าของกดข้ามผลการตัดสิน' : '')
    )
    return result
  })

  handleSession('termination:get', ({ contractId }) =>
    getTerminationByContract(getDatabase(), contractId)
  )

  handleSession('termination:list', ({ apartmentId, search, dateFrom, dateTo }) =>
    listTerminations(getDatabase(), apartmentId, { search, dateFrom, dateTo })
  )

  // ผู้รับเงินมาจากเซสชันเสมอ
  handle('termination:collect', (payload) => {
    const result = collectTerminationShortfall(getDatabase(), payload.contractId, {
      amount: payload.amount,
      paymentMethod: payload.paymentMethod,
      paymentDate: payload.paymentDate,
      remark: payload.remark,
      createdBy: requireSessionUserId()
    })
    logInfo(
      `รับเงินส่วนต่างย้ายออก ห้อง ${result.roomNumber} ` +
        `ใบเสร็จ ${result.receipt.receiptNumber} ${result.receipt.amountCents / 100} บาท · ` +
        `คงค้าง ${result.unpaidBalanceCents / 100} บาท`
    )
    return result
  })
}
