// IPC ของหน้าภาพรวม — ช่องเดียว ดึงทุกตัวเลขในรอบเดียว
//
// **ไม่ล็อกให้เจ้าของหอเท่านั้น** ต่างจากเมนูตั้งค่า — ตัวเลขทุกตัวบนหน้านี้เป็นสิ่งที่
// พนักงานเห็นได้อยู่แล้วจากหน้าใบแจ้งหนี้/การชำระเงิน/แจ้งซ่อม และคนที่ต้องรู้ว่า
// "เดือนนี้ยังไม่ได้ออกบิล" คือคนที่ออกบิล
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
      return { success: false, error: err.message }
    }
  })
}

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็ม (ภัยจาก DevTools ตอนหน้าจอค้างที่
// ล็อกอิน และช่องไหนห้ามใส่การ์ด) อยู่เหนือ requireSessionUserId() ใน authHandlers.js
function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

export function registerDashboardHandlers() {
  // ไม่รับ today จากหน้าจอ — วันที่ที่ใช้ตัดสินว่า "เดือนนี้" คือเดือนไหน และบิลเกินกำหนด
  // ไปกี่วัน ต้องมาจากเครื่องที่รันฐานข้อมูล ไม่ใช่ค่าที่ส่งมาจาก renderer
  handleSession('dashboard:summary', ({ apartmentId }) => getDashboardSummary(getDatabase(), apartmentId))
}
