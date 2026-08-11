// IPC ของการแจ้งย้ายออก / ยกเลิกสัญญา / คืนเงินประกัน — เปลือกบางๆ ครอบ db/terminations.js
//
// **ผู้ทำรายการมาจากเซสชันฝั่ง main เสมอ** เหมือนผู้รับเงิน ผู้ลบบิล และผู้ยกเลิกใบเสร็จ —
// ใบเสร็จคืนเงินประกันที่ออกจากขั้นตอนนี้ต้องบอกได้ว่าใครเป็นคนคืน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  completeTermination,
  getTerminationByContract,
  getTerminationSheet,
  setMoveOutNotice
} from '../db/terminations.js'

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

export function registerTerminationHandlers() {
  // จังหวะแรก: บันทึกวันที่ผู้เช่าแจ้งย้ายออก (ยังไม่แตะอะไร ผู้เช่ายังอยู่ ห้องยังไม่ว่าง)
  // ส่ง noticeDate = null เพื่อยกเลิกการแจ้ง (ผู้เช่าเปลี่ยนใจไม่ย้ายแล้ว)
  handle('termination:setNotice', ({ contractId, noticeDate }) => {
    const result = setMoveOutNotice(getDatabase(), contractId, noticeDate ?? null)
    logInfo(
      noticeDate
        ? `แจ้งย้ายออก สัญญา ${contractId} วันที่ ${noticeDate}`
        : `ยกเลิกการแจ้งย้ายออก สัญญา ${contractId}`
    )
    return result
  })

  // หน้าสรุปก่อนยืนยัน — คำนวณอย่างเดียว ยังไม่เขียนอะไร หน้าจอเรียกซ้ำได้ทุกครั้งที่
  // ผู้ใช้เปลี่ยนวันที่ออกหรือเพิ่มรายการ
  handle('termination:sheet', ({ contractId, moveOutDate, adjustments, overrideRefundable }) =>
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

  handle('termination:get', ({ contractId }) =>
    getTerminationByContract(getDatabase(), contractId)
  )
}
