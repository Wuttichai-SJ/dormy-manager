// IPC ของโมดูลสัญญาเช่า — เปลือกบางๆ ครอบ db/contracts.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  createContract,
  getActiveContractByRoom,
  getContractById,
  listContractsByRoom,
  listRoomsForApartment,
  validateContractInput
} from '../db/contracts.js'

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

export function registerContractHandlers() {
  // หน้า "ห้องพัก" — หน้าหลักของระบบตามต้นแบบ
  handle('room:listForApartment', ({ apartmentId, search, tenant, rentType }) =>
    listRoomsForApartment(getDatabase(), apartmentId, { search, tenant, rentType })
  )

  // หน้ารายละเอียดห้อง: สัญญาที่ยังใช้งานอยู่ + ประวัติสัญญาทั้งหมดของห้องนั้น
  handle('contract:forRoom', ({ roomId }) => ({
    active: getActiveContractByRoom(getDatabase(), roomId),
    history: listContractsByRoom(getDatabase(), roomId)
  }))

  handle('contract:get', ({ contractId }) => {
    const contract = getContractById(getDatabase(), contractId)
    if (!contract) throw new Error('ไม่พบสัญญาที่ต้องการ')
    return contract
  })

  handle('contract:create', (payload) => {
    const errors = validateContractInput(payload)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    // ผู้รับเงินของใบเสร็จเงินจองมาจากเซสชันฝั่งนี้เสมอ ห้ามให้หน้าจอส่งมาเอง
    // (กฎเดียวกับ paymentHandlers — ไม่งั้นเปิด DevTools แล้วออกใบเสร็จในนามคนอื่นได้)
    const contract = createContract(getDatabase(), {
      ...payload,
      createdBy: requireSessionUserId()
    })
    logInfo(
      `สร้างสัญญา (contract_id ${contract.contractId}) ห้อง ${payload.roomId} ผู้เช่า ${contract.tenants.length} คน`
    )
    return contract
  })
}
