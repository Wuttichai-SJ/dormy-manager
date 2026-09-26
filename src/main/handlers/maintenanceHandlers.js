import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  addMaintenanceImage,
  cancelMaintenance,
  completeMaintenance,
  createMaintenanceRequest,
  deleteMaintenanceRequest,
  getMaintenanceRequest,
  listMaintenanceRequests,
  removeMaintenanceImage,
  reopenMaintenance,
  updateMaintenanceRequest
} from '../db/maintenance.js'
import { getImageDataUrl } from '../db/images.js'

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

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

export function registerMaintenanceHandlers() {
  handleSession('maintenance:list', ({ apartmentId, status, search, dateFrom, dateTo }) =>
    listMaintenanceRequests(getDatabase(), apartmentId, { status, search, dateFrom, dateTo })
  )

  handleSession('maintenance:get', ({ maintenanceId }) =>
    getMaintenanceRequest(getDatabase(), maintenanceId)
  )

  handleSession('maintenance:create', (payload) => {
    const request = createMaintenanceRequest(getDatabase(), {
      roomId: payload.roomId,
      reportedDate: payload.reportedDate,
      description: payload.description,
      appointmentDate: payload.appointmentDate
    })
    logInfo(`รับแจ้งซ่อม ห้อง ${request.roomNumber} (maintenance_id ${request.maintenanceId})`)
    return request
  })

  handleSession('maintenance:update', (payload) =>
    updateMaintenanceRequest(getDatabase(), payload.maintenanceId, {
      reportedDate: payload.reportedDate,
      description: payload.description,
      appointmentDate: payload.appointmentDate
    })
  )

  handleSession('maintenance:complete', (payload) => {
    const request = completeMaintenance(getDatabase(), payload.maintenanceId, {
      repairedDate: payload.repairedDate,
      repairCost: payload.repairCost,
      repairDetails: payload.repairDetails
    })
    logInfo(
      `ปิดงานซ่อม ห้อง ${request.roomNumber} วันที่ ${request.repairedDate}` +
        (request.repairCostCents === null ? '' : ` ค่าซ่อม ${request.repairCostCents / 100} บาท`)
    )
    return request
  })

  handleSession('maintenance:cancel', ({ maintenanceId, reason }) => {
    const request = cancelMaintenance(getDatabase(), maintenanceId, { reason })
    logInfo(`ยกเลิกงานซ่อม ห้อง ${request.roomNumber} (maintenance_id ${maintenanceId})`)
    return request
  })

  handleSession('maintenance:reopen', ({ maintenanceId }) =>
    reopenMaintenance(getDatabase(), maintenanceId)
  )

  handleSession('maintenance:delete', ({ maintenanceId }) => {
    const result = deleteMaintenanceRequest(getDatabase(), maintenanceId)
    logInfo(`ลบงานแจ้งซ่อม (maintenance_id ${maintenanceId})`)
    return result
  })

  // main อ่านไฟล์รูปเอง — ส่ง bytes ข้าม IPC จะบวมมาก
  handleSession('maintenance:addImage', async ({ maintenanceId }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'เลือกรูปประกอบการแจ้งซ่อม',
      properties: ['openFile'],
      filters: [{ name: 'รูปภาพ', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (canceled || filePaths.length === 0) return { cancelled: true }

    const filePath = filePaths[0]
    const mimeType = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
    if (!mimeType) throw new Error('รองรับเฉพาะไฟล์รูปภาพ png, jpg, webp และ gif')

    const result = addMaintenanceImage(getDatabase(), maintenanceId, {
      mimeType,
      bytes: fs.readFileSync(filePath)
    })
    logInfo(`แนบรูปงานซ่อม (maintenance_id ${maintenanceId} image_id ${result.imageId})`)
    return { cancelled: false, ...result }
  })

  handleSession('maintenance:removeImage', ({ maintenanceId, imageId }) =>
    removeMaintenanceImage(getDatabase(), maintenanceId, imageId)
  )

  handleSession('maintenance:imageDataUrl', ({ imageId }) => ({
    dataUrl: getImageDataUrl(getDatabase(), imageId)
  }))
}
