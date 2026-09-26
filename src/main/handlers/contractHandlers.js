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

export function registerContractHandlers() {
  handleSession('room:listForApartment', ({ apartmentId, search, tenant, rentType }) =>
    listRoomsForApartment(getDatabase(), apartmentId, { search, tenant, rentType })
  )

  handleSession('contract:forRoom', ({ roomId }) => ({
    active: getActiveContractByRoom(getDatabase(), roomId),
    history: listContractsByRoom(getDatabase(), roomId)
  }))

  handleSession('contract:get', ({ contractId }) => {
    const contract = getContractById(getDatabase(), contractId)
    if (!contract) throw new Error('ไม่พบสัญญาที่ต้องการ')
    return contract
  })

  handle('contract:create', (payload) => {
    const errors = validateContractInput(payload)
    if (errors.length > 0) throw new Error(errors.join('\n'))

    // ผู้รับเงินมาจากเซสชันเสมอ ไม่รับจากหน้าจอ
    const contract = createContract(getDatabase(), {
      ...payload,
      // fromBookingId ได้ผ่าน booking:convert เท่านั้น — ทิ้งค่าที่หน้าจอส่งมา
      fromBookingId: undefined,
      createdBy: requireSessionUserId()
    })
    logInfo(
      `สร้างสัญญา (contract_id ${contract.contractId}) ห้อง ${payload.roomId} ผู้เช่า ${contract.tenants.length} คน`
    )
    return contract
  })
}
