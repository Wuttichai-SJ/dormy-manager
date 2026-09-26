import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import { getDashboardSummary } from '../db/dashboard.js'

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

export function registerDashboardHandlers() {
  // วันที่ใช้ของเครื่องที่รันฐานข้อมูล ไม่รับจากหน้าจอ
  handleSession('dashboard:summary', ({ apartmentId }) => getDashboardSummary(getDatabase(), apartmentId))
}
